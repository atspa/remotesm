import { remoteEsmVm } from "../../cache.ts";
import { createDtsCompletionConverter } from "../../converter.ts";
import { loadTypeScript } from "../../network.ts";
import type { DtsCompletionConverter } from "../../types.ts";

export async function getDtsConverter(tsUrl: string): Promise<DtsCompletionConverter> {
  if (remoteEsmVm.converter) return remoteEsmVm.converter;

  const ts = await loadTypeScript(tsUrl);
  remoteEsmVm.converter = createDtsCompletionConverter(ts);
  return remoteEsmVm.converter;
}
