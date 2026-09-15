const express = require('express');
const cors = require('cors');
const { execSync } = require('child_process');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const conversationRoutes = require('./routes/conversations');
const learningRoutes = require('./routes/learning');

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
    name: 'pillow (GIF 动画)',
    ok: pillowOk,
    detail: pillowOk ? '已安装' : '未安装',
    fix: '在终端中运行：pip install pillow',
  });

  // 5. sympy (符号计算)
  let sympyOk = false;
  try {
    const out = execSync('python -c "import sympy; print(sympy.__version__)" 2>&1', { encoding: 'utf8' }).trim();
    if (out && !out.includes('Traceback')) {
      sympyOk = true;
    }
  } catch (e) { /* not installed */ }
  checks.push({
    name: 'sympy (符号/LaTeX)',
    ok: sympyOk,
    detail: sympyOk ? '已安装' : '未安装',
    fix: '在终端中运行：pip install sympy（数学符号计算与 LaTeX 输出，可选）',
  });

  // 6. DeepSeek API configuration
  const deepseekKey = process.env.DEEPSEEK_API_KEY || '';
  const deepseekModel = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
  const apiKeyOk = deepseekKey.length > 10 && deepseekKey.startsWith('sk-');
  checks.push({
    name: 'DeepSeek API',
    ok: apiKeyOk,
    detail: apiKeyOk ? `Configured (${deepseekModel})` : 'Not configured or invalid format',
    fix: '在 backend/.env 中设置 DEEPSEEK_API_KEY 和 DEEPSEEK_MODEL=deepseek-flash',
  });

  // 7. Baidu OCR API Key
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

// app 创建与启动监听分离：集成测试直接使用 createApp()，不触发 Python 环境检查。
function createApp() {
  const app = express();
  app.timeout = 180000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use('/api/conversations', conversationRoutes);
  app.use('/api/learning', learningRoutes);

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

  // ==================== Health 端点（环境检测） ====================
  app.get('/api/health', (_req, res) => {
    const result = runChecks();
    res.status(200).json(result);
  });

  app.get('/', (req, res) => {
    res.json({ message: 'DeepSeek Chat API is running' });
  });

  return app;
}

if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Server timeout: ${app.timeout / 1000} seconds`);

    const status = runChecks();
    console.log('\n========== 环境检测 ==========');
    status.checks.forEach((c) => {
      const icon = c.ok ? '✓' : '✗';
      console.log(`  ${icon} ${c.name}: ${c.detail}`);
      if (!c.ok) console.log(`    → ${c.fix}`);
    });
    console.log(status.allOk ? '\n✓ 所有依赖就绪，系统正常运行' : '\n✗ 存在缺失依赖，请按上述提示修复');
    console.log('================================\n');
  });
}

module.exports = { createApp, runChecks };
