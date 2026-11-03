import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/api/client';

/** Tiny data hook: load on mount, expose refresh + pull-to-refresh state. */
export function useAsync<T>(fn: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const fnRef = useRef(fn); fnRef.current = fn;
  const loadedRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError(null);
    try { setData(await fnRef.current()); loadedRef.current = true; }
    catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, deps);

  /**
   * Stable callback for useFocusEffect: silently re-fetch when the screen regains
   * focus, but only once the first load has finished. (Screens used to write
   * `useFocusEffect(useCallback(() => { if (data) refresh(); }, []))`, which
   * captured the initial `data === null` forever and so never refreshed —
   * TestFlight: "set task to complete, list still shows incomplete".)
   */
  const refreshIfLoaded = useCallback(() => { if (loadedRef.current) load(true); }, [load]);
  return { data, setData, error, loading, refreshing, reload: () => load(false), refresh: () => load(true), refreshIfLoaded };
}
