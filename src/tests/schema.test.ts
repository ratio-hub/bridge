import { test, expect } from 'bun:test';
import { z } from 'zod';
import { validate } from '../schema.ts';
import { BridgeValidationError } from '../errors.ts';

test('validate passes valid data through', async () => {
  const schema = z.object({ name: z.string() });
  const result = await validate(schema, { name: 'hello' });
  expect(result).toEqual({ name: 'hello' });
});

test('validate transforms data (coercion)', async () => {
  const schema = z.object({ count: z.coerce.number() });
  const result = await validate(schema, { count: '42' });
  expect(result).toEqual({ count: 42 });
});

test('validate throws BridgeValidationError on invalid data', async () => {
  const schema = z.object({ name: z.string() });
  try {
    await validate(schema, { name: 123 });
    expect.unreachable('should have thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(BridgeValidationError);
    expect((err as BridgeValidationError).issues.length).toBeGreaterThan(0);
  }
});

test('validate throws BridgeValidationError with multiple issues', async () => {
  const schema = z.object({ name: z.string(), age: z.number() });
  try {
    await validate(schema, { name: 123, age: 'not a number' });
    expect.unreachable('should have thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(BridgeValidationError);
    expect((err as BridgeValidationError).issues.length).toBe(2);
  }
});
