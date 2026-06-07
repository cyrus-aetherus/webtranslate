const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const extensionPath = path.resolve('dist');

  const browser = await chromium.launchPersistentContext(
    path.join(process.env.TEMP || '/tmp', 'wt-e2e-chrome'),
    {
      headless: false,
      args: [
        '--disable-extensions-except=' + extensionPath,
        '--load-extension=' + extensionPath,
      ],
    }
  );

  console.log('Extension loaded');

  const page = await browser.newPage();
  await page.goto('https://arxiv.org/html/2605.06716v1', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  // Click FAB to expand menu
  const fab = page.locator('#wt-fab');
  if (await fab.isVisible()) {
    await fab.click();
    await page.waitForTimeout(800);

    // Click download
    const downloadBtn = page.locator('.wt-download .wt-mi-dot, .wt-download');
    if (await downloadBtn.first().isVisible()) {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        downloadBtn.first().click(),
      ]);

      const downloadPath = path.join(process.env.USERPROFILE || 'C:/Users/ZZP', 'Downloads', 'e2e-test-arxiv.zip');
      await download.saveAs(downloadPath);
      console.log('Downloaded to:', downloadPath);
      console.log('SUCCESS');
    } else {
      console.log('Download button not found');
      // Debug: take screenshot
      await page.screenshot({ path: 'e2e-debug.png' });
    }
  } else {
    console.log('FAB not found');
  }

  await browser.close();
  console.log('Done');
})().catch(e => { console.error(e.message); process.exit(1); });
