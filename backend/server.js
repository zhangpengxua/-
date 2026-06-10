const express = require('express');
const cors = require('cors');
require('dotenv').config();

const conversationRoutes = require('./routes/conversations');
const pythonRoutes = require('./routes/python');

const app = express();
const PORT = process.env.PORT || 5000;

// 设置服务器超时时间为3分钟（180秒）
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

app.get('/', (req, res) => {
  res.json({ message: 'DeepSeek Chat API is running' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Server timeout: ${app.timeout / 1000} seconds`);
});
