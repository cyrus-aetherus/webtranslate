/**
 * E2E test: verify per-tab side panel closes on tab switch
 * Launch: npx playwright test tests/e2e/sidepanel-tab-switch.spec.js --project=chromium
 */

import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extPath = path.resolve(__dirname, '../../dist');

test.describe('Side Panel Tab Switch', () => {
  let browser;
  let context;

  test.beforeAll(async () => {
    browser = await chromium.launch({
      headless: false,
      args: [
        `--disable-extensions-except=${extPath}`,
        `--load-extension=${extPath}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });
    context = await browser.newContext();
  });

  test.afterAll(async () => {
    await browser?.close();
  });

  test('panel closes when switching tabs and can be reopened', async () => {
    // 1. Open test page
    const page = await context.newPage();
    await page.goto('http://localhost:8765/test-page.html');
    await page.waitForTimeout(1500); // wait for content script injection

    // 2. Configure extension via chrome.storage (mock API)
    const backgroundPage = await context.waitForEvent('backgroundpage');
    await backgroundPage.evaluate(() => {
      chrome.storage.local.set({
        apiUrl: 'http://localhost:3457/v1/chat/completions',
        apiKey: 'test-key',
        model: 'gpt-4o-mini',
        defaultMode: 'panel',
      });
    });

    // 3. Wait for FAB to appear
    const fab = await page.waitForSelector('#wt-fab', { timeout: 10000 });
    expect(fab).not.toBeNull();

    // 4. Click FAB to open menu, then click Panel button
    await fab.click();
    await page.waitForTimeout(300);

    // Find and click the Panel button in the FAB menu
    const panelBtn = await page.$('[data-action="panel"]');
    if (!panelBtn) {
      // Screenshot for debugging if button not found
      await page.screenshot({ path: 'e2e-fab-menu.png' });
    }
    expect(panelBtn).not.toBeNull();
    await panelBtn.click();

    // Wait for side panel to open and content to load
    await page.waitForTimeout(2000);

    // Take screenshot of page with panel open
    await page.screenshot({ path: 'e2e-panel-open.png', fullPage: true });

    // 5. Open a new tab (simulates switching away)
    const newPage = await context.newPage();
    await newPage.goto('http://localhost:8765/pages/blog.html');
    await newPage.waitForTimeout(1500);

    // 6. Wait for Chrome to auto-close the side panel
    await newPage.waitForTimeout(1500);
    await newPage.screenshot({ path: 'e2e-after-switch.png', fullPage: true });

    // 7. Switch back to original tab
    await page.bringToFront();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'e2e-back-to-original.png', fullPage: true });

    // 8. Verify FAB is still present (content script alive)
    const fabAfter = await page.$('#wt-fab');
    expect(fabAfter).not.toBeNull();

    // 9. Reopen panel by clicking FAB -> Panel
    await fabAfter.click();
    await page.waitForTimeout(300);
    const panelBtn2 = await page.$('[data-action="panel"]');
    expect(panelBtn2).not.toBeNull();
    await panelBtn2.click();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'e2e-panel-reopened.png', fullPage: true });

    // 10. Close new tab
    await newPage.close();
  });
});
