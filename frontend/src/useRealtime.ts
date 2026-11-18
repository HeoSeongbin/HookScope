import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { createReceivedGate } from './realtimeEvents';

type Status = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error';
export const connectionLabels: Record<Status, string> = {
  idle: '엔드포인트 선택 대기', connecting: '연결 중', live: '실시간 연결됨',
  reconnecting: '연결 끊김 · 재연결 중', error: '연결 오류 · 수동 갱신 가능',
};

export function useRealtime(key: string, endpointId: string, refresh: () => Promise<void>) {
  const [status, setStatus] = useState<Status>('idle');
  const latestRefresh = useRef(refresh);
  latestRefresh.current = refresh;
  useEffect(() => {
    if (!key || !endpointId) { setStatus('idle'); return; }
    setStatus('connecting');
    const socket = io({ auth: { token: key }, reconnectionDelayMax: 5000 });
    const accept = createReceivedGate(endpointId);
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => {
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (!disposed) void latestRefresh.current();
      }, 75);
    };
    const subscribe = () => {
      socket.timeout(5000).emit('endpoint:subscribe', { endpointId }, (err: Error | null, result?: {ok:boolean}) => {
        if (disposed || !socket.connected) return;
        if (err || !result?.ok) { setStatus('error'); return; }
        setStatus('live');
        // Join first, then fetch: captures received during the connection gap are recovered.
        invalidate();
      });
    };
    socket.on('connect', subscribe);
    socket.on('disconnect', () => setStatus('reconnecting'));
    socket.on('connect_error', () => setStatus('error'));
    socket.on('webhook:received', (event: unknown) => {
      if (accept(event)) invalidate();
    });
    const recover = () => {
      if (document.visibilityState === 'visible' && socket.connected) invalidate();
    };
    document.addEventListener('visibilitychange', recover);
    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener('visibilitychange', recover);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [key, endpointId]);
  return status;
}
