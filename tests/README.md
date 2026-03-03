# PrismOS-AI Test Suite

> Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)

## Test Architecture

PrismOS-AI has two test layers:

| Layer | Language | Runner | Description |
|-------|----------|--------|-------------|
| **Backend (Rust)** | Rust | `cargo test` | Unit + integration tests for Spectrum Graph, Sandbox, You-Port, Agents |
| **Frontend (TypeScript)** | TypeScript | Manual / E2E | Smoke tests and UI verification |

---

## Running Rust Tests

```bash
cd src-tauri
cargo test
```

### What is tested:

- **Spectrum Graph** — Node/edge CRUD, spectral dimension queries, graph persistence, merge/diff engine
- **Sandbox Prisms** — HMAC verification, allow-list enforcement, rollback mechanics
- **You-Port** — Encryption/decryption round-trip, HMAC integrity, device fingerprinting
- **Refractive Core** — Intent parsing, agent routing
- **Agents** — LangGraph DAG execution, message routing, debate rounds

---

## Frontend Smoke Tests

Since PrismOS-AI is a Tauri desktop app, the frontend is best tested by running the app:

```bash
npm run tauri dev
```

### Manual Test Checklist

Use this checklist to verify all features before a release:

#### Startup
- [ ] App shows loading screen with progress animation
- [ ] Loading screen transitions smoothly to main view
- [ ] You-Port auto-restore toast appears if previous session exists
- [ ] Sidebar shows all 6 navigation items
- [ ] Version badge shows v0.2.0

#### Intent Console
- [ ] Welcome screen shows with 3 feature cards
- [ ] Typing text and pressing Enter sends intent
- [ ] Shift+Enter creates newline (does not send)
- [ ] Loading dots appear while processing
- [ ] AI response appears with metadata footer
- [ ] Agent name and processing time shown
- [ ] LangGraph collaboration trace shown in sidebar
- [ ] Debate panel appears when agents debate
- [ ] Clear button removes all messages
- [ ] Error message shows troubleshooting steps when Ollama is offline

#### Spectrum Graph (Force-Directed)
- [ ] Graph renders with nodes and edges
- [ ] Nodes are colored by facet type
- [ ] Click node → side panel shows details
- [ ] Edge weight reinforcement (+/−) works
- [ ] Anticipatory needs section appears
- [ ] Legend shows all node types
- [ ] Metrics bar shows at bottom
- [ ] Refresh button re-fetches graph
- [ ] "Open in new window" button works (↗)

#### Spectrum Explorer
- [ ] Node list shows all graph nodes
- [ ] Search filters nodes by label/content
- [ ] Click node → detail panel shows info
- [ ] Add Node form works (label, content, type)
- [ ] Delete node button removes from graph
- [ ] Edge connections shown for selected node

#### Sandbox Prisms
- [ ] Create Prism creates sandbox instance
- [ ] Execute runs code in sandbox
- [ ] Results show success/failure with badges
- [ ] Rollback button triggers rollback
- [ ] WASM isolation badge visible

#### Spectral Timeline
- [ ] Timeline loads with date-grouped events
- [ ] Search filters events
- [ ] Type filter dropdown works
- [ ] Sort by newest/oldest works
- [ ] Refresh button re-fetches
- [ ] "Open in new window" button works

#### Settings
- [ ] Ollama URL configurable
- [ ] Model selector loads and switches models
- [ ] Theme toggle (dark mode)
- [ ] Voice input/output toggles
- [ ] Export Graph (encrypted) downloads .prismos file
- [ ] Import Graph loads from .prismos file
- [ ] Clear Graph shows confirm → then clears
- [ ] Multi-Device Sync section:
  - [ ] Enter passphrase
  - [ ] Export Sync Package downloads .prismos-sync file
  - [ ] Load sync file from disk
  - [ ] Preview Merge shows diff stats and conflicts
  - [ ] Apply Merge runs merge with selected strategy
  - [ ] Strategy selector (Latest/Theirs/Ours) works
- [ ] Patent notice visible
- [ ] Version banner shows v0.2.0

#### Accessibility
- [ ] Tab navigation moves through all interactive elements
- [ ] Focus ring visible on keyboard navigation
- [ ] Screen reader announces status changes
- [ ] Skip link appears on Tab from page load
- [ ] No keyboard traps

#### Voice I/O
- [ ] Microphone button appears when voice enabled
- [ ] Click mic → listening indicator appears
- [ ] Speaking → interim transcript shown
- [ ] Final transcript auto-submits
- [ ] Voice output speaks AI responses when enabled
- [ ] Stop speaking button works

---

## Adding New Tests

### Rust unit tests

Add `#[cfg(test)]` modules at the bottom of any `.rs` file:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_my_feature() {
        // ...
    }
}
```

### Future: Automated E2E Tests

For automated E2E testing, consider:
- [Tauri's WebDriver testing](https://tauri.app/v2/guides/test/webdriver/)
- [Playwright](https://playwright.dev/) for frontend UI tests
- [cargo-nextest](https://nexte.st/) for faster Rust test execution
