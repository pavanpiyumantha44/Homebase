import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore, type Chat } from './Store'
import * as fs from './Fs'

export type FolderStatus = 'unsupported' | 'none' | 'needs-permission' | 'ready'

// Chats saved by the earlier localStorage version; imported once, then removed.
const LEGACY_KEY = 'ollama-chat'
function readLegacy(): Chat[] {
  try {
    return JSON.parse(localStorage.getItem(LEGACY_KEY) ?? 'null')?.state?.chats ?? []
  } catch {
    return []
  }
}

export function useFolder() {
  const [status, setStatus] = useState<FolderStatus>(fs.supported ? 'none' : 'unsupported')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const dir = useRef<fs.Dir | null>(null)
  const saved = useRef<fs.Dir | null>(null) // remembered folder waiting for permission
  const muted = useRef(false)
  const prev = useRef(useStore.getState().chats)
  const dirty = useRef(false) // changed since the last export/import (matters when not saving to a folder)
  const [notice, setNotice] = useState('')

  // Load chats from the folder, merge with anything in memory, and start saving.
  const activate = useCallback(async (h: fs.Dir) => {
    try {
      const disk = await fs.readChats(h)
      const legacy = readLegacy()
      muted.current = true
      useStore.getState().setChats([...disk, ...legacy])
      prev.current = useStore.getState().chats
      muted.current = false
      dir.current = h

      const onDisk = new Map(disk.map((c) => [c.id, c]))
      for (const c of useStore.getState().chats) {
        const d = onDisk.get(c.id)
        if (!d || c.updatedAt > d.updatedAt) await fs.writeChat(h, c)
      }
      if (legacy.length) localStorage.removeItem(LEGACY_KEY)
      setName(h.name)
      setStatus('ready')
      setError('')
    } catch (e) {
      muted.current = false
      setError(`Couldn't read the folder: ${(e as Error).message}`)
    }
  }, [])

  // Bring in chats from the old localStorage version (they stay there until exported or saved to a folder).
  useEffect(() => {
    const legacy = readLegacy()
    if (legacy.length) useStore.getState().setChats(legacy)
  }, [])

  // Restore the folder picked in an earlier session.
  useEffect(() => {
    if (!fs.supported) return
    fs.loadHandle()
      .then(async (h) => {
        if (!h) return
        setName(h.name)
        if ((await fs.permission(h)) === 'granted') activate(h)
        else {
          saved.current = h
          setStatus('needs-permission')
        }
      })
      .catch(() => {})
  }, [activate])

  // Auto-save: write changed chats, delete removed ones (debounced).
  useEffect(() => {
    const pend = new Map<string, Chat | null>()
    let timer = 0
    const flush = async () => {
      const h = dir.current
      if (!h) return
      const items = [...pend]
      pend.clear()
      try {
        for (const [id, c] of items) {
          if (c) await fs.writeChat(h, c)
          else await fs.removeChat(h, id)
        }
        setError('')
      } catch (e) {
        saved.current = h
        dir.current = null
        setStatus('needs-permission')
        setError(`Couldn't save: ${(e as Error).message}`)
      }
    }
    const unsub = useStore.subscribe((s) => {
      if (muted.current || s.chats === prev.current) return
      dirty.current = true
      const old = new Map(prev.current.map((c) => [c.id, c]))
      const now = new Set(s.chats.map((c) => c.id))
      for (const c of s.chats) if (old.get(c.id) !== c) pend.set(c.id, c)
      for (const id of old.keys()) if (!now.has(id)) pend.set(id, null)
      prev.current = s.chats
      clearTimeout(timer)
      timer = window.setTimeout(flush, 400)
    })
    return () => {
      unsub()
      clearTimeout(timer)
    }
  }, [])

  // Warn before closing the tab if chats exist but nothing is being saved.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (status !== 'ready' && dirty.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [status])

  const connect = useCallback(async () => {
    try {
      await activate(await fs.pickFolder())
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    }
  }, [activate])

  const reconnect = useCallback(async () => {
    const h = saved.current
    if (h && (await fs.ask(h)) === 'granted') activate(h)
  }, [activate])

  // Export / Import work in every browser, with or without a connected folder.
  const exportChats = useCallback(() => {
    const chats = useStore.getState().chats
    const data = JSON.stringify({ app: 'homebase', version: 1, chats }, null, 2)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
    a.download = `homebase-chats-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    dirty.current = false
    if (chats.length) localStorage.removeItem(LEGACY_KEY)
    setNotice(`Exported ${chats.length} chat${chats.length === 1 ? '' : 's'}`)
  }, [])

  const importChats = useCallback(async (file: File) => {
    try {
      const raw = JSON.parse(await file.text())
      const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray(raw?.chats) ? raw.chats : [raw]
      const chats = list.filter(
        (c): c is Chat => !!c && typeof (c as Chat).id === 'string' && Array.isArray((c as Chat).messages),
      )
      if (!chats.length) throw new Error('no chats found in that file')
      useStore.getState().setChats(
        chats.map((c) => ({
          ...c,
          title: c.title || 'Imported chat',
          model: c.model ?? '',
          updatedAt: c.updatedAt ?? Date.now(),
        })),
      )
      dirty.current = false
      setNotice(`Imported ${chats.length} chat${chats.length === 1 ? '' : 's'}`)
    } catch (e) {
      setNotice(`Couldn't import: ${(e as Error).message}`)
    }
  }, [])

  return { status, name, error, notice, connect, reconnect, exportChats, importChats }
}