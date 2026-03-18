import * as Schema from "effect/Schema"

export const SessionParams = Schema.Struct({
  sessionID: Schema.String,
})

export const SessionQuery = Schema.Struct({
  sessionId: Schema.optionalKey(Schema.String),
  id: Schema.optionalKey(Schema.String),
})

export class TextPromptPart extends Schema.Class<TextPromptPart>("TextPromptPart")({
  type: Schema.Literal("text"),
  text: Schema.String,
}) {}

export const PromptRequest = Schema.Struct({
  parts: Schema.Array(TextPromptPart),
  model: Schema.optionalKey(
    Schema.Struct({
      providerID: Schema.String,
      modelID: Schema.String,
    }),
  ),
  agent: Schema.optionalKey(Schema.String),
  messageID: Schema.optionalKey(Schema.String),
})

export const CreateSessionRequest = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
})

export type PromptRequest = Schema.Schema.Type<typeof PromptRequest>
export type CreateSessionRequest = Schema.Schema.Type<typeof CreateSessionRequest>
export type SessionParams = Schema.Schema.Type<typeof SessionParams>

export type SessionInfo = {
  id: string
  slug: string
  projectID: string
  workspaceID?: string
  directory: string
  parentID?: string
  title: string
  version: string
  time: { created: number; updated: number }
}

export type MessageInfo = {
  id: string
  sessionID: string
  role: "user" | "assistant"
  time: { created: number; completed?: number }
  agent: string
  model?: { providerID: string; modelID: string }
  parentID?: string
  modelID?: string
  providerID?: string
  mode?: string
  path?: { cwd: string; root: string }
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  finish?: string
}

export type MessagePart = {
  id: string
  sessionID: string
  messageID: string
  type: string
  text?: string
  time?: { start: number; end?: number }
  reason?: string
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
}

export type StoredMessage = {
  info: MessageInfo
  parts: Array<MessagePart>
}
