import type {
  CompletionEntry,
  CompletionResult,
  CompletionTypeRecord,
  JsdocDefinition,
  NormalizedJsdocSettings,
  ParsedCallable,
  ParsedParam,
  RemoteEsmOptions,
  RemoteEsmJsdocOptions,
  RenderContext,
} from "./types.ts";

export interface JsdocConvertOptions extends RemoteEsmOptions {
  includeGlobals?: boolean;
  sort?: boolean;
  specifier?: string;
}

interface JsdocBuildContext {
  flat: CompletionEntry[];
  types: Record<string, CompletionTypeRecord>;
  settings: NormalizedJsdocSettings;
  originalTypeNames: Set<string>;
  byMemberOf: Record<string, CompletionEntry[]>;
  outTypeName(name: string): string;
}

/** Convert completion JSON into safe JSDoc typedef blocks. */
export function completionsToSafeJsdoc(completions: CompletionResult, options: JsdocConvertOptions = {}): string {
  const context = createJsdocBuildContext(completions, options);
  const typeNames = getSortedTypeNames(context);
  const typedefDefs = buildTypedefDefinitionsForTypes(context, typeNames);
  const importTypeDefs = buildImportTypeDefinitions(context.flat, context.originalTypeNames, context.settings);

  const globalDefs = context.settings.includeGlobals
    ? buildGlobalDefinitions(context.flat, context.originalTypeNames, {
      settings: context.settings,
      outTypeName: context.outTypeName,
    })
    : [];

  return renderJsdocDefinitions([...importTypeDefs, ...typedefDefs], globalDefs, context.settings);
}

/** Convert one completion type record into safe JSDoc. */
export function completionTypeToSafeJsdoc(
  completions: CompletionResult,
  typeName: string,
  options: JsdocConvertOptions = {},
): string {
  const context = createJsdocBuildContext(completions, {
    ...options,
    includeGlobals: false,
  });

  if (!context.originalTypeNames.has(typeName)) return "";

  const typedefDefs = buildTypedefDefinitionsForTypes(context, [typeName]);
  return renderJsdocDefinitions(typedefDefs, [], context.settings);
}

/** Attach non-enumerable per-type JSDoc helpers to completion type records. */
export function attachCompletionTypeJsdoc(completions: CompletionResult, options: JsdocConvertOptions = {}): CompletionResult {
  const types = completions?.types && typeof completions.types === "object" ? completions.types : {};

  for (const typeName of Object.keys(types)) {
    const typeInfo = types[typeName];
    if (!typeInfo || typeof typeInfo !== "object") continue;

    Object.defineProperty(typeInfo, "toJsdoc", {
      configurable: true,
      enumerable: false,
      writable: true,
      value(jsdoc?: RemoteEsmJsdocOptions): string {
        const mergedOptions: JsdocConvertOptions = { ...options };
        const mergedJsdoc = mergeJsdocOptions(options.jsdoc, jsdoc);
        if (mergedJsdoc) mergedOptions.jsdoc = mergedJsdoc;

        return completionTypeToSafeJsdoc(completions, typeName, mergedOptions);
      },
    });
  }

  return completions;
}

export function mergeJsdocOptions(
  base?: RemoteEsmJsdocOptions,
  override?: RemoteEsmJsdocOptions,
): RemoteEsmJsdocOptions | undefined {
  if (!base && !override) return undefined;

  const merged: RemoteEsmJsdocOptions = {
    ...(base || {}),
    ...(override || {}),
  };

  if (base?.tags || override?.tags) {
    merged.tags = {
      ...(base?.tags || {}),
      ...(override?.tags || {}),
    };
  }

  if (base?.importTypes || override?.importTypes) {
    merged.importTypes = {
      ...(base?.importTypes || {}),
      ...(override?.importTypes || {}),
    };
  }

  if (
    typeof base?.shorthand === "object" ||
    typeof override?.shorthand === "object"
  ) {
    const shorthand: RemoteEsmJsdocOptions["shorthand"] = {
      ...(typeof base?.shorthand === "object" ? base.shorthand : {}),
      ...(typeof override?.shorthand === "object" ? override.shorthand : {}),
    };

    const baseTypes = typeof base?.shorthand === "object" ? base.shorthand.types : undefined;
    const overrideTypes = typeof override?.shorthand === "object" ? override.shorthand.types : undefined;

    if (baseTypes || overrideTypes) {
      shorthand.types = {
        ...(baseTypes || {}),
        ...(overrideTypes || {}),
      };
    }

    merged.shorthand = shorthand;
  }

  return merged;
}

