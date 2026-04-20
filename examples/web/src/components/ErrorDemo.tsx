import { useState } from 'react';
import { BridgeError } from '@ratiojs/bridge';
import type { InferClient } from '@ratiojs/bridge';
import type { nativeContract } from '@ratiojs/bridge-example-shared';

type NativeClient = InferClient<typeof nativeContract>;

export function ErrorDemo({ native }: { native: NativeClient }) {
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleTryCatch = async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      await native.error.trigger({ shouldFail: true });
    } catch (err) {
      if (err instanceof BridgeError) {
        const data = err.data as { message: string; code: number };
        setError(
          `BridgeError [${err.code}]: ${data.message} (code: ${data.code})`,
        );
      } else {
        setError(String(err));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSuccess = async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await native.error.trigger({ shouldFail: false });
      setResult(JSON.stringify(res));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleOnError = async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    const res = await native.error.trigger(
      { shouldFail: true },
      {
        onError: (err) => {
          setError(
            `onError callback [${err.code}]: ${(err.data as { message: string }).message} (code: ${(err.data as { code: number }).code})`,
          );
        },
      },
    );
    if (res === undefined) {
      setResult('Promise resolved to undefined (error handled by onError)');
    }
    setLoading(false);
  };

  return (
    <div className="card">
      <h2>Error Handling</h2>
      <p className="description">
        Typed BridgeError with .errors() contract. Shows try/catch and onError
        callback patterns.
      </p>
      <div className="error-buttons">
        <button onClick={handleTryCatch} disabled={loading}>
          Trigger Error (try/catch)
        </button>
        <button onClick={handleSuccess} disabled={loading}>
          Success Path
        </button>
        <button onClick={handleOnError} disabled={loading}>
          Trigger Error (onError)
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {result && <p className="result">{result}</p>}
    </div>
  );
}
