/* eslint-env node */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

const server = createServer(async (req, res) => {
  try {
    let filePath = join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url)
    
    // Also resolve dist files for @cherito/checkout-widget if requested
    if (req.url.startsWith('/vendor/checkout-widget/')) {
      const rel = req.url.replace('/vendor/checkout-widget/', '')
      filePath = join(__dirname, '../../packages/cherito-checkout-widget/dist', rel)
    }

    const ext = extname(filePath)
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'

    const data = await readFile(filePath)
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(data)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('404 Not Found')
  }
})

server.listen(PORT, () => {
  console.log(`\n⚡ Cherito Bitcoin Payments — Demo Store running at http://localhost:${PORT}`)
})
