# CLAUDE.md

This file is the **Agentic entry point** for Claude Code when working on the WebTranslate repository.

## 项目概述

WebTranslate — 基于大模型 API 的网页翻译 Chrome 扩展（Manifest V3）。
支持内联翻译（Inline）和侧边面板翻译（Panel）两种模式。

## 技术栈

- Chrome Extension Manifest V3
- 原生 ES2022（无框架）
- Vite 构建，Vitest 测试
- JSZip、DOMPurify、turndown.js

## Agent 默认工作流

```text
inspect -> plan -> implement -> test -> self-fix -> report
```

Agent 在用户给定的任务边界内**自主执行**，不需要每步都询问用户。
详细流程见 `.agent/operating-mode.md`。

### 什么时候必须问用户

1. 需要改 manifest 权限
2. 需要引入新依赖
3. 需要删除已有功能
4. 需要修改 API key / 隐私 / 权限相关逻辑
5. 需要大规模重构
6. 需要改变现有用户交互逻辑

### 什么时候不要问用户

1. 修 bug
2. 补测试
3. 小范围重构
4. 修 lint
5. 修 build
6. 完成当前任务所需的合理代码修改

## 代码修改约束

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
