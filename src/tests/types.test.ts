import { test, expect } from 'bun:test';
import { z } from 'zod';
import { bridge } from '../index.ts';
import type { InferClient, InferHandlers, InferErrors } from '../types.ts';

// Type-level assertion helpers
type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

// ---- InferErrors ----

test('type: InferErrors produces discriminated union', () => {
  const base = bridge.base().errors({
    notFound: z.object({ message: z.string() }),
    unauthorized: z.object({ reason: z.string() }),
  });

  const proc = base.procedure;

  type Errors = InferErrors<(typeof proc)['~errors']>;

  // Type assertion: should be a union of { code, data }
  type _Check = Expect<Equal<
    Errors,
    | { code: 'notFound'; data: { message: string } }
    | { code: 'unauthorized'; data: { reason: string } }
  >>;

  // Runtime assertion that this compiles
  expect(true).toBe(true);
});

// ---- InferClient ----

test('type: InferClient produces correct procedure signature', () => {
  const base = bridge.base().errors({
    notFound: z.object({ message: z.string() }),
  });

  const contract = {
    auth: {
      login: base.procedure
        .input(z.object({ email: z.string() }))
        .output(z.object({ token: z.string() }))
        .timeout(5000),
    },
  };

  type Client = InferClient<typeof contract>;

  // Verify the nested structure exists
  type _LoginFn = Client['auth']['login'];

  // Verify it's callable
  type _CheckCallable = _LoginFn extends (...args: any[]) => any ? true : false;
  type _Verify = Expect<_CheckCallable>;

  expect(true).toBe(true);
});

test('type: InferClient subscription returns void', () => {
  const base = bridge.base();

  const contract = {
    haptic: base.subscription.input(z.object({ style: z.string() })),
  };

  type Client = InferClient<typeof contract>;

  // Subscription should return void
  type _HapticReturn = ReturnType<Client['haptic']>;
  type _Check = Expect<Equal<_HapticReturn, void>>;

  expect(true).toBe(true);
});

// ---- InferHandlers ----

test('type: InferHandlers produces correct handler signature', () => {
  const base = bridge.base();

  const contract = {
    greet: base.procedure
      .input(z.object({ name: z.string() }))
      .output(z.object({ message: z.string() })),
    events: {
      track: base.subscription.input(z.object({ event: z.string() })),
    },
  };

  type Handlers = InferHandlers<typeof contract>;

  // Procedure handler takes { input } and returns output
  type _GreetHandler = Handlers['greet'];
  type _TrackHandler = Handlers['events']['track'];

  // These should compile without error
  const handlers: Handlers = {
    greet: ({ input }) => {
      const _name: string = input.name;
      return { message: `Hi ${_name}` };
    },
    events: {
      track: ({ input }) => {
        const _event: string = input.event;
      },
    },
  };

  expect(typeof handlers.greet).toBe('function');
  expect(typeof handlers.events.track).toBe('function');
});

// ---- Complex nested contract ----

test('type: deeply nested contract type inference', () => {
  const base = bridge.base().errors({
    notFound: z.object({ message: z.string() }),
  });

  const contract = {
    users: {
      auth: {
        signIn: base.procedure
          .input(z.object({ email: z.string(), password: z.string() }))
          .output(z.object({ token: z.string(), user: z.object({ id: z.string() }) }))
          .timeout(10000),
      },
      profile: {
        get: base.procedure
          .input(z.object({ id: z.string() }))
          .output(z.object({ name: z.string(), email: z.string() }))
          .timeout(5000),
      },
    },
    analytics: {
      track: base.subscription.input(z.object({ event: z.string(), data: z.record(z.unknown()) })),
    },
  };

  type Client = InferClient<typeof contract>;
  type Handlers = InferHandlers<typeof contract>;

  // Deeply nested access should work
  type _SignInFn = Client['users']['auth']['signIn'];
  type _ProfileGetFn = Client['users']['profile']['get'];
  type _TrackFn = Client['analytics']['track'];

  type _SignInHandler = Handlers['users']['auth']['signIn'];
  type _ProfileGetHandler = Handlers['users']['profile']['get'];
  type _TrackHandler = Handlers['analytics']['track'];

  expect(true).toBe(true);
});
