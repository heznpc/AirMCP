/**
 * Simple counting semaphore for limiting concurrent subprocess calls.
 * Used by JXA, Swift bridge, and GWS CLI runners.
 */
export class Semaphore {
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  release(): void {
    if (this.running <= 0) {
      console.error("[AirMCP] Semaphore double-release detected");
      return;
    }
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }
}
