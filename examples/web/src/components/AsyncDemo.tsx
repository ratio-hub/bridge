import { useState } from 'react';
import type { InferClient } from '@ratiojs/bridge';
import type { nativeContract } from '@ratiojs/bridge-example-shared';

type NativeClient = InferClient<typeof nativeContract>;

type Result = { label: string; elapsedMs: number };

export function AsyncDemo({ native }: { native: NativeClient }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    const label = `req-${Date.now()}`;
    try {
      const res = await native.async.resolve({ label });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2>Async Promise</h2>
      <p className="description">
        Procedure: web awaits <code>native.async.resolve</code>; native waits
        2s on a Promise, then resolves with the echoed label + elapsed time.
      </p>
      <button onClick={handleClick} disabled={loading}>
        {loading ? 'Waiting 2s…' : 'Trigger async'}
      </button>
      {error && <p className="error">Error: {error}</p>}
      {result && (
        <p className="result">
          Resolved: <strong>{result.label}</strong> in {result.elapsedMs}ms
        </p>
      )}
    </div>
  );
}
