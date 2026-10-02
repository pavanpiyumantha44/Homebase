import { useEffect, useRef, useState } from 'react'
import { listModels, streamChat } from '../src/Ollama'
import { useStore, useLive } from '../src/Store'
import Markdown from './Markdown'

type Theme = 'light' | 'dark'

// Apply the saved (or OS) theme before first paint to avoid a flash.
const initialTheme = (): Theme => {
  const saved = localStorage.getItem('theme')
  if (saved === 'light' || saved === 'dark') return saved
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
document.documentElement.dataset.theme = initialTheme()

const SUGGESTIONS = [
  'Write a debounce hook in React',
  'Explain SQL joins with examples',
  'Show a C# minimal API endpoint',
]

const Typing = () => (
  <div className="typing" role="status" aria-label="Model is thinking">
    <i /><i /><i />
  </div>
)

export default function App() {
  const { chats, activeId, model, newChat, selectChat, deleteChat, setModel, addMessage, rename } = useStore()
  const live = useLive()
  const [models, setModels] = useState<string[]>([])
  const [err, setErr] = useState('')
  const [input, setInput] = useState('')
  const [nav, setNav] = useState(false)
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme as Theme)
  const abort = useRef<AbortController | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  const chat = chats.find((c) => c.id === activeId)
  const showLive = live.busy && live.chatId === activeId

  const toggleTheme = () => {
    const t: Theme = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = t
    localStorage.setItem('theme', t)
    setTheme(t)
  }

  useEffect(() => {
    listModels()
      .then((m) => {
        setModels(m)
        if (!m.includes(model)) setModel(m[0] ?? '')
      })
      .catch(() => setErr("Can't reach Ollama at localhost:11434. Start it with `ollama serve`, then reload."))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const el = scroller.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight
  }, [chat?.messages.length, live.text, showLive])

  async function send(override?: string) {
    const text = (override ?? input).trim()
    if (!text || live.busy || !model) return
    setInput('')
    setErr('')

    const id = activeId ?? newChat()
    const prev = useStore.getState().chats.find((c) => c.id === id)?.messages ?? []
    const history = [...prev, { role: 'user' as const, content: text }]
    addMessage(id, history[history.length - 1])
    if (prev.length === 0) rename(id, text.slice(0, 40))

    const ctrl = new AbortController()
    abort.current = ctrl
    let buf = ''
    let raf = 0
    useLive.setState({ busy: true, text: '', chatId: id })

    try {
      await streamChat(model, history, (t) => {
        buf += t
        // one UI update per frame, not per token
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; useLive.setState({ text: buf }) })
      }, ctrl.signal)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setErr((e as Error).message)
    } finally {
      cancelAnimationFrame(raf)
      if (buf) addMessage(id, { role: 'assistant', content: buf })
      useLive.setState({ busy: false, text: '', chatId: null })
    }
  }

  const empty = !chat?.messages.length && !showLive

  return (
    <div className={'app' + (nav ? ' nav-open' : '')}>
      <aside className="side">
        <div className="brand"><span className="dot" />Ollama Chat</div>
        <button className="new" onClick={() => { newChat(); setNav(false) }}>+ New chat</button>
        <nav aria-label="Chat history">
          {chats.map((c) => (
            <div
              key={c.id}
              className={'item' + (c.id === activeId ? ' on' : '')}
              onClick={() => { selectChat(c.id); setNav(false) }}
            >
              <span>{c.title}</span>
              <button aria-label="Delete chat" onClick={(e) => { e.stopPropagation(); deleteChat(c.id) }}>×</button>
            </div>
          ))}
        </nav>
      </aside>
      <div className="scrim" onClick={() => setNav(false)} />

      <main>
        <header>
          <button className="icon burger" aria-label="Toggle chat history" onClick={() => setNav(!nav)}>☰</button>
          <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model">
            {models.map((m) => <option key={m}>{m}</option>)}
          </select>
          <span className="grow" />
          <button
            className="icon"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </header>

        <div className="scroll" ref={scroller}>
          <div className="thread">
            {empty && (
              <div className="empty">
                <h1>How can I help?</h1>
                <p>Running on your machine through Ollama.</p>
                <div className="chips">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)} disabled={!model}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {chat?.messages.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="user">{m.content}</div>
              ) : (
                <div key={i} className="ai"><span className="av">✦</span><div className="body"><Markdown text={m.content} /></div></div>
              ),
            )}
            {showLive && (
              <div className="ai">
                <span className="av pulse">✦</span>
                <div className="body">{live.text ? <Markdown text={live.text} /> : <Typing />}</div>
              </div>
            )}
          </div>
        </div>

        {err && <div className="err" role="alert">{err}</div>}

        <div className="composer">
          <div className="box">
            <textarea
              value={input}
              rows={1}
              placeholder="Message your model"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
              }}
            />
            {live.busy ? (
              <button className="go" onClick={() => abort.current?.abort()} aria-label="Stop generating">■</button>
            ) : (
              <button className="go" onClick={() => send()} disabled={!input.trim() || !model} aria-label="Send message">↑</button>
            )}
          </div>
          <p className="hint">Enter to send, Shift+Enter for a new line</p>
        </div>
      </main>
    </div>
  )
}