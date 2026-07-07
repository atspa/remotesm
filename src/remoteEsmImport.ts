import { remoteEsmVm } from "./cache.ts";
import { createDtsCompletionConverter } from "./converter.ts";
import { loadDtsGraph, resolveDeclarationUrl } from "./dtsGraph.ts";
import { attachCompletionTypeJsdoc, completionsToSafeJsdoc, parseCallableDetail } from "./jsdoc.ts";
import type { JsdocConvertOptions } from "./jsdoc.ts";
import { importModuleCached, loadTypeScript } from "./network.ts";
import { normalizeRemoteEsmTarget } from "./url.ts";
import type {
  CompletionResult,
  DtsCompletionConverter,
  RemoteEsmImportMatch,
  RemoteEsmInput,
  RemoteEsmOptions,
  RemoteEsmResult,
  RemoteEsmTypedBindingOptions,
} from "./types.ts";

/**
 * Main public API. Imports a remote ESM runtime module, loads its declaration graph, converts it to
 * completion JSON + safe JSDoc, and caches everything in virtual memory.
 *
 * Accepts any of:
 * - "zod"
 * - "zod@4.4.3"
 * - "@octokit/core"
 * - "@octokit/core@7.0.6"
 * - "github:user/repo#commit"
 * - "gh:user/repo#commit"
 * - "https://esm.sh/@octokit/core@7.0.6"
 * - { runtimeUrl, dtsUrl, specifier }
 */
export async function remoteEsmImport(input: RemoteEsmInput, options: RemoteEsmOptions = {}): Promise<RemoteEsmResult> {
  const target = normalizeRemoteEsmTarget(input, options);
  const {
    tsUrl = "https://esm.sh/typescript",
    maxDepth = 5,
    maxFiles = 80,
    includeBareDtsImports = true,
    typeNameSuffix = "",
    unknownType,
    includeHeader = false,
    log = true,
  } = options;

  const packageCacheKey = JSON.stringify({
    input,
    target,
    tsUrl,
    maxDepth,
    maxFiles,
    includeBareDtsImports,
    typeNameSuffix,
    unknownType,
    includeHeader,
    jsdoc: options.jsdoc || null,
  });

  return await importWithPackageCache(packageCacheKey, async () => {
    const [moduleObject, dtsUrl, converter] = await Promise.all([
      importModuleCached(target.runtimeUrl),
      resolveDeclarationUrl(target, options),
      getDtsConverter(tsUrl),
    ]);

    const dtsGraph = await loadDtsGraph(dtsUrl, {
      ...options,
      maxDepth,
      maxFiles,
      includeBareDtsImports,
    });

    const combinedDts = dtsGraph.files
      .map((file) => ["", `/* ===== ${file.url} ===== */`, file.text].join("\n"))
      .join("\n");

    const completions = converter.convertText(combinedDts, {
      fileName: `${target.specifier || "remote"}.virtual.d.ts`,
    });

    const jsdocOptions: JsdocConvertOptions = {
      ...options,
      specifier: options.jsdoc?.importTypes?.specifier || target.specifier,
      includeGlobals: true,
      includeHeader,
      typeNameSuffix,
    };

    if (unknownType !== undefined) jsdocOptions.unknownType = unknownType;

    attachCompletionTypeJsdoc(completions, jsdocOptions);

    const jsdoc = completionsToSafeJsdoc(completions, jsdocOptions);

    const result: RemoteEsmResult = {
      input,
      specifier: target.specifier,
      libUrl: target.runtimeUrl,
      runtimeUrl: target.runtimeUrl,
      metaUrl: target.metaUrl,
      dtsUrl,
      module: moduleObject,
      dtsGraph,
      completions,
      imports: buildRemoteEsmImportMatches(moduleObject, completions, {
        importSpecifier: target.runtimeUrl,
        typeNameSuffix,
      }),
      jsdoc,
      memory: remoteEsmVm,
      pick(name: string, fallback?: any): any {
        if (moduleObject && name in moduleObject) return moduleObject[name];
        if (fallback !== undefined) return fallback;
        return moduleObject?.default ?? moduleObject;
      },
      asAny<T = any>(value: T): any {
        return value as any;
      },
    };

    if (log) {
      console.info("remoteEsmImport runtime:", target.runtimeUrl);
      console.info("remoteEsmImport types:", dtsUrl);
      console.info("remoteEsmImport d.ts files:", dtsGraph.files.map((file) => file.url));

      if (dtsGraph.failed.length) {
        console.warn("remoteEsmImport d.ts fetch failures:", dtsGraph.failed);
      }
    }

    return result;
  });
}

/** Backwards-compatible alias for the earlier single-file API name. */
export const importCdnPackageWithTypes = remoteEsmImport;

/** Match enumerable runtime module exports to exact global completion labels. */
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
    const entry = globals.filter((candidate) => candidate?.label === key)[0];
    if (!entry) continue;

    const type = types[entry.label];
    const match: RemoteEsmImportMatch = {
      key,
      value: moduleObject[key],
      entry,
    };

    if (type) {
      match.type = type;
      if (typeof type.toJsdoc === "function") match.toJsdoc = type.toJsdoc.bind(type);
    }

    match.toTypedBinding = (bindingOptions?: string | RemoteEsmTypedBindingOptions) => {
      return remoteEsmImportMatchToTypedBinding(match, {
        ...options,
        ...normalizeTypedBindingOptions(bindingOptions),
      });
    };

    match.toGlobal = match.toTypedBinding;

    matches[key] = match;
  }

  return matches;
}

