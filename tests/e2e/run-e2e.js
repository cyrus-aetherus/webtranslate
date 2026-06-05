/**
 * Standalone E2E test for side panel tab-switch behaviour.
 * Run: node tests/e2e/run-e2e.js
 */

import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extPath = path.resolve(__dirname, '../../dist');
const screenshotsDir = path.resolve(__dirname, '../../e2e-screenshots');

if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir);

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  console.log('[E2E] Launching Chrome with extension loaded from:', extPath);

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

  // Helper to screenshot
  const shot = async (name, page) => {
    const p = page || (await context.pages())[0];
    const fp = path.join(screenshotsDir, `${name}.png`);
    await p.screenshot({ path: fp, fullPage: true });
    console.log(`[E2E] Screenshot: ${fp}`);
  };

  try {
    // ====== STEP 1: Prime extension by opening a page first ======
    console.log('[E2E] STEP 1: Prime extension');
    const primePage = await context.newPage();
    await primePage.goto('http://localhost:8765/test-page.html');
    await sleep(3000);

    // ====== STEP 2: Configure extension via chrome.storage ======
    console.log('[E2E] STEP 2: Configure mock API via storage');
    // Get the MV3 service worker (may need longer timeout on first load)
    let sw = context.serviceWorkers()[0];
    if (!sw) {
      sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
    }
    await sw.evaluate(() => {
      chrome.storage.local.set({
        apiUrl: 'http://localhost:3457/v1/chat/completions',
        apiKey: 'test-key',
        model: 'gpt-4o-mini',
        defaultMode: 'panel',
      });
    });
    console.log('[E2E] API config injected');

    // ====== STEP 3: Wait for FAB and click ======
    console.log('[E2E] STEP 3: Wait for FAB');
    const fab = await page.waitForSelector('#wt-fab', { timeout: 15000 });
    console.log('[E2E] FAB found');
    await shot('02-fab-visible', page);

    // Click FAB to open menu
    await fab.click();
    await sleep(500);
    await shot('03-fab-menu-open', page);

    // Click Panel button
    const panelBtn = await page.$('[data-action="panel"]');
    if (!panelBtn) {
      console.error('[E2E] Panel button NOT found in FAB menu');
      await shot('03-error-no-panel-btn', page);
      throw new Error('Panel button not found');
    }
    console.log('[E2E] Panel button found, clicking...');
    await panelBtn.click();
    await sleep(3000);
    await shot('04-panel-opened', page);

    // ====== STEP 4: Check panel state via content script ======
    console.log('[E2E] STEP 4: Check content script state');
    const stateBefore = await page.evaluate(() => {
      // Expose state for inspection if available
      return {
        wtInitialized: document.documentElement.dataset.wtInitialized,
        hasFab: !!document.getElementById('wt-fab'),
      };
    });
    console.log('[E2E] State before switch:', stateBefore);

    // ====== STEP 5: Create new tab (simulate switching away) ======
    console.log('[E2E] STEP 5: Open new tab');
    const newPage = await context.newPage();
    await newPage.goto('http://localhost:8765/pages/blog.html');
    await sleep(2000);
    await shot('05-switched-to-new-tab', newPage);

    // The side panel should be auto-closed by Chrome now (per-tab enabled)
    console.log('[E2E] Side panel should be closed by Chrome (per-tab behaviour)');

    // ====== STEP 6: Switch back to original tab ======
    console.log('[E2E] STEP 6: Switch back to original tab');
    await page.bringToFront();
    await sleep(1500);
    await shot('06-back-to-original-tab', page);

    // ====== STEP 7: Verify FAB still present and reopen panel ======
    console.log('[E2E] STEP 7: Reopen panel');
    const fab2 = await page.$('#wt-fab');
    if (!fab2) {
      console.error('[E2E] FAB missing after switch back');
      throw new Error('FAB missing');
    }
    await fab2.click();
    await sleep(500);
    await shot('07-fab-menu-reopened', page);

    const panelBtn2 = await page.$('[data-action="panel"]');
    if (!panelBtn2) {
      console.error('[E2E] Panel button missing on reopen');
      await shot('07-error-no-panel-btn', page);
      throw new Error('Panel button missing on reopen');
    }
    await panelBtn2.click();
    await sleep(3000);
    await shot('08-panel-reopened', page);

    console.log('[E2E] ✅ All steps completed successfully');
  } catch (err) {
    console.error('[E2E] ❌ Test failed:', err.message);
    process.exitCode = 1;
  } finally {
    await sleep(1000);
    await browser.close();
    console.log('[E2E] Browser closed');
  }
}

run();
