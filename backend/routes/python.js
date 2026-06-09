const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');

router.post('/execute', async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'No code provided' });
  }

  const pythonProcess = spawn('python', ['-c', code]);

  let output = '';
  let error = '';

  pythonProcess.stdout.on('data', (data) => {
    output += data.toString();
  });

  pythonProcess.stderr.on('data', (data) => {
    error += data.toString();
  });

  pythonProcess.on('close', (code) => {
    if (code === 0) {
      res.json({ success: true, output: output.trim() });
    } else {
      res.json({ success: false, error: error.trim(), output: output.trim() });
    }
  });

  pythonProcess.on('error', (err) => {
    res.status(500).json({ success: false, error: err.message });
  });
});

module.exports = router;
