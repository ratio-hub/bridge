import { useEffect, useMemo, useRef } from 'react';
import type { ContractTree, InferClient, InferHandlers } from '../types.ts';
import { createBridgeClient } from '../client.ts';
import { createBridgeHandler } from '../handler.ts';
import { webViewTransport } from '../transport.ts';
import type { BridgeTransport } from '../transport.ts';
import { makeHandlerProxy } from '../internal/handler-proxy.ts';

export interface UseBridgeClientParams<T extends ContractTree> {
  contract: T;
  transport?: BridgeTransport;
}

export interface UseBridgeHandlerParams<T extends ContractTree> {
  contract: T;
  transport?: BridgeTransport;
  handlers: InferHandlers<T>;
}

export function useBridgeClient<T extends ContractTree>(
  params: UseBridgeClientParams<T>,
): InferClient<T> {
  const { contract, transport } = params;

  const activeTransport = useMemo(() => transport ?? webViewTransport(), [transport]);

  // Lazy-init the client in a ref so it survives React 18+ StrictMode's
  // synchronous effect cleanup-then-remount. Callers who need deterministic
  // teardown can hold the returned client and dispose it themselves.
  const clientRef = useRef<InferClient<T> | null>(null);
  if (clientRef.current === null) {
    clientRef.current = createBridgeClient(contract, activeTransport);
  }

  return clientRef.current;
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
