import { DurableObject } from "cloudflare:workers"
import * as Effect from "effect/Effect"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"
import * as Schema from "effect/Schema"
import * as ServiceMap from "effect/ServiceMap"
import type { MessageInfo, MessagePart, PromptRequest, StoredMessage } from "./contracts.js"
import { PromptRequest as PromptRequestSchema, SessionParams } from "./contracts.js"
import { DEFAULT_MODEL, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from "./defaults.js"
import { generateId } from "./ids.js"
import { empty, fromWeb, notFound, okJsonUnsafe } from "./responses.js"
import type { SessionRuntimeShape, SseWriter } from "./services.js"
import { SessionRuntime } from "./services.js"
import { broadcast, formatSse, openSse } from "./sse.js"

function initSchema(sql: SqlStorage) {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

    CREATE TABLE IF NOT EXISTS rate_limits (
      ip TEXT PRIMARY KEY,
      request_count INTEGER NOT NULL DEFAULT 0,
      window_start INTEGER NOT NULL
    );
  `)
}

function messagesForSession(sql: SqlStorage, sessionID: string, limit: number) {
  return sql
    .exec(
      `SELECT data FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?`,
      sessionID,
      limit,
    )
    .toArray()
    .map((row) => JSON.parse(String(row.data)) as StoredMessage)
}

function storeMessage(sql: SqlStorage, message: StoredMessage) {
  sql.exec(
    `INSERT OR REPLACE INTO messages (id, session_id, role, created_at, completed_at, data) VALUES (?, ?, ?, ?, ?, ?)`,
    message.info.id,
    message.info.sessionID,
    message.info.role,
    message.info.time.created,
    message.info.time.completed ?? null,
    JSON.stringify(message),
  )
}

function rateLimit(sql: SqlStorage, ip: string) {
  const now = Date.now()
  const windowStart = now - RATE_LIMIT_WINDOW_MS
  sql.exec(`DELETE FROM rate_limits WHERE window_start < ?`, windowStart)

  const row = sql
    .exec(`SELECT request_count, window_start FROM rate_limits WHERE ip = ?`, ip)
    .toArray()[0]

  if (!row) {
    sql.exec(`INSERT INTO rate_limits (ip, request_count, window_start) VALUES (?, 1, ?)`, ip, now)
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetAt: now + RATE_LIMIT_WINDOW_MS }
  }

  const count = Number(row.request_count)
  const start = Number(row.window_start)
  if (count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0, resetAt: start + RATE_LIMIT_WINDOW_MS }
  }

  sql.exec(`UPDATE rate_limits SET request_count = request_count + 1 WHERE ip = ?`, ip)
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - count - 1, resetAt: start + RATE_LIMIT_WINDOW_MS }
}

function modelResponse(input: { env: Env; text: string }) {
  return Effect.promise(() =>
    input.env.AI.run("@cf/meta/llama-3.2-3b-instruct", {
      stream: true,
      messages: [
        { role: "system", content: "You are a helpful coding assistant. Be concise." },
        { role: "user", content: input.text },
      ],
    }) as Promise<unknown>,
  ).pipe(
    Effect.catchCause(() => Effect.succeed(null as unknown)),
  )
}

function modelResponseText(input: { env: Env; text: string }) {
  return Effect.promise(() =>
    input.env.AI.run("@cf/meta/llama-3.2-3b-instruct", {
      messages: [
        { role: "system", content: "You are a helpful coding assistant. Be concise." },
        { role: "user", content: input.text },
      ],
    }) as Promise<{ response?: string }>,
  ).pipe(
    Effect.map((response) => String(response.response ?? "")),
    Effect.catchCause(() => Effect.succeed("I'm sorry, I encountered an error generating a response.")),
  )
}

function parseModelDelta(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed || trimmed === "[DONE]") return ""

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    if (typeof parsed.response === "string") return parsed.response
    if (typeof parsed.delta === "string") return parsed.delta
    if (typeof parsed.text === "string") return parsed.text
    if (parsed.result && typeof parsed.result === "object" && parsed.result !== null) {
      const result = parsed.result as Record<string, unknown>
      if (typeof result.response === "string") return result.response
      if (typeof result.text === "string") return result.text
    }
    return ""
  } catch {
    return trimmed
  }
}

async function consumeModelStream(input: {
  stream: ReadableStream<Uint8Array>
  onDelta: (delta: string) => Promise<void>
}) {
  const reader = input.stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let full = ""

  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n").replace(/\r/g, "\n")
      const events = buffer.split("\n\n")
      buffer = events.pop() ?? ""

      for (const event of events) {
        const data = event
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.replace(/^data:\s*/, ""))
          .join("\n")
        const delta = parseModelDelta(data)
        if (!delta) continue
        full += delta
        await input.onDelta(delta)
      }
    }

    const trailing = parseModelDelta(buffer.replace(/^data:\s*/gm, ""))
    if (trailing) {
      full += trailing
      await input.onDelta(trailing)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  return full
}

function relayToGlobal(env: Env, payload: unknown) {
  return Effect.promise(async () => {
    const stub = env.GLOBAL_EVENT.get(env.GLOBAL_EVENT.idFromName("global"))
    await stub.fetch("https://global.internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  }).pipe(Effect.catch(() => Effect.void))
}

function fanout(payload: unknown) {
  return Effect.gen(function* () {
    const runtime = yield* SessionRuntime
    yield* broadcast({
      writers: runtime.writers,
      encoder: runtime.encoder,
      payload,
    })
    yield* relayToGlobal(runtime.env, payload)
  })
}

async function fanoutRuntime(runtime: SessionRuntimeShape, payload: unknown) {
  const encoded = runtime.encoder.encode(formatSse(payload))
  await Promise.all(
    (Array.from(runtime.writers) as SseWriter[]).map(async (writer) => {
      try {
        await writer.write(encoded)
      } catch {
        runtime.writers.delete(writer)
      }
    }),
  )

  try {
    const stub = runtime.env.GLOBAL_EVENT.get(runtime.env.GLOBAL_EVENT.idFromName("global"))
    await stub.fetch("https://global.internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  } catch {}
}

function makeUserMessage(input: {
  sessionID: string
  body: PromptRequest
  now: number
  text: string
}): StoredMessage {
  const messageID = input.body.messageID ?? generateId("msg")
  return {
    info: {
      id: messageID,
      sessionID: input.sessionID,
      role: "user",
      time: { created: input.now },
      agent: input.body.agent ?? "default",
      model: {
        providerID: DEFAULT_MODEL.providerID,
        modelID: DEFAULT_MODEL.id,
      },
    },
    parts: [
      {
        id: generateId("prt"),
        sessionID: input.sessionID,
        messageID,
        type: "text",
        text: input.text,
        time: { start: input.now, end: input.now },
      },
    ],
  }
}

function messageRoute() {
  return Effect.gen(function* () {
    const runtime = yield* SessionRuntime
    const req = yield* HttpServerRequest.HttpServerRequest
    const { sessionID } = yield* HttpRouter.schemaPathParams(SessionParams)
    const ip =
      req.headers["cf-connecting-ip"] ??
      req.headers["x-forwarded-for"] ??
      "unknown"

    const allowance = rateLimit(runtime.sql, ip)
    if (!allowance.allowed) {
      return okJsonUnsafe(
        {
          error: "Rate limit exceeded",
          message: `You've reached the limit of ${RATE_LIMIT_MAX_REQUESTS} requests per hour. This is a free demo, please try again later.`,
          resetAt: allowance.resetAt,
        },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": String(RATE_LIMIT_MAX_REQUESTS),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.ceil(allowance.resetAt / 1000)),
          },
        },
      )
    }

    const bodyUnknown = yield* req.json.pipe(Effect.catch(() => Effect.succeed({})))
    const body = yield* Schema.decodeUnknownEffect(PromptRequestSchema)(bodyUnknown).pipe(
      Effect.catch(() => Effect.fail(new Error("Invalid request payload format."))),
    )
    const text = body.parts.map((part) => part.text).join("\n")
    const now = Date.now()
    const userMessage = makeUserMessage({ sessionID, body, now, text })
    const assistantID = generateId("msg")

    storeMessage(runtime.sql, userMessage)

    yield* fanout({
      type: "message.updated",
      properties: { info: userMessage.info },
    })
    yield* fanout({
      type: "message.part.updated",
      properties: { part: userMessage.parts[0] },
    })
    yield* fanout({
      type: "message.updated",
      properties: { info: { ...userMessage.info, summary: { diffs: [] } } },
    })

    const assistantInfo: MessageInfo = {
      id: assistantID,
      sessionID,
      role: "assistant",
      time: { created: now },
      parentID: userMessage.info.id,
      modelID: DEFAULT_MODEL.id,
      providerID: DEFAULT_MODEL.providerID,
      mode: "build",
      agent: body.agent ?? "default",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }

    storeMessage(runtime.sql, {
      info: assistantInfo,
      parts: [],
    })

    yield* fanout({
      type: "message.updated",
      properties: { info: assistantInfo },
    })
    yield* fanout({
      type: "session.status",
      properties: { sessionID, status: { type: "busy" } },
    })

    const streamResult = yield* modelResponse({
      env: runtime.env,
      text,
    })
    const stepStart: MessagePart = {
      id: generateId("prt"),
      sessionID,
      messageID: assistantID,
      type: "step-start",
    }
    yield* fanout({
      type: "message.part.updated",
      properties: { part: stepStart },
    })

    let textPartID: string | undefined
    let textResponse = ""
    let emittedText = false

    if (streamResult instanceof ReadableStream) {
      textResponse = yield* Effect.promise(() =>
        consumeModelStream({
          stream: streamResult,
          onDelta: async (delta) => {
            if (!textPartID) {
              textPartID = generateId("prt")
              await fanoutRuntime(runtime, {
                type: "message.part.updated",
                properties: {
                  part: {
                    id: textPartID,
                    sessionID,
                    messageID: assistantID,
                    type: "text",
                    text: delta,
                    time: { start: now },
                  },
                },
              })
              emittedText = true
              return
            }

            await fanoutRuntime(runtime, {
              type: "message.part.delta",
              properties: {
                messageID: assistantID,
                partID: textPartID,
                field: "text",
                delta,
              },
            })
            emittedText = true
          },
        }),
      ).pipe(
        Effect.catchCause(() => Effect.succeed("")),
      )
      if (!textResponse) {
        textResponse = yield* modelResponseText({
          env: runtime.env,
          text,
        })
      }
    } else {
      textResponse = yield* modelResponseText({
        env: runtime.env,
        text,
      })
    }

    const completed = Date.now()
    const textPart: MessagePart = {
      id: textPartID ?? generateId("prt"),
      sessionID,
      messageID: assistantID,
      type: "text",
      text: textResponse || "I'm sorry, I couldn't generate a response.",
      time: { start: now, end: completed },
    }
    const stepFinish: MessagePart = {
      id: generateId("prt"),
      sessionID,
      messageID: assistantID,
      type: "step-finish",
      reason: "stop",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }

    if (!emittedText) {
      textPartID = textPart.id
      yield* fanout({
        type: "message.part.updated",
        properties: { part: textPart },
      })
    }

    yield* fanout({
      type: "message.part.updated",
      properties: { part: stepFinish },
    })

    const assistantMessage: StoredMessage = {
      info: {
        ...assistantInfo,
        time: { created: now, completed },
        finish: "stop",
      },
      parts: [{ ...stepStart }, { ...textPart, id: textPartID ?? textPart.id }, stepFinish],
    }

    storeMessage(runtime.sql, assistantMessage)

    yield* fanout({
      type: "message.updated",
      properties: { info: assistantMessage.info },
    })
    yield* fanout({
      type: "session.status",
      properties: { sessionID, status: { type: "idle" } },
    })
    yield* fanout({
      type: "session.idle",
      properties: { sessionID },
    })

    return okJsonUnsafe(assistantMessage)
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.succeed(
        okJsonUnsafe(
          {
            error: cause.toString(),
          },
          { status: 500 },
        ),
      ),
    ),
  )
}

