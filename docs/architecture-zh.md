# WebTranslate 系统架构

> 中文版 | [English Version](./architecture-en.md)

## 概览

WebTranslate 是一款基于 Manifest V3 的 Chrome 浏览器扩展，利用大语言模型（LLM）提供网页翻译功能。整体架构遵循典型的浏览器扩展三层模型：**UI 层** → **内容脚本层** → **Service Worker 层**，各层职责清晰，并具备完善的容错机制。

---

## 高层架构图

```mermaid
flowchart TB
    subgraph External["外部服务"]
        LLM["大模型 API<br/>OpenAI / DeepSeek / Anthropic"]
    end

    subgraph Browser["浏览器 API"]
        Storage[("chrome.storage<br/>local / session")]
        SidePanel["chrome.sidePanel"]
        Downloads["chrome.downloads"]
    end

    subgraph UILayer["UI 层"]
        Popup["Popup 弹窗<br/>设置与统计"]
        Panel["侧边栏<br/>双语对照列表"]
        FAB["FAB 悬浮按钮<br/>用户交互入口"]
    end

    subgraph ContentLayer["内容脚本层 (页面上下文)"]
        Extractor["提取引擎<br/>根节点查找 + 扫描"]
        BatchCollector["批量收集器<br/>IntersectionObserver"]
        StateManager["状态管理器<br/>状态机"]
        CacheManager["缓存管理器<br/>L1/L2/L3 三级缓存"]
        Concurrency["并发控制器<br/>队列 (最大 3)"]
        CircuitBreaker["断路器<br/>连续 5 次失败暂停"]
        InlineRenderer["内联渲染器<br/>Shadow DOM 注入"]
        PanelRenderer["面板渲染器<br/>Port 通信"]
        ObserverManager["观察管理器<br/>MutationObserver"]
        DownloadTrigger["下载触发器<br/>Markdown + ZIP"]
    end

    subgraph ServiceLayer["Service Worker 层 (后台)"]
        ApiProxy["API 代理<br/>适配器 + 重试"]
        DownloadManager["下载管理器<br/>JSZip 打包"]
        StatsTracker["统计追踪器<br/>Token / 费用"]
        ConfigStore["配置存储<br/>设置持久化"]
    end

    Popup <-->|chrome.runtime.sendMessage| ServiceLayer
    Panel <-->|Port| PanelRenderer
    FAB <-->|用户交互| StateManager

    StateManager --> Extractor
    Extractor --> BatchCollector
    BatchCollector --> CacheManager
    CacheManager -->|缓存未命中| Concurrency
    Concurrency -->|TRANSLATE_BATCH| ApiProxy
    ApiProxy -->|HTTP + AbortController| LLM
    ApiProxy -->|响应| InlineRenderer
    ApiProxy -->|响应| PanelRenderer
    ApiProxy -->|Token 用量| StatsTracker

    StateManager --> CircuitBreaker
    CircuitBreaker -->|触发| StateManager
    ObserverManager -->|SPA 动态变更| Extractor

    DownloadTrigger -->|DOWNLOAD| DownloadManager
    DownloadManager -->|ZIP + 图片| Downloads
    StatsTracker -->|GET_STATS| Popup
    ConfigStore -->|存储| Storage
    CacheManager -->|L2/L3| Storage
```

---

## 组件职责

| 组件 | 层级 | 职责 |
|------|------|------|
| **Popup** | UI | 4 标签设置面板（模型 / 翻译 / 设置 / 统计）。配置校验、连接测试、导入导出。 |
| **侧边栏** | UI | 双语对照翻译列表，支持复制原文/译文、定位到页面段落。 |
| **FAB** | UI | Material 3 悬浮操作按钮，支持拖拽定位、扇形菜单、进度环、随状态变色。 |
| **提取引擎** | 内容脚本 | 多候选内容根节点检测 + 深度 DOM 扫描。提取语义段落，自动排除导航/页脚/代码块。 |
| **批量收集器** | 内容脚本 | 基于 IntersectionObserver 的懒加载收集。防抖批次：最多 8 段、≤800 字符、100ms 防抖。 |
| **状态管理器** | 内容脚本 | 受保护的状态机：`IDLE → SCANNING → TRANSLATING ↔ PAUSED → ERROR`。 |
| **缓存管理器** | 内容脚本 | 三级缓存：L1（内存 Map）→ L2（`chrome.storage.session`）→ L3（`chrome.storage.local`）。LRU 淘汰：每页 500 条、最多 10 页。 |
| **并发控制器** | 内容脚本 | 基于 Promise 的队列，限制并发 API 批次为 3。 |
| **断路器** | 内容脚本 | 连续 5 次失败后触发，切换为 `PAUSED` 状态，防止频繁请求 API。 |
| **内联渲染器** | 内容脚本 | 使用 Shadow DOM 将译文插入原文下方，实现样式隔离，不污染原页面。 |
| **面板渲染器** | 内容脚本 | 通过 Chrome Port API 将翻译结果发送至侧边栏。 |
| **观察管理器** | 内容脚本 | MutationObserver 检测 SPA 动态内容变化，触发重新提取。 |
| **下载触发器** | 内容脚本 | 通过 turndown.js 生成 Markdown，并触发后台 ZIP 打包流程。 |
| **API 代理** | Service Worker | 大模型 API 适配器模式。指数退避重试（2 次，1s→3s）、429 限流处理、AbortController 取消。 |
| **下载管理器** | Service Worker | 抓取页面图片，使用 JSZip 打包，转换为 base64 Data URL 后通过 `chrome.downloads` 触发下载。 |
| **统计追踪器** | Service Worker | 内存级会话统计 + 持久化累计/每日统计。定期刷写到 `chrome.storage.local`。 |
| **配置存储** | Service Worker | `chrome.storage.local` 的简单封装，带内存缓存。 |

