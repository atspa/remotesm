import { remoteEsmVm } from "../../cache.ts";
import type { RemoteEsmResult } from "../../types.ts";

export function importWithPackageCache(
  key: string,
  factory: () => Promise<RemoteEsmResult>,
): Promise<RemoteEsmResult> {
  const cached = remoteEsmVm.package.get(key);
  if (cached) return cached;

  const promise = factory().catch((error) => {
    remoteEsmVm.package.delete(key);
    throw error;
  });

  remoteEsmVm.package.set(key, promise);
  return promise;
}
