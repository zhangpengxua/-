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

    activeRequests[convId] = { abort: false };

    let finalAnswer = null, stepResults = [], images = [];

    try {
      const context = conversation.messages.slice(0, -1).map(m => m.role + ': ' + m.content).join('\n');

      const isProblem = await LLMService.classifyInput(content);
      console.log('分类:', isProblem ? '题目→多层' : '对话→简单');

      if (!isProblem) {
        finalAnswer = await LLMService.simpleChat(context, content);
        stepResults = [{ id: 1, description: finalAnswer, needImage: false, imageType: 'NO_IMAGE' }];
      } else {
        if (activeRequests[convId]?.abort) return;
        const layer1 = await LLMService.firstLayerLLM(context, content);

        for (const step of layer1.steps) {
          if (activeRequests[convId]?.abort) return;
          console.log(`[Step ${step.id}] needImage=${step.needImage} imageType=${step.imageType} desc=${step.description?.substring(0, 80)}`);
          const sr = { id: step.id, description: step.description, needImage: step.needImage, imageType: step.imageType, pythonCode: null, imageData: null, executionResult: null };
          if (step.needImage && step.imageType !== 'NO_IMAGE') {
            if (activeRequests[convId]?.abort) return;
            console.log(`[Step ${step.id}] Calling secondLayerLLM for imageType=${step.imageType}...`);
            sr.pythonCode = await LLMService.secondLayerLLM(step.description, step.imageType);
            console.log(`[Step ${step.id}] pythonCode type=${typeof sr.pythonCode} len=${sr.pythonCode?.length || 0}`);
            console.log(`[Step ${step.id}] pythonCode preview: ${(sr.pythonCode ? sr.pythonCode.substring(0, 200) : 'NULL')}`);
            if (activeRequests[convId]?.abort) return;
            const exec = await executePythonCode(sr.pythonCode);
            sr.executionResult = exec;
            console.log(`[Step ${step.id}] exec: success=${exec.success} imageData=${!!exec.imageData} error=${exec.error || exec.stderr?.substring(exec.stderr.length - 200)}`);
            if (exec.success && exec.imageData) {
              sr.imageData = exec.imageData;
              images.push({ stepId: step.id, imageData: exec.imageData, imageType: exec.imageType || 'png' });
            }
          } else {
            console.log(`[Step ${step.id}] Skipping image generation`);
          }
          stepResults.push(sr);
        }

        if (activeRequests[convId]?.abort) return;
        const finalR = await LLMService.thirdLayerLLM(stepResults);
        finalAnswer = finalR.finalAnswer;
      }
    } catch (e) {
      console.error('LLM error:', e.message);
      finalAnswer = '抱歉，服务暂时不可用。\n错误: ' + e.message;
      stepResults = [{ id: 1, description: '服务调用失败', needImage: false }];
    }

    if (activeRequests[convId]?.abort) { delete activeRequests[convId]; return; }
    delete activeRequests[convId];
    if (!conversations.find(c => c._id === convId)) return;

    conversation.messages.push({ role: 'assistant', content: finalAnswer, images, stepResults, timestamp: new Date() });

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
