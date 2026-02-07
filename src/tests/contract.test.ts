import { test, expect } from 'bun:test';
import { z } from 'zod';
import { bridge } from '../index.ts';
import { PROCEDURE_TYPE, PROCEDURE_INPUT, PROCEDURE_OUTPUT, PROCEDURE_ERRORS, PROCEDURE_TIMEOUT } from '../types.ts';

test('bridge.base() creates a BaseBuilder', () => {
  const base = bridge.base();
  expect(base).toBeDefined();
  expect(base.procedure).toBeDefined();
  expect(base.subscription).toBeDefined();
});

test('base.errors() merges error schemas', () => {
  const base = bridge.base().errors({
    notFound: z.object({ message: z.string() }),
  });
  const proc = base.procedure;
  expect(proc[PROCEDURE_ERRORS]).toHaveProperty('notFound');
});

test('ProcedureDef builder is immutable', () => {
  const base = bridge.base();
  const p1 = base.procedure;
  const p2 = p1.input(z.object({ name: z.string() }));
  const p3 = p2.output(z.object({ id: z.number() }));
  const p4 = p3.timeout(5000);

  // Each step returns a new instance
  expect(p1).not.toBe(p2);
  expect(p2).not.toBe(p3);
  expect(p3).not.toBe(p4);

  // Original is unchanged
  expect(p1[PROCEDURE_INPUT]).toBeUndefined();
  expect(p1[PROCEDURE_OUTPUT]).toBeUndefined();
  expect(p1[PROCEDURE_TIMEOUT]).toBeUndefined();

  // Final has all fields
  expect(p4[PROCEDURE_TYPE]).toBe('procedure');
  expect(p4[PROCEDURE_INPUT]).toBeDefined();
  expect(p4[PROCEDURE_OUTPUT]).toBeDefined();
  expect(p4[PROCEDURE_TIMEOUT]).toBe(5000);
});

test('SubscriptionDef builder is immutable', () => {
  const base = bridge.base();
  const s1 = base.subscription;
  const s2 = s1.input(z.object({ event: z.string() }));

  expect(s1).not.toBe(s2);
  expect(s1[PROCEDURE_INPUT]).toBeUndefined();
  expect(s2[PROCEDURE_TYPE]).toBe('subscription');
  expect(s2[PROCEDURE_INPUT]).toBeDefined();
});

test('errors are inherited by procedure and subscription', () => {
  const base = bridge.base().errors({
    unauthorized: z.object({ reason: z.string() }),
  });

  const proc = base.procedure;
  const sub = base.subscription;

  expect(proc[PROCEDURE_ERRORS]).toHaveProperty('unauthorized');
  expect(sub[PROCEDURE_ERRORS]).toHaveProperty('unauthorized');
});
