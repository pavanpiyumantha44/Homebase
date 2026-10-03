import { useEffect, useRef, useState } from 'react'
import { listModels, streamChat, type Msg } from './Ollama'
import { useStore, useLive } from './Store'
import Markdown from './Markdown'
import Stats from './Stats'
import Logo from './Logo'
import { useFolder } from './UseFolder'

type Theme = 'light' | 'dark'

// If the model sends nothing for this long, the request is stopped and can be retried.
// The timer restarts on every token, so long answers that keep streaming are never cut off.
const STALL_MS = 90_000

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
  const [failed, setFailed] = useState<{ chatId: string; msg: string } | null>(null)
  const [input, setInput] = useState('')
  const [nav, setNav] = useState(false)
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme as Theme)
  const folder = useFolder()
  const fileInput = useRef<HTMLInputElement>(null)
  const abort = useRef<AbortController | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  const chat = chats.find((c) => c.id === activeId)
  const showLive = live.busy && live.chatId === activeId
  const showFail = !!failed && failed.chatId === activeId && !live.busy

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
  }, [chat?.messages.length, live.text, showLive, showFail])

  // Streams a reply for `history` (which must end with a user message) into chat `id`.
  async function run(id: string, history: Msg[]) {
    const ctrl = new AbortController()
    abort.current = ctrl
    let buf = ''
    let raf = 0
    let timedOut = false
    let hadError = false
    let timer = 0
    const arm = () => {
      clearTimeout(timer)
      timer = window.setTimeout(() => { timedOut = true; ctrl.abort() }, STALL_MS)
    }

    useLive.setState({ busy: true, text: '', chatId: id })
    arm()
    try {
      await streamChat(model, history, (t) => {
        arm()
        buf += t
        // one UI update per frame, not per token
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; useLive.setState({ text: buf }) })
      }, ctrl.signal)
    } catch (e) {
      if (timedOut) {
        hadError = true
        setFailed({ chatId: id, msg: `No response from the model for ${STALL_MS / 1000}s. It may still be loading or out of memory.` })
      } else if ((e as Error).name !== 'AbortError') {
        hadError = true
        setFailed({ chatId: id, msg: (e as Error).message })
      }
    } finally {
      clearTimeout(timer)
      cancelAnimationFrame(raf)
      // A manual Stop keeps the partial answer; a failure discards it so Retry starts clean.
      if (buf && !hadError) addMessage(id, { role: 'assistant', content: buf })
      useLive.setState({ busy: false, text: '', chatId: null })
    }
  }

  function send(override?: string) {
    const text = (override ?? input).trim()
    if (!text || live.busy || !model) return
    setInput('')
    setErr('')
    setFailed(null)

    const id = activeId ?? newChat()
    const prev = useStore.getState().chats.find((c) => c.id === id)?.messages ?? []
    const msg: Msg = { role: 'user', content: text }
    addMessage(id, msg)
    if (prev.length === 0) rename(id, text.slice(0, 40))
    run(id, [...prev, msg])
  }

  function retry() {
    if (!chat || live.busy) return
    setFailed(null)
    run(chat.id, chat.messages)
  }

  const empty = !chat?.messages.length && !showLive

  return (
    <div className={'app' + (nav ? ' nav-open' : '')}>
      <aside className="side">
        <div className="brand"><Logo />Homebase</div>
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
        <div className="storage">
          {folder.status === 'unsupported' && <p>This browser can't save to a folder. Use Export and Import to keep your chats.</p>}
          {folder.status === 'none' && (
            <>
              <p>Chats stay in memory until you pick a folder to save them in.</p>
              <button onClick={folder.connect}>Choose folder</button>
            </>
          )}
          {folder.status === 'needs-permission' && (
            <>
              <p>Allow access to <b>{folder.name}</b> to load and save your chats.</p>
              <button onClick={folder.reconnect}>Reconnect</button>
            </>
          )}
          {folder.status === 'ready' && (
            <>
              <p><span className="ok" />Saved to <b>{folder.name}</b></p>
              <button onClick={folder.connect}>Change folder</button>
            </>
          )}
          {folder.error && <p className="bad">{folder.error}</p>}
          <div className="row">
            <button onClick={folder.exportChats} disabled={!chats.length}>Export</button>
            <button onClick={() => fileInput.current?.click()}>Import</button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) folder.importChats(f)
                e.target.value = ''
              }}
            />
          </div>
          {folder.notice && <p>{folder.notice}</p>}
        </div>
      </aside>
      <div className="scrim" onClick={() => setNav(false)} />

      <main>
        <header>
          <button className="icon burger" aria-label="Toggle chat history" onClick={() => setNav(!nav)}>☰</button>
          <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model">
            {models.map((m) => <option key={m}>{m}</option>)}
          </select>
          <span className="grow" />
          <Stats />
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
            {showFail && (
              <div className="fail" role="alert">
                <span>{failed!.msg}</span>
                <button onClick={retry}>Retry</button>
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