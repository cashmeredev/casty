// Unix-domain socket command server for embed mode.
//
// A host process (e.g. kitty-graphics.el) connects to the socket and sends
// newline-delimited JSON commands: {"cmd":"scroll","dy":300}\n
//
// This mirrors mpv's --input-ipc-server: one command per line, dispatched to a
// handler.  A handler may reply by calling the provided replyFn(obj), which
// writes JSON+newline back on the same connection (used by e.g. "get-url").
//
// Only the command transport lives here; the command vocabulary and its
// mapping onto CDP actions is wired up by the caller (bin/casty.js).

import net from 'node:net';
import { unlinkSync } from 'node:fs';

// Start the IPC server.
//   socketPath : filesystem path for the AF_UNIX socket
//   handlers   : { [cmd]: async (msg, replyFn) => {} }
// Returns the net.Server so the caller can close() it on shutdown.
export function startIpcServer(socketPath, handlers) {
  // Remove a stale socket from a previous run; ignore if absent.
  try { unlinkSync(socketPath); } catch {}

  const server = net.createServer((conn) => {
    conn.setEncoding('utf8');
    let buf = '';

    const reply = (obj) => {
      try { conn.write(JSON.stringify(obj) + '\n'); } catch {}
    };

    conn.on('data', (data) => {
      buf += data;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;

        let msg;
        try {
          msg = JSON.parse(line);
        } catch (e) {
          console.error(`casty: ipc: bad JSON: ${e.message}`);
          continue;
        }

        const handler = msg && handlers[msg.cmd];
        if (!handler) {
          console.error(`casty: ipc: unknown command: ${msg && msg.cmd}`);
          continue;
        }
        // Handlers are async; surface errors to stderr but keep the
        // connection alive so one bad command does not kill the channel.
        Promise.resolve()
          .then(() => handler(msg, reply))
          .catch((err) => console.error(`casty: ipc: ${msg.cmd} error: ${err.message}`));
      }
    });

    conn.on('error', (err) => console.error(`casty: ipc conn error: ${err.message}`));
  });

  server.on('error', (err) => console.error(`casty: ipc server error: ${err.message}`));
  server.listen(socketPath, () => console.error(`casty: ipc listening on ${socketPath}`));

  return server;
}

// Remove the socket file (call on shutdown).
export function cleanupIpc(socketPath) {
  try { unlinkSync(socketPath); } catch {}
}
