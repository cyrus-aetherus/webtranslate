# WebTranslate UI Interaction Design

> 文档版本：1.0 · 最后更新：2026-06-04 · 作者：WebTranslate Contributors

---

## 1. 概述

WebTranslate 的浮动操作按钮（FAB, Floating Action Button）是用户与翻译引擎交互的主入口。本文档定义 FAB 菜单的交互模型、状态机流转、以及从用户操作到系统响应的完整生命周期闭环。

---

## 2. 核心设计原则

| 原则 | 说明 |
|---|---|
| **上下文感知** | 菜单内容随翻译状态动态变化，用户只看当前状态下有意义的操作 |
| **主次分明** | 每个状态有一个"主按钮"（加大视觉权重），表达最合理的下一步动作 |
| **无丢失数据** | 停止翻译（Stop）保留已译文 DOM；清除（Clear）仅移除 DOM 但保留缓存，重新翻译瞬间恢复 |
| **Tab 隔离** | 翻译状态按 Tab 独立，A 网站翻译不会自动在 B 网站启动 |
| **闭环完整** | 用户可在 IDLE → TRANSLATING → PAUSED 之间任意流转，不会困在任意中间态 |

---

## 3. 状态机模型

```
                startTranslation()
                 （首次翻译）
       IDLE ───────────────────────► TRANSLATING
        ▲                               │
        │                          stopTranslation()
        │                               │
        │                               ▼
        │                            PAUSED
        │                          (有残留译文)
        ├── clearTranslations() ───────┘
        │   (移除 DOM · 保留缓存)
        │
        ├── retranslate() ─────────────► TRANSLATING
        │   (移除 DOM · 清除缓存 · 重新翻译)
        │
        └── startTranslation() ────────► TRANSLATING
            (缓存命中 · 瞬间恢复)
```

**关键规则：**
- PAUSED 态是"安全着陆"状态：保留所有已插入的翻译块，但停止观察器和批量处理
- Clear → 回到 IDLE，缓存仍保留，再次翻译瞬间恢复（零 API 请求）
- Retranslate → 清空缓存和 DOM，重新请求 API

---

## 4. FAB 菜单 —— 按状态动态变化

### 4.1 状态 IDLE（未翻译）

```
            [⬇️ Download]
               |
    [⚙️ Settings] — [🌐 Translate] — [📋 Panel]
                     （主按钮·加大）
```

| 菜单项 | 行为 |
|---|---|
| 🌐 **Translate** | 以记忆的模式启动 Inline 翻译（主按钮） |
| 📋 **Panel** | 切换为 Panel 模式并启动翻译 |
| ⬇️ **Download** | 下载当前页面（Markdown + 图片） |
| ⚙️ **Settings** | 打开 Popup 设置面板 |

### 4.2 状态 TRANSLATING（翻译中）

```
            [⬇️ Download]
               |
    [⚙️ Settings] — [⏹ Stop] — [⇄ Switch to Panel/Inline]
                     （主按钮·红色强调）
```

| 菜单项 | 行为 |
|---|---|
| ⏹ **Stop** | 停止翻译，状态 → PAUSED，保留已译文（主按钮） |
| ⇄ **Switch** | 一键切换模式（Inline ↔ Panel），无缝衔接 |
| ⬇️ **Download** | 下载当前页面 |
| ⚙️ **Settings** | 打开设置 |

### 4.3 状态 PAUSED（已停止，有残留译文）

```
            [🗑 Clear]
               |
    [⚙️ Settings] — [🌐 Translate] — [🔄 Retranslate]
                     （主按钮·加大）
                |_________|
              [⬇️ Download]
```

| 菜单项 | 行为 |
|---|---|
| 🌐 **Translate** | 恢复翻译（缓存秒开，主按钮） |
| 🔄 **Retranslate** | 清缓存 + 清 DOM，重新请求 API |
| 🗑 **Clear** | 移除所有翻译块，恢复原文，状态 → IDLE |
| ⬇️ **Download** | 下载当前页面 |
| ⚙️ **Settings** | 打开设置 |

---

## 5. 五个行为的精确定义

### 5.1 Translate（开始 / 恢复）
| 维度 | 行为 |
|---|---|
| DOM | 从原文段落提取 + 启动 IntersectionObserver 批量处理 |
| 缓存 | 优先命中（L1 内存 → L2 session → L3 local） |
| 状态 | IDLE/PAUSED → TRANSLATING |
| API | 仅对缓存未命中的段落发起请求 |

### 5.2 Stop（停止）
| 维度 | 行为 |
|---|---|
| DOM | 停止新增翻译块，**保留已有译文** |
| 缓存 | 保留 L1/L2/L3 全部缓存 |
| 状态 | TRANSLATING → PAUSED |
| API | 取消所有进行中的请求 |

