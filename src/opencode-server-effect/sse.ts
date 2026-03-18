import * as Effect from "effect/Effect"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"
import type { SseWriter } from "./services.js"
import { withCors } from "./responses.js"

export function formatSse(data: unknown) {
  return `event: message\ndata: ${JSON.stringify(data)}\n\n`
}

export function openSse(input: {
  signal: AbortSignal
  writers: Set<SseWriter>
  encoder: TextEncoder
  connected: unknown
}) {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()
  input.writers.add(writer)

  const cleanup = () => {
    input.writers.delete(writer)
  }

  void writer.write(input.encoder.encode(formatSse(input.connected))).catch(cleanup)

  const heartbeat = setInterval(() => {
    void writer.write(input.encoder.encode(": ping\n\n")).catch(() => {
      clearInterval(heartbeat)
      cleanup()
    })
  }, 15_000)

  input.signal.addEventListener(
    "abort",
    () => {
      clearInterval(heartbeat)
      cleanup()
    },
    { once: true },
  )

  return withCors(
    HttpServerResponse.raw(readable, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    }),
  )
}

export function broadcast(input: {
  writers: Set<SseWriter>
  encoder: TextEncoder
  payload: unknown
}) {
  const encoded = input.encoder.encode(formatSse(input.payload))
  return Effect.forEach(Array.from(input.writers), (writer) =>
    Effect.promise(() => writer.write(encoded)).pipe(
      Effect.catch(() =>
        Effect.sync(() => {
          input.writers.delete(writer)
        }),
      ),
    ))
}
