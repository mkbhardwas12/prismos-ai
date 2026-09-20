# A traceable knowledge graph: real links and meaningful views

Reviewed: 2026-09-08. Classification: public reference; original design guidance.

A knowledge graph represents records and explicit relationships. Useful relationship types include source-contains-chunk, chunk-follows-chunk, project-uses-component, claim-supported-by-source and user-confirmed association. An attractive line should not imply evidence that does not exist. Inferred associations need a distinct status, confidence interpretation and confirmation path.

Stable IDs, endpoint validation and transactions protect relationship integrity. Reimporting a source should reuse its records and edges. Conflicting identities should stop a merge rather than silently attach an edge to the wrong concept. Orphan counts and missing endpoints are data-quality signals.

An explorable view combines readable labels, type or project colors, real edge rendering, hover details, search, source filters, a selected-node neighborhood, directional labels, and path tracing. For large datasets, a connected view or grouped overview is clearer than thousands of identical dots. Always disclose filtering and rendering limits; isolated nodes may be legitimate and should remain accessible.

Selection should preserve spatial context and emphasize the chosen neighborhood. Edge details should explain why two nodes are connected and where the relationship came from. A graph improves retrieval through provenance and navigation, not through the number of decorative links. Synthetic demonstration data must not be confused with the user's real knowledge.
