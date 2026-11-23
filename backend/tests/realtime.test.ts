import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import { attachRealtime, type ReceivedEvent, type PublishReceived } from '../src/realtime.js';
import { createApp } from '../src/app.js';
import type { Repository } from '../src/repository.js';
import {defaultResponseConfig} from '../src/responsePolicy.js';

const endpointA = '9aa82a1c-4dd8-4568-8021-cd71f55080bb';
const endpointB = '9aa82a1c-4dd8-4568-8021-cd71f55080bc';
const key = 'a'.repeat(40);
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function fixture() {
  const repo = {
    response:vi.fn(async()=>defaultResponseConfig),
    endpoint: vi.fn(async (id: string) => [endpointA, endpointB].includes(id) ? { id } : undefined),
    resolve: vi.fn(async () => ({ id: endpointA })),
    save: vi.fn(async (data: object) => ({ ...data, id: endpointB, method: 'POST', receivedAt: new Date() })),
  } as unknown as Repository;
  const publish = vi.fn<PublishReceived>();
  const server = createServer(createApp(repo, key, 'http://localhost:8088', event => publish(event)));
  const realtime = attachRealtime(server, repo, key, 'http://localhost:8088');
  publish.mockImplementation(realtime.publish);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  const url = `http://127.0.0.1:${address.port}`;
  const clients: Socket[] = [];
  cleanups.push(async () => {
    clients.forEach(client => client.disconnect());
    await new Promise<void>(resolve => realtime.io.close(() => resolve()));
  });
  function client(token = key, origin = 'http://localhost:8088') {
    const socket = connect(url, { autoConnect: false, auth: { token }, transports: ['websocket'], reconnection: false, extraHeaders: { Origin: origin } });
    clients.push(socket); return socket;
  }
  async function joined(id: string) {
    const socket = client(); const ready = once(socket, 'connect'); socket.connect(); await ready;
    expect(await socket.timeout(1000).emitWithAck('endpoint:subscribe', { endpointId: id })).toEqual({ ok: true });
    return socket;
  }
  return { repo, server, realtime, publish, client, joined };
}

describe('Socket.IO authentication, rooms and persistence boundary', () => {
  it('rejects missing, incorrect and public receive tokens', async () => {
    const f = await fixture();
    for (const key of ['', 'wrong', 'public-receive-token']) {
      const socket = f.client(key); const denied = once(socket, 'connect_error'); socket.connect();
      expect((await denied)[0].message).toBe('UNAUTHORIZED');
      expect(socket.connected).toBe(false);
    }
  });
  it('rejects a WebSocket origin outside the configured origin', async () => {
    const f = await fixture(); const socket = f.client(key, 'https://untrusted.example');
    const denied = once(socket, 'connect_error'); socket.connect(); await denied;
    expect(socket.connected).toBe(false);
  });
  it('validates endpoint IDs and refuses nonexistent rooms', async () => {
    const f = await fixture(); const socket = await f.joined(endpointA);
    expect(await socket.timeout(1000).emitWithAck('endpoint:subscribe', { endpointId: 'endpoint:any' })).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(await socket.timeout(1000).emitWithAck('endpoint:subscribe', { endpointId: '9aa82a1c-4dd8-4568-8021-cd71f55080bd' })).toEqual({ ok: false, code: 'NOT_FOUND' });
    vi.mocked(f.repo.endpoint).mockRejectedValueOnce(new Error('private storage detail'));
    expect(await socket.timeout(1000).emitWithAck('endpoint:subscribe', { endpointId: endpointB })).toEqual({ ok: false, code: 'SUBSCRIPTION_UNAVAILABLE' });
  });
  it('delivers committed metadata to two tabs while isolating another endpoint', async () => {
    const f = await fixture();
    const tab1 = await f.joined(endpointA); const tab2 = await f.joined(endpointA); const other = await f.joined(endpointB);
    const otherEvents: unknown[] = []; other.on('webhook:received', data => otherEvents.push(data));
    const first = once(tab1, 'webhook:received'); const second = once(tab2, 'webhook:received');
    const response = await request(f.server).post('/h/public').send('payload');
    expect(response.status).toBe(200);
    const [event] = await first; expect((await second)[0]).toEqual(event);
    expect(event).toEqual({ event: 'webhook:received', endpointId: endpointA, requestId: endpointB, method: 'POST', receivedAt: expect.any(String) });
    await other.timeout(1000).emitWithAck('endpoint:subscribe', { endpointId: endpointB });
    expect(otherEvents).toEqual([]);
    expect(f.publish.mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(f.repo.save).mock.invocationCallOrder[0]);
  });
  it('publishes only after the persistence promise resolves and never on storage failure', async () => {
    const f = await fixture();
    let release!: (value: Awaited<ReturnType<Repository['save']>>) => void;
    vi.mocked(f.repo.save).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = request(f.server).post('/h/public').send('body').then(response => response);
    await vi.waitFor(() => expect(f.repo.save).toHaveBeenCalled());
    expect(f.publish).not.toHaveBeenCalled();
    release({ id: endpointB, method: 'POST', receivedAt: new Date() } as Awaited<ReturnType<Repository['save']>>);
    expect((await pending).status).toBe(200); expect(f.publish).toHaveBeenCalledOnce();
    f.publish.mockClear(); vi.mocked(f.repo.save).mockRejectedValueOnce(new Error('DB unavailable'));
    expect((await request(f.server).post('/h/public').send('body')).status).toBe(503);
    expect(f.publish).not.toHaveBeenCalled();
  });
  it('preserves successful persistence if notification publication fails', async () => {
    const f = await fixture(); f.publish.mockImplementationOnce(() => { throw new Error('event unavailable'); });
    expect((await request(f.server).post('/h/public').send('body')).status).toBe(200);
    expect(f.repo.save).toHaveBeenCalledOnce();
  });
  it('leaves the previous room on selection change and cleans up on disconnect', async () => {
    const f = await fixture(); const socket = await f.joined(endpointA);
    const events: ReceivedEvent[] = []; socket.on('webhook:received', event => events.push(event));
    await socket.timeout(1000).emitWithAck('endpoint:subscribe', { endpointId: endpointB });
    const event = { event: 'webhook:received' as const, endpointId: endpointA, requestId: endpointB, method: 'POST', receivedAt: new Date().toISOString() };
    f.realtime.publish(event); const received = once(socket, 'webhook:received');
    f.realtime.publish({ ...event, endpointId: endpointB }); await received;
    expect(events).toHaveLength(1); expect(events[0].endpointId).toBe(endpointB);
    const serverSocket = f.realtime.io.sockets.sockets.get(socket.id!)!;
    const disconnected = once(serverSocket, 'disconnect'); socket.disconnect(); await disconnected;
    expect(f.realtime.io.sockets.adapter.rooms.has(`endpoint:${endpointB}`)).toBe(false);
  });
});
