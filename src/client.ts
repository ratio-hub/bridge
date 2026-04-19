import {
  type ContractTree,
  type ContractNode,
  type InferClient,
  type StandardSchemaV1,
  isContractNode,
  isBridgeMessage,
  isSubscriptionNode,
  PROCEDURE_INPUT,
  PROCEDURE_OUTPUT,
  PROCEDURE_TIMEOUT,
} from './types.ts';
import type { BridgeTransport } from './transport.ts';
import { BridgeError, BridgeTimeoutError, BridgeValidationError } from './errors.ts';
import { validate } from './schema.ts';
import { nanoid } from 'nanoid';

function generateId(): string {
  return `bridge_${nanoid()}`;
}

type WireError = { code: string; data: unknown };

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  onError: ((error: WireError) => void) | undefined;
  outputSchema: StandardSchemaV1 | undefined;
  validateOutput: boolean;
}

export interface CreateBridgeClientOptions {
  /**
   * When true, responses are validated against the procedure's output schema on the client side.
   * Useful when the other side of the bridge is untrusted (e.g. web content inside a WebView).
   * A validation failure rejects the call with a {@link BridgeValidationError} (or calls `onError`
   * with code `VALIDATION_ERROR` if provided).
   * @default false
   */
  validateOutput?: boolean;
  /**
   * Called when a subscription input fails schema validation. By default, validation failures
   * are reported via `console.warn` instead of being silently dropped.
   */
  onSubscriptionError?: (error: BridgeValidationError, path: string[]) => void;
}

export interface CallOptions {
  onError?: (error: WireError) => void;
}

/**
 * Symbol used to attach a `dispose()` method to the client proxy without
 * polluting the user's contract namespace. Use via the {@link dispose} helper.
 */
export const BRIDGE_CLIENT_DISPOSE: unique symbol = Symbol('bridge.client.dispose');

/**
 * Release the transport subscription held by a bridge client and reject all
 * in-flight procedure calls with a {@link BridgeError} of code `DISPOSED`.
 *
 * Safe to call multiple times; subsequent calls are no-ops. After disposal,
 * calling any method on the client is also a no-op (subscriptions silently
 * drop, procedures reject with `DISPOSED`).
 */
export function dispose(client: unknown): void {
  if (client && typeof client === 'object' && BRIDGE_CLIENT_DISPOSE in client) {
    (client as { [BRIDGE_CLIENT_DISPOSE]: () => void })[BRIDGE_CLIENT_DISPOSE]();
  }
}

export function createBridgeClient<T extends ContractTree>(
  contract: T,
  transport: BridgeTransport,
  options: CreateBridgeClientOptions = {},
): InferClient<T> {
  const pending = new Map<string, PendingRequest>();
  const validateOutput = options.validateOutput ?? false;
  const onSubscriptionError =
    options.onSubscriptionError ??
    ((err, path) => {
      console.warn(
        `[bridge] Subscription "${path.join('.')}" input validation failed:`,
        err.message,
      );
    });

  let disposed = false;

  // Listen for responses
  const unsubscribe = transport.subscribe((raw: string) => {
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
      const { output } = parsed;
      if (entry.validateOutput && entry.outputSchema) {
        validate(entry.outputSchema, output).then(
          (validated) => entry.resolve(validated),
          (err: unknown) => {
            if (entry.onError && err instanceof BridgeValidationError) {
              entry.onError({
                code: 'VALIDATION_ERROR',
                data: { message: err.message, issues: err.issues },
              });
              entry.resolve(undefined);
            } else {
              entry.reject(err);
            }
          },
        );
      } else {
        entry.resolve(output);
      }
    } else {
      const { error } = parsed;
      if (entry.onError) {
        entry.onError(error);
        entry.resolve(undefined);
      } else {
        entry.reject(new BridgeError(error.code, error.data));
      }
    }
  });

  function disposeClient(): void {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    for (const [id, entry] of pending) {
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.onError) {
        entry.onError({ code: 'DISPOSED', data: { message: 'Bridge client disposed' } });
        entry.resolve(undefined);
      } else {
        entry.reject(new BridgeError('DISPOSED', { message: 'Bridge client disposed' }));
      }
      pending.delete(id);
    }
  }

  function buildSubscription(
    inputSchema: StandardSchemaV1 | undefined,
    path: string[],
  ): (input: unknown) => void {
    return (input: unknown): void => {
      if (disposed) return;

      const payload = JSON.stringify({
        __bridge: 1,
        id: generateId(),
        type: 'request',
        kind: 'subscription',
        path,
        input,
      });

      if (!inputSchema) {
        transport.send(payload);
        return;
      }

      // Fire-and-forget: validate then send, no response tracking.
      // Validation errors are surfaced via `onSubscriptionError` rather than swallowed.
      // `validate` only rejects with `BridgeValidationError`; the cast is safe and the
      // alternative — wrapping an unknown error — would hide bugs in `validate` itself.
      validate(inputSchema, input).then(
        () => {
          if (!disposed) transport.send(payload);
        },
        (err: unknown) => {
          if (!disposed) onSubscriptionError(err as BridgeValidationError, path);
        },
      );
    };
  }

  function buildProcedure(
    inputSchema: StandardSchemaV1 | undefined,
    outputSchema: StandardSchemaV1 | undefined,
    timeoutMs: number | undefined,
    path: string[],
  ): (input: unknown, callOptions?: CallOptions) => Promise<unknown> {
    return (input: unknown, callOptions?: CallOptions): Promise<unknown> => {
      return new Promise<unknown>((resolve, reject) => {
        const run = async (): Promise<void> => {
          if (disposed) {
            if (callOptions?.onError) {
              callOptions.onError({
                code: 'DISPOSED',
                data: { message: 'Bridge client disposed' },
              });
              resolve(undefined);
            } else {
              reject(new BridgeError('DISPOSED', { message: 'Bridge client disposed' }));
            }
            return;
          }

          if (inputSchema) {
            try {
              await validate(inputSchema, input);
            } catch (err) {
              reject(err);
              return;
            }
          }

          const id = generateId();
          const entry: PendingRequest = {
            resolve,
            reject,
            timer: undefined,
            onError: callOptions?.onError,
            outputSchema,
            validateOutput,
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
        };

        // Any unexpected throw inside `run` (sync or async) must settle the promise.
        run().catch(reject);
      });
    };
  }

  function buildClient(node: ContractTree | ContractNode, path: string[]): unknown {
    if (isContractNode(node)) {
      if (isSubscriptionNode(node)) {
        return buildSubscription(node[PROCEDURE_INPUT], path);
      }
      return buildProcedure(
        node[PROCEDURE_INPUT],
        node[PROCEDURE_OUTPUT],
        node[PROCEDURE_TIMEOUT],
        path,
      );
    }

    const obj: Record<string, unknown> = {};
    for (const key of Object.keys(node)) {
      obj[key] = buildClient(node[key]!, [...path, key]);
    }
    return obj;
  }

  const proxy = buildClient(contract, []) as Record<string | symbol, unknown>;
  proxy[BRIDGE_CLIENT_DISPOSE] = disposeClient;
  return proxy as InferClient<T>;
}
