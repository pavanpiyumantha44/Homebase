import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Msg } from '../src/Ollama'

export interface Chat {
  id: string
  title: string
  model: string
  messages: Msg[]
  updatedAt: number
}

interface S {
  chats: Chat[]
  activeId: string | null
  model: string
  newChat: () => string
  selectChat: (id: string) => void
  deleteChat: (id: string) => void
  setModel: (m: string) => void
  addMessage: (id: string, m: Msg) => void
  rename: (id: string, title: string) => void
}

const upd = (cs: Chat[], id: string, f: (c: Chat) => Partial<Chat>) =>
  cs.map((c) => (c.id === id ? { ...c, ...f(c) } : c))

export const useStore = create<S>()(
  persist(
    (set, get) => ({
      chats: [],
      activeId: null,
      model: '',
      newChat: () => {
        const c: Chat = {
          id: crypto.randomUUID(),
          title: 'New chat',
          model: get().model,
          messages: [],
          updatedAt: Date.now(),
        }
        set((s) => ({ chats: [c, ...s.chats], activeId: c.id }))
        return c.id
      },
      selectChat: (id) =>
        set((s) => ({ activeId: id, model: s.chats.find((c) => c.id === id)?.model || s.model })),
      deleteChat: (id) =>
        set((s) => ({
          chats: s.chats.filter((c) => c.id !== id),
          activeId: s.activeId === id ? null : s.activeId,
        })),
      setModel: (m) =>
        set((s) => ({
          model: m,
          chats: s.activeId ? upd(s.chats, s.activeId, () => ({ model: m })) : s.chats,
        })),
      addMessage: (id, m) =>
        set((s) => ({
          chats: upd(s.chats, id, (c) => ({ messages: [...c.messages, m], updatedAt: Date.now() })),
        })),
      rename: (id, title) => set((s) => ({ chats: upd(s.chats, id, () => ({ title })) })),
    }),
    { name: 'ollama-chat' },
  ),
)

// Streaming text lives outside the persisted store so token updates stay cheap.
export const useLive = create<{ busy: boolean; text: string; chatId: string | null }>(() => ({
  busy: false,
  text: '',
  chatId: null,
}))