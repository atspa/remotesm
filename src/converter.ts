import type { CompletionEntry, CompletionResult, CompletionTypeRecord, DtsCompletionConverter } from "./types";

interface ConverterState {
  flat: CompletionEntry[];
  byScope: Record<string, CompletionEntry[]>;
  types: Record<string, CompletionTypeRecord>;
  seen: Set<string>;
}

/** Create a converter from .d.ts source text to JSON-serializable completion entries. */
export function createDtsCompletionConverter(ts: any): DtsCompletionConverter {
  function cleanText(value: string): string {
    return String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function cleanOneLine(value: string): string {
    return cleanText(value).replace(/\s+/g, " ").trim();
  }

  function stripDeclareAndExport(value: string): string {
    return cleanOneLine(
      value
        .replace(/\bdeclare\s+/g, "")
        .replace(/\bexport\s+/g, "")
        .replace(/\bdefault\s+/g, "")
    );
  }

  function getPrintedDetail(sourceFile: any, node: any): string {
    return stripDeclareAndExport(node.getText(sourceFile));
  }

  function getLeadingJsDoc(sourceText: string, node: any): string {
    const ranges = ts.getLeadingCommentRanges(sourceText, node.pos) || [];

    const docs = ranges
      .map((range: any) => sourceText.slice(range.pos, range.end))
      .filter((text: string) => text.startsWith("/**"))
      .map((text: string) => {
        return text
          .replace(/^\/\*\*/, "")
          .replace(/\*\/$/, "")
          .replace(/^\s*\*\s?/gm, "")
          .trim();
      })
      .filter(Boolean);

    return docs.length ? cleanText(docs.join("\n\n")) : "";
  }

  function nodeNameText(sourceFile: any, nameNode: any): string {
    if (!nameNode) return "";
    return nameNode.getText(sourceFile).replace(/^["']|["']$/g, "");
  }

  function getTypeText(sourceFile: any, typeNode: any): string {
    return typeNode ? cleanOneLine(typeNode.getText(sourceFile)) : "";
  }

  function getReturnTypeText(sourceFile: any, node: any): string {
    return node?.type ? getTypeText(sourceFile, node.type) : "";
  }

  function getParamName(sourceFile: any, param: any, index: number): string {
    if (!param?.name) return `arg${index + 1}`;
    if (ts.isIdentifier(param.name)) return param.name.text;
    return `arg${index + 1}`;
  }

  function sanitizeSnippetPlaceholder(value: string): string {
    return String(value || "arg")
      .replace(/[{}$\\]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildFunctionInsertText(sourceFile: any, name: string, node: any): string {
    const params = Array.from(node.parameters || []) as any[];

    const args = params.map((param, index) => {
      const rawName = getParamName(sourceFile, param, index);
      const placeholder = sanitizeSnippetPlaceholder(rawName);
      const token = "${" + (index + 1) + ":" + placeholder + "}";

      return param.dotDotDotToken ? `...${token}` : token;
    });

    return `${name}(${args.join(", ")})`;
  }

  function buildConstructorInsertText(sourceFile: any, name: string, node: any): string {
    const params = Array.from(node.parameters || []) as any[];

    const args = params.map((param, index) => {
      const rawName = getParamName(sourceFile, param, index);
      const placeholder = sanitizeSnippetPlaceholder(rawName);

      return "${" + (index + 1) + ":" + placeholder + "}";
    });

    return `new ${name}(${args.join(", ")})`;
  }

  function makeEntry(entry: Partial<CompletionEntry>): CompletionEntry {
    const {
      scope = "global",
      label = "",
      kind = "Text",
      insertText,
      detail = "",
      documentation = "",
      type = "",
      returnType = "",
      memberOf = "",
      exportName = "",
    } = entry;

    return {
      scope,
      label,
      kind,
      insertText: insertText || label,
      detail,
      documentation,
      type,
      returnType,
      memberOf,
      exportName,
    };
  }

  function addEntry(state: ConverterState, entry: CompletionEntry): void {
    if (!entry?.label) return;

    const key = [entry.scope, entry.kind, entry.label, entry.detail].join("\u0000");

    if (state.seen.has(key)) return;

    state.seen.add(key);
    state.flat.push(entry);

    if (!state.byScope[entry.scope]) state.byScope[entry.scope] = [];
    state.byScope[entry.scope].push(entry);
  }

  function ensureTypeRecord(state: ConverterState, name: string, kind: string, detail: string): void {
    if (!name) return;

    if (!state.types[name]) {
      state.types[name] = {
        kind,
        detail: detail || "",
        members: [],
      };
    }
  }

  function addTypeMember(state: ConverterState, typeName: string, memberEntry: CompletionEntry): void {
    if (!typeName || !memberEntry) return;

    ensureTypeRecord(state, typeName, "Type", "");
    state.types[typeName].members.push({ ...memberEntry });
  }

  function handleVariableStatement(sourceFile: any, sourceText: string, node: any, scope: string, state: ConverterState): void {
    const documentation = getLeadingJsDoc(sourceText, node);

    for (const decl of node.declarationList.declarations || []) {
      const label = nodeNameText(sourceFile, decl.name);
      if (!label) continue;

      addEntry(state, makeEntry({
        scope,
        label,
        kind: "Variable",
        insertText: label,
        detail: getPrintedDetail(sourceFile, decl),
        documentation,
        type: getTypeText(sourceFile, decl.type),
      }));
    }
  }

  function handleFunctionLike(sourceFile: any, sourceText: string, node: any, scope: string, state: ConverterState, forcedName?: string): void {
    const label = forcedName || nodeNameText(sourceFile, node.name);
    if (!label) return;

    addEntry(state, makeEntry({
      scope,
      label,
      kind: "Function",
      insertText: buildFunctionInsertText(sourceFile, label, node),
      detail: getPrintedDetail(sourceFile, node),
      documentation: getLeadingJsDoc(sourceText, node),
      returnType: getReturnTypeText(sourceFile, node),
    }));
  }

  function handlePropertyMember(sourceFile: any, sourceText: string, node: any, scope: string, state: ConverterState, ownerName: string): void {
    const label = nodeNameText(sourceFile, node.name);
    if (!label) return;

    const entry = makeEntry({
      scope,
      label,
      kind: "Property",
      insertText: label,
      detail: getPrintedDetail(sourceFile, node),
      documentation: getLeadingJsDoc(sourceText, node),
      type: getTypeText(sourceFile, node.type),
      memberOf: ownerName,
    });

    addEntry(state, entry);
    addTypeMember(state, ownerName, entry);
  }

  function handleMethodMember(sourceFile: any, sourceText: string, node: any, scope: string, state: ConverterState, ownerName: string): void {
    const label = nodeNameText(sourceFile, node.name);
    if (!label) return;

    const entry = makeEntry({
      scope,
      label,
      kind: "Method",
      insertText: buildFunctionInsertText(sourceFile, label, node),
      detail: getPrintedDetail(sourceFile, node),
      documentation: getLeadingJsDoc(sourceText, node),
      returnType: getReturnTypeText(sourceFile, node),
      memberOf: ownerName,
    });

    addEntry(state, entry);
    addTypeMember(state, ownerName, entry);
  }

  function handleConstructorMember(sourceFile: any, sourceText: string, node: any, scope: string, state: ConverterState, ownerName: string): void {
    const entry = makeEntry({
      scope,
      label: "constructor",
      kind: "Constructor",
      insertText: buildConstructorInsertText(sourceFile, ownerName || "", node),
      detail: getPrintedDetail(sourceFile, node),
      documentation: getLeadingJsDoc(sourceText, node),
      memberOf: ownerName,
    });

    addEntry(state, entry);
    addTypeMember(state, ownerName, entry);
  }

  function handleIndexSignature(sourceFile: any, sourceText: string, node: any, scope: string, state: ConverterState, ownerName: string): void {
    const entry = makeEntry({
      scope,
      label: "[index]",
      kind: "Property",
      insertText: "",
      detail: getPrintedDetail(sourceFile, node),
      documentation: getLeadingJsDoc(sourceText, node),
      type: getReturnTypeText(sourceFile, node),
      memberOf: ownerName,
    });

    addEntry(state, entry);
    addTypeMember(state, ownerName, entry);
  }

  function handleMembers(sourceFile: any, sourceText: string, members: any[], ownerName: string, state: ConverterState): void {
    const scope = `type:${ownerName}`;

    for (const member of members || []) {
      if (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) {
        handlePropertyMember(sourceFile, sourceText, member, scope, state, ownerName);
        continue;
      }

      if (ts.isMethodSignature(member) || ts.isMethodDeclaration(member)) {
        handleMethodMember(sourceFile, sourceText, member, scope, state, ownerName);
        continue;
      }

      if (ts.isConstructorDeclaration(member) || ts.isConstructSignatureDeclaration(member)) {
        handleConstructorMember(sourceFile, sourceText, member, scope, state, ownerName);
        continue;
      }

      if (ts.isIndexSignatureDeclaration(member)) {
        handleIndexSignature(sourceFile, sourceText, member, scope, state, ownerName);
        continue;
      }

      if (ts.isCallSignatureDeclaration(member)) {
        const entry = makeEntry({
          scope,
          label: "(call)",
          kind: "Function",
          insertText: buildFunctionInsertText(sourceFile, "", member).replace(/^\(/, "("),
          detail: getPrintedDetail(sourceFile, member),
          documentation: getLeadingJsDoc(sourceText, member),
          returnType: getReturnTypeText(sourceFile, member),
          memberOf: ownerName,
        });

        addEntry(state, entry);
        addTypeMember(state, ownerName, entry);
      }
    }
  }

  function handleInterface(sourceFile: any, sourceText: string, node: any, scope: string, state: ConverterState): void {
    const label = nodeNameText(sourceFile, node.name);
    if (!label) return;

    const detail = getPrintedDetail(sourceFile, node);
    ensureTypeRecord(state, label, "Interface", detail);

    addEntry(state, makeEntry({
      scope,
      label,
      kind: "Interface",
      insertText: label,
      detail,
      documentation: getLeadingJsDoc(sourceText, node),
    }));

    handleMembers(sourceFile, sourceText, node.members, label, state);
  }

  function handleClass(sourceFile: any, sourceText: string, node: any, scope: string, state: ConverterState): void {
    const label = nodeNameText(sourceFile, node.name);
    if (!label) return;

    const detail = getPrintedDetail(sourceFile, node);
    ensureTypeRecord(state, label, "Class", detail);

    addEntry(state, makeEntry({
      scope,
      label,
      kind: "Class",
      insertText: label,
      detail,
      documentation: getLeadingJsDoc(sourceText, node),
    }));

    handleMembers(sourceFile, sourceText, node.members, label, state);
  }

  function handleTypeAlias(sourceFile: any, sourceText: string, node: any, scope: string, state: ConverterState): void {
    const label = nodeNameText(sourceFile, node.name);
    if (!label) return;

    const detail = getPrintedDetail(sourceFile, node);
    ensureTypeRecord(state, label, "TypeAlias", detail);

    addEntry(state, makeEntry({
      scope,
      label,
      kind: "TypeAlias",
      insertText: label,
      detail,
      documentation: getLeadingJsDoc(sourceText, node),
      type: getTypeText(sourceFile, node.type),
    }));
  }

  function handleEnum(sourceFile: any, sourceText: string, node: any, scope: string, state: ConverterState): void {
    const label = nodeNameText(sourceFile, node.name);
    if (!label) return;

    const detail = getPrintedDetail(sourceFile, node);
    const enumScope = `type:${label}`;
    ensureTypeRecord(state, label, "Enum", detail);

    addEntry(state, makeEntry({
      scope,
      label,
      kind: "Enum",
      insertText: label,
      detail,
      documentation: getLeadingJsDoc(sourceText, node),
    }));

    for (const member of node.members || []) {
      const memberLabel = nodeNameText(sourceFile, member.name);
      if (!memberLabel) continue;

      const entry = makeEntry({
        scope: enumScope,
        label: memberLabel,
        kind: "EnumMember",
        insertText: memberLabel,
        detail: getPrintedDetail(sourceFile, member),
        documentation: getLeadingJsDoc(sourceText, member),
        memberOf: label,
      });

      addEntry(state, entry);
      addTypeMember(state, label, entry);
    }
  }

  function moduleNameFromNode(sourceFile: any, node: any): string {
    if (!node?.name) return "module";
    return node.name.getText(sourceFile).replace(/^["']|["']$/g, "");
  }

  function walk(sourceFile: any, sourceText: string, node: any, scope: string, state: ConverterState): void {
    if (ts.isModuleDeclaration(node)) {
      const name = moduleNameFromNode(sourceFile, node);
      const nextScope = node.flags & ts.NodeFlags.Namespace ? `namespace:${name}` : `module:${name}`;

      if (node.body) walk(sourceFile, sourceText, node.body, nextScope, state);
      return;
    }

    if (ts.isModuleBlock(node)) {
      for (const statement of node.statements || []) walk(sourceFile, sourceText, statement, scope, state);
      return;
    }

    if (ts.isVariableStatement(node)) return handleVariableStatement(sourceFile, sourceText, node, scope, state);
    if (ts.isFunctionDeclaration(node)) return handleFunctionLike(sourceFile, sourceText, node, scope, state);
    if (ts.isInterfaceDeclaration(node)) return handleInterface(sourceFile, sourceText, node, scope, state);
    if (ts.isClassDeclaration(node)) return handleClass(sourceFile, sourceText, node, scope, state);
    if (ts.isTypeAliasDeclaration(node)) return handleTypeAlias(sourceFile, sourceText, node, scope, state);
    if (ts.isEnumDeclaration(node)) return handleEnum(sourceFile, sourceText, node, scope, state);

    if (ts.isExportAssignment(node)) {
      const label = node.expression.getText(sourceFile);

      addEntry(state, makeEntry({
        scope,
        label,
        kind: "Export",
        insertText: label,
        detail: getPrintedDetail(sourceFile, node),
        documentation: getLeadingJsDoc(sourceText, node),
        exportName: label,
      }));

      return;
    }

    ts.forEachChild(node, (child: any) => walk(sourceFile, sourceText, child, scope, state));
  }

  function convertText(dtsText: string, options: { fileName?: string } = {}): CompletionResult {
    const fileName = options.fileName || "virtual.d.ts";
    const sourceText = String(dtsText || "");

    const sourceFile = ts.createSourceFile(
      fileName,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    const state: ConverterState = {
      flat: [],
      byScope: {},
      types: {},
      seen: new Set(),
    };

    walk(sourceFile, sourceText, sourceFile, "global", state);

    return {
      flat: state.flat,
      byScope: state.byScope,
      types: state.types,
    };
  }

  return { convertText };
}
