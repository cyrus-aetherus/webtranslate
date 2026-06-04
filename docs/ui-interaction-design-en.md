# WebTranslate UI Interaction Design

> Version: 1.0 · Last updated: 2026-06-04 · Author: WebTranslate Contributors

---

## 1. Overview

The Floating Action Button (FAB) is the primary entry point for users to interact with the translation engine. This document defines the FAB menu interaction model, state machine transitions, and the complete lifecycle from user action to system response.

---

## 2. Core Design Principles

| Principle | Description |
|---|---|
| **Context-aware** | Menu items change dynamically with translation state — users only see relevant actions |
| **Clear hierarchy** | Each state has a primary button (larger, bold) expressing the most logical next action |
| **No data loss** | Stop preserves translated DOM; Clear removes blocks but keeps cache so re-translation is instant |
| **Tab isolation** | Translation state is per-tab — translating on site A won't auto-start on site B |
| **Closed loop** | Users can freely navigate IDLE → TRANSLATING → PAUSED without getting stuck |

---

## 3. State Machine

```
                startTranslation()
       IDLE ───────────────────────► TRANSLATING
        ▲                               │
        │                          stopTranslation()
        │                               │
        │                               ▼
        │                            PAUSED
        │                          (blocks kept)
        ├── clearTranslations() ───────┘
        │   (remove DOM · keep cache)
        │
        ├── retranslate() ─────────────► TRANSLATING
        │   (remove DOM · clear cache · fresh API calls)
        │
        └── startTranslation() ────────► TRANSLATING
            (cache hit · instant restore)
```

**Key rules:**
- PAUSED is a "safe landing" state: keeps all translated blocks, stops observers and batch processing
- Clear → back to IDLE, cache preserved, re-translation costs zero API calls
- Retranslate → clears cache and DOM, re-requests API for every paragraph

---

## 4. FAB Menu — Dynamic by State

### 4.1 State IDLE

```
            [⬇️ Download]
               |
    [⚙️ Settings] — [🌐 Translate] — [📋 Panel]
                     (primary · bold)
```

| Item | Action |
|---|---|
| 🌐 **Translate** | Start inline translation (primary) |
| 📋 **Panel** | Switch to Panel mode and start |
| ⬇️ **Download** | Download page as ZIP (Markdown + images) |
| ⚙️ **Settings** | Open settings popup |

### 4.2 State TRANSLATING

```
            [⬇️ Download]
               |
    [⚙️ Settings] — [⏹ Stop] — [⇄ Switch]
                     (primary · red emphasis)
```

| Item | Action |
|---|---|
| ⏹ **Stop** | Pause translation → PAUSED, keep blocks (primary) |
| ⇄ **Switch** | One-click mode switch (Inline ↔ Panel) |
| ⬇️ **Download** | Download page |
| ⚙️ **Settings** | Open settings |

### 4.3 State PAUSED

```
            [🗑 Clear]
               |
    [⚙️ Settings] — [🌐 Translate] — [🔄 Retranslate]
                     (primary · bold)
                |_________|
              [⬇️ Download]
```

| Item | Action |
|---|---|
| 🌐 **Translate** | Resume — instant from cache (primary) |
| 🔄 **Retranslate** | Clear cache + DOM, re-translate everything |
| 🗑 **Clear** | Remove blocks, back to IDLE, keep cache |
| ⬇️ **Download** | Download page |
| ⚙️ **Settings** | Open settings |

---

## 5. Five Actions Defined

### 5.1 Translate
| Aspect | Behavior |
|---|---|
| DOM | Extract paragraphs + start IntersectionObserver batching |
| Cache | Hit in order: L1 memory → L2 session → L3 local |
| State | IDLE/PAUSED → TRANSLATING |
| API | Only for cache-miss paragraphs |

### 5.2 Stop
| Aspect | Behavior |
|---|---|
| DOM | Stop adding new blocks, **keep existing translations** |
| Cache | Retain all L1/L2/L3 |
| State | TRANSLATING → PAUSED |
| API | Cancel all in-flight requests |

### 5.3 Clear
| Aspect | Behavior |
|---|---|
| DOM | **Remove all** `.wt-inline-block` and `.wt-pending` elements |
| Cache | **Keep** (L1/L2/L3 retained) |
| State | PAUSED → IDLE |
| API | None |

### 5.4 Retranslate
| Aspect | Behavior |
|---|---|
| DOM | Remove all translation blocks |
| Cache | **Clear current page** L1 |
| State | PAUSED → TRANSLATING |
| API | Re-request all paragraphs |

### 5.5 Switch Mode
| Aspect | Behavior |
|---|---|
| DOM | Preserve cached translations |
| Cache | Retain |
| State | TRANSLATING → TRANSLATING (seamless) |
| API | Continue for un-translated paragraphs |

---

## 6. Tab Isolation

**Problem:** Previously `wt_active` was stored in `chrome.storage.local` (global), so starting translation on one tab auto-started it on every other tab.

**Solution:** Migrated `wt_active` / `wt_autoMode` to `chrome.storage.session`.

