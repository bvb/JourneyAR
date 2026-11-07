/**
 * What is still loading after Start (the NFT markers, the scene models, the soundtracks), for
 * the light running round the Start button. A load that fails counts as finished: the failure
 * is shown as an error instead.
 */
export class PendingLoads {
  private readonly pending = new Set<string>();
  private readonly finished = new Set<string>();
  private readonly listeners = new Set<() => void>();

  /** Expects the load `id` (once: a finished load is not expected again). */
  add(id: string): void {
    if (this.finished.has(id) || this.pending.has(id)) return;
    this.pending.add(id);
    this.notify();
  }

  /** The load `id` finished (or failed). */
  done(id: string): void {
    if (this.finished.has(id)) return;
    this.finished.add(id);
    if (this.pending.delete(id)) this.notify();
  }

  get complete(): boolean {
    return this.pending.size === 0;
  }

  /** Loads still pending. */
  get count(): number {
    return this.pending.size;
  }

  /** Calls `listener` on every change; returns a function that removes it. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
