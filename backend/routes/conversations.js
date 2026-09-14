const express = require('express');
const router = express.Router();
const LLMService = require('../utils/llmService');
const OCRService = require('../utils/ocrService');
const conversationRepository = require('../repositories/conversationRepository');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const activeRequests = {};

function finishAbort(convId, res) {
  delete activeRequests[convId];
  if (res.headersSent) return;
  const conversation = conversationRepository.getConversation(convId);
  res.json({ aborted: true, conversation });
}

// 兼容旧请求：接受明确请求字段（source/kind/studentQuestion/activeStepId），
// 旧客户端未传时按文本形态推断。
function resolveUserMessageMeta(body) {
  const content = typeof body.content === 'string' ? body.content : '';
  const isLegacyFollowup = content.startsWith('针对题目追问：');
  const kind = body.kind === 'followup' || body.kind === 'question'
    ? body.kind
    : (isLegacyFollowup ? 'followup' : 'question');
  return {
    kind,
    source: body.source === 'demo' ? 'demo' : 'user_problem',
    studentQuestion: typeof body.studentQuestion === 'string' && body.studentQuestion.trim() ? body.studentQuestion.trim() : null,
    activeStepId: body.activeStepId === undefined ? null : body.activeStepId,
  };
}

router.get('/', async (_, res) => {
  res.json(conversationRepository.listConversationSummaries());
});

router.get('/:id', async (req, res) => {
  const conv = conversationRepository.getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Not found' });
  res.json(conv);
});

router.post('/', async (req, res) => {
  const source = req.body?.source === 'demo' ? 'demo' : 'user_problem';
  const conv = conversationRepository.createConversation({ source });
  res.json(conv);
});

