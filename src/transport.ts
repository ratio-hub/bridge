export interface BridgeTransport {
  send(data: string): void;
  subscribe(handler: (data: string) => void): () => void;
}

declare const window: {
  ReactNativeWebView?: { postMessage(data: string): void };
  addEventListener(event: string, handler: (e: any) => void): void;
  removeEventListener(event: string, handler: (e: any) => void): void;
  parent: any;
  postMessage(data: any, origin: string): void;
};

export function webViewTransport(): BridgeTransport {
  return {
    send(data: string) {
      window.ReactNativeWebView?.postMessage(data);
    },
    subscribe(handler: (data: string) => void) {
      const listener = (event: { data: string }) => {
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
  target: { postMessage(data: any, origin: string): void },
  origin: string = '*',
): BridgeTransport {
  return {
    send(data: string) {
      target.postMessage(data, origin);
    },
    subscribe(handler: (data: string) => void) {
      const listener = (event: { data: unknown; origin: string }) => {
        if (origin !== '*' && event.origin !== origin) return;
        if (typeof event.data === 'string') {
          handler(event.data);
        }
      };
      window.addEventListener('message', listener as any);
      return () => window.removeEventListener('message', listener as any);
    },
  };
}
