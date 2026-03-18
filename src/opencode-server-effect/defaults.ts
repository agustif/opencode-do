import type { SessionInfo } from "./contracts.js"

export const RATE_LIMIT_MAX_REQUESTS = 20
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

export const DEFAULT_MODEL = {
  id: "llama-3.2-3b-instruct",
  providerID: "workers-ai",
  api: {
    id: "workers-ai",
    url: "https://api.cloudflare.com",
    npm: "@cloudflare/ai",
  },
  name: "Llama 3.2 3B",
  family: "llama",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 128000, output: 4096 },
  status: "active" as const,
  options: {},
  headers: {},
  release_date: "2024-12-01",
}

export const DEFAULT_PROVIDER = {
  id: "workers-ai",
  name: "Workers AI",
  source: "env" as const,
  env: [],
  options: {},
  models: {
    "llama-3.2-3b-instruct": DEFAULT_MODEL,
  },
}

export const DEFAULT_AGENT = {
  name: "default",
  description: "Default coding assistant",
  model: {
    providerID: DEFAULT_MODEL.providerID,
    modelID: DEFAULT_MODEL.id,
  },
}

export function createSessionInfo(input: {
  sessionID: string
  title?: string
  now?: number
}): SessionInfo {
  const now = input.now ?? Date.now()
  return {
    id: input.sessionID,
    slug: input.sessionID.slice(0, 8),
    projectID: "opencode-do",
    directory: "/",
    title: input.title ?? "New Session",
    version: "1.0.0",
    time: {
      created: now,
      updated: now,
    },
  }
}
