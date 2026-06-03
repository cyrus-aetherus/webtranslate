/**
 * Unit tests for content/download-trigger.js
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateMarkdown, collectImageUrls, triggerDownload } from '../../src/content/download-trigger.js';

describe('generateMarkdown', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('converts simple HTML to Markdown', () => {
    document.body.innerHTML = '<article><p>Hello world</p></article>';
    const md = generateMarkdown();
    expect(md).toContain('Hello world');
  });

  it('converts headings', () => {
    document.body.innerHTML = '<article><h2>Title</h2></article>';
    const md = generateMarkdown();
    expect(md).toContain('## Title');
  });

  it('removes wt-translation elements', () => {
    document.body.innerHTML = `
      <article>
        <p>Original</p>
      </article>
    `;
    const md = generateMarkdown();
    expect(md).not.toContain('wt-translation');
  });
});

describe('collectImageUrls', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('collects img src attributes', () => {
    document.body.innerHTML = `
      <article>
        <img src="https://example.com/a.png">
        <img src="https://example.com/b.png">
      </article>
    `;
    const urls = collectImageUrls();
    expect(urls).toContain('https://example.com/a.png');
    expect(urls).toContain('https://example.com/b.png');
  });

  it('excludes data URLs', () => {
    document.body.innerHTML = `
      <article>
        <img src="data:image/png;base64,abc">
      </article>
    `;
    const urls = collectImageUrls();
    expect(urls.length).toBe(0);
  });

  it('deduplicates URLs', () => {
    document.body.innerHTML = `
      <article>
        <img src="https://example.com/x.png">
        <img src="https://example.com/x.png">
      </article>
    `;
    const urls = collectImageUrls();
    expect(urls.length).toBe(1);
  });
});

describe('triggerDownload', () => {
  it('sends DOWNLOAD message to SW', async () => {
    const sendMessage = vi.fn().mockResolvedValue();
    global.chrome = { runtime: { sendMessage } };

    await triggerDownload('My Page', '# Hello', ['https://ex.com/img.png']);

    expect(sendMessage).toHaveBeenCalled();
    const msg = sendMessage.mock.calls[0][0];
    expect(msg.type).toBe('DOWNLOAD');
    expect(msg.pageTitle).toBe('My Page');
    expect(msg.markdown).toBe('# Hello');
    expect(msg.imageUrls).toEqual(['https://ex.com/img.png']);
  });
});
