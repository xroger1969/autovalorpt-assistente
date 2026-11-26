import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { CATALOGUE_ENDPOINT, isSnapshotStale, normalizeInventory, type Snapshot } from './catalogue';
import { readCachedCatalogue, saveCachedCatalogue } from './storage';

const REFRESH_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

export interface CatalogueState {
  snapshot: Snapshot | null;
  error: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  /** A transport failure; server/validation errors do not claim the device is offline. */
  isOffline: boolean;
  /** Stored/unconfirmed data, a failed latest check, or a source older than 36 hours. */
  isStale: boolean;
  /** Time of the last successful API read, distinct from snapshot.updatedAt. */
  lastChecked: string | null;
  refresh: () => Promise<void>;
}

class PublicCatalogueError extends Error {
  constructor(message: string) { super(message); this.name = 'PublicCatalogueError'; }
}

interface PendingRequest {
  sequence: number;
  controller: AbortController;
  promise: Promise<void>;
}

export function useCatalogue(): CatalogueState {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const snapshotRef = useRef<Snapshot | null>(null);
  const active = useRef(AppState.currentState === 'active' || AppState.currentState === null);
  const mounted = useRef(false);
  const pending = useRef<PendingRequest | null>(null);
  const sequence = useRef(0);

  const refresh = useCallback((): Promise<void> => {
    if (!mounted.current || !active.current) return Promise.resolve();
    if (pending.current) return pending.current.promise;
    const requestSequence = ++sequence.current;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
    setIsRefreshing(true);
    if (!snapshotRef.current) setIsLoading(true);

    const promise = Promise.resolve().then(async () => {
      try {
        const response = await fetch(CATALOGUE_ENDPOINT, {
          method: 'GET', credentials: 'omit', signal: controller.signal,
          headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
        });
        if (!response.ok) throw new PublicCatalogueError('O catálogo está temporariamente indisponível. Tente atualizar dentro de instantes.');
        let next: Snapshot;
        try { next = normalizeInventory(await response.json()); }
        catch { throw new PublicCatalogueError('Não foi possível confirmar os dados do catálogo. Tente atualizar novamente.'); }
        if (!mounted.current || requestSequence !== sequence.current) return;
        const checkedAt = new Date().toISOString();
        const previous = snapshotRef.current;
        const stable = previous?.revision === next.revision && previous.updatedAt === next.updatedAt ? previous : next;
        snapshotRef.current = stable;
        if (stable !== previous) setSnapshot(stable);
        setLastChecked(checkedAt);
        setError(null);
        setIsOffline(false);
        setIsStale(isSnapshotStale(next));
        // Only a complete validated response can replace the persistent copy.
        // A local storage failure must not hide a successfully refreshed stock.
        void saveCachedCatalogue(next, checkedAt);
      } catch (failure: unknown) {
        if (!mounted.current || requestSequence !== sequence.current || controller.signal.aborted && !timedOut) return;
        const transportFailure = !timedOut && failure instanceof TypeError;
        setIsOffline(transportFailure);
        setIsStale(Boolean(snapshotRef.current));
        setError(timedOut
          ? 'A ligação demorou demasiado. Tente atualizar novamente.'
          : failure instanceof PublicCatalogueError ? failure.message
            : 'Não foi possível ligar ao catálogo. Verifique a ligação à internet e tente novamente.');
      } finally {
        clearTimeout(timeout);
        if (mounted.current && requestSequence === sequence.current) {
          pending.current = null;
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    });
    pending.current = { sequence: requestSequence, controller, promise };
    return promise;
  }, []);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    // Hydrate and fetch concurrently. Slow storage must not delay live stock;
    // a late cached result can never overwrite a successful network response.
    void readCachedCatalogue().then(cached => {
      if (cancelled || !mounted.current) return;
      if (cached && !snapshotRef.current) {
        snapshotRef.current = cached.snapshot;
        setSnapshot(cached.snapshot);
        setLastChecked(cached.lastChecked);
        setIsStale(true);
        setIsLoading(false);
      } else if (!pending.current) setIsLoading(false);
    });
    void refresh();

    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const wasActive = active.current;
      active.current = nextState === 'active';
      if (active.current && !wasActive) void refresh();
      if (!active.current && wasActive && pending.current) {
        // Invalidate before aborting: a rapid foreground transition can start
        // a new request without a late previous response changing its state.
        const previous = pending.current;
        pending.current = null;
        sequence.current += 1;
        previous.controller.abort();
        setIsRefreshing(false);
      }
    });
    const interval = setInterval(() => { if (active.current) void refresh(); }, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      mounted.current = false;
      sequence.current += 1;
      pending.current?.controller.abort();
      pending.current = null;
      clearInterval(interval);
      subscription.remove();
    };
  }, [refresh]);

  return { snapshot, error, isLoading, isRefreshing, isOffline, isStale, lastChecked, refresh };
}
