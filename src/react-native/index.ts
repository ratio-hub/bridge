import { useEffect, useMemo, useRef } from 'react';
import type { ContractTree, InferClient, InferHandlers } from '../types.ts';
import { createBridgeClient } from '../client.ts';
import { createBridgeHandler } from '../handler.ts';
import type { BridgeTransport } from '../transport.ts';

export function useBridge(
  send: (data: string) => void,
): { transport: BridgeTransport; dispatch: (data: string) => void } {
  const sendRef = useRef(send);
  sendRef.current = send;

  const listenersRef = useRef(new Set<(data: string) => void>());

  const transport = useMemo<BridgeTransport>(
    () => ({
      send(data: string) {
        sendRef.current(data);
      },
      subscribe(handler: (data: string) => void) {
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
  contract: T,
  handlers: InferHandlers<T>,
  transport: BridgeTransport,
): void {
  useEffect(() => {
    const bridgeHandler = createBridgeHandler(
      contract,
      handlers,
      (data) => transport.send(data),
    );

    const unsub = transport.subscribe((data) => {
      bridgeHandler.handleMessage(data);
    });

    return unsub;
  }, [contract, handlers, transport]);
}

export function useBridgeClient<T extends ContractTree>(
  contract: T,
  transport: BridgeTransport,
): InferClient<T> {
  const client = useMemo(
    () => createBridgeClient(contract, transport),
    [contract, transport],
  );

  return client as InferClient<T>;
}
