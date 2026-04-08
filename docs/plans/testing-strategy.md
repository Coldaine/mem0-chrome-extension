# Testing Strategy

## Summary

Testing should prioritize correctness at the system boundaries:

- browser capture
- normalization
- deduplication
- archive writes
- Mem0 integration
- context injection
- MCP query behavior

The goal is not vanity coverage. The goal is high confidence that the system records the right conversations, records them once, preserves revisions, and surfaces usable context without corrupting the archive.

## Standards

- prefer real fixtures over hand-wavy mocks
- use mocks only at expensive or unstable boundaries
- every bug fix must add a regression test
- idempotency is a first-class requirement
- branch / revision preservation is a first-class requirement
- tests should prove that archive and memory are separate concerns

## Test layers

### Unit tests

Focus on pure logic:

- provider event normalization
- deduplication logic
- revision / regeneration classification
- content-part normalization
- memory candidate extraction
- prompt-context assembly
- MCP result shaping

### Integration tests

Focus on subsystem boundaries:

- extension payload -> daemon ingest -> Postgres writes
- archived conversation -> memory candidate extraction -> Mem0 request
- draft prompt -> context suggestion -> confirm flow
- MCP query -> archive retrieval -> structured response

Use:

- real Postgres
- fake or contract-tested Mem0 boundary

### End-to-end tests

Focus on proving the real workflow:

- open supported provider thread
- snapshot current thread
- send a prompt
- capture assistant reply
- confirm inline context
- verify archive writes and memory side effects
- edit / regenerate and verify revision behavior

## Provider test strategy

Each provider should have:

- fixture-based extraction tests from captured HTML / API / page-state samples
- smoke tests in a real authenticated browser

Fixture tests give speed and stability.
Browser smoke tests catch selector drift and real runtime breakage.

## Acceptance criteria

The system is not acceptable unless:

- replaying the same events does not create duplicate archive rows
- editing a prompt creates a revision rather than overwriting history
- regenerating a reply preserves branch lineage
- archive writes still succeed if Mem0 is unavailable
- context injection is manual-confirm in v1
- sending still works even if retrieval fails
- MCP can fetch archive-native conversation data, not only summaries

## Regression priorities

Highest-priority regression coverage should protect:

- duplicate ingest bugs
- lost revision / branch bugs
- wrong conversation identity stitching
- assistant reply capture failures
- silent prompt rewrite bugs
- archive / Mem0 lineage breakage

## CI expectations

CI should eventually include:

- unit test suite
- integration suite with real Postgres
- thin browser smoke suite for priority providers

CI should fail on:

- duplicate-ingest regressions
- schema / archive contract regressions
- broken context-confirm behavior
- broken MCP tool contracts
