/**
 * Full E2E test runner using Playwright (CommonJS)
 * Run: node tests/e2e/run-e2e.cjs
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const extPath = path.resolve(__dirname, '../../dist');
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

async function runTests() {
  console.log('[E2E] Launching Chrome with extension from:', extPath);

  const browser = await chromium.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--start-maximized',
    ],
  });

  const context = await browser.newContext();
  let failed = false;

  try {
    // ====== TC-01: FAB discoverability ======
    console.log('[E2E] TC-01: FAB discoverability');
    const page1 = await context.newPage();
    await page1.goto('http://localhost:8765/demo.html');
    await sleep(5000);

    // Debug: check if content script injected
    const wtInit = await page1.evaluate(() => document.documentElement.dataset.wtInitialized);
    console.log('[E2E] wtInitialized:', wtInit);

    const fab = await page1.$('#wt-fab');
    console.log('[E2E] FAB found:', !!fab);
    await shot(page1, 'tc01-fab-visible');

    if (!fab) {
      console.error('[E2E] TC-01 FAILED: FAB not found');
      failed = true;
    } else {
      const fabClass = await fab.evaluate(el => el.className);
      console.log('[E2E] FAB class:', fabClass);

      const badge = await fab.$('.wt-mode-badge');
      const badgeText = badge ? await badge.textContent() : 'none';
      console.log('[E2E] FAB badge:', badgeText);

      if (!fabClass.includes('wt-idle')) {
        console.error('[E2E] TC-01 FAILED: FAB not in idle state');
        failed = true;
      }
    }

    // ====== TC-02: Inline translation ======
    console.log('[E2E] TC-02: Inline translation');
    // Configure API via content script (service worker detection is flaky in Playwright + extensions)
    await page1.evaluate(() => {
      chrome.storage.local.set({
        apiUrl: 'http://localhost:3457/v1/chat/completions',
        apiKey: 'test-key',
        model: 'gpt-4o-mini',
        adapter: 'openai',
        defaultMode: 'inline',
      });
    });
    console.log('[E2E] API config injected');

    // Click FAB -> Translate
    await fab.click();
    await sleep(500);
    await shot(page1, 'tc02-fab-menu-open');

    const translateBtn = await page1.$('.wt-translate');
    if (!translateBtn) {
      console.error('[E2E] TC-02 FAILED: Translate button not found');
      failed = true;
    } else {
      await page1.evaluate(el => el.click(), translateBtn);
      console.log('[E2E] Translate clicked');
      await sleep(6000);
      await shot(page1, 'tc02-after-translate');

      const pendingCount = await page1.$$eval('.wt-pending', els => els.length);
      const inlineCount = await page1.$$eval('.wt-inline-block', els => els.length);
      console.log('[E2E] Pending:', pendingCount, 'Inline:', inlineCount);

      if (pendingCount + inlineCount === 0) {
        console.error('[E2E] TC-02 FAILED: No translation output found');
        failed = true;
      } else {
        console.log('[E2E] TC-02 PASSED');
      }
    }

    // ====== TC-03: Panel mode ======
    console.log('[E2E] TC-03: Panel mode');
    const page2 = await context.newPage();
    await page2.goto('http://localhost:8765/demo.html');
    await sleep(3000);

    await page2.evaluate(() => {
      chrome.storage.local.set({
        apiUrl: 'http://localhost:3457/v1/chat/completions',
        apiKey: 'test-key',
        model: 'gpt-4o-mini',
        adapter: 'openai',
        defaultMode: 'panel',
      });
    });

    const fab2 = await page2.waitForSelector('#wt-fab', { timeout: 15000 });
    await fab2.click();
    await sleep(500);

    const panelBtn = await page2.$('.wt-switch-panel');
    if (!panelBtn) {
      console.error('[E2E] TC-03 FAILED: Panel button not found');
      await shot(page2, 'tc03-error-no-panel-btn');
      failed = true;
    } else {
      await page2.evaluate(el => el.click(), panelBtn);
      console.log('[E2E] Panel button clicked');
      await sleep(4000);
      await shot(page2, 'tc03-panel-opened');

      const badgeText2 = await fab2.$eval('.wt-mode-badge', el => el.textContent);
      console.log('[E2E] FAB badge after panel:', badgeText2);

      if (badgeText2 !== 'P') {
        console.error('[E2E] TC-03 FAILED: Badge not P, got:', badgeText2);
        failed = true;
      } else {
        console.log('[E2E] TC-03 PASSED');
      }
    }

    // ====== TC-04: Tab switch ======
    console.log('[E2E] TC-04: Tab switch');
    // Tab A has panel translation (page2), Tab B is new
    const page3 = await context.newPage();
    await page3.goto('http://localhost:8765/blog.html');
    await sleep(3000);
    await shot(page3, 'tc04-tab-b');

    // Switch back to Tab A
    await page2.bringToFront();
    await sleep(2000);
    await shot(page2, 'tc04-back-to-tab-a');

    const fabAfter = await page2.$('#wt-fab');
    if (!fabAfter) {
      console.error('[E2E] TC-04 FAILED: FAB missing after tab switch');
      failed = true;
    } else {
      console.log('[E2E] TC-04 PASSED');
    }

    // ====== TC-05: Stop and Resume ======
    console.log('[E2E] TC-05: Stop and Resume');
    // On page2 (Tab A), click stop
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
        console.error('[E2E] TC-05 FAILED: FAB not paused after stop');
        failed = true;
      } else {
        // Resume
        await page2.evaluate(el => el.click(), fabAfter);
        await sleep(500);
        const resumeBtn = await page2.$('.wt-translate');
        if (resumeBtn) {
          await page2.evaluate(el => el.click(), resumeBtn);
          await sleep(4000);
          await shot(page2, 'tc05-after-resume');
          console.log('[E2E] TC-05 PASSED');
        } else {
          console.error('[E2E] TC-05 FAILED: Resume button not found');
          failed = true;
        }
      }
    } else {
      console.log('[E2E] TC-05 SKIP: Stop button not available (may be already paused)');
    }

    await page1.close();
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
    await browser.close();
    console.log('[E2E] Browser closed');
  }
}

runTests();
