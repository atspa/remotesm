//#region \0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
//#endregion
//#region src/cache.ts
var cache_exports = /* @__PURE__ */ __exportAll({
	clearRemoteEsmVm: () => clearRemoteEsmVm,
	remoteEsmVm: () => remoteEsmVm,
	vmMemo: () => vmMemo
});
const root = globalThis;
const remoteEsmVm = root.__remoteEsmVm || (root.__remoteEsmVm = {
	text: /* @__PURE__ */ new Map(),
	json: /* @__PURE__ */ new Map(),
	module: /* @__PURE__ */ new Map(),
	dtsUrl: /* @__PURE__ */ new Map(),
	dtsGraph: /* @__PURE__ */ new Map(),
	package: /* @__PURE__ */ new Map(),
	ts: null,
	converter: null
});
/** Memoize an async computation in a virtual-memory map. */
function vmMemo(map, key, factory) {
	if (map.has(key)) return map.get(key);
	const promise = Promise.resolve().then(factory).catch((error) => {
		map.delete(key);
		throw error;
	});
	map.set(key, promise);
	return promise;
}
/** Clear all virtual-memory caches except the object identity itself. */
function clearRemoteEsmVm() {
	remoteEsmVm.text.clear();
	remoteEsmVm.json.clear();
	remoteEsmVm.module.clear();
	remoteEsmVm.dtsUrl.clear();
	remoteEsmVm.dtsGraph.clear();
	remoteEsmVm.package.clear();
	remoteEsmVm.ts = null;
	remoteEsmVm.converter = null;
}
//#endregion
//#region src/converter.ts
var converter_exports = /* @__PURE__ */ __exportAll({ createDtsCompletionConverter: () => createDtsCompletionConverter });
/** Create a converter from .d.ts source text to JSON-serializable completion entries. */
function createDtsCompletionConverter(ts) {
	function cleanText(value) {
		return String(value || "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
	}
	function cleanOneLine(value) {
		return cleanText(value).replace(/\s+/g, " ").trim();
	}
	function stripDeclareAndExport(value) {
		return cleanOneLine(value.replace(/\bdeclare\s+/g, "").replace(/\bexport\s+/g, "").replace(/\bdefault\s+/g, ""));
	}
	function getPrintedDetail(sourceFile, node) {
		return stripDeclareAndExport(node.getText(sourceFile));
	}
	function getLeadingJsDoc(sourceText, node) {
		const docs = (ts.getLeadingCommentRanges(sourceText, node.pos) || []).map((range) => sourceText.slice(range.pos, range.end)).filter((text) => text.startsWith("/**")).map((text) => {
			return text.replace(/^\/\*\*/, "").replace(/\*\/$/, "").replace(/^\s*\*\s?/gm, "").trim();
		}).filter(Boolean);
		return docs.length ? cleanText(docs.join("\n\n")) : "";
	}
	function nodeNameText(sourceFile, nameNode) {
		if (!nameNode) return "";
		return nameNode.getText(sourceFile).replace(/^["']|["']$/g, "");
	}
	function getTypeText(sourceFile, typeNode) {
		return typeNode ? cleanOneLine(typeNode.getText(sourceFile)) : "";
	}
	function getReturnTypeText(sourceFile, node) {
		return node?.type ? getTypeText(sourceFile, node.type) : "";
	}
	function getParamName(sourceFile, param, index) {
		if (!param?.name) return `arg${index + 1}`;
		if (ts.isIdentifier(param.name)) return param.name.text;
		return `arg${index + 1}`;
	}
	function sanitizeSnippetPlaceholder(value) {
		return String(value || "arg").replace(/[{}$\\]/g, "").replace(/\s+/g, " ").trim();
	}
	function buildFunctionInsertText(sourceFile, name, node) {
		return `${name}(${Array.from(node.parameters || []).map((param, index) => {
			const placeholder = sanitizeSnippetPlaceholder(getParamName(sourceFile, param, index));
			const token = "${" + (index + 1) + ":" + placeholder + "}";
			return param.dotDotDotToken ? `...${token}` : token;
		}).join(", ")})`;
	}
	function buildConstructorInsertText(sourceFile, name, node) {
		return `new ${name}(${Array.from(node.parameters || []).map((param, index) => {
			const placeholder = sanitizeSnippetPlaceholder(getParamName(sourceFile, param, index));
			return "${" + (index + 1) + ":" + placeholder + "}";
		}).join(", ")})`;
	}
	function makeEntry(entry) {
		const { scope = "global", label = "", kind = "Text", insertText, detail = "", documentation = "", type = "", returnType = "", memberOf = "", exportName = "", isStatic = false } = entry;
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
			isStatic
		};
	}
	function addEntry(state, entry) {
		if (!entry?.label) return;
		const key = [
			entry.scope,
			entry.kind,
			entry.label,
			entry.detail
		].join("\0");
		if (state.seen.has(key)) return;
		state.seen.add(key);
		state.flat.push(entry);
		(state.byScope[entry.scope] ??= []).push(entry);
	}
	function ensureTypeRecord(state, name, kind, detail) {
		if (!name) return;
		if (!state.types[name]) state.types[name] = {
			kind,
			detail: detail || "",
			members: []
		};
	}
	function addTypeMember(state, typeName, memberEntry) {
		if (!typeName || !memberEntry) return;
		ensureTypeRecord(state, typeName, "Type", "");
		state.types[typeName]?.members.push({ ...memberEntry });
	}
	function handleVariableStatement(sourceFile, sourceText, node, scope, state) {
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
				type: getTypeText(sourceFile, decl.type)
			}));
		}
	}
	function handleFunctionLike(sourceFile, sourceText, node, scope, state, forcedName) {
		const label = forcedName || nodeNameText(sourceFile, node.name);
		if (!label) return;
		addEntry(state, makeEntry({
			scope,
			label,
			kind: "Function",
			insertText: buildFunctionInsertText(sourceFile, label, node),
			detail: getPrintedDetail(sourceFile, node),
			documentation: getLeadingJsDoc(sourceText, node),
			returnType: getReturnTypeText(sourceFile, node)
		}));
	}
	function hasStaticModifier(node) {
		return Array.from(node?.modifiers || []).some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword);
	}
	function handlePropertyMember(sourceFile, sourceText, node, scope, state, ownerName, isStatic = false) {
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
			isStatic
		});
		addEntry(state, entry);
		addTypeMember(state, ownerName, entry);
	}
	function handleMethodMember(sourceFile, sourceText, node, scope, state, ownerName, isStatic = false) {
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
			isStatic
		});
		addEntry(state, entry);
		addTypeMember(state, ownerName, entry);
	}
	function handleConstructorMember(sourceFile, sourceText, node, scope, state, ownerName) {
		const entry = makeEntry({
			scope,
			label: "constructor",
			kind: "Constructor",
			insertText: buildConstructorInsertText(sourceFile, ownerName || "", node),
			detail: getPrintedDetail(sourceFile, node),
			documentation: getLeadingJsDoc(sourceText, node),
			memberOf: ownerName
		});
		addEntry(state, entry);
		addTypeMember(state, ownerName, entry);
	}
	function handleIndexSignature(sourceFile, sourceText, node, scope, state, ownerName) {
		const entry = makeEntry({
			scope,
			label: "[index]",
			kind: "Property",
			insertText: "",
			detail: getPrintedDetail(sourceFile, node),
			documentation: getLeadingJsDoc(sourceText, node),
			type: getReturnTypeText(sourceFile, node),
			memberOf: ownerName
		});
		addEntry(state, entry);
		addTypeMember(state, ownerName, entry);
	}
	function handleMembers(sourceFile, sourceText, members, ownerName, state) {
		const scope = `type:${ownerName}`;
		for (const member of members || []) {
			const isStatic = hasStaticModifier(member);
			if (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) {
				handlePropertyMember(sourceFile, sourceText, member, scope, state, ownerName, isStatic);
				continue;
			}
			if (ts.isMethodSignature(member) || ts.isMethodDeclaration(member)) {
				handleMethodMember(sourceFile, sourceText, member, scope, state, ownerName, isStatic);
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
					memberOf: ownerName
				});
				addEntry(state, entry);
				addTypeMember(state, ownerName, entry);
			}
		}
	}
	function handleInterface(sourceFile, sourceText, node, scope, state) {
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
			documentation: getLeadingJsDoc(sourceText, node)
		}));
		handleMembers(sourceFile, sourceText, node.members, label, state);
	}
	function handleClass(sourceFile, sourceText, node, scope, state) {
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
			documentation: getLeadingJsDoc(sourceText, node)
		}));
		handleMembers(sourceFile, sourceText, node.members, label, state);
	}
	function handleTypeAlias(sourceFile, sourceText, node, scope, state) {
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
			type: getTypeText(sourceFile, node.type)
		}));
	}
	function handleEnum(sourceFile, sourceText, node, scope, state) {
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
			documentation: getLeadingJsDoc(sourceText, node)
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
				memberOf: label
			});
			addEntry(state, entry);
			addTypeMember(state, label, entry);
		}
	}
	function moduleNameFromNode(sourceFile, node) {
		if (!node?.name) return "module";
		return node.name.getText(sourceFile).replace(/^["']|["']$/g, "");
	}
	function walk(sourceFile, sourceText, node, scope, state) {
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
				exportName: label
			}));
			return;
		}
		ts.forEachChild(node, (child) => walk(sourceFile, sourceText, child, scope, state));
	}
	function convertText(dtsText, options = {}) {
		const fileName = options.fileName || "virtual.d.ts";
		const sourceText = String(dtsText || "");
		const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
		const state = {
			flat: [],
			byScope: {},
			types: {},
			seen: /* @__PURE__ */ new Set()
		};
		walk(sourceFile, sourceText, sourceFile, "global", state);
		return {
			flat: state.flat,
			byScope: state.byScope,
			types: state.types
		};
	}
	return { convertText };
}
//#endregion
//#region src/core/lib/string.ts
var string_exports = /* @__PURE__ */ __exportAll({
	escapeJsString: () => escapeJsString,
	exportTypeAccessor: () => exportTypeAccessor,
	isIdentifierName: () => isIdentifierName,
	propertyAccessor: () => propertyAccessor,
	runtimePropertyAccessor: () => runtimePropertyAccessor,
	sanitizeBindingName: () => sanitizeBindingName
});
function escapeJsString(value) {
	return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}
