import { useCallback, useState } from 'react';

import { loadPrefs, savePrefs, type Prefs } from '../lib/prefs';

export function usePrefs(): { prefs: Prefs; update: (patch: Partial<Prefs>) => void } {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((s) => {
      const next = { ...s, ...patch };
      savePrefs(next);
      return next;
    });
  }, []);
  return { prefs, update };
}
