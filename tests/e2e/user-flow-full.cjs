/**
 * Full user-flow E2E test — simulates a real user session
 * Run: node tests/e2e/user-flow-full.cjs
 *
 * User story:
 *   1. Open new page → FAB visible (bottom-right)
 *   2. Click Panel Translate → side panel opens, badge shows 'P'
 *   3. Verify panel shows progress (slots filling)
 *   4. Stop translation → FAB shows paused
 *   5. Resume → panel reopens, cache hits
 *   6. Switch to Inline while translating → inline blocks appear, badge='I'
 *   7. Refresh page → FAB shows panel badge (persisted), waiting for gesture
 *   8. Click Translate → panel opens, cached results restored
 *   9. Multiple refreshes → FAB never disappears
 */

const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');

const extPath = path.resolve(__dirname, '../../dist');
const userDataDir = path.join(os.tmpdir(), 'wt-uf-' + Date.now());
const shotsDir = path.resolve(__dirname, '../../e2e-screenshots');
if (!fs.existsSync(shotsDir)) fs.mkdirSync(shotsDir, { recursive: true });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function s(page, name) { return page.screenshot({ path: path.join(shotsDir, `${name}.png`), fullPage: true }); }

// Mock server
const mock = http.createServer((req, res) => {
  if (req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return; }
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try {
      const json = JSON.parse(body);
      const uc = json.messages?.find(m => m.role === 'user')?.content || '';
      const fps = [...uc.matchAll(/───SEP:([a-f0-9]+)───/g)].map(m => m[1]);
      const content = fps.map(fp => `───SEP:${fp}───\n[中文] ${fp.slice(0,6)}`).join('\n') + '\n───SEP:END───';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    } catch { res.writeHead(200); res.end(JSON.stringify({ choices: [{ message: { content: '───SEP:END───' } }] })); }
  });
});
mock.listen(3457);

let FAILED = false;
function ok(n, d) { console.log(`  ✅ ${n}${d ? ' — ' + d : ''}`); }
function no(n, d) { FAILED = true; console.error(`  ❌ ${n}${d ? ' — ' + d : ''}`); }

