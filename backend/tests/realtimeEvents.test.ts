import { describe, expect, it } from 'vitest';
import { createReceivedGate } from '../../frontend/src/realtimeEvents.js';

describe('browser notification deduplication', () => {
  const event = { event: 'webhook:received', endpointId: 'selected', requestId: 'one' };
  it('accepts a request once and refuses malformed or foreign events', () => {
    const accept = createReceivedGate('selected');
    expect(accept(null)).toBe(false);
    expect(accept({ ...event, endpointId: 'other' })).toBe(false);
    expect(accept({ ...event, event: 'unknown' })).toBe(false);
    expect(accept({ ...event, requestId: '' })).toBe(false);
    expect(accept(event)).toBe(true);
    expect(accept(event)).toBe(false);
  });
  it('bounds memory and resets for a new subscription', () => {
    const accept = createReceivedGate('selected', 2);
    expect(accept(event)).toBe(true);
    expect(accept({ ...event, requestId: 'two' })).toBe(true);
    expect(accept({ ...event, requestId: 'three' })).toBe(true);
    expect(accept(event)).toBe(true);
    expect(createReceivedGate('selected')(event)).toBe(true);
  });
});
