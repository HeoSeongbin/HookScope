import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { z } from 'zod';
import { validAdminKey } from './auth.js';
import type { Repository } from './repository.js';
import type {SecurityService} from './securityService.js';
import {bootstrapPrincipal} from './securityPolicy.js';

export interface ReceivedEvent {
  event: 'webhook:received';
  endpointId: string;
  requestId: string;
  method: string;
  receivedAt: string;
}
export type PublishReceived = (event: ReceivedEvent) => void | Promise<void>;
type SubscriptionResult = { ok: boolean; code?: string };
const room = (id: string) => `endpoint:${id}`;

export function attachRealtime(server: HttpServer, repo: Repository, key: string, origin: string,security?:SecurityService) {
  const handshakes=new Map<string,{started:number;count:number}>();let pruned=0;
  const allowHandshake=(address:string)=>{const now=Date.now();if(now-pruned>60000){for(const [ip,value] of handshakes)if(now-value.started>=60000)handshakes.delete(ip);pruned=now;}const value=handshakes.get(address);if(value&&now-value.started<60000)return ++value.count<=120;if(handshakes.size>=10000&&!value)return false;handshakes.set(address,{started:now,count:1});return true;};
  const io = new Server(server, {
    cors: { origin },
    maxHttpBufferSize: 16 * 1024,
    // WebSocket handshakes need an origin check as well as polling CORS.
    allowRequest: (req, callback) => callback(null, (!req.headers.origin || req.headers.origin === origin)&&allowHandshake(req.socket.remoteAddress??'unknown')),
  });
  io.use((socket, next) => {
    void (async()=>{const principal=security?await security.authenticate(socket.handshake.auth?.token):validAdminKey(socket.handshake.auth?.token,key)?bootstrapPrincipal:undefined;if(!principal)return next(new Error('UNAUTHORIZED'));socket.data.principal=principal;next();})().catch(()=>next(new Error('UNAUTHORIZED')));
  });
  io.on('connection', socket => {
    let currentRoom: string | undefined;
    let joining = false;
    void socket.join('user:'+socket.data.principal.id);
    const recheck=security?setInterval(()=>{void security.authenticate(socket.handshake.auth?.token).then(value=>{if(!value)socket.disconnect(true);}).catch(()=>socket.disconnect(true));},10000):undefined;
    recheck?.unref();socket.on('disconnect',()=>{if(recheck)clearInterval(recheck);});
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
        const principal=security?await security.authenticate(socket.handshake.auth?.token):bootstrapPrincipal;
        if(!principal){socket.disconnect(true);return;}
        const endpoint = await (security?security.scope(repo,principal):repo).endpoint(parsed.data.endpointId);
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
    publish: ((event) => {
      if(!security){io.to(room(event.endpointId)).emit('webhook:received',event);return;}
      return (async()=>{for(const id of io.sockets.adapter.rooms.get(room(event.endpointId))??[]){const socket=io.sockets.sockets.get(id);if(!socket)continue;try{const principal=await security.authenticate(socket.handshake.auth?.token);if(!principal){socket.disconnect(true);continue;}if(await security.scope(repo,principal).endpoint(event.endpointId))socket.emit('webhook:received',event);}catch{socket.disconnect(true);}}})();
    }) satisfies PublishReceived,
  };
}
