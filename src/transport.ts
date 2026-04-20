export interface BridgeTransport {
  send(data: string): void;
  subscribe(handler: (data: string) => void): () => void;
}

// Minimal structural typing for the global `window` object. Declared locally so
// this package can be consumed in both DOM and non-DOM TypeScript projects
// without requiring `lib: ["dom"]`.
interface MessageLikeEvent {
  readonly data: unknown;
  readonly origin?: string;
}

type MessageListener = (event: MessageLikeEvent) => void;

declare const window:
  | {
      readonly ReactNativeWebView?: { postMessage(data: string): void };
      addEventListener(event: 'message', handler: MessageListener): void;
      removeEventListener(event: 'message', handler: MessageListener): void;
    }
  | undefined;

const NOOP = (): void => {};

export function webViewTransport(): BridgeTransport {
  return {
    send(data) {
      window?.ReactNativeWebView?.postMessage(data);
    },
    subscribe(handler) {
      if (!window) return NOOP;
      const listener: MessageListener = (event) => {
        if (typeof event.data === 'string') {
          handler(event.data);
        }
      };
      window.addEventListener('message', listener);
      return () => window.removeEventListener('message', listener);
    },
  };
}

export function iframeTransport(
  target: { postMessage(data: string, origin: string): void },
  origin: string = '*',
): BridgeTransport {
  return {
    send(data) {
      target.postMessage(data, origin);
    },
    subscribe(handler) {
      if (!window) return NOOP;
      const listener: MessageListener = (event) => {
        if (origin !== '*' && event.origin !== origin) return;
        if (typeof event.data === 'string') {
          handler(event.data);
        }
      };
      window.addEventListener('message', listener);
      return () => window.removeEventListener('message', listener);
    },
  };
}
