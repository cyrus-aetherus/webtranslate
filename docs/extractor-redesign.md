# WebTranslate Extractor 通用化重构方案

## 一、背景与问题

当前 `extractor.js` 基于**"语义标签假设"**设计，存在以下覆盖盲区：

1. **内容根选择器太少**：`article > main > .content` 只有 6 个，大量现代站点不匹配
2. **多 `<article>` 页面只取第一个**：GitHub Trending 等页面一个项目一个 `<article>`，只扫描到第一个
3. **`<div>` 文本容器被忽略**：Twitter/X、React/Vue SPA 等现代网站大量用 `<div>` 代替 `<p>`
4. **ID 冲突**：`generateParagraphId` 基于 `parentElement.children` index，同结构元素 id 重复
5. **hash 不稳定**：`djb2Hash` 每次调用添加随机后缀，缓存完全失效

## 二、设计原则

- **精简**：3 个模块 + 1 入口，不拆分单函数文件
- **高效**：避免 `cloneNode` 和 `getComputedStyle` 大面积调用
- **隔离**：模块间单向依赖，无循环依赖
- **好维护**：职责单一，每个模块可独立测试

## 三、模块划分

```
src/content/extractor/
  ├── index.js              # 对外入口：extractParagraphs() + getTranslatableText() + generateParagraphId()
  ├── content-root-finder.js    # 多候选内容根查找
  └── content-scanner.js        # 文本块扫描 + 内容过滤（合并原 text-block-extractor + content-filter）
```

### 为什么只有 3 个文件？

| 原方案模块 | 合并到 | 原因 |
|-----------|--------|------|
| text-block-extractor + content-filter | `content-scanner.js` | 扫描与过滤在遍历过程中紧密耦合，分离反而增加函数调用开销 |
| dom-id-generator | `index.js` | 只有 1 个函数，独立成文件收益太小 |
| extractor/index | `index.js` | 整合层天然与 ID 生成放在一起 |

## 四、各模块设计

### 4.1 content-root-finder.js

**职责**：收集页面所有候选内容区，去嵌套、智能合并同类型兄弟元素。

**接口**：
```js
export function findContentRoots() → Element[]
```

**算法**：
```
1. 遍历 CONTENT_SELECTORS，用 querySelectorAll 收集所有匹配元素
2. 去嵌套：如果候选 A 包含候选 B（A !== B），只保留外层 A
3. 智能合并：如果多个候选是同标签兄弟（如多个 <article> 同父），返回它们的父元素
4. 对剩余候选按"面积 × 中心偏移权重"排序
5. 无匹配时 fallback 到 [document.body]
```

**关键代码**：
```js
function findContentRoots() {
  const candidates = [];
  for (const selector of CONTENT_SELECTORS) {
    document.querySelectorAll(selector).forEach(el => candidates.push(el));
  }
  if (candidates.length === 0) return [document.body];

  // 去嵌套：保留最外层
  const roots = candidates.filter(a =>
    !candidates.some(b => b !== a && b.contains(a))
  );

  // 智能合并：同标签兄弟 → 返回父元素
  if (roots.length >= 2 && roots.every(r => r.parentElement === roots[0].parentElement)) {
    const allSameTag = roots.every(r => r.tagName === roots[0].tagName);
    if (allSameTag) return [roots[0].parentElement];
  }

  // 按面积 + 中心位置排序（面积大且居中的优先）
  roots.sort((a, b) => scoreRoot(b) - scoreRoot(a));
  return roots;
}

function scoreRoot(el) {
  const rect = el.getBoundingClientRect();
  const area = rect.width * rect.height;
  const centerX = (rect.left + rect.right) / 2;
  const screenCenterX = window.innerWidth / 2;
  const centerDist = Math.abs(centerX - screenCenterX);
  return area - centerDist * 10; // 偏离中心越远，分越低
}
```

