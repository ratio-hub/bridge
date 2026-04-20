import {
  type BridgeRequestMessage,
  type ContractNode,
  type ContractTree,
  type InferHandlers,
  isContractNode,
  isBridgeMessage,
  PROCEDURE_TYPE,
  PROCEDURE_INPUT,
  PROCEDURE_OUTPUT,
  PROCEDURE_ERRORS,
} from './types.ts';
import type { BridgeTransport } from './transport.ts';
import { BridgeError, BridgeValidationError } from './errors.ts';
import { validate } from './schema.ts';
import { SubscriptionQueue } from './queue.ts';

type HandlerFn = (opts: { input: unknown }) => unknown;

function walkPath(obj: unknown, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export interface BridgeHandler {
  handleMessage(raw: string): void;
}

export function createBridgeHandler<T extends ContractTree>(
  contract: T,
  handlers: InferHandlers<T>,
  send: (data: string) => void,
): BridgeHandler {
  const queues = new Map<string, SubscriptionQueue>();

  function getQueue(pathKey: string): SubscriptionQueue {
    let queue = queues.get(pathKey);
    if (!queue) {
      queue = new SubscriptionQueue();
      queues.set(pathKey, queue);
    }
    return queue;
  }

  async function processRequest(msg: BridgeRequestMessage): Promise<void> {
    const nodeRaw = walkPath(contract, msg.path);
    const handlerRaw = walkPath(handlers, msg.path);

    if (!isContractNode(nodeRaw) || typeof handlerRaw !== 'function') {
      if (msg.kind === 'procedure') {
        send(
          JSON.stringify({
            __bridge: 1,
            id: msg.id,
            type: 'error',
            error: { code: 'NOT_FOUND', data: { message: `No handler for ${msg.path.join('.')}` } },
          }),
        );
      }
      return;
    }

    const node: ContractNode = nodeRaw;
    const handler = handlerRaw as HandlerFn;

    // Validate input
    let validatedInput: unknown = msg.input;
    if (node[PROCEDURE_INPUT]) {
      try {
        validatedInput = await validate(node[PROCEDURE_INPUT], msg.input);
      } catch (err) {
        if (msg.kind === 'procedure') {
          send(
            JSON.stringify({
              __bridge: 1,
              id: msg.id,
              type: 'error',
              error: {
                code: 'VALIDATION_ERROR',
                data: {
                  message: err instanceof BridgeValidationError ? err.message : 'Input validation failed',
                  issues: err instanceof BridgeValidationError ? err.issues : [],
                },
              },
            }),
          );
        }
        return;
      }
    }

    if (node[PROCEDURE_TYPE] === 'subscription') {
      const pathKey = msg.path.join('.');
      const queue = getQueue(pathKey);
      queue.enqueue(async () => {
        await handler({ input: validatedInput });
      });
      return;
    }

    // Procedure: execute and send response
    try {
      let output = await handler({ input: validatedInput });

      // Validate output. Narrowing on the discriminant lets us index the
      // procedure-only `PROCEDURE_OUTPUT` symbol without an `any` cast.
      if (node[PROCEDURE_TYPE] === 'procedure' && node[PROCEDURE_OUTPUT]) {
        output = await validate(node[PROCEDURE_OUTPUT], output);
      }

      send(
        JSON.stringify({
          __bridge: 1,
          id: msg.id,
          type: 'response',
          output,
        }),
      );
    } catch (err) {
      if (err instanceof BridgeError) {
        // Validate error data against contract error schema if defined
        const errors = node[PROCEDURE_ERRORS];
        if (errors && err.code in errors) {
          try {
            const validatedData = await validate(errors[err.code]!, err.data);
            send(
              JSON.stringify({
                __bridge: 1,
                id: msg.id,
                type: 'error',
                error: { code: err.code, data: validatedData },
              }),
            );
            return;
          } catch {
            // Fall through to send unvalidated error
          }
        }
        send(
          JSON.stringify({
            __bridge: 1,
            id: msg.id,
            type: 'error',
            error: { code: err.code, data: err.data },
          }),
        );
      } else if (err instanceof BridgeValidationError) {
        send(
          JSON.stringify({
            __bridge: 1,
            id: msg.id,
            type: 'error',
            error: {
              code: 'VALIDATION_ERROR',
              data: { message: err.message, issues: err.issues },
            },
          }),
        );
      } else {
        send(
          JSON.stringify({
            __bridge: 1,
            id: msg.id,
            type: 'error',
            error: {
              code: 'INTERNAL_ERROR',
              data: { message: err instanceof Error ? err.message : 'Unknown error' },
            },
          }),
        );
      }
    }
  }

  return {
    handleMessage(raw: string) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return; // ignore non-JSON
      }

      if (!isBridgeMessage(parsed)) return;
      if (parsed.type !== 'request') return;

      const msg = parsed as BridgeRequestMessage;
      processRequest(msg);
    },
  };
}
