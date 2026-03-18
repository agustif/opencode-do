import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { once } from "node:events"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const port = 8791
const baseUrl = `http://127.0.0.1:${port}`

let server: ChildProcessWithoutNullStreams | undefined

async function waitForReady(process: ChildProcessWithoutNullStreams) {
  let output = ""

  process.stdout.setEncoding("utf8")
  process.stderr.setEncoding("utf8")

  const onData = (chunk: string) => {
    output += chunk
  }

  process.stdout.on("data", onData)
  process.stderr.on("data", onData)

  try {
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      if (output.includes(`Ready on http://localhost:${port}`) || output.includes(`Ready on http://127.0.0.1:${port}`)) {
        return
      }
      if (process.exitCode !== null) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  } finally {
    process.stdout.off("data", onData)
    process.stderr.off("data", onData)
  }

  throw new Error(`wrangler dev did not become ready:\n${output}`)
}

async function readSse(response: Response, durationMs: number) {
  const body = response.body
  if (!body) return ""

  const reader = body.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  const deadline = Date.now() + durationMs

  while (Date.now() < deadline) {
    const timeout = Math.max(1, deadline - Date.now())
    const result = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value?: Uint8Array }>((resolve) =>
        setTimeout(() => resolve({ done: true }), timeout),
      ),
    ])

    if (result.done) break
    chunks.push(decoder.decode(result.value, { stream: true }))
  }

  await reader.cancel().catch(() => undefined)
  return chunks.join("")
}

beforeAll(async () => {
  server = spawn("npx", ["wrangler", "dev", "--local", "--port", String(port)], {
    cwd: process.cwd(),
    stdio: "pipe",
    env: { ...process.env },
  })
  await waitForReady(server)
})

afterAll(async () => {
  if (!server) return
  server.kill("SIGTERM")
  await once(server, "exit").catch(() => undefined)
})

describe("opencode-server-effect", () => {
  it("creates a session", async () => {
    const response = await fetch(`${baseUrl}/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Test Session" }),
    })
    expect(response.status).toBe(200)
    const data = (await response.json()) as { id: string; title: string }
    expect(data.id.startsWith("ses_")).toBe(true)
    expect(data.title).toBe("Test Session")
  })

  it("streams session events and persists assistant replies", async () => {
    const createResponse = await fetch(`${baseUrl}/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    const created = (await createResponse.json()) as { id: string }

    const eventResponse = await fetch(`${baseUrl}/session/${created.id}/event`)

    const promptResponse = await fetch(`${baseUrl}/session/${created.id}/prompt_async`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        parts: [{ type: "text", text: "say hello in five words" }],
        agent: "default",
      }),
    })

    expect(promptResponse.status).toBe(200)
    const events = await readSse(eventResponse, 1500)
    expect(events).toContain("server.connected")
    expect(events).toContain("message.updated")
    expect(events).toContain("message.part.updated")
    expect(events).toContain("session.status")

    const messagesResponse = await fetch(`${baseUrl}/session/${created.id}/message`)
    const messages = (await messagesResponse.json()) as Array<{
      info: { role: string }
      parts: Array<{ type: string; text?: string }>
    }>

    expect(messages.some((message) => message.info.role === "assistant")).toBe(true)
    expect(
      messages.some((message) =>
        message.parts.some((part) => part.type === "text" && typeof part.text === "string"),
      ),
    ).toBe(true)
  })
})