function createJsdocBuildContext(completions: CompletionResult, options: JsdocConvertOptions = {}): JsdocBuildContext {
  const settings = normalizeJsdocSettings(options);
  const flat = Array.isArray(completions?.flat) ? completions.flat : [];
  const types = completions?.types && typeof completions.types === "object" ? completions.types : {};

  const originalTypeNames = new Set<string>([
    ...Object.keys(types),
    ...flat
      .filter((entry) => ["Interface", "Class", "TypeAlias", "Enum"].includes(entry.kind))
      .map((entry) => entry.label),
  ]);

  settings.__typeEntries = new Map();

  for (const typeName of originalTypeNames) {
    settings.__typeEntries.set(typeName, {
      typeEntry: flat.find((entry) => entry.label === typeName),
      typeInfo: types[typeName] || { kind: "", detail: "", members: [] },
    });
  }

  function outTypeName(name: string): string {
    return originalTypeNames.has(name) ? `${name}${settings.typeNameSuffix}` : name;
  }

  const byMemberOf: Record<string, CompletionEntry[]> = Object.create(null);

  for (const entry of flat) {
    if (!entry?.memberOf) continue;
    const members = byMemberOf[entry.memberOf] ??= [];
    members.push(entry);
  }

  return {
    flat,
    types,
    settings,
    originalTypeNames,
    byMemberOf,
    outTypeName,
  };
}

function getSortedTypeNames(context: JsdocBuildContext): string[] {
  let typeNames = Array.from(context.originalTypeNames);

  if (context.settings.sort) typeNames = typeNames.sort((a, b) => a.localeCompare(b));

  return typeNames;
}

function buildTypedefDefinitionsForTypes(context: JsdocBuildContext, typeNames: string[]): JsdocDefinition[] {
  const typedefDefs: JsdocDefinition[] = [];

  for (const typeName of typeNames) {
    const typeInfo = context.types[typeName] || { kind: "", detail: "", members: [] };
    const settings = context.settings;
    const typeEntry = context.flat.find((entry) => entry.label === typeName);
    const kind = typeEntry?.kind || typeInfo.kind || "Interface";
    const emittedName = context.outTypeName(typeName);
    const templateNames = extractTemplateNames(typeName, typeEntry, typeInfo);

    const ctx: RenderContext = {
      settings,
      unknownType: settings.unknownType,
      originalTypeNames: context.originalTypeNames,
      outTypeName: context.outTypeName,
      templateNames: new Set(templateNames),
      functionUnknownType: "any",
    };

    typedefDefs.push(buildTypedefDefinition({
      typeName,
      emittedName,
      kind,
      typeEntry,
      typeInfo,
      members: context.byMemberOf[typeName] || [],
      templateNames,
      ctx,
      settings,
    }));
  }

  return typedefDefs;
}

/** Normalize JSDoc output settings. */
export function normalizeJsdocSettings(options: JsdocConvertOptions = {}): NormalizedJsdocSettings {
  const jsdoc = options.jsdoc || {};

  const shorthand = jsdoc.shorthand === false
    ? { enabled: false, includeTypedefs: false, types: {} }
    : {
      enabled: typeof jsdoc.shorthand === "object" ? jsdoc.shorthand.enabled !== false : true,
      includeTypedefs: typeof jsdoc.shorthand === "object" ? jsdoc.shorthand.includeTypedefs !== false : true,
      types: {
        Object: "O",
        object: "O",
        String: "s",
        string: "s",
        Number: "n",
        number: "n",
        Boolean: "b",
        boolean: "b",
        BigInt: "bi",
        bigint: "bi",
        Symbol: "S",
        symbol: "S",
        unknown: "X",
        any: "x",
        Function: "F",
        function: "f",
        null: "N",
        ...(typeof jsdoc.shorthand === "object" ? jsdoc.shorthand.types : undefined),
      },
    };

  const globals = jsdoc.globals || "none";

  return {
    includeGlobals: options.includeGlobals !== false,
    includeHeader: options.includeHeader === true,
    unknownType: options.unknownType || "unknown",
    typeNameSuffix: options.typeNameSuffix || "",
    sort: options.sort !== false,
    tags: {
      property: cleanTagName(jsdoc.tags?.property || "property"),
      argument: cleanTagName(jsdoc.tags?.argument || "param"),
    },
    format: jsdoc.format || "compact",
    space: jsdoc.space === undefined ? "\n" : jsdoc.space,
    shorthand,
    globals,
    importTypes: {
      enabled: jsdoc.importTypes?.enabled === true || globals === "importTypes",
      specifier: jsdoc.importTypes?.specifier || options.specifier || "",
      namespaceName: jsdoc.importTypes?.namespaceName || "Pkg",
      mode: jsdoc.importTypes?.mode || "namespace",
    },
  };
}