const Routes = HttpRouter.addAll([
  HttpRouter.route(
    "GET",
    "/event",
    Effect.gen(function* () {
      const req = yield* HttpServerRequest.HttpServerRequest
      const runtime = yield* SessionRuntime
      const webRequest = yield* HttpServerRequest.toWeb(req)
      const sessionID = new URL(webRequest.url).searchParams.get("sessionId") ?? "global"
      return openSse({
        signal: webRequest.signal,
        writers: runtime.writers,
        encoder: runtime.encoder,
        connected: { type: "server.connected", properties: { sessionID } },
      })
    }),
  ),
  HttpRouter.route(
    "GET",
    "/session/:sessionID/event",
    Effect.gen(function* () {
      const req = yield* HttpServerRequest.HttpServerRequest
      const runtime = yield* SessionRuntime
      const { sessionID } = yield* HttpRouter.schemaPathParams(SessionParams)
      const webRequest = yield* HttpServerRequest.toWeb(req)
      return openSse({
        signal: webRequest.signal,
        writers: runtime.writers,
        encoder: runtime.encoder,
        connected: { type: "server.connected", properties: { sessionID } },
      })
    }),
  ),
  HttpRouter.route(
    "GET",
    "/session/:sessionID/message",
    Effect.gen(function* () {
      const runtime = yield* SessionRuntime
      const req = yield* HttpServerRequest.HttpServerRequest
      const { sessionID } = yield* HttpRouter.schemaPathParams(SessionParams)
      const webRequest = yield* HttpServerRequest.toWeb(req)
      const limit = Number(new URL(webRequest.url).searchParams.get("limit") ?? "100")
      return okJsonUnsafe(messagesForSession(runtime.sql, sessionID, limit))
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.succeed(
          okJsonUnsafe(
            {
              error: cause.toString(),
            },
            { status: 500 },
          ),
        ),
      ),
    ),
  ),
  HttpRouter.route("POST", "/session/:sessionID/message", messageRoute()),
  HttpRouter.route("POST", "/session/:sessionID/prompt_async", messageRoute()),
  HttpRouter.route(
    "*",
    "*",
    Effect.gen(function* () {
      const req = yield* HttpServerRequest.HttpServerRequest
      if (req.method === "OPTIONS") return empty()
      return notFound()
    }),
  ),
])

const { handler } = HttpRouter.toWebHandler(Routes, { disableLogger: true })

export class SessionDO extends DurableObject<Env> {
  private readonly writers = new Set<WritableStreamDefaultWriter<Uint8Array>>()
  private readonly encoder = new TextEncoder()
  private readonly sql: SqlStorage

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    initSchema(this.sql)
  }

  async fetch(request: Request) {
    return handler(
      request,
      ServiceMap.make(SessionRuntime, {
        env: this.env,
        state: this.ctx,
        sql: this.sql,
        writers: this.writers,
        encoder: this.encoder,
      }),
    )
  }
}
