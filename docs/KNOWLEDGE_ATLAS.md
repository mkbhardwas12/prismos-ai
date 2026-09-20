# Knowledge atlas

The Graph view is a local browser for the knowledge already stored in PrismOS. Its design takes inspiration from the [reference knowledge-graph video](https://x.com/nateherk/status/2096784468220535295/video/1): source colors, prominent hubs, orbitable 3D, search and an adjacent note inspector. It also has a 2D view and keyboard-accessible note list.

## Explore and trace

- Choose **Connected**, **Unconnected**, or **All records**. When unconnected records dominate a nonempty linked graph, the initial view opens on Connected. Counts always make the scope explicit; search still reaches all records. Choosing a search result in the opposite scope reveals it there.
- Unconnected records have no stored relationships. Their proximity on the canvas is not a connection. The unconnected view opens its browsable list, prioritizes notes over legacy suggestion cards, and disables actions that require a recorded path.
- Search titles, content and stored source metadata. Search spans the complete loaded snapshot, not only rendered nodes. Press `/` to focus search and Escape to clear it.
- Toggle source/group colors to narrow the view. Selecting an already-visible note preserves those filters; searching a hidden source reveals that source.
- Select a note to immediately highlight its connected neighborhood while preserving the surrounding map and settled positions. Its direct links become brighter and thicker, with arrows showing stored direction. Gold takes priority for traced paths. The legend distinguishes recorded links, selected-note links and traced paths; animation does not imply an agent is executing work.
- The adjacent inspector shows content, source group, timestamps, type and connected notes, plus how many of its relationships are currently visible. If filters hide links, it explains this instead of implying the relationships do not exist. Long notes and connection lists can be expanded.
- Use **Focus connections** to show a note and its direct neighbors. Use **Start path here**, select another note, then **Trace to this note** to follow the shortest recorded path. Navigation can follow links in either direction; it is not a claim about execution order or causality.
- **Review connections** requests heuristic suggestions. Suggestions are separate from recorded links until the user chooses **Record connection**. Relationship details retain explicit strengthen/weaken feedback; weights are learning signals, not verified confidence.
- After recording a suggested relationship, the map reveals the connected endpoints. No links are added just to make a sparse graph look connected.
- **Review suggested** means no update for at least 90 days, an unknown update date, or no recorded connections. It does not assert that a note is wrong or obsolete.

There are no synthetic hubs or invented knowledge links in the production view. Larger nodes have more distinct neighbors. Groups come from indexed-file metadata, explicit project membership, or note type—not a hardcoded list of the developer's projects. Files with the same basename remain distinguishable. Colors are supplemented by labels and counts.

Automatic labels are a bounded, per-group sample, including small isolated records where appropriate. These labels are not synthetic hubs. In 2D, automatic labels avoid one another and reserve space for the selected title. Duplicate-title search results include date and content excerpts for disambiguation.

## Why a graph can appear disconnected

The former latest-500-record display could select only unconnected suggestion cards, hiding older linked knowledge. It was also possible for every proactive-card refresh to persist a fresh batch of suggestion nodes. The current implementation reads the complete graph, explicitly separates linked and unlinked records, and makes proactive card generation read-only with stable display IDs.

Legacy suggestion rows are preserved for inspection and export. They are excluded from answer retrieval, embedding backfill, new suggestion candidates, edge predictions, automatic layer promotion and startup deduplication. This prevents machine-generated cards from recycling into evidence without deleting historical data. Explicitly saved notes and conversations are unchanged.

## Architecture and limits

| Layer                      | Responsibility                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `spectrum_graph.rs`        | Complete database snapshots, exact relationship identity, atomic deduplication and validated imports |
| `knowledgeGraph.ts`        | Pure grouping, degree calculation, integrity diagnostics, bounded search results and path traversal  |
| `SpectrumGraphView.tsx`    | Filters, search, inspector, explicit feedback and suggestion controls                                |
| `KnowledgeGraphScene*.tsx` | Separate mutable layout cache, 2D canvas and lazy-loaded 3D/WebGL rendering                          |

Full snapshots are no longer silently truncated at 500 nodes / 1,000 edges. A single SQLite read transaction keeps nodes, links and metrics consistent even while another connection ingests knowledge. The renderer displays at most 1,200 nodes in a filter and explicitly reports that limit; the complete snapshot remains available to search and paths. The result list is capped at 80 matches; narrow the query for more specific results. The model excludes dangling and repeated logical links from the display and reports those counts without changing storage.

Layout coordinates and renderer-resolved endpoints never mutate the knowledge model. Selection and appearance changes preserve the settled layout; structural changes, explicit centering and resizing fit the map. If WebGL cannot initialize, the view offers the 2D map. A narrow app window places note details beneath the canvas.

The 3D dependency is loaded on demand. It is still a substantial bundle; extremely large graphs may need future server-side paging or aggregation beyond the explicit display cap. The atlas visualizes stored records, not hidden model reasoning or a real-time agent execution trace. It does not add a new ingestion, model-training or web-research pipeline.

## Privacy and recovery

Exploration invokes the local graph-read command. This view adds no network endpoint, telemetry, cloud source connector, file opener, Git synchronization or automatic model invocation. It stores only dimension and label-display preferences in local storage—not note text, searches, source paths, selected IDs or inferred relationships. Text is rendered as text, and library HTML tooltips are disabled.

Private knowledge, database files, exports, training data and the private-terms list remain excluded from public source control under the repository ignore rules. Ignore rules do not encrypt data, remove previously committed files or secure the whole application. No personal knowledge was copied into this implementation or its tests.

Recovery fixes:

1. JSON graph loading, encrypted graph import and You-Port restore now share an ID-preserving, transactional snapshot importer. Relationships keep their original endpoints, IDs and metadata on a fresh restore.
2. Empty/duplicate IDs, missing relationship endpoints and conflicting existing record identities/content reject the entire import. Nothing from that import is partially applied.
3. Compatible existing IDs keep local timestamps, access counts and edge weights; imports are a merge, not an overwrite or rollback of newer local metadata. To recover an exact historical graph, use a separate empty application-data location and validate it before replacing a live installation.
4. Automatic deduplication only consolidates identical label/type/content/layer fragments, retaining different notes or sources with the same title. The operation is transactional.
5. Directed links match source, target and relation. Deliberately symmetric co-reference/co-occurrence/context associations use a separate explicit undirected helper.

Encryption/key management and backup destinations are unchanged. This work does not create or upload a Git backup, and does not claim disaster recovery for data outside the graph snapshot. Previously discarded notes or relationships cannot be reconstructed without an intact backup.

## Build and recognize the desktop app

On macOS, run `bash scripts/build-local-app.sh` or double-click `build-prismos-app.command`. The helper builds the checked-out source without fetching, merging or pulling Git changes. Before bundling, it preserves the previous app **code bundle only** in a fresh owner-only folder under the user's local Application Support directory, outside this checkout. This is not a database backup.

The helper stops on build errors, keeps an ignored local build log, and verifies the new executable hash, bundle identifier and build timestamp. It does not quit, launch or restart an app. Fully **Quit** the running PrismOS before opening the exact app path printed by the helper; closing the window only hides it to the tray. The graph header displays **Knowledge atlas 2** and its build date, with the full timestamp in its tooltip. Rebuilding source does not update an already-running process.

For a knowledge backup while SQLite is running, use SQLite's online backup facility; copying only the database file can omit committed data still in its WAL. Alternatively, fully quit the app before making a complete, private application-data backup. Keep backups outside the public repository and protect encryption keys separately. This build helper intentionally does not access the database.

## Verification

Run `npm test`, `npm run build`, and, inside `src-tauri`, `cargo test spectrum_graph::tests` and `cargo test you_port::tests`.

Verified on September 8, 2026: 265 frontend tests, 78 graph-storage tests, one proactive-command test and 10 You-Port tests passed. The proactive-command regression polls 60 times and verifies that no graph rows or relationships are added. The production frontend and macOS app bundle built successfully. Synthetic development and production browser checks exercise sparse-graph scope switching, zero-edge guidance, duplicate-title evidence, and read-only exploration; the production WebGL-unavailable test successfully falls back to 2D. Selection checks verify immediate neighborhood highlighting without filtering out the surrounding map, accurate visible-link counts, both renderers and clearing selection. Production exploration makes no external requests.

Regression coverage includes complete snapshots with 601 nodes / 1,202 edges, encrypted fresh-graph restoration, import conflicts/rollback, distinct same-title content, relationship identity, source grouping, search beyond the display cap, read-only exploration, suggestion refresh races and renderer stability. Browser checks use explicitly synthetic records and exercise 3D, 2D, focus, tracing, filters, inspection and narrow-window layout. No live database is used for those checks.

The production npm dependency audit is clean after updating the shared graph utility dependency. The pre-existing development-tool audit still reports findings (including Vite/esbuild and Vitest); resolving those requires a separately tested toolchain update. Keep development servers private and do not expose the test UI to untrusted clients. This document is not a whole-application security certification.
