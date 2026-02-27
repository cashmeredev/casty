// CDP WebSocket client
// Lightweight CDP client that never sends Runtime.enable

import { EventEmitter, once } from 'node:events';
import WebSocket from 'ws';

const CDP_TIMEOUT = 10000; // ms — reject pending commands after this

export class CDPClient extends EventEmitter {
  constructor() {
    super();
    this._ws = null;
    this._id = 0;
    this._pending = new Map();
  }

  // Connect via WebSocket
  async connect(wsUrl) {
    this._ws = new WebSocket(wsUrl, { perMessageDeflate: false });
    this._ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); }
      catch { return; } // Ignore non-JSON frames
      if (msg.id !== undefined) {
        // Command response
        const p = this._pending.get(msg.id);
        if (p) {
          clearTimeout(p.timer);
          this._pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result || {});
        }
      } else if (msg.method) {
        // CDP event
        this.emit(msg.method, msg.params || {});
      }
    });
    this._ws.on('close', () => this.emit('close'));
    this._ws.on('error', (err) => this.emit('error', err));
    // once() rejects on 'error' if it fires before 'open'
    await once(this._ws, 'open');
  }

  // Send CDP command (with timeout to prevent forever-pending)
  send(method, params = {}) {
    const id = ++this._id;
    const { promise, resolve, reject } = Promise.withResolvers();
    const timer = setTimeout(() => {
      this._pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, CDP_TIMEOUT);
    this._pending.set(id, { resolve, reject, timer });
    try {
      this._ws.send(JSON.stringify({ id, method, params }));
    } catch (err) {
      // ws.send() can throw synchronously if socket is closed
      clearTimeout(timer);
      this._pending.delete(id);
      reject(err);
    }
    return promise;
  }

  // Disconnect
  close() {
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    for (const p of this._pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Connection closed'));
    }
    this._pending.clear();
  }
}
