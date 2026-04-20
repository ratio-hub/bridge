export class BridgeError extends Error {
  readonly code: string;
  readonly data: unknown;

  constructor(code: string, data?: unknown) {
    super(`Bridge error: ${code}`);
    this.name = 'BridgeError';
    this.code = code;
    this.data = data;
  }
}

export class BridgeTimeoutError extends Error {
  readonly path: string[];

  constructor(path: string[], timeoutMs: number) {
    super(`Bridge timeout: ${path.join('.')} did not respond within ${timeoutMs}ms`);
    this.name = 'BridgeTimeoutError';
    this.path = path;
  }
}

export class BridgeValidationError extends Error {
  readonly issues: ReadonlyArray<{ message: string; path?: ReadonlyArray<PropertyKey> }>;

  constructor(
    message: string,
    issues: ReadonlyArray<{ message: string; path?: ReadonlyArray<PropertyKey> }>,
  ) {
    super(message);
    this.name = 'BridgeValidationError';
    this.issues = issues;
  }
}
