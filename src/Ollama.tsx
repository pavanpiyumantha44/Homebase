export type Role = 'user' | 'assistant'
export interface Msg {
  role: Role
  content: string
}

export const BASE = 'http://localhost:11434'

export async function listModels(): Promise<string[]> {
  const r = await fetch(`${BASE}/api/tags`)
  if (!r.ok) throw new Error('Ollama not reachable')
  const d = await r.json()
  return d.models.map((m: { name: string }) => m.name)
}

// Ollama streams newline-delimited JSON; each line carries a small piece of the reply.
export async function streamChat(
  model: string,
  messages: Msg[],
  onToken: (t: string) => void,
  signal: AbortSignal,
) {
  const r = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  })
  if (!r.ok || !r.body) throw new Error(`Ollama returned ${r.status}`)

  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop()!
    for (const line of lines) {
      if (!line.trim()) continue
      const j = JSON.parse(line)
      if (j.error) throw new Error(j.error)
      if (j.message?.content) onToken(j.message.content)
    }
  }
}