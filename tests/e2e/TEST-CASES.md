# WebTranslate 端到端测试用例

## 测试环境要求

1. 构建产物：`npm run build` 生成 `dist/` 目录
2. 测试页面服务器：`tests/e2e/pages/` 通过静态服务器提供（端口 8765）
3. Mock API 服务器：`tests/integration/mock-server.js`（端口 3457）
4. 浏览器：Chrome（MV3 扩展需要真实 Chromium）

## 测试用例清单

### TC-01 FAB 发现性
**目标**：验证用户进入新页面后能否直接发现悬浮按钮
**步骤**：
1. 打开测试页面 `http://localhost:8765/demo.html`
2. 等待 2 秒让 content script 注入
3. 截图验证 FAB 是否可见
**预期**：
- `#wt-fab` 元素存在
- FAB 位于右下角（默认 `innerWidth - SIZE - 24, innerHeight - SIZE - 32`）
- FAB 带有 `wt-idle` 类
- 右上角显示模式 badge（默认 'I'）

### TC-02 Inline 模式翻译
**目标**：验证点击 "Translate" 按钮后开始 inline 翻译
**步骤**：
1. 打开测试页面
2. 等待 FAB 出现
3. 点击 FAB 打开菜单
4. 点击 "Translate" 按钮（`wt-translate`）
5. 等待 5 秒
**预期**：
- 页面出现 `.wt-pending` 元素（翻译中提示）
- 随后出现 `.wt-inline-block` 元素（翻译结果卡片）
- FAB 状态变为 `wt-active`

### TC-03 Inline 模式暂停
**目标**：验证翻译中可以暂停
**步骤**：
1. 在 TC-02 基础上，点击 FAB 打开菜单
2. 点击 "Stop" 按钮（`wt-stop`）
3. 等待 1 秒
**预期**：
- FAB 状态变为 `wt-paused`
- 不再有新的 `.wt-inline-block` 出现

### TC-04 Inline 模式继续
**目标**：验证暂停后可以继续翻译
**步骤**：
1. 在 TC-03 基础上，点击 FAB 打开菜单
2. 点击 "Resume" 按钮（`wt-translate`）
3. 等待 5 秒
**预期**：
- FAB 状态变为 `wt-active`
- 继续出现新的 `.wt-inline-block`

### TC-05 Inline 模式清除
**目标**：验证暂停后可以清除 inline 翻译
**步骤**：
1. 在 TC-03 基础上，点击 FAB 打开菜单
2. 点击 "Hide" 按钮（`wt-clear`）
3. 等待 1 秒
**预期**：
- 页面所有 `.wt-inline-block` 被移除
- 页面所有 `.wt-pending` 被移除
- FAB 状态变为 `wt-idle`

### TC-06 Panel 模式打开
**目标**：验证点击 "Panel Translate" 按钮后打开 side panel 并开始翻译
**步骤**：
1. 打开测试页面
2. 等待 FAB 出现
3. 点击 FAB 打开菜单
4. 点击 "Panel Translate" 按钮（`wt-switch-panel`）
5. 等待 5 秒
**预期**：
- Chrome side panel 打开
- Panel 中显示 `panel.connected` 状态
- Panel 中显示段落 slot（`.item.pending`）
- 随后 slot 被填充（`.item` 移除 `pending` 类）
- FAB badge 变为 'P'

### TC-07 Panel 模式暂停
**目标**：验证 panel 翻译中可以暂停
**步骤**：
1. 在 TC-06 基础上，点击 FAB 打开菜单
2. 点击 "Stop" 按钮
3. 等待 1 秒
**预期**：
- FAB 状态变为 `wt-paused`
- Panel 保持打开，已翻译内容保留

### TC-08 Tab 切换 - Panel 显示空状态
**目标**：验证 Tab A panel 翻译中，切换到 Tab B，Panel 显示空状态
**步骤**：
1. Tab A：打开测试页面，开始 panel 翻译（TC-06）
2. Tab B：打开新标签页 `blog.html`
3. 等待 3 秒让 Chrome 切换 side panel
4. 截图 panel
**预期**：
- Panel 显示 `panel.empty_hint` 或 `panel.switch_back`
- 不显示 Tab A 的翻译内容

### TC-09 Tab 切换 - 切回原 Tab 恢复
**目标**：验证切回 Tab A 后 Panel 恢复进度
**步骤**：
1. 在 TC-08 基础上，切换回 Tab A
2. 等待 3 秒
3. 截图 panel
**预期**：
- Panel 恢复显示 Tab A 的翻译进度
- 已完成的 slot 显示翻译结果
- 未完成的 slot 显示等待状态

### TC-10 刷新恢复
**目标**：验证普通刷新后恢复翻译状态
**步骤**：
1. Tab A 开始 panel 翻译
2. 等待部分段落翻译完成
3. 刷新页面
4. 等待 3 秒
5. 点击 FAB -> "Panel Translate"
**预期**：
- 已翻译段落从缓存恢复（不重新调用 API）
- Panel 显示正确进度

### TC-11 Panel 关闭后状态
**目标**：验证 panel 关闭后插件暂停
**步骤**：
1. Tab A 开始 panel 翻译
2. 等待部分段落翻译完成
3. 关闭 side panel（点击 X 或切换 tab）
4. 等待 2 秒
5. 检查 content script 状态
**预期**：
- content script 状态变为 PAUSED
- FAB 显示 `wt-paused`

### TC-12 Panel 关闭后继续
**目标**：验证 panel 关闭后点击继续能重新打开并完成翻译
**步骤**：
1. 在 TC-11 基础上，点击 FAB 打开菜单
2. 点击 "Resume" 按钮
3. 等待 5 秒
**预期**：
- Side panel 重新打开
- 已缓存的翻译结果显示
- 未完成的段落继续翻译

### TC-13 A/B Tab 状态隔离
**目标**：验证 Tab A 和 Tab B 同 URL 时状态不串
**步骤**：
1. Tab A：打开 demo.html，开始 panel 翻译
2. Tab B：打开 demo.html，不开始翻译
3. 切换到 Tab B
4. 观察 Panel
5. 切换回 Tab A
**预期**：
- Tab B：Panel 显示空状态
- Tab A：Panel 恢复翻译进度

### TC-14 模式切换 Inline -> Panel
**目标**：验证从 inline 模式切换到 panel 模式
**步骤**：
1. 开始 inline 翻译
2. 等待部分完成
3. 点击 FAB -> "Switch to Panel"
4. 等待 5 秒
**预期**：
- Inline 元素被清除
- Side panel 打开
- Panel 显示翻译进度（缓存命中不重新翻译）

### TC-15 模式切换 Panel -> Inline
**目标**：验证从 panel 模式切换到 inline 模式
**步骤**：
1. 开始 panel 翻译
2. 等待部分完成
3. 点击 FAB -> "Switch to Inline"
4. 等待 5 秒
**预期**：
- Side panel 关闭（或保持空状态）
- 页面出现 inline 翻译元素
