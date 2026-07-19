import { parseCallableDetail } from "../../jsdoc.ts";
import type { RemoteEsmImportMatch, RemoteEsmTypedBindingOptions } from "../../types.ts";
import { escapeJsString, exportTypeAccessor, sanitizeBindingName } from "../../core/index.ts";

export function getLocalExportTypeName(match: RemoteEsmImportMatch, typeNameSuffix = ""): string {
  const baseName = match.entry.label || match.key;
  return `${baseName}${typeNameSuffix}`;
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
    return name.endsWith(typeNameSuffix) ? name : `${name}${typeNameSuffix}`;
  });
}
