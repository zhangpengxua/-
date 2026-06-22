const express = require('express');
const router = express.Router();
const LLMService = require('../utils/llmService');
const OCRService = require('../utils/ocrService');

let conversations = [];
let conversationIdCounter = 1;
const activeRequests = {};

const generateId = () => 'conv_' + conversationIdCounter++;

function finishAbort(convId, res) {
  delete activeRequests[convId];
  if (res.headersSent) return;
  const conversation = conversations.find(c => c._id === convId);
  res.json({ aborted: true, conversation });
}

router.get('/', async (_, res) => {
  const list = conversations.map(c => ({ _id: c._id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt })).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  res.json(list);
});

router.get('/:id', async (req, res) => {
  const conv = conversations.find(c => c._id === req.params.id);
  if (!conv) return res.status(404).json({ error: 'Not found' });
  res.json(conv);
});

router.post('/', async (_, res) => {
  const conv = { _id: generateId(), title: '未命名对话', messages: [], createdAt: new Date(), updatedAt: new Date() };
  conversations.push(conv);
  res.json(conv);
});

// ==================== 消息发送（智能路由） ====================
router.post('/:id/message', async (req, res) => {
  let convId = '';
  try {
    const { content, imageBase64 } = req.body;
    convId = req.params.id;
    const conversation = conversations.find(c => c._id === convId);
    if (!conversation) return res.status(404).json({ error: 'Not found' });

    let ocrText = null;
    if (imageBase64) {
      try { ocrText = await OCRService.recognizeText(imageBase64); } catch (e) {}
    }

    conversation.messages.push({
      role: 'user', content, imageUrl: imageBase64 ? `data:image/png;base64,${imageBase64}` : null, ocrText: null, timestamp: new Date()
    });
    console.log('[POST msg] user content:', content?.substring(0, 200));

    activeRequests[convId] = { abort: false };

    let finalAnswer = null, stepResults = [];

    try {
      const context = conversation.messages.slice(0, -1).map(m => m.role + ': ' + m.content).join('\n');
      if (activeRequests[convId]?.abort) return finishAbort(convId, res);

      // 第一层：拆解题步骤 + 提取结构化数据（drawingData）
      const layer1 = await LLMService.firstLayerLLM(context, content);

      for (const step of layer1.steps) {
        if (activeRequests[convId]?.abort) return finishAbort(convId, res);
        console.log(`[Step ${step.id}] needImage=${step.needImage} imageType=${step.imageType} desc=${step.description?.substring(0, 80)}`);

        // 函数池/点位池富化：如果 LLM 未能提取函数，从函数池补充
        let drawingData = step.drawingData || null;
        if (step.needImage && step.imageType !== 'NO_IMAGE') {
          drawingData = LLMService.enrichWithFunctionPool(drawingData, step.description);
        }

        const sr = {
          id: step.id,
          description: step.description,
          needImage: step.needImage,
          imageType: step.imageType,
          drawingData,
          // 前端渲染路由标志
          isGeometry: ['MATH_STATIC_ABSTRACT', 'MATH_DYNAMIC_GEOMETRY', 'MATH_DYNAMIC_3D_GEOMETRY'].includes(step.imageType),
          isSurface: ['MATH_STATIC_SURFACE', 'MATH_STATIC_IMPLICIT'].includes(step.imageType),
          is2DPlot: ['MATH_STATIC_2D_FUNCTION', 'MATH_STATIC_EQUATION'].includes(step.imageType),
          // 保留旧字段兼容（不再使用 Python 执行）
          pythonCode: null,
          imageData: null,
          imageFormat: null,
          executionResult: null
        };

        console.log(`[Step ${step.id}] drawingData: points=${drawingData?.points?.length || 0} lines=${drawingData?.lines?.length || 0} planes=${drawingData?.planes?.length || 0} functions=${drawingData?.functions?.length || 0}`);
        if (drawingData?.planes?.length) {
          console.log(`[Step ${step.id}] planes detail:`, JSON.stringify(drawingData.planes));
        }
        if (drawingData?.functions?.length) {
          console.log(`[Step ${step.id}] functions detail:`, JSON.stringify(
            drawingData.functions.map(f => ({ name: f.name, type: f.type, expr: f.expr, exprU: f.exprU }))
          ));
        }
        stepResults.push(sr);
      }

      if (activeRequests[convId]?.abort) return finishAbort(convId, res);
      const finalR = await LLMService.thirdLayerLLM(stepResults);
      finalAnswer = finalR.finalAnswer;
    } catch (e) {
      console.error('LLM error:', e.message);
      finalAnswer = '抱歉，服务暂时不可用。\n错误: ' + e.message;
      stepResults = [{ id: 1, description: '服务调用失败', needImage: false }];
    }

    if (activeRequests[convId]?.abort) return finishAbort(convId, res);
    delete activeRequests[convId];
    if (!conversations.find(c => c._id === convId)) return;

    const images = [];
    conversation.messages.push({ role: 'assistant', content: finalAnswer, images, stepResults, timestamp: new Date() });
    console.log('[POST] stepResults count:', stepResults.length);
    for (const sr of stepResults) {
      console.log(`[POST] step ${sr.id}: needImg=${sr.needImage} imgType=${sr.imageType} drawingData=${!!sr.drawingData} isGeometry=${sr.isGeometry} isSurface=${sr.isSurface} is2DPlot=${sr.is2DPlot}`);
    }

    if (conversation.messages.length > 1) {
      try {
        conversation.title = (await LLMService.generateConversationTitle(conversation.messages)).trim();
      } catch (e) {
        conversation.title = content.substring(0, 30) + (content.length > 30 ? '...' : '');
      }
    }
    conversation.updatedAt = new Date();
    res.json({ conversation, stepResults, images, finalAnswer });
  } catch (e) {
    delete activeRequests[convId];
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/abort', async (req, res) => {
  const cid = req.params.id;
  const conversation = conversations.find(c => c._id === cid);
  if (!conversation) return res.status(404).json({ error: 'Not found' });
  if (activeRequests[cid]) activeRequests[cid].abort = true;
  res.json({ aborted: true, conversation });
});

router.delete('/:id', async (req, res) => {
  const cid = req.params.id;
  if (activeRequests[cid]) { activeRequests[cid].abort = true; }
  const idx = conversations.findIndex(c => c._id === cid);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  conversations.splice(idx, 1);
  res.json({ message: 'Deleted' });
});

module.exports = router;