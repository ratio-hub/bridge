import type { InferClient } from '@ratio-hub/bridge';
import type { nativeContract } from '@ratio-hub/bridge-example-shared';

type NativeClient = InferClient<typeof nativeContract>;

const styles = ['light', 'medium', 'heavy'] as const;

export function HapticButton({ native }: { native: NativeClient }) {
  return (
    <div className="card">
      <h2>Haptics</h2>
      <p className="description">
        Subscription (fire-and-forget): triggers haptic on native, no response.
      </p>
      <div className="haptic-buttons">
        {styles.map((style) => (
          <button key={style} onClick={() => native.haptic.trigger({ style })}>
            {style}
          </button>
        ))}
      </div>
    </div>
  );
}
