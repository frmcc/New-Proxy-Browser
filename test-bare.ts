import http from 'http';

const options = {
  hostname: '127.0.0.1',
  port: 3000,
  path: '/bare/v3/',
  method: 'GET',
  headers: {
    'x-bare-url': 'https://www.google.com/',
    'x-bare-protocol': 'https:',
    'x-bare-port': '443',
    'x-bare-host': 'www.google.com',
    'x-bare-path': '/',
    'x-bare-headers': '{}'
  }
};

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  let body = '';
  res.on('data', (chunk) => {
    body += chunk;
  });
  res.on('end', () => {
    console.log(`BODY: ${body.length} bytes`);
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.end();
