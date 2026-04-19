import {
  type BridgeRequestMessage,
  type ContractNode,
  type ContractTree,
  type InferHandlers,
  isContractNode,
  isBridgeMessage,
  isSubscriptionNode,
  PROCEDURE_INPUT,
  PROCEDURE_OUTPUT,
  PROCEDURE_ERRORS,
} from './types.ts';
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

  function sendError(id: string, code: string, data: unknown): void {
    send(
      JSON.stringify({
        __bridge: 1,
        id,
        type: 'error',
        error: { code, data },
      }),
    );
  }

  async function processRequest(msg: BridgeRequestMessage): Promise<void> {
    const nodeRaw = walkPath(contract, msg.path);
    const handlerRaw = walkPath(handlers, msg.path);

    if (!isContractNode(nodeRaw) || typeof handlerRaw !== 'function') {
      if (msg.kind === 'procedure') {
        sendError(msg.id, 'NOT_FOUND', {
          message: `No handler for ${msg.path.join('.')}`,
        });
      }
      return;
    }

    const node: ContractNode = nodeRaw;
    const handler = handlerRaw as HandlerFn;

    // Cross-check the request kind against the contract shape. A client that
    // sends `kind: 'procedure'` for a path defined as a subscription (or vice
    // versa) is a protocol violation — we reject rather than silently
    // enqueuing work or hanging the caller.
    const nodeIsSubscription = isSubscriptionNode(node);
    if (msg.kind === 'subscription' && !nodeIsSubscription) {
      // Contract expects a response-bearing procedure but client sent a
      // fire-and-forget subscription. There's no response channel for the
      // client — warn and drop.
      console.warn(
        `[bridge] Received subscription for procedure path "${msg.path.join('.')}"; dropping.`,
      );
      return;
    }
    if (msg.kind === 'procedure' && nodeIsSubscription) {
      sendError(msg.id, 'KIND_MISMATCH', {
        message: `Path "${msg.path.join('.')}" is defined as a subscription, not a procedure`,
      });
      return;
    }

    // Validate input
    let validatedInput: unknown = msg.input;
    const inputSchema = node[PROCEDURE_INPUT];
    if (inputSchema) {
      try {
        validatedInput = await validate(inputSchema, msg.input);
      } catch (err) {
        if (msg.kind === 'procedure') {
          const message =
            err instanceof BridgeValidationError ? err.message : 'Input validation failed';
          const issues = err instanceof BridgeValidationError ? err.issues : [];
          sendError(msg.id, 'VALIDATION_ERROR', { message, issues });
        } else {
          // Subscriptions are fire-and-forget; there is nothing to respond to, but we
          // surface the failure via console so it isn't silently dropped.
          console.warn(
            `[bridge] Subscription "${msg.path.join('.')}" input validation failed:`,
            err instanceof BridgeValidationError ? err.message : err,
          );
        }
        return;
      }
    }

    if (nodeIsSubscription) {
      const pathKey = msg.path.join('.');
      const queue = getQueue(pathKey);
      queue.enqueue(async () => {
        await handler({ input: validatedInput });
      });
      return;
    }

    // Procedure: execute and send response
    const outputSchema = node[PROCEDURE_OUTPUT];
    const errorSchemas = node[PROCEDURE_ERRORS];

    try {
      let output = await handler({ input: validatedInput });

      if (outputSchema) {
        output = await validate(outputSchema, output);
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
        if (errorSchemas && err.code in errorSchemas) {
          try {
            const validatedData = await validate(errorSchemas[err.code]!, err.data);
            sendError(msg.id, err.code, validatedData);
            return;
          } catch {
            // Fall through to send unvalidated error
          }
        }
        sendError(msg.id, err.code, err.data);
      } else if (err instanceof BridgeValidationError) {
        sendError(msg.id, 'VALIDATION_ERROR', { message: err.message, issues: err.issues });
      } else {
        sendError(msg.id, 'INTERNAL_ERROR', {
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  }

  return {
    handleMessage(raw: string) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }

      if (!isBridgeMessage(parsed)) return;
      if (parsed.type !== 'request') return;

      processRequest(parsed);
    },
  };
}