function isIdentifierName(value) {
	return /^[A-Za-z_$][\w$]*$/.test(value);
}
function sanitizeBindingName(name) {
	if (name === "default") return "defaultExport";
	const value = String(name || "").replace(/[^\w$]/g, "_");
	if (!value) return "value";
	return /^\d/.test(value) ? `_${value}` : value;
}
function propertyAccessor(key) {
	return isIdentifierName(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}
const exportTypeAccessor = propertyAccessor;
const runtimePropertyAccessor = propertyAccessor;
//#endregion
//#region src/core/index.ts
var core_default = { ...string_exports };
//#endregion
//#region src/network.ts
var network_exports = /* @__PURE__ */ __exportAll({
	getJson: () => getJson,
	getText: () => getText,
	importModuleCached: () => importModuleCached,
	loadTypeScript: () => loadTypeScript
});
/** Fetch text through Airtable remoteFetchAsync when available, otherwise fetch. */
async function getText(url) {
	return vmMemo(remoteEsmVm.text, url, async () => {
		const remoteFetch = globalThis.remoteFetchAsync;
		let response;
		if (typeof remoteFetch === "function") response = await remoteFetch(url);
		else if (typeof fetch === "function") response = await fetch(url);
		else throw new Error("No fetch API found. Expected remoteFetchAsync or fetch.");
		if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
		return await response.text();
	});
}
/** Fetch and parse JSON. */
async function getJson(url) {
	return vmMemo(remoteEsmVm.json, url, async () => {
		return JSON.parse(await getText(url));
	});
}
/** Import a module URL with memory caching. */
async function importModuleCached(url) {
	return vmMemo(remoteEsmVm.module, url, async () => {
		return await import(url);
	});
}
/** Load the TypeScript compiler API from esm.sh. */
async function loadTypeScript(tsUrl = "https://esm.sh/typescript") {
	if (remoteEsmVm.ts) return remoteEsmVm.ts;
	const tsModule = await import(tsUrl);
	remoteEsmVm.ts = tsModule.default || tsModule;
	return remoteEsmVm.ts;
}
//#endregion
//#region src/url.ts
var url_exports = /* @__PURE__ */ __exportAll({
	appendQuery: () => appendQuery,
	esmMetaUrl: () => esmMetaUrl,
	esmUrl: () => esmUrl,
	inferSpecifierFromUrl: () => inferSpecifierFromUrl,
	isHttpUrl: () => isHttpUrl,
	normalizePackageSpecifier: () => normalizePackageSpecifier,
	normalizeRemoteEsmTarget: () => normalizeRemoteEsmTarget,
	toAbsoluteCdnUrl: () => toAbsoluteCdnUrl
});
/** Test whether a string is an absolute HTTP(S) URL. */
function isHttpUrl(value) {
	return /^https?:\/\//i.test(String(value || ""));
}
/** Append query params to a URL. Empty-string values become valueless query flags. */
function appendQuery(url, params = {}) {
	const u = new URL(url);
	for (const [key, value] of Object.entries(params)) if (value !== void 0 && value !== null && value !== false) u.searchParams.set(key, value === true ? "" : String(value));
	return u.href.replace(/=$/, "");
}
/** Build an esm.sh runtime URL from an npm/GitHub specifier. */
function esmUrl(specifier, options = {}) {
	let url = `${(options.esmBase || "https://esm.sh").replace(/\/$/, "")}/${normalizePackageSpecifier(String(specifier).replace(/^\//, ""))}`;
	if (options.bundle) url = appendQuery(url, { bundle: "" });
	if (options.target) url = appendQuery(url, { target: options.target });
	if (options.dev) url = appendQuery(url, { dev: "" });
	return url;
}
/** Build an esm.sh metadata URL. */
function esmMetaUrl(specifier, options = {}) {
	return appendQuery(esmUrl(specifier, options), { meta: "" });
}
/** Convert a metadata path to an absolute CDN URL. */
function toAbsoluteCdnUrl(pathOrUrl, baseUrlOrOptions = {}) {
	if (!pathOrUrl) return "";
	if (isHttpUrl(pathOrUrl)) return pathOrUrl;
	if (typeof baseUrlOrOptions === "string" && isHttpUrl(baseUrlOrOptions)) return `${new URL(baseUrlOrOptions).origin}/${String(pathOrUrl).replace(/^\//, "")}`;
	return `${(baseUrlOrOptions.esmBase || "https://esm.sh").replace(/\/$/, "")}/${String(pathOrUrl).replace(/^\//, "")}`;
}
/** Normalize a user-supplied package/URL/object into runtime/meta/dts URLs. */
function normalizeRemoteEsmTarget(input, options = {}) {
	const esmBase = options.esmBase || "https://esm.sh";
	if (typeof input === "object" && input !== null) {
		const runtimeUrl = input.runtimeUrl || input.url || options.runtimeUrl || options.url || "";
		const specifier = input.specifier || options.specifier || (runtimeUrl ? inferSpecifierFromUrl(runtimeUrl) : "") || runtimeUrl;
		const finalRuntimeUrl = runtimeUrl || esmUrl(specifier, options);
		return {
			input,
			specifier,
			runtimeUrl: finalRuntimeUrl,
			metaUrl: input.metaUrl || options.metaUrl || (finalRuntimeUrl ? appendQuery(finalRuntimeUrl, { meta: "" }) : ""),
			dtsUrl: input.dtsUrl || options.dtsUrl || "",
			isUrl: !!runtimeUrl && isHttpUrl(runtimeUrl),
			esmBase
		};
	}
	const raw = String(input || "").trim();
	const optionRuntimeUrl = options.runtimeUrl || options.url || "";
	if (optionRuntimeUrl || isHttpUrl(raw)) {
		const runtimeUrl = optionRuntimeUrl || raw;
		return {
			input,
			specifier: options.specifier || inferSpecifierFromUrl(runtimeUrl) || raw,
			runtimeUrl,
			metaUrl: options.metaUrl || appendQuery(runtimeUrl, { meta: "" }),
			dtsUrl: options.dtsUrl || "",
			isUrl: true,
			esmBase
		};
	}
	const specifier = normalizePackageSpecifier(raw || options.specifier || "");
	return {
		input,
		specifier,
		runtimeUrl: esmUrl(specifier, options),
		metaUrl: options.metaUrl || esmMetaUrl(specifier, options),
		dtsUrl: options.dtsUrl || "",
		isUrl: false,
		esmBase
	};
}
/** Normalize supported aliases such as npm: and github:user/repo#commit. */
function normalizePackageSpecifier(specifier) {
	let value = String(specifier || "").trim();
	if (value.startsWith("npm:")) return value.slice(4);
	if (value.startsWith("github:")) {
		value = value.slice(7);
		const [repoPath, commit] = value.split("#");
		return commit ? `gh/${repoPath}@${commit}` : `gh/${repoPath}`;
	}
	if (value.startsWith("gh:")) {
		value = value.slice(3);
		const [repoPath, commit] = value.split("#");
		return commit ? `gh/${repoPath}@${commit}` : `gh/${repoPath}`;
	}
	return value;
}
/** Infer a package-ish specifier from a CDN URL when possible. */
function inferSpecifierFromUrl(url) {
	try {
		const u = new URL(url);
		const path = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
		if (u.hostname.includes("esm.sh")) return path.replace(/^(stable|v\d+)\//, "");
		if (u.hostname.includes("unpkg.com") || u.hostname.includes("jsdelivr.net")) return path.replace(/^npm\//, "");
		return path || url;
	} catch {
		return url;
	}
}
//#endregion
//#region src/dtsGraph.ts
var dtsGraph_exports = /* @__PURE__ */ __exportAll({
	expandDtsCandidates: () => expandDtsCandidates,
	extractDtsImportSpecifiers: () => extractDtsImportSpecifiers,
	firstWorkingDtsCandidate: () => firstWorkingDtsCandidate,
	loadDtsGraph: () => loadDtsGraph,
	resolveDeclarationUrl: () => resolveDeclarationUrl,
	resolveDtsImport: () => resolveDtsImport
});
/** Resolve a target's declaration URL from explicit options or esm.sh ?meta. */
async function resolveDeclarationUrl(target, options = {}) {
	const cacheKey = JSON.stringify({
		explicit: target.dtsUrl || options.dtsUrl || "",
		metaUrl: target.metaUrl || options.metaUrl || "",
		runtimeUrl: target.runtimeUrl
	});
	return vmMemo(remoteEsmVm.dtsUrl, cacheKey, async () => {
		if (target.dtsUrl || options.dtsUrl) return toAbsoluteCdnUrl(target.dtsUrl || options.dtsUrl || "", target.runtimeUrl);
		if (!target.metaUrl) throw new Error(`No d.ts URL or metadata URL available for ${target.specifier}.`);
		const meta = await getJson(target.metaUrl);
		const dtsPath = meta?.default?.dts || meta?.dts || meta?.types || meta?.typings;
		if (!dtsPath) throw new Error(`No d.ts path found in metadata for ${target.specifier}.`);
		return toAbsoluteCdnUrl(dtsPath, target.runtimeUrl);
	});
}
/** Fetch an entry declaration file plus reachable declaration imports. */
async function loadDtsGraph(entryUrl, options = {}) {
	const { maxDepth = 5, maxFiles = 80, includeBareDtsImports = true } = options;
	const graphCacheKey = JSON.stringify({
		entryUrl,
		maxDepth,
		maxFiles,
		includeBareDtsImports,
		esmBase: options.esmBase || "https://esm.sh"
	});
	return vmMemo(remoteEsmVm.dtsGraph, graphCacheKey, async () => {
		const visited = /* @__PURE__ */ new Set();
		const files = [];
		const failed = [];
		async function visit(url, depth) {
			if (!url || visited.has(url)) return;
			if (files.length >= maxFiles) return;
			if (depth > maxDepth) return;
			visited.add(url);
			let text = "";
			try {
				text = await getText(url);
			} catch (error) {
				failed.push({
					url,
					error: String(error?.message || error)
				});
				return;
			}
			files.push({
				url,
				text
			});
			const imports = extractDtsImportSpecifiers(text);
			for (const imported of imports) {
				if (files.length >= maxFiles) break;
				const resolved = await resolveDtsImport(url, imported, {
					...options,
					includeBareDtsImports
				});
				if (resolved) await visit(resolved, depth + 1);
			}
		}
		await visit(entryUrl, 0);
		return {
			entryUrl,
			files,
			failed
		};
	});
}
/** Extract imported/referenced declaration specifiers from .d.ts text. */
function extractDtsImportSpecifiers(text) {
	const out = /* @__PURE__ */ new Set();
	const source = String(text || "");
	for (const pattern of [
		/\bimport\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
		/\bexport\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
		/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
		/\/\/\/\s*<reference\s+types=["']([^"']+)["']/g,
		/\/\/\/\s*<reference\s+path=["']([^"']+)["']/g
	]) {
		let match;
		while (match = pattern.exec(source)) if (match[1]) out.add(match[1]);
	}
	return Array.from(out);
}
/** Resolve an import found in a declaration file to a fetchable declaration URL. */
async function resolveDtsImport(fromUrl, imported, options = {}) {
	const spec = String(imported || "").trim();
	if (!spec) return "";
	if (spec.startsWith("node:")) return "";
	if (isHttpUrl(spec)) return await firstWorkingDtsCandidate([spec]);
	if (spec.startsWith("/") && !spec.startsWith("//")) {
		const origin = new URL(fromUrl).origin;
		return await firstWorkingDtsCandidate(expandDtsCandidates(`${origin}${spec}`));
	}
	if (spec.startsWith(".")) {
		const absolute = new URL(spec, fromUrl).href;
		return await firstWorkingDtsCandidate(expandDtsCandidates(absolute));
	}
	if (!options.includeBareDtsImports) return "";
	try {
		const metaUrl = appendQuery(`${(options.esmBase || "https://esm.sh").replace(/\/$/, "")}/${spec.replace(/^\//, "")}`, { meta: "" });
		const meta = await getJson(metaUrl);
		const dtsPath = meta?.default?.dts || meta?.dts || meta?.types || meta?.typings;
		return dtsPath ? toAbsoluteCdnUrl(dtsPath, metaUrl) : "";
	} catch {
		return "";
	}
}
/** Expand a possible declaration path into candidate paths. */
function expandDtsCandidates(url) {
	if (/\.(d\.ts|d\.cts|d\.mts|ts|cts|mts)$/i.test(url)) return [url];
	return [
		url,
		`${url}.d.ts`,
		`${url}.d.cts`,
		`${url}.d.mts`,
		`${url}.ts`,
		`${url}/index.d.ts`,
		`${url}/index.d.cts`,
		`${url}/index.d.mts`
	];
}
/** Return the first declaration URL that can be fetched. */
async function firstWorkingDtsCandidate(candidates) {
	for (const candidate of candidates) try {
		await getText(candidate);
		return candidate;
	} catch {}
	return "";
}
//#endregion
//#region src/jsdoc.ts
var jsdoc_exports = /* @__PURE__ */ __exportAll({
	aliasBasicType: () => aliasBasicType,
	appendRawDocLines: () => appendRawDocLines,
	attachCompletionTypeJsdoc: () => attachCompletionTypeJsdoc,
	buildGlobalDefinitions: () => buildGlobalDefinitions,
	buildImportTypeDefinitions: () => buildImportTypeDefinitions,
	buildShorthandDefinition: () => buildShorthandDefinition,
	callableEntryToSafeArrowType: () => callableEntryToSafeArrowType,
	cleanDoc: () => cleanDoc,
	cleanTagName: () => cleanTagName,
	completionTypeToSafeJsdoc: () => completionTypeToSafeJsdoc,
	completionsToSafeJsdoc: () => completionsToSafeJsdoc,
	escapeRegExp: () => escapeRegExp,
	extractPropertyType: () => extractPropertyType,
	extractTemplateNames: () => extractTemplateNames,
	extractTypeAliasType: () => extractTypeAliasType,
	findMatchingParen: () => findMatchingParen,
	findTopLevelArrow: () => findTopLevelArrow,
	findTopLevelChar: () => findTopLevelChar,
	getRequiredTemplateCount: () => getRequiredTemplateCount,
	isPrimitiveOrBuiltin: () => isPrimitiveOrBuiltin,
	joinDefinitionLines: () => joinDefinitionLines,
	mergeJsdocOptions: () => mergeJsdocOptions,
	normalizeJsdocSettings: () => normalizeJsdocSettings,
	oneLine: () => oneLine,
	parseArrowFunctionType: () => parseArrowFunctionType,
	parseCallableDetail: () => parseCallableDetail,
	parseGenericType: () => parseGenericType,
	parseParams: () => parseParams,
	renderArrowParam: () => renderArrowParam,
	renderJsdocBlock: () => renderJsdocBlock,
	renderJsdocDefinitions: () => renderJsdocDefinitions,
	renderOneLineJsdocBlock: () => renderOneLineJsdocBlock,
	renderSafeProperty: () => renderSafeProperty,
	sanitizeParamName: () => sanitizeParamName,
	shouldOmitObjectTypedefType: () => shouldOmitObjectTypedefType,
	spaceToDocLines: () => spaceToDocLines,
	spaceToRawSeparator: () => spaceToRawSeparator,
	splitTopLevel: () => splitTopLevel,
	toSafeArrowType: () => toSafeArrowType,
	toSafeGenericArgument: () => toSafeGenericArgument,
	toSafeJsdocType: () => toSafeJsdocType
});
/** Convert completion JSON into safe JSDoc typedef blocks. */
function completionsToSafeJsdoc(completions, options = {}) {
	const context = createJsdocBuildContext(completions, options);
	const typedefDefs = buildTypedefDefinitionsForTypes(context, getSortedTypeNames(context));
	const importTypeDefs = buildImportTypeDefinitions(context.flat, context.originalTypeNames, context.settings);
	const globalDefs = context.settings.includeGlobals ? buildGlobalDefinitions(context.flat, context.originalTypeNames, {
		settings: context.settings,
		outTypeName: context.outTypeName
	}) : [];
	return renderJsdocDefinitions([...importTypeDefs, ...typedefDefs], globalDefs, context.settings);
}
/** Convert one completion type record into safe JSDoc. */
function completionTypeToSafeJsdoc(completions, typeName, options = {}) {
	const context = createJsdocBuildContext(completions, {
		...options,
		includeGlobals: false
	});
	if (!context.originalTypeNames.has(typeName)) return "";
	return renderJsdocDefinitions(buildTypedefDefinitionsForTypes(context, collectReferencedTypeNames(context, typeName)), [], context.settings);
}
/** Attach non-enumerable per-type JSDoc helpers to completion type records. */
function attachCompletionTypeJsdoc(completions, options = {}) {
	const types = completions?.types && typeof completions.types === "object" ? completions.types : {};
	for (const typeName of Object.keys(types)) {
		const typeInfo = types[typeName];
		if (!typeInfo || typeof typeInfo !== "object") continue;
		Object.defineProperty(typeInfo, "toJsdoc", {
			configurable: true,
			enumerable: false,
			writable: true,
			value(jsdoc) {
				const mergedOptions = { ...options };
				const mergedJsdoc = mergeJsdocOptions(options.jsdoc, jsdoc);
				if (mergedJsdoc) mergedOptions.jsdoc = mergedJsdoc;
				return completionTypeToSafeJsdoc(completions, typeName, mergedOptions);
			}
		});
	}
	return completions;
}
function mergeJsdocOptions(base, override) {
	if (!base && !override) return void 0;
	const merged = {
		...base || {},
		...override || {}
	};
	if (base?.tags || override?.tags) merged.tags = {
		...base?.tags || {},
		...override?.tags || {}
	};
	if (base?.importTypes || override?.importTypes) merged.importTypes = {
		...base?.importTypes || {},
		...override?.importTypes || {}
	};
	if (typeof base?.shorthand === "object" || typeof override?.shorthand === "object") {
		const shorthand = {
			...typeof base?.shorthand === "object" ? base.shorthand : {},
			...typeof override?.shorthand === "object" ? override.shorthand : {}
		};
		const baseTypes = typeof base?.shorthand === "object" ? base.shorthand.types : void 0;
		const overrideTypes = typeof override?.shorthand === "object" ? override.shorthand.types : void 0;
		if (baseTypes || overrideTypes) shorthand.types = {
			...baseTypes || {},
			...overrideTypes || {}
		};
		merged.shorthand = shorthand;
	}
	return merged;
}
function createJsdocBuildContext(completions, options = {}) {
	const settings = normalizeJsdocSettings(options);
	const flat = Array.isArray(completions?.flat) ? completions.flat : [];
	const types = completions?.types && typeof completions.types === "object" ? completions.types : {};
	const originalTypeNames = /* @__PURE__ */ new Set([...Object.keys(types), ...flat.filter((entry) => [
		"Interface",
		"Class",
		"TypeAlias",
		"Enum"
	].includes(entry.kind)).map((entry) => entry.label)]);
	settings.__typeEntries = /* @__PURE__ */ new Map();
	for (const typeName of originalTypeNames) settings.__typeEntries.set(typeName, {
		typeEntry: flat.find((entry) => entry.label === typeName),
		typeInfo: types[typeName] || {
			kind: "",
			detail: "",
			members: []
		}
	});
	function outTypeName(name) {
		return originalTypeNames.has(name) ? `${name}${settings.typeNameSuffix}` : name;
	}
	const byMemberOf = Object.create(null);
	for (const entry of flat) {
		if (!entry?.memberOf) continue;
		(byMemberOf[entry.memberOf] ??= []).push(entry);
	}
	return {
		flat,
		types,
		settings,
		originalTypeNames,
		byMemberOf,
		outTypeName
	};
}
function getSortedTypeNames(context) {
	let typeNames = Array.from(context.originalTypeNames);
	if (context.settings.sort) typeNames = typeNames.sort((a, b) => a.localeCompare(b));
	return typeNames;
}
function buildTypedefDefinitionsForTypes(context, typeNames) {
	const typedefDefs = [];
	for (const typeName of typeNames) {
		const typeInfo = context.types[typeName] || {
			kind: "",
			detail: "",
			members: []
		};
		const settings = context.settings;
		const typeEntry = context.flat.find((entry) => entry.label === typeName);
		const kind = typeEntry?.kind || typeInfo.kind || "Interface";
		const emittedName = context.outTypeName(typeName);
		const templateNames = extractTemplateNames(typeName, typeEntry, typeInfo);
		const ctx = {
			settings,
			unknownType: settings.unknownType,
			originalTypeNames: context.originalTypeNames,
			outTypeName: context.outTypeName,
			templateNames: new Set(templateNames),
			functionUnknownType: "any"
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
			settings
		}));
	}
	return typedefDefs;
}
function collectReferencedTypeNames(context, rootTypeName) {
	const ordered = [];
	const visiting = /* @__PURE__ */ new Set();
	const visited = /* @__PURE__ */ new Set();
	function visit(typeName) {
		if (!context.originalTypeNames.has(typeName)) return;
		if (visited.has(typeName) || visiting.has(typeName)) return;
		visiting.add(typeName);
		const references = extractRenderedTypeReferences(buildTypedefDefinitionsForTypes(context, [typeName]).flatMap((def) => def.lines).join("\n"), context);
		for (const reference of references) visit(reference);
		visiting.delete(typeName);
		visited.add(typeName);
		ordered.push(typeName);
	}
	visit(rootTypeName);
	return ordered;
}
function extractRenderedTypeReferences(source, context) {
	const references = [];
	const seen = /* @__PURE__ */ new Set();
	const candidates = getSortedTypeNames(context);
	for (const typeName of candidates) {
		const emittedName = context.outTypeName(typeName);
		if (!new RegExp(`(^|[^\\w$])${escapeRegExp(emittedName)}(?=$|[^\\w$])`).test(source)) continue;
		if (seen.has(typeName)) continue;
		seen.add(typeName);
		references.push(typeName);
	}
	return references;
}
/** Normalize JSDoc output settings. */
function normalizeJsdocSettings(options = {}) {
	const jsdoc = options.jsdoc || {};
	const shorthand = jsdoc.shorthand === false ? {
		enabled: false,
		includeTypedefs: false,
		types: {}
	} : {
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
			...typeof jsdoc.shorthand === "object" ? jsdoc.shorthand.types : void 0
		}
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
			argument: cleanTagName(jsdoc.tags?.argument || "param")
		},
		format: jsdoc.format || "compact",
		space: jsdoc.space === void 0 ? "\n" : jsdoc.space,
		shorthand,
		globals,
		importTypes: {
			enabled: jsdoc.importTypes?.enabled === true || globals === "importTypes",
			specifier: jsdoc.importTypes?.specifier || options.specifier || "",
			namespaceName: jsdoc.importTypes?.namespaceName || "Pkg",
			mode: jsdoc.importTypes?.mode || "namespace"
		}
	};
}
/** Remove a leading @ from a tag alias. */
function cleanTagName(tag) {
	return String(tag || "").replace(/^@+/, "") || "property";
}
function buildTypedefDefinition(input) {
	const { emittedName, kind, typeEntry, typeInfo, members, templateNames, ctx, settings } = input;
	const lines = [];
	appendRawDocLines(lines, typeEntry?.documentation || "");
	if (templateNames.length) lines.push(`@template ${templateNames.join(", ")}`);
	if (kind === "Enum") {
		const unknown = toSafeJsdocType(settings.unknownType, ctx);
		lines.push(`@typedef {${unknown}} ${emittedName}`);
		for (const member of members) {
			if (member.kind !== "EnumMember") continue;
			const doc = member.documentation ? ` - ${oneLine(member.documentation)}` : "";
			lines.push(`@${settings.tags.property} {${unknown}} ${member.label}${doc}`);
		}
		return {
			generic: templateNames.length > 0,
			lines
		};
	}
	if (kind === "TypeAlias") {
		const safeType = toSafeJsdocType(typeEntry?.type || extractTypeAliasType(typeEntry?.detail || typeInfo?.detail || ""), ctx);
		lines.push(`@typedef {${safeType}} ${emittedName}`);
		return {
			generic: templateNames.length > 0,
			lines
		};
	}
	const printableMembers = (settings.sort ? members.slice().sort((a, b) => a.label.localeCompare(b.label)) : members).filter((member) => {
		if (!member?.label) return false;
		if (kind === "Class" && member.isStatic) return false;
		if (member.label === "constructor") return false;
		if (member.label === "(call)") return false;
		if (member.label === "[index]") return false;
		return true;
	});
	if (shouldOmitObjectTypedefType(settings) && printableMembers.length > 0) lines.push(`@typedef ${emittedName}`);
	else lines.push(`@typedef {${aliasBasicType("Object", ctx)}} ${emittedName}`);
	for (const member of printableMembers) {
		const property = renderSafeProperty(member, ctx, settings);
		if (property) lines.push(property);
	}
	return {
		generic: templateNames.length > 0,
		lines
	};
}
/** Build import-type declarations instead of fake global runtime stubs. */
function buildImportTypeDefinitions(flat, originalTypeNames, settings) {
	if (!settings.importTypes?.enabled) return [];
	const specifier = settings.importTypes.specifier;
	if (!specifier) return [];
	if (settings.importTypes.mode === "namespace") return [{
		generic: false,
		lines: [`@typedef {import("${specifier}")} ${settings.importTypes.namespaceName}`]
	}];
	let globals = flat.filter((entry) => {
		return entry?.scope === "global" && !originalTypeNames.has(entry.label) && ["Variable", "Function"].includes(entry.kind);
	});
	if (settings.sort) globals = globals.slice().sort((a, b) => a.label.localeCompare(b.label));
	return globals.map((entry) => ({
		generic: false,
		lines: [`@typedef {import("${specifier}").${entry.label}} ${entry.label}${settings.typeNameSuffix}`]
	}));
}
/** Build global variable/function helper definitions. Off unless jsdoc.globals === "stubs". */
function buildGlobalDefinitions(flat, originalTypeNames, helpers) {
	const { settings, outTypeName } = helpers;
	if (settings.globals !== "stubs") return [];
	let globals = flat.filter((entry) => {
		return entry?.scope === "global" && !originalTypeNames.has(entry.label) && ["Variable", "Function"].includes(entry.kind);
	});
	if (settings.sort) globals = globals.slice().sort((a, b) => a.label.localeCompare(b.label));
	const ctx = {
		settings,
		unknownType: settings.unknownType,
		originalTypeNames,
		outTypeName,
		templateNames: /* @__PURE__ */ new Set(),
		functionUnknownType: "any"
	};
	return globals.map((entry) => {
		if (entry.kind === "Variable") {
			const safeType = toSafeJsdocType(entry.type, ctx);
			const lines = [];
			appendRawDocLines(lines, entry.documentation);
			lines.push(`@type {${safeType}}`);
			return {
				kind: "global-variable",
				generic: false,
				lines,
				code: `const ${entry.label} = undefined;`
			};
		}
		if (entry.kind === "Function") {
			const lines = [];
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
			return {
				kind: "global-function",
				generic: false,
				lines,
				code: `function ${entry.label}(${args}) {}`
			};
		}
		return null;
	}).filter(Boolean);
}
/** Render typedef/global definition objects to JSDoc source. */
function renderJsdocDefinitions(typedefDefs, globalDefs, settings) {
	const out = [];
	if (settings.includeHeader) out.push(renderJsdocBlock(["Generated JSDoc helper types."]));
	const shorthandDef = buildShorthandDefinition(settings);
	if (settings.format === "oneLine") {
		const rendered = [];
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
function buildShorthandDefinition(settings) {
	if (!settings.shorthand?.enabled || !settings.shorthand?.includeTypedefs) return null;
	const aliases = settings.shorthand.types || {};
	return {
		generic: false,
		lines: [
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
			["null", aliases.null || "N"]
		].map(([type, name]) => `@typedef {${type}} ${name}`)
	};
}
function shouldOmitObjectTypedefType(settings) {
	return settings.format === "compact" || settings.format === "oneLine";
}
function joinDefinitionLines(defs, space) {
	const out = [];
	for (let i = 0; i < defs.length; i++) {
		const def = defs[i];
		if (!def) continue;
		if (i > 0) out.push(...spaceToDocLines(space));
		out.push(...def.lines);
	}
	return out;
}
function spaceToDocLines(space) {
	if (space === 0 || space === "" || space === false || space === null) return [];
	if (typeof space === "number") return Array.from({ length: Math.max(0, space) }, () => "");
	if (typeof space === "string") {
		if (space === "\n") return [""];
		const parts = space.split("\n");
		return parts.length === 1 ? [space] : parts.map((part) => part.trimEnd());
	}
	return [""];
}
function spaceToRawSeparator(space) {
	if (space === 0 || space === "" || space === false || space === null) return "";
	if (typeof space === "number") return "\n".repeat(Math.max(0, space));
	if (typeof space === "string") return space;
	return "\n";
}
function renderJsdocBlock(lines) {
	return [
		"/**",
		...lines.map((line) => line ? ` * ${line}` : " *"),
		" */"
	].join("\n");
}
function renderOneLineJsdocBlock(lines) {
	return `/** ${lines.map((line) => String(line || "").trim()).filter(Boolean).join(" ")} */`;
}
function renderSafeProperty(member, ctx, settings) {
	const doc = member.documentation ? ` - ${oneLine(member.documentation)}` : "";
	if (member.kind === "Method" || member.kind === "Function") {
		const arrowType = callableEntryToSafeArrowType(member, ctx);
		return `@${settings.tags.property} {${arrowType}} ${member.label}${doc}`;
	}
	const safeType = toSafeJsdocType(member.type || extractPropertyType(member.detail), ctx);
	return `@${settings.tags.property} {${safeType}} ${member.label}${doc}`;
}
function callableEntryToSafeArrowType(entry, ctx) {
	const parsed = parseCallableDetail(entry.detail, entry.label);
	const params = parsed.params.map((param, index) => renderArrowParam(param, index, ctx));
	const returnType = toSafeArrowType(entry.returnType || parsed.returnType || "void", ctx);
	return `(${params.join(",")}) => ${returnType}`;
}
function renderArrowParam(param, index, ctx) {
	const rest = param.rest || String(param.name || "").startsWith("...");
	const cleanName = sanitizeParamName(String(param.name || "").replace(/^\.\.\./, ""), index);
	let type = toSafeArrowType(param.type || "*", ctx);
	if (rest) {
		if (!type.endsWith("[]")) type = `${type}[]`;
		return `...${cleanName}:${type}`;
	}
	return `${cleanName}${param.optional ? "?" : ""}:${type}`;
}
function sanitizeParamName(name, index) {
	const cleaned = String(name || "").replace(/[^\w$]/g, "").trim();
	if (!cleaned) return `arg${index + 1}`;
	if (/^\d/.test(cleaned)) return `arg${index + 1}`;
	return cleaned;
}
function toSafeArrowType(type, ctx) {
	const value = toSafeJsdocType(type, ctx);
	const unknownAlias = aliasBasicType(ctx.unknownType, ctx);
	if (!value || value === "*" || value === "unknown" || value === unknownAlias) return aliasBasicType(ctx.functionUnknownType || "any", ctx);
	return value;
}
/** Convert a TypeScript-ish type string to safe JSDoc type syntax. */
function toSafeJsdocType(type, ctx = {}) {
	const unknownType = ctx.unknownType || "unknown";
	const originalTypeNames = ctx.originalTypeNames || /* @__PURE__ */ new Set();
	const outTypeName = ctx.outTypeName || ((name) => name);
	const templateNames = ctx.templateNames || /* @__PURE__ */ new Set();
	let value = String(type || "").trim();
	if (!value) return aliasBasicType(unknownType, ctx);
	value = value.replace(/\bdeclare\s+/g, "").replace(/\bexport\s+/g, "").replace(/\breadonly\s+/g, "").replace(/\s+/g, " ").replace(/;$/, "").trim();
	if (!value) return aliasBasicType(unknownType, ctx);
	if (value.includes("typeof this") || value.includes("this &") || value.includes("Constructor<") || value.includes("UnionToIntersection<") || value.includes("ReturnTypeOf<") || value.includes("import(") || value.includes("infer ")) return aliasBasicType(unknownType, ctx);
	if (splitTopLevel(value, "&").length > 1) return aliasBasicType(unknownType, ctx);
	if (/^["'`].*["'`]$/.test(value)) return aliasBasicType("string", ctx);
	if (/^\d+(\.\d+)?$/.test(value)) return aliasBasicType("number", ctx);
	if (value === "true" || value === "false") return aliasBasicType("boolean", ctx);
	if (/^\{.*\}$/.test(value) && value.includes(":")) return aliasBasicType("Object", ctx);
	const arrow = parseArrowFunctionType(value);
	if (arrow && isFullArrowType(value)) {
		const fullCtx = ctx;
		return `(${arrow.params.map((param, index) => renderArrowParam(param, index, fullCtx)).join(",")}) => ${toSafeArrowType(arrow.returnType, fullCtx)}`;
	}
	const unionParts = splitTopLevel(value, "|");
	if (unionParts.length > 1) {
		const safeParts = unionParts.map((part) => toSafeJsdocType(part, ctx)).filter(Boolean);
		if (safeParts.includes(aliasBasicType(unknownType, ctx))) return aliasBasicType(unknownType, ctx);
		return Array.from(new Set(safeParts)).join("|");
	}
	if (value.endsWith("[]")) return `${toSafeJsdocType(value.slice(0, -2).trim(), ctx)}[]`;
	const generic = parseGenericType(value);
	if (generic) {
		const name = generic.name;
		if (name === "Array" || name === "ReadonlyArray") return `${toSafeJsdocType(generic.args[0] || unknownType, ctx)}[]`;
		if (name === "Promise") return `Promise<${toSafeJsdocType(generic.args[0] || unknownType, ctx)}>`;
		if (name === "Record") return aliasBasicType("Object", ctx);
		if (templateNames.has(name)) return `${name}<${generic.args.map((arg) => toSafeGenericArgument(arg, ctx)).join(",")}>`;
		if (originalTypeNames.has(name)) {
			const safeArgs = generic.args.map((arg) => toSafeGenericArgument(arg, ctx));
			return `${outTypeName(name)}<${safeArgs.join(",")}>`;
		}
		return aliasBasicType(unknownType, ctx);
	}
	if (templateNames.has(value)) return value;
	if (isPrimitiveOrBuiltin(value)) return aliasBasicType(value, ctx);
	if (originalTypeNames.has(value)) {
		const requiredCount = getRequiredTemplateCount(value, ctx);
		if (requiredCount > 0) {
			const fallbackArgs = Array.from({ length: requiredCount }, () => aliasBasicType(ctx.functionUnknownType || "any", ctx));
			return `${outTypeName(value)}<${fallbackArgs.join(",")}>`;
		}
		return outTypeName(value);
	}
	return aliasBasicType(unknownType, ctx);
}
function isFullArrowType(value) {
	const arrowIndex = findTopLevelArrow(value);
	if (arrowIndex < 0) return false;
	const left = value.slice(0, arrowIndex).trim();
	return left.startsWith("(") || left.includes(":") || left.includes("...");
}
function toSafeGenericArgument(arg, ctx) {
	const value = toSafeJsdocType(arg, ctx);
	const unknown = aliasBasicType(ctx.unknownType || "unknown", ctx);
	if (!value || value === "*" || value === "unknown" || value === unknown) return aliasBasicType(ctx.functionUnknownType || "any", ctx);
	return value;
}
function getRequiredTemplateCount(typeName, ctx) {
	if (!ctx.originalTypeNames?.has(typeName)) return 0;
	const entry = ctx.settings?.__typeEntries?.get(typeName);
	if (!entry) return 0;
	return extractTemplateNames(typeName, entry.typeEntry, entry.typeInfo).length;
}
function aliasBasicType(type, ctx = {}) {
	const aliases = ctx.settings?.shorthand?.enabled ? ctx.settings.shorthand.types : null;
	if (!aliases) return type;
	const key = String(type || "").trim();
	return aliases[key] ?? key;
}
function extractTemplateNames(typeName, typeEntry, typeInfo) {
	const detail = String(typeEntry?.detail || typeInfo?.detail || "");
	const escaped = escapeRegExp(typeName);
	const patterns = [
		new RegExp(`\\binterface\\s+${escaped}\\s*<([^>]+)>`),
		new RegExp(`\\bclass\\s+${escaped}\\s*<([^>]+)>`),
		new RegExp(`\\btype\\s+${escaped}\\s*<([^>]+)>`)
	];
	for (const pattern of patterns) {
		const match = detail.match(pattern);
		if (!match?.[1]) continue;
		return splitTopLevel(match[1], ",").map((part) => part.replace(/\s+extends\s+[\s\S]*$/g, "").replace(/\s*=\s*[\s\S]*$/g, "").trim()).filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
	}
	return [];
}
function isPrimitiveOrBuiltin(value) {
	return [
		"*",
		"any",
		"unknown",
		"void",
		"undefined",
		"null",
		"never",
		"string",
		"String",
		"number",
		"Number",
		"boolean",
		"Boolean",
		"bigint",
		"BigInt",
		"symbol",
		"Symbol",
		"object",
		"Object",
		"Function",
		"function",
		"Array",
		"Date",
		"RegExp",
		"Error",
		"Promise"
	].includes(value);
}
function parseGenericType(value) {
	const lt = value.indexOf("<");
	if (lt < 0 || !value.endsWith(">")) return null;
	const name = value.slice(0, lt).trim();
	if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null;
	return {
		name,
		args: splitTopLevel(value.slice(lt + 1, -1), ",")
	};
}
function parseArrowFunctionType(value) {
	const arrowIndex = findTopLevelArrow(value);
	if (arrowIndex < 0) return null;
	let left = value.slice(0, arrowIndex).trim();
	const right = value.slice(arrowIndex + 2).trim();
	if (left.startsWith("(") && left.endsWith(")")) left = left.slice(1, -1).trim();
	return {
		params: parseParams(left),
		returnType: right
	};
}
function findTopLevelArrow(source) {
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
		if (char === "'" || char === "\"" || char === "`") {
			quote = char;
			continue;
		}
		if (char === "(" || char === "<" || char === "{" || char === "[") depth++;
		else if (char === ")" || char === ">" || char === "}" || char === "]") depth = Math.max(0, depth - 1);
		if (depth === 0 && char === "=" && next === ">") return i;
	}
	return -1;
}
function parseCallableDetail(detail, expectedName = "") {
	const source = String(detail || "").trim();
	const fallback = {
		name: expectedName || "",
		params: [],
		returnType: ""
	};
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
	return {
		name: expectedName || "",
		params: parseParams(inside),
		returnType
	};
}
function parseParams(paramSource) {
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
		return {
			name,
			type: type || "*",
			optional,
			rest
		};
	});
}
function extractPropertyType(detail) {
	const text = String(detail || "").trim();
	const colonIndex = findTopLevelChar(text, ":");
	if (colonIndex < 0) return "";
	return text.slice(colonIndex + 1).replace(/[;=].*$/, "").trim();
}
function extractTypeAliasType(detail) {
	const text = String(detail || "").trim();
	const equalsIndex = findTopLevelChar(text, "=");
	if (equalsIndex < 0) return "";
	return text.slice(equalsIndex + 1).replace(/;$/, "").trim();
}
function splitTopLevel(source, delimiter) {
	const out = [];
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
		if (char === "'" || char === "\"" || char === "`") {
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
function findTopLevelChar(source, target) {
	let depth = 0;
	let quote = "";
	for (let i = 0; i < source.length; i++) {
		const char = source[i];
		const prev = source[i - 1];
		if (quote) {
			if (char === quote && prev !== "\\") quote = "";
			continue;
		}
		if (char === "'" || char === "\"" || char === "`") {
			quote = char;
			continue;
		}
		if (char === "(" || char === "<" || char === "{" || char === "[") depth++;
		else if (char === ")" || char === ">" || char === "}" || char === "]") depth = Math.max(0, depth - 1);
		else if (depth === 0 && char === target) return i;
	}
	return -1;
}
function findMatchingParen(source, openIndex) {
	let depth = 0;
	let quote = "";
	for (let i = openIndex; i < source.length; i++) {
		const char = source[i];
		const prev = source[i - 1];
		if (quote) {
			if (char === quote && prev !== "\\") quote = "";
			continue;
		}
		if (char === "'" || char === "\"" || char === "`") {
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
function appendRawDocLines(lines, documentation) {
	const text = cleanDoc(documentation);
	if (!text) return;
	for (const line of text.split("\n")) lines.push(line);
}
function cleanDoc(value) {
	return String(value || "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function oneLine(value) {
	return cleanDoc(value).replace(/\s+/g, " ").trim();
}
function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
//#endregion
//#region src/markdown.ts
var markdown_exports = /* @__PURE__ */ __exportAll({ markdownCodeBlock: () => markdownCodeBlock });
/** Render a markdown code block without nested triple-backtick problems. */
function markdownCodeBlock(code, lang = "js") {
	return "~~~~" + lang + "\n" + String(code || "") + "\n~~~~";
}
//#endregion
//#region src/monaco.ts
var monaco_exports = /* @__PURE__ */ __exportAll({ toMonacoSuggestions: () => toMonacoSuggestions });
/** Convert completion entries into Monaco CompletionItem objects. */
function toMonacoSuggestions(monaco, entries, range) {
	const kindMap = {
		Function: monaco.languages.CompletionItemKind.Function,
		Method: monaco.languages.CompletionItemKind.Method,
		Variable: monaco.languages.CompletionItemKind.Variable,
		Property: monaco.languages.CompletionItemKind.Property,
		Interface: monaco.languages.CompletionItemKind.Interface,
		Class: monaco.languages.CompletionItemKind.Class,
		TypeAlias: monaco.languages.CompletionItemKind.Struct,
		Enum: monaco.languages.CompletionItemKind.Enum,
		EnumMember: monaco.languages.CompletionItemKind.EnumMember,
		Constructor: monaco.languages.CompletionItemKind.Constructor,
		Export: monaco.languages.CompletionItemKind.Module
	};
	return entries.map((entry) => ({
		label: entry.label,
		kind: kindMap[entry.kind] || monaco.languages.CompletionItemKind.Text,
		insertText: entry.insertText,
		insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
		detail: entry.detail,
		documentation: entry.documentation,
		range
	}));
}
//#endregion
//#region src/remote-esm-import/lib/dtsConverter.ts
async function getDtsConverter(tsUrl) {
	if (remoteEsmVm.converter) return remoteEsmVm.converter;
	remoteEsmVm.converter = createDtsCompletionConverter(await loadTypeScript(tsUrl));
	return remoteEsmVm.converter;
}
//#endregion
//#region src/remote-esm-import/lib/packageCache.ts
function importWithPackageCache(key, factory) {
	const cached = remoteEsmVm.package.get(key);
	if (cached) return cached;
	const promise = factory().catch((error) => {
		remoteEsmVm.package.delete(key);
		throw error;
	});
	remoteEsmVm.package.set(key, promise);
	return promise;
}
//#endregion
//#region src/remote-esm-import/lib/typeExpression.ts
function getLocalExportTypeName(match, typeNameSuffix = "") {
	return `${match.entry.label || match.key}${typeNameSuffix}`;
}
function getTypedBindingTypeExpression(match, options = {}) {
	const localTypeName = options.typeName || getLocalExportTypeName(match, options.typeNameSuffix || "");
	const typeSource = options.typeSource || (match.entry.kind === "Class" ? "constructor" : "local");
	if (typeSource === "import" && options.importSpecifier) return `typeof import("${escapeJsString(options.importSpecifier)}")${exportTypeAccessor(match.key)}`;
	if (typeSource === "constructor" && match.entry.kind === "Class") {
		const constructorType = getConstructorTypeExpression(match, localTypeName, options.typeNameSuffix || "");
		if (constructorType) return constructorType;
	}
	return localTypeName || match.entry.label || "unknown";
}
function getConstructorTypeExpression(match, instanceTypeName, typeNameSuffix = "") {
	const constructorEntry = match.type?.members.find((member) => member.kind === "Constructor");
	if (!constructorEntry) return "";
	return `new (${parseCallableDetail(constructorEntry.detail, "constructor").params.map((param, index) => {
		const rest = param.rest || param.name.startsWith("...");
		const name = sanitizeBindingName(param.name.replace(/^\.\.\./, "") || `arg${index + 1}`);
		const type = toLocalParsedTypeExpression(param.type || "x", typeNameSuffix);
		const optional = param.optional ? "?" : "";
		return rest ? `...${name}:${type}[]` : `${name}${optional}:${type}`;
	}).join(",")}) => ${instanceTypeName}`;
}
function toLocalParsedTypeExpression(type, typeNameSuffix = "") {
	let value = String(type || "x").trim();
	if (!value) return "x";
	value = value.replace(/\bObject\b/g, "O").replace(/\bString\b/g, "s").replace(/\bstring\b/g, "s").replace(/\bNumber\b/g, "n").replace(/\bnumber\b/g, "n").replace(/\bBoolean\b/g, "b").replace(/\bboolean\b/g, "b").replace(/\bunknown\b/g, "X").replace(/\bany\b/g, "x");
	if (!typeNameSuffix) return value;
	return value.replace(/\b[A-Z][A-Za-z0-9_$]*\b/g, (name) => {
		if ([
			"O",
			"String",
			"Number",
			"Boolean",
			"Promise",
			"Array",
			"Date",
			"RegExp",
			"Error",
			"Function"
		].includes(name)) return name;
		return name.endsWith(typeNameSuffix) ? name : `${name}${typeNameSuffix}`;
	});
}
//#endregion
//#region src/remote-esm-import/lib/typedBindings.ts
function buildRemoteEsmImportMatches(moduleObject, completions, options = {}) {
	if (!moduleObject || typeof moduleObject !== "object" && typeof moduleObject !== "function") return {};
	const globals = Array.isArray(completions?.byScope?.global) ? completions.byScope.global : [];
	const types = completions?.types && typeof completions.types === "object" ? completions.types : {};
	const matches = {};
	for (const key of Object.keys(moduleObject)) {
		const entry = globals.find((candidate) => candidate?.label === key);
		if (!entry) continue;
		const type = types[entry.label];
		const match = {
			key,
			value: moduleObject[key],
			entry
		};
		if (type) {
			match.type = type;
			if (typeof type.toJsdoc === "function") match.toJsdoc = type.toJsdoc.bind(type);
		}
		match.toTypedBinding = (bindingOptions) => remoteEsmImportMatchToTypedBinding(match, {
			...options,
			...normalizeTypedBindingOptions(bindingOptions)
		});
		match.toGlobal = match.toTypedBinding;
		matches[key] = match;
	}
	return matches;
}
function remoteEsmImportMatchToTypedBinding(match, options = {}) {
	const out = [];
	if (options.includeTypedef !== false && typeof match.toJsdoc === "function") {
		const jsdoc = match.toJsdoc(options.jsdoc);
		if (jsdoc) out.push(jsdoc);
	}
	out.push(renderTypedBinding({
		localName: options.localName || sanitizeBindingName(match.key),
		moduleName: options.moduleName || "module",
		exportKey: match.key,
		typeExpression: getTypedBindingTypeExpression(match, options)
	}));
	return out.join("\n\n");
}
function renderTypedBinding(input) {
	return [`/** @type {${input.typeExpression}} */`, `const ${input.localName} = ${input.moduleName}${runtimePropertyAccessor(input.exportKey)};`].join("\n");
}
function normalizeTypedBindingOptions(options) {
	return typeof options === "string" ? { localName: options } : options || {};
}
//#endregion
//#region src/remote-esm-import/index.ts
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
async function remoteEsmImport(input, options = {}) {
	const target = normalizeRemoteEsmTarget(input, options);
	const { tsUrl = "https://esm.sh/typescript", maxDepth = 5, maxFiles = 80, includeBareDtsImports = true, typeNameSuffix = "", unknownType, includeHeader = false, log = true } = options;
	return await importWithPackageCache(JSON.stringify({
		input,
		target,
		tsUrl,
		maxDepth,
		maxFiles,
		includeBareDtsImports,
		typeNameSuffix,
		unknownType,
		includeHeader,
		jsdoc: options.jsdoc || null
	}), async () => {
		const [moduleObject, dtsUrl, converter] = await Promise.all([
			importModuleCached(target.runtimeUrl),
			resolveDeclarationUrl(target, options),
			getDtsConverter(tsUrl)
		]);
		const dtsGraph = await loadDtsGraph(dtsUrl, {
			...options,
			maxDepth,
			maxFiles,
			includeBareDtsImports
		});
		const combinedDts = dtsGraph.files.map((file) => [
			"",
			`/* ===== ${file.url} ===== */`,
			file.text
		].join("\n")).join("\n");
		const completions = converter.convertText(combinedDts, { fileName: `${target.specifier || "remote"}.virtual.d.ts` });
		const jsdocOptions = {
			...options,
			specifier: options.jsdoc?.importTypes?.specifier || target.specifier,
			includeGlobals: true,
			includeHeader,
			typeNameSuffix
		};
		if (unknownType !== void 0) jsdocOptions.unknownType = unknownType;
		attachCompletionTypeJsdoc(completions, jsdocOptions);
		const jsdoc = completionsToSafeJsdoc(completions, jsdocOptions);
		const result = {
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
				typeNameSuffix
			}),
			jsdoc,
			memory: remoteEsmVm,
			pick(name, fallback) {
				if (moduleObject && name in moduleObject) return moduleObject[name];
				if (fallback !== void 0) return fallback;
				return moduleObject?.default ?? moduleObject;
			},
			asAny(value) {
				return value;
			}
		};
		if (log) {
			console.info("remoteEsmImport runtime:", target.runtimeUrl);
			console.info("remoteEsmImport types:", dtsUrl);
			console.info("remoteEsmImport d.ts files:", dtsGraph.files.map((file) => file.url));
			if (dtsGraph.failed.length) console.warn("remoteEsmImport d.ts fetch failures:", dtsGraph.failed);
		}
		return result;
	});
}
/** Backwards-compatible alias for the earlier single-file API name. */
const importCdnPackageWithTypes = remoteEsmImport;
//#endregion
//#region src/temp-storage/getQuota.ts
async function getStorageQuota() {
	const results = {};
	if (navigator.storage?.estimate) try {
		const estimate = await navigator.storage.estimate();
		const { usage = 0, quota = 0 } = estimate;
		results.storageManager = {
			usageBytes: estimate.usage,
			quotaBytes: estimate.quota,
			usageMiB: usage / 1024 ** 2,
			quotaMiB: quota / 1024 ** 2,
			availableMiB: (quota - usage) / 1024 ** 2,
			availableGiB: (quota - usage) / 1024 ** 2 / 10240,
			usageDetails: estimate.usageDetails ?? null
		};
	} catch (error) {
		results.storageManagerError = {
			name: error?.name,
			message: error?.message
		};
	}
	if (navigator.webkitTemporaryStorage?.queryUsageAndQuota) try {
		results.legacyTemporaryStorage = await new Promise((resolve, reject) => {
			navigator.webkitTemporaryStorage.queryUsageAndQuota((usage, quota) => {
				resolve({
					usageBytes: usage,
					quotaBytes: quota,
					usageMiB: usage / 1024 ** 2,
					quotaMiB: quota / 1024 ** 2,
					availableMiB: (quota - usage) / 1024 ** 2,
					availableGiB: (quota - usage) / 1024 ** 2 / 10240
				});
			}, reject);
		});
	} catch (error) {
		results.legacyTemporaryStorageError = {
			name: error?.name,
			message: error?.message
		};
	}
	return results;
}
//#endregion
//#region src/temp-storage/index.ts
var temp_storage_default = { getStorageQuota };
//#endregion
//#region src/types.ts
var types_exports = /* @__PURE__ */ __exportAll({});
//#endregion
//#region src/index.ts
const Src = {
	Core: core_default,
	RemoteEsmImport: importCdnPackageWithTypes,
	TempStorage: temp_storage_default
};
var src_default = {
	Src,
	...Src,
	cache: cache_exports,
	converter: converter_exports,
	dtsGraph: dtsGraph_exports,
	jsdoc: jsdoc_exports,
	markdown: markdown_exports,
	monaco: monaco_exports,
	network: network_exports,
	types: types_exports,
	url: url_exports,
	$import_meta: import.meta
};
//#endregion
export { core_default as Core, importCdnPackageWithTypes as RemoteEsmImport, importCdnPackageWithTypes, Src, string_exports as StringUtils, temp_storage_default as TempStorage, aliasBasicType, appendQuery, appendRawDocLines, attachCompletionTypeJsdoc, buildGlobalDefinitions, buildImportTypeDefinitions, buildRemoteEsmImportMatches, buildShorthandDefinition, cache_exports as cache, callableEntryToSafeArrowType, cleanDoc, cleanTagName, clearRemoteEsmVm, completionTypeToSafeJsdoc, completionsToSafeJsdoc, converter_exports as converter, createDtsCompletionConverter, src_default as default, dtsGraph_exports as dtsGraph, escapeJsString, escapeRegExp, esmMetaUrl, esmUrl, expandDtsCandidates, exportTypeAccessor, extractDtsImportSpecifiers, extractPropertyType, extractTemplateNames, extractTypeAliasType, findMatchingParen, findTopLevelArrow, findTopLevelChar, firstWorkingDtsCandidate, getConstructorTypeExpression, getDtsConverter, getJson, getLocalExportTypeName, getRequiredTemplateCount, getStorageQuota, getText, getTypedBindingTypeExpression, importModuleCached, importWithPackageCache, inferSpecifierFromUrl, isHttpUrl, isIdentifierName, isPrimitiveOrBuiltin, joinDefinitionLines, jsdoc_exports as jsdoc, loadDtsGraph, loadTypeScript, markdown_exports as markdown, markdownCodeBlock, mergeJsdocOptions, monaco_exports as monaco, network_exports as network, normalizeJsdocSettings, normalizePackageSpecifier, normalizeRemoteEsmTarget, normalizeTypedBindingOptions, oneLine, parseArrowFunctionType, parseCallableDetail, parseGenericType, parseParams, propertyAccessor, remoteEsmImport, remoteEsmImportMatchToTypedBinding, remoteEsmVm, renderArrowParam, renderJsdocBlock, renderJsdocDefinitions, renderOneLineJsdocBlock, renderSafeProperty, renderTypedBinding, resolveDeclarationUrl, resolveDtsImport, runtimePropertyAccessor, sanitizeBindingName, sanitizeParamName, shouldOmitObjectTypedefType, spaceToDocLines, spaceToRawSeparator, splitTopLevel, toAbsoluteCdnUrl, toLocalParsedTypeExpression, toMonacoSuggestions, toSafeArrowType, toSafeGenericArgument, toSafeJsdocType, types_exports as types, url_exports as url, vmMemo };
