import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  copyFileSync, mkdirSync, existsSync, readdirSync,
  readFileSync, writeFileSync, rmdirSync, statSync, unlinkSync,
} from 'fs';

function rmSync(p) {
  if (!existsSync(p)) return;
  for (const entry of readdirSync(p)) {
    const full = resolve(p, entry);
    if (statSync(full).isDirectory()) rmSync(full);
    else unlinkSync(full);
  }
  rmdirSync(p);
}

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/sw.js'),
        panel:      resolve(__dirname, 'src/panel/panel.html'),
        popup:      resolve(__dirname, 'src/popup/popup.html'),
        // content built separately as IIFE via Rollup API in postbuild
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (/\.css$/i.test(assetInfo.name ?? '')) return 'assets/[name][extname]';
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  plugins: [
    {
      name: 'chrome-extension-postbuild',
      async closeBundle() {
        const dist = resolve(__dirname, 'dist');

        // ---- Build content.js as IIFE via Rollup --------------------
        // MV3 content_scripts do NOT support type="module".
        // We use Rollup directly with node-resolve + commonjs so that
        // all deps (DOMPurify, turndown, shared utils, etc.) are bundled
        // into a single self-executing IIFE.
        const { rollup } = await import('rollup');
        const resolvePlugin = (await import('@rollup/plugin-node-resolve')).default;
        const commonjsPlugin = (await import('@rollup/plugin-commonjs')).default;

        const contentBundle = await rollup({
          input: resolve(__dirname, 'src/content/content.js'),
          plugins: [
            resolvePlugin({ browser: true }),
            commonjsPlugin(),
          ],
        });
        await contentBundle.write({
          format: 'iife',
          name: 'WebTranslate',
          file: resolve(dist, 'content.js'),
        });
        await contentBundle.close();
        console.log('[postbuild] content.js built as IIFE via Rollup');

        // ---- Strip modulepreload import from SW/popup/panel JS -------
        for (const name of ['background.js', 'panel.js', 'popup.js']) {
          const p = resolve(dist, name);
          if (existsSync(p)) {
            let code = readFileSync(p, 'utf-8');
            code = code.replace(/^import\s*"[^"]*modulepreload[^"]*"\s*;?\s*\n?/gm, '');
            writeFileSync(p, code, 'utf-8');
          }
        }
        // Remove modulepreload chunk
        const chunkDir = resolve(dist, 'chunks');
        if (existsSync(chunkDir)) {
          for (const f of readdirSync(chunkDir)) {
            if (f.startsWith('modulepreload-polyfill')) unlinkSync(resolve(chunkDir, f));
          }
        }

        // ---- Copy assets & CSS & locales ----------------------------
        const copyDir = (src, dst) => {
          if (existsSync(src)) {
            mkdirSync(dst, { recursive: true });
            for (const f of readdirSync(src)) copyFileSync(resolve(src, f), resolve(dst, f));
          }
        };
        copyDir(resolve(__dirname, 'src/assets/icons'), resolve(dist, 'assets/icons'));

        const cssSrc = resolve(__dirname, 'src/content/styles/content.css');
        if (existsSync(cssSrc)) copyFileSync(cssSrc, resolve(dist, 'content.css'));

        // ---- Flatten HTML -------------------------------------------
        const srcDir = resolve(dist, 'src');
        for (const page of ['panel', 'popup']) {
          const srcHtml = resolve(srcDir, `${page}/${page}.html`);
          if (existsSync(srcHtml)) {
            let html = readFileSync(srcHtml, 'utf-8');
            html = html.replace(/(src|href)="\.\.\/\.\.\//g, '$1="./');
            writeFileSync(resolve(dist, `${page}.html`), html, 'utf-8');
          }
        }
        if (existsSync(srcDir)) rmSync(srcDir);

        // ---- Copy locales (after rmSync) ----------------------------
        // Must come AFTER the HTML flattening because rmSync(srcDir)
        // deletes the entire dist/src tree.
        copyDir(resolve(__dirname, 'src/shared/locales'), resolve(dist, 'src/shared/locales'));

        // ---- Generate dist manifest ---------------------------------
        writeFileSync(resolve(dist, 'manifest.json'), JSON.stringify({
          manifest_version: 3,
          name: 'WebTranslate',
          version: '1.0.0',
          description: 'LLM-powered webpage translation & download',
          minimum_chrome_version: '114',
          permissions: ['activeTab', 'storage', 'downloads', 'scripting', 'sidePanel'],
          host_permissions: ['<all_urls>'],
          background: { service_worker: 'background.js', type: 'module' },
          side_panel: { default_path: 'panel.html' },
          action: {
            default_popup: 'popup.html',
            default_icon: { '16': 'assets/icons/icon16.png', '32': 'assets/icons/icon32.png' },
          },
          icons: {
            '16': 'assets/icons/icon16.png', '32': 'assets/icons/icon32.png',
            '48': 'assets/icons/icon48.png', '128': 'assets/icons/icon128.png',
          },
          content_scripts: [{
            matches: ['http://*/*', 'https://*/*'],
            js: ['content.js'],
            css: ['content.css'],
            run_at: 'document_end',
            all_frames: false,
          }],
          web_accessible_resources: [{
            resources: ['assets/*', 'src/shared/locales/*'],
            matches: ['<all_urls>'],
          }],
        }, null, 2) + '\n', 'utf-8');

        console.log('[postbuild] dist ready');
      },
    },
  ],
});
