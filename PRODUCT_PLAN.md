# OpenCode Cloud Product Plan

## Why the PoC feels deceptively simple

This repository is not just "an AI on Cloudflare." It is a distributed system with two user-visible planes and one optional execution plane:

1. **Client plane**: the local OpenCode CLI/TUI process that renders messages, owns terminal UX, and may be the only place with access to the user's real machine.
2. **Cloud control plane**: the Cloudflare Worker plus per-session Durable Object that owns protocol compatibility, session state, ordering, persistence, auth, usage, and model orchestration.
3. **Execution plane**: the place where tools actually run. In the first usable product this should be a hosted workspace plus hosted execution backends controlled by Cloudflare. Later it can also include an optional local companion that exposes tools from the user's machine.

The PoC worked because it emulated enough of the HTTP and SSE contract. The product only becomes real when the control plane, execution plane, and session state machine are designed explicitly instead of being inferred from ad-hoc route handlers.

## Product target

The real product should feel native to an OpenCode user:

- `opencode attach <url>` connects instantly.
- sessions persist and resume correctly.
- assistant replies arrive in the right order every time.
- tools feel real, not simulated.
- workspace operations are predictable.
- local and hosted execution are both possible without changing the protocol.

The product should also be honest about Cloudflare's constraints:

- Workers plus Durable Objects are excellent control-plane primitives.
- Workers alone are not a full Linux shell substrate.
- Dynamic Worker Loaders are attractive for sandboxed code execution, but they are currently in closed beta.
- Containers provide a full filesystem and Linux-like environment, but they are beta on Workers Paid plans.

Because of that, **the first production path should be Cloudflare-first control plane plus hosted workspace and hosted execution backends**. Local-machine execution is a separate companion-enabled mode, not something stock `attach` provides by itself.

## First-principles architecture

### 1. Session is the primary unit of correctness

Every externally visible operation must route through the same session identity:

- `POST /session`
- `GET /session/:id`
- `GET /session/:id/event`
- `POST /session/:id/message`
- `POST /session/:id/prompt_async`
- legacy `GET /event?sessionId=...`

The session ID is not just metadata. It is the routing key for:

- the Durable Object instance
- the message ledger
- the SSE connection set
- the tool execution ledger
- the workspace attachment

Any architecture that lets message handling and SSE attachment resolve to different Durable Object identities will eventually lose replies.

### 2. The Cloudflare side is a control plane, not the workspace

The Worker and Durable Object should own:

- OpenCode protocol compatibility
- ordered SSE emission
- request validation
- durable session state
- message persistence
- tool planning
- model calls and retries
- auth, usage, billing, and observability

The control plane should not assume that it is also the place where files live or commands run. That assumption only holds for some backends.

### 3. Execution is a backend behind a stable interface

The control plane should target an abstract execution contract from day one:

```ts
type ExecutionBackend = "byoc" | "cloudflare-sandbox" | "container"

interface WorkspaceStore {
  read(path: string): Promise<string>
  write(path: string, content: string): Promise<void>
  list(path: string): Promise<ReadonlyArray<string>>
  stat(path: string): Promise<unknown>
  diff?(path: string): Promise<unknown>
}

interface ToolExecutor {
  execute(call: ToolCall, context: ToolContext): Promise<ToolResult>
}
```

That keeps protocol and orchestration stable while the execution substrate evolves.

## Recommended product architecture

### Control plane

#### Edge Worker

Responsibilities:

- HTTP adapter only
- auth and API token verification
- session routing
- request normalization
- static bootstrap/config endpoints

It should stay thin. Business logic belongs in Effect programs and services, not in Hono handlers.

#### Session Durable Object

One Durable Object per session.

Responsibilities:

- own the live SSE writer set for that session
- persist the canonical message ledger in SQLite
- own the session state machine
- sequence model calls, tool calls, tool results, and final replies
- act as the serialization point for concurrent events

This is the heart of correctness. If a session is active, all stateful interactions for that session should terminate here.

#### Message ledger

SQLite inside the session Durable Object is the correct durable source of truth for:

- ordered messages
- ordered message parts
- session status transitions
- tool request states
- tool result states
- resumable model continuation checkpoints

