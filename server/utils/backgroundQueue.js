const DEFAULT_CONCURRENCY = Number(process.env.BACKGROUND_QUEUE_CONCURRENCY || 1);

class BackgroundQueue {
  constructor({ concurrency = DEFAULT_CONCURRENCY } = {}) {
    this.concurrency = Math.max(1, Number(concurrency) || 1);
    this.pending = [];
    this.running = 0;
    this.completed = 0;
    this.failed = 0;
    this.lastError = '';
  }

  enqueue(name, task) {
    this.pending.push({ name, task, queuedAt: new Date().toISOString() });
    this.drain();
  }

  stats() {
    return {
      concurrency: this.concurrency,
      pending: this.pending.length,
      running: this.running,
      completed: this.completed,
      failed: this.failed,
      lastError: this.lastError,
    };
  }

  drain() {
    while (this.running < this.concurrency && this.pending.length) {
      const item = this.pending.shift();
      this.running += 1;
      Promise.resolve()
        .then(() => item.task())
        .then(() => {
          this.completed += 1;
        })
        .catch(error => {
          this.failed += 1;
          this.lastError = `${item.name}: ${error?.message || error}`;
          console.error('[queue] task failed:', this.lastError);
        })
        .finally(() => {
          this.running -= 1;
          this.drain();
        });
    }
  }
}

export const backgroundQueue = new BackgroundQueue();
