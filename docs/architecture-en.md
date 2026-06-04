# WebTranslate System Architecture

> English version | [中文版](./architecture-zh.md)

## Overview

WebTranslate is a Chrome Extension (Manifest V3) that provides LLM-powered webpage translation. The architecture follows a three-layer extension model: **UI Layer** → **Content Script Layer** → **Service Worker Layer**, with clear separation of concerns and resilient error handling.

---

## High-Level Architecture

```mermaid
flowchart TB
    subgraph External["External Services"]
        LLM["LLM APIs<br/>OpenAI / DeepSeek / Anthropic"]
    end

    subgraph Browser["Browser APIs"]
        Storage[("chrome.storage<br/>local / session")]
        SidePanel["chrome.sidePanel"]
        Downloads["chrome.downloads"]
    end

    subgraph UILayer["UI Layer"]
        Popup["Popup<br/>Settings & Stats"]
        Panel["Side Panel<br/>Bilingual List"]
        FAB["FAB<br/>Floating Action Button"]
    end

    subgraph ContentLayer["Content Script Layer (Page Context)"]
        Extractor["Extractor Engine<br/>Root Finder + Scanner"]
        BatchCollector["BatchCollector<br/>IntersectionObserver"]
        StateManager["StateManager<br/>State Machine"]
        CacheManager["CacheManager<br/>L1/L2/L3 Cache"]
        Concurrency["ConcurrencyController<br/>Queue (max 3)"]
        CircuitBreaker["CircuitBreaker<br/>Pause after 5 failures"]
        InlineRenderer["InlineRenderer<br/>Shadow DOM Injection"]
        PanelRenderer["PanelRenderer<br/>Port Communication"]
        ObserverManager["ObserverManager<br/>MutationObserver"]
        DownloadTrigger["DownloadTrigger<br/>Markdown + ZIP"]
    end

    subgraph ServiceLayer["Service Worker Layer (Background)"]
        ApiProxy["ApiProxy<br/>Adapter + Retry"]
        DownloadManager["DownloadManager<br/>JSZip Packaging"]
        StatsTracker["StatsTracker<br/>Token / Cost"]
        ConfigStore["ConfigStore<br/>Settings Persistence"]
    end

    Popup <-->|chrome.runtime.sendMessage| ServiceLayer
    Panel <-->|Port| PanelRenderer
    FAB <-->|User Interaction| StateManager

    StateManager --> Extractor
    Extractor --> BatchCollector
    BatchCollector --> CacheManager
    CacheManager -->|Cache Miss| Concurrency
    Concurrency -->|TRANSLATE_BATCH| ApiProxy
    ApiProxy -->|HTTP + AbortController| LLM
    ApiProxy -->|Response| InlineRenderer
    ApiProxy -->|Response| PanelRenderer
    ApiProxy -->|Token Usage| StatsTracker

    StateManager --> CircuitBreaker
    CircuitBreaker -->|Trip| StateManager
    ObserverManager -->|SPA Changes| Extractor

    DownloadTrigger -->|DOWNLOAD| DownloadManager
    DownloadManager -->|ZIP + Images| Downloads
    StatsTracker -->|GET_STATS| Popup
    ConfigStore -->|Storage| Storage
    CacheManager -->|L2/L3| Storage
```

---

## Component Responsibilities

| Component | Layer | Responsibility |
|-----------|-------|----------------|
| **Popup** | UI | 4-tab settings panel (Model / Translation / Settings / Statistics). Config validation, connection testing, export/import. |
| **Side Panel** | UI | Bilingual translation list with copy and scroll-to-paragraph actions. |
| **FAB** | UI | Material 3 floating action button with drag positioning, radial menu, progress ring, and state-based theming. |
| **Extractor** | Content Script | Multi-candidate content root detection + deep DOM scanning. Extracts semantic paragraphs while excluding nav/header/footer/code. |
| **BatchCollector** | Content Script | IntersectionObserver-based lazy collection. Debounced batching: max 8 items, ≤800 chars, 100ms debounce. |
| **StateManager** | Content Script | Guarded state machine: `IDLE → SCANNING → TRANSLATING ↔ PAUSED → ERROR`. |
| **CacheManager** | Content Script | Three-tier cache: L1 (memory Map) → L2 (`chrome.storage.session`) → L3 (`chrome.storage.local`). LRU eviction: 500 entries/page, 10 pages max. |
| **ConcurrencyController** | Content Script | Promise-based queue limiting concurrent API batches to 3. |
| **CircuitBreaker** | Content Script | Trips after 5 consecutive failures, triggers `PAUSED` state to prevent API hammering. |
| **InlineRenderer** | Content Script | Inserts translated text below original paragraphs using Shadow DOM for style isolation. |
| **PanelRenderer** | Content Script | Sends translations to Side Panel via Chrome Port API. |
| **ObserverManager** | Content Script | MutationObserver detects SPA dynamic content changes and triggers re-extraction. |
| **DownloadTrigger** | Content Script | Generates Markdown via turndown.js and triggers background ZIP packaging. |
| **ApiProxy** | Service Worker | Adapter pattern for LLM APIs. Exponential backoff retry (2 retries, 1s→3s), 429 handling, AbortController cancellation. |
| **DownloadManager** | Service Worker | Fetches images, builds ZIP with JSZip, converts to base64 Data URL for `chrome.downloads`. |
| **StatsTracker** | Service Worker | In-memory session stats + persistent all-time/daily stats. Periodic flush to `chrome.storage.local`. |
| **ConfigStore** | Service Worker | Simple `chrome.storage.local` wrapper with in-memory caching. |

