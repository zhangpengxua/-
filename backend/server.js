const express = require('express');
const cors = require('cors');
const { execSync } = require('child_process');
require('dotenv').config();

const conversationRoutes = require('./routes/conversations');
const pythonRoutes = require('./routes/python');

const app = express();
const PORT = process.env.PORT || 5000;

app.timeout = 180000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/conversations', conversationRoutes);
app.use('/api/python', pythonRoutes);

// OCR-only endpoint
const OCRService = require('./utils/ocrService');
app.post('/api/ocr', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'No image provided' });
    const text = await OCRService.recognizeText(imageBase64);
    res.json({ text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== 环境检测函数 ====================
function runChecks() {
  const checks = [];
  const installGuide = [];

  // 1. Python
  let pythonOk = false;
  let pythonVersion = '';
  try {
    pythonVersion = execSync('python --version 2>&1 || python3 --version 2>&1', { encoding: 'utf8' }).trim();
    const match = pythonVersion.match(/(\d+)\.(\d+)/);
    if (match && parseInt(match[1]) >= 3) {
      pythonOk = true;
    }
  } catch (e) {
    pythonVersion = '未安装或不在 PATH 中';
  }
  checks.push({
    name: 'Python (>=3.8)',
    ok: pythonOk,
    detail: pythonOk ? pythonVersion : pythonVersion,
    fix: '下载安装 Python：https://www.python.org/downloads/  （安装时勾选 "Add Python to PATH"）',
  });

  // 2. matplotlib
  let matplotlibOk = false;
  try {
    const out = execSync('python -c "import matplotlib; print(matplotlib.__version__)" 2>&1', { encoding: 'utf8' }).trim();
    if (out && !out.includes('Traceback')) {
      matplotlibOk = true;
    }
  } catch (e) { /* not installed */ }
  checks.push({
    name: 'matplotlib',
    ok: matplotlibOk,
    detail: matplotlibOk ? '已安装' : '未安装',
    fix: '在终端中运行：pip install matplotlib',
  });

  // 3. numpy
  let numpyOk = false;
  try {
    const out = execSync('python -c "import numpy; print(numpy.__version__)" 2>&1', { encoding: 'utf8' }).trim();
    if (out && !out.includes('Traceback')) {
      numpyOk = true;
    }
  } catch (e) { /* not installed */ }
  checks.push({
    name: 'numpy',
    ok: numpyOk,
    detail: numpyOk ? '已安装' : '未安装',
    fix: '在终端中运行：pip install numpy',
  });

  // 4. pillow
  let pillowOk = false;
  try {
    const out = execSync('python -c "import PIL; print(PIL.__version__)" 2>&1', { encoding: 'utf8' }).trim();
    if (out && !out.includes('Traceback')) {
      pillowOk = true;
    }
  } catch (e) { /* not installed */ }
  checks.push({
    name: 'pillow',
    ok: pillowOk,
    detail: pillowOk ? '已安装' : '未安装',
    fix: '在终端中运行：pip install pillow（GIF 动画生成需要）',
  });

  // 5. DeepSeek API Key
  const apiKey = process.env.DEEPSEEK_API_KEY || '';
  const apiKeyOk = apiKey.length > 10 && apiKey.startsWith('sk-');
  checks.push({
    name: 'DeepSeek API Key',
    ok: apiKeyOk,
    detail: apiKeyOk ? '已配置' : '未配置或格式异常',
    fix: '编辑 backend/.env 文件，设置 DEEPSEEK_API_KEY=你的DeepSeek_API_Key\n获取地址：https://platform.deepseek.com/api_keys',
  });

  // 6. Baidu OCR API Key
  const ocrKey = process.env.BAIDU_OCR_API_KEY || '';
  const ocrSecret = process.env.BAIDU_OCR_SECRET_KEY || '';
  const ocrOk = ocrKey.length > 5 && ocrSecret.length > 5;
  checks.push({
    name: '百度 OCR API Key',
    ok: ocrOk,
    detail: ocrOk ? '已配置' : '未配置',
    fix: '编辑 backend/.env 文件，设置 BAIDU_OCR_API_KEY 和 BAIDU_OCR_SECRET_KEY\n获取地址：https://console.bce.baidu.com/ai/#/ai/ocr/overview/index',
  });

  return {
    pythonOk,
    pythonVersion,
    checks,
    allOk: checks.every(c => c.ok),
  };
}

// ==================== Health 端点（环境检测） ====================
app.get('/api/health', (_req, res) => {
  const result = runChecks();
  const statusCode = result.allOk ? 200 : 200; // 始终返回200，让前端解析
  res.status(statusCode).json(result);
});

app.get('/', (req, res) => {
  res.json({ message: 'DeepSeek Chat API is running' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Server timeout: ${app.timeout / 1000} seconds`);

  const status = runChecks();
  console.log('\n========== 环境检测 ==========');
  status.checks.forEach(c => {
    const icon = c.ok ? '✓' : '✗';
    console.log(`  ${icon} ${c.name}: ${c.detail}`);
    if (!c.ok) console.log(`    → ${c.fix}`);
  });
  console.log(status.allOk ? '\n✓ 所有依赖就绪，系统正常运行' : '\n✗ 存在缺失依赖，请按上述提示修复');
  console.log('================================\n');
});
