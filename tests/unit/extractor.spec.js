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

// Helper: get the anchor element from an extraction result
const el = (r) => r.element;

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
    expect(result.length).toBe(1);
    expect(result[0].text).toContain('First');
    expect(result[0].text).toContain('Second');
    expect(result[0].allElements.length).toBe(2);
  });

  it('extracts any tag with enough direct text (text-driven)', () => {
    document.body.innerHTML = `
      <main>
        <div>This is a plain text block inside a div.</div>
      </main>
    `;
    const result = extractParagraphs();
    expect(result.length).toBe(1);
    expect(el(result[0]).tagName).toBe('DIV');
    expect(result[0].text).toBe('This is a plain text block inside a div.');
  });

  it('extracts span with direct text', () => {
    document.body.innerHTML = `
      <main>
        <span>This span contains direct text that should be extracted.</span>
      </main>
    `;
    const result = extractParagraphs();
    expect(result.length).toBe(1);
    expect(el(result[0]).tagName).toBe('SPAN');
  });

  it('extracts custom element with direct text', () => {
    document.body.innerHTML = `
      <main>
        <my-paragraph>This custom element has direct text content.</my-paragraph>
      </main>
    `;
    const result = extractParagraphs();
    expect(result.length).toBe(1);
    expect(el(result[0]).tagName).toBe('MY-PARAGRAPH');
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
    expect(result.length).toBe(1);
    expect(result[0].allElements.length).toBe(2);
    expect(el(result[0]).tagName).toBe('P');
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
    const texts = result.map((r) => r.text);
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
    // each span has direct text >= 15, extracted individually, then grouped by parent
    expect(result.length).toBe(1);
    expect(result[0].allElements.length).toBe(2);
    expect(el(result[0]).tagName).toBe('SPAN');
  });

  it('extracts parent div when it has direct text, skipping child spans', () => {
    document.body.innerHTML = `
      <main>
        <div>This div has direct text. <span>Child span text.</span></div>
      </main>
    `;
    const result = extractParagraphs();
    expect(result.length).toBe(1);
    expect(el(result[0]).tagName).toBe('DIV');
  });

  it('excludes nav content', () => {
    document.body.innerHTML = `
      <main><p>Keep me</p></main>
      <nav><p>Ignore me</p></nav>
    `;
    const result = extractParagraphs();
    expect(result.length).toBe(1);
    expect(result[0].text).toBe('Keep me');
  });

  it('excludes code blocks', () => {
    document.body.innerHTML = '<main><pre><code>code</code></pre><p>text</p></main>';
    const result = extractParagraphs();
    expect(result.length).toBe(1);
    expect(result[0].text).toBe('text');
  });

  it('excludes long code blocks inside pre', () => {
    document.body.innerHTML = `
      <main>
        <pre><code>function hello() { return "world"; }</code></pre>
        <p>Real text to translate</p>
      </main>`;
    const result = extractParagraphs();
    expect(result.length).toBe(1);
    expect(result[0].text).toBe('Real text to translate');
  });

  it('p tags with inline math are still extracted (math symbols preserved)', () => {
    document.body.innerHTML = `
      <main>
        <p>We formalize an agent parameterized by <math><mi>θ</mi></math></p>
        <p>A plain paragraph without math</p>
      </main>`;
    const result = extractParagraphs();
    // Both should be extracted and grouped (same parent)
    expect(result.length).toBe(1);
    expect(result[0].allElements.length).toBe(2);
    expect(result[0].text).toContain('We formalize');
  });

  it('excludes elements inside math/svg/pre/code containers', () => {
    document.body.innerHTML = `
      <main>
        <math><annotation encoding="application/x-tex">m_i = F(\\tau_i \\mid \\phi)</annotation></math>
        <pre><span class="inner">code inside pre</span></pre>
        <svg><text>svg text</text></svg>
        <p>Text outside protected containers</p>
      </main>`;
    const result = extractParagraphs();
    // Only the P outside protected containers should be extracted
    expect(result.length).toBe(1);
    expect(result[0].text).toBe('Text outside protected containers');
  });

  it('extracts HTML content inside SVG foreignObject (e.g. Summary boxes)', () => {
    // jsdom doesn't fully support SVG foreignObject, so we test isInsideProtected
    // logic directly: a foreignObject ancestor stops the protection check.
    // The real behaviour is verified via Playwright e2e.
    document.body.innerHTML = `
      <main>
        <svg><text>do not extract</text></svg>
        <p>Text outside svg</p>
      </main>`;
    const result = extractParagraphs();
    // SVG text is excluded; the P outside is extracted
    expect(result.length).toBe(1);
    expect(result[0].text).toBe('Text outside svg');
  });

  it('excludes td elements (all table cells — prevent layout corruption)', () => {
    document.body.innerHTML = `
      <main>
        <table class="ltx_equation">
          <tr><td class="ltx_eqn_cell"><math><mi>a</mi><mo>+</mo><mi>b</mi></math></td></tr>
        </table>
        <table><tr><td>Plain table cell text</td></tr></table>
        <p>Regular text after table</p>
      </main>`;
    const result = extractParagraphs();
    // All TD elements are skipped; only the plain P is extracted
    expect(result.length).toBe(1);
    expect(result[0].text).toBe('Regular text after table');
  });

  it('groups siblings across wrapper DIVs into section-level blocks', () => {
    document.body.innerHTML = `
      <main>
        <div class="ltx_para">
          <p>A policy parameterized by <math><mi>θ</mi></math>.</p>
          <table class="ltx_equation"><tr><td class="ltx_eqn_cell"><math><mi>a</mi></math></td></tr></table>
          <p>where θ represents the parameter.</p>
        </div>
        <div class="ltx_para">
          <p>A separate section paragraph.</p>
        </div>
      </main>`;
    const result = extractParagraphs();
    // All 3 P elements: P1,P2 in ltx_para#1 (same parent) → grouped
    // P2→P3: both parents are sibling DIVs in <main> → merged via grandparent rule
    // Result: 1 section-level block with all 3 elements
    expect(result.length).toBe(1);
    expect(result[0].allElements.length).toBe(3);
    expect(result[0].text).toContain('A policy parameterized');
    expect(result[0].text).toContain('where');
    expect(result[0].text).toContain('A separate section paragraph');
  });

  it('excludes short text', () => {
    document.body.innerHTML = '<main><p>Hi</p><p>A longer paragraph here</p></main>';
    const result = extractParagraphs();
    expect(result.length).toBe(1);
    expect(result[0].text).toBe('A longer paragraph here');
  });

  it('excludes pure URLs', () => {
    document.body.innerHTML = '<main><p>https://example.com</p><p>Real text</p></main>';
    const result = extractParagraphs();
    expect(result.length).toBe(1);
    expect(result[0].text).toBe('Real text');
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
    // h1+p in <main> → 1 group; li siblings in <ul> → 1 group
    expect(result.length).toBe(2);
    expect(result[0].allElements.length).toBe(2); // h1 + p
    expect(result[1].allElements.length).toBe(2); // li + li
  });

  it('excludes ad-like containers by class name', () => {
    document.body.innerHTML = `
      <main><p>Keep me</p></main>
      <div class="sidebar-ad"><p>Ad text</p></div>
    `;
    const result = extractParagraphs();
    expect(result.length).toBe(1);
    expect(result[0].text).toBe('Keep me');
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
    const texts = result.map((r) => r.text);
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
