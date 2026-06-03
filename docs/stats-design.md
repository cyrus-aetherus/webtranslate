# WebTranslate 模型调用统计 — 设计文档

## 一、概述

记录每一次 LLM API 调用，提供当前会话/历史统计，帮助用户了解 Token 消耗与成本。

## 二、数据模型

### 2.1 存储结构

| 位置 | Key | 类型 | 说明 |
|---|---|---|---|
| 内存 (`StatsTracker._sessions`) | `tabId` | `SessionStats` | 当前标签页会话（SW 重启即丢失） |
| `chrome.storage.local` | `wt_stats_alltime` | `AllTimeStats` | 累计统计（JSON 序列化，永久保存） |
| `chrome.storage.local` | `wt_stats_daily` | `DailyRecord[]` | 最近 30 天按天汇总（JSON 序列化） |

> **注意**：Session 数据仅保存在 Service Worker 内存中（`_sessions` 字典，按 tabId 索引），不持久化到 `chrome.storage.local`。SW 重启或页面关闭后自动丢失。

### 2.2 SessionStats（单标签页会话）

```js
{
  startedAt: 1717400000000,          // 会话开始时间戳
  calls: 23,                         // API 调用次数
  promptTokens: 18500,               // 输入 token 总量
  completionTokens: 7200,            // 输出 token 总量
  segments: 93,                      // 已翻译段数
  errors: 1,                         // 失败次数
}
```

