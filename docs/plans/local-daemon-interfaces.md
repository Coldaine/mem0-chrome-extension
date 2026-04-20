# Local Daemon Interfaces

## Summary

A local Python async daemon is the central runtime for the new system. It receives browser capture events, normalizes and deduplicates them, writes raw conversations to the archival PostgreSQL database, calls Mem0 for semantic memory operations, and exposes MCP for external querying.

The browser extension is a client of this daemon, not the source of truth.

## Responsibilities

The daemon owns:

- canonical ingest
- normalization
- deduplication
- revision / branch handling
- archival Postgres writes
- Mem0 retrieval and memory sync
- MCP tool exposure
- optional future OpenAPI-compatible wrappers for browser-driving tools

## Storage boundary

Canonical raw conversations live in:

- the existing LLM archival PostgreSQL database
- a new schema dedicated to browser-origin capture

Mem0 owns:

- semantic memory storage
- semantic retrieval for prompt context

## HTTP interface families

### Capture ingest

- `POST /v1/capture/thread-snapshot`
- `POST /v1/capture/event`
  - Port (v1): `8787`
  - Local endpoints targeted by extension runtime:
    - `http://127.0.0.1:8787`
    - `http://localhost:8787`

Purpose:

- receive current-thread snapshots
- receive incremental provider events

### Context flow

- `POST /v1/context/suggest`
- `POST /v1/context/confirm`

Purpose:

- return candidate context for a draft prompt
- record final user decision and approved context payload
- v1 suggestion matching is lexical and in-memory only

### Memory flow

- `POST /v1/memories/extract`
- `POST /v1/memories/sync`

Purpose:

- derive memory candidates from archived content
- write approved memory to Mem0 and record lineage

### Health / diagnostics

- `GET /v1/health`
- `GET /v1/providers/status`

Purpose:

- local readiness and provider capability visibility
- runtime can enable Postgres persistence when `ARCHIVE_DATABASE_URL` is configured

## Canonical capture payload shape

Each event payload should include enough information to reconstruct identity and provenance:

- `provider`
- `account_id`
- `workspace_id` or `organization_id` when available
- `conversation_id`
- `branch_id`
- `message_id`
- `revision_id`
- `parent_message_id`
- `role`
- `content_parts`
- `attachments`
- `tool_events`
- `source_url`
- `captured_at`
- `event_type`
- `raw_provider_metadata`

The daemon may enrich this with synthesized identifiers and normalized content fields before persistence.

## Archival schema responsibilities

- For the Postgres implementation target, use `daemon/migrations/001_chat_capture_schema.sql` as the canonical starting DDL.

The archival schema should support:

- one conversation per provider thread identity
- multiple branches per conversation
- multiple revisions per message
- attachment lineage
- tool/search/browser event lineage
- Mem0 sync lineage from archive event to memory write

## Mem0 integration contract

Mem0 should not be treated as the raw conversation archive.

The daemon should:

- derive durable memory candidates from archived conversation content
- send approved memory payloads to Mem0
- retrieve relevant memory for prompt-context suggestions
- retain archive identifiers in Mem0 metadata where useful for traceability

## MCP tools

The daemon should expose MCP tools for:

- `search_conversations`
- `get_conversation`
- `get_conversation_branch`
- `search_archive_snippets`
- `search_memories`
- `get_memory_context_for_prompt`

These tools should return archive-native identifiers so agents can traverse real threads, not only summarized memory results.

## Failure handling principles

- archive ingest must be idempotent
- daemon failure must not corrupt archive lineage
- Mem0 failure must not block raw archival
- context retrieval failure must not block normal sending
- replayed browser events must not duplicate stored messages
