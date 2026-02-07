import { test, expect } from 'bun:test';
import { z } from 'zod';
import { bridge, createBridgeClient, createBridgeHandler, BridgeError, BridgeTimeoutError, BridgeValidationError } from '../index.ts';
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
