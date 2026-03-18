import { DurableObject } from "cloudflare:workers"
import * as Effect from "effect/Effect"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest"
import * as ServiceMap from "effect/ServiceMap"
import type { SessionInfo } from "./contracts.js"
import { GlobalEventRuntime } from "./services.js"
import { empty, notFound, okJsonUnsafe } from "./responses.js"
import { broadcast, openSse } from "./sse.js"

const Routes = HttpRouter.addAll([
  HttpRouter.route(
    "GET",
    "/event",
    Effect.gen(function* () {
      const req = yield* HttpServerRequest.HttpServerRequest
      const runtime = yield* GlobalEventRuntime
      const webRequest = yield* HttpServerRequest.toWeb(req)
      return openSse({
        signal: webRequest.signal,
        writers: runtime.writers,
        encoder: runtime.encoder,
        connected: { type: "server.connected", properties: {} },
      })
    }),
  ),
  HttpRouter.route(
    "GET",
    "/global/event",
    Effect.gen(function* () {
      const req = yield* HttpServerRequest.HttpServerRequest
      const runtime = yield* GlobalEventRuntime
      const webRequest = yield* HttpServerRequest.toWeb(req)
      return openSse({
        signal: webRequest.signal,
        writers: runtime.writers,
        encoder: runtime.encoder,
        connected: { type: "server.connected", properties: {} },
      })
    }),
  ),
  HttpRouter.route(
    "POST",
    "/broadcast",
    Effect.gen(function* () {
      const req = yield* HttpServerRequest.HttpServerRequest
      const runtime = yield* GlobalEventRuntime
      const payload = yield* req.json
      if (
        typeof payload === "object" &&
        payload !== null &&
        "type" in payload &&
        payload.type === "session.updated" &&
        "properties" in payload &&
        typeof payload.properties === "object" &&
        payload.properties !== null &&
        "info" in payload.properties
      ) {
        const info = payload.properties.info as SessionInfo
        runtime.storage.put(`session:${info.id}`, JSON.stringify(info))
      }
      if (
        typeof payload === "object" &&
        payload !== null &&
        "type" in payload &&
        payload.type === "session.deleted" &&
        "properties" in payload &&
        typeof payload.properties === "object" &&
        payload.properties !== null &&
        "info" in payload.properties
      ) {
        const info = payload.properties.info as { id: string }
        runtime.storage.delete(`session:${info.id}`)
      }
      yield* broadcast({
        writers: runtime.writers,
        encoder: runtime.encoder,
        payload,
      })
      return empty()
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
  HttpRouter.route(
    "GET",
    "/sessions",
    Effect.gen(function* () {
      const runtime = yield* GlobalEventRuntime
      const entries = yield* Effect.promise(() => runtime.storage.list({ prefix: "session:" }))
      const keys = Array.from(entries.keys())
      const sessions = yield* Effect.promise(() =>
        Promise.all(
          keys.map(async (key) => {
            const value = await runtime.storage.get<string>(key)
            return value ? (JSON.parse(value) as SessionInfo) : undefined
          }),
        ),
      )
      return okJsonUnsafe(
        sessions
          .filter((value): value is SessionInfo => value !== undefined)
          .sort((a, b) => b.time.updated - a.time.updated),
      )
    }),
  ),
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

export class GlobalEventDO extends DurableObject<Env> {
  private readonly writers = new Set<WritableStreamDefaultWriter<Uint8Array>>()
  private readonly encoder = new TextEncoder()

  async fetch(request: Request) {
    return handler(
      request,
      ServiceMap.make(GlobalEventRuntime, {
        writers: this.writers,
        encoder: this.encoder,
        storage: this.ctx.storage,
      }),
    )
  }
}
