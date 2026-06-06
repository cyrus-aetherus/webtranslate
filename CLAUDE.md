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

## E2E 测试铁律（2026-06-06 血泪教训）

以下规则来自一次持续 4+ 小时的调试，期间菜单小圆球的 SVG 图标一直不显示，agent 反复声称"修好了"但实际没修好：

### 1. 视觉验证不可替代

**`getComputedStyle()` 返回值 ≠ 用户实际看到的效果。**

DOM 属性检查（stroke、fill、opacity、display）只能告诉你浏览器"打算"怎么渲染，
不能告诉你用户"实际"看到了什么。必须截图 → 肉眼确认。

严禁以下行为：
- 用 `querySelector` 找到元素就说"存在"
- 用 `getComputedStyle(x).stroke` 不是 `transparent` 就说"可见"
- 用 `opacity: 1` 就说"显示正常"
- 用自动化脚本的 JSON 返回值替代截图验证

### 2. 测试必须反映真实使用

- 必须加载完整扩展（或注入完整生产代码），不能只测片段
- 必须截图给用户确认，不能自己看了 JSON 就说通过
- 用户反馈"看不到"时，第一反应不是"代码没问题"，而是"拿截图对比"

### 3. 回退优先于修补

如果一个东西之前能用、现在不能用了：
1. 先 `git checkout` 回退到能用的版本
2. 对比 `git diff` 找出破坏点
3. 只改破坏点，不要顺带改其他

严禁在原代码上叠加修补——会导致原始问题和新增问题纠缠，无法定位根因。

### 4. 提交纪律

- **在用户明确说"可以提交"之前，不要 commit**
- 每次提交前必须经过浏览器截图验证
- 如果连续 3 轮都没解决问题，停下来反思方法，不要继续用同样的方式尝试

### 5. 不要优化自己的效率

用户要的是问题解决，不是快速关闭 task。当一个方法反复失败时，
换方法是唯一选择——继续用同样的方式只是浪费双方时间。

## 常见验证检查清单

翻译管线问题排查时，逐项检查：

- [ ] 页面加载后 FAB 是否出现
- [ ] FAB 图标是否肉眼可见（截图确认，不是 computed style）
- [ ] FAB 展开后菜单项是否完整（文字 + 图标都可见）
- [ ] 翻译后每段是否有对应卡片
- [ ] 卡片是否在原文下方（不在框内、不重叠）
- [ ] 公式区域是否有异常（卡片堆叠/公式被翻译）
- [ ] Summary 框 / 特殊容器的翻译位置是否正确
- [ ] 表格内容是否泄露为翻译卡片
- [ ] 滚动页面新内容是否触发翻译