> 与初版设计相比，去掉了 `batches` 和 `pageUrl` 字段。

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
  { date: "2026-06-03", calls: 150, promptTokens: 120000, completionTokens: 45000, segments: 900, errors: 0, cost: 0.12 },
  { date: "2026-06-02", calls: 200, promptTokens: 160000, completionTokens: 60000, segments: 1200, errors: 1, cost: 0.16 },
  ...
]
```

> 与初版设计相比，增加了 `errors` 字段。

## 三、Token 计数与成本估算

### 3.1 Token 来源

每次 API 响应通过 adapter 的 `parseResponse()` 解析 `usage` 字段，提取 `promptTokens` 和 `completionTokens`：

```js
// openai adapter parseResponse
usage: raw.usage ? {
  promptTokens: raw.usage.prompt_tokens,
  completionTokens: raw.usage.completion_tokens,
} : null
```

> 不使用 `total_tokens`，仅提取输入和输出 token 数。

### 3.2 成本计算公式

按模型名称匹配定价表（`MODEL_PRICING` 常量）：

| 模型 | 输入 $/1K tokens | 输出 $/1K tokens |
|---|---|---|
| gpt-4o | $0.0025 | $0.010 |
| gpt-4o-mini | $0.00015 | $0.0006 |
| gpt-4-turbo | $0.010 | $0.030 |
| gpt-4 | $0.030 | $0.060 |
| gpt-3.5-turbo | $0.0005 | $0.0015 |
| deepseek-chat | $0.00014 | $0.00028 |
| deepseek-reasoner | $0.00055 | $0.00219 |
| claude-3-opus | $0.015 | $0.075 |
| claude-3-sonnet | $0.003 | $0.015 |
| claude-3-haiku | $0.00025 | $0.00125 |
| \_default | $0 | $0 |

```js
cost = (promptTokens * inputPrice + completionTokens * outputPrice) / 1000
```

> 与初版设计相比：新增 gpt-4、gpt-3.5-turbo、deepseek-reasoner、claude-3-sonnet、claude-3-haiku 五个模型；`_default` 定价改为 `{ input: 0, output: 0 }`（即未知模型不估算成本）。

## 四、架构流程

```
┌──────────────────────────────────────────────────────────────┐
│ Content Script                                               │
│   → 发送 TRANSLATE_BATCH                                     │
│   → 接收 TRANSLATE_BATCH_RESULT                              │
└────────────┬─────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────┐
│ Service Worker                                               │
│   → ApiProxy.translateBatch() 调用 LLM                       │
│   → adapter.parseResponse() 解析 usage                       │
│   → StatsTracker.record() 写入内存                           │
│   → 累计 SessionStats (per tabId) + AllTimeStats + Daily     │
│   → 每 10 次调用或 30s 定时 flush 到 chrome.storage.local     │
└────────────┬─────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────┐
│ Popup (左侧导航面板)                                          │
│   → 四标签导航：Model / Translation / Settings / Statistics  │
│   → Statistics 标签读取 AllTimeStats 展示                     │
│   → 通过 sendMessage('GET_STATS') 获取数据                   │
│   → Refresh / Clear All 操作                                  │
└──────────────────────────────────────────────────────────────┘
```

> 与初版设计相比：segments 计数在 SW 中完成（而非 CS）；Popup 通过 `chrome.runtime.sendMessage({ type: 'GET_STATS' })` 获取数据，而非直接读取 `chrome.storage.local`。

## 五、UI 设计

### 5.1 Popup 左侧导航布局

Popup 采用左侧导航栏 + 右侧内容区的布局，共四个标签页：

```
┌──────────────────────────────────────────┐
│  🌐 WebTranslate                         │
├──────┬───────────────────────────────────┤
│      │                                   │
│ Model│  API URL: [____________]          │
│      │  API Key: [____________] [Show]   │
│ Trans│  Model:   [____________]          │
│      │  Adapter: [OpenAI ▾]             │
│ Setng│  [Test] [Save]                    │
│      │                                   │
│ Stats│  (对应标签的内容区)                 │
│  ●   │                                   │
└──────┴───────────────────────────────────┘
```

### 5.2 Statistics 标签页内容

仅展示 All Time 统计（不含 Session / Today 分区）：

```
┌──────────────────────────────┐
│  ALL TIME                    │
│  ┌────────────────────────┐  │
│  │ API Calls    Segments  │  │
│  │   1,523        9,300   │  │
│  │                        │  │
│  │ Tokens In  Tokens Out  │  │
│  │ 1,200,000    450,000   │  │
│  │                        │  │
│  │     $5.6700 est. cost  │  │
│  └────────────────────────┘  │
│                              │
│  [Refresh]    Clear All Stats│
└──────────────────────────────┘
```

> 与初版设计相比：
> - 无 "This Session" 区域
> - 无 "Today" 区域
> - 不展示 Errors 计数（虽在数据中追踪）
> - 无 [Reset Session] 按钮（仅有 Clear All Stats）
> - 无 Stats 导出按钮

### 5.3 FAB 轻量指示器

未实现。FAB 仅显示图标和进度环，不显示段数/Token 数。

## 六、文件变更清单

| 文件 | 变更 | 说明 |
|---|---|---|
| `src/background/stats-tracker.js` | **新建** — 统计记录模块 | ~144 行 |
| `src/background/sw.js` | 修改 — 初始化 StatsTracker，API 调用后 record，处理 GET_STATS/CLEAR_STATS 消息 | +30 行 |
| `src/background/api-proxy.js` | 修改 — parseResponse 返回 usage | +5 行 |
| `src/popup/popup.html` | 修改 — 左侧导航布局 + Statistics 标签页 | 全量重构 |
| `src/popup/popup.js` | 修改 — 读取并渲染 stats | +20 行（stats 部分） |
| `src/shared/constants.js` | 修改 — 添加 MODEL_PRICING 定价表 + estimateCost 函数 | +20 行 |

## 七、定价表可配置

暂未实现。当前定价表硬编码在 `constants.js` 的 `MODEL_PRICING` 中，Settings 面板中无自定义定价 UI。

## 八、注意事项

1. **隐私**：所有数据仅存本地 `chrome.storage.local`，不上传
2. **性能**：`chrome.storage.local` 写入采用批量 flush 策略（每 10 次调用或每 30 秒写一次），而非每 5 次
3. **模型识别**：从配置中读取 `config.model` 匹配 `MODEL_PRICING` 定价表
4. **未知模型**：使用 `_default` 定价行（input/output 均为 0，不估算成本）
5. **Session 管理**：Session 按 tabId 存储在 SW 内存中，无显式重置消息。标签页关闭或 SW 重启后数据自然丢失；首次 `record()` 调用时自动创建新 session
6. **数据序列化**：AllTimeStats 和 DailyRecord 在写入 storage 前经过 `JSON.stringify()`，读取时 `JSON.parse()`
7. **错误记录**：API 调用失败时，仅累加 `errors` 计数，不累加 token 数

---

**本文档已同步至代码实现状态。**
