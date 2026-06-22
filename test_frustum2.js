const http = require('http');
const options = {
  hostname: 'localhost',
  port: 5000,
  path: '/api/conversations/conv_1',
  method: 'GET'
};
const req = http.request(options, res => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    try {
      const conv = JSON.parse(body);
      const last = conv.messages[conv.messages.length - 1];
      const step3 = last.stepResults.find(s => s.id === 3);
      if (step3 && step3.drawingData) {
        const dd = step3.drawingData;
        console.log('=== planes ===', JSON.stringify(dd.planes, null, 2));
        console.log('=== functions ===', JSON.stringify(dd.functions, null, 2));
        console.log('=== isGeometry ===', step3.isGeometry);
      } else {
        console.log('No step3 or drawingData');
      }
    } catch (e) {
      console.error('Parse error:', e.message);
      console.log('Body (first 2000):', body.substring(0, 2000));
    }
  });
});
req.on('error', e => console.error('Error:', e.message));
req.end();