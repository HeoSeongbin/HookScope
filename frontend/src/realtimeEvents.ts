// Keep notification deduplication bounded; PostgreSQL REST results remain authoritative.
export function createReceivedGate(endpointId: string, capacity = 512) {
  const seen = new Set<string>();
  return (event: unknown): boolean => {
    if (!event || typeof event !== 'object') return false;
    const data = event as {event?:unknown; endpointId?:unknown; requestId?:unknown};
    if (data.event !== 'webhook:received' || data.endpointId !== endpointId ||
        typeof data.requestId !== 'string' || !data.requestId || seen.has(data.requestId)) return false;
    seen.add(data.requestId);
    if (seen.size > capacity) seen.delete(seen.values().next().value!);
    return true;
  };
}
