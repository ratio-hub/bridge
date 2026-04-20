import type { StandardSchemaV1 } from './types.ts';
import { BridgeValidationError } from './errors.ts';

export async function validate<T>(
  schema: StandardSchemaV1<unknown, T>,
  value: unknown,
): Promise<T> {
  const result = await schema['~standard'].validate(value);
  if (result.issues) {
    const issues = result.issues.map((issue) => ({
      message: issue.message,
      path: issue.path?.map((p) =>
        typeof p === 'object' && p !== null && 'key' in p ? p.key : p,
      ),
    }));
    throw new BridgeValidationError(
      `Validation failed: ${issues.map((i) => i.message).join(', ')}`,
      issues,
    );
  }
  return result.value;
}
