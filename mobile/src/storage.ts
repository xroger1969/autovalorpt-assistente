import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cleanVehicleIds, MAX_COMPARISON_VEHICLES, normalizeInventory, normalizeTimestamp, toggleComparisonIds,
  type Snapshot,
} from './catalogue';

const SNAPSHOT_KEY = 'autovalor.native.catalogue.snapshot.v1';
const PREFERENCES_KEY = 'autovalor.native.catalogue.preferences.v1';
const MAX_CACHE_BYTES = 4 * 1024 * 1024;

export interface CachedCatalogue {
  snapshot: Snapshot;
  lastChecked: string;
}

interface Preferences {
  favorites: string[];
  comparisonIds: string[];
}

// AsyncStorage writes can finish in a different order from the user's taps.
// Serial queues ensure the newest selected state is the last durable state.
let snapshotWrites: Promise<unknown> = Promise.resolve();
let preferenceWrites: Promise<unknown> = Promise.resolve();

export async function readCachedCatalogue(): Promise<CachedCatalogue | null> {
  try {
    await snapshotWrites;
    const value = await AsyncStorage.getItem(SNAPSHOT_KEY);
    if (!value || value.length > MAX_CACHE_BYTES) return null;
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (record.version !== 1 || !record.snapshot || typeof record.snapshot !== 'object' || Array.isArray(record.snapshot)) return null;
    const saved = record.snapshot as Record<string, unknown>;
    const snapshot = normalizeInventory({
      ok: true, updatedAt: saved.updatedAt, revision: saved.revision,
      total: Array.isArray(saved.items) ? saved.items.length : -1, items: saved.items,
    });
    return { snapshot, lastChecked: normalizeTimestamp(record.lastChecked) };
  } catch {
    return null;
  }
}

export function saveCachedCatalogue(snapshot: Snapshot, lastChecked: string): Promise<boolean> {
  let value: string;
  try {
    const clean = normalizeInventory({ ok: true, total: snapshot.items.length, ...snapshot });
    value = JSON.stringify({ version: 1, snapshot: clean, lastChecked: normalizeTimestamp(lastChecked) });
    if (value.length > MAX_CACHE_BYTES) return Promise.resolve(false);
  } catch {
    return Promise.resolve(false);
  }
  const write = snapshotWrites.then(async () => {
    try { await AsyncStorage.setItem(SNAPSHOT_KEY, value); return true; }
    catch { return false; }
  });
  snapshotWrites = write;
  return write;
}

async function readPreferences(): Promise<{ value: Preferences; writable: boolean }> {
  const empty: Preferences = { favorites: [], comparisonIds: [] };
  try {
    await preferenceWrites;
    const raw = await AsyncStorage.getItem(PREFERENCES_KEY);
    if (!raw) return { value: empty, writable: true };
    if (raw.length > 100_000) return { value: empty, writable: false };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { value: empty, writable: false };
    const record = parsed as Record<string, unknown>;
    if (record.version !== 1 || !Array.isArray(record.favorites) || !Array.isArray(record.comparisonIds)) {
      return { value: empty, writable: false };
    }
    return {
      value: {
        favorites: cleanVehicleIds(record.favorites),
        comparisonIds: cleanVehicleIds(record.comparisonIds, MAX_COMPARISON_VEHICLES),
      }, writable: true,
    };
  } catch {
    // In-memory use is still possible, but never overwrite data we could not read.
    return { value: empty, writable: false };
  }
}

function savePreferences(preferences: Preferences): Promise<boolean> {
  const value = JSON.stringify({
    version: 1, favorites: cleanVehicleIds(preferences.favorites),
    comparisonIds: cleanVehicleIds(preferences.comparisonIds, MAX_COMPARISON_VEHICLES),
  });
  const write = preferenceWrites.then(async () => {
    try { await AsyncStorage.setItem(PREFERENCES_KEY, value); return true; }
    catch { return false; }
  });
  preferenceWrites = write;
  return write;
}

export interface CataloguePreferences {
  favorites: string[];
  comparisonIds: string[];
  isReady: boolean;
  storageError: string | null;
  toggleFavorite: (id: string) => void;
  /** Returns false if hydration is pending, the ID is invalid, or three are already selected. */
  toggleComparison: (id: string) => boolean;
  clearComparison: () => void;
}

/** Mount once above the catalogue screens and pass the resulting preferences down. */
export function usePreferences(): CataloguePreferences {
  const [preferences, setPreferences] = useState<Preferences>({ favorites: [], comparisonIds: [] });
  const [isReady, setIsReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const state = useRef(preferences);
  const ready = useRef(false);
  const writable = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void readPreferences().then(result => {
      if (cancelled) return;
      state.current = result.value;
      ready.current = true;
      writable.current = result.writable;
      setPreferences(result.value);
      setIsReady(true);
      if (!result.writable) setStorageError('Não foi possível ler as preferências guardadas. As alterações ficam nesta sessão.');
    });
    return () => { cancelled = true; mounted.current = false; ready.current = false; };
  }, []);

  const update = useCallback((next: Preferences) => {
    state.current = next;
    setPreferences(next);
    // There is no default-state persistence effect: hydration never erases data.
    if (writable.current) void savePreferences(next).then(saved => {
      if (!mounted.current) return;
      setStorageError(saved ? null : 'Não foi possível guardar as preferências. As alterações ficam nesta sessão.');
    });
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    if (!ready.current || !cleanVehicleIds([id]).length) return;
    const previous = state.current;
    const favorites = previous.favorites.includes(id)
      ? previous.favorites.filter(value => value !== id)
      : cleanVehicleIds([...previous.favorites, id]);
    update({ ...previous, favorites });
  }, [update]);

  const toggleComparison = useCallback((id: string): boolean => {
    if (!ready.current) return false;
    const previous = state.current;
    const comparisonIds = toggleComparisonIds(previous.comparisonIds, id);
    if (!comparisonIds) return false;
    update({ ...previous, comparisonIds });
    return true;
  }, [update]);

  const clearComparison = useCallback(() => {
    if (!ready.current || !state.current.comparisonIds.length) return;
    update({ ...state.current, comparisonIds: [] });
  }, [update]);

  return { ...preferences, isReady, storageError, toggleFavorite, toggleComparison, clearComparison };
}
