import type { VirtualCamera } from './virtual-camera';

// WebRTC stream of the virtual camera to the app (`?source=webrtc`), possibly on another device
// of the LAN. Signaling goes through the WebSocket relay of the app's dev server (/__signal):
// the relay assigns each client an id, adds `from` to every message and delivers it to `to`,
// or to every other client of the room when there is no `to`.
//
//   receiver -> all:    request            sender -> all:      sender-ready
//   sender -> receiver: offer              receiver -> sender: answer
//   both:               candidate          relay -> all:       join, leave

export type SignalMessage =
  | { type: 'welcome'; id: number }
  | { type: 'join'; from: number; role: string }
  | { type: 'leave'; from: number }
  | { type: 'sender-ready'; from: number }
  | { type: 'request'; from: number }
  | { type: 'offer'; from: number; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; from: number; sdp: RTCSessionDescriptionInit }
  | { type: 'candidate'; from: number; candidate: RTCIceCandidateInit };

type Outgoing =
  | { type: 'sender-ready' | 'request' }
  | { type: 'offer' | 'answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'candidate'; candidate: RTCIceCandidateInit };

// Reconnect delay doubles up to the maximum, so a missing relay does not flood the console.
const RECONNECT_MS = 2000;
const MAX_RECONNECT_MS = 30_000;
const MAX_BITRATE = 8_000_000;

/** Relay URL of the app dev server: same host, the app's port (5173 unless given). */
export function defaultSignalUrl(location: Location, appPort = 5173): string {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${location.hostname}:${appPort}/__signal`;
}

/**
 * A relay connection that reconnects when it drops. Messages are handled one at a time, in
 * order, so a candidate never overtakes the description it belongs to.
 */
class SignalChannel {
  private socket: WebSocket | null = null;
  private closed = false;
  private retryMs = RECONNECT_MS;
  private queue = Promise.resolve();

  constructor(
    private readonly url: string,
    private readonly role: 'sender' | 'receiver',
    private readonly handle: (message: SignalMessage) => Promise<void> | void,
    private readonly onConnected: (connected: boolean) => void,
  ) {
    this.connect();
  }

  send(message: Outgoing, to?: number): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(to === undefined ? message : { ...message, to }));
    }
  }

  close(): void {
    this.closed = true;
    this.socket?.close();
  }

  private connect(): void {
    const url = new URL(this.url);
    url.searchParams.set('role', this.role);
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.retryMs = RECONNECT_MS;
      this.onConnected(true);
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as SignalMessage;
      this.queue = this.queue
        .then(() => this.handle(message))
        .catch((error: unknown) => console.warn('WebRTC signaling:', error));
    });
    socket.addEventListener('close', () => {
      this.onConnected(false);
      if (this.closed) return;
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, MAX_RECONNECT_MS);
    });
  }
}

export interface SenderStatus {
  /** Connected to the relay. */
  connected: boolean;
  /** Receivers with an established connection. */
  receivers: number;
}

/** Streams the virtual camera frames to every receiver that asks for them. */
export class WebRtcSender {
  private readonly stream: MediaStream;
  private readonly peers = new Map<number, RTCPeerConnection>();
  private readonly listeners = new Set<(status: SenderStatus) => void>();
  private channel: SignalChannel | null = null;
  private connected = false;

  constructor(
    vcam: VirtualCamera,
    private readonly url: string,
  ) {
    this.stream = vcam.captureStream();
    // Favour sharpness over motion smoothness: the tracker needs the details.
    for (const track of this.stream.getVideoTracks()) track.contentHint = 'detail';
  }

  start(): void {
    this.channel ??= new SignalChannel(
      this.url,
      'sender',
      (message) => this.handle(message),
      (connected) => {
        this.connected = connected;
        this.notify();
      },
    );
  }

  stop(): void {
    this.channel?.close();
    this.channel = null;
    for (const peer of this.peers.values()) peer.close();
    this.peers.clear();
    this.connected = false;
    this.notify();
  }

  get status(): SenderStatus {
    const receivers = [...this.peers.values()].filter((p) => p.connectionState === 'connected');
    return { connected: this.connected, receivers: receivers.length };
  }

  onStatus(listener: (status: SenderStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.status);
  }

  private async handle(message: SignalMessage): Promise<void> {
    switch (message.type) {
      case 'welcome':
        this.channel?.send({ type: 'sender-ready' });
        break;
      case 'request':
        await this.offer(message.from);
        break;
      case 'answer':
        await this.peers.get(message.from)?.setRemoteDescription(message.sdp);
        break;
      case 'candidate':
        await this.peers.get(message.from)?.addIceCandidate(message.candidate);
        break;
      case 'leave':
        this.peers.get(message.from)?.close();
        this.peers.delete(message.from);
        this.notify();
        break;
      default:
        break;
    }
  }

  private async offer(receiver: number): Promise<void> {
    this.peers.get(receiver)?.close();
    const peer = new RTCPeerConnection();
    this.peers.set(receiver, peer);
    const senders = this.stream.getTracks().map((track) => peer.addTrack(track, this.stream));
    peer.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        this.channel?.send({ type: 'candidate', candidate: event.candidate.toJSON() }, receiver);
      }
    });
    peer.addEventListener('connectionstatechange', () => this.notify());
    await peer.setLocalDescription(await peer.createOffer());
    for (const sender of senders) {
      const parameters = sender.getParameters() as RTCRtpSendParameters & {
        degradationPreference?: string;
      };
      for (const encoding of parameters.encodings) encoding.maxBitrate = MAX_BITRATE;
      parameters.degradationPreference = 'maintain-resolution';
      await sender.setParameters(parameters).catch(() => undefined);
    }
    this.channel?.send({ type: 'offer', sdp: peer.localDescription!.toJSON() }, receiver);
  }
}

/** Receives the virtual camera stream; calls `onStream` for every (re)established stream. */
export class WebRtcReceiver {
  private channel: SignalChannel | null = null;
  private peer: RTCPeerConnection | null = null;
  private sender: number | null = null;

  constructor(
    private readonly url: string,
    private readonly onStream: (stream: MediaStream) => void,
  ) {}

  start(): void {
    this.channel ??= new SignalChannel(
      this.url,
      'receiver',
      (message) => this.handle(message),
      () => undefined,
    );
  }

  stop(): void {
    this.channel?.close();
    this.channel = null;
    this.peer?.close();
    this.peer = null;
  }

  private async handle(message: SignalMessage): Promise<void> {
    switch (message.type) {
      case 'welcome':
        this.channel?.send({ type: 'request' });
        break;
      case 'sender-ready':
        if (this.peer?.connectionState !== 'connected') this.channel?.send({ type: 'request' });
        break;
      case 'offer':
        await this.answer(message.from, message.sdp);
        break;
      case 'candidate':
        if (message.from === this.sender) await this.peer?.addIceCandidate(message.candidate);
        break;
      case 'leave':
        if (message.from === this.sender) {
          this.peer?.close();
          this.peer = null;
          this.sender = null;
        }
        break;
      default:
        break;
    }
  }

  private async answer(sender: number, offer: RTCSessionDescriptionInit): Promise<void> {
    this.peer?.close();
    const peer = new RTCPeerConnection();
    this.peer = peer;
    this.sender = sender;
    peer.addEventListener('track', (event) => {
      this.onStream(event.streams[0] ?? new MediaStream([event.track]));
    });
    peer.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        this.channel?.send({ type: 'candidate', candidate: event.candidate.toJSON() }, sender);
      }
    });
    await peer.setRemoteDescription(offer);
    await peer.setLocalDescription(await peer.createAnswer());
    this.channel?.send({ type: 'answer', sdp: peer.localDescription!.toJSON() }, sender);
  }
}
