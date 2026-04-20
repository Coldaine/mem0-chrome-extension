# Implementation Roadmap

## Summary

This roadmap converts the current extension into a browser-native capture shell backed by a local daemon, archival PostgreSQL storage, Mem0-based semantic memory, and an MCP query surface.

The goal is not to incrementally improve the existing Mem0 extension behavior. The goal is to reuse the extension chassis while replacing the core data flow and ownership boundaries.

## Phase 0: Repo Repositioning

- Rename the project away from `mem0-chrome-extension` terminology.
- Keep this repository as the browser-runtime repo unless the daemon is later split into its own repository.
- Preserve the current extension shell while documenting which pieces are temporary legacy code.

Deliverable:

- documentation and naming aligned with the new architecture

## Phase 1: Extension Chassis Extraction

- Keep and stabilize:
  - MV3 manifest
  - provider content-script registration
  - background messaging skeleton
  - in-page UI anchoring / shadow DOM helpers
- Remove reliance on the existing Mem0-first flows for:
  - storage
  - search tracking
  - partial memory ingestion
  - dead actions / toggles
- Define a shared provider adapter interface used by each site-specific content script.

Deliverable:

- extension shell with provider adapters compiled against one shared contract

## Phase 2: Local Daemon Foundation

- Build a Python async local daemon.
- Add localhost endpoints for:
  - thread snapshot ingest
  - live event ingest
  - context suggestion
  - context confirmation
  - memory extraction / sync triggers
- Connect daemon to the existing LLM archival PostgreSQL database using a new schema for browser-origin capture.

Deliverable:

- daemon running locally with Postgres writes and extension-to-daemon communication

## Phase 3: Canonical Conversation Archive

- Implement canonical conversation storage in Postgres.
- Store:
  - conversations
  - message nodes
  - revisions
  - attachments
  - tool / search / browser events
  - capture sessions
  - Mem0 sync lineage
- Make ingest idempotent and revision-aware.

Deliverable:

- replay-safe browser conversation archive with full provenance

## Phase 4: First Provider End-To-End

- Choose one provider as the first full integration:
  - `ChatGPT` or `Claude`
- Implement:
  - current-thread snapshot
  - new message capture
  - assistant reply capture
  - edit / regenerate revision logic
  - daemon ingest
  - archive writes
  - inline context confirm UI
  - Mem0 retrieval + derived memory write path

Deliverable:

- one provider fully working end-to-end in the new architecture

## Phase 5: Multi-Provider Expansion

- Extend the shared adapter approach to:
  - ChatGPT
  - Claude
  - Gemini
  - Perplexity
  - Grok
  - DeepSeek
- Reuse extraction patterns from Loominary and the user's Tampermonkey corpus where effective.

Deliverable:

- broad provider coverage with one normalized ingest model

## Phase 6: MCP Query Surface

- Expose MCP from the local daemon.
- Add tools for:
  - searching conversations
  - fetching conversations / branches
  - retrieving archive snippets
  - retrieving memory context
  - querying Mem0-backed semantic results

Deliverable:

- agent-friendly access to browser conversations and memory outside the browser

## Phase 7: Browser-Driving Side Investigation

- Evaluate Anchor, browser-use style tooling, Steel-style tooling, and adjacent browser-driving systems.
- Treat them as complements for:
  - orchestration
  - backfill
  - smoke testing
  - fallback extraction
- Prefer wrapping them behind OpenAPI-compatible endpoints if adopted.

Deliverable:

- comparison report and recommendation, not required for v1 runtime

## Recommended first implementation milestone

The first milestone should be:

- keep the current extension shell
- add the provider adapter contract
- stand up the daemon
- implement one provider end-to-end
- archive raw conversations into Postgres
- retrieve memory from Mem0 and show manual-confirm inline injection

That milestone proves the architecture without forcing a full multi-provider rewrite up front.
