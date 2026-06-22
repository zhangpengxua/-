const http = require('http');
const data = JSON.stringify({ content: '一个圆台，下底半径2，上底半径1，高3，求体积' });
const options = {
  hostname: 'localhost',
  port: 5000,
  path: '/api/conversations/conv_1/message',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
};
const req = http.request(options, res => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('Response:', body.substring(0, 1000));
  });
});
req.on('error', e => console.error('Error:', e.message));
req.write(data);
req.end();