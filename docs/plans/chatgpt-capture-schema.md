# ChatGPT Capture Schema v1 (Proof-of-Concept)

## Purpose

This schema supports the first proof-of-concept: capture ChatGPT thread snapshots and message
events from the authenticated browser session and send them to the local daemon.

## Shared event base

Every payload sent to the daemon should include:

- `provider`: `chatgpt`
- `event_type`: one of the event families
- `account_id`: provider account identifier when available, otherwise `null`
- `conversation_id`: stable id derived from the page/thread URL
- `branch_id`: conversation branch marker (`main` by default for v1)
- `source_url`: full current page URL
- `captured_at`: ISO timestamp in UTC
- `raw_provider_metadata`: provider-specific object for rework/recovery

## Event types for v1

### `thread_snapshot`

Sent when the script first sees a conversation and when navigation changes to another thread.

Required fields:

- `provider`
- `event_type: "thread_snapshot"`
- `conversation_id`
- `source_url`
- `captured_at`
- `messages`: array of normalized messages

Optional fields:

- `account_id`
- `workspace_id`
- `branch_id`
- `raw_provider_metadata`

### `message_created`

Sent when user submits a prompt.

Required fields:

- `provider`
- `event_type: "message_created"`
- `conversation_id`
- `message_id`
- `role: "user"`
- `content_parts` (non-empty array)
- `source_url`
- `captured_at`

### `message_completed`

Sent when a new assistant message appears in the thread after the user send action.

Required fields:

- `provider`
- `event_type: "message_completed"`
- `conversation_id`
- `message_id`
- `role: "assistant"`
- `content_parts` (non-empty array)
- `source_url`
- `captured_at`

## Normalized message object (v1)

Used by both `thread_snapshot` and event flows.

- `message_id` string
- `parent_message_id` string | null
- `revision_id` string | null
- `role` one of `user | assistant | system`
- `content_parts` array of text strings
- `attachments` array (empty in v1)
- `tool_events` array (empty in v1)

## Daemon response contract used in v1

Both endpoints return:

- `status`: `accepted` | `rejected`
- `ingest_id`: server-generated event identifier
- `deduped`: boolean (true if replayed event was ignored)
- `conversation_id`
- `event_type`

## Initial implementation notes

- Thread snapshots are best-effort based on visible DOM selectors.
- Message ids for snapshot + live events may be synthetic if provider-native ids are missing.
- Dedupe is done using conversation + role + content + event timestamp at the daemon.
