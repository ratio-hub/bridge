import { test, expect, beforeEach, afterEach } from 'bun:test';

type Listener = (event: { data: unknown; origin?: string }) => void;

class FakeEventTarget {
  private listeners = new Map<string, Set<Listener>>();
  addEventListener(event: string, listener: Listener): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }
  removeEventListener(event: string, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }
  dispatch(event: string, data: unknown, origin?: string): void {
    for (const listener of this.listeners.get(event) ?? new Set()) {
      listener({ data, origin });
    }
  }
  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

const g = globalThis as unknown as {
  window: FakeEventTarget & { ReactNativeWebView?: { postMessage(data: string): void } };
  document: FakeEventTarget;
};

let originalWindow: unknown;
let originalDocument: unknown;

beforeEach(() => {
  originalWindow = g.window;
  originalDocument = g.document;
  const win = new FakeEventTarget() as typeof g.window;
  g.window = win;
  g.document = new FakeEventTarget();
});

afterEach(() => {
  (g as unknown as { window: unknown }).window = originalWindow;
  (g as unknown as { document: unknown }).document = originalDocument;
});

// Imported after beforeEach so the module's `isClient()` check sees a window.
// Using a dynamic import inside tests would re-import per call; top-level is
// fine because transport.ts only reads `window`/`document` inside its function
// bodies, not at module load.
import { webViewTransport } from '../transport.ts';

test('webViewTransport.subscribe delivers messages fired on window (iOS path)', () => {
  const received: string[] = [];
  const unsub = webViewTransport().subscribe((data) => received.push(data));

  g.window.dispatch('message', 'from-ios');
  expect(received).toEqual(['from-ios']);

  unsub();
});

test('webViewTransport.subscribe delivers messages fired on document (Android path)', () => {
  const received: string[] = [];
  const unsub = webViewTransport().subscribe((data) => received.push(data));

  g.document.dispatch('message', 'from-android');
  expect(received).toEqual(['from-android']);

  unsub();
});

test('webViewTransport.subscribe ignores non-string event.data on either target', () => {
  const received: string[] = [];
  const unsub = webViewTransport().subscribe((data) => received.push(data));

  g.window.dispatch('message', { not: 'a string' });
  g.document.dispatch('message', 42);
  g.window.dispatch('message', 'ok');

  expect(received).toEqual(['ok']);
  unsub();
});

test('webViewTransport unsubscribe removes listeners from both window and document', () => {
  const unsub = webViewTransport().subscribe(() => {});

  expect(g.window.listenerCount('message')).toBe(1);
  expect(g.document.listenerCount('message')).toBe(1);

  unsub();

  expect(g.window.listenerCount('message')).toBe(0);
  expect(g.document.listenerCount('message')).toBe(0);
});

test('webViewTransport.send routes through window.ReactNativeWebView.postMessage', () => {
  const sent: string[] = [];
  g.window.ReactNativeWebView = {
    postMessage: (data: string) => sent.push(data),
  };

  webViewTransport().send('payload');
  expect(sent).toEqual(['payload']);
});
