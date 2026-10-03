import { defineConfig, type Plugin, type ViteDevServer, type PreviewServer } from 'vite'
import react from '@vitejs/plugin-react'
import os from 'node:os'

// Browsers can't read system CPU/RAM, so the dev server answers /api/stats using Node's `os` module.
const sample = () =>
  os.cpus().reduce(
    (a, c) => {
      const t = c.times
      a.idle += t.idle
      a.total += t.user + t.nice + t.sys + t.idle + t.irq
      return a
    },
    { idle: 0, total: 0 },
  )

function systemStats(): Plugin {
  let prev = sample()
  const mount = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use('/api/stats', (_req, res) => {
      const cur = sample()
      const total = cur.total - prev.total
      const idle = cur.idle - prev.idle
      prev = cur
      const cpu = total > 0 ? Math.round((1 - idle / total) * 100) : 0
      const memTotal = os.totalmem()
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ cpu, memUsed: memTotal - os.freemem(), memTotal }))
    })
  }
  return { name: 'system-stats', configureServer: mount, configurePreviewServer: mount }
}

export default defineConfig({
  plugins: [react(), systemStats()],
})