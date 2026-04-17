"""Local daemon for proof-of-concept browser capture ingest."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from typing import Any, Literal, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import asyncpg


CaptureEventType = Literal[
  "thread_snapshot",
  "message_created",
  "message_completed",
  "message_edited",
  "message_regenerated",
  "branch_changed",
  "attachment_discovered",
  "tool_event_discovered",
]


class NormalizedMessage(BaseModel):
  message_id: str
  parent_message_id: Optional[str] = None
  revision_id: Optional[str] = None
  role: str
  content_parts: list[str] = Field(default_factory=list)
  attachments: list[dict[str, Any]] = Field(default_factory=list)
  tool_events: list[dict[str, Any]] = Field(default_factory=list)
  captured_at: str


class ThreadSnapshotPayload(BaseModel):
  provider: str
  event_type: Literal["thread_snapshot"] = "thread_snapshot"
  account_id: Optional[str] = None
  workspace_id: Optional[str] = None
  conversation_id: str
  branch_id: str = "main"
  source_url: str
  captured_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
  raw_provider_metadata: dict[str, Any] = Field(default_factory=dict)
  messages: list[NormalizedMessage] = Field(default_factory=list)


class EventPayload(BaseModel):
  provider: str
  event_type: CaptureEventType
  account_id: Optional[str] = None
  workspace_id: Optional[str] = None
  conversation_id: str
  branch_id: str = "main"
  message_id: Optional[str] = None
  revision_id: Optional[str] = None
  parent_message_id: Optional[str] = None
  role: Optional[str] = None
  content_parts: list[str] = Field(default_factory=list)
  attachments: list[dict[str, Any]] = Field(default_factory=list)
  tool_events: list[dict[str, Any]] = Field(default_factory=list)
  source_url: str
  captured_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
  raw_provider_metadata: dict[str, Any] = Field(default_factory=dict)


class CaptureResult(BaseModel):
  status: Literal["accepted", "rejected"]
  ingest_id: str
  deduped: bool
  conversation_id: str
  event_type: str


class ProviderStatus(BaseModel):
  enabled: bool
  last_event_received_at: Optional[str] = None


class ContextSuggestRequest(BaseModel):
  provider: str
  conversation_id: Optional[str] = None
  query: str
  top_k: int = 5
  threshold: float = 0.0


class ContextSuggestion(BaseModel):
  id: str
  conversation_id: str
  message_id: str
  role: str
  text: str
  captured_at: str
  score: float
  metadata: dict[str, Any] = Field(default_factory=dict)


class ContextSuggestResponse(BaseModel):
  provider: str
  conversation_id: Optional[str]
  suggestions: list[ContextSuggestion]


class ContextConfirmRequest(BaseModel):
  provider: str
  conversation_id: Optional[str] = None
  selected_suggestion_ids: list[str] = Field(default_factory=list)
  approved_text: str
  drafted_prompt: str


class ContextConfirmResponse(BaseModel):
  status: Literal["recorded", "ignored"]
  approved_count: int
  deduped: bool = False


@dataclass
class InMemoryArchive:
  conversation_snapshots: dict[str, ThreadSnapshotPayload] = field(default_factory=dict)
  conversation_events: dict[str, list[EventPayload]] = field(default_factory=dict)
  event_signatures: set[str] = field(default_factory=set)
  provider_status: dict[str, str] = field(default_factory=dict)
  approved_contexts: list[ContextConfirmRequest] = field(default_factory=list)

  def _signature(self, event_type: str, payload: BaseModel) -> str:
    payload_json = payload.model_dump_json()
    return sha256(f"{event_type}:{payload_json}".encode("utf-8")).hexdigest()

  def upsert_snapshot(self, payload: ThreadSnapshotPayload) -> tuple[str, bool]:
    sig = self._signature("thread_snapshot", payload)
    conversation_id = payload.conversation_id
    existing = self.conversation_snapshots.get(conversation_id)
    if existing is not None:
      existing_signature = self._signature("thread_snapshot", existing)
      if existing_signature == sig:
        return (sig, True)
    self.conversation_snapshots[conversation_id] = payload
    self.event_signatures.add(sig)
    self.provider_status[payload.provider] = payload.captured_at
    return (sig, False)

  def append_event(self, payload: EventPayload) -> tuple[str, bool]:
    if payload.message_id is None:
      raise ValueError("event payload requires message_id")
    sig = self._signature(payload.event_type, payload)
    if sig in self.event_signatures:
      return (sig, True)
    self.event_signatures.add(sig)
    self.conversation_events.setdefault(payload.conversation_id, []).append(payload)
    self.provider_status[payload.provider] = payload.captured_at
    return (sig, False)

  def add_context_confirmation(self, payload: ContextConfirmRequest) -> tuple[bool, bool]:
    signature = sha256(f"{payload.provider}|{payload.conversation_id}|{payload.approved_text}".encode("utf-8")).hexdigest()
    existing = any(
      sha256(f"{record.provider}|{record.conversation_id}|{record.approved_text}".encode("utf-8")).hexdigest()
      == signature
      for record in self.approved_contexts
    )
    if existing:
      return (True, True)
    self.approved_contexts.append(payload)
    return (False, False)

  def find_messages_for_context(self, provider: str, conversation_id: Optional[str], query: str, top_k: int) -> list[ContextSuggestion]:
    needle = (query or "").lower().strip()
    if not needle:
      return []

    candidate_messages: list[tuple[float, ContextSuggestion]] = []
    snapshot_messages: list[NormalizedMessage] = []
    event_messages: list[EventPayload] = []

    if conversation_id:
      snapshot = self.conversation_snapshots.get(conversation_id)
      if snapshot:
        snapshot_messages = list(snapshot.messages)
      event_messages = [event for event in self.conversation_events.get(conversation_id, [])]
    else:
      for snapshot in self.conversation_snapshots.values():
        if snapshot.provider != provider:
          continue
        snapshot_messages.extend(snapshot.messages)
      for _, events in self.conversation_events.items():
        for event in events:
          if event.provider != provider:
            continue
          event_messages.append(event)

    for message in snapshot_messages:
      haystack = " ".join(message.content_parts).lower()
      if not haystack:
        continue
      score = needle in haystack
      if score:
        candidate_messages.append(
          (
            float(len(needle)) / max(len(haystack), 1),
            ContextSuggestion(
              id=f"s:{message.message_id}",
              conversation_id=conversation_id or "unknown",
              message_id=message.message_id,
              role=message.role,
              text=" ".join(message.content_parts),
              captured_at=message.captured_at,
              score=float(len(needle)) / max(len(haystack), 1),
              metadata={"source": "thread_snapshot"},
            ),
          )
        )

    for event in event_messages:
      haystack = " ".join(event.content_parts).lower()
      if not haystack:
        continue
      score = needle in haystack
      if score:
        suggestion = ContextSuggestion(
          id=f"e:{event.message_id or 'unknown'}",
          conversation_id=event.conversation_id,
          message_id=event.message_id or "unknown",
          role=event.role or "unknown",
          text=" ".join(event.content_parts),
          captured_at=event.captured_at,
          score=float(len(needle)) / max(len(haystack), 1),
          metadata={"source": "event"},
        )
        if suggestion.id not in {item.id for _, item in candidate_messages}:
          candidate_messages.append((suggestion.score, suggestion))

    candidate_messages.sort(key=lambda item: item[0], reverse=True)
    return [item for _, item in candidate_messages[: max(top_k, 0)]]


app = FastAPI(title="browser-capture-daemon", version="0.1.0")
archive = InMemoryArchive()
pg_pool: Optional[asyncpg.Pool] = None


async def upsert_conversation_row(
  payload: ThreadSnapshotPayload | EventPayload,
) -> Optional[int]:
  global pg_pool
  if pg_pool is None:
    return None
  metadata = json.dumps(payload.raw_provider_metadata or {})
  row = await pg_pool.fetchrow(
    """
    INSERT INTO browser_capture.conversations (
      provider,
      conversation_id,
      account_id,
      branch_id,
      source_url,
      source_metadata,
      first_seen_at,
      last_seen_at
    )
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz, $7::timestamptz)
    ON CONFLICT (provider, conversation_id, branch_id)
    DO UPDATE SET
      account_id = EXCLUDED.account_id,
      source_url = EXCLUDED.source_url,
      source_metadata = EXCLUDED.source_metadata,
      last_seen_at = EXCLUDED.last_seen_at,
      updated_at = NOW()
    RETURNING id
    """,
    payload.provider,
    payload.conversation_id,
    payload.account_id,
    payload.branch_id,
    payload.source_url,
    metadata,
    payload.captured_at,
  )
  if row is None:
    return None
  return int(row["id"])


async def persist_capture_event(
  payload: ThreadSnapshotPayload | EventPayload,
  event_type: str,
  ingest_id: str,
) -> None:
  global pg_pool
  if pg_pool is None:
    return
  conversation_row_id = await upsert_conversation_row(payload)
  if conversation_row_id is None:
    return

  provider_message_id: Optional[str] = None
  revision_id: Optional[str] = None
  parent_message_id: Optional[str] = None
  if isinstance(payload, EventPayload):
    provider_message_id = payload.message_id
    revision_id = payload.revision_id
    parent_message_id = payload.parent_message_id

  payload_json = payload.model_dump_json()
  payload_hash = sha256(payload_json.encode("utf-8")).hexdigest()
  await pg_pool.execute(
    """
    INSERT INTO browser_capture.capture_events (
      provider,
      event_type,
      conversation_id,
      provider_message_id,
      revision_id,
      parent_message_id,
      payload,
      payload_hash,
      dedupe_signature
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9
    )
    ON CONFLICT (provider, event_type, payload_hash, dedupe_signature) DO NOTHING
    """,
    payload.provider,
    event_type,
    conversation_row_id,
    provider_message_id,
    revision_id,
    parent_message_id,
    payload_json,
    payload_hash,
    ingest_id,
  )


@app.on_event("startup")
async def daemon_startup() -> None:
  global pg_pool
  database_url = os.getenv("ARCHIVE_DATABASE_URL", "").strip()
  if not database_url:
    pg_pool = None
    return
  pg_pool = await asyncpg.create_pool(dsn=database_url, min_size=1, max_size=4)


@app.on_event("shutdown")
async def daemon_shutdown() -> None:
  global pg_pool
  if pg_pool is None:
    return
  await pg_pool.close()
  pg_pool = None


def _result(ingest_id: str, deduped: bool, conversation_id: str, event_type: str) -> CaptureResult:
  return CaptureResult(
    status="accepted",
    ingest_id=ingest_id,
    deduped=deduped,
    conversation_id=conversation_id,
    event_type=event_type,
  )


@app.post("/v1/capture/thread-snapshot", response_model=CaptureResult)
async def create_snapshot(payload: ThreadSnapshotPayload) -> CaptureResult:
  if not payload.conversation_id:
    raise HTTPException(status_code=400, detail="conversation_id is required")
  ingest_id, deduped = archive.upsert_snapshot(payload)
  try:
    await persist_capture_event(payload, payload.event_type, ingest_id)
  except Exception:
    # Keep capture flow available even if persistence backend is temporarily unavailable.
    pass
  return _result(
    ingest_id=ingest_id,
    deduped=deduped,
    conversation_id=payload.conversation_id,
    event_type=payload.event_type,
  )


@app.post("/v1/capture/event", response_model=CaptureResult)
async def create_event(payload: EventPayload) -> CaptureResult:
  if payload.event_type != "thread_snapshot" and payload.event_type not in set([
    "message_created",
    "message_completed",
    "message_edited",
    "message_regenerated",
    "branch_changed",
    "attachment_discovered",
    "tool_event_discovered",
  ]):
    raise HTTPException(status_code=400, detail="unsupported event_type")
  if not payload.message_id:
    raise HTTPException(status_code=400, detail="message_id is required")
  ingest_id, deduped = archive.append_event(payload)
  try:
    await persist_capture_event(payload, payload.event_type, ingest_id)
  except Exception:
    # Keep capture flow available even if persistence backend is temporarily unavailable.
    pass
  return _result(
    ingest_id=ingest_id,
    deduped=deduped,
    conversation_id=payload.conversation_id,
    event_type=payload.event_type,
  )


@app.get("/v1/health")
async def health() -> dict[str, str]:
  return {"status": "ok", "service": "browser-capture-daemon"}


@app.get("/v1/providers/status")
async def provider_status() -> dict[str, ProviderStatus]:
  providers = {}
  for provider, last_event in archive.provider_status.items():
    providers[provider] = ProviderStatus(
      enabled=True,
      last_event_received_at=last_event,
    )
  return providers


@app.post("/v1/context/suggest", response_model=ContextSuggestResponse)
async def suggest_context(payload: ContextSuggestRequest) -> ContextSuggestResponse:
  suggestions = archive.find_messages_for_context(
    provider=payload.provider,
    conversation_id=payload.conversation_id,
    query=payload.query,
    top_k=payload.top_k,
  )
  if payload.threshold > 0:
    suggestions = [item for item in suggestions if item.score >= payload.threshold]
  return ContextSuggestResponse(
    provider=payload.provider,
    conversation_id=payload.conversation_id,
    suggestions=suggestions,
  )


@app.post("/v1/context/confirm", response_model=ContextConfirmResponse)
async def confirm_context(payload: ContextConfirmRequest) -> ContextConfirmResponse:
  deduped, was_existing = archive.add_context_confirmation(payload)
  if was_existing:
    return ContextConfirmResponse(status="ignored", approved_count=0, deduped=True)
  approved_count = len(payload.selected_suggestion_ids)
  return ContextConfirmResponse(status="recorded", approved_count=approved_count, deduped=deduped)


def main() -> None:
  import uvicorn

  uvicorn.run(app, host="0.0.0.0", port=8787)


if __name__ == "__main__":
  main()