/** Remove a leading @ from a tag alias. */
export function cleanTagName(tag: string): string {
  return String(tag || "").replace(/^@+/, "") || "property";
}

function buildTypedefDefinition(input: {
  typeName: string;
  emittedName: string;
  kind: string;
  typeEntry: CompletionEntry | undefined;
  typeInfo: CompletionTypeRecord | undefined;
  members: CompletionEntry[];
  templateNames: string[];
  ctx: RenderContext;
  settings: NormalizedJsdocSettings;
}): JsdocDefinition {
  const { emittedName, kind, typeEntry, typeInfo, members, templateNames, ctx, settings } = input;
  const lines: string[] = [];
  const documentation = typeEntry?.documentation || "";

  appendRawDocLines(lines, documentation);

  if (templateNames.length) lines.push(`@template ${templateNames.join(", ")}`);

  if (kind === "Enum") {
    const unknown = toSafeJsdocType(settings.unknownType, ctx);
    lines.push(`@typedef {${unknown}} ${emittedName}`);

    for (const member of members) {
      if (member.kind !== "EnumMember") continue;
      const doc = member.documentation ? ` - ${oneLine(member.documentation)}` : "";
      lines.push(`@${settings.tags.property} {${unknown}} ${member.label}${doc}`);
    }

    return { generic: templateNames.length > 0, lines };
  }

  if (kind === "TypeAlias") {
    const rawType = typeEntry?.type || extractTypeAliasType(typeEntry?.detail || typeInfo?.detail || "");
    const safeType = toSafeJsdocType(rawType, ctx);
    lines.push(`@typedef {${safeType}} ${emittedName}`);
    return { generic: templateNames.length > 0, lines };
  }

  const finalMembers = settings.sort
    ? members.slice().sort((a, b) => a.label.localeCompare(b.label))
    : members;

  const printableMembers = finalMembers.filter((member) => {
    if (!member?.label) return false;
    if (member.label === "constructor") return false;
    if (member.label === "(call)") return false;
    if (member.label === "[index]") return false;
    return true;
  });

  if (shouldOmitObjectTypedefType(settings) && printableMembers.length > 0) {
    lines.push(`@typedef ${emittedName}`);
  } else {
    lines.push(`@typedef {${aliasBasicType("Object", ctx)}} ${emittedName}`);
  }

  for (const member of printableMembers) {
    const property = renderSafeProperty(member, ctx, settings);
    if (property) lines.push(property);
  }

  return { generic: templateNames.length > 0, lines };
}

/** Build import-type declarations instead of fake global runtime stubs. */
export function buildImportTypeDefinitions(
  flat: CompletionEntry[],
  originalTypeNames: Set<string>,
  settings: NormalizedJsdocSettings,
): JsdocDefinition[] {
  if (!settings.importTypes?.enabled) return [];

  const specifier = settings.importTypes.specifier;
  if (!specifier) return [];

  if (settings.importTypes.mode === "namespace") {
    return [{
      generic: false,
      lines: [`@typedef {import("${specifier}")} ${settings.importTypes.namespaceName}`],
    }];
  }

  let globals = flat.filter((entry) => {
    return entry?.scope === "global" &&
      !originalTypeNames.has(entry.label) &&
      ["Variable", "Function"].includes(entry.kind);
  });

  if (settings.sort) globals = globals.slice().sort((a, b) => a.label.localeCompare(b.label));

  return globals.map((entry) => ({
    generic: false,
    lines: [`@typedef {import("${specifier}").${entry.label}} ${entry.label}${settings.typeNameSuffix}`],
  }));
}

