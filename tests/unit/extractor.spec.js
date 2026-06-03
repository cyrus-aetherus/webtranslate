/**
 * Unit tests for content/extractor.js
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractParagraphs,
  findContentRoot,
  getTranslatableText,
  generateParagraphId,
} from '../../src/content/extractor.js';

describe('findContentRoot', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('prefers article over main', () => {
    document.body.innerHTML = '<main><p>main</p></main><article><p>article</p></article>';
    expect(findContentRoot().tagName).toBe('ARTICLE');
  });

  it('falls back to main', () => {
    document.body.innerHTML = '<main><p>main</p></main>';
    expect(findContentRoot().tagName).toBe('MAIN');
  });

  it('falls back to body', () => {
    document.body.innerHTML = '<p>body</p>';
    expect(findContentRoot().tagName).toBe('BODY');
  });
});

describe('getTranslatableText', () => {
  it('extracts plain text', () => {
    const p = document.createElement('p');
    p.textContent = 'Hello world';
    expect(getTranslatableText(p)).toBe('Hello world');
  });

  it('strips images', () => {
    const p = document.createElement('p');
    p.innerHTML = 'See <img src="a.png"> this';
    expect(getTranslatableText(p)).toBe('See this');
  });

  it('normalizes whitespace', () => {
    const p = document.createElement('p');
    p.innerHTML = 'Hello\n\n  world';
    expect(getTranslatableText(p)).toBe('Hello world');
  });
});

describe('extractParagraphs', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('extracts p tags', () => {
    document.body.innerHTML = '<article><p>First</p><p>Second</p></article>';
    const result = extractParagraphs();
    expect(result.length).toBe(2);
    expect(result[0].textContent).toBe('First');
  });

  it('excludes nav content', () => {
    document.body.innerHTML = `
      <article><p>Keep me</p></article>
      <nav><p>Ignore me</p></nav>
    `;
    const result = extractParagraphs();
    expect(result.length).toBe(1);
    expect(result[0].textContent).toBe('Keep me');
  });

  it('excludes code blocks', () => {
    document.body.innerHTML = '<article><pre><code>code</code></pre><p>text</p></article>';
    const result = extractParagraphs();
    expect(result.length).toBe(1);
    expect(result[0].textContent).toBe('text');
  });

  it('excludes short text', () => {
    document.body.innerHTML = '<article><p>Hi</p><p>A longer paragraph here</p></article>';
    const result = extractParagraphs();
    expect(result.length).toBe(1);
    expect(result[0].textContent).toBe('A longer paragraph here');
  });

  it('excludes pure URLs', () => {
    document.body.innerHTML = '<article><p>https://example.com</p><p>Real text</p></article>';
    const result = extractParagraphs();
    expect(result.length).toBe(1);
    expect(result[0].textContent).toBe('Real text');
  });

  it('excludes short numbers', () => {
    document.body.innerHTML = '<article><p>42</p><p>Real text</p></article>';
    const result = extractParagraphs();
    expect(result.length).toBe(1);
  });

  it('extracts headings and list items', () => {
    document.body.innerHTML = `
      <article>
        <h1>Title</h1>
        <p>Body</p>
        <ul><li>Item 1</li><li>Item 2</li></ul>
      </article>
    `;
    const result = extractParagraphs();
    expect(result.length).toBe(4);
  });
});

describe('generateParagraphId', () => {
  it('includes tag name and index', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>a</p><p>b</p>';
    const ids = Array.from(div.children).map(generateParagraphId);
    expect(ids[0]).toMatch(/^wt_p_\d+$/);
    expect(ids[1]).toMatch(/^wt_p_\d+$/);
  });
});
