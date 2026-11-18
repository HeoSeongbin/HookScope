import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { z } from 'zod';
import { validAdminKey } from './auth.js';
import type { Repository } from './repository.js';

export interface ReceivedEvent {
  event: 'webhook:received';
  endpointId: string;
  requestId: string;
  method: string;
  receivedAt: string;
}
export type PublishReceived = (event: ReceivedEvent) => void;
type SubscriptionResult = { ok: boolean; code?: string };
const room = (id: string) => `endpoint:${id}`;

export function attachRealtime(server: HttpServer, repo: Repository, key: string, origin: string) {
  const io = new Server(server, {
    cors: { origin },
    maxHttpBufferSize: 16 * 1024,
    // WebSocket handshakes need an origin check as well as polling CORS.
    allowRequest: (req, callback) => callback(null, !req.headers.origin || req.headers.origin === origin),
  });
  io.use((socket, next) => {
    if (!validAdminKey(socket.handshake.auth?.token, key)) return next(new Error('UNAUTHORIZED'));
    next();
  });
  io.on('connection', socket => {
    let currentRoom: string | undefined;
    let joining = false;
    socket.emit('connection:status', { status: 'connected' });
    socket.on('endpoint:subscribe', async (input: unknown, ack?: (result: SubscriptionResult) => void) => {
      if (typeof ack !== 'function') return;
      const parsed = z.object({ endpointId: z.uuid() }).strict().safeParse(input);
      if (!parsed.success) return ack({ ok: false, code: 'INVALID_INPUT' });
      if (joining) return ack({ ok: false, code: 'SUBSCRIPTION_BUSY' });
      joining = true;
      try {
        // The authenticated local administrator may manage every existing endpoint.
        // Public receive tokens never grant this capability.
        const endpoint = await repo.endpoint(parsed.data.endpointId);
        if (!endpoint) return ack({ ok: false, code: 'NOT_FOUND' });
        if (!socket.connected) return;
        if (currentRoom) await socket.leave(currentRoom);
        currentRoom = room(endpoint.id);
        await socket.join(currentRoom);
        ack({ ok: true });
      } catch {
        ack({ ok: false, code: 'SUBSCRIPTION_UNAVAILABLE' });
      } finally {
        joining = false;
      }
    });
  });
  return {
    io,
    publish: ((event) => { io.to(room(event.endpointId)).emit('webhook:received', event); }) satisfies PublishReceived,
  };
}
