const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

(async () => {
  const ext = path.resolve('dist').replace(/\\/g, '/');
  console.log('Ext path:', ext);

  const userDataDir = path.join(os.tmpdir(), 'wt-playwright-profile-' + Date.now());
  fs.mkdirSync(userDataDir, { recursive: true });

  // Pre-enable developer mode via Preferences
  const prefsPath = path.join(userDataDir, 'Default', 'Preferences');
  fs.mkdirSync(path.join(userDataDir, 'Default'), { recursive: true });
  const prefs = {
    extensions: {
      ui: {
        developer_mode: true
      }
    }
  };
  fs.writeFileSync(prefsPath, JSON.stringify(prefs));

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: [
      '--disable-extensions-except=' + ext,
      '--load-extension=' + ext,
      '--no-sandbox',
    ],
  });

  // Open extensions page
  const extPage = await context.newPage();
  await extPage.goto('chrome://extensions/');
  await extPage.waitForTimeout(2000);

  const extItems = await extPage.$$('extensions-item');
  console.log('Extension items found:', extItems.length);

  // Check for any extension names
  const names = await extPage.$$eval('extensions-item', items => items.map(i => i.getAttribute('name')));
  console.log('Extension names:', names);

  await extPage.screenshot({ path: 'e2e-screenshots/debug-extensions.png' });

  // Open test page
  const page = await context.newPage();
  await page.goto('http://localhost:8765/test-page.html');
  await page.waitForTimeout(4000);

  const fab = await page.$('#wt-fab');
  console.log('FAB found:', !!fab);
  const initialized = await page.evaluate(() => document.documentElement.dataset.wtInitialized);
  console.log('wtInitialized:', initialized);

  await page.screenshot({ path: 'e2e-screenshots/debug-launch.png' });

  await context.close();
})();
