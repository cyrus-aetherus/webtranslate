# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## 项目概述

WebTranslate — 基于大模型 API 的网页翻译 Chrome 扩展（Manifest V3）。
支持内联翻译（Inline）和侧边面板翻译（Panel）两种模式。

## 技术栈

- Chrome Extension Manifest V3
- 原生 ES2022（无框架）
- Vite 构建，Vitest 测试
- JSZip、DOMPurify、turndown.js

## 代码修改约束

### 修改前流程（强制）

每次修改代码前，必须遵循以下步骤，不得跳过：

0. **对齐理解** — 用户描述一个场景或操作时，不要自行脑补细节。必须确认：
   - 用户具体做了什么操作（点哪个按钮？在哪里的按钮？）
   - 期望看到什么效果
   - 实际看到了什么效果
   - 如果理解有歧义，先问清楚再继续，不要假设。
1. **分析** — 完整追踪调用链，确认根因。遇到问题先读代码，不要假设。
2. **验证** — 通过日志、浏览器实测或代码逻辑，验证假设正确。
3. **给方案** — 向用户说明问题和修复点，等待用户确认。
4. **确认后再改** — 用户明确说"改"或等价表达后，才能动手。

禁止看到现象就直接改代码。
禁止用户描述模糊时自行脑补细节。

### 修改注意事项

- Inline 模式功能和 Panel 模式功能需要保持独立，修改一个模式时不能破坏另一个。
- 所有文案必须中英双语，`en.json` 和 `zh-CN.json` 同步更新，`i18n.js` 的硬编码 fallback 也需更新。
- 修改后必须通过 `npm run build` 和 `npm test`（19 文件 150+ 测试全部通过）。
- commit 信息用英文，遵循 conventional commits 格式。

## 常用命令

```bash
npm run build     # 构建 → dist/
npm test          # 运行全部测试
npm run lint      # ESLint 检查
```

## 架构要点

- `src/content/content.js` — 翻译生命周期控制（启动/停止/清除/重翻/模式切换）
- `src/content/components/fab.js` — 悬浮按钮（上下文感知动态菜单）
- `src/background/sw.js` — Service Worker（API 代理、下载、Port 桥接）
- `src/panel/panel.js` — 侧边面板（槽位模型渲染）
- `src/content/renderers/panel-renderer.js` — Panel 模式渲染器（通过 SW 桥接 Port）
- `src/content/renderers/inline-renderer.js` — Inline 模式渲染器
- `src/shared/i18n.js` — 国际化模块
- `src/shared/constants.js` — 常量和配置
