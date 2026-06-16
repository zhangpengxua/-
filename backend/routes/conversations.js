const express = require('express');
const router = express.Router();
const LLMService = require('../utils/llmService');
const OCRService = require('../utils/ocrService');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

let conversations = [];
let conversationIdCounter = 1;
const activeRequests = {};

const generateId = () => { return 'conv_' + conversationIdCounter++; };

async function executePythonCode(code) {
  return new Promise((resolve) => {
    if (typeof code !== 'string') {
      resolve({ success: false, error: 'Python代码格式不正确（非字符串）' });
      return;
    }
    const codeMatch = code.match(/```python\s*([\s\S]*?)\s*```/);
    if (!codeMatch) { resolve({ success: false, error: '未找到Python代码块' }); return; }
    let pythonCode = codeMatch[1];
    const tmpDir = path.join(__dirname, '..', 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const pngPath = path.join(tmpDir, 'figure.png');
    const gifPath = path.join(tmpDir, 'animation.gif');
    pythonCode = pythonCode.replace(/\/tmp\/figure\.png/g, pngPath.replace(/\\/g, '\\\\'));
    pythonCode = pythonCode.replace(/\/tmp\/animation\.gif/g, gifPath.replace(/\\/g, '\\\\'));
    const tempFile = path.join(__dirname, '..', 'temp_figure.py');
    fs.writeFileSync(tempFile, "import matplotlib\nmatplotlib.use('Agg')\n" + pythonCode, 'utf8');
    const pythonProcess = spawn('python', [tempFile]);
    let stdout = '', stderr = '';
    pythonProcess.stdout.on('data', d => { stdout += d.toString(); });
    pythonProcess.stderr.on('data', d => { stderr += d.toString(); });
    pythonProcess.on('close', exitCode => {
      console.log(`[Python] exitCode=${exitCode} stdout=${stdout.trim()} stderr=${stderr.trim().substring(stderr.length - 300)}`);
      try { fs.unlinkSync(tempFile); } catch (e) {}
      let imageData = null, imageType = 'png';
      if (fs.existsSync(gifPath)) {
        try {
          imageData = fs.readFileSync(gifPath, { encoding: 'base64' });
          imageType = 'gif';
          fs.unlinkSync(gifPath);
        } catch (e) {}
      } else if (fs.existsSync(pngPath)) {
        try {
          imageData = fs.readFileSync(pngPath, { encoding: 'base64' });
          imageType = 'png';
          fs.unlinkSync(pngPath);
        } catch (e) {}
      }
      resolve({ success: exitCode === 0, stdout, stderr, imageData, imageType });
    });
    pythonProcess.on('error', err => resolve({ success: false, error: err.message }));
    setTimeout(() => { pythonProcess.kill(); resolve({ success: false, error: '超时' }); }, 90000);
  });
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

    let finalAnswer = null, stepResults = [], images = [];

    try {
      const context = conversation.messages.slice(0, -1).map(m => m.role + ': ' + m.content).join('\n');

      if (activeRequests[convId]?.abort) return;
      const layer1 = await LLMService.firstLayerLLM(context, content);

        // 用于存储前一步的参数，实现上下文一致性
        let previousParams = null;
        // 清空上一轮 Claude 几何数据
        LLMService._lastGeometryParams = null;

        for (const step of layer1.steps) {
          if (activeRequests[convId]?.abort) return;
          console.log(`[Step ${step.id}] needImage=${step.needImage} imageType=${step.imageType} desc=${step.description?.substring(0, 80)}`);
          const isFrontendType = ['MATH_STATIC_SURFACE', 'MATH_STATIC_IMPLICIT', 'MATH_STATIC_2D_FUNCTION'].includes(step.imageType);
          const sr = {
            id: step.id,
            description: step.description,
            needImage: step.needImage,
            imageType: step.imageType,
            drawingData: step.drawingData || null,
            isGeometry: (step.drawingData && !isFrontendType) ? true : false,
            pythonCode: null,
            imageData: null,
            imageFormat: null,
            executionResult: null
          };
          if (step.needImage && step.imageType !== 'NO_IMAGE') {
            // [前端渲染类型] 跳过 Python 执行，把 drawingData 传给前端用 mathjs 数值计算渲染
            const FRONTEND_TYPES = ['MATH_STATIC_SURFACE', 'MATH_STATIC_IMPLICIT', 'MATH_STATIC_2D_FUNCTION'];
            const isFrontendRender = FRONTEND_TYPES.includes(step.imageType);

            if (isFrontendRender) {
              console.log(`[Step ${step.id}] Frontend rendering mode for ${step.imageType}, skipping Python`);
              // 保留 drawingData，让前端 Interactive3DViewer / FunctionPlot 用 mathjs 渲染
              sr.drawingData = step.drawingData || null;
              sr.imageData = null;
              sr.imageFormat = null;
            } else {
              if (activeRequests[convId]?.abort) return;
              console.log(`[Step ${step.id}] Calling secondLayerLLM for imageType=${step.imageType}...`);

              // 传递前一步的参数以保持一致性
              sr.pythonCode = await LLMService.secondLayerLLM(step.description, step.imageType, previousParams);

              console.log(`[Step ${step.id}] pythonCode type=${typeof sr.pythonCode} len=${sr.pythonCode?.length || 0}`);
              console.log(`[Step ${step.id}] pythonCode preview: ${(sr.pythonCode ? sr.pythonCode.substring(0, 200) : 'NULL')}`);
              if (activeRequests[convId]?.abort) return;
              const exec = await executePythonCode(sr.pythonCode);
              sr.executionResult = exec;
              console.log(`[Step ${step.id}] exec: success=${exec.success} imageData=${!!exec.imageData} error=${exec.error || exec.stderr?.substring(exec.stderr.length - 200)}`);
              if (exec.success && exec.imageData) {
                sr.imageData = exec.imageData;
                sr.imageFormat = exec.imageType || 'png';
                images.push({ stepId: step.id, imageData: exec.imageData, imageType: exec.imageType || 'png' });
              }
            }

            // 把第一层 drawingData 透传给前端（包含 points/lines/planes/functions）
            sr.drawingData = step.drawingData || null;

            // 如果第二层 Claude 提取了 planes，补回 drawingData
            if (LLMService._lastGeometryParams?.planes && (!sr.drawingData?.planes || sr.drawingData.planes.length === 0)) {
              if (!sr.drawingData) sr.drawingData = { dimension: '3D', type: 'static' };
              if (!sr.drawingData.planes) sr.drawingData.planes = [];
              // 将 Claude 的 planes 透传给前端（保留 equation/normal/bounds 等完整信息）
              sr.drawingData.planes = LLMService._lastGeometryParams.planes.map(pl => ({
                name: pl.name || '面',
                points: pl.points || [],
                equation: pl.equation || null,
                normal: pl.normal || null,
                bounds: pl.bounds || null,
                point: pl.point || null
              })).filter(Boolean);
              console.log(`[Step ${step.id}] Enriched drawingData with ${sr.drawingData.planes.length} planes from Claude`);
            }

            // 提取当前步骤的参数供下一步使用（仅对后端渲染类型有效）
            if (sr.pythonCode) {
              try {
                const codeMatch = sr.pythonCode.match(/```python\s*([\s\S]*?)\s*```/);
                if (codeMatch) {
                  const pythonCode = codeMatch[1];
                  const xRangeMatch = pythonCode.match(/ax\.set_xlim\(([^,]+),\s*([^)]+)\)/);
                  const yRangeMatch = pythonCode.match(/ax\.set_ylim\(([^,]+),\s*([^)]+)\)/);
                  const titleMatch = pythonCode.match(/ax\.set_title\('([^']+)'/);

                  if (xRangeMatch || yRangeMatch || titleMatch) {
                    previousParams = {
                      xRange: xRangeMatch ? [parseFloat(xRangeMatch[1]), parseFloat(xRangeMatch[2])] : null,
                      yRange: yRangeMatch ? [parseFloat(yRangeMatch[1]), parseFloat(yRangeMatch[2])] : null,
                      title: titleMatch ? titleMatch[1] : null,
                    };
                    console.log(`[Step ${step.id}] Extracted params for next step:`, previousParams);
                  }
                }
              } catch (e) {
                console.log(`[Step ${step.id}] Failed to extract params:`, e.message);
              }
            }
          } else {
            console.log(`[Step ${step.id}] Skipping image generation`);
          }
          stepResults.push(sr);
        }

        if (activeRequests[convId]?.abort) return;
        const finalR = await LLMService.thirdLayerLLM(stepResults);
        finalAnswer = finalR.finalAnswer;
    } catch (e) {
      console.error('LLM error:', e.message);
      console.error('LLM error detail:', e.response?.data ? JSON.stringify(e.response.data) : 'no detail');
      finalAnswer = '抱歉，服务暂时不可用。\n错误: ' + e.message;
      stepResults = [{ id: 1, description: '服务调用失败', needImage: false }];
    }

    if (activeRequests[convId]?.abort) { delete activeRequests[convId]; return; }
    delete activeRequests[convId];
    if (!conversations.find(c => c._id === convId)) return;

    conversation.messages.push({ role: 'assistant', content: finalAnswer, images, stepResults, timestamp: new Date() });
    console.log('[POST] images count:', images.length, 'stepResults count:', stepResults.length);
    for (const sr of stepResults) {
      console.log(`[POST] step ${sr.id}: hasImg=${!!sr.imageData} needImg=${sr.needImage} imgType=${sr.imageType} drawingData=${!!sr.drawingData} isGeometry=${sr.isGeometry} codeLen=${sr.pythonCode?.length || 0} execOk=${sr.executionResult?.success} execImg=${!!sr.executionResult?.imageData}`);
    }

    if (conversation.messages.length > 1) {
      try { conversation.title = (await LLMService.generateConversationTitle(conversation.messages)).trim(); } catch (e) {
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

router.delete('/:id', async (req, res) => {
  const cid = req.params.id;
  if (activeRequests[cid]) { activeRequests[cid].abort = true; }
  const idx = conversations.findIndex(c => c._id === cid);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  conversations.splice(idx, 1);
  res.json({ message: 'Deleted' });
});

module.exports = router;
