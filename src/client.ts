import {
  type ContractTree,
  type ContractNode,
  type InferClient,
  type BridgeResponseMessage,
  type BridgeErrorMessage,
  isContractNode,
  isBridgeMessage,
  PROCEDURE_TYPE,
  PROCEDURE_INPUT,
  PROCEDURE_TIMEOUT,
} from './types.ts';
import type { BridgeTransport } from './transport.ts';
import { BridgeError, BridgeTimeoutError } from './errors.ts';
import { validate } from './schema.ts';

let idCounter = 0;
function generateId(): string {
  return `bridge_${Date.now()}_${++idCounter}`;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: any) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  onError: ((error: { code: string; data: unknown }) => void) | undefined;
}

export function createBridgeClient<T extends ContractTree>(
  contract: T,
  transport: BridgeTransport,
): InferClient<T> {
  const pending = new Map<string, PendingRequest>();

  // Listen for responses
  transport.subscribe((raw: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (!isBridgeMessage(parsed)) return;
    if (parsed.type !== 'response' && parsed.type !== 'error') return;

    const entry = pending.get(parsed.id);
    if (!entry) return;

    pending.delete(parsed.id);
    if (entry.timer) clearTimeout(entry.timer);

    if (parsed.type === 'response') {
      entry.resolve((parsed as BridgeResponseMessage).output);
    } else {
      const errMsg = parsed as BridgeErrorMessage;
      if (entry.onError) {
        entry.onError(errMsg.error);
        entry.resolve(undefined);
      } else {
        entry.reject(new BridgeError(errMsg.error.code, errMsg.error.data));
      }
    }
  });

  function buildClient(node: ContractTree | ContractNode, path: string[]): any {
    if (isContractNode(node)) {
      if (node[PROCEDURE_TYPE] === 'subscription') {
        return (input: unknown) => {
          const inputSchema = node[PROCEDURE_INPUT];
          if (inputSchema) {
            // Fire-and-forget: validate then send, no response tracking
            validate(inputSchema, input).then(() => {
              transport.send(
                JSON.stringify({
                  __bridge: 1,
                  id: generateId(),
                  type: 'request',
                  kind: 'subscription',
                  path,
                  input,
                }),
              );
            });
          } else {
            transport.send(
              JSON.stringify({
                __bridge: 1,
                id: generateId(),
                type: 'request',
                kind: 'subscription',
                path,
                input,
              }),
            );
          }
        };
      }

      // Procedure
      return (input: unknown, options?: { onError?: (error: any) => void }) => {
        return new Promise(async (resolve, reject) => {
          // Validate input
          const inputSchema = node[PROCEDURE_INPUT];
          if (inputSchema) {
            try {
              await validate(inputSchema, input);
            } catch (err) {
              reject(err);
              return;
            }
          }

          const id = generateId();
          const timeoutMs = node[PROCEDURE_TIMEOUT];

          const entry: PendingRequest = {
            resolve,
            reject,
            timer: undefined,
            onError: options?.onError,
          };

          if (timeoutMs) {
            entry.timer = setTimeout(() => {
              pending.delete(id);
              reject(new BridgeTimeoutError(path, timeoutMs));
            }, timeoutMs);
          }

          pending.set(id, entry);

          transport.send(
            JSON.stringify({
              __bridge: 1,
              id,
              type: 'request',
              kind: 'procedure',
              path,
              input,
            }),
          );
        });
      };
    }

    // Nested object — recurse
    const obj: Record<string, any> = {};
    for (const key of Object.keys(node as ContractTree)) {
      obj[key] = buildClient((node as ContractTree)[key]!, [...path, key]);
    }
    return obj;
  }

  return buildClient(contract, []) as InferClient<T>;
}