| Storage | Lifetime | Scope |
|---|---|---|
| `chrome.storage.session` | Current browser session | **Current tab** |
| `chrome.storage.local` | Permanent | Global (all tabs) |

**Result:**
- ✅ Refresh current page → translation auto-resumes
- ✅ Close tab → translation does NOT auto-start when re-opened
- ✅ Translating on site A → site B does NOT auto-translate

---

## 7. FAB Visual States

| State | Background | Badge | CSS class |
|---|---|---|---|
| IDLE | White `#fff` | Shows "I" or "P" | `wt-idle` |
| TRANSLATING | Light purple `#eaddff` | Shows mode badge | `wt-active` |
| PAUSED | Light yellow `#fef7e0` | Badge hidden | `wt-paused` |
| ERROR | Light red `#f9dedc` | Badge hidden | `wt-error` |

---

## 8. Code Architecture

```
src/content/
  ├── content.js           # Lifecycle controller (start/stop/clear/retranslate/switchMode)
  │                        #   Uses chrome.storage.session for tab isolation
  ├── components/fab.js     # FAB component (dynamic menu, mode badge, state styles)
  ├── state-manager.js      # State machine (IDLE/TRANSLATING/PAUSED/SCANNING/ERROR)
  ├── cache-manager.js      # Three-tier cache (L1 memory / L2 session / L3 local)
  ├── renderers/
  │   └── inline-renderer.js # Inline translation rendering (with clearAll)
  └── extractor/            # Content extractor
```

**Key call chain:**
1. User clicks FAB → `FabComponent` fires callback
2. Callback invokes `startTranslation()` / `stopTranslation()` / `clearTranslations()` / `retranslate()` / `switchMode()`
3. `startTranslation()` writes `chrome.storage.session` → `maybeAutoStart()` only reads from current tab
4. `stopTranslation()` → PAUSED → FAB `updateMenu('PAUSED')` → shows Clear / Retranslate
5. `stateManager.onChange()` → `updateFabState()` → auto-updates FAB menu + badge

---

## 9. Design Decisions

### Why does Clear keep the cache?
Cache is an optimization (reduce API costs). It shouldn't be coupled to user-visible state. "Restore original text" is typically a temporary action, not a permanent abandonment. Keeping cache makes re-translation zero-cost.

### Why add Retranslate?
"Re-translate with a different model" is a real user scenario. Previously required manually clearing cache + re-translating. Now a single button in the PAUSED menu.

### Why does Stop go to PAUSED instead of IDLE?
Previously Stop → IDLE left blocks on the page with no way to clear them (except refreshing). PAUSED adds Clear and Retranslate, forming a complete closed loop.

---

## 10. Future Plans

- [ ] **Keyboard shortcuts**: `Ctrl+Shift+T` toggle translation, `Ctrl+Shift+C` clear blocks
- [ ] **Custom primary action**: Let users configure what clicking the FAB does
- [ ] **Per-block context menu**: Right-click individual blocks to hide or re-translate
- [ ] **Translation history panel**: Log last 10 translation sessions with stats

---

## 11. Panel Mode Slot Model

### Design Rationale

Panel mode displays translations in paragraph extraction order. Since concurrent API batches may return out of order, we use a "placeholder-first, fill-later" slot model to guarantee correct visual order.

### Identification

Each paragraph is identified by its `generateParagraphId`-generated DOM-path ID (`wt_main0_article0_p0`). This is unique within a single `extractParagraphs()` call.

| Identifier | Purpose | Cross-extraction stable |
|---|---|---|
| `id` (DOM path) | Primary slot key, `slotMap.get(id)` O(1) | Stable within a single session |
| `sortOrder` | INIT_SLOTS DOM insertion order | No (ordering only) |

### Message Flow

```
INIT_SLOTS    → panel.js builds slotMap + renders placeholder slots
BATCH_RESULT  → fillSlots fills slots by id
APPEND_SLOTS  → append slots for progressive-loading pages
SLOT_ERROR    → mark failed slots
```

### Closed-Loop Coverage

| Scenario | Handling |
|---|---|
| **Normal translation** | INIT_SLOTS → sequential processor → BATCH_RESULT fill per id |
| **Cache hits** | `_processNextBatch` directly sends `panelRenderer.renderBatch({id, translation})` |
| **Progressive loading / infinite scroll** | `_flushVisible` detects new paragraphs → `appendSlots` → send to translate |
| **API errors** | `handleBatchResult` error → `panelRenderer.markSlotErrors(ids)` → panel shows ⚠️ |
| **Panel close → reopen** | `onPanel` detects TRANSLATING+panel → `reinitPanelSlots()` rebuilds slots + fills cache |
| **SPA route change** | `setupResilience` intercepts `pushState/replaceState/popstate` → stops translation |

### Port Bridge

Content Script (`wt-panel-cs`) ↔ SW ↔ Panel (`wt-panel-receiver`). SW buffers messages when the panel port is not yet connected and flushes them on connect. Only one panel is open at a time, so tabId routing is unnecessary.
