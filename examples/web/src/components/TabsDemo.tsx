import { useState } from 'react';
import type { InferClient } from '@ratiojs/bridge';
import type { nativeContract } from '@ratiojs/bridge-example-shared';

type NativeClient = InferClient<typeof nativeContract>;

const tabs = ['home', 'settings'] as const;

export function TabsDemo({ native }: { native: NativeClient }) {
  const [activeTab, setActiveTab] = useState<string>('home');
  const [loading, setLoading] = useState(false);

  const handleChange = async (tab: (typeof tabs)[number]) => {
    setLoading(true);
    try {
      const result = await native.tabs.change({ tab });
      setActiveTab(result.activeTab);
    } catch (err) {
      console.error('tabs.change failed:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2>Tabs</h2>
      <p className="description">
        Procedure: web requests tab change, native updates internal state,
        responds with active tab.
      </p>
      <div className="tab-buttons">
        {tabs.map((tab) => (
          <button
            key={tab}
            className={activeTab === tab ? 'active' : ''}
            onClick={() => handleChange(tab)}
            disabled={loading}
          >
            {tab}
          </button>
        ))}
      </div>
    </div>
  );
}
