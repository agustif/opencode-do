# OpenCode on Durable Objects

A fork of [southpolesteve/opencode-do](https://github.com/southpolesteve/opencode-do) with Effect v4 refactor and modular architecture.

This proof-of-concept demonstrates [OpenCode's](https://opencode.ai) remote server capabilities running on Cloudflare Workers + Durable Objects.

## What is this?

This project showcases how OpenCode's `attach` feature enables connecting the OpenCode CLI/TUI to a remote server. By implementing the OpenCode server API on Cloudflare's edge infrastructure, we get:

- **Sessions that persist** - Durable Object SQLite storage keeps your conversation history
- **Pay only when active** - DOs hibernate when idle, no always-on server costs
- **Global edge deployment** - Low latency from anywhere in the world
- **Zero infrastructure management** - Cloudflare handles everything

## Changes from upstream

- **Effect v4** - Modular architecture with ServiceMap, Schema validation, and Effect-powered handlers
- **Streaming** - Proper SSE streaming with delta parsing for Workers AI
- **Rate limiting** - SQLite-backed rate limits (20 req/hour)
- **Global events** - Cross-session event broadcast via GlobalEventDO
- **Tests** - Vitest integration tests
- **PRODUCT_PLAN.md** - Detailed architecture and roadmap

## Project Structure

```
src/opencode-server-effect/
├── contracts.ts       # Effect/Schema validation types
├── defaults.ts        # Default model/provider configs
├── global-event.ts   # Global event Durable Object
├── homepage.ts       # Existential homepage with CF geo
├── ids.ts            # Sortable message/session ID generation
├── responses.ts      # HTTP response helpers
├── services.ts       # Effect v4 ServiceMap definitions
├── session-do.ts    # Session Durable Object (SSE, persistence)
├── sse.ts           # SSE formatting & broadcast
├── worker-app.ts    # Effect-powered HTTP routes
└── index.ts         # Worker entry point
```

### Effect v4 Patterns

**Services** - Type-safe dependencies via ServiceMap:
```ts
export class WorkerBindings extends ServiceMap.Service<WorkerBindings, Env>()(...) {}
export class SessionRuntime extends ServiceMap.Service<SessionRuntime, SessionRuntimeShape>()(...) {}
```

**Schema validation** - Parse & validate incoming requests:
```ts
export const PromptRequest = Schema.Struct({
  parts: Schema.Array(TextPromptPart),
  model: Schema.optionalKey(Schema.Struct({ providerID: Schema.String, modelID: Schema.String })),
})
```

**Effect handlers** - Composable request handlers:
```ts
HttpRouter.route("GET", "/", Effect.gen(function* () {
  return okHtml(renderHomepage(yield* HttpServerRequest.toWeb(yield* HttpServerRequest.HttpServerRequest)))
}))
```

## Demo

```bash
# Connect to the hosted demo
opencode attach https://opencode-do.southpolesteve.workers.dev

# Or use one-shot mode
opencode run --attach https://opencode-do.southpolesteve.workers.dev "tell me a joke"
```

## How it works

```
┌─────────────────────────────────────────────┐
│  OpenCode CLI/TUI                           │
│  opencode attach <worker-url>               │
└──────────────────┬──────────────────────────┘
                   │ HTTP + SSE (OpenCode API)
                   ▼
┌─────────────────────────────────────────────┐
│  Cloudflare Worker                          │
│  Routes requests, handles bootstrap API     │
└──────────────────┬──────────────────────────┘
                   │ Durable Object RPC
                   ▼
┌─────────────────────────────────────────────┐
│  Session Durable Object                     │
│  - SQLite message storage                   │
│  - SSE event streaming                      │
│  - Workers AI (Llama 3.2 3B)               │
│  - Hibernates when idle                     │
└─────────────────────────────────────────────┘
```

## Limitations (POC)

This is a proof-of-concept, not a production system:

- **Rate limited** - 20 requests per hour per IP (it's a free demo!)
- **No tools** - Read, Write, Edit, Bash, etc. are not implemented
- **No file system** - Can't interact with files
- **Single model** - Llama 3.2 3B via Workers AI (small but fast)
- **No streaming** - Responses come all at once, not streamed

## Deploy your own

1. Clone this repo
2. Install dependencies: `npm install`
3. Login to Cloudflare: `npx wrangler login`
4. Deploy: `npx wrangler deploy`

## Development

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Type check
npm run typecheck

# Deploy
npm run deploy
```

## Project structure

```
opencode-do/
├── src/
│   └── index.ts        # Worker + Durable Object implementation
├── wrangler.jsonc      # Cloudflare Worker config
├── tsconfig.json       # TypeScript config
└── proxy.ts            # Debug proxy for comparing with local OpenCode
```

## Key implementation details

### Sortable Message IDs

OpenCode's TUI uses string comparison to determine message ordering. We generate IDs in the same format as OpenCode (`msg_<timestamp-hex><random>`) to ensure proper sorting.

### SSE Event Protocol

The TUI expects specific SSE events in a specific order:
1. `message.updated` - User message created
2. `message.part.updated` - User message text
3. `message.updated` - User message with `summary` (signals completion)
4. `message.updated` - Assistant message placeholder
5. `session.status` - `busy`
6. `message.part.updated` - `step-start`
7. `message.part.updated` - Response text
8. `message.part.updated` - `step-finish`
9. `message.updated` - Assistant with `time.completed` and `finish: "stop"`
10. `session.status` - `idle`
11. `session.idle` - Deprecated but still expected

### SQLite Persistence

Messages are stored in Durable Object SQLite storage, which persists across hibernation cycles. This means you can walk away, come back hours later, and your conversation is still there.

## Future Possibilities

This section is intentionally high level. The current product architecture plan lives in [PRODUCT_PLAN.md](./PRODUCT_PLAN.md), and the baseline verification flow lives in [docs/DEPLOYMENT_SMOKE_CHECKLIST.md](./docs/DEPLOYMENT_SMOKE_CHECKLIST.md).

This POC demonstrates the basics, but the architecture supports much more. One important constraint from upstream OpenCode is that `attach` makes the client a remote UI, not a local tool executor. That means tool calls must be solved server-side or through a separate companion process, not by assuming the stock attached TUI will run them locally.

Here's what could be added:

### File System Access

The cleanest solution is [worker-fs-mount](https://github.com/danlapid/worker-fs-mount), a drop-in replacement for `node:fs/promises` with pluggable backends:

- **[durable-object-fs](https://github.com/danlapid/worker-fs-mount/tree/main/packages/durable-object-fs)** - SQLite-backed filesystem in a Durable Object (perfect for per-session workspaces)
- **[r2-fs](https://github.com/danlapid/worker-fs-mount/tree/main/packages/r2-fs)** - R2-backed filesystem for larger files
- **[memory-fs](https://github.com/danlapid/worker-fs-mount/tree/main/packages/memory-fs)** - In-memory filesystem for ephemeral use

This would let you implement Read/Write/Edit tools using standard `fs` APIs, with files persisting in your chosen backend.

### Tool Calling & Code Execution

For running arbitrary code safely, [Dynamic Worker Loaders](https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/) are the way to go:

- Spawn isolated Workers on-demand to execute untrusted code
- Millisecond startup time (much faster than containers)
- Full sandboxing: block network access, provide custom bindings
- Excellent for isolated generated code and safe snippet execution

The Cloudflare Agents SDK's [Codemode](https://developers.cloudflare.com/agents/api-reference/codemode/) is built on Dynamic Worker Loaders, giving LLMs a "write code" tool that runs in isolated sandboxes. This pattern would work great here.

For the tool calling flow:
1. Use a model with function calling support (Llama 3.3 70B, Mistral, etc.)
2. When the model requests a tool call, emit `tool-call` message parts via SSE
3. Execute the tool (in a dynamic isolate for untrusted code)
4. Return results as `tool-result` parts
5. Continue the conversation with tool results in context

Dynamic Worker Loaders should be treated as a hosted sandbox layer, not as a complete replacement for a real shell.

### Local Companion

If you want access to the user's actual local machine, the cleanest path is a separate companion process:

- The companion exposes local tools such as Bash, Read, Write, Edit, and git operations
- The Cloudflare session loop invokes those tools through MCP or another authenticated outbound bridge
- The stock OpenCode TUI remains unchanged and continues to act as a remote UI

This preserves one authoritative session loop in Cloudflare while still making local-machine execution possible as an opt-in mode.

### Git Operations

Git support could work via:

- **[isomorphic-git](https://isomorphic-git.org/)** - Pure JavaScript git implementation that works in Workers
- Clone repos to R2 or Durable Object storage using worker-fs-mount
- Implement git operations (status, diff, commit, push) as tools
- Use GitHub API for remote operations

### Container Execution

For heavier workloads or full shell environments:

- **[Cloudflare Containers](https://developers.cloudflare.com/containers/)** - Run containers alongside your Worker
- Spin up ephemeral containers for builds, tests, complex toolchains
- Mount R2 storage as the filesystem

Containers are the honest hosted answer for full shell workflows. Plain Workers plus Durable Objects should not be sold as a full Linux environment.

### Better Models

Swap in more capable models:

- **Anthropic Claude** via [AI Gateway](https://developers.cloudflare.com/ai-gateway/)
- **OpenAI GPT-4** via AI Gateway
- **Any OpenAI-compatible API** with custom endpoints

The OpenCode protocol is model-agnostic, so you can use whatever model fits your needs.

## Credits

- [OpenCode](https://opencode.ai) - The amazing AI coding assistant that makes this possible
- [Cloudflare Workers](https://workers.cloudflare.com) - Edge compute platform
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/) - Stateful serverless
- [Workers AI](https://developers.cloudflare.com/workers-ai/) - AI inference at the edge

## License

MIT
