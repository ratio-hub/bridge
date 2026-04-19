import { useCallback, useMemo, useState } from 'react';
import { useBridgeClient, useBridgeHandler } from '@ratiojs/bridge/react';
import { nativeContract, webContract } from '@ratiojs/bridge-example-shared';
import type { InferHandlers } from '@ratiojs/bridge';
import { Counter } from './components/Counter';
import { DeviceInfo } from './components/DeviceInfo';
import { HapticButton } from './components/HapticButton';
import { HapticDelayedButton } from './components/HapticDelayedButton';
import { ModalDemo } from './components/ModalDemo';
import { ModalTimeoutDemo } from './components/ModalTimeoutDemo';
import { TabsDemo } from './components/TabsDemo';
import { ErrorDemo } from './components/ErrorDemo';
import {
  NotificationBanner,
  type Notification,
} from './components/NotificationBanner';
import './App.css';

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(data: string): void };
  }
}

let notifId = 0;

export default function App() {
  const native = useBridgeClient({ contract: nativeContract });
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const dismissNotification = useCallback((id: number) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const webHandlers: InferHandlers<typeof webContract> = useMemo(
    () => ({
      theme: {
        get: () => {
          const isDark = window.matchMedia(
            '(prefers-color-scheme: dark)',
          ).matches;
          return {
            mode: isDark ? ('dark' as const) : ('light' as const),
            primaryColor: '#646cff',
          };
        },
      },
      notification: {
        show: ({ input }) => {
          const id = ++notifId;
          setNotifications((prev) => [
            ...prev,
            { id, title: input.title, message: input.message },
          ]);
          setTimeout(() => dismissNotification(id), 3000);
        },
      },
    }),
    [dismissNotification],
  );

  useBridgeHandler({ contract: webContract, handlers: webHandlers });

  return (
    <div className="app">
      <NotificationBanner notifications={notifications} />
      <h1>@ratiojs/bridge demo</h1>
      <DeviceInfo native={native} />
      <Counter native={native} />
      <TabsDemo native={native} />
      <HapticButton native={native} />
      <HapticDelayedButton native={native} />
      <ModalDemo native={native} />
      <ModalTimeoutDemo native={native} />
      <ErrorDemo native={native} />
    </div>
  );
}
