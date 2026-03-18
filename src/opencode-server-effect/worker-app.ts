import * as Effect from "effect/Effect"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"
import * as ServiceMap from "effect/ServiceMap"
import * as Schema from "effect/Schema"
import { CreateSessionRequest, CreateSessionRequest as CreateSessionRequestSchema, SessionQuery } from "./contracts.js"
import { DEFAULT_AGENT, DEFAULT_PROVIDER, createSessionInfo } from "./defaults.js"
import { generateId } from "./ids.js"
import { renderHomepage } from "./homepage.js"
import { WorkerBindings } from "./services.js"
import { empty, notFound, okHtml, okJson, okJsonUnsafe } from "./responses.js"

function globalEventStub(env: Env) {
  return env.GLOBAL_EVENT.get(env.GLOBAL_EVENT.idFromName("global"))
}

function sessionStub(env: Env, sessionID: string) {
  return env.SESSION.get(env.SESSION.idFromName(sessionID))
}

function proxyToSession(sessionID: string) {
  return Effect.gen(function* () {
    const env = yield* WorkerBindings
    const req = yield* HttpServerRequest.HttpServerRequest
    const webRequest = yield* HttpServerRequest.toWeb(req)
    const response = yield* Effect.promise(() => sessionStub(env, sessionID).fetch(webRequest))
    return HttpServerResponse.raw(response)
  })
}

function proxyToGlobal() {
  return Effect.gen(function* () {
    const env = yield* WorkerBindings
    const req = yield* HttpServerRequest.HttpServerRequest
    const webRequest = yield* HttpServerRequest.toWeb(req)
    const response = yield* Effect.promise(() => globalEventStub(env).fetch(webRequest))
    return HttpServerResponse.raw(response)
  })
}

function fetchGlobalSessions() {
  return Effect.gen(function* () {
    const env = yield* WorkerBindings
    const response = yield* Effect.promise(() => globalEventStub(env).fetch("https://global.internal/sessions"))
    return HttpServerResponse.raw(response)
  })
}

