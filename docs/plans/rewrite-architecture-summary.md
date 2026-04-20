# Rewrite Architecture Summary

## Current state

Work completed so far is primarily architectural and planning work.

Changes made in this repository:

- added a project-boundary and rename plan
- added a browser-driving / OpenAPI investigation plan

No runtime code has been changed yet.

## Decisions already made

### System shape

The future system is not just a browser extension.

- browser extension is the authenticated in-page runtime
- a local Python async daemon is the central service
- canonical raw conversations are stored in the existing LLM archival PostgreSQL database
- Mem0 is used as the semantic memory layer
- MCP is exposed from the local service as a query surface

### Archive boundary

Raw browser-captured conversations do not live in Mem0.

- the source of truth for raw threads is LLM archival Postgres
- use a new schema for browser-origin capture
- Mem0 stores derived memory and supports retrieval

### Browser boundary

V1 is Chromium-only.

- no separate Firefox or Safari implementation is planned in v1
- the extension captures from authenticated browser sessions on supported sites
- the extension also handles in-page context injection UI

### Injection behavior

Prompt-context injection is part of scope.

- retrieval can warm while typing
- final injection is manual-confirm in v1
- confirmation UI should be inline near the composer

### Build strategy

Do not build the extension shell from scratch.

- use this repository as the extension chassis
- keep the boring browser-extension scaffolding where useful
- replace the backend/storage assumptions
- transplant good provider extraction ideas from Loominary and other existing browser tooling

### Browser-driving tools

Browser-driving tools are a side investigation, not the primary v1 runtime path.

- evaluate tools like Anchor and browser-use style systems
- prefer wrapping them behind OpenAPI-compatible endpoints if adopted
- use them for orchestration, testing, fallback extraction, or later tooling

## What exists now in docs

- [project-rename-and-boundaries.md](./project-rename-and-boundaries.md)
- [browser-driving-openapi-investigation.md](./browser-driving-openapi-investigation.md)
- [implementation-roadmap.md](./implementation-roadmap.md)
- [provider-adapter-spec.md](./provider-adapter-spec.md)
- [local-daemon-interfaces.md](./local-daemon-interfaces.md)
- [testing-strategy.md](./testing-strategy.md)

## Recommended next documentation additions

The next most valuable docs would be:

- naming / repo split decision once the daemon repo boundary becomes concrete
- provider-specific notes for ChatGPT and Claude as the likely first implementation targets
- a Postgres schema draft for browser-origin capture tables
- a Mem0 sync policy note defining exactly what becomes memory versus what remains archive-only
