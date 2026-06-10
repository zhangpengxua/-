const express = require('express');
const router = express.Router();
const LLMService = require('../utils/llmService');
const OCRService = require('../utils/ocrService');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

let conversations = [];
let conversationIdCounter = 1;

const generateId = () => {
  return 'conv_' + conversationIdCounter++;
};

// ==================== Python代码执行函数 ====================
async function executePythonCode(code) {
  return new Promise((resolve, reject) => {
    // 提取代码块中的Python代码
    const codeMatch = code.match(/```python\s*([\s\S]*?)\s*```/);
    if (!codeMatch) {
      resolve({ success: false, error: '未找到Python代码块' });
      return;
    }
    
    let pythonCode = codeMatch[1];
    
    // Windows下修改保存路径
    const tmpDir = path.join(__dirname, '..', 'tmp');
    const windowsPngPath = path.join(tmpDir, 'figure.png');
    const windowsGifPath = path.join(tmpDir, 'animation.gif');
    
    // 替换代码中的保存路径
    pythonCode = pythonCode.replace(/\/tmp\/figure\.png/g, windowsPngPath.replace(/\\/g, '\\\\'));
    pythonCode = pythonCode.replace(/\/tmp\/animation\.gif/g, windowsGifPath.replace(/\\/g, '\\\\'));
    
    // Windows下使用临时文件
    const tempFile = path.join(__dirname, '..', 'temp_figure.py');
    fs.writeFileSync(tempFile, pythonCode, 'utf8');
    
    console.log('Python代码保存路径:', windowsPngPath);
    
    const pythonProcess = spawn('python', [tempFile]);
    
    let stdout = '';
    let stderr = '';
    
    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('Python stdout:', data.toString());
    });
    
    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.log('Python stderr:', data.toString());
    });
    
    pythonProcess.on('close', (exitCode) => {
      // 清理临时文件
      try {
        fs.unlinkSync(tempFile);
      } catch (e) {}
      
      // 检查是否生成了图片或动图
      let imageData = null;
      let imageType = 'png'; // 默认PNG格式
      
      // 优先检查GIF动图
      if (fs.existsSync(windowsGifPath)) {
        try {
          imageData = fs.readFileSync(windowsGifPath, { encoding: 'base64' });
          imageType = 'gif';
          console.log('GIF动图读取成功，大小:', imageData.length);
          fs.unlinkSync(windowsGifPath);
        } catch (e) {
          console.error('读取GIF失败:', e.message);
        }
      } 
      // 如果没有GIF，检查PNG
      else if (fs.existsSync(windowsPngPath)) {
        try {
          imageData = fs.readFileSync(windowsPngPath, { encoding: 'base64' });
          imageType = 'png';
          console.log('PNG图片读取成功，大小:', imageData.length);
          fs.unlinkSync(windowsPngPath);
        } catch (e) {
          console.error('读取PNG失败:', e.message);
        }
      } else {
        console.log('图片文件不存在');
      }
      
      resolve({
        success: exitCode === 0,
        stdout,
        stderr,
        imageData,
        imageType
      });
    });
    
    pythonProcess.on('error', (err) => {
      resolve({
        success: false,
        error: err.message
      });
    });
    
    // 设置超时（90秒，动图生成可能需要更长时间）
    setTimeout(() => {
      pythonProcess.kill();
      resolve({
        success: false,
        error: 'Python执行超时'
      });
    }, 90000);
  });
}

