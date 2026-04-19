// Standard Schema V1 types (inline, no external dependency)
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
  interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => Result<Output> | Promise<Result<Output>>;
    readonly types?: Types<Input, Output> | undefined;
  }

  type Result<Output> = Success<Output> | Failure;

  interface Success<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }

  interface Failure {
    readonly issues: ReadonlyArray<Issue>;
  }

  interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }

  interface PathSegment {
    readonly key: PropertyKey;
  }

  interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }
}

// Infer input/output from Standard Schema
export type InferInput<T> = T extends StandardSchemaV1<infer I, any> ? I : never;
export type InferOutput<T> = T extends StandardSchemaV1<any, infer O> ? O : never;

// Internal marker fields
export const PROCEDURE_TYPE = '~type' as const;
export const PROCEDURE_INPUT = '~input' as const;
export const PROCEDURE_OUTPUT = '~output' as const;
export const PROCEDURE_ERRORS = '~errors' as const;
export const PROCEDURE_TIMEOUT = '~timeout' as const;

// Contract node types
export interface ProcedureDefFields {
  readonly [PROCEDURE_TYPE]: 'procedure';
  readonly [PROCEDURE_INPUT]: StandardSchemaV1 | undefined;
  readonly [PROCEDURE_OUTPUT]: StandardSchemaV1 | undefined;
  readonly [PROCEDURE_ERRORS]: Record<string, StandardSchemaV1> | undefined;
  readonly [PROCEDURE_TIMEOUT]: number | undefined;
}

export interface SubscriptionDefFields {
  readonly [PROCEDURE_TYPE]: 'subscription';
  readonly [PROCEDURE_INPUT]: StandardSchemaV1 | undefined;
  readonly [PROCEDURE_ERRORS]: Record<string, StandardSchemaV1> | undefined;
}

// A contract node is either a procedure, subscription, or a nested object of them
export type ContractNode = ProcedureDefFields | SubscriptionDefFields;
export type ContractTree = { [key: string]: ContractNode | ContractTree };

// Check if a value is a contract leaf node
export function isContractNode(value: unknown): value is ContractNode {
  if (typeof value !== 'object' || value === null) return false;
  if (!(PROCEDURE_TYPE in value)) return false;
  const type = (value as { [PROCEDURE_TYPE]: unknown })[PROCEDURE_TYPE];
  return type === 'procedure' || type === 'subscription';
}

export function isProcedureNode(value: unknown): value is ProcedureDefFields {
  return isContractNode(value) && value[PROCEDURE_TYPE] === 'procedure';
}

export function isSubscriptionNode(value: unknown): value is SubscriptionDefFields {
  return isContractNode(value) && value[PROCEDURE_TYPE] === 'subscription';
}

// Wire protocol types
export interface BridgeRequestMessage {
  __bridge: 1;
  id: string;
  type: 'request';
  kind: 'procedure' | 'subscription';
  path: string[];
  input: unknown;
}

export interface BridgeResponseMessage {
  __bridge: 1;
  id: string;
  type: 'response';
  output: unknown;
}

export interface BridgeErrorMessage {
  __bridge: 1;
  id: string;
  type: 'error';
  error: { code: string; data: unknown };
}

export type BridgeMessage =
  | BridgeRequestMessage
  | BridgeResponseMessage
  | BridgeErrorMessage;

export function isBridgeMessage(value: unknown): value is BridgeMessage {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as { __bridge?: unknown; id?: unknown; type?: unknown };
  return m.__bridge === 1 && typeof m.id === 'string' && typeof m.type === 'string';
}

// Error type inference from contract errors
export type InferErrors<TErrors> = TErrors extends Record<string, StandardSchemaV1>
  ? { [K in keyof TErrors & string]: { code: K; data: InferOutput<TErrors[K]> } }[keyof TErrors & string]
  : never;

// Utility type
export type MaybePromise<T> = T | Promise<T>;

// Client type inference
type ProcedureClientFn<TInput, TOutput, TErrors> = {
  (input: TInput, options: { onError: (error: TErrors) => void }): Promise<TOutput | undefined>;
  (input: TInput, options?: { onError?: undefined }): Promise<TOutput>;
};

type InferProcedureClient<T extends ProcedureDefFields> = ProcedureClientFn<
  T[typeof PROCEDURE_INPUT] extends StandardSchemaV1 ? InferInput<T[typeof PROCEDURE_INPUT]> : void,
  T[typeof PROCEDURE_OUTPUT] extends StandardSchemaV1 ? InferOutput<T[typeof PROCEDURE_OUTPUT]> : void,
  InferErrors<T[typeof PROCEDURE_ERRORS]>
>;

type InferSubscriptionClient<T extends SubscriptionDefFields> =
  T[typeof PROCEDURE_INPUT] extends StandardSchemaV1
    ? (input: InferInput<T[typeof PROCEDURE_INPUT]>) => void
    : () => void;

export type InferClient<T> =
  T extends ProcedureDefFields ? InferProcedureClient<T>
  : T extends SubscriptionDefFields ? InferSubscriptionClient<T>
  : T extends object ? { [K in keyof T]: InferClient<T[K]> }
  : never;

// Handler type inference
type InferProcedureHandler<T extends ProcedureDefFields> = (opts: {
  input: T[typeof PROCEDURE_INPUT] extends StandardSchemaV1
    ? InferOutput<T[typeof PROCEDURE_INPUT]>
    : void;
}) => MaybePromise<
  T[typeof PROCEDURE_OUTPUT] extends StandardSchemaV1
    ? InferOutput<T[typeof PROCEDURE_OUTPUT]>
    : void
>;

type InferSubscriptionHandler<T extends SubscriptionDefFields> = (opts: {
  input: T[typeof PROCEDURE_INPUT] extends StandardSchemaV1
    ? InferOutput<T[typeof PROCEDURE_INPUT]>
    : void;
}) => MaybePromise<void>;

export type InferHandlers<T> =
  T extends ProcedureDefFields ? InferProcedureHandler<T>
  : T extends SubscriptionDefFields ? InferSubscriptionHandler<T>
  : T extends object ? { [K in keyof T]: InferHandlers<T[K]> }
  : never;
