import { useState } from 'react';
import type { InferClient } from '@ratiojs/bridge';
import type { nativeContract } from '@ratiojs/bridge-example-shared';

type NativeClient = InferClient<typeof nativeContract>;

export function Counter({ native }: { native: NativeClient }) {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const handleIncrement = async () => {
    setLoading(true);
    try {
      const result = await native.counter.increment();
      setCount(result.value);
    } catch (err) {
      console.error('increment failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDecrement = async () => {
    setLoading(true);
    try {
      const result = await native.counter.decrement();
      setCount(result.value);
    } catch (err) {
      console.error('decrement failed:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2>Counter</h2>
      <p className="description">
        Procedure: web sends increment/decrement, native manages state, responds
        with new value.
      </p>
      <div className="counter-controls">
        <button onClick={handleDecrement} disabled={loading}>
          -
        </button>
        <span className="counter-value">{count}</span>
        <button onClick={handleIncrement} disabled={loading}>
          +
        </button>
      </div>
    </div>
  );
}
