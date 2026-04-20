# @ratiojs/bridge

Type-safe cross-WebView messaging with [Standard Schema](https://github.com/standard-schema/standard-schema) validation.

Define a contract, implement handlers on one side, and call them from the other — with full TypeScript inference for inputs, outputs, and errors. Works across React Native WebViews, iframes, or any custom transport.

## Install

```bash
npm install @ratiojs/bridge
```

## Quick Start

### 1. Define a contract

```ts
import { bridge } from '@ratiojs/bridge';
import { z } from 'zod';

const contract = {
  greet: bridge
    .base()
    .procedure.input(z.object({ name: z.string() }))
    .output(z.object({ message: z.string() }))
    .timeout(5000),
};
```

### 2. Create a handler (responder side)

```ts
import { createBridgeHandler } from '@ratiojs/bridge';

const handler = createBridgeHandler(
  contract,
  {
    greet: ({ input }) => ({
      message: `Hello, ${input.name}!`,
    }),
  },
  (data) => transport.send(data),
);

transport.subscribe((data) => handler.handleMessage(data));
```

### 3. Create a client (caller side)

```ts
import { createBridgeClient } from '@ratiojs/bridge';

const client = createBridgeClient(contract, transport);

const result = await client.greet({ name: 'World' });
// result.message → "Hello, World!"
```

## Contracts

Contracts define the shape of your API. Build them with `bridge.base()`:

```ts
import { bridge } from '@ratiojs/bridge';

const contract = {
  // Procedures: request → response
  getUser: bridge.base()
    .procedure
    .input(z.object({ id: z.string() }))
    .output(z.object({ name: z.string(), email: z.string() }))
    .timeout(5000),

  // Subscriptions: fire-and-forget messages
  onButtonPress: bridge.base()
    .subscription
    .input(z.object({ buttonId: z.string() })),

  // Nested namespaces
  auth: {
    login: bridge.base()
      .procedure
      .input(z.object({ token: z.string() }))
      .output(z.object({ success: z.boolean() })),
  },
};
```

### Shared errors

Use `.errors()` to define typed error codes before creating procedures:

```ts
const base = bridge.base().errors({
  UNAUTHORIZED: z.object({ reason: z.string() }),
  NOT_FOUND: z.object({ id: z.string() }),
});

const contract = {
  getUser: base.procedure
    .input(z.object({ id: z.string() }))
    .output(z.object({ name: z.string() })),
};
```

Any schema library implementing [Standard Schema](https://github.com/standard-schema/standard-schema) (Zod, Valibot, ArkType, etc.) works as an input/output schema.

## React Hooks (Web)

For the web side of a WebView bridge:

```tsx
import { useBridgeClient, useBridgeHandler } from '@ratiojs/bridge/react';

// As a client (calling native)
function App() {
  const client = useBridgeClient({ contract });
  // client.greet({ name: 'World' }) → Promise<{ message: string }>
}

// As a handler (responding to native)
function App() {
  useBridgeHandler({
    contract,
    handlers: {
      onButtonPress: ({ input }) => {
        console.log('Button pressed:', input.buttonId);
      },
    },
  });
}
```

The web hooks default to `webViewTransport()` (uses `window.ReactNativeWebView.postMessage` and listens for `message` events on both `window` and `document` so the same code works on iOS and Android RN WebViews). Pass a `transport` field to override.

Notes (3.0+):
- Hooks accept param objects — `useBridgeClient({ contract, transport? })`, `useBridgeHandler({ contract, handlers, transport? })`.
- `handlers` is wrapped in a ref-stable proxy, so inline handler objects don't re-subscribe every render.
- The client is lazy-init'd in a ref so it survives React 18+ StrictMode's synchronous effect cleanup-then-remount. There's no auto-dispose on unmount.

## React Native Hooks

For the React Native side:

```tsx
import { WebView } from 'react-native-webview';
import {
  useBridge,
  useBridgeClient,
  useBridgeHandler,
} from '@ratiojs/bridge/react-native';

function Screen() {
  const webViewRef = useRef<WebView>(null);
  const { transport, dispatch } = useBridge({
    send: (data) => webViewRef.current?.postMessage(data),
  });

  useBridgeHandler({ contract, transport, handlers });
  const client = useBridgeClient({ contract, transport });

  return (
    <WebView
      ref={webViewRef}
      source={{ uri: 'https://...' }}
      onMessage={(e) => dispatch(e.nativeEvent.data)}
    />
  );
}
```

`useBridge` creates a transport + dispatch pair. Wire `dispatch` to `onMessage` and the transport handles the rest.

## Error Handling

Handlers throw `BridgeError` to send typed errors back to the client:

```ts
import { BridgeError } from '@ratiojs/bridge';

const handler = createBridgeHandler(contract, {
  getUser: ({ input }) => {
    throw new BridgeError('NOT_FOUND', { id: input.id });
  },
});
```

Clients can catch errors or handle them with `onError`:

```ts
// Throws BridgeError if no onError callback
try {
  await client.getUser({ id: '123' });
} catch (err) {
  if (err instanceof BridgeError) {
    console.log(err.code, err.data);
  }
}

// Or handle gracefully — return type becomes T | undefined
const user = await client.getUser({ id: '123' }, {
  onError: (err) => console.log(err.code, err.data),
});
```

Error classes:

- **`BridgeError`** — application-level error with `code` and `data`
- **`BridgeTimeoutError`** — procedure didn't respond within the timeout
- **`BridgeValidationError`** — input/output schema validation failed

## Custom Transport

Implement the `BridgeTransport` interface to use any messaging channel:

```ts
import type { BridgeTransport } from '@ratiojs/bridge';

const wsTransport: BridgeTransport = {
  send(data: string) {
    ws.send(data);
  },
  subscribe(handler: (data: string) => void) {
    ws.addEventListener('message', (e) => handler(e.data));
    return () => ws.removeEventListener('message', handler);
  },
};
```

Built-in transports:

- **`webViewTransport()`** — for web code inside a React Native WebView. Listens on both `window` (iOS) and `document` (Android) so the same code runs on either platform without detection.
- **`iframeTransport(target, origin?)`** — for cross-iframe communication.

Both built-ins are SSR-safe: every `window`/`document` access is guarded by `isClient()` (a `typeof window` check), so importing them on the server is a no-op rather than a `ReferenceError`. `isClient` is exported at the package root for consumers that need the same check.

## API Reference

### Core

| Export | Description |
|--------|-------------|
| `bridge` | Entry point — `bridge.base()` starts a contract builder |
| `createBridgeClient(contract, transport)` | Creates a typed client proxy |
| `createBridgeHandler(contract, handlers, send)` | Creates a message handler |
| `BridgeError` | Application error with `code` + `data` |
| `BridgeTimeoutError` | Timeout error with `path` |
| `BridgeValidationError` | Validation error with `issues` |
| `SubscriptionQueue` | FIFO queue for subscription processing |
| `validate(schema, value)` | Standard Schema validation helper |
| `webViewTransport()` | WebView ↔ React Native transport (iOS + Android) |
| `iframeTransport(target, origin?)` | iframe ↔ parent transport |
| `isClient()` | `typeof window !== 'undefined'` — SSR-safe check |

### Types

| Export | Description |
|--------|-------------|
| `BridgeTransport` | Transport interface (`send` + `subscribe`) |
| `InferClient<T>` | Infer client type from contract |
| `InferHandlers<T>` | Infer handler type from contract |
| `InferInput<T>` | Infer input type from Standard Schema |
| `InferOutput<T>` | Infer output type from Standard Schema |
| `InferErrors<T>` | Infer error union from contract errors |
| `ContractTree` | Contract object type |
| `StandardSchemaV1` | Standard Schema V1 interface |
| `BridgeMessage` | Union of all wire message types |

### React Hooks (`@ratiojs/bridge/react`)

| Export | Description |
|--------|-------------|
| `useBridgeClient({ contract, transport? })` | Lazy-init'd client (defaults to `webViewTransport`) |
| `useBridgeHandler({ contract, handlers, transport? })` | Subscribe and handle messages; ref-stable handler proxy |

### React Native Hooks (`@ratiojs/bridge/react-native`)

| Export | Description |
|--------|-------------|
| `useBridge({ send })` | Creates `{ transport, dispatch }` for WebView wiring |
| `useBridgeClient({ contract, transport })` | Lazy-init'd client |
| `useBridgeHandler({ contract, handlers, transport })` | Subscribe and handle messages; ref-stable handler proxy |

## License

MIT
