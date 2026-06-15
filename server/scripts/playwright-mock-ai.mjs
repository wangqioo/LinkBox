import http from 'node:http';

const PORT = Number(process.env.PORT || 3320);
const ANSWER = '这是 Playwright mock AI 回答，基于测试资料生成。[资料1]';

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendStream(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  for (const token of ['这是 Playwright mock AI 回答，', '基于测试资料生成。[资料1]']) {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: token } }] })}\n\n`);
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/v1/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && req.url === '/v1/models') {
    sendJson(res, 200, { data: [{ id: 'playwright-mock-model' }] });
    return;
  }

  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    const body = await readBody(req);
    if (body.stream) {
      sendStream(res);
      return;
    }

    sendJson(res, 200, {
      choices: [{
        message: {
          content: ANSWER,
        },
      }],
    });
    return;
  }

  sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Playwright mock AI listening on http://127.0.0.1:${PORT}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