---

## Data Flow: Translation Request

```mermaid
sequenceDiagram
    actor User
    participant FAB
    participant StateManager
    participant Extractor
    participant BatchCollector
    participant CacheManager
    participant Concurrency
    participant ApiProxy
    participant LLM
    participant InlineRenderer
    participant PanelRenderer

    User->>FAB: Click Translate
    FAB->>StateManager: setState(TRANSLATING)
    StateManager->>Extractor: extractParagraphs()
    Extractor->>BatchCollector: yield paragraphs
    BatchCollector->>BatchCollector: IntersectionObserver<br/>lazy batching
    BatchCollector->>CacheManager: check(fingerprint)
    alt Cache Hit
        CacheManager-->>InlineRenderer: return cached
        CacheManager-->>PanelRenderer: return cached
    else Cache Miss
        CacheManager->>Concurrency: enqueue(batch)
        Concurrency->>ApiProxy: TRANSLATE_BATCH
        ApiProxy->>ApiProxy: Build prompt with<br/>───SEP:{fp}─── protocol
        ApiProxy->>LLM: HTTP POST + AbortController
        LLM-->>ApiProxy: Translated text
        ApiProxy->>ApiProxy: Parse separators
        ApiProxy-->>CacheManager: store(result)
        ApiProxy-->>InlineRenderer: render(batch)
        ApiProxy-->>PanelRenderer: update(panel)
    end
```

---

## State Machine

```mermaid
stateDiagram-v2
    [*] --> IDLE
    IDLE --> SCANNING : start()
    SCANNING --> TRANSLATING : first batch ready
    TRANSLATING --> PAUSED : user pause / circuit breaker trip
    PAUSED --> TRANSLATING : resume()
    TRANSLATING --> IDLE : all done
    PAUSED --> IDLE : stop()
    TRANSLATING --> ERROR : unrecoverable error
    ERROR --> IDLE : reset()
    SCANNING --> IDLE : stop()
```

---

## Cache Hierarchy

```mermaid
flowchart LR
    A["Content Script<br/>Request"] --> B{"L1 Memory<br/>Map"}
    B -->|Hit| Z["Return"]
    B -->|Miss| C{"L2 Session<br/>chrome.storage.session"}
    C -->|Hit| B
    C -->|Miss| D{"L3 Local<br/>chrome.storage.local"}
    D -->|Hit| C
    D -->|Miss| E["LLM API<br/>Request"]
    E --> D
```

---

## Build Pipeline

```mermaid
flowchart LR
    A["src/"] -->|Vite| B["ESM Bundles"]
    B -->|Postbuild Plugin| C["content.js (IIFE)"]
    C -->|Copy Assets| D["dist/"]
    D -->|Generate| E["dist/manifest.json"]
```

> Note: Content scripts are bundled as IIFE (not ES modules) because Manifest V3 does not support `type="module"` for content scripts.

---

## Security Model

```mermaid
flowchart TB
    subgraph Isolation["Style & DOM Isolation"]
        ShadowDOM["Shadow DOM<br/>InlineRenderer"]
        DOMPurify["DOMPurify<br/>Sanitization"]
    end

    subgraph StorageSecurity["Secure Storage"]
        LocalOnly["API Key: chrome.storage.local only"]
        HTTPS["HTTPS enforced"]
    end

    subgraph ErrorResilience["Error Resilience"]
        Retry["Exponential Backoff<br/>2 retries"]
        CB["Circuit Breaker<br/>5 failures → PAUSE"]
        RateLimit["429 Rate Limit<br/>Handling"]
    end
```
