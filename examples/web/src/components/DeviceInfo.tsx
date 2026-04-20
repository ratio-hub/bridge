import { useEffect, useState } from 'react';
import type { InferClient } from '@ratio-hub/bridge';
import type { nativeContract } from '@ratio-hub/bridge-example-shared';

type NativeClient = InferClient<typeof nativeContract>;

type DeviceData = {
  platform: 'ios' | 'android';
  osVersion: string;
  appVersion: string;
  deviceName: string;
};

export function DeviceInfo({ native }: { native: NativeClient }) {
  const [info, setInfo] = useState<DeviceData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    native.device
      .getInfo()
      .then(setInfo)
      .catch((err: Error) => setError(err.message));
  }, [native]);

  return (
    <div className="card">
      <h2>Device Info</h2>
      <p className="description">
        Procedure with 5s timeout. Fetches native device info on mount.
      </p>
      {error && <p className="error">Error: {error}</p>}
      {info ? (
        <ul className="device-info">
          <li>Platform: {info.platform}</li>
          <li>OS: {info.osVersion}</li>
          <li>App: {info.appVersion}</li>
          <li>Device: {info.deviceName}</li>
        </ul>
      ) : (
        !error && <p className="status">Loading...</p>
      )}
    </div>
  );
}
