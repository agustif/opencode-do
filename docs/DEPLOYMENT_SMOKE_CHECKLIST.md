# Deployment Smoke Checklist

Use this checklist before and after every routing, session, SSE, model, or deployment change.

## Local

1. Start `wrangler dev`.
2. `POST /session` and capture the returned session ID.
3. Open `GET /event?sessionId=<id>` or `GET /session/<id>/event`.
4. Send `POST /session/<id>/message` with a simple text prompt.
5. Verify the same session receives, in order:
   - `server.connected`
   - user `message.updated`
   - user `message.part.updated`
   - user `message.updated` with `summary`
   - assistant `message.updated`
   - `session.status` busy
   - assistant `step-start`
   - assistant content or visible error part
   - assistant `step-finish`
   - assistant `message.updated` with `finish`
   - `session.status` idle
   - `session.idle`
6. `GET /session/<id>/message` and confirm the assistant reply matches the SSE output.
7. Repeat with the legacy `GET /event?sessionId=<id>` path.

## Deployment

1. Deploy preview or production.
2. Repeat the full local checklist against the deployed URL.
3. Tail logs and verify every event includes the same session ID across:
   - session creation
   - SSE attach
   - message submission
   - model call
   - assistant reply
4. Confirm the SSE connection and prompt handling resolved to the same Durable Object identity.
5. Confirm a failed model call still produces a visible assistant error part instead of silence.

## Backend-specific

### BYOC

1. Trigger a tool call from the model.
2. Confirm the tool request is emitted to the client.
3. Confirm the client result is posted back and persisted.
4. Confirm the model resumes after the tool result.

### Hosted workspace

1. Read a file.
2. Write a file.
3. List a directory.
4. Verify the workspace backend used for the session is logged.

### Hosted execution

1. Run a harmless command or snippet.
2. Verify stdout and stderr are captured separately.
3. Verify timeout and cancellation are visible to the user.
