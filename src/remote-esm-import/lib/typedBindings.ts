import type {
  CompletionResult,
  RemoteEsmImportMatch,
  RemoteEsmTypedBindingOptions,
} from "../../types.ts";
import { runtimePropertyAccessor, sanitizeBindingName } from "../../core/index.ts";
import { getTypedBindingTypeExpression } from "./typeExpression.ts";

export function buildRemoteEsmImportMatches(
  moduleObject: any,
  completions: CompletionResult,
  options: Pick<RemoteEsmTypedBindingOptions, "importSpecifier" | "moduleName" | "typeNameSuffix" | "typeSource"> = {},
): Record<string, RemoteEsmImportMatch> {
  if (!moduleObject || (typeof moduleObject !== "object" && typeof moduleObject !== "function")) return {};

  const globals = Array.isArray(completions?.byScope?.global) ? completions.byScope.global : [];
  const types = completions?.types && typeof completions.types === "object" ? completions.types : {};
  const matches: Record<string, RemoteEsmImportMatch> = {};

  for (const key of Object.keys(moduleObject)) {
    const entry = globals.find((candidate) => candidate?.label === key);
    if (!entry) continue;

    const type = types[entry.label];
    const match: RemoteEsmImportMatch = { key, value: moduleObject[key], entry };

    if (type) {
      match.type = type;
      if (typeof type.toJsdoc === "function") match.toJsdoc = type.toJsdoc.bind(type);
    }

    match.toTypedBinding = (bindingOptions?: string | RemoteEsmTypedBindingOptions) => remoteEsmImportMatchToTypedBinding(match, {
      ...options,
      ...normalizeTypedBindingOptions(bindingOptions),
    });
    match.toGlobal = match.toTypedBinding;
    matches[key] = match;
  }

  return matches;
}

export function remoteEsmImportMatchToTypedBinding(
  match: RemoteEsmImportMatch,
  options: RemoteEsmTypedBindingOptions = {},
): string {
  const out: string[] = [];

  if (options.includeTypedef !== false && typeof match.toJsdoc === "function") {
    const jsdoc = match.toJsdoc(options.jsdoc);
    if (jsdoc) out.push(jsdoc);
  }

  out.push(renderTypedBinding({
    localName: options.localName || sanitizeBindingName(match.key),
    moduleName: options.moduleName || "module",
    exportKey: match.key,
    typeExpression: getTypedBindingTypeExpression(match, options),
  }));

  return out.join("\n\n");
}

export function renderTypedBinding(input: {
  localName: string;
  moduleName: string;
  exportKey: string;
  typeExpression: string;
}): string {
  return [
    `/** @type {${input.typeExpression}} */`,
    `const ${input.localName} = ${input.moduleName}${runtimePropertyAccessor(input.exportKey)};`,
  ].join("\n");
}

export function normalizeTypedBindingOptions(options?: string | RemoteEsmTypedBindingOptions): RemoteEsmTypedBindingOptions {
  return typeof options === "string" ? { localName: options } : options || {};
}
