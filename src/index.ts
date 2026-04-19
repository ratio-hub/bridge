export { BaseBuilder, ProcedureDef, SubscriptionDef } from './contract.ts';
export { BridgeError, BridgeTimeoutError, BridgeValidationError } from './errors.ts';
export { createBridgeClient, dispose, BRIDGE_CLIENT_DISPOSE } from './client.ts';
export type { CreateBridgeClientOptions, CallOptions } from './client.ts';
export { createBridgeHandler } from './handler.ts';
export { SubscriptionQueue } from './queue.ts';
export { validate } from './schema.ts';
export { webViewTransport, iframeTransport } from './transport.ts';
export type { BridgeTransport } from './transport.ts';
export { isContractNode, isProcedureNode, isSubscriptionNode } from './types.ts';
export type {
  StandardSchemaV1,
  InferInput,
  InferOutput,
  InferErrors,
  InferClient,
  InferHandlers,
  BridgeMessage,
  BridgeRequestMessage,
  BridgeResponseMessage,
  BridgeErrorMessage,
  ContractNode,
  ContractTree,
  ProcedureDefFields,
  SubscriptionDefFields,
  MaybePromise,
} from './types.ts';

import { BaseBuilder } from './contract.ts';

export const bridge = {
  base(): BaseBuilder<undefined> {
    return new BaseBuilder(undefined);
  },
};
