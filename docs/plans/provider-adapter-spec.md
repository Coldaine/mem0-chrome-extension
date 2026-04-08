# Provider Adapter Spec

## Summary

Each supported website should be integrated through a provider adapter that runs inside the browser extension content-script environment. The adapter is responsible for observing authenticated page state and translating provider-specific behavior into one canonical event model sent to the local daemon.

Adapters should feel script-like at the provider edge, but they must emit normalized data instead of owning storage or memory logic directly.

## Responsibilities

Each provider adapter must handle:

- identifying the active account and conversation when possible
- snapshotting the currently open thread on attach
- observing new user messages
- observing assistant replies
- detecting prompt edits and reply regenerations
- detecting branch changes where visible or inferable
- extracting tool/search/browser-result artifacts where observable
- extracting attachments and attachment metadata where available
- emitting normalized events to the local daemon
- rendering inline context confirmation UI near the provider composer

Adapters must not own:

- canonical storage
- deduplication policy
- semantic memory extraction
- MCP exposure
- long-term archive querying

## Preferred extraction order

Adapters should prefer the most stable surface available in this order:

1. provider-internal network/API responses accessible from the authenticated page
2. stable in-page application state / serialized data
3. DOM mutation observation
4. fallback DOM scraping only when the above are unavailable

The adapter should never assume that visible DOM is the only or best source of truth.

## Canonical identifiers

Adapters should capture provider-native identifiers whenever available:

- account ID
- organization / workspace ID
- conversation ID
- branch or node ID
- message ID
- revision ID
- attachment IDs
- tool-call IDs

If a provider does not expose stable IDs, the adapter should still send enough raw material for the daemon to synthesize stable identities:

- provider
- source URL
- role
- normalized content
- observed timestamps
- parent / sibling context
- revision hints

## Canonical event families

Adapters should emit these event categories:

- `thread_snapshot`
- `message_created`
- `message_completed`
- `message_edited`
- `message_regenerated`
- `branch_changed`
- `attachment_discovered`
- `tool_event_discovered`
- `composer_context_requested`
- `composer_context_confirmed`

These are semantic categories. The exact wire format belongs to the daemon/interface spec.

## Attach / lifecycle behavior

On adapter startup:

- detect provider page readiness
- detect whether the current page is a supported conversation surface
- identify current thread
- emit one full thread snapshot if the thread has not yet been captured in this session

During runtime:

- observe new content incrementally
- avoid duplicate emission from repeated observers or reloads
- survive SPA navigation and URL changes

On teardown / page transition:

- disconnect observers
- flush any in-flight partial state if safe

## Context injection behavior

Adapters must support inline composer-side memory/context UX.

- context retrieval may warm while typing
- final suggestion set is assembled pre-send
- user manually confirms, edits, or rejects injected context in v1
- adapters should not silently rewrite prompts in v1

## Provider rollout order

Recommended initial rollout:

1. ChatGPT or Claude
2. the other of ChatGPT / Claude
3. Gemini and Perplexity
4. Grok and DeepSeek

This order prioritizes maturity, frequency of use, and likely value.

## Reuse sources

Adapters may borrow implementation ideas from:

- this repository's existing content scripts
- Loominary extraction logic
- the user's existing Tampermonkey scripts

However, all borrowed logic must be translated into the shared adapter contract rather than preserved as one-off provider silos.
