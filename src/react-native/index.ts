import { useEffect, useMemo, useRef } from 'react';
import type { ContractTree, InferClient, InferHandlers } from '../types.ts';
import {
  createBridgeClient,
  dispose,
  type CreateBridgeClientOptions,
} from '../client.ts';
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
  options?: CreateBridgeClientOptions;
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

  // Single subscriber slot. The bridge handler + client each subscribe once, and
  // in practice we only need to fan out to those two places at most. Using a Set
  // keeps the door open without meaningful extra cost.
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

  // Keep the latest `handlers` in a ref so inline object literals don't trigger
  // re-subscription on every render.
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
  const { contract, transport, options } = params;

  const client = useMemo(
    () => createBridgeClient(contract, transport, options),
    // Intentionally omit `options` from deps — typically an object literal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contract, transport],
  );

  // Release the transport subscription and reject pending calls when the hook
  // unmounts or when inputs change.
  useEffect(() => () => dispose(client), [client]);

  return client;
}
