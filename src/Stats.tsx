import { useEffect, useState } from 'react'
import { BASE } from './Ollama'

interface Sys { cpu: number; memUsed: number; memTotal: number }

const gb = (b: number) => (b / 1024 ** 3).toFixed(1)

function Meter({ label, value, text }: { label: string; value: number; text: string }) {
  return (
    <span className="stat" title={`${label} ${text}`}>
      <span className="lab">{label}</span>
      <span className="bar"><i className={value > 85 ? 'hot' : ''} style={{ width: `${value}%` }} /></span>
      <b>{text}</b>
    </span>
  )
}

export default function Stats() {
  const [sys, setSys] = useState<Sys | null>(null)
  const [loaded, setLoaded] = useState(0)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      if (document.hidden) return
      try {
        const r = await fetch('/api/stats') // served by the Vite plugin (dev/preview only)
        if (r.ok && alive) setSys(await r.json())
      } catch { /* stats endpoint unavailable */ }
      try {
        const r = await fetch(`${BASE}/api/ps`) // models currently loaded by Ollama
        const d = await r.json()
        if (alive) setLoaded((d.models ?? []).reduce((n: number, m: { size: number }) => n + m.size, 0))
      } catch { /* ollama unreachable */ }
    }
    tick()
    const id = setInterval(tick, 2000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  return (
    <div className="stats" aria-label="System usage">
      {sys && (
        <>
          <Meter label="CPU" value={sys.cpu} text={`${sys.cpu}%`} />
          <Meter
            label="RAM"
            value={Math.round((sys.memUsed / sys.memTotal) * 100)}
            text={`${gb(sys.memUsed)} / ${gb(sys.memTotal)} GB`}
          />
        </>
      )}
      {loaded > 0 ? (
        <span className="stat" title="Memory used by the loaded model">
          <span className="lab">Model</span><b>{gb(loaded)} GB</b>
        </span>
      ) : null}
    </div>
  )
}