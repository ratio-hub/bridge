import { useEffect, useMemo, useRef } from 'react';
import type { ContractTree, InferClient, InferHandlers } from '../types.ts';
import {
  createBridgeClient,
  dispose,
  type CreateBridgeClientOptions,
} from '../client.ts';
import { createBridgeHandler } from '../handler.ts';
import { webViewTransport } from '../transport.ts';
import type { BridgeTransport } from '../transport.ts';
import { makeHandlerProxy } from '../internal/handler-proxy.ts';

export interface UseBridgeClientParams<T extends ContractTree> {
  contract: T;
  transport?: BridgeTransport;
  options?: CreateBridgeClientOptions;
}

export interface UseBridgeHandlerParams<T extends ContractTree> {
  contract: T;
  transport?: BridgeTransport;
  handlers: InferHandlers<T>;
}

export function useBridgeClient<T extends ContractTree>(
  params: UseBridgeClientParams<T>,
): InferClient<T> {
  const { contract, transport, options } = params;

  // Resolve the transport once per `transport` identity. When omitted, a single
  // `webViewTransport()` is created and reused for the lifetime of the hook.
  const activeTransport = useMemo(() => transport ?? webViewTransport(), [transport]);

  const client = useMemo(
    () => createBridgeClient(contract, activeTransport, options),
    // Intentionally omit `options` from deps — it's typically an object literal.
    // Callers who need to change options dynamically should remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contract, activeTransport],
  );

  // Release the transport subscription and reject pending calls when the hook
  // unmounts or when inputs change.
  useEffect(() => () => dispose(client), [client]);

  return client;
}

export function useBridgeHandler<T extends ContractTree>(
  params: UseBridgeHandlerParams<T>,
): void {
  const { contract, transport, handlers } = params;

  // Keep the latest `handlers` in a ref so inline object literals don't trigger
  // re-subscription on every render.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const activeTransport = useMemo(() => transport ?? webViewTransport(), [transport]);

  useEffect(() => {
    // Build a proxy that forwards to the latest ref so the handler instance is stable
    // for the lifetime of the subscription.
    const proxyHandlers = makeHandlerProxy(contract, handlersRef);

    const bridgeHandler = createBridgeHandler(
      contract,
      proxyHandlers,
      (data) => activeTransport.send(data),
    );

    return activeTransport.subscribe((data) => {
      bridgeHandler.handleMessage(data);
    });
  }, [contract, activeTransport]);
}