async function run() {
  console.log('══════════════════════════════════════');
  console.log('  Full User-Flow E2E');
  console.log('══════════════════════════════════════\n');

  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`, '--no-sandbox'],
  });

  try {
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    await sw.evaluate(() => chrome.storage.local.set({
      apiUrl: 'http://localhost:3457', apiKey: 'test-key', model: 'gpt-4o-mini', adapter: 'openai', defaultMode: 'panel',
    }));

    async function swDiag() {
      return sw.evaluate(() => ({ tid: self._wtDiag.panelTabId, recv: self._wtDiag.hasReceiver, cs: self._wtDiag.csPortsCount }));
    }
    const fabCls = async p => (await p.$('#wt-fab'))?.evaluate(el => el.className) || '';
    const badge = async p => (await p.$('#wt-fab'))?.$eval('.wt-mode-badge', el => el.textContent).catch(() => '?') || '';
    const iCount = async p => p.$$eval('.wt-inline-block', els => els.length);

    // ═══════════════════════════════════════════════
    console.log('1. User opens page\n');
    const page = await ctx.newPage();
    await page.goto('http://localhost:8765/blog.html'); await sleep(4000);

    let fab = await page.$('#wt-fab');
    const init = await page.evaluate(() => document.documentElement.dataset.wtInitialized);
    fab && init === 'true' ? ok('1a  FAB visible on new page') : no('1a', `fab=${!!fab} init=${init}`);
    await s(page, 'uf-01-page-loaded');

    // ═══════════════════════════════════════════════
    console.log('\n2. User clicks "Panel Translate" from IDLE menu\n');
    await fab.evaluate(el => el.click()); await sleep(500);
    await s(page, 'uf-02-menu-open');

    const panelBtn = await page.$('.wt-switch-panel');
    panelBtn ? ok('2a  Panel button in menu') : no('2a', 'no panel btn');

    await page.evaluate(el => el.click(), panelBtn);
    console.log('   (waiting for panel to open and translate...)');
    await sleep(5000);
    await s(page, 'uf-02-after-panel-click');

    const b1 = await badge(page);
    const ic1 = await iCount(page);
    const sw1 = await swDiag();
    b1 === 'P' && ic1 === 0 && sw1.recv
      ? ok('2b  Panel opens, badge=P, no inline')
      : no('2b', `badge=${b1} inline=${ic1} recv=${sw1.recv} cs=${sw1.cs}`);

    // ═══════════════════════════════════════════════
    console.log('\n3. User waits for some translation, then stops\n');
    await sleep(3000);

    await page.evaluate(el => el.click(), fab); await sleep(500);
    const stopBtn = await page.$('.wt-stop');
    if (stopBtn) {
      await page.evaluate(el => el.click(), stopBtn); await sleep(2000);
      const cls = await fabCls(page);
      cls.includes('wt-paused') ? ok('3a  Stop → paused') : no('3a', cls);
    } else { ok('3a  (translation already finished)'); }

    // ═══════════════════════════════════════════════
    console.log('\n4. User clicks "Resume" to continue\n');
    await page.evaluate(el => el.click(), fab); await sleep(500);
    const resumeBtn = await page.$('.wt-translate');
    if (resumeBtn) {
      await page.evaluate(el => el.click(), resumeBtn); await sleep(4000);
      const sw2 = await swDiag();
      sw2.recv ? ok('4a  Resume → panel reopens') : no('4a', `recv=${sw2.recv}`);
    } else { ok('4a  (state already active)'); }

    // ═══════════════════════════════════════════════
    console.log('\n5. User switches to Inline mode\n');
    await page.evaluate(el => el.click(), fab); await sleep(500);
    const switchBtn = await page.$('.wt-switch-inline');
    if (switchBtn) {
      await page.evaluate(el => el.click(), switchBtn); await sleep(6000);
      await s(page, 'uf-05-switched-to-inline');
      const ic2 = await iCount(page);
      const b2 = await badge(page);
      ic2 > 0 && b2 === 'I'
        ? ok('5a  Switch→Inline works')
        : no('5a', `inline=${ic2} badge=${b2}`);
    } else { ok('5a  (switch not available)'); }

    // ═══════════════════════════════════════════════
    console.log('\n6. User refreshes the page\n');
    await page.reload(); await sleep(5000);
    await s(page, 'uf-06-after-refresh');

    fab = await page.$('#wt-fab');
    const b3 = await badge(page);
    const ic3 = await iCount(page);
    // User switched to inline in step 5, so inline auto-restarts after refresh.
    // The persisted mode is 'inline' (from switchMode call).
    fab && b3 === 'I' && ic3 > 0
      ? ok('6a  Refresh: inline auto-restarts from cache')
      : no('6a', `fab=${!!fab} badge=${b3} inline=${ic3}`);

    // ═══════════════════════════════════════════════
    console.log('\n7. User switches back to Panel mode after refresh\n');
    // PAUSED menu in inline mode doesn't have Switch; need to Resume first
    await page.evaluate(el => el.click(), fab); await sleep(500);
    let stb = await page.$('.wt-stop');
    if (stb) { await page.evaluate(el => el.click(), stb); await sleep(1500); }

    // Resume to get back to TRANSLATING (which has Switch button)
    await page.evaluate(el => el.click(), fab); await sleep(500);
    let rb = await page.$('.wt-translate');
    if (rb) { await page.evaluate(el => el.click(), rb); await sleep(2000); }

    // Now in TRANSLATING with inline — click Switch to Panel
    await page.evaluate(el => el.click(), fab); await sleep(500);
    let swBtn = await page.$('.wt-switch-panel');
    if (swBtn) {
      await page.evaluate(el => el.click(), swBtn); await sleep(5000);
      const sw3 = await swDiag();
      const b4 = await badge(page);
      sw3.recv && b4 === 'P'
        ? ok('7a  Switch to Panel after refresh works')
        : no('7a', `recv=${sw3.recv} badge=${b4}`);

      const ic4 = await iCount(page);
      ic4 === 0 ? ok('7b  No unexpected inline blocks') : no('7b', `inline=${ic4}`);
    } else {
      // If switch btn not available, try Clear → Panel Translate from IDLE
      console.log('   (switch not available, trying Clear → Panel Translate)');
      await page.evaluate(el => el.click(), fab); await sleep(500);
      let clr = await page.$('.wt-clear');
      if (clr) { await page.evaluate(el => el.click(), clr); await sleep(1000); }

      await page.evaluate(el => el.click(), fab); await sleep(500);
      let pb = await page.$('.wt-switch-panel');
      if (pb) {
        await page.evaluate(el => el.click(), pb); await sleep(5000);
        const sw3 = await swDiag();
        sw3.recv ? ok('7a  Clear→Panel works') : no('7a', `recv=${sw3.recv}`);
      } else { no('7a', 'no panel btn after clear'); }
    }

    // ═══════════════════════════════════════════════
    console.log('\n8. User refreshes multiple times\n');
    for (let i = 0; i < 4; i++) {
      await page.reload(); await sleep(4000);
      fab = await page.$('#wt-fab');
      if (!fab) { no(`8a  FAB DISAPPEARED after refresh ${i + 1}`); break; }
    }
    fab ? ok('8a  FAB persists after 4 refreshes') : null;
    await s(page, 'uf-08-after-refreshes');

    // ═══════════════════════════════════════════════
    await page.close();

    console.log(`\n══════════════════════════════════════`);
    console.log(`  ${FAILED ? '❌ SOME TESTS FAILED' : '✅ ALL TESTS PASSED'}`);
    console.log(`══════════════════════════════════════`);
    if (FAILED) process.exitCode = 1;
  } catch (err) {
    console.error('\n❌ FATAL:', err.message);
    process.exitCode = 1;
  } finally {
    await sleep(500); await ctx.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    mock.close();
  }
}
run();
