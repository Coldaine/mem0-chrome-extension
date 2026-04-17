# Browser Capture Daemon (Local, v1)

This directory hosts a local async daemon scaffold that receives browser-origin capture events.

## Run

```bash
cd daemon
pip install -e .
uvicorn app.main:app --host 0.0.0.0 --port 8787
```

## Endpoints

- `POST /v1/capture/thread-snapshot`
- `POST /v1/capture/event`
- `GET /v1/health`
- `GET /v1/providers/status`
- `POST /v1/context/suggest`
- `POST /v1/context/confirm`

### Quick context workflow

- Send a draft prompt to `POST /v1/context/suggest` with `provider` and `query`.
- Use returned `suggestions` in a prompt confirmation UI.
- Send user-approved suggestion IDs plus prompt body to `POST /v1/context/confirm`.

## Notes

- Current implementation uses an in-memory store.
- It enforces idempotency by hashing payloads.
- This is intentionally minimal for the first ChatGPT proof-of-concept.

## Draft PostgreSQL schema

The current draft migration is `daemon/migrations/001_chat_capture_schema.sql`.