The ledger should be explicit enough to replay a session after hibernation without guessing from logs.

### Execution plane backends

#### Backend 1: Hosted workspace

This should be the first real product backend.

How it works:

- the model emits a tool call
- the control plane resolves file-oriented tools against a hosted workspace mirror
- the session Durable Object resumes the model with the tool result in context

Why this is the right first backend:

- works with unmodified OpenCode attach
- keeps the session loop authoritative in Cloudflare
- solves `read`, `write`, `edit`, `ls`, `glob`, and `grep` without pretending the attached client is an executor
- creates the storage substrate needed for later hosted or local execution modes

Tradeoff:

- it does not provide true local-machine semantics
- it does not provide full shell parity by itself

#### Backend 2: Cloudflare sandbox

This is the "Cloudflare-only" hosted backend for safe code execution, not full shell parity.

Recommended primitives:

- `worker-fs-mount` for a virtual filesystem layer
- `durable-object-fs` for metadata and small files
- `r2-fs` for larger blobs and artifacts
- `memory-fs` for tests and ephemeral sandboxes
- Dynamic Worker Loaders or Codemode-style isolates for sandboxed execution

Best fit:

- JavaScript or TypeScript transformations
- deterministic tool composition
- isolated code snippets
- no-network sandboxes

Not a fit:

- arbitrary bash
- native package managers
- anything that assumes a full Linux environment

This backend is strategically important, but it should not be sold as "full remote shell." It is the right place for safe snippet execution and generated code, not for pretending plain Workers are a full Linux workstation.

#### Backend 3: Cloudflare container runner

This is the hosted backend for full filesystem and Linux-like execution.

Recommended primitives:

- Cloudflare Containers for full runtime and filesystem semantics
- R2-backed artifact and workspace persistence
- optionally `worker-fs-mount` on the control-plane side for metadata and file APIs

Best fit:

- builds
- tests
- language toolchains
- git-heavy workflows
- full shell compatibility

Tradeoff:

- more expensive
- more operationally complex
- beta platform dependency

This should be a later hosted tier, not the initial requirement for product correctness.

#### Backend 4: Local companion via MCP

This is the optional mode for true local-machine access.

How it works:

- the user's machine runs a companion process
- the companion exposes local tools as MCP tools over an outbound connection or relay
- the Cloudflare session loop invokes those tools like any other remote MCP server
- tool results are persisted and streamed back through the normal session flow

Why this is the right local-tools architecture:

- matches upstream OpenCode's server-side tool execution model
- does not require the stock attached TUI to become a local executor
- preserves one authoritative session loop in Cloudflare

Tradeoff:

- requires installing or running a companion
- introduces trust, auth, and connectivity requirements for local execution

## Workspace strategy

The product needs a workspace story that matches the backend:

### Phase 1 workspace

For the baseline product, the workspace is a hosted mirror. Use a layered store:

- `durable-object-fs` for directory metadata, manifests, and small files
- `r2-fs` for larger files and artifacts
- `memory-fs` for ephemeral throwaway sandboxes

This gives one filesystem API but lets storage costs and latency stay sane.

The hosted mirror should be synchronized by manifest and content hash, not by blindly uploading the entire repo on every attach.

### Phase 2 workspace

For containers, the container runtime becomes the active workspace with:

- snapshot or restore from R2
- artifact export back to R2
- ledger references stored in the session Durable Object

### Phase 3 workspace

For local-companion mode, the user's machine remains the source of truth. The cloud stores:

- session messages
- tool requests and tool results
- optional file metadata and cached mirrors where useful

The cloud should not assume full local workspace mirroring is always required. It should support lazy hydration and selective sync.

## Tool lifecycle

The product must model tool execution as a durable state machine, not a side effect.

### Proposed loop

1. User sends prompt.
2. Session Durable Object stores the user message.
3. Session Durable Object emits user message events.
4. Model is called.
5. If model returns plain text:
   - emit assistant parts
   - persist final assistant message
   - set session idle
6. If model returns tool calls:
   - persist tool request records
   - emit `tool-call` parts
   - dispatch to the selected execution backend
