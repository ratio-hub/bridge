import { type ContractTree, type InferHandlers, isContractNode } from '../types.ts';

/**
 * Build a recursive proxy that mirrors the contract shape and forwards each
 * invocation to the current value in `handlersRef`. This gives the underlying
 * bridge handler a stable callable tree while letting consumers pass inline
 * objects without causing re-subscriptions.
 *
 * Shared between the React and React Native hooks.
 */
export function makeHandlerProxy<T extends ContractTree>(
  contract: T,
  handlersRef: { readonly current: InferHandlers<T> },
): InferHandlers<T> {
  return buildNode(contract, handlersRef, []) as InferHandlers<T>;
}

function buildNode(
  contract: ContractTree,
  handlersRef: { readonly current: unknown },
  path: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(contract)) {
    const node = contract[key]!;
    const nextPath = [...path, key];
    if (isContractNode(node)) {
      out[key] = (...args: unknown[]): unknown => {
        const target = walk(handlersRef.current, nextPath);
        if (typeof target !== 'function') return undefined;
        return (target as (...a: unknown[]) => unknown)(...args);
      };
    } else {
      out[key] = buildNode(node, handlersRef, nextPath);
    }
  }
  return out;
}

function walk(obj: unknown, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
