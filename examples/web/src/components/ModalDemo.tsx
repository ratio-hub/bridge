import { useState } from 'react';
import type { InferClient } from '@ratio-hub/bridge';
import type { nativeContract } from '@ratio-hub/bridge-example-shared';

type NativeClient = InferClient<typeof nativeContract>;

export function ModalDemo({ native }: { native: NativeClient }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleOpen = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await native.modal.open();
      setResult(res.result);
    } catch (err) {
      console.error('modal.open failed:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2>Modal</h2>
      <p className="description">
        Procedure: triggers native modal, waits for user interaction, returns
        result.
      </p>
      <button onClick={handleOpen} disabled={loading}>
        {loading ? 'Waiting...' : 'Open Native Modal'}
      </button>
      {result && <p className="result">Result: {result}</p>}
    </div>
  );
}