**边界情况处理**：
- 如果 sidebar 里的 `<article>` 和 content 里的 `<article>` 同时存在，去嵌套后 sidebar 的 `<article>` 和 content 的 `<main>` 都会保留，按面积+中心位置排序后 content 的 `<main>` 排在前面
- 如果页面有 `<main>` 包含多个 `<article>`，去嵌套后只剩 `<main>`，直接返回

### 4.2 content-scanner.js

**职责**：从内容根出发遍历 DOM，提取语义标签 + `<div>` 文本容器，同时过滤噪声。

**接口**：
```js
export function scanTextBlocks(root) → TextBlock[]
// TextBlock = { element: Element, text: string }
```

**内部函数**（不导出）：
```js
function isExcluded(el) → boolean          // 祖先链排除
function isContentBlock(block) → boolean   // 块级特征过滤
function hasInteractiveDescendant(el) → boolean  // 交互元素检查
function hasTranslatableDescendant(el) → boolean // 语义后代检查
function getLinkDensity(el) → number       // 链接密度
```

**算法**：
```
深度优先遍历 root 的子树：
  1. 如果 isExcluded(el) 为 true，跳过整个子树（剪枝）
  2. 如果 el 是语义标签（P, H1-H6, LI, ...）：
     - 提取文本
     - 如果 isContentBlock 通过，加入结果
     - 不递归子元素（避免重复提取）
  3. 如果 el 是容器标签（DIV, SECTION）：
     - 检查是否有交互后代（button, input, a 大量）
       - 有 → 只递归子元素，不把当前 div 作为容器块
     - 检查是否有语义后代（P, H1-H6, ...）
       - 有 → 只递归子元素，不把当前 div 作为容器块
       - 无 → 提取整个 div 的文本作为容器块
              - 如果文本 >= MIN_DIV_TEXT_LENGTH 且 isContentBlock 通过，加入结果
              - 不递归子元素
```

**关键代码**：
```js
const MIN_TEXT_LENGTH = 3;
const MIN_DIV_TEXT_LENGTH = 15;
const MAX_TEXT_LENGTH = 5000;
const LINK_DENSITY_THRESHOLD = 0.5;
const INTERACTIVE_TAGS = new Set([
  'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA',
]);

function isExcluded(el) {
  let node = el;
  while (node && node !== document.body) {
    if (EXCLUDED_CONTAINERS.has(node.tagName)) return true;
    const role = node.getAttribute?.('role');
    if (role && EXCLUDED_ROLES.includes(role)) return true;
    const cls = node.className;
    if (typeof cls === 'string') {
      for (const pattern of EXCLUDED_CLASS_PATTERNS) {
        if (pattern.test(cls)) return true;
      }
    }
    node = node.parentElement;
  }
  return false;
}

function isContentBlock(block) {
  const text = block.text;
  if (!text || text.length < MIN_TEXT_LENGTH) return false;
  if (text.length > MAX_TEXT_LENGTH) return false;
  if (isPureUrl(text)) return false;
  if (isShortNumberOrTimestamp(text)) return false;
  if (getLinkDensity(block.element) > LINK_DENSITY_THRESHOLD) return false;
  return true;
}

function hasInteractiveDescendant(el) {
  return el.querySelector(Array.from(INTERACTIVE_TAGS).join(',')) !== null;
}

function hasTranslatableDescendant(el) {
  return el.querySelector(Array.from(TRANSLATABLE_TAGS).join(',')) !== null;
}

function getLinkDensity(el) {
  const text = el.textContent.trim();
  if (!text) return 0;
  const links = el.querySelectorAll('a');
  let linkTextLen = 0;
  links.forEach(a => { linkTextLen += a.textContent.length; });
  return linkTextLen / text.length;
}
```

