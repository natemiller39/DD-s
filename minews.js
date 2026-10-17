// Tiny dependency-free WebSocket server (RFC 6455): text frames, ping/pong, close.
// Enough for small JSON game messages; fragmented frames are not supported.
const crypto = require('crypto');
const { EventEmitter } = require('events');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class Socket extends EventEmitter {
  constructor(sock, maxPayload) {
    super();
    this.sock = sock; this.max = maxPayload; this.buf = Buffer.alloc(0); this.readyState = 1;
    sock.setNoDelay(true);
    sock.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this._parse(); });
    sock.on('close', () => this._closed());
    sock.on('error', () => this._closed());
  }
  _closed() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
  _parse() {
    for (;;) {
      const b = this.buf; if (b.length < 2) return;
      const op = b[0] & 0x0f, masked = b[1] & 0x80; let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > this.max || !masked) { this.terminate(); return; }
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4), data = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      if (op === 1) this.emit('message', data.toString('utf8'));
      else if (op === 8) { this._frame(8, Buffer.alloc(0)); this.terminate(); return; }
      else if (op === 9) this._frame(10, data);
      else if (op === 10) this.emit('pong');
    }
  }
  _frame(op, payload) {
    if (this.readyState !== 1) return;
    const n = payload.length; let head;
    if (n < 126) { head = Buffer.from([0x80 | op, n]); }
    else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(n, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
    this.sock.write(Buffer.concat([head, payload]));
  }
  send(str) { this._frame(1, Buffer.from(str, 'utf8')); }
  ping() { this._frame(9, Buffer.alloc(0)); }
  close() { this._frame(8, Buffer.alloc(0)); this.sock.end(); }
  terminate() { this.sock.destroy(); this._closed(); }
}

class WebSocketServer extends EventEmitter {
  constructor({ server, path = '/ws', maxPayload = 4096 }) {
    super();
    this.clients = new Set();
    server.on('upgrade', (req, sock) => {
      const url = new URL(req.url, 'http://local'), key = req.headers['sec-websocket-key'];
      if (url.pathname !== path || !key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { sock.destroy(); return; }
      const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
      sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
      const ws = new Socket(sock, maxPayload);
      this.clients.add(ws);
      ws.on('close', () => this.clients.delete(ws));
      this.emit('connection', ws, req);
    });
  }
}
module.exports = { WebSocketServer };
