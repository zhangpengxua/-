const http = require('http');
const options = {
  hostname: 'localhost', port: 5000,
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
        console.log('lines:', JSON.stringify(dd.lines));
        console.log('points:', JSON.stringify(dd.points));
      }
    } catch (e) {
      console.error('Error:', e.message);
    }
  });
});
req.on('error', e => console.error('Error:', e.message));
req.end();