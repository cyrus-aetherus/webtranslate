/**
 * Mock LLM API server for integration testing
 * Simulates OpenAI-compatible chat completions endpoint
 * Supports controlled failures (timeout, 429, 401, malformed response)
 */

import http from 'http';

export class MockServer {
  constructor(port = 3456) {
    this.port = port;
    this.server = null;
    this.scenario = 'success';
    this.requestCount = 0;
  }

  start() {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => this._handle(req, res));
      this.server.listen(this.port, () => {
        console.log(`[MockServer] Listening on http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      this.server?.close(resolve);
    });
  }

  setScenario(name) {
    this.scenario = name;
  }

  _handle(req, res) {
    this.requestCount++;

    if (req.url !== '/v1/chat/completions') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    switch (this.scenario) {
      case 'success':
        this._success(res);
        break;
      case 'rateLimit':
        this._rateLimit(res);
        break;
      case 'authFail':
        this._authFail(res);
        break;
      case 'malformed':
        this._malformed(res);
        break;
      case 'timeout':
        // Never respond
        break;
      default:
        this._success(res);
    }
  }

  _success(res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{
        message: {
          content: '───SEP:abc───\nTranslated text\n───SEP:END───',
        },
      }],
    }));
  }

  _rateLimit(res) {
    res.writeHead(429, { 'Retry-After': '2', 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Rate limited' }));
  }

  _authFail(res) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
  }

  _malformed(res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // Missing END separator
    res.end(JSON.stringify({
      choices: [{
        message: {
          content: '───SEP:abc───\nTranslated text',
        },
      }],
    }));
  }
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new MockServer(3456);
  await server.start();
  console.log('[MockServer] Press Ctrl+C to stop');
}
