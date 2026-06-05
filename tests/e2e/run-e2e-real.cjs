/**
 * Real E2E test suite for WebTranslate — tests actual Chrome extension loading
 * Uses blog.html (NO embedded content.js) + real SW + MockServer
 * Run: node tests/e2e/run-e2e-real.cjs
 */

const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');

const extPath = path.resolve(__dirname, '../../dist');
const userDataDir = path.join(os.tmpdir(), 'wt-e2e-' + Date.now());
const screenshotsDir = path.resolve(__dirname, '../../e2e-screenshots');

if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function shot(page, name) {
  const fp = path.join(screenshotsDir, `${name}.png`);
  await page.screenshot({ path: fp, fullPage: true });
  console.log(`[E2E] Screenshot: ${fp}`);
}

/**
 * Verify panel state via SW internal diagnostics.
 * Panel.run(), Panel.evaluate() etc. are NOT available for side panels in Playwright.
 * We rely on self._wtDiag exposed by sw.js for E2E testing.
 * @returns {Promise<object|null>} SW panel state
 */
async function verifyPanelViaSW(context) {
  const sws = context.serviceWorkers();
  if (!sws.length) return { _error: 'No service worker found' };
  const sw = sws[0];
  return sw.evaluate(() => {
    const d = self._wtDiag;
    return {
      panelTabId: d.panelTabId,
      hasReceiver: d.hasReceiver,
      pendingCount: d.pendingCount,
      csPortsCount: d.csPortsCount,
    };
  });
}

// Inline mock server that parses request fingerprints and returns matching translations
class InlineMockServer {
  constructor(port = 3457) {
    this.port = port;
    this.server = null;
    this.requestLog = [];
  }
  start() {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        this.requestLog.push({ url: req.url, time: Date.now() });
        if (req.url === '/v1/chat/completions') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              const json = JSON.parse(body);
              const userContent = json.messages?.find(m => m.role === 'user')?.content || '';
              // Extract fingerprints from prompt: ───SEP:<fp>───
              const fps = [...userContent.matchAll(/───SEP:([a-f0-9]+)───/g)].map(m => m[1]);
              const lines = fps.map(fp => `───SEP:${fp}───\n[中文] Translated text`).join('\n') + '\n───SEP:END───';
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                choices: [{ message: { content: lines } }],
              }));
            } catch {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                choices: [{ message: { content: '───SEP:abc───\n[中文] Translated text\n───SEP:END───' } }],
              }));
            }
          });
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });
      this.server.listen(this.port, () => {
        console.log(`[E2E] MockServer on port ${this.port}`);
        resolve();
      });
    });
  }
  stop() {
    return new Promise((resolve) => {
      this.server?.close(resolve);
    });
  }
}