router.get('/', async (req, res) => {
  try {
    const convList = conversations.map(c => ({
      _id: c._id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt
    })).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json(convList);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const conversation = conversations.find(c => c._id === req.params.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const conversation = {
      _id: generateId(),
      title: '未命名对话',
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
    conversations.push(conversation);
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== 消息发送接口（新的三层调用逻辑） ====================
router.post('/:id/message', async (req, res) => {
  try {
    const { content, imageBase64 } = req.body;
    const conversation = conversations.find(c => c._id === req.params.id);
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // OCR处理
    let ocrText = null;
    if (imageBase64) {
      try {
        ocrText = await OCRService.recognizeText(imageBase64);
        console.log('OCR识别结果:', ocrText);
      } catch (ocrError) {
        console.warn('OCR failed:', ocrError.message);
        ocrText = null;
      }
    }

    const userContent = ocrText ? `${content}\n\n图片识别文字: ${ocrText}` : content;

    // 添加用户消息
    conversation.messages.push({
      role: 'user',
      content: userContent,
      imageUrl: imageBase64 ? `data:image/png;base64,${imageBase64}` : null,
      ocrText: ocrText,
      timestamp: new Date()
    });

    let finalAnswer = null;
    let stepResults = [];
    let images = [];
    
    try {
      // ========== 第一层：生成解题步骤（纯文字） ==========
      const context = conversation.messages.slice(0, -1).map(m => `${m.role}: ${m.content}`).join('\n');
      console.log('开始第一层调用...');
      const firstLayerResult = await LLMService.firstLayerLLM(context, userContent);
      console.log('第一层结果（解题步骤）:', JSON.stringify(firstLayerResult, null, 2));

      // ========== 处理每个步骤 ==========
      for (const step of firstLayerResult.steps) {
        const stepResult = {
          id: step.id,
          description: step.description,
          needImage: step.needImage,
          imageType: step.imageType,
          pythonCode: null,
          imageData: null,
          executionResult: null
        };

        // 如果需要图像，调用第二层生成Python代码
        if (step.needImage && step.imageType !== 'NO_IMAGE') {
          console.log(`步骤 ${step.id} 需要图像，类型: ${step.imageType}`);
          
          // ========== 第二层：生成Python代码 ==========
          console.log('开始第二层调用...');
          const pythonCode = await LLMService.secondLayerLLM(step.description, step.imageType);
          console.log('第二层结果（Python代码）:', pythonCode.substring(0, 200) + '...');
          stepResult.pythonCode = pythonCode;

          // ========== 第三层：执行Python代码生成图片 ==========
          console.log('开始第三层（执行Python代码）...');
          const executionResult = await executePythonCode(pythonCode);
          console.log('Python执行结果:', executionResult.success ? '成功' : '失败');
          
          stepResult.executionResult = executionResult;
          
          if (executionResult.success && executionResult.imageData) {
            stepResult.imageData = executionResult.imageData;
            stepResult.imageType = executionResult.imageType; // 保存图片类型
            images.push({
              stepId: step.id,
              imageData: executionResult.imageData,
              imageType: executionResult.imageType // 保存图片类型
            });
            console.log(`步骤 ${step.id} 图片生成成功，类型: ${executionResult.imageType}`);
          } else if (!executionResult.success) {
            console.warn(`步骤 ${step.id} Python执行失败:`, executionResult.stderr || executionResult.error);
          }
        }

        stepResults.push(stepResult);
      }

      // ========== 合成最终答案 ==========
      console.log('开始合成最终答案...');
      const finalResult = await LLMService.thirdLayerLLM(stepResults);
      finalAnswer = finalResult.finalAnswer;
      console.log('最终答案:', finalAnswer.substring(0, 300) + '...');

    } catch (llmError) {
      console.error('LLM服务调用失败:', llmError.message);
      
      // 如果LLM服务调用失败，使用模拟响应
      finalAnswer = `抱歉，AI服务暂时不可用。\n\n错误信息: ${llmError.message}\n\n请检查您的API配置是否正确。`;
      stepResults = [{
        id: 1,
        description: '服务调用失败',
        needImage: false,
        error: llmError.message
      }];
    }

    // 添加助手消息
    conversation.messages.push({
      role: 'assistant',
      content: finalAnswer,
      images: images,
      stepResults: stepResults,
      timestamp: new Date()
    });

    // 生成对话标题
    if (conversation.messages.length > 1) {
      try {
        const title = await LLMService.generateConversationTitle(conversation.messages);
        conversation.title = title.trim();
      } catch (titleError) {
        console.warn('标题生成失败:', titleError.message);
        conversation.title = content.substring(0, 30) + (content.length > 30 ? '...' : '');
      }
    }

    conversation.updatedAt = new Date();

    res.json({
      conversation,
      stepResults,
      images,
      finalAnswer
    });
  } catch (error) {
    console.error('Message processing error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const index = conversations.findIndex(c => c._id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    conversations.splice(index, 1);
    res.json({ message: 'Conversation deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;