function broadcastGlobal(payload: unknown) {
  return Effect.gen(function* () {
    const env = yield* WorkerBindings
    yield* Effect.promise(() =>
      globalEventStub(env).fetch("https://global.internal/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    ).pipe(Effect.catch(() => Effect.void))
  })
}

const StaticRoutes = HttpRouter.addAll([
  HttpRouter.route(
    "GET",
    "/",
    Effect.gen(function* () {
      const req = yield* HttpServerRequest.HttpServerRequest
      const webRequest = yield* HttpServerRequest.toWeb(req)
      return okHtml(renderHomepage(webRequest))
    }),
  ),
  HttpRouter.route("GET", "/global/health", okJson({ healthy: true, version: "0.0.4" })),
  HttpRouter.route("GET", "/config", okJson({})),
  HttpRouter.route(
    "GET",
    "/config/providers",
    okJson({
      providers: [DEFAULT_PROVIDER],
      default: { "workers-ai": DEFAULT_PROVIDER.models["llama-3.2-3b-instruct"].id },
    }),
  ),
  HttpRouter.route(
    "GET",
    "/provider",
    okJson({
      all: [DEFAULT_PROVIDER],
      default: { "workers-ai": DEFAULT_PROVIDER.models["llama-3.2-3b-instruct"].id },
      connected: ["workers-ai"],
    }),
  ),
  HttpRouter.route("GET", "/provider/auth", okJson({})),
  HttpRouter.route("GET", "/agent", okJson([DEFAULT_AGENT])),
  HttpRouter.route("GET", "/command", okJson([])),
  HttpRouter.route("GET", "/lsp/status", okJson([])),
  HttpRouter.route("GET", "/lsp", okJson([])),
  HttpRouter.route("GET", "/mcp/status", okJson({})),
  HttpRouter.route("GET", "/mcp", okJson({})),
  HttpRouter.route("GET", "/experimental/resource", okJson({})),
  HttpRouter.route("GET", "/formatter/status", okJson([])),
  HttpRouter.route("GET", "/formatter", okJson([])),
  HttpRouter.route("GET", "/session/status", okJson({})),
  HttpRouter.route("GET", "/vcs", okJson({ branch: "main" })),
  HttpRouter.route(
    "GET",
    "/path",
    okJson({ state: "/", config: "/", worktree: "/", directory: "/" }),
  ),
  HttpRouter.route("GET", "/experimental/workspace", okJson([])),
  HttpRouter.route("GET", "/session", fetchGlobalSessions()),
  HttpRouter.route(
    "POST",
    "/session",
    Effect.gen(function* () {
      const req = yield* HttpServerRequest.HttpServerRequest
      const bodyUnknown = yield* req.json.pipe(Effect.catch(() => Effect.succeed({})))
      const body = yield* Schema.decodeUnknownEffect(CreateSessionRequestSchema)(bodyUnknown).pipe(
        Effect.catch(() => Effect.succeed({} as CreateSessionRequest)),
      )
      const sessionID = body.id ?? generateId("ses")
      const session = createSessionInfo({ sessionID, title: body.title })
      yield* broadcastGlobal({
        type: "session.updated",
        properties: { info: session },
      })
      return okJsonUnsafe(session)
    }),
  ),
  HttpRouter.route(
    "GET",
    "/session/:sessionID",
    Effect.gen(function* () {
      const { sessionID } = yield* HttpRouter.schemaPathParams(
        Schema.Struct({ sessionID: Schema.String }),
      )
      return okJsonUnsafe(createSessionInfo({ sessionID }))
    }),
  ),
  HttpRouter.route("GET", "/session/:sessionID/message", Effect.gen(function* () {
    const { sessionID } = yield* HttpRouter.schemaPathParams(Schema.Struct({ sessionID: Schema.String }))
    return yield* proxyToSession(sessionID)
  })),
  HttpRouter.route("GET", "/session/:sessionID/event", Effect.gen(function* () {
    const { sessionID } = yield* HttpRouter.schemaPathParams(Schema.Struct({ sessionID: Schema.String }))
    return yield* proxyToSession(sessionID)
  })),
  HttpRouter.route("GET", "/session/:sessionID/todo", okJson([])),
  HttpRouter.route("GET", "/session/:sessionID/diff", okJson([])),
  HttpRouter.route(
    "POST",
    "/session/:sessionID/fork",
    Effect.gen(function* () {
      const now = Date.now()
      return okJsonUnsafe({
        id: generateId("ses"),
        title: "Forked Session",
        time: { created: now, updated: now },
      })
    }),
  ),
  HttpRouter.route(
    "DELETE",
    "/session/:sessionID",
    Effect.gen(function* () {
      const { sessionID } = yield* HttpRouter.schemaPathParams(
        Schema.Struct({ sessionID: Schema.String }),
      )
      yield* broadcastGlobal({
        type: "session.deleted",
        properties: { info: { id: sessionID, time: { created: Date.now(), updated: Date.now() } } },
      })
      return okJsonUnsafe({ success: true })
    }),
  ),
  HttpRouter.route("GET", "/global/event", proxyToGlobal()),
  HttpRouter.route(
    "GET",
    "/event",
    Effect.gen(function* () {
      const req = yield* HttpServerRequest.HttpServerRequest
      const webRequest = yield* HttpServerRequest.toWeb(req)
      const parsed = yield* Schema.decodeUnknownEffect(SessionQuery)({
        sessionId: new URL(webRequest.url).searchParams.get("sessionId") ?? undefined,
        id: new URL(webRequest.url).searchParams.get("id") ?? undefined,
      }).pipe(
        Effect.catch(() =>
          Effect.succeed({
            sessionId: undefined,
            id: undefined,
          }),
        ),
      )
      const sessionID = parsed.sessionId ?? parsed.id
      if (sessionID) {
        return yield* proxyToSession(sessionID)
      }
      return yield* proxyToGlobal()
    }),
  ),
  HttpRouter.route("POST", "/session/:sessionID/message", Effect.gen(function* () {
    const { sessionID } = yield* HttpRouter.schemaPathParams(Schema.Struct({ sessionID: Schema.String }))
    return yield* proxyToSession(sessionID)
  })),
  HttpRouter.route("POST", "/session/:sessionID/prompt_async", Effect.gen(function* () {
    const { sessionID } = yield* HttpRouter.schemaPathParams(Schema.Struct({ sessionID: Schema.String }))
    return yield* proxyToSession(sessionID)
  })),
  HttpRouter.route("POST", "/session/:sessionID/permission/:requestID/reply", okJson({ success: true })),
  HttpRouter.route("POST", "/session/:sessionID/question/:requestID/reply", okJson({ success: true })),
  HttpRouter.route("POST", "/session/:sessionID/question/:requestID/reject", okJson({ success: true })),
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

const { handler, dispose } = HttpRouter.toWebHandler(StaticRoutes, { disableLogger: true })

export { dispose }

export function fetchWorker(request: Request, env: Env) {
  return handler(request, ServiceMap.make(WorkerBindings, env))
}
