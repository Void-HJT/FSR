import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Server } from 'node:http'
import { createApp } from './app.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

export function startServer(options: { port?: number; serveWeb?: boolean } = {}): Promise<Server> {
  const port = options.port ?? Number(process.env.PORT || 8787)
  const webDist = options.serveWeb === false ? undefined : path.resolve(currentDirectory, '..', 'dist')
  const app = createApp({ webDist })
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => {
      console.log(`File Sequence Renamer is running at http://127.0.0.1:${port}`)
      resolve(server)
    })
    server.on('error', reject)
  })
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === entryUrl) {
  startServer().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