### 5.3 Clear（清除译文）
| 维度 | 行为 |
|---|---|
| DOM | **移除所有** `.wt-inline-block` 和 `.wt-pending` 元素 |
| 缓存 | **保留**（L1/L2/L3 全部保留） |
| 状态 | PAUSED → IDLE |
| API | 无 |

### 5.4 Retranslate（重新翻译）
| 维度 | 行为 |
|---|---|
| DOM | 移除所有翻译块 |
| 缓存 | **清除当前页** L1 缓存 |
| 状态 | PAUSED → TRANSLATING |
| API | 对所有段落重新发起请求 |

### 5.5 Switch Mode（切换模式）
| 维度 | 行为 |
|---|---|
| DOM | 保留已翻译的内容（缓存命中） |
| 缓存 | 保留 |
| 状态 | TRANSLATING → TRANSLATING（无缝切换） |
| API | 继续对未翻译段落发起请求 |

---

## 6. Tab 隔离方案

**问题：** 此前 `wt_active` 存在 `chrome.storage.local`（全局），在任意 Tab 开始翻译后，其他 Tab 也会自动启动。

**解决：** 将 `wt_active` / `wt_autoMode` 从 `chrome.storage.local` 迁移到 `chrome.storage.session`。

| 存储位置 | 生存周期 | 作用域 |
|---|---|---|
| `chrome.storage.session` | 当前浏览器会话 | **当前 Tab** |
| `chrome.storage.local` | 永久 | 全局（所有 Tab）|

**效果：**
- ✅ 刷新当前页面 → 自动恢复翻译
- ✅ 关闭 Tab → 下次打开同页面不自动翻译（Session 已清空）
- ✅ 在 A 网站翻译，切到 B 网站 → B 网站不会自动翻译

---

## 7. FAB 视觉状态

| 状态 | 背景色 | 图标徽标 | CSS class |
|---|---|---|---|
| IDLE | 白色 `#fff` | 显示 "I" 或 "P"（当前模式）| `wt-idle` |
| TRANSLATING | 浅紫 `#eaddff` | 显示模式徽标 | `wt-active` |
| PAUSED | 浅黄 `#fef7e0` | 隐藏徽标 | `wt-paused` |
| ERROR | 浅红 `#f9dedc` | 隐藏徽标 | `wt-error` |

---

## 8. 代码架构

```
src/content/
  ├── content.js           # 生命周期控制器（start/stop/clear/retranslate/switchMode）
  │                        #   使用 chrome.storage.session 管理 Tab 隔离
  ├── components/fab.js     # FAB 组件（动态菜单生成、模式徽标、状态样式）
  ├── state-manager.js      # 状态机（IDLE/TRANSLATING/PAUSED/SCANNING/ERROR）
  ├── cache-manager.js      # 三级缓存（L1 内存 / L2 session / L3 local）
  ├── renderers/
  │   └── inline-renderer.js # Inline 译文渲染（含 clearAll 方法）
  └── extractor/            # 内容提取器
```

**关键调用链：**
1. 用户点击 FAB → `FabComponent` 触发回调
2. 回调调用 `content.js` 中的 `startTranslation()` / `stopTranslation()` / `clearTranslations()` / `retranslate()` / `switchMode()`
3. `startTranslation()` 写 `chrome.storage.session` → `maybeAutoStart()` 只在当前 Tab 读取
4. `stopTranslation()` 转 PAUSED → FAB `updateMenu('PAUSED')` → 显示 Clear / Retranslate
5. `stateManager.onChange()` → `updateFabState()` → 自动更新 FAB 菜单 + 徽标

---

## 9. 设计决策记录

### 为什么 Clear 不清缓存？
缓存是优化手段（减少 API 请求），不应与用户可见状态耦合。用户"恢复原文"的场景通常是临时查看，而非永久放弃翻译。保留缓存让"重新看一眼"的成本为零。

### 为什么增加 Retranslate？
"换模型重新翻译"是一个真实的用户场景。之前需要手动清除缓存 + 重新翻译，没有统一的入口。现在 PAUSED 菜单里提供一键操作。

### 为什么 Stop 改为 PAUSED 而不是 IDLE？
之前 Stop → IDLE，翻译块仍留在页面上但没有任何入口清除它们（除了刷新页面）。改为 PAUSED 后，FAB 菜单显示 Clear 和 Retranslate，形成完整闭环。

---

## 10. 未来扩展

- [ ] **快捷键**：支持 `Ctrl+Shift+T` 切换翻译、`Ctrl+Shift+C` 清除译文
- [ ] **自定义主按钮**：允许用户在设置中指定"点击 FAB 直接做什么"
- [ ] **翻译块右键菜单**：点击 Inline 翻译块右上角可单独"隐藏此翻译"或"重新翻译此段"
- [ ] **翻译历史面板**：记录最近 10 次翻译操作的统计信息
