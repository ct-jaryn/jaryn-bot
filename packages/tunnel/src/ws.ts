import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

export interface WsConnection {
  send(data: string): void
  close(): void
  onMessage(fn: (data: string) => void): void
  onClose(fn: () => void): void
}

export function handleUpgrade(req: IncomingMessage, socket: Duplex): WsConnection {
  const key = String(req.headers['sec-websocket-key'] ?? '')
  const accept = createHash('sha1').update(key + GUID).digest('base64')
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )
  let buffer = Buffer.alloc(0)
  const listeners: ((d: string) => void)[] = []
  const closeListeners: (() => void)[] = []

  const sendFrame = (opcode: number, payload: Buffer) => {
    let header: Buffer
    if (payload.length < 126) {
      header = Buffer.from([0x80 | opcode, payload.length])
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4)
      header[0] = 0x80 | opcode
      header[1] = 126
      header.writeUInt16BE(payload.length, 2)
    } else {
      header = Buffer.alloc(10)
      header[0] = 0x80 | opcode
      header[1] = 127
      header.writeBigUInt64BE(BigInt(payload.length), 2)
    }
    socket.write(Buffer.concat([header, payload]))
  }

  const connection: WsConnection = {
    send(data) { sendFrame(1, Buffer.from(data, 'utf8')) },
    close() { try { sendFrame(8, Buffer.alloc(0)); socket.end() } catch { /* ignore */ } },
    onMessage(fn) { listeners.push(fn) },
    onClose(fn) { closeListeners.push(fn) },
  }

  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= 2) {
      const first = buffer[0]!
      const second = buffer[1]!
      const opcode = first & 0x0f
      const masked = (second & 0x80) !== 0
      let len = second & 0x7f
      let offset = 2
      if (len === 126) { if (buffer.length < 4) return; len = buffer.readUInt16BE(2); offset = 4 }
      else if (len === 127) { if (buffer.length < 10) return; len = Number(buffer.readBigUInt64BE(2)); offset = 10 }
      const maskLen = masked ? 4 : 0
      if (buffer.length < offset + maskLen + len) return
      const mask = masked ? buffer.subarray(offset, offset + 4) : undefined
      const payload = Buffer.from(buffer.subarray(offset + maskLen, offset + maskLen + len))
      if (mask) for (let i = 0; i < payload.length; i++) payload[i]! ^= mask[i % 4]!
      buffer = buffer.subarray(offset + maskLen + len)
      if (opcode === 8) { connection.close(); for (const fn of closeListeners) fn(); return }
      if (opcode === 9) { sendFrame(10, payload); continue }
      if (opcode === 1 || opcode === 2) for (const fn of listeners) fn(payload.toString('utf8'))
    }
  })
  socket.on('close', () => { for (const fn of closeListeners) fn() })
  socket.on('error', () => { for (const fn of closeListeners) fn() })
  return connection
}