/** Build global variable/function helper definitions. Off unless jsdoc.globals === "stubs". */
export function buildGlobalDefinitions(
  flat: CompletionEntry[],
  originalTypeNames: Set<string>,
  helpers: { settings: NormalizedJsdocSettings; outTypeName(name: string): string },
): JsdocDefinition[] {
  const { settings, outTypeName } = helpers;

  if (settings.globals !== "stubs") return [];

  let globals = flat.filter((entry) => {
    return entry?.scope === "global" &&
      !originalTypeNames.has(entry.label) &&
      ["Variable", "Function"].includes(entry.kind);
  });

  if (settings.sort) globals = globals.slice().sort((a, b) => a.label.localeCompare(b.label));

  const ctx: RenderContext = {
    settings,
    unknownType: settings.unknownType,
    originalTypeNames,
    outTypeName,
    templateNames: new Set(),
    functionUnknownType: "any",
  };

  return globals.map((entry) => {
    if (entry.kind === "Variable") {
      const safeType = toSafeJsdocType(entry.type, ctx);
      const lines: string[] = [];
      appendRawDocLines(lines, entry.documentation);
      lines.push(`@type {${safeType}}`);
      return { kind: "global-variable", generic: false, lines, code: `const ${entry.label} = undefined;` };
    }

    if (entry.kind === "Function") {
      const lines: string[] = [];
      const parsed = parseCallableDetail(entry.detail, entry.label);
      appendRawDocLines(lines, entry.documentation);

      for (const param of parsed.params) {
        const safeType = toSafeJsdocType(param.type, ctx);
        const name = param.optional ? `[${param.name}]` : param.name;
        lines.push(`@${settings.tags.argument} {${safeType}} ${name}`);
      }

      const returnType = toSafeJsdocType(entry.returnType || parsed.returnType || "void", ctx);
      if (returnType && returnType !== "void") lines.push(`@returns {${returnType}}`);

      const args = parsed.params.map((param) => param.name.replace(/^\.\.\./, "")).join(", ");
      return { kind: "global-function", generic: false, lines, code: `function ${entry.label}(${args}) {}` };
    }

    return null;
  }).filter(Boolean) as JsdocDefinition[];
}

/** Render typedef/global definition objects to JSDoc source. */
export function renderJsdocDefinitions(
  typedefDefs: JsdocDefinition[],
  globalDefs: JsdocDefinition[],
  settings: NormalizedJsdocSettings,
): string {
  const out: string[] = [];

  if (settings.includeHeader) out.push(renderJsdocBlock(["Generated JSDoc helper types."]));

  const shorthandDef = buildShorthandDefinition(settings);

  if (settings.format === "oneLine") {
    const rendered: string[] = [];
    if (shorthandDef) rendered.push(renderOneLineJsdocBlock(shorthandDef.lines));
    for (const def of typedefDefs) rendered.push(renderOneLineJsdocBlock(def.lines));
    for (const def of globalDefs) {
      rendered.push(renderOneLineJsdocBlock(def.lines));
      if (def.code) rendered.push(def.code);
    }
    return out.concat(rendered).join(spaceToRawSeparator(settings.space)).trimEnd();
  }

  if (settings.format === "verbose") {
    if (shorthandDef) out.push(renderJsdocBlock(shorthandDef.lines));
    for (const def of typedefDefs) out.push(renderJsdocBlock(def.lines));
    for (const def of globalDefs) {
      out.push(renderJsdocBlock(def.lines));
      if (def.code) out.push(def.code);
    }
    return out.join("\n\n").trimEnd();
  }

  const compactTypedefs = typedefDefs.filter((def) => !def.generic);
  const genericTypedefs = typedefDefs.filter((def) => def.generic);
  const groupedDefs = shorthandDef ? [shorthandDef, ...compactTypedefs] : compactTypedefs;

  if (groupedDefs.length) out.push(renderJsdocBlock(joinDefinitionLines(groupedDefs, settings.space)));
  for (const def of genericTypedefs) out.push(renderJsdocBlock(def.lines));
  for (const def of globalDefs) {
    out.push(renderJsdocBlock(def.lines));
    if (def.code) out.push(def.code);
  }

  return out.join("\n\n").trimEnd();
}