// ==================== 消息发送（智能路由） ====================
router.post('/:id/message', async (req, res) => {
  let convId = '';
  try {
    const { content, imageBase64 } = req.body;
    convId = req.params.id;
    const conversation = conversationRepository.getConversation(convId);
    if (!conversation) return res.status(404).json({ error: 'Not found' });

    let ocrText = null;
    if (imageBase64) {
      try { ocrText = await OCRService.recognizeText(imageBase64); } catch (e) {}
    }

    conversationRepository.appendUserMessage(conversation, { content, imageUrl: imageBase64 ? `data:image/png;base64,${imageBase64}` : null, ocrText, ...resolveUserMessageMeta(req.body) });
    console.log('[POST msg] user content:', content?.substring(0, 200));

    activeRequests[convId] = { abort: false };

    let finalAnswer = null, stepResults = [], llmFailed = false;

    try {
      const context = conversation.messages.slice(0, -1).map(m => m.role + ': ' + m.content).join('\n');
      if (activeRequests[convId]?.abort) return finishAbort(convId, res);

      // 第一层：拆解题步骤 + 提取结构化数据（drawingData）
      const layer1 = await LLMService.firstLayerLLM(context, content, imageBase64);

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
      llmFailed = true;
      finalAnswer = '抱歉，服务暂时不可用。\n错误: ' + e.message;
      stepResults = [{ id: 1, description: '服务调用失败', needImage: false }];
    }

    if (activeRequests[convId]?.abort) return finishAbort(convId, res);
    delete activeRequests[convId];
    if (!conversationRepository.getConversation(convId)) return;

    const images = [];
    conversationRepository.appendAssistantMessage(conversation, {
      content: finalAnswer,
      images,
      stepResults,
      // 降级文案显式标记 fallback，不冒充成功解答。
      status: llmFailed ? 'fallback' : 'completed',
    });
    console.log('[POST] stepResults count:', stepResults.length);
    for (const sr of stepResults) {
      console.log(`[POST] step ${sr.id}: needImg=${sr.needImage} imgType=${sr.imageType} drawingData=${!!sr.drawingData} isGeometry=${sr.isGeometry} isSurface=${sr.isSurface} is2DPlot=${sr.is2DPlot}`);
    }

    if (conversation.messages.length > 1) {
      try {
        conversationRepository.renameConversation(conversation, (await LLMService.generateConversationTitle(conversation.messages)).trim());
      } catch (e) {
        conversationRepository.renameConversation(conversation, content.substring(0, 30) + (content.length > 30 ? '...' : ''));
      }
    }
    conversationRepository.touchConversation(conversation);
    res.json({ conversation, stepResults, images, finalAnswer });
  } catch (e) {
    delete activeRequests[convId];
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/abort', async (req, res) => {
  const cid = req.params.id;
  const conversation = conversationRepository.getConversation(cid);
  if (!conversation) return res.status(404).json({ error: 'Not found' });
  if (activeRequests[cid]) activeRequests[cid].abort = true;
  res.json({ aborted: true, conversation });
});

router.delete('/:id', async (req, res) => {
  const cid = req.params.id;
  if (activeRequests[cid]) { activeRequests[cid].abort = true; }
  const deleted = conversationRepository.deleteConversation(cid);
  if (!deleted) return res.status(404).json({ error: 'Not found' });
  res.json({ message: 'Deleted' });
});

// ==================== SSE 流式消息（支持 AI 思考过程展示） ====================
router.post('/:id/message-stream', async (req, res) => {
  let convId = '';

  const sendSSE = (event, data) => {
    if (res.destroyed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { content, imageBase64 } = req.body;
    convId = req.params.id;
    const conversation = conversationRepository.getConversation(convId);
    if (!conversation) return res.status(404).json({ error: 'Not found' });

    // Configure SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let ocrText = null;
    if (imageBase64) {
      try { ocrText = await OCRService.recognizeText(imageBase64); } catch (e) {}
    }

    conversationRepository.appendUserMessage(conversation, { content, imageUrl: imageBase64 ? `data:image/png;base64,${imageBase64}` : null, ocrText, ...resolveUserMessageMeta(req.body) });
    console.log('[SSE] user content:', content?.substring(0, 200));

    activeRequests[convId] = { abort: false };
    req.on('close', () => { if (activeRequests[convId]) activeRequests[convId].abort = true; });

    let finalAnswer = null, stepResults = [], llmFailed = false;

    // --- Phase 1: 题目分析 ---
    sendSSE('thinking:update', {
      phase: 'thinking',
      message: '开始分析题目...',
      steps: { problemAnalysis: '' },
      currentStepIndex: undefined,
      layer1Steps: [],
    });

    const context = conversation.messages.slice(0, -1).map(m => m.role + ': ' + m.content).join('\n');
    if (activeRequests[convId]?.abort) return;

    // --- Layer 1: 拆解题步骤 ---
    sendSSE('thinking:update', {
      phase: 'thinking',
      message: '正在调用第一层大模型进行解题分析...',
      currentStepIndex: undefined,
    });

    const layer1 = await LLMService.firstLayerLLM(context, content, imageBase64);

    sendSSE('thinking:update', {
      phase: 'thinking',
      message: `已完成题目分析，提取到 ${layer1.steps.length} 个步骤`,
      layer1Steps: layer1.steps.map(s => ({
        id: s.id,
        description: s.description,
        needImage: s.needImage,
        imageType: s.imageType,
      })),
      currentStepIndex: undefined,
    });

    // 让用户看到步骤提取结果
    await sleep(2000);

    // --- Layer 2: 逐步骤提取绘制数据 ---
    for (let i = 0; i < layer1.steps.length; i++) {
      if (activeRequests[convId]?.abort) return;
      const step = layer1.steps[i];

      sendSSE('thinking:update', {
        phase: 'thinking',
        message: `正在处理步骤 ${step.id}: ${step.description?.substring(0, 60)}...`,
        currentStepIndex: i,
        layer2Step: { id: step.id, description: step.description },
      });

      let drawingData = step.drawingData || null;
      let functionPoolUsed = false;

      if (step.needImage && step.imageType !== 'NO_IMAGE') {
        const enriched = LLMService.enrichWithFunctionPool(drawingData, step.description);
        functionPoolUsed = JSON.stringify(enriched) !== JSON.stringify(drawingData);
        drawingData = enriched;
      }

      if (functionPoolUsed) {
        sendSSE('thinking:update', {
          phase: 'thinking',
          message: `步骤 ${step.id}: 从函数池中匹配补充绘制数据`,
          functionPoolUsed: true,
          currentStepIndex: i,
        });
      }

      const sr = {
        id: step.id,
        description: step.description,
        needImage: step.needImage,
        imageType: step.imageType,
        drawingData,
        isGeometry: ['MATH_STATIC_ABSTRACT', 'MATH_DYNAMIC_GEOMETRY', 'MATH_DYNAMIC_3D_GEOMETRY'].includes(step.imageType),
        isSurface: ['MATH_STATIC_SURFACE', 'MATH_STATIC_IMPLICIT'].includes(step.imageType),
        is2DPlot: ['MATH_STATIC_2D_FUNCTION', 'MATH_STATIC_EQUATION'].includes(step.imageType),
        pythonCode: null,
        imageData: null,
        imageFormat: null,
        executionResult: null,
      };
      stepResults.push(sr);

      sendSSE('thinking:update', {
        phase: 'thinking',
        message: `步骤 ${step.id} 处理完成`,
        currentStepIndex: i,
        stepResult: {
          id: sr.id,
          needImage: sr.needImage,
          imageType: sr.imageType,
          isGeometry: sr.isGeometry,
          isSurface: sr.isSurface,
          is2DPlot: sr.is2DPlot,
          functionCount: drawingData?.functions?.length || 0,
          planeCount: drawingData?.planes?.length || 0,
          pointCount: drawingData?.points?.length || 0,
          lineCount: drawingData?.lines?.length || 0,
        },
      });

      // 每个步骤之间加延迟，让用户能看到中间状态
      await sleep(1200);
    }

    // 所有步骤处理完成后的短延迟
    await sleep(1500);

    // --- Layer 3: 生成最终答案 ---
    if (activeRequests[convId]?.abort) return;
    sendSSE('thinking:update', {
      phase: 'thinking',
      message: '正在调用第三层大模型生成最终答案...',
      currentStepIndex: layer1.steps.length - 1,
    });

    // 让用户看到"生成最终答案"状态再开始调用 LLM
    await sleep(1500);

    const finalR = await LLMService.thirdLayerLLM(stepResults);
    finalAnswer = finalR.finalAnswer;

    // 完成前的延迟，让用户看到答案已生成的状态
    await sleep(1000);

    // --- Complete ---
    if (activeRequests[convId]?.abort) return;
    delete activeRequests[convId];

    const images = [];
    conversationRepository.appendAssistantMessage(conversation, {
      content: finalAnswer,
      images,
      stepResults,
      status: llmFailed ? 'fallback' : 'completed',
    });

    if (conversation.messages.length > 1) {
      try {
        conversationRepository.renameConversation(conversation, (await LLMService.generateConversationTitle(conversation.messages)).trim());
      } catch (e) {
        conversationRepository.renameConversation(conversation, content.substring(0, 30) + (content.length > 30 ? '...' : ''));
      }
    }
    conversationRepository.touchConversation(conversation);

    sendSSE('complete', {
      conversation,
      stepResults,
      images,
      finalAnswer,
      thinkingSummary: {
        totalSteps: layer1.steps.length,
        layer1Steps: layer1.steps.map(s => ({ id: s.id, description: s.description })),
      },
    });

    res.end();
  } catch (e) {
    console.error('[SSE] Error:', e.message);
    if (!res.destroyed) {
      sendSSE('error', { message: e.message });
      res.end();
    }
    delete activeRequests[convId];
  }
});

module.exports = router;
