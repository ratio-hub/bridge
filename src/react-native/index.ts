import { useEffect, useMemo, useRef } from 'react';
import type { ContractTree, InferClient, InferHandlers } from '../types.ts';
import { createBridgeClient } from '../client.ts';
import { createBridgeHandler } from '../handler.ts';
import type { BridgeTransport } from '../transport.ts';
import { makeHandlerProxy } from '../internal/handler-proxy.ts';

export interface UseBridgeParams {
  send: (data: string) => void;
}

export interface UseBridgeHandlerParams<T extends ContractTree> {
  contract: T;
  transport: BridgeTransport;
  handlers: InferHandlers<T>;
}

export interface UseBridgeClientParams<T extends ContractTree> {
  contract: T;
  transport: BridgeTransport;
}

/**
 * Creates a stable transport + dispatch pair for wiring into a React Native
 * `<WebView />`.
 *
 * Usage:
 * ```tsx
 * const { transport, dispatch } = useBridge({
 *   send: (data) => webViewRef.current?.postMessage(data),
 * });
 * // ...
 * <WebView onMessage={(e) => dispatch(e.nativeEvent.data)} ... />
 * ```
 *
 * Returns values whose identities are stable across renders so downstream hooks
 * don't re-subscribe. The `send` callback is always called via a ref, so you can
 * pass an inline arrow function without triggering re-subscription.
 */
export function useBridge(
  params: UseBridgeParams,
): { transport: BridgeTransport; dispatch: (data: string) => void } {
  const { send } = params;
  const sendRef = useRef(send);
  sendRef.current = send;

  const listenersRef = useRef<Set<(data: string) => void>>(new Set());

  const transport = useMemo<BridgeTransport>(
    () => ({
      send(data) {
        sendRef.current(data);
      },
      subscribe(handler) {
        listenersRef.current.add(handler);
        return () => {
          listenersRef.current.delete(handler);
        };
      },
    }),
    [],
  );

  const dispatch = useMemo(
    () => (data: string) => {
      for (const listener of listenersRef.current) {
        listener(data);
      }
    },
    [],
  );

  return { transport, dispatch };
}

export function useBridgeHandler<T extends ContractTree>(
  params: UseBridgeHandlerParams<T>,
): void {
  const { contract, transport, handlers } = params;

  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const proxyHandlers = makeHandlerProxy(contract, handlersRef);

    const bridgeHandler = createBridgeHandler(
      contract,
      proxyHandlers,
      (data) => transport.send(data),
    );

    return transport.subscribe((data) => {
      bridgeHandler.handleMessage(data);
    });
  }, [contract, transport]);
}

export function useBridgeClient<T extends ContractTree>(
  params: UseBridgeClientParams<T>,
): InferClient<T> {
  const { contract, transport } = params;

  // Lazy-init via a ref so the client survives React 18+ StrictMode's
  // synchronous effect cleanup-then-remount.
  const clientRef = useRef<InferClient<T> | null>(null);
  if (clientRef.current === null) {
    clientRef.current = createBridgeClient(contract, transport);
  }

  return clientRef.current;
}
