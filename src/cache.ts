import type { RemoteEsmVm } from "./types";

const root = globalThis as any;

export const remoteEsmVm: RemoteEsmVm = root.__remoteEsmVm || (root.__remoteEsmVm = {
  text: new Map(),
  json: new Map(),
  module: new Map(),
  dtsUrl: new Map(),
  dtsGraph: new Map(),
  package: new Map(),
  ts: null,
  converter: null,
});

/** Memoize an async computation in a virtual-memory map. */
export function vmMemo<T>(map: Map<string, Promise<T>>, key: string, factory: () => T | Promise<T>): Promise<T> {
  if (map.has(key)) return map.get(key)!;

  const promise = Promise.resolve()
    .then(factory)
    .catch((error) => {
      map.delete(key);
      throw error;
    });

  map.set(key, promise);
  return promise;
}

/** Clear all virtual-memory caches except the object identity itself. */
export function clearRemoteEsmVm(): void {
  remoteEsmVm.text.clear();
  remoteEsmVm.json.clear();
  remoteEsmVm.module.clear();
  remoteEsmVm.dtsUrl.clear();
  remoteEsmVm.dtsGraph.clear();
  remoteEsmVm.package.clear();
  remoteEsmVm.ts = null;
  remoteEsmVm.converter = null;
}