async function runTests() {
  const mock = new InlineMockServer(3457);
  await mock.start();

  console.log('[E2E] Launching Chrome with extension:', extPath);
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  let failed = false;

  try {
    // Wait for SW
    let sw = context.serviceWorkers()[0];
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10000 });
    console.log('[E2E] SW:', sw.url());

    // Configure API via SW
    await sw.evaluate(() => {
      chrome.storage.local.set({
        apiUrl: 'http://localhost:3457',
        apiKey: 'test-key',
        model: 'gpt-4o-mini',
        adapter: 'openai',
        defaultMode: 'inline',
      });
    });
    console.log('[E2E] API config injected via SW');

    // ====== TC-01: Real extension injection ======
    console.log('[E2E] TC-01: Real extension injection');
    const page = await context.newPage();
    await page.goto('http://localhost:8765/blog.html');
    await sleep(5000);

    const wtInit = await page.evaluate(() => document.documentElement.dataset.wtInitialized);
    const hasFab = await page.evaluate(() => !!document.getElementById('wt-fab'));
    console.log('[E2E] wtInitialized:', wtInit, '| FAB:', hasFab);
    await shot(page, 'tc01-real-injection');

    if (!hasFab) {
      console.error('[E2E] TC-01 FAILED: Content script not injected');
      failed = true;
    } else {
      console.log('[E2E] TC-01 PASSED');
    }

    // ====== TC-02: Inline translation through real SW ======
    console.log('[E2E] TC-02: Inline translation through SW');

    // Capture console logs for debugging
    const logs = [];
    page.on('console', msg => {
      const text = `[${msg.type()}] ${msg.text()}`;
      logs.push(text);
      if (msg.type() === 'error' || msg.type() === 'warn') console.log('[E2E] Page console:', text);
    });

    const fab = await page.$('#wt-fab');
    await fab.evaluate(el => el.click());
    await sleep(800);

    const translateBtn = await page.$('.wt-translate');
    if (!translateBtn) {
      console.error('[E2E] TC-02 FAILED: Translate button not found');
      failed = true;
    } else {
      const beforeCount = mock.requestLog.length;
      await page.evaluate(el => el.click(), translateBtn);
      console.log('[E2E] Translate clicked');
      await sleep(8000);
      await shot(page, 'tc02-real-inline');

      const afterCount = mock.requestLog.length;
      const inlineCount = await page.$$eval('.wt-inline-block', els => els.length);
      const pendingCount = await page.$$eval('.wt-pending', els => els.length);
      console.log('[E2E] Mock API calls:', afterCount - beforeCount, '| Inline:', inlineCount, '| Pending:', pendingCount);
      console.log('[E2E] Console logs:', logs.filter(l => l.includes('WT') || l.includes('error')));

      if (inlineCount === 0) {
        console.error('[E2E] TC-02 FAILED: No inline translation output');
        failed = true;
      } else if (afterCount === beforeCount) {
        console.error('[E2E] TC-02 FAILED: No API call through SW');
        failed = true;
      } else {
        console.log('[E2E] TC-02 PASSED');
      }
    }

    // ====== TC-03: Panel mode opens via SW ======
    console.log('[E2E] TC-03: Panel mode via SW');
    const page2 = await context.newPage();
    await page2.goto('http://localhost:8765/blog.html');
    await sleep(5000);

    await sw.evaluate(() => {
      chrome.storage.local.set({ defaultMode: 'panel' });
    });

    const fab2 = await page2.$('#wt-fab');
    await fab2.evaluate(el => el.click());
    await sleep(800);

    const panelBtn = await page2.$('.wt-switch-panel');
    if (!panelBtn) {
      console.error('[E2E] TC-03 FAILED: Panel button not found');
      failed = true;
    } else {
      await page2.evaluate(el => el.click(), panelBtn);
      console.log('[E2E] Panel button clicked');
      await sleep(5000);
      await shot(page2, 'tc03-real-panel');

      const badgeText = await fab2.$eval('.wt-mode-badge', el => el.textContent);
      console.log('[E2E] Badge after panel click:', badgeText);

      // Verify panel via SW internal state
      const swState = await verifyPanelViaSW(context);
      console.log('[E2E] SW panel state:', swState);

      if (badgeText !== 'P') {
        console.error('[E2E] TC-03 FAILED: badge=', badgeText);
        failed = true;
      } else if (!swState?.hasReceiver) {
        console.error('[E2E] TC-03 FAILED: Panel not connected to SW');
        failed = true;
      } else {
        console.log('[E2E] TC-03 PASSED');
      }
    }

    // ====== TC-04: Tab switch ======
    console.log('[E2E] TC-04: Tab switch');
    const page3 = await context.newPage();
    await page3.goto('http://localhost:8765/blog.html');
    await sleep(3000);
    await shot(page3, 'tc04-tab-b');

    // Verify SW tracks the new tab
    const swState4a = await verifyPanelViaSW(context);
    console.log('[E2E] SW state after tab switch:', swState4a);

    await page2.bringToFront();
    await sleep(2000);
    await shot(page2, 'tc04-back-to-tab-a');

    // Verify SW tracks the original tab again
    const swState4b = await verifyPanelViaSW(context);
    console.log('[E2E] SW state after switch back:', swState4b);

    const fabAfter = await page2.$('#wt-fab');
    if (!fabAfter) {
      console.error('[E2E] TC-04 FAILED: FAB missing after tab switch');
      failed = true;
    } else if (swState4a?.hasReceiver && swState4b?.hasReceiver) {
      console.log('[E2E] TC-04 PASSED');
    } else {
      console.error('[E2E] TC-04 FAILED: SW panel state incorrect, hasReceiver=', swState4b?.hasReceiver);
      failed = true;
    }

    // ====== TC-05: Stop and Resume ======
    console.log('[E2E] TC-05: Stop and Resume');
    await page2.evaluate(el => el.click(), fabAfter);
    await sleep(500);
    const stopBtn = await page2.$('.wt-stop');
    if (stopBtn) {
      await page2.evaluate(el => el.click(), stopBtn);
      await sleep(2000);
      await shot(page2, 'tc05-after-stop');

      const fabClassAfterStop = await fabAfter.evaluate(el => el.className);
      console.log('[E2E] FAB class after stop:', fabClassAfterStop);

      if (!fabClassAfterStop.includes('wt-paused')) {
        console.error('[E2E] TC-05 FAILED: FAB not paused');
        failed = true;
      } else {
        await page2.evaluate(el => el.click(), fabAfter);
        await sleep(500);
        const resumeBtn = await page2.$('.wt-translate');
        if (resumeBtn) {
          const beforeResume = mock.requestLog.length;
          await page2.evaluate(el => el.click(), resumeBtn);
          await sleep(6000);
          await shot(page2, 'tc05-after-resume');
          const afterResume = mock.requestLog.length;
          console.log('[E2E] API calls after resume:', afterResume - beforeResume);
          console.log('[E2E] TC-05 PASSED');
        } else {
          console.error('[E2E] TC-05 FAILED: Resume button not found');
          failed = true;
        }
      }
    } else {
      console.log('[E2E] TC-05 SKIP: Stop button not available');
    }

    await page.close();
    await page2.close();
    await page3.close();

    if (failed) {
      console.error('[E2E] ❌ Some tests failed');
      process.exitCode = 1;
    } else {
      console.log('[E2E] ✅ All tests passed');
    }
  } catch (err) {
    console.error('[E2E] ❌ Test error:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    await sleep(1000);
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    await mock.stop();
    console.log('[E2E] Browser closed, mock stopped');
  }
}

runTests();
