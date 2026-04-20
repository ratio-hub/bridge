import { useState } from 'react';
import type { InferClient } from '@ratio-hub/bridge';
import type { nativeContract } from '@ratio-hub/bridge-example-shared';

type NativeClient = InferClient<typeof nativeContract>;

const styles = ['light', 'medium', 'heavy'] as const;

export function HapticDelayedButton({ native }: { native: NativeClient }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<number | null>(null);

  const handleTrigger = async (style: (typeof styles)[number]) => {
    setLoading(true);
    setResult(null);
    try {
      const res = await native.hapticDelayed.trigger({ style });
      setResult(res.triggeredAt);
    } catch (err) {
      console.error('hapticDelayed failed:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2>Haptics (Delayed)</h2>
      <p className="description">
        Procedure: native triggers haptic after 1s delay, responds when done.
      </p>
      <div className="haptic-buttons">
        {styles.map((style) => (
          <button
            key={style}
            onClick={() => handleTrigger(style)}
            disabled={loading}
          >
            {style}
          </button>
        ))}
      </div>
      {loading && <p className="status">Waiting for haptic...</p>}
      {result && (
        <p className="result">
          Triggered at: {new Date(result).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
