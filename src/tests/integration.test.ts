import { test, expect } from 'bun:test';
import { z } from 'zod';
import {
  bridge,
  createBridgeClient,
  createBridgeHandler,
  dispose,
  isProcedureNode,
  isSubscriptionNode,
  BridgeError,
  BridgeTimeoutError,
  BridgeValidationError,
} from '../index.ts';
import type { BridgeTransport } from '../transport.ts';

// Mock transport: connects two sides via in-memory message passing
function createMockTransportPair(): [BridgeTransport, BridgeTransport] {
  const listenersA: Set<(data: string) => void> = new Set();
  const listenersB: Set<(data: string) => void> = new Set();

  const transportA: BridgeTransport = {
    send(data: string) {
      // A sends → B receives
      for (const listener of listenersB) listener(data);
    },
    subscribe(handler: (data: string) => void) {
      listenersA.add(handler);
      return () => listenersA.delete(handler);
    },
  };

  const transportB: BridgeTransport = {
    send(data: string) {
      // B sends → A receives
      for (const listener of listenersA) listener(data);
    },
    subscribe(handler: (data: string) => void) {
      listenersB.add(handler);
      return () => listenersB.delete(handler);
    },
  };

  return [transportA, transportB];
}

// ---- Procedure round-trip ----

test('procedure round-trip: request → handler → response', async () => {
  const base = bridge.base();
  const contract = {
    greet: base.procedure
      .input(z.object({ name: z.string() }))
      .output(z.object({ message: z.string() }))
      .timeout(5000),
  };

  const [clientTransport, handlerTransport] = createMockTransportPair();

  const handler = createBridgeHandler(contract, {
    greet: ({ input }) => ({ message: `Hello, ${input.name}!` }),
  }, (data) => handlerTransport.send(data));

  handlerTransport.subscribe((data) => handler.handleMessage(data));

  const client = createBridgeClient(contract, clientTransport);

  const result = await client.greet({ name: 'World' });
  expect(result).toEqual({ message: 'Hello, World!' });
});

// ---- Nested contract ----

test('nested contract paths work correctly', async () => {
  const base = bridge.base();
  const contract = {
    auth: {
      login: base.procedure
        .input(z.object({ email: z.string() }))
        .output(z.object({ token: z.string() }))
        .timeout(5000),
    },
  };

  const [clientTransport, handlerTransport] = createMockTransportPair();

  const handler = createBridgeHandler(contract, {
    auth: {
      login: ({ input }) => ({ token: `token_for_${input.email}` }),
    },
  }, (data) => handlerTransport.send(data));

  handlerTransport.subscribe((data) => handler.handleMessage(data));

  const client = createBridgeClient(contract, clientTransport);

  const result = await client.auth.login({ email: 'test@example.com' });
  expect(result).toEqual({ token: 'token_for_test@example.com' });
});

// ---- Async handler ----

test('async handler works correctly', async () => {
  const base = bridge.base();
  const contract = {
    slowOp: base.procedure
      .input(z.object({ delay: z.number() }))
      .output(z.object({ done: z.boolean() }))
      .timeout(5000),
  };

  const [clientTransport, handlerTransport] = createMockTransportPair();

  const handler = createBridgeHandler(contract, {
    slowOp: async ({ input }) => {
      await new Promise((r) => setTimeout(r, input.delay));
      return { done: true };
    },
  }, (data) => handlerTransport.send(data));

  handlerTransport.subscribe((data) => handler.handleMessage(data));

  const client = createBridgeClient(contract, clientTransport);

  const result = await client.slowOp({ delay: 10 });
  expect(result).toEqual({ done: true });
});

// ---- Subscription fire-and-forget ----

test('subscription fire-and-forget with queue ordering', async () => {
  const base = bridge.base();
  const contract = {
    events: {
      track: base.subscription.input(z.object({ event: z.string() })),
    },
  };

  const [clientTransport, handlerTransport] = createMockTransportPair();

  const received: string[] = [];
  const handler = createBridgeHandler(contract, {
    events: {
      track: async ({ input }) => {
        // Add slight delay to test queue ordering
        await new Promise((r) => setTimeout(r, 5));
        received.push(input.event);
      },
    },
  }, (data) => handlerTransport.send(data));

  handlerTransport.subscribe((data) => handler.handleMessage(data));

  const client = createBridgeClient(contract, clientTransport);

  client.events.track({ event: 'page_view' });
  client.events.track({ event: 'click' });
  client.events.track({ event: 'scroll' });

  // Wait for queue to process
  await new Promise((r) => setTimeout(r, 100));
  expect(received).toEqual(['page_view', 'click', 'scroll']);
});

