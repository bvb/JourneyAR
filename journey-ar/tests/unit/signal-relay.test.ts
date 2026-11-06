import { describe, expect, it } from 'vitest';
import { SignalRelay } from '../../dev/signal-relay';

function client() {
  const received: Record<string, unknown>[] = [];
  return { received, send: (data: string) => received.push(JSON.parse(data)) };
}

describe('SignalRelay', () => {
  it('welcomes clients and announces joins and leaves to the room', () => {
    const relay = new SignalRelay();
    const a = client();
    const b = client();
    const other = client();
    const ma = relay.join(a, 'vcam', 'sender');
    const mb = relay.join(b, 'vcam', 'receiver');
    relay.join(other, 'elsewhere', 'receiver');
    mb.leave();
    expect(a.received).toEqual([
      { type: 'welcome', id: ma.id },
      { type: 'join', role: 'receiver', from: mb.id },
      { type: 'leave', from: mb.id },
    ]);
    expect(b.received).toEqual([{ type: 'welcome', id: mb.id }]);
    expect(other.received).toHaveLength(1);
  });

  it('broadcasts without `to` and delivers with `to`, stamping `from`', () => {
    const relay = new SignalRelay();
    const sender = client();
    const r1 = client();
    const r2 = client();
    const ms = relay.join(sender, 'vcam', 'sender');
    const m1 = relay.join(r1, 'vcam', 'receiver');
    relay.join(r2, 'vcam', 'receiver');
    m1.message(JSON.stringify({ type: 'request' }));
    ms.message(JSON.stringify({ type: 'offer', to: m1.id, sdp: { type: 'offer', sdp: 'x' } }));
    expect(sender.received.at(-1)).toEqual({ type: 'request', from: m1.id });
    expect(r1.received.at(-1)).toEqual({
      type: 'offer',
      sdp: { type: 'offer', sdp: 'x' },
      from: ms.id,
    });
    expect(r2.received.map((m) => m['type'])).toEqual(['welcome', 'request']);
  });

  it('ignores malformed messages and other rooms', () => {
    const relay = new SignalRelay();
    const a = client();
    const b = client();
    const ma = relay.join(a, 'one', 'sender');
    const mb = relay.join(b, 'two', 'receiver');
    ma.message('not json');
    ma.message(JSON.stringify({ no: 'type' }));
    ma.message(JSON.stringify({ type: 'offer', to: mb.id }));
    expect(b.received).toEqual([{ type: 'welcome', id: mb.id }]);
  });
});
