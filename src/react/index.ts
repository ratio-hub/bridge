import { useEffect, useMemo, useRef } from 'react';
import type { ContractTree, InferClient, InferHandlers } from '../types.ts';
import { createBridgeClient } from '../client.ts';
import { createBridgeHandler } from '../handler.ts';
import { webViewTransport } from '../transport.ts';
import type { BridgeTransport } from '../transport.ts';

export function useBridgeClient<T extends ContractTree>(
  contract: T,
  transport?: BridgeTransport,
): InferClient<T> {
  const transportRef = useRef(transport ?? webViewTransport());

  const client = useMemo(
    () => createBridgeClient(contract, transportRef.current),
    [contract],
  );

  return client as InferClient<T>;
}

export function useBridgeHandler<T extends ContractTree>(
  contract: T,
  handlers: InferHandlers<T>,
  transport?: BridgeTransport,
): void {
  const transportRef = useRef(transport ?? webViewTransport());

  useEffect(() => {
    const bridgeHandler = createBridgeHandler(
      contract,
      handlers,
      (data) => transportRef.current.send(data),
    );

    const unsub = transportRef.current.subscribe((data) => {
      bridgeHandler.handleMessage(data);
    });

    return unsub;
  }, [contract, handlers]);
}