// ---- Timeout behavior ----

test('procedure timeout rejects with BridgeTimeoutError', async () => {
  const base = bridge.base();
  const contract = {
    slow: base.procedure
      .input(z.object({ x: z.number() }))
      .output(z.object({ y: z.number() }))
      .timeout(50), // very short timeout
  };

  const [clientTransport, _handlerTransport] = createMockTransportPair();
  // No handler connected — will timeout

  const client = createBridgeClient(contract, clientTransport);

  try {
    await client.slow({ x: 1 });
    expect.unreachable('should have thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(BridgeTimeoutError);
    expect((err as BridgeTimeoutError).path).toEqual(['slow']);
  }
});

// ---- BridgeError propagation ----

test('BridgeError propagates from handler to client', async () => {
  const base = bridge.base().errors({
    notFound: z.object({ message: z.string() }),
  });

  const contract = {
    findUser: base.procedure
      .input(z.object({ id: z.string() }))
      .output(z.object({ name: z.string() }))
      .timeout(5000),
  };

  const [clientTransport, handlerTransport] = createMockTransportPair();

  const handler = createBridgeHandler(contract, {
    findUser: ({ input }) => {
      throw new BridgeError('notFound', { message: `User ${input.id} not found` });
    },
  }, (data) => handlerTransport.send(data));

  handlerTransport.subscribe((data) => handler.handleMessage(data));

  const client = createBridgeClient(contract, clientTransport);

  // Without onError — rejects
  try {
    await client.findUser({ id: '123' });
    expect.unreachable('should have thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(BridgeError);
    expect((err as BridgeError).code).toBe('notFound');
    expect((err as BridgeError).data).toEqual({ message: 'User 123 not found' });
  }
});

test('BridgeError with onError calls handler and resolves undefined', async () => {
  const base = bridge.base().errors({
    notFound: z.object({ message: z.string() }),
  });

  const contract = {
    findUser: base.procedure
      .input(z.object({ id: z.string() }))
      .output(z.object({ name: z.string() }))
      .timeout(5000),
  };

  const [clientTransport, handlerTransport] = createMockTransportPair();

  const handler = createBridgeHandler(contract, {
    findUser: () => {
      throw new BridgeError('notFound', { message: 'not found' });
    },
  }, (data) => handlerTransport.send(data));

  handlerTransport.subscribe((data) => handler.handleMessage(data));

  const client = createBridgeClient(contract, clientTransport);

  let capturedError: any = null;
  const result = await client.findUser(
    { id: '123' },
    {
      onError(error) {
        capturedError = error;
      },
    },
  );

  expect(result).toBeUndefined();
  expect(capturedError).toEqual({ code: 'notFound', data: { message: 'not found' } });
});

// ---- Input validation on client side ----

test('client validates input before sending', async () => {
  const base = bridge.base();
  const contract = {
    greet: base.procedure
      .input(z.object({ name: z.string() }))
      .output(z.object({ message: z.string() }))
      .timeout(5000),
  };

  const [clientTransport, _handlerTransport] = createMockTransportPair();
  const client = createBridgeClient(contract, clientTransport);

  try {
    await client.greet({ name: 123 as any });
    expect.unreachable('should have thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(BridgeValidationError);
  }
});

// ---- Handler validates input ----

test('handler validates input and sends validation error', async () => {
  const base = bridge.base();
  const contract = {
    greet: base.procedure
      .input(z.object({ name: z.string() }))
      .output(z.object({ message: z.string() }))
      .timeout(5000),
  };

  const [clientTransport, handlerTransport] = createMockTransportPair();

  const handler = createBridgeHandler(contract, {
    greet: ({ input }) => ({ message: `Hello, ${input.name}!` }),
  }, (data) => handlerTransport.send(data));

  handlerTransport.subscribe((data) => handler.handleMessage(data));

  // Bypass client validation by sending raw message
  const responsePromise = new Promise<any>((resolve) => {
    clientTransport.subscribe((data) => resolve(JSON.parse(data)));
  });

  clientTransport.send(JSON.stringify({
    __bridge: 1,
    id: 'test_1',
    type: 'request',
    kind: 'procedure',
    path: ['greet'],
    input: { name: 42 }, // invalid
  }));

  const response = await responsePromise;
  expect(response.type).toBe('error');
  expect(response.error.code).toBe('VALIDATION_ERROR');
});

// ---- Bidirectional test ----

test('bidirectional: two contracts, two directions', async () => {
  const base = bridge.base();

  // Contract A: native handles these
  const nativeContract = {
    native: {
      getToken: base.procedure
        .output(z.object({ token: z.string() }))
        .timeout(5000),
    },
  };

  // Contract B: web handles these
  const webContract = {
    web: {
      getTheme: base.procedure
        .output(z.object({ mode: z.string() }))
        .timeout(5000),
    },
  };

  const [transportA, transportB] = createMockTransportPair();

  // Side A: handles nativeContract, calls webContract
  const handlerA = createBridgeHandler(nativeContract, {
    native: {
      getToken: () => ({ token: 'abc123' }),
    },
  }, (data) => transportA.send(data));

  transportA.subscribe((data) => handlerA.handleMessage(data));
  const clientA = createBridgeClient(webContract, transportA);

  // Side B: handles webContract, calls nativeContract
  const handlerB = createBridgeHandler(webContract, {
    web: {
      getTheme: () => ({ mode: 'dark' }),
    },
  }, (data) => transportB.send(data));

  transportB.subscribe((data) => handlerB.handleMessage(data));
  const clientB = createBridgeClient(nativeContract, transportB);

  // B calls A
  const tokenResult = await clientB.native.getToken({} as any);
  expect(tokenResult).toEqual({ token: 'abc123' });

  // A calls B
  const themeResult = await clientA.web.getTheme({} as any);
  expect(themeResult).toEqual({ mode: 'dark' });
});

// ---- Non-bridge messages are ignored ----

test('non-bridge messages are ignored', () => {
  const base = bridge.base();
  const contract = {
    greet: base.procedure
      .input(z.object({ name: z.string() }))
      .output(z.object({ message: z.string() }))
      .timeout(5000),
  };

  const [_clientTransport, handlerTransport] = createMockTransportPair();

  const handler = createBridgeHandler(contract, {
    greet: ({ input }) => ({ message: `Hello, ${input.name}!` }),
  }, (data) => handlerTransport.send(data));

  // These should not throw
  handler.handleMessage('not json');
  handler.handleMessage(JSON.stringify({ foo: 'bar' }));
  handler.handleMessage(JSON.stringify({ __bridge: 2, id: '1', type: 'request' }));
});

// ---- Procedure without input/output schemas ----

test('procedure without input schema works', async () => {
  const base = bridge.base();
  const contract = {
    ping: base.procedure
      .output(z.object({ pong: z.boolean() }))
      .timeout(5000),
  };

  const [clientTransport, handlerTransport] = createMockTransportPair();

  const handler = createBridgeHandler(contract, {
    ping: () => ({ pong: true }),
  }, (data) => handlerTransport.send(data));

  handlerTransport.subscribe((data) => handler.handleMessage(data));

  const client = createBridgeClient(contract, clientTransport);

  const result = await client.ping(undefined as any);
  expect(result).toEqual({ pong: true });
});

// ---- Multiple concurrent procedures ----

test('multiple concurrent procedure calls resolve independently', async () => {
  const base = bridge.base();
  const contract = {
    echo: base.procedure
      .input(z.object({ value: z.number() }))
      .output(z.object({ value: z.number() }))
      .timeout(5000),
  };

  const [clientTransport, handlerTransport] = createMockTransportPair();

  const handler = createBridgeHandler(contract, {
    echo: async ({ input }) => {
      // Add varying delay to test independence
      await new Promise((r) => setTimeout(r, Math.random() * 20));
      return { value: input.value * 2 };
    },
  }, (data) => handlerTransport.send(data));

  handlerTransport.subscribe((data) => handler.handleMessage(data));

  const client = createBridgeClient(contract, clientTransport);

  const results = await Promise.all([
    client.echo({ value: 1 }),
    client.echo({ value: 2 }),
    client.echo({ value: 3 }),
  ]);

  expect(results).toEqual([
    { value: 2 },
    { value: 4 },
    { value: 6 },
  ]);
});

// ---- Subscription input validation surfaces (no longer silently swallowed) ----

test('subscription input validation errors are surfaced via onSubscriptionError', async () => {
  const base = bridge.base();
  const contract = {
    track: base.subscription.input(z.object({ event: z.string() })),
  };

  const [clientTransport, _handlerTransport] = createMockTransportPair();

  let captured: { err: BridgeValidationError; path: string[] } | null = null;
  const client = createBridgeClient(contract, clientTransport, {
    onSubscriptionError: (err, path) => {
      captured = { err, path };
    },
  });

  client.track({ event: 42 as any });

  // Validation happens in a microtask
  await new Promise((r) => setTimeout(r, 5));

  expect(captured).not.toBeNull();
  expect(captured!.path).toEqual(['track']);
  expect(captured!.err).toBeInstanceOf(BridgeValidationError);
});

// ---- Client-side output validation ----

test('validateOutput: client rejects when response does not match output schema', async () => {
  const base = bridge.base();
  const contract = {
    getUser: base.procedure
      .input(z.object({ id: z.string() }))
      .output(z.object({ name: z.string() }))
      .timeout(5000),
  };

  const [clientTransport, handlerTransport] = createMockTransportPair();

  // Rogue "handler" that returns a malformed response by bypassing createBridgeHandler.
  handlerTransport.subscribe((raw) => {
    const msg = JSON.parse(raw);
    if (msg.type !== 'request') return;
    handlerTransport.send(
      JSON.stringify({
        __bridge: 1,
        id: msg.id,
        type: 'response',
        output: { name: 123 }, // wrong type
      }),
    );
  });

  const client = createBridgeClient(contract, clientTransport, { validateOutput: true });

  try {
    await client.getUser({ id: '1' });
    expect.unreachable('should have thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(BridgeValidationError);
  }
});

test('validateOutput: when disabled, client trusts the response', async () => {
  const base = bridge.base();
  const contract = {
    getUser: base.procedure
      .input(z.object({ id: z.string() }))
      .output(z.object({ name: z.string() }))
      .timeout(5000),
  };

  const [clientTransport, handlerTransport] = createMockTransportPair();

  handlerTransport.subscribe((raw) => {
    const msg = JSON.parse(raw);
    if (msg.type !== 'request') return;
    handlerTransport.send(
      JSON.stringify({
        __bridge: 1,
        id: msg.id,
        type: 'response',
        output: { name: 123 }, // wrong type, but not validated
      }),
    );
  });

  const client = createBridgeClient(contract, clientTransport);
  const result = await client.getUser({ id: '1' });
  expect(result).toEqual({ name: 123 } as any);
});

// ---- BridgeTimeoutError preserves timeoutMs ----

test('BridgeTimeoutError exposes timeoutMs', async () => {
  const base = bridge.base();
  const contract = {
    slow: base.procedure
      .input(z.object({ x: z.number() }))
      .output(z.object({ y: z.number() }))
      .timeout(42),
  };

  const [clientTransport] = createMockTransportPair();
  const client = createBridgeClient(contract, clientTransport);

  try {
    await client.slow({ x: 1 });
    expect.unreachable('should have thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(BridgeTimeoutError);
    expect((err as BridgeTimeoutError).timeoutMs).toBe(42);
    expect((err as BridgeTimeoutError).path).toEqual(['slow']);
  }
});

// ---- Request IDs are unique across many calls ----

test('generated request IDs are unique', async () => {
  const base = bridge.base();
  const contract = {
    echo: base.procedure
      .input(z.object({ value: z.number() }))
      .output(z.object({ value: z.number() }))
      .timeout(5000),
  };

  const [clientTransport, handlerTransport] = createMockTransportPair();

  const seenIds = new Set<string>();
  handlerTransport.subscribe((raw) => {
    const msg = JSON.parse(raw);
    if (msg.type !== 'request') return;
    seenIds.add(msg.id);
    handlerTransport.send(
      JSON.stringify({
        __bridge: 1,
        id: msg.id,
        type: 'response',
        output: { value: msg.input.value },
      }),
    );
  });

  const client = createBridgeClient(contract, clientTransport);

  const calls = Array.from({ length: 200 }, (_, i) => client.echo({ value: i }));
  await Promise.all(calls);

  expect(seenIds.size).toBe(200);
});

// ---- dispose() cleanup ----

test('dispose() unsubscribes the transport and rejects pending calls', async () => {
  const base = bridge.base();
  const contract = {
    slow: base.procedure
      .input(z.object({ x: z.number() }))
      .output(z.object({ x: z.number() }))
      .timeout(5000),
  };

  const [clientTransport, handlerTransport] = createMockTransportPair();

  // Intentionally never respond
  let receivedCount = 0;
  const unsubscribe = handlerTransport.subscribe(() => {
    receivedCount += 1;
  });

  const client = createBridgeClient(contract, clientTransport);

  const pending = client.slow({ x: 1 });
  // Give the message a tick to propagate
  await new Promise((r) => setTimeout(r, 5));
  expect(receivedCount).toBe(1);

  dispose(client);

  // Pending call should reject
  await expect(pending).rejects.toBeInstanceOf(BridgeError);

  // After dispose, further messages to the client transport should no longer
  // reach any client-side listener — verify by sending a bogus response that
  // would otherwise be picked up.
  handlerTransport.send(
    JSON.stringify({
      __bridge: 1,
      id: 'nonexistent',
      type: 'response',
      output: {},
    }),
  );
  // No assertion needed — we're just confirming no crash / no unhandled rejection.

  unsubscribe();
});

test('dispose() is idempotent', () => {
  const base = bridge.base();
  const contract = {
    ping: base.procedure.output(z.object({ ok: z.boolean() })),
  };
  const [clientTransport] = createMockTransportPair();
  const client = createBridgeClient(contract, clientTransport);

  expect(() => {
    dispose(client);
    dispose(client);
  }).not.toThrow();
});

// ---- kind/contract-type mismatch guard ----

test('handler rejects procedure request against a subscription contract node', async () => {
  const base = bridge.base();
  const contract = {
    notify: base.subscription.input(z.object({ msg: z.string() })),
  };

  const [clientTransport, handlerTransport] = createMockTransportPair();

  const handler = createBridgeHandler(
    contract,
    {
      notify: () => {},
    },
    (data) => handlerTransport.send(data),
  );
  handlerTransport.subscribe((data) => handler.handleMessage(data));

  // Capture the error response
  const errorPromise = new Promise<unknown>((resolve) => {
    clientTransport.subscribe((raw) => {
      const parsed = JSON.parse(raw);
      if (parsed.type === 'error') resolve(parsed);
    });
  });

  // Manually send a procedure request to a subscription path
  clientTransport.send(
    JSON.stringify({
      __bridge: 1,
      id: 'test-mismatch',
      type: 'request',
      kind: 'procedure',
      path: ['notify'],
      input: { msg: 'hi' },
    }),
  );

  const err = (await errorPromise) as { error: { code: string } };
  expect(err.error.code).toBe('KIND_MISMATCH');
});

// ---- subscription handler-side validation logs warning ----

test('handler warns when subscription input validation fails', async () => {
  const base = bridge.base();
  const contract = {
    notify: base.subscription.input(z.object({ msg: z.string() })),
  };

  const [clientTransport, handlerTransport] = createMockTransportPair();
  let called = false;
  const handler = createBridgeHandler(
    contract,
    {
      notify: () => {
        called = true;
      },
    },
    (data) => handlerTransport.send(data),
  );
  handlerTransport.subscribe((data) => handler.handleMessage(data));

  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    // Send a subscription with an invalid input (number instead of string)
    clientTransport.send(
      JSON.stringify({
        __bridge: 1,
        id: 'sub-invalid',
        type: 'request',
        kind: 'subscription',
        path: ['notify'],
        input: { msg: 42 },
      }),
    );
    await new Promise((r) => setTimeout(r, 10));

    expect(called).toBe(false);
    expect(warnings.length).toBeGreaterThan(0);
    expect(String(warnings[0]?.[0])).toContain('Subscription');
  } finally {
    console.warn = originalWarn;
  }
});

// ---- isProcedureNode / isSubscriptionNode guards ----

test('isProcedureNode / isSubscriptionNode narrow contract nodes correctly', () => {
  const base = bridge.base();
  const proc = base.procedure
    .input(z.object({ x: z.number() }))
    .output(z.object({ x: z.number() }));
  const sub = base.subscription.input(z.object({ msg: z.string() }));

  expect(isProcedureNode(proc)).toBe(true);
  expect(isSubscriptionNode(proc)).toBe(false);

  expect(isSubscriptionNode(sub)).toBe(true);
  expect(isProcedureNode(sub)).toBe(false);

  // Non-nodes
  expect(isProcedureNode({})).toBe(false);
  expect(isSubscriptionNode({})).toBe(false);
  expect(isProcedureNode(null)).toBe(false);
  expect(isSubscriptionNode(undefined)).toBe(false);
});
