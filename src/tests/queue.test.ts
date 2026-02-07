import { test, expect } from 'bun:test';
import { SubscriptionQueue } from '../queue.ts';

test('queue processes tasks in FIFO order', async () => {
  const queue = new SubscriptionQueue();
  const results: number[] = [];

  queue.enqueue(async () => {
    await new Promise((r) => setTimeout(r, 30));
    results.push(1);
  });
  queue.enqueue(async () => {
    results.push(2);
  });
  queue.enqueue(async () => {
    results.push(3);
  });

  // Wait for all to process
  await new Promise((r) => setTimeout(r, 100));
  expect(results).toEqual([1, 2, 3]);
});

test('queue handles errors without stopping', async () => {
  const queue = new SubscriptionQueue();
  const results: number[] = [];

  queue.enqueue(async () => {
    results.push(1);
  });
  queue.enqueue(async () => {
    throw new Error('fail');
  });
  queue.enqueue(async () => {
    results.push(3);
  });

  await new Promise((r) => setTimeout(r, 50));
  // Queue swallows errors and continues processing
  expect(results).toEqual([1, 3]);
});

test('queue can be restarted after completion', async () => {
  const queue = new SubscriptionQueue();
  const results: number[] = [];

  queue.enqueue(async () => {
    results.push(1);
  });

  await new Promise((r) => setTimeout(r, 20));
  expect(results).toEqual([1]);

  // Enqueue more after first batch completes
  queue.enqueue(async () => {
    results.push(2);
  });

  await new Promise((r) => setTimeout(r, 20));
  expect(results).toEqual([1, 2]);
});