/** Build default shorthand aliases. */
export function buildShorthandDefinition(settings: NormalizedJsdocSettings): JsdocDefinition | null {
  if (!settings.shorthand?.enabled || !settings.shorthand?.includeTypedefs) return null;

  const aliases = settings.shorthand.types || {};

  const pairs = [
    ["Object", aliases.Object || "O"],
    ["String", aliases.String || "s"],
    ["Number", aliases.Number || "n"],
    ["boolean", aliases.boolean || "b"],
    ["bigint", aliases.bigint || "bi"],
    ["Symbol", aliases.Symbol || "S"],
    ["unknown", aliases.unknown || "X"],
    ["any", aliases.any || "x"],
    ["Function", aliases.Function || "F"],
    ["function", aliases.function || "f"],
    [`(...args:${aliases.any || "x"}[]) => Promise<${aliases.unknown || "X"}>`, "AF"],
    ["null", aliases.null || "N"],
  ];

  return { generic: false, lines: pairs.map(([type, name]) => `@typedef {${type}} ${name}`) };
}

export function shouldOmitObjectTypedefType(settings: NormalizedJsdocSettings): boolean {
  return settings.format === "compact" || settings.format === "oneLine";
}

export function joinDefinitionLines(defs: JsdocDefinition[], space: string | number): string[] {
  const out: string[] = [];

  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    if (!def) continue;
    if (i > 0) out.push(...spaceToDocLines(space));
    out.push(...def.lines);
  }

  return out;
}

export function spaceToDocLines(space: string | number): string[] {
  if (space === 0 || space === "" || (space as any) === false || (space as any) === null) return [];
  if (typeof space === "number") return Array.from({ length: Math.max(0, space) }, () => "");
  if (typeof space === "string") {
    if (space === "\n") return [""];
    const parts = space.split("\n");
    return parts.length === 1 ? [space] : parts.map((part) => part.trimEnd());
  }
  return [""];
}

export function spaceToRawSeparator(space: string | number): string {
  if (space === 0 || space === "" || (space as any) === false || (space as any) === null) return "";
  if (typeof space === "number") return "\n".repeat(Math.max(0, space));
  if (typeof space === "string") return space;
  return "\n";
}

export function renderJsdocBlock(lines: string[]): string {
  return ["/**", ...lines.map((line) => line ? ` * ${line}` : " *"), " */"].join("\n");
}

export function renderOneLineJsdocBlock(lines: string[]): string {
  const body = lines.map((line) => String(line || "").trim()).filter(Boolean).join(" ");
  return `/** ${body} */`;
}

export function renderSafeProperty(member: CompletionEntry, ctx: RenderContext, settings: NormalizedJsdocSettings): string {
  const doc = member.documentation ? ` - ${oneLine(member.documentation)}` : "";

  if (member.kind === "Method" || member.kind === "Function") {
    const arrowType = callableEntryToSafeArrowType(member, ctx);
    return `@${settings.tags.property} {${arrowType}} ${member.label}${doc}`;
  }

  const rawType = member.type || extractPropertyType(member.detail);
  const safeType = toSafeJsdocType(rawType, ctx);
  return `@${settings.tags.property} {${safeType}} ${member.label}${doc}`;
}

export function callableEntryToSafeArrowType(entry: CompletionEntry, ctx: RenderContext): string {
  const parsed = parseCallableDetail(entry.detail, entry.label);
  const params = parsed.params.map((param, index) => renderArrowParam(param, index, ctx));
  const returnType = toSafeArrowType(entry.returnType || parsed.returnType || "void", ctx);
  return `(${params.join(",")}) => ${returnType}`;
}

export function renderArrowParam(param: ParsedParam, index: number, ctx: RenderContext): string {
  const rest = param.rest || String(param.name || "").startsWith("...");
  const cleanName = sanitizeParamName(String(param.name || "").replace(/^\.\.\./, ""), index);
  let type = toSafeArrowType(param.type || "*", ctx);

  if (rest) {
    if (!type.endsWith("[]")) type = `${type}[]`;
    return `...${cleanName}:${type}`;
  }

  const optional = param.optional ? "?" : "";
  return `${cleanName}${optional}:${type}`;
}

export function sanitizeParamName(name: string, index: number): string {
  const cleaned = String(name || "").replace(/[^\w$]/g, "").trim();
  if (!cleaned) return `arg${index + 1}`;
  if (/^\d/.test(cleaned)) return `arg${index + 1}`;
  return cleaned;
}

