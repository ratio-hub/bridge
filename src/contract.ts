import type { StandardSchemaV1 } from './types.ts';
import {
  PROCEDURE_TYPE,
  PROCEDURE_INPUT,
  PROCEDURE_OUTPUT,
  PROCEDURE_ERRORS,
  PROCEDURE_TIMEOUT,
  type ProcedureDefFields,
  type SubscriptionDefFields,
} from './types.ts';

// ProcedureDef — immutable builder for procedure contract nodes
export class ProcedureDef<
  TInput extends StandardSchemaV1 | undefined = undefined,
  TOutput extends StandardSchemaV1 | undefined = undefined,
  TErrors extends Record<string, StandardSchemaV1> | undefined = undefined,
  TTimeout extends number | undefined = undefined,
> {
  readonly [PROCEDURE_TYPE] = 'procedure' as const;
  readonly [PROCEDURE_INPUT]: TInput;
  readonly [PROCEDURE_OUTPUT]: TOutput;
  readonly [PROCEDURE_ERRORS]: TErrors;
  readonly [PROCEDURE_TIMEOUT]: TTimeout;

  constructor(
    inputSchema: TInput,
    outputSchema: TOutput,
    errors: TErrors,
    timeout: TTimeout,
  ) {
    this[PROCEDURE_INPUT] = inputSchema;
    this[PROCEDURE_OUTPUT] = outputSchema;
    this[PROCEDURE_ERRORS] = errors;
    this[PROCEDURE_TIMEOUT] = timeout;
  }

  input<S extends StandardSchemaV1>(schema: S): ProcedureDef<S, TOutput, TErrors, TTimeout> {
    return new ProcedureDef(schema, this[PROCEDURE_OUTPUT], this[PROCEDURE_ERRORS], this[PROCEDURE_TIMEOUT]);
  }

  output<S extends StandardSchemaV1>(schema: S): ProcedureDef<TInput, S, TErrors, TTimeout> {
    return new ProcedureDef(this[PROCEDURE_INPUT], schema, this[PROCEDURE_ERRORS], this[PROCEDURE_TIMEOUT]);
  }

  timeout<T extends number>(ms: T): ProcedureDef<TInput, TOutput, TErrors, T> {
    return new ProcedureDef(this[PROCEDURE_INPUT], this[PROCEDURE_OUTPUT], this[PROCEDURE_ERRORS], ms);
  }
}

// SubscriptionDef — immutable builder for subscription contract nodes
export class SubscriptionDef<
  TInput extends StandardSchemaV1 | undefined = undefined,
  TErrors extends Record<string, StandardSchemaV1> | undefined = undefined,
> {
  readonly [PROCEDURE_TYPE] = 'subscription' as const;
  readonly [PROCEDURE_INPUT]: TInput;
  readonly [PROCEDURE_ERRORS]: TErrors;

  constructor(inputSchema: TInput, errors: TErrors) {
    this[PROCEDURE_INPUT] = inputSchema;
    this[PROCEDURE_ERRORS] = errors;
  }

  input<S extends StandardSchemaV1>(schema: S): SubscriptionDef<S, TErrors> {
    return new SubscriptionDef(schema, this[PROCEDURE_ERRORS]);
  }
}

// BaseBuilder — entry point for contract definitions
export class BaseBuilder<
  TErrors extends Record<string, StandardSchemaV1> | undefined = undefined,
> {
  private readonly _errors: TErrors;

  constructor(errors: TErrors) {
    this._errors = errors;
  }

  errors<E extends Record<string, StandardSchemaV1>>(
    errorSchemas: E,
  ): BaseBuilder<TErrors extends undefined ? E : TErrors & E> {
    // The conditional return type models two runtime shapes in one signature:
    // when `TErrors` is undefined the spread evaluates to `E`, otherwise it's
    // `TErrors & E`. TypeScript can't verify the spread produces the conditional,
    // so we assert the result once at the boundary.
    type Merged = TErrors extends undefined ? E : TErrors & E;
    const merged = { ...this._errors, ...errorSchemas } as unknown as Merged;
    return new BaseBuilder<Merged>(merged);
  }

  get procedure(): ProcedureDef<undefined, undefined, TErrors, undefined> {
    return new ProcedureDef(undefined, undefined, this._errors, undefined);
  }

  get subscription(): SubscriptionDef<undefined, TErrors> {
    return new SubscriptionDef(undefined, this._errors);
  }
}
