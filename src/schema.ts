import type { StandardSchemaV1 } from './types.ts';
import { BridgeValidationError } from './errors.ts';

function normalizePath(
  path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined,
): ReadonlyArray<PropertyKey> | undefined {
  if (!path) return undefined;
  return path.map((segment) =>
    typeof segment === 'object' && segment !== null && 'key' in segment
      ? segment.key
      : (segment as PropertyKey),
  );
}

export async function validate<T>(
  schema: StandardSchemaV1<unknown, T>,
  value: unknown,
): Promise<T> {
  const result = await schema['~standard'].validate(value);
  if (result.issues) {
    const issues = result.issues.map((issue) => ({
      message: issue.message,
      path: normalizePath(issue.path),
    }));
    throw new BridgeValidationError(
      `Validation failed: ${issues.map((i) => i.message).join(', ')}`,
      issues,
    );
  }
  return result.value;
}