**边界情况处理**：
- `<div>` 内有 `<button>` → 不提取该 div，递归子元素时 button 不会被提取（不是语义标签）
- `<div>` 内有 `<p>` → 不提取该 div，递归子元素时 `<p>` 被提取
- `<div>` 内只有 `<span>` → 提取该 div 的文本（包含所有 span 的文本），不递归
- `<div>` 内既有 `<p>` 又有 `<div>` → 不提取外层 div，递归子元素时 `<p>` 被提取，内层 `<div>` 如果没有语义后代也会被提取

### 4.3 index.js（整合入口）

**职责**：组合 `content-root-finder` + `content-scanner`，对外暴露向后兼容的接口。

**对外接口**：
```js
export function extractParagraphs() → Element[]
export function getTranslatableText(el) → string
export function generateParagraphId(el) → string
```

**内部函数**：
```js
function generateIdFromPath(el) → string  // 基于 DOM 路径的稳定 ID
```

**数据流**：
```
extractParagraphs()
  ├── findContentRoots()           → [root1, root2, ...]
  ├── for each root:
  │     scanTextBlocks(root)       → [block1, block2, ...]
  ├── filter with isContentBlock
  ├── deduplicate by element reference
  └── return Element[]
```

**关键代码**：
```js
export function extractParagraphs() {
  const roots = findContentRoots();
  const seen = new Set();
  const results = [];

  for (const root of roots) {
    const blocks = scanTextBlocks(root);
    for (const block of blocks) {
      if (seen.has(block.element)) continue;
      seen.add(block.element);
      results.push(block.element);
    }
  }

  return results;
}

export function getTranslatableText(el) {
  // 优化：不用 cloneNode，直接 textContent
  // 因为 scanTextBlocks 已经通过 isExcluded 排除了 script/style 容器
  let text = el.textContent || '';
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

export function generateParagraphId(el) {
  const path = [];
  let node = el;
  let depth = 0;
  const MAX_DEPTH = 6;

  while (node && node !== document.body && depth < MAX_DEPTH) {
    const tag = node.tagName.toLowerCase();
    const parent = node.parentElement;
    const index = parent ? Array.from(parent.children).indexOf(node) : 0;
    path.unshift(`${tag}${index}`);
    node = parent;
    depth++;
  }

  return 'wt_' + path.join('_');
}
```

## 五、常量变更（shared/constants.js）

```js
// 内容根选择器：新增常见文档/CMS类选择器
export const CONTENT_SELECTORS = [
  'article',
  'main',
  '.content',
  '.post',
  '.entry-content',
  '[role="main"]',
  '.markdown-body',        // GitHub README
  '.prose',                // Tailwind 文档站点
  '#main-content',
  '.post-content',
  '.page-content',
  '.document',
  '.docs-content',
  '.doc-content',
  '.article-content',
  '.entry',
];

// 语义标签：新增描述列表、图注
export const TRANSLATABLE_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'LI', 'TD', 'TH', 'BLOCKQUOTE',
  'DD', 'DT', 'FIGCAPTION',
]);

// 可作为文本容器的标签（当它们没有语义子标签时）
export const TEXT_CONTAINER_TAGS = new Set([
  'DIV', 'SECTION',
]);

// 排除容器
export const EXCLUDED_CONTAINERS = new Set([
  'NAV', 'HEADER', 'FOOTER', 'ASIDE',
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE',
]);

// 排除 ARIA role
export const EXCLUDED_ROLES = [
  'complementary', 'navigation', 'banner', 'contentinfo',
];

// CSS 类名排除模式（导航、广告、弹窗等）
export const EXCLUDED_CLASS_PATTERNS = [
  /(^|\s)(ad-|ads-|advertisement|banner|sponsor)/i,
  /(^|\s)(sidebar|side-bar|side_nav)/i,
  /(^|\s)(nav-|navbar|menu-|dropdown|breadcrumbs)/i,
  /(^|\s)(modal|popup|toast|notification|cookie-banner|consent)/i,
];

export const PROTECTED_TAGS = new Set([
  'PRE', 'CODE', 'MATH', 'SVG',
]);
```

