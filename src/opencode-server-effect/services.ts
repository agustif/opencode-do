import * as ServiceMap from "effect/ServiceMap"

export class WorkerBindings extends ServiceMap.Service<WorkerBindings, Env>()(
  "opencode-server-effect/WorkerBindings",
) {}

export type SseWriter = WritableStreamDefaultWriter<Uint8Array>

export type SessionRuntimeShape = {
  env: Env
  state: DurableObjectState
  sql: SqlStorage
  writers: Set<SseWriter>
  encoder: TextEncoder
}

export class SessionRuntime extends ServiceMap.Service<SessionRuntime, SessionRuntimeShape>()(
  "opencode-server-effect/SessionRuntime",
) {}

export type GlobalEventRuntimeShape = {
  writers: Set<SseWriter>
  encoder: TextEncoder
  storage: DurableObjectStorage
}

export class GlobalEventRuntime extends ServiceMap.Service<GlobalEventRuntime, GlobalEventRuntimeShape>()(
  "opencode-server-effect/GlobalEventRuntime",
) {}
