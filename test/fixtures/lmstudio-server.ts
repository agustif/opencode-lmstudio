import { createServer } from "node:http"
import modelsResponse from "./lmstudio-models.json" with { type: "json" }

export interface RecordedLMStudioRequest {
  method?: string
  url?: string
  authorization?: string
  body?: unknown
}

export interface LMStudioFixture {
  readonly requests: RecordedLMStudioRequest[]
  readonly serverURL: string
  readonly modelIDs: {
    readonly llm: string
    readonly vlm: string
    readonly embeddings: string
  }
  close(): Promise<void>
}

export async function createLMStudioFixture(
  _prefix: string,
  token: string,
  reply = "FIXTURE_OK",
): Promise<LMStudioFixture> {
  const requests: RecordedLMStudioRequest[] = []
  const server = createServer(async (request, response) => {
    let body = ""
    for await (const chunk of request) body += chunk
    const parsedBody: unknown = body ? JSON.parse(body) : undefined
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      body: parsedBody,
    })

    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: { message: "missing fixture token" } }))
      return
    }

    if (request.method === "GET" && request.url === "/api/v0/models") {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify(modelsResponse))
      return
    }

    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      const payload = parsedBody as { model?: string }
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      })
      const base = {
        id: "chatcmpl-fixture",
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: payload.model ?? modelIDs.llm,
      }
      response.write(`data: ${JSON.stringify({
        ...base,
        choices: [{ index: 0, delta: { role: "assistant", content: reply }, finish_reason: null }],
      })}\n\n`)
      response.write(`data: ${JSON.stringify({
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      })}\n\n`)
      response.end("data: [DONE]\n\n")
      return
    }

    response.writeHead(404, { "content-type": "application/json" })
    response.end(JSON.stringify({ error: { message: `Unhandled ${request.method} ${request.url}` } }))
  })

  const modelIDs = {
    llm: modelsResponse.data.find((model) => model.type === "llm")?.id ?? "",
    vlm: modelsResponse.data.find((model) => model.type === "vlm")?.id ?? "",
    embeddings: modelsResponse.data.find((model) => model.type === "embeddings")?.id ?? "",
  }
  if (Object.values(modelIDs).some((id) => !id)) throw new Error("LM Studio fixture is missing a representative model")

  const port = await new Promise<number>((resolvePort, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") return reject(new Error("Could not allocate fixture port"))
      resolvePort(address.port)
    })
  })

  return {
    requests,
    serverURL: `http://127.0.0.1:${port}`,
    modelIDs,
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
  }
}
