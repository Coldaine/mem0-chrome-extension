# Project Rename And Boundaries

## Summary

This repository should be treated as the starting chassis for a larger browser-conversation capture and memory system, not as a long-term "Mem0 Chrome Extension" product. The current name is misleading because the target architecture is broader than a Mem0-specific browser plugin, while still intentionally shipping only a Chromium browser implementation in v1.

## Rename Direction

The project should be renamed to reflect the actual product boundary:

- It is a browser conversation capture and augmentation system.
- It archives raw conversations into the existing LLM archival PostgreSQL system.
- It uses Mem0 as a semantic memory subsystem, not as the full application architecture.
- It relies on a background daemon / centralized local service.

Candidate naming direction:

- avoid `mem0-*` as the primary project identity
- avoid `chrome-extension` as the full product identity unless the daemon is split into a separate repo
- prefer a product name that can describe:
  - browser-native capture
  - conversation archival
  - memory injection / augmentation
  - agent-friendly query surfaces

## Boundary Decisions

### Browser scope

V1 is Chromium-only.

- Chrome / Edge / Brave are acceptable targets if they work under the same Chromium extension model.
- No separate Firefox, Safari, or desktop-only implementation is planned for v1.
- The browser component is still the authenticated capture edge.

### Runtime shape

The extension is not the whole system.

- The browser extension handles:
  - in-page provider capture
  - thread snapshotting
  - live message / edit / regeneration observation
  - inline pre-send context review and injection
- A background daemon / centralized local service handles:
  - event ingestion
  - normalization
  - deduplication
  - archival writes
  - Mem0 integration
  - MCP and other external query surfaces

### Canonical storage

The canonical raw conversation archive lives in the existing LLM archival PostgreSQL database.

- Use a new schema for browser-origin conversation capture.
- Do not treat Mem0 as the raw conversation source of truth.
- Mem0 remains the semantic memory layer.

### Memory injection

The system does inject memory/context into supported websites.

- Retrieval can warm while typing.
- Final injection remains manual-confirm in v1.
- The injection UI should be inline near the composer, not buried in a separate dashboard.

## Extension Strategy

Do not stand the browser extension up from scratch.

- Reuse the existing extension shell from this repository:
  - manifest
  - provider registration
  - content-script entrypoints
  - background messaging skeleton
  - UI anchoring / shadow DOM patterns
- Replace the current backend and memory assumptions with the new architecture.
- Pull provider extraction ideas from Loominary and other existing browser tooling where useful.

## Non-goals

- No attempt to make this a generic non-browser memory system in v1.
- No requirement for a second non-browser capture implementation.
- No attempt to make the extension itself the durable archive.
