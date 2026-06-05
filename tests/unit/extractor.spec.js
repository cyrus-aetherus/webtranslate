/**
 * Unit tests for content/extractor — text-driven extraction
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractParagraphs,
  findContentRoots,
  getTranslatableText,
  generateParagraphId,
} from '../../src/content/extractor/index.js';

describe('findContentRoots', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns an array', () => {
    document.body.innerHTML = '<main><p>main</p></main>';
    const roots = findContentRoots();
    expect(Array.isArray(roots)).toBe(true);
    expect(roots.length).toBeGreaterThan(0);
  });

  it('prefers article over main as single root when only one exists', () => {
    document.body.innerHTML = '<main><p>main</p></main><article><p>article</p></article>';
    const roots = findContentRoots();
    expect(roots[0].tagName).toBe('ARTICLE');
  });

  it('merges sibling articles into their parent', () => {
    document.body.innerHTML = `
      <main>
        <article class="item"><p>A</p></article>
        <article class="item"><p>B</p></article>
        <article class="item"><p>C</p></article>
      </main>
    `;
    const roots = findContentRoots();
    expect(roots.length).toBe(1);
    expect(roots[0].tagName).toBe('MAIN');
  });

  it('falls back to body when no selectors match', () => {
    document.body.innerHTML = '<p>body</p>';
    const roots = findContentRoots();
    expect(roots.length).toBe(1);
    expect(roots[0].tagName).toBe('BODY');
  });
});

describe('getTranslatableText', () => {
  it('extracts plain text', () => {
    const p = document.createElement('p');
    p.textContent = 'Hello world';
    expect(getTranslatableText(p)).toBe('Hello world');
  });

  it('normalizes whitespace', () => {
    const p = document.createElement('p');
    p.innerHTML = 'Hello\n\n  world';
    expect(getTranslatableText(p)).toBe('Hello world');
  });
});

describe('extractParagraphs — text-driven', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('extracts p tags', () => {
    document.body.innerHTML = '<article><p>First</p><p>Second</p></article>';
    const result = extractParagraphs();
    expect(result.length).toBe(2);
    expect(result[0].textContent).toBe('First');
  });

  it('extracts any tag with enough direct text (text-driven)', () => {
    document.body.innerHTML = `
      <main>
        <div>This is a plain text block inside a div.</div>
      </main>
    `;
    const result = extractParagraphs();
    expect(result.length).toBe(1);
    expect(result[0].tagName).toBe('DIV');
    expect(result[0].textContent).toBe('This is a plain text block inside a div.');
  });

  it('extracts span with direct text', () => {
    document.body.innerHTML = `
      <main>
        <span>This span contains direct text that should be extracted.</span>
      </main>
    `;
    const result = extractParagraphs();
    expect(result.length).toBe(1);
    expect(result[0].tagName).toBe('SPAN');
  });

  it('extracts custom element with direct text', () => {
    document.body.innerHTML = `
      <main>
        <my-paragraph>This custom element has direct text content.</my-paragraph>
      </main>
    `;
    const result = extractParagraphs();
    expect(result.length).toBe(1);
    expect(result[0].tagName).toBe('MY-PARAGRAPH');
  });

  it('recurses into elements with semantic descendants instead of extracting parent', () => {
    document.body.innerHTML = `
      <main>
        <div class="prose">
          <p>Paragraph one</p>
          <p>Paragraph two</p>
        </div>
      </main>
    `;
    const result = extractParagraphs();
    expect(result.length).toBe(2);
    expect(result[0].tagName).toBe('P');
    expect(result[1].tagName).toBe('P');
  });

  it('recurses into elements with interactive descendants', () => {
    document.body.innerHTML = `
      <main>
        <div>
          <span>Username</span>
          <button>Follow</button>
        </div>
        <p>Real content paragraph.</p>
      </main>
    `;
    const result = extractParagraphs();
    const texts = result.map((el) => el.textContent);
    expect(texts).not.toContain('Username Follow');
    expect(texts).toContain('Real content paragraph.');
  });

  it('extracts parent when children have no semantic tags and no direct text', () => {
    document.body.innerHTML = `
      <main>
        <div>
          <span>Child one with some text.</span>
          <span>Child two with more text here.</span>
        </div>
      </main>
    `;
    const result = extractParagraphs();
    // div has no direct text, recurses to children
    // each span has direct text >= 15, extracted individually
    expect(result.length).toBe(2);
    expect(result[0].tagName).toBe('SPAN');
    expect(result[1].tagName).toBe('SPAN');
  });

  it('extracts parent div when it has direct text, skipping child spans', () => {
    document.body.innerHTML = `
      <main>
        <div>This div has direct text. <span>Child span text.</span></div>
      </main>
    `;
    const result = extractParagraphs();
    expect(result.length).toBe(1);
    expect(result[0].tagName).toBe('DIV');
  });

  it('excludes nav content', () => {
    document.body.innerHTML = `
      <main><p>Keep me</p></main>
      <nav><p>Ignore me</p></nav>
    `;
    const result = extractParagraphs();
    expect(result.length).toBe(1);
    expect(result[0].textContent).toBe('Keep me');
  });

  it('excludes code blocks', () => {
    document.body.innerHTML = '<main><pre><code>code</code></pre><p>text</p></main>';
    const result = extractParagraphs();
    expect(result.length).toBe(1);
    expect(result[0].textContent).toBe('text');
  });

  it('excludes long code blocks inside pre', () => {
    document.body.innerHTML = `
      <main>
        <pre><code>function hello() { return "world"; }</code></pre>
        <p>Real text to translate</p>
      </main>`;
    const result = extractParagraphs();
    expect(result.length).toBe(1);
    expect(result[0].textContent).toBe('Real text to translate');
  });

  it('excludes short text', () => {
    document.body.innerHTML = '<main><p>Hi</p><p>A longer paragraph here</p></main>';
    const result = extractParagraphs();
    expect(result.length).toBe(1);
    expect(result[0].textContent).toBe('A longer paragraph here');
  });

  it('excludes pure URLs', () => {
    document.body.innerHTML = '<main><p>https://example.com</p><p>Real text</p></main>';
    const result = extractParagraphs();
    expect(result.length).toBe(1);
    expect(result[0].textContent).toBe('Real text');
  });

  it('excludes short numbers', () => {
    document.body.innerHTML = '<main><p>42</p><p>Real text</p></main>';
    const result = extractParagraphs();
    expect(result.length).toBe(1);
  });

  it('extracts headings and list items', () => {
    document.body.innerHTML = `
      <main>
        <h1>Title</h1>
        <p>Body</p>
        <ul><li>Item 1</li><li>Item 2</li></ul>
      </main>
    `;
    const result = extractParagraphs();
    expect(result.length).toBe(4);
  });

  it('excludes ad-like containers by class name', () => {
    document.body.innerHTML = `
      <main><p>Keep me</p></main>
      <div class="sidebar-ad"><p>Ad text</p></div>
    `;
    const result = extractParagraphs();
    expect(result.length).toBe(1);
    expect(result[0].textContent).toBe('Keep me');
  });

  it('extracts all sibling articles when wrapped in a common parent', () => {
    document.body.innerHTML = `
      <main>
        <article class="box"><p>Project A desc</p></article>
        <article class="box"><p>Project B desc</p></article>
        <article class="box"><p>Project C desc</p></article>
      </main>
    `;
    const result = extractParagraphs();
    expect(result.length).toBe(3);
    const texts = result.map((el) => el.textContent);
    expect(texts).toContain('Project A desc');
    expect(texts).toContain('Project B desc');
    expect(texts).toContain('Project C desc');
  });
});

describe('generateParagraphId', () => {
  it('generates unique ids for sibling elements', () => {
    const parent = document.createElement('div');
    parent.innerHTML = '<p>a</p><p>b</p>';
    const ids = Array.from(parent.children).map(generateParagraphId);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('generates different ids for same-index elements in different parents', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <article><p>first</p></article>
      <article><p>second</p></article>
    `;
    const articles = container.querySelectorAll('article');
    const id1 = generateParagraphId(articles[0].querySelector('p'));
    const id2 = generateParagraphId(articles[1].querySelector('p'));
    expect(id1).not.toBe(id2);
  });
});
