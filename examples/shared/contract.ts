import { bridge } from '@ratiojs/bridge';
import { z } from 'zod';

const b = bridge.base();
const bWithErrors = bridge.base().errors({
  OPERATION_FAILED: z.object({ message: z.string(), code: z.number() }),
});

/**
 * Contract for procedures/subscriptions handled by the native side.
 * The web app calls these via `createBridgeClient(nativeContract, transport)`.
 */
export const nativeContract = {
  device: {
    getInfo: b.procedure
      .output(
        z.object({
          platform: z.enum(['ios', 'android']),
          osVersion: z.string(),
          appVersion: z.string(),
          deviceName: z.string(),
        }),
      )
      .timeout(5000),
  },
  modal: {
    open: b.procedure
      .output(z.object({ result: z.string() }))
      .timeout(30000),
  },
  modalTimeout: {
    open: b.procedure
      .output(z.object({ result: z.string() }))
      .timeout(1000),
  },
  haptic: {
    trigger: b.subscription.input(
      z.object({
        style: z.enum(['light', 'medium', 'heavy']),
      }),
    ),
  },
  hapticDelayed: {
    trigger: b.procedure
      .input(
        z.object({
          style: z.enum(['light', 'medium', 'heavy']),
        }),
      )
      .output(z.object({ triggeredAt: z.number() }))
      .timeout(5000),
  },
  tabs: {
    change: b.procedure
      .input(z.object({ tab: z.enum(['home', 'settings']) }))
      .output(z.object({ activeTab: z.enum(['home', 'settings']) }))
      .timeout(5000),
  },
  counter: {
    increment: b.procedure
      .output(z.object({ value: z.number() }))
      .timeout(5000),
    decrement: b.procedure
      .output(z.object({ value: z.number() }))
      .timeout(5000),
  },
  error: {
    trigger: bWithErrors.procedure
      .input(z.object({ shouldFail: z.boolean() }))
      .output(z.object({ success: z.boolean() }))
      .timeout(5000),
  },
};

/**
 * Contract for procedures/subscriptions handled by the web side.
 * The native app calls these via `createBridgeClient(webContract, transport)`.
 */
export const webContract = {
  theme: {
    get: b.procedure.output(
      z.object({
        mode: z.enum(['light', 'dark']),
        primaryColor: z.string(),
      }),
    ),
  },
  notification: {
    show: b.subscription.input(
      z.object({
        title: z.string(),
        message: z.string(),
      }),
    ),
  },
};