export function toSafeArrowType(type: string, ctx: RenderContext): string {
  const value = toSafeJsdocType(type, ctx);
  const unknownAlias = aliasBasicType(ctx.unknownType, ctx);
  if (!value || value === "*" || value === "unknown" || value === unknownAlias) {
    return aliasBasicType(ctx.functionUnknownType || "any", ctx);
  }
  return value;
}

/** Convert a TypeScript-ish type string to safe JSDoc type syntax. */
export function toSafeJsdocType(type: string, ctx: Partial<RenderContext> = {}): string {
  const unknownType = ctx.unknownType || "unknown";
  const originalTypeNames = ctx.originalTypeNames || new Set<string>();
  const outTypeName = ctx.outTypeName || ((name: string) => name);
  const templateNames = ctx.templateNames || new Set<string>();

  let value = String(type || "").trim();
  if (!value) return aliasBasicType(unknownType, ctx as RenderContext);

  value = value
    .replace(/\bdeclare\s+/g, "")
    .replace(/\bexport\s+/g, "")
    .replace(/\breadonly\s+/g, "")
    .replace(/\s+/g, " ")
    .replace(/;$/, "")
    .trim();

  if (!value) return aliasBasicType(unknownType, ctx as RenderContext);

  if (
    value.includes("typeof this") ||
    value.includes("this &") ||
    value.includes("Constructor<") ||
    value.includes("UnionToIntersection<") ||
    value.includes("ReturnTypeOf<") ||
    value.includes("import(") ||
    value.includes("infer ")
  ) {
    return aliasBasicType(unknownType, ctx as RenderContext);
  }

  if (splitTopLevel(value, "&").length > 1) return aliasBasicType(unknownType, ctx as RenderContext);
  if (/^["'`].*["'`]$/.test(value)) return aliasBasicType("string", ctx as RenderContext);
  if (/^\d+(\.\d+)?$/.test(value)) return aliasBasicType("number", ctx as RenderContext);
  if (value === "true" || value === "false") return aliasBasicType("boolean", ctx as RenderContext);
  if (/^\{.*\}$/.test(value) && value.includes(":")) return aliasBasicType("Object", ctx as RenderContext);

  const arrow = parseArrowFunctionType(value);
  if (arrow && isFullArrowType(value)) {
    const fullCtx = ctx as RenderContext;
    const params = arrow.params.map((param, index) => renderArrowParam(param, index, fullCtx));
    return `(${params.join(",")}) => ${toSafeArrowType(arrow.returnType, fullCtx)}`;
  }

  const unionParts = splitTopLevel(value, "|");
  if (unionParts.length > 1) {
    const safeParts = unionParts.map((part) => toSafeJsdocType(part, ctx)).filter(Boolean);
    if (safeParts.includes(aliasBasicType(unknownType, ctx as RenderContext))) return aliasBasicType(unknownType, ctx as RenderContext);
    return Array.from(new Set(safeParts)).join("|");
  }

  if (value.endsWith("[]")) {
    const inner = value.slice(0, -2).trim();
    return `${toSafeJsdocType(inner, ctx)}[]`;
  }

  const generic = parseGenericType(value);
  if (generic) {
    const name = generic.name;

    if (name === "Array" || name === "ReadonlyArray") return `${toSafeJsdocType(generic.args[0] || unknownType, ctx)}[]`;
    if (name === "Promise") return `Promise<${toSafeJsdocType(generic.args[0] || unknownType, ctx)}>`;
    if (name === "Record") return aliasBasicType("Object", ctx as RenderContext);

    if (templateNames.has(name)) {
      const safeArgs = generic.args.map((arg) => toSafeGenericArgument(arg, ctx as RenderContext));
      return `${name}<${safeArgs.join(",")}>`;
    }

    if (originalTypeNames.has(name)) {
      const safeArgs = generic.args.map((arg) => toSafeGenericArgument(arg, ctx as RenderContext));
      return `${outTypeName(name)}<${safeArgs.join(",")}>`;
    }

    return aliasBasicType(unknownType, ctx as RenderContext);
  }

  if (templateNames.has(value)) return value;
  if (isPrimitiveOrBuiltin(value)) return aliasBasicType(value, ctx as RenderContext);

  if (originalTypeNames.has(value)) {
    const requiredCount = getRequiredTemplateCount(value, ctx as RenderContext);
    if (requiredCount > 0) {
      const fallbackArgs = Array.from({ length: requiredCount }, () => aliasBasicType((ctx as RenderContext).functionUnknownType || "any", ctx as RenderContext));
      return `${outTypeName(value)}<${fallbackArgs.join(",")}>`;
    }
    return outTypeName(value);
  }

  return aliasBasicType(unknownType, ctx as RenderContext);
}

function isFullArrowType(value: string): boolean {
  const arrowIndex = findTopLevelArrow(value);
  if (arrowIndex < 0) return false;
  const left = value.slice(0, arrowIndex).trim();
  return left.startsWith("(") || left.includes(":") || left.includes("...");
}

export function toSafeGenericArgument(arg: string, ctx: RenderContext): string {
  const value = toSafeJsdocType(arg, ctx);
  const unknown = aliasBasicType(ctx.unknownType || "unknown", ctx);
  if (!value || value === "*" || value === "unknown" || value === unknown) return aliasBasicType(ctx.functionUnknownType || "any", ctx);
  return value;
}

export function getRequiredTemplateCount(typeName: string, ctx: RenderContext): number {
  if (!ctx.originalTypeNames?.has(typeName)) return 0;
  const entry = ctx.settings?.__typeEntries?.get(typeName);
  if (!entry) return 0;
  return extractTemplateNames(typeName, entry.typeEntry, entry.typeInfo).length;
}

export function aliasBasicType(type: string, ctx: Partial<RenderContext> = {}): string {
  const aliases = ctx.settings?.shorthand?.enabled ? ctx.settings.shorthand.types : null;
  if (!aliases) return type;
  const key = String(type || "").trim();
  return aliases[key] ?? key;
}

export function extractTemplateNames(typeName: string, typeEntry?: CompletionEntry, typeInfo?: CompletionTypeRecord): string[] {
  const detail = String(typeEntry?.detail || typeInfo?.detail || "");
  const escaped = escapeRegExp(typeName);
  const patterns = [
    new RegExp(`\\binterface\\s+${escaped}\\s*<([^>]+)>`),
    new RegExp(`\\bclass\\s+${escaped}\\s*<([^>]+)>`),
    new RegExp(`\\btype\\s+${escaped}\\s*<([^>]+)>`),
  ];

  for (const pattern of patterns) {
    const match = detail.match(pattern);
    if (!match?.[1]) continue;

    return splitTopLevel(match[1], ",")
      .map((part) => part.replace(/\s+extends\s+[\s\S]*$/g, "").replace(/\s*=\s*[\s\S]*$/g, "").trim())
      .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
  }

  return [];
}

export function isPrimitiveOrBuiltin(value: string): boolean {
  return [
    "*", "any", "unknown", "void", "undefined", "null", "never",
    "string", "String", "number", "Number", "boolean", "Boolean",
    "bigint", "BigInt", "symbol", "Symbol", "object", "Object",
    "Function", "function", "Array", "Date", "RegExp", "Error", "Promise",
  ].includes(value);
}

export function parseGenericType(value: string): { name: string; args: string[] } | null {
  const lt = value.indexOf("<");
  if (lt < 0 || !value.endsWith(">")) return null;
  const name = value.slice(0, lt).trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null;
  const inner = value.slice(lt + 1, -1);
  return { name, args: splitTopLevel(inner, ",") };
}

export function parseArrowFunctionType(value: string): { params: ParsedParam[]; returnType: string } | null {
  const arrowIndex = findTopLevelArrow(value);
  if (arrowIndex < 0) return null;
  let left = value.slice(0, arrowIndex).trim();
  const right = value.slice(arrowIndex + 2).trim();
  if (left.startsWith("(") && left.endsWith(")")) left = left.slice(1, -1).trim();
  return { params: parseParams(left), returnType: right };
}

export function findTopLevelArrow(source: string): number {
  let depth = 0;
  let quote = "";

  for (let i = 0; i < source.length - 1; i++) {
    const char = source[i];
    const next = source[i + 1];
    const prev = source[i - 1];

    if (quote) {
      if (char === quote && prev !== "\\") quote = "";
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }

    if (char === "(" || char === "<" || char === "{" || char === "[") depth++;
    else if (char === ")" || char === ">" || char === "}" || char === "]") depth = Math.max(0, depth - 1);
    if (depth === 0 && char === "=" && next === ">") return i;
  }

  return -1;
}

export function parseCallableDetail(detail: string, expectedName = ""): ParsedCallable {
  const source = String(detail || "").trim();
  const fallback = { name: expectedName || "", params: [], returnType: "" };
  if (!source) return fallback;

  const compact = source.replace(/\s+/g, " ").replace(/;$/, "").trim();
  const openParenIndex = compact.indexOf("(");
  if (openParenIndex < 0) return fallback;
  const closeParenIndex = findMatchingParen(compact, openParenIndex);
  if (closeParenIndex < 0) return fallback;

  const inside = compact.slice(openParenIndex + 1, closeParenIndex).trim();
  const after = compact.slice(closeParenIndex + 1).trim();
  let returnType = "";

  if (after.startsWith(":")) returnType = after.slice(1).trim();
  else if (after.startsWith("=>")) returnType = after.slice(2).trim();

  returnType = returnType.replace(/[;{].*$/, "").trim();
  return { name: expectedName || "", params: parseParams(inside), returnType };
}

export function parseParams(paramSource: string): ParsedParam[] {
  if (!String(paramSource || "").trim()) return [];

  return splitTopLevel(paramSource, ",").map((rawParam, index) => {
    let raw = rawParam.trim();
    const rest = raw.startsWith("...");
    if (rest) raw = raw.slice(3).trim();
    raw = raw.replace(/=.*$/, "").trim();

    const colonIndex = findTopLevelChar(raw, ":");
    let name = "";
    let type = "";

    if (colonIndex >= 0) {
      name = raw.slice(0, colonIndex).trim();
      type = raw.slice(colonIndex + 1).trim();
    } else {
      name = raw.trim();
      type = "*";
    }

    const optional = /\?$/.test(name);
    name = name.replace(/\?$/, "").replace(/[^\w$]/g, "").trim();
    if (!name) name = `arg${index + 1}`;
    if (rest) name = `...${name}`;

    return { name, type: type || "*", optional, rest };
  });
}

export function extractPropertyType(detail: string): string {
  const text = String(detail || "").trim();
  const colonIndex = findTopLevelChar(text, ":");
  if (colonIndex < 0) return "";
  return text.slice(colonIndex + 1).replace(/[;=].*$/, "").trim();
}

export function extractTypeAliasType(detail: string): string {
  const text = String(detail || "").trim();
  const equalsIndex = findTopLevelChar(text, "=");
  if (equalsIndex < 0) return "";
  return text.slice(equalsIndex + 1).replace(/;$/, "").trim();
}

export function splitTopLevel(source: string, delimiter: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const prev = source[i - 1];

    if (quote) {
      if (char === quote && prev !== "\\") quote = "";
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }

    if (char === "(" || char === "<" || char === "{" || char === "[") depth++;
    else if (char === ")" || char === ">" || char === "}" || char === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0 && char === delimiter) {
      out.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }

  out.push(source.slice(start).trim());
  return out.filter(Boolean);
}

export function findTopLevelChar(source: string, target: string): number {
  let depth = 0;
  let quote = "";

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const prev = source[i - 1];

    if (quote) {
      if (char === quote && prev !== "\\") quote = "";
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }

    if (char === "(" || char === "<" || char === "{" || char === "[") depth++;
    else if (char === ")" || char === ">" || char === "}" || char === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0 && char === target) return i;
  }

  return -1;
}

export function findMatchingParen(source: string, openIndex: number): number {
  let depth = 0;
  let quote = "";

  for (let i = openIndex; i < source.length; i++) {
    const char = source[i];
    const prev = source[i - 1];

    if (quote) {
      if (char === quote && prev !== "\\") quote = "";
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }

    if (char === "(") depth++;
    else if (char === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

export function appendRawDocLines(lines: string[], documentation: string): void {
  const text = cleanDoc(documentation);
  if (!text) return;
  for (const line of text.split("\n")) lines.push(line);
}

export function cleanDoc(value: string): string {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function oneLine(value: string): string {
  return cleanDoc(value).replace(/\s+/g, " ").trim();
}

export function escapeRegExp(value: string): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
