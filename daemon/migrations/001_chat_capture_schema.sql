-- Canonical capture schema for browser-origin conversation archive (v1 draft)
-- Intended for LLM archival PostgreSQL integration.

CREATE SCHEMA IF NOT EXISTS browser_capture;

CREATE TABLE IF NOT EXISTS browser_capture.conversations (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  account_id TEXT,
  branch_id TEXT NOT NULL DEFAULT 'main',
  source_url TEXT NOT NULL,
  source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, conversation_id, branch_id)
);

CREATE TABLE IF NOT EXISTS browser_capture.message_nodes (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES browser_capture.conversations(id) ON DELETE CASCADE,
  provider_message_id TEXT NOT NULL,
  role TEXT NOT NULL,
  parent_message_id TEXT,
  latest_revision_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (conversation_id, provider_message_id)
);

CREATE TABLE IF NOT EXISTS browser_capture.message_revisions (
  id BIGSERIAL PRIMARY KEY,
  message_node_id BIGINT NOT NULL REFERENCES browser_capture.message_nodes(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL,
  content_parts JSONB NOT NULL DEFAULT '[]'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL,
  raw_provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_node_id, revision_id)
);

CREATE TABLE IF NOT EXISTS browser_capture.capture_events (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  conversation_id BIGINT NOT NULL REFERENCES browser_capture.conversations(id) ON DELETE CASCADE,
  provider_message_id TEXT,
  revision_id TEXT,
  parent_message_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_hash TEXT NOT NULL,
  dedupe_signature TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, event_type, payload_hash, dedupe_signature)
);

CREATE TABLE IF NOT EXISTS browser_capture.attachments (
  id BIGSERIAL PRIMARY KEY,
  message_node_id BIGINT REFERENCES browser_capture.message_nodes(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL,
  attachment_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_node_id, attachment_id)
);

CREATE TABLE IF NOT EXISTS browser_capture.tool_events (
  id BIGSERIAL PRIMARY KEY,
  message_node_id BIGINT REFERENCES browser_capture.message_nodes(id) ON DELETE CASCADE,
  tool_event_id TEXT NOT NULL,
  tool_event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_node_id, tool_event_id)
);

CREATE TABLE IF NOT EXISTS browser_capture.mem0_sync_lineage (
  id BIGSERIAL PRIMARY KEY,
  message_revision_id BIGINT REFERENCES browser_capture.message_revisions(id) ON DELETE SET NULL,
  mem0_memory_id TEXT NOT NULL,
  mem0_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
