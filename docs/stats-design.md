# WebTranslate 模型调用统计 — 设计文档

## 一、概述

记录每一次 LLM API 调用，提供当前会话/历史统计，帮助用户了解 Token 消耗与成本。

## 二、数据模型

### 2.1 存储结构 (`chrome.storage.local`)

```
Key: wt_stats_session     → { ...SessionStats }    // 当前标签页会话（每次刷新页面重置）
Key: wt_stats_alltime     → { ...AllTimeStats }    // 累计统计（永久保存）
Key: wt_stats_daily       → { ...DailyRecord[] }   // 最近 30 天按天汇总
```

### 2.2 SessionStats（单次页面会话）

```js
{
  startedAt: 1717400000000,          // 会话开始时间戳
  calls: 23,                         // API 调用次数
  promptTokens: 18500,               // 输入 token 总量
  completionTokens: 7200,            // 输出 token 总量
  segments: 93,                      // 已翻译段数
  batches: 12,                       // 批次数
  errors: 1,                         // 失败次数
  pageUrl: "github.com/resources/…", // 页面标识
}
```

### 2.3 AllTimeStats（累计统计）

```js
{
  calls: 1523,
  promptTokens: 1200000,
  completionTokens: 450000,
  segments: 9300,
  errors: 12,
}
```

### 2.4 DailyRecord（每日汇总）

```js
[
  { date: "2026-06-03", calls: 150, promptTokens: 120000, completionTokens: 45000, segments: 900, cost: 0.12 },
  { date: "2026-06-02", calls: 200, promptTokens: 160000, completionTokens: 60000, segments: 1200, cost: 0.16 },
  ...
]
```

## 三、Token 计数与成本估算

### 3.1 Token 来源

每次 API 响应包含 `usage` 字段（OpenAI 兼容格式）：

```json
{
  "usage": {
    "prompt_tokens": 520,
    "completion_tokens": 180,
    "total_tokens": 700
  }
}
```

### 3.2 成本计算公式

按模型名称匹配定价表（可配置）：

| 模型 | 输入 $/1K tokens | 输出 $/1K tokens |
|---|---|---|
| gpt-4o | $0.0025 | $0.010 |
| gpt-4o-mini | $0.00015 | $0.0006 |
| gpt-4-turbo | $0.010 | $0.030 |
| deepseek-chat | $0.00014 | $0.00028 |
| claude-3-opus | $0.015 | $0.075 |
| *default* | $0.001 | $0.002 |

```js
cost = (promptTokens * inputPrice + completionTokens * outputPrice) / 1000
```

## 四、架构流程

```
┌──────────────────────────────────────────────────────────────┐
│ Content Script                                               │
│   → 发送 TRANSLATE_BATCH                                     │
│   → 接收 TRANSLATE_BATCH_RESULT                              │
│   → 更新 segments 计数                                       │
└────────────┬─────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────┐
│ Service Worker                                               │
│   → API Proxy 调用 LLM                                       │
│   → 解析 response.usage                                      │
│   → 写入 chrome.storage.local                                │
│   → 累计 SessionStats + AllTimeStats                         │
└────────────┬─────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────┐
│ Popup (设置面板)                                              │
│   → 新增 "Statistics" 标签页                                  │
│   → 读取 chrome.storage.local 展示                           │
│   → 实时刷新按钮                                              │
└──────────────────────────────────────────────────────────────┘
```

## 五、UI 设计

### 5.1 Popup 新增 "Stats" 标签

设置面板改为两个标签切换：

```
┌──────────────────────────────┐
│  [Settings]  [Statistics]    │  ← 标签栏
├──────────────────────────────┤
│                              │
│  📊 This Session             │
│  ┌────────────────────────┐  │
│  │ API Calls      23      │  │
│  │ Segments       93      │  │
│  │ Tokens In    18,500    │  │
│  │ Tokens Out    7,200    │  │
│  │ Est. Cost    $0.12     │  │
│  │ Errors          1      │  │
│  └────────────────────────┘  │
│                              │
│  📈 All Time                 │
│  ┌────────────────────────┐  │
│  │ API Calls    1,523     │  │
│  │ Segments     9,300     │  │
│  │ Tokens In  1,200,000   │  │
│  │ Tokens Out  450,000    │  │
│  │ Est. Cost    $5.67     │  │
│  └────────────────────────┘  │
│                              │
│  📅 Today                    │
│  ┌────────────────────────┐  │
│  │ Calls: 150 Seg: 900    │  │
│  │ Cost: $0.12             │  │
│  └────────────────────────┘  │
│                              │
│  [Reset Session] [Export]    │  ← 操作按钮
└──────────────────────────────┘
```

### 5.2 FAB 轻量指示器（可选）

翻译进行中时，FAB 数字下方小字显示当前会话 Token 数：

```
  ┌─────┐
  │  23 │   ← 段数
  │ 15K │   ← 当前 Token 数（缩写）
  └─────┘
```

## 六、文件变更清单

| 文件 | 变更 | 代码量 |
|---|---|---|
| `src/background/stats-tracker.js` | **新建** — 统计记录模块 | ~80 行 |
| `src/background/sw.js` | 修改 — 在 API 调用后记录 stats | +10 行 |
| `src/background/api-proxy.js` | 修改 — 解析 response.usage 回传 | +5 行 |
| `src/popup/popup.html` | 修改 — 添加标签栏 + Stats 面板 | +60 行 |
| `src/popup/popup.js` | 修改 — 读取并渲染 stats | +80 行 |
| `src/shared/constants.js` | 修改 — 添加模型定价表 | +15 行 |

总计新增 ~250 行，改动 ~20 行。

## 七、定价表可配置

在设置面板的 "Settings" 标签中添加自定义定价（高级选项，默认折叠）：

```
┌─ Advanced Pricing ──────────────────┐
│ Input $/1K tokens:  [0.0025  ]      │
│ Output $/1K tokens: [0.010   ]      │
│                                     │
│ [Reset to model default] [Save]     │
└─────────────────────────────────────┘
```

## 八、注意事项

1. **隐私**：所有数据仅存本地 `chrome.storage.local`，不上传
2. **性能**：`chrome.storage.local` 写入 uses debounce（每 5 次调用写一次）
3. **模型识别**：从配置中读取 `config.model` 匹配定价表
4. **未知模型**：使用 `_default` 定价行
5. **Session 重置**：页面刷新时 CS 发送 `STATS_NEW_SESSION` 消息给 SW，SW 重置 session 统计

---

**确认后进入开发。预计 1 个迭代周期。**
