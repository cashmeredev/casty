// CDP WebSocket クライアント
// Runtime.enable を絶対に送信しない軽量 CDP クライアント

import { EventEmitter } from 'events';
import WebSocket from 'ws';

export class CDPClient extends EventEmitter {
  constructor() {
    super();
    this._ws = null;
    this._id = 0;
    this._pending = new Map();
  }

  // WebSocket 接続
  connect(wsUrl) {
    return new Promise((resolve, reject) => {
      this._ws = new WebSocket(wsUrl, { perMessageDeflate: false });
      this._ws.on('open', () => resolve());
      this._ws.on('error', reject);
      this._ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.id !== undefined) {
          // コマンド応答
          const p = this._pending.get(msg.id);
          if (p) {
            this._pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error.message));
            else p.resolve(msg.result || {});
          }
        } else if (msg.method) {
          // CDP イベント
          this.emit(msg.method, msg.params || {});
        }
      });
      this._ws.on('close', () => this.emit('close'));
    });
  }

  // CDP コマンド送信
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this._id;
      this._pending.set(id, { resolve, reject });
      this._ws.send(JSON.stringify({ id, method, params }));
    });
  }

  // 切断
  close() {
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    for (const p of this._pending.values()) {
      p.reject(new Error('Connection closed'));
    }
    this._pending.clear();
  }
}
