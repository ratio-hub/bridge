export class SubscriptionQueue {
  private queue: (() => Promise<void>)[] = [];
  private processing = false;

  enqueue(task: () => Promise<void>): void {
    this.queue.push(task);
    if (!this.processing) {
      this.process();
    }
  }

  private async process(): Promise<void> {
    this.processing = true;
    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      try {
        await task();
      } catch {
        // Subscription handler errors are silently swallowed to keep the queue moving
      }
    }
    this.processing = false;
  }
}
