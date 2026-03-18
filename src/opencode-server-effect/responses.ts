import * as Effect from "effect/Effect"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Expose-Headers": "Content-Type,X-RateLimit-Limit,X-RateLimit-Remaining,X-RateLimit-Reset",
}

export function withCors(response: HttpServerResponse.HttpServerResponse) {
  return HttpServerResponse.setHeaders(response, corsHeaders)
}

export function okJsonUnsafe(body: unknown, options?: HttpServerResponse.Options.WithContentType) {
  return HttpServerResponse.raw(
    new Response(JSON.stringify(body), {
      status: options?.status ?? 200,
      statusText: options?.statusText,
      headers: {
        ...corsHeaders,
        ...(options?.headers ?? {}),
        "Content-Type": "application/json; charset=utf-8",
      },
    }),
  )
}

export function okJson(body: unknown, options?: HttpServerResponse.Options.WithContentType) {
  return Effect.sync(() => okJsonUnsafe(body, options))
}

export function okText(body: string, options?: HttpServerResponse.Options.WithContentType) {
  return withCors(HttpServerResponse.text(body, options))
}

export function okHtml(body: string, options?: HttpServerResponse.Options.WithContentType) {
  return withCors(
    HttpServerResponse.text(body, {
      ...options,
      contentType: "text/html; charset=utf-8",
    }),
  )
}

export function empty(status = 204) {
  return withCors(HttpServerResponse.empty({ status }))
}

export function notFound() {
  return okText("Not found", { status: 404 })
}

export function fromWeb(response: Response) {
  return HttpServerResponse.raw(response)
}