## 六、ObserverManager 适配

当前 `ObserverManager` 只监听 `TRANSLATABLE_TAGS` 的新节点：
```js
if (TRANSLATABLE_TAGS.has(node.tagName)) ...
```

新方案中 `<div>` 也可能是文本容器，需要修改 `_registerElements`：

```js
// observer-manager.js 修改后
import { scanTextBlocks } from './extractor/content-scanner.js';

_registerElements(addedNodes) {
  const newElements = [];
  for (const node of addedNodes) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    // 如果新增的是大段内容（如文章切换），扫描整个子树
    const blocks = scanTextBlocks(node);
    for (const block of blocks) {
      if (!block.element.dataset.wtDone && !block.element.dataset.wtObservable) {
        block.element.dataset.wtObservable = 'true';
        newElements.push(block.element);
      }
    }
  }
  // 注册到 batchCollector...
}
```

**注意**：`scanTextBlocks` 内部已经有 `isExcluded` 剪枝，所以即使传入 `<nav>` 也不会提取到导航链接。

## 七、兼容性

| 旧接口 | 新实现 | 兼容性 |
|--------|--------|--------|
| `extractParagraphs()` | 组合 `findContentRoots` + `scanTextBlocks` | ✅ 行为增强，返回值类型不变 |
| `getTranslatableText(el)` | 直接用 `textContent`，去掉 `cloneNode` | ✅ 返回值不变，性能更好 |
| `generateParagraphId(el)` | 基于 DOM 路径而非 parent index | ✅ 返回值格式不变，但生成逻辑更稳定 |
| `findContentRoot()` | 替换为 `findContentRoots()`（内部使用） | ⚠️ 旧代码不再导出，只在新模块内部使用 |

**所有引用 `extractor.js` 的外部代码无需修改**，`index.js` 保持完全兼容的导出接口。

## 八、边界情况清单

| 场景 | 处理方式 | 验证点 |
|------|---------|--------|
| GitHub Trending（25 个 `<article>`） | 去嵌套后 `<main>` 包含所有，返回 `<main>`，扫描全部 | ✅ 提取到 25 个 `<p>` |
| Mintlify 文档（无 `<article>`，有 `<main>`） | `document.querySelector('main')` 返回内容区 | ✅ 提取到所有正文 |
| Twitter 推文（`<div>` + `<span>`） | `<div>` 无语义后代，提取为容器块 | ✅ 推文文本被提取 |
| 导航链接区（`<nav>` 内 `<li>`） | `isExcluded` 剪枝，整个 `<nav>` 跳过 | ✅ 不提取 |
| 按钮卡片（`<div>` + `<button>`） | `hasInteractiveDescendant` 为 true，不提取该 div | ✅ 不提取 |
| 广告区（class="ad-banner"） | `EXCLUDED_CLASS_PATTERNS` 匹配，跳过 | ✅ 不提取 |
| 浮动弹窗（fixed position） | 类名匹配 `modal/popup` 排除；无类名时 area 排序靠后 | ✅ 不提取或低优先级 |
| 深层嵌套 `<div>`（> 6 层） | `generateParagraphId` 限制 MAX_DEPTH=6 | ✅ ID 长度可控 |
| 同 parent 同 tag 同 index | DOM 路径包含层级信息，全局唯一 | ✅ 无冲突 |

## 九、后续开发顺序

1. **创建目录结构**：`mkdir src/content/extractor`
2. **实现 `content-root-finder.js`**
3. **实现 `content-scanner.js`**
4. **实现 `index.js`**
5. **更新 `shared/constants.js`**（已完成）
6. **更新 `observer-manager.js`**
7. **删除旧 `extractor.js`**（确认无其他引用后）
8. **运行现有单元测试**：确保向后兼容
9. **补充新边界情况的单元测试**
