import { useState } from 'react';
import { BridgeTimeoutError } from '@ratiojs/bridge';
import type { InferClient } from '@ratiojs/bridge';
import type { nativeContract } from '@ratiojs/bridge-example-shared';

type NativeClient = InferClient<typeof nativeContract>;

export function ModalTimeoutDemo({ native }: { native: NativeClient }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTrigger = async () => {
    setLoading(true);
    setError(null);
    try {
      await native.modalTimeout.open();
    } catch (err) {
      if (err instanceof BridgeTimeoutError) {
        setError(`BridgeTimeoutError: ${err.message}`);
      } else {
        setError(String(err));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2>Timeout Demo</h2>
      <p className="description">
        Procedure with 1s timeout. Native delays 3s. Demonstrates
        BridgeTimeoutError.
      </p>
      <button onClick={handleTrigger} disabled={loading}>
        {loading ? 'Waiting...' : 'Trigger Timeout'}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
