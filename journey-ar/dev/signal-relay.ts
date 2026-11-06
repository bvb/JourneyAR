import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Plugin } from 'vite';
import { WebSocketServer } from 'ws';

// WebRTC signaling relay of the dev server (`/__signal`), used by the virtual camera to stream
// its frames into the app (`?source=webrtc`), also on a phone in the LAN. It knows nothing about
// WebRTC: it gives each client an id, stamps `from` on every message and delivers it to `to`,
// or to every other client of the same room. See journey-virtual-book-camera/src/core/webrtc.ts.

export interface RelayClient {
  send(data: string): void;
}

interface Member {
  id: number;
  room: string;
  client: RelayClient;
}

export class SignalRelay {
  private nextId = 1;
  private readonly members = new Map<number, Member>();

  /** Registers a client; returns the handlers for its messages and for its disconnection. */
  join(client: RelayClient, room: string, role: string) {
    const member: Member = { id: this.nextId++, room, client };
    this.members.set(member.id, member);
    client.send(JSON.stringify({ type: 'welcome', id: member.id }));
    this.broadcast(member, { type: 'join', role });
    return {
      id: member.id,
      message: (data: string) => this.route(member, data),
      leave: () => {
        this.members.delete(member.id);
        this.broadcast(member, { type: 'leave' });
      },
    };
  }

  private route(from: Member, data: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null || typeof message['type'] !== 'string') {
      return;
    }
    const { to, ...rest } = message;
    if (typeof to === 'number') {
      const target = this.members.get(to);
      if (target && target.room === from.room) {
        target.client.send(JSON.stringify({ ...rest, from: from.id }));
      }
    } else {
      this.broadcast(from, rest);
    }
  }

  private broadcast(from: Member, message: Record<string, unknown>): void {
    const data = JSON.stringify({ ...message, from: from.id });
    for (const member of this.members.values()) {
      if (member.id !== from.id && member.room === from.room) member.client.send(data);
    }
  }
}

/** Vite dev server plugin: the relay on wss://<host>:<port>/__signal?room=<room>&role=<role>. */
export function signalRelay(): Plugin {
  return {
    name: 'journey-signal-relay',
    apply: 'serve',
    configureServer(server) {
      const relay = new SignalRelay();
      const sockets = new WebSocketServer({ noServer: true });
      server.httpServer?.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        const url = new URL(request.url ?? '/', 'https://localhost');
        if (url.pathname !== '/__signal') return; // leave other upgrades (HMR) to Vite
        sockets.handleUpgrade(request, socket, head, (ws) => {
          const member = relay.join(
            { send: (data) => ws.send(data) },
            url.searchParams.get('room') ?? 'vcam',
            url.searchParams.get('role') ?? 'unknown',
          );
          ws.on('message', (data) => member.message(String(data)));
          ws.on('close', () => member.leave());
        });
      });
    },
  };
}