---

## 数据流：翻译请求

```mermaid
sequenceDiagram
    actor User as 用户
    participant FAB as FAB
    participant StateManager as 状态管理器
    participant Extractor as 提取引擎
    participant BatchCollector as 批量收集器
    participant CacheManager as 缓存管理器
    participant Concurrency as 并发控制器
    participant ApiProxy as API 代理
    participant LLM as 大模型 API
    participant InlineRenderer as 内联渲染器
    participant PanelRenderer as 面板渲染器

    User->>FAB: 点击翻译
    FAB->>StateManager: setState(TRANSLATING)
    StateManager->>Extractor: extractParagraphs()
    Extractor->>BatchCollector: 产出段落
    BatchCollector->>BatchCollector: IntersectionObserver<br/>懒加载分批
    BatchCollector->>CacheManager: check(指纹)
    alt 缓存命中
        CacheManager-->>InlineRenderer: 返回缓存译文
        CacheManager-->>PanelRenderer: 返回缓存译文
    else 缓存未命中
        CacheManager->>Concurrency: enqueue(批次)
        Concurrency->>ApiProxy: TRANSLATE_BATCH
        ApiProxy->>ApiProxy: 构建含<br/>───SEP:{指纹}─── 的 Prompt
        ApiProxy->>LLM: HTTP POST + AbortController
        LLM-->>ApiProxy: 翻译结果
        ApiProxy->>ApiProxy: 按分隔符解析
        ApiProxy-->>CacheManager: store(结果)
        ApiProxy-->>InlineRenderer: render(批次)
        ApiProxy-->>PanelRenderer: update(面板)
    end
```

---

## 状态机

```mermaid
stateDiagram-v2
    [*] --> IDLE : 初始化
    IDLE --> SCANNING : start() 开始扫描
    SCANNING --> TRANSLATING : 首批就绪
    TRANSLATING --> PAUSED : 用户暂停 / 断路器触发
    PAUSED --> TRANSLATING : resume() 恢复
    TRANSLATING --> IDLE : 全部完成
    PAUSED --> IDLE : stop() 停止
    TRANSLATING --> ERROR : 不可恢复错误
    ERROR --> IDLE : reset() 重置
    SCANNING --> IDLE : stop() 停止
```

---

## 缓存层级

```mermaid
flowchart LR
    A["内容脚本<br/>请求"] --> B{"L1 内存<br/>Map"}
    B -->|命中| Z["返回结果"]
    B -->|未命中| C{"L2 会话<br/>chrome.storage.session"}
    C -->|命中| B
    C -->|未命中| D{"L3 本地<br/>chrome.storage.local"}
    D -->|命中| C
    D -->|未命中| E["大模型 API<br/>请求"]
    E --> D
```

---

## 构建流程

```mermaid
flowchart LR
    A["src/ 源码"] -->|Vite 打包| B["ESM 模块"]
    B -->|Postbuild 插件| C["content.js (IIFE)"]
    C -->|复制资源| D["dist/ 输出"]
    D -->|生成| E["dist/manifest.json"]
```

> 注意：内容脚本使用 IIFE 格式打包（而非 ES 模块），因为 Manifest V3 的内容脚本不支持 `type="module"`。

---

## 安全模型

```mermaid
flowchart TB
    subgraph Isolation["样式与 DOM 隔离"]
        ShadowDOM["Shadow DOM<br/>内联渲染器"]
        DOMPurify["DOMPurify<br/>内容净化"]
    end

    subgraph StorageSecurity["安全存储"]
        LocalOnly["API Key：仅存储于 chrome.storage.local"]
        HTTPS["强制 HTTPS"]
    end

    subgraph ErrorResilience["容错机制"]
        Retry["指数退避重试<br/>最多 2 次"]
        CB["断路器<br/>5 次失败 → 暂停"]
        RateLimit["429 限流<br/>处理"]
    end
```