7. Execution backend returns tool results.
8. Session Durable Object persists tool results.
9. Session Durable Object resumes the model with tool results in context.
10. Final assistant message is emitted and persisted.

This loop is the real product. Everything else is transport, storage, or presentation.

## Model strategy

Do not hard-code a single Workers AI model into the core architecture.

Recommended control-plane shape:

- primary model route through an OpenAI-compatible client
- support Workers AI directly where useful
- support AI Gateway for provider routing, logging, and fallback policy
- define one default model and one fallback model in config

This keeps the protocol stable while model quality and pricing change.

## Git and repository operations

Hosted git support should be treated as a workspace capability, not a top-level feature.

Recommended path:

- use `isomorphic-git` where pure JS flows are sufficient
- use GitHub APIs for remote metadata and PR flows
- reserve container-backed execution for workflows that need a real checkout plus shell tools

The product should separate:

- repository metadata operations
- hosted workspace operations
- local checkout operations through the companion path

Those are different reliability and permission domains.

## Observability and failure model

The product must be easy to reason about in production.

Every request, event, and tool step should include:

- session ID
- Durable Object ID
- request ID
- message ID
- tool call ID if present
- backend kind
- model and provider

The most important failure classes to make explicit are:

- event stream attached to the wrong session
- tool result arrives after reconnect
- model call fails after tool request persisted
- duplicate prompt submission on reconnect
- workspace backend unavailable while session is active

If these are not first-class states in the ledger and logs, the system will be impossible to debug.

## Phased roadmap

### Phase 0: Baseline reset and parity

- reset to clean upstream
- keep the protocol-compatible surface
- remove singleton Durable Object routing
- restore per-session Durable Object identity
- add real smoke checks for local and live deployment

### Phase 1: First real product backend

- port runtime to Effect v4-smol
- introduce session router, message repo, event bus, model client, rate limiter
- implement hosted workspace mirror and hosted file tools
- add auth, structured logs, and model fallback

Outcome:

- the attached client can use real hosted file tools through the Cloudflare control plane

### Phase 2: Hosted workspace APIs

- introduce `WorkspaceStore`
- add `worker-fs-mount` abstraction
- start with `memory-fs` for tests and `durable-object-fs` plus `r2-fs` for hosted workspaces
- add manifest-based sync and lazy hydration for mirrored workspaces

Outcome:

- read/write/edit/list APIs can exist in hosted mode without promising full shell parity

### Phase 3: Hosted execution

- evaluate Dynamic Worker Loaders for safe snippet execution
- add Cloudflare Containers for full shell workflows
- route expensive workflows explicitly to the container backend

Outcome:

- hosted builds and tests become possible without overloading the control plane

### Phase 4: Local companion mode

- expose local tools through MCP
- connect the companion to the Cloudflare control plane with secure outbound auth
- keep the session loop and ledger in Cloudflare

Outcome:

- users can opt into true local-machine execution without changing the stock TUI semantics

### Phase 5: Multi-tenant product hardening

- API keys and auth flows
- usage and billing
- workspace quotas
- retry and resume semantics
- artifact retention policies
- team and org support

## Current decisions

- **Control plane**: Cloudflare Worker plus one Durable Object per session.
- **First execution backend**: hosted workspace plus hosted file tools.
- **Hosted filesystem abstraction**: `worker-fs-mount`.
- **Hosted full shell path**: Containers, not plain Workers.
- **Hosted sandbox path**: Dynamic Worker Loaders or Codemode style isolates where available, but not as a substitute for a full shell.
- **Local-machine path**: optional local companion exposing remote MCP tools.
- **Model access**: OpenAI-compatible client plus AI Gateway-compatible routing, with Workers AI remaining a valid provider.

## Immediate next steps

1. Rebuild the worker around per-session Durable Object routing.
2. Port the worker and Durable Object runtime to Effect v4-smol services and layers.
3. Add a durable tool request and tool result ledger.
4. Implement the hosted workspace backend first.
5. Add streaming model output and provider abstraction.
6. Add smoke checks that verify the full prompt to SSE reply loop on both local and deployed environments.