/** Render a typed local binding for a matched runtime export. */
export function remoteEsmImportMatchToTypedBinding(
  match: RemoteEsmImportMatch,
  options: RemoteEsmTypedBindingOptions = {},
): string {
  const localName = options.localName || sanitizeBindingName(match.key);
  const moduleName = options.moduleName || "module";
  const includeTypedef = options.includeTypedef !== false;
  const out: string[] = [];

  if (includeTypedef && typeof match.toJsdoc === "function") {
    const jsdoc = match.toJsdoc(options.jsdoc);
    if (jsdoc) out.push(jsdoc);
  }

  out.push(renderTypedBinding({
    localName,
    moduleName,
    exportKey: match.key,
    typeExpression: getTypedBindingTypeExpression(match, options),
  }));

  return out.filter(Boolean).join("\n\n");
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

export function getTypedBindingTypeExpression(
  match: RemoteEsmImportMatch,
  options: RemoteEsmTypedBindingOptions = {},
): string {
  const localTypeName = options.typeName || getLocalExportTypeName(match, options.typeNameSuffix || "");
  const typeSource = options.typeSource || (match.entry.kind === "Class" ? "constructor" : "local");

  if (typeSource === "import" && options.importSpecifier) {
    return `typeof import("${escapeJsString(options.importSpecifier)}")${exportTypeAccessor(match.key)}`;
  }

  if (typeSource === "constructor" && match.entry.kind === "Class") {
    const constructorType = getConstructorTypeExpression(match, localTypeName, options.typeNameSuffix || "");
    if (constructorType) return constructorType;
  }

  return localTypeName || match.entry.label || "unknown";
}

export function getLocalExportTypeName(match: RemoteEsmImportMatch, typeNameSuffix = ""): string {
  const baseName = match.type ? match.entry.label : match.entry.label || match.key;
  return `${baseName}${typeNameSuffix}`;
}

export function getConstructorTypeExpression(
  match: RemoteEsmImportMatch,
  instanceTypeName: string,
  typeNameSuffix = "",
): string {
  const constructorEntry = match.type?.members.find((member) => member.kind === "Constructor");
  if (!constructorEntry) return "";

  const parsed = parseCallableDetail(constructorEntry.detail, "constructor");
  const params = parsed.params.map((param, index) => {
    const rest = param.rest || param.name.startsWith("...");
    const name = sanitizeBindingName(param.name.replace(/^\.\.\./, "") || `arg${index + 1}`);
    const type = toLocalParsedTypeExpression(param.type || "x", typeNameSuffix);
    const optional = param.optional ? "?" : "";
    return rest ? `...${name}:${type}[]` : `${name}${optional}:${type}`;
  });

  return `new (${params.join(",")}) => ${instanceTypeName}`;
}

export function toLocalParsedTypeExpression(type: string, typeNameSuffix = ""): string {
  let value = String(type || "x").trim();
  if (!value) return "x";

  value = value.replace(/\bObject\b/g, "O")
    .replace(/\bString\b/g, "s")
    .replace(/\bstring\b/g, "s")
    .replace(/\bNumber\b/g, "n")
    .replace(/\bnumber\b/g, "n")
    .replace(/\bBoolean\b/g, "b")
    .replace(/\bboolean\b/g, "b")
    .replace(/\bunknown\b/g, "X")
    .replace(/\bany\b/g, "x");

  if (!typeNameSuffix) return value;

  return value.replace(/\b[A-Z][A-Za-z0-9_$]*\b/g, (name) => {
    if (["O", "String", "Number", "Boolean", "Promise", "Array", "Date", "RegExp", "Error", "Function"].includes(name)) return name;
    if (name.endsWith(typeNameSuffix)) return name;
    return `${name}${typeNameSuffix}`;
  });
}

export function normalizeTypedBindingOptions(options?: string | RemoteEsmTypedBindingOptions): RemoteEsmTypedBindingOptions {
  if (typeof options === "string") return { localName: options };
  return options || {};
}

export function sanitizeBindingName(name: string): string {
  if (name === "default") return "defaultExport";
  const value = String(name || "").replace(/[^\w$]/g, "_");
  if (!value) return "value";
  return /^\d/.test(value) ? `_${value}` : value;
}

export function exportTypeAccessor(key: string): string {
  return isIdentifierName(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

export function runtimePropertyAccessor(key: string): string {
  return isIdentifierName(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

export function isIdentifierName(value: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(value);
}

export function escapeJsString(value: string): string {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

/** Get or create the declaration converter. */
export async function getDtsConverter(tsUrl: string): Promise<DtsCompletionConverter> {
  if (remoteEsmVm.converter) return remoteEsmVm.converter;

  const ts = await loadTypeScript(tsUrl);
  remoteEsmVm.converter = createDtsCompletionConverter(ts);

  return remoteEsmVm.converter;
}

async function importWithPackageCache(key: string, factory: () => Promise<RemoteEsmResult>): Promise<RemoteEsmResult> {
  if (remoteEsmVm.package.has(key)) return remoteEsmVm.package.get(key)!;

  const promise = factory().catch((error) => {
    remoteEsmVm.package.delete(key);
    throw error;
  });

  remoteEsmVm.package.set(key, promise);
  return promise;
}
