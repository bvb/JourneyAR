/**
 * Progress of the downloads after Start, by bytes: each task (a scene model, a soundtrack, the
 * NFT markers) is expected with its size from scenes.json and reports what it has received, so
 * the overall fraction only grows. A task that fails counts as done: the progress does not stall.
 */
export class LoadProgress {
  private readonly tasks = new Map<string, { total: number; loaded: number }>();
  private readonly listeners = new Set<() => void>();

  /** Expects a task of `total` bytes (once; a known task keeps its progress). */
  expect(id: string, total: number): void {
    if (!this.tasks.has(id)) this.tasks.set(id, { total: Math.max(total, 0), loaded: 0 });
    this.notify();
  }

  /** `loaded` bytes of the task received so far. */
  update(id: string, loaded: number): void {
    const task = this.tasks.get(id);
    if (!task || !Number.isFinite(loaded)) return;
    const value = Math.min(Math.max(loaded, task.loaded), task.total);
    if (value === task.loaded) return;
    task.loaded = value;
    this.notify();
  }

  /** The task is finished (or failed). */
  done(id: string): void {
    const task = this.tasks.get(id);
    if (!task || task.loaded === task.total) return;
    task.loaded = task.total;
    this.notify();
  }

  /** Received / expected bytes, 0..1; 1 when nothing is expected. */
  get fraction(): number {
    let total = 0;
    let loaded = 0;
    for (const task of this.tasks.values()) {
      total += task.total;
      loaded += task.loaded;
    }
    return total > 0 ? loaded / total : 1;
  }

  get complete(): boolean {
    return [...this.tasks.values()].every((task) => task.loaded >= task.total);
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
