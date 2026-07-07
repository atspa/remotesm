import assert from "node:assert/strict";
import { attachCompletionTypeJsdoc, buildRemoteEsmImportMatches } from "../index.ts";
import type { CompletionEntry, CompletionResult } from "../index.ts";

function entry(partial: Partial<CompletionEntry>): CompletionEntry {
    return {
    scope: "global",
    label: "",
    kind: "Text",
    insertText: partial.label || "",
    detail: "",
    documentation: "",
    type: "",
    returnType: "",
    memberOf: "",
    exportName: "",
    isStatic: false,
    ...partial,
  };
}

const widgetEntry = entry({
  label: "Widget",
  kind: "Class",
  detail: "class Widget { constructor(options?: WidgetOptions); name: string; options: WidgetOptions; run(input: number): boolean; }",
});

const widgetOptionsEntry = entry({
  label: "WidgetOptions",
  kind: "Interface",
  detail: "interface WidgetOptions { retries: number; }",
});

const defaultEntry = entry({
  label: "default",
  kind: "Variable",
  detail: "default: Widget;",
  type: "Widget",
});

const nameMember = entry({
  scope: "type:Widget",
  label: "name",
  kind: "Property",
  detail: "name: string;",
  type: "string",
  memberOf: "Widget",
});

const constructorMember = entry({
  scope: "type:Widget",
  label: "constructor",
  kind: "Constructor",
  insertText: "new Widget(${1:options})",
  detail: "constructor(options?: WidgetOptions);",
  memberOf: "Widget",
});

const optionsMember = entry({
  scope: "type:Widget",
  label: "options",
  kind: "Property",
  detail: "options: WidgetOptions;",
  type: "WidgetOptions",
  memberOf: "Widget",
});

const runMember = entry({
  scope: "type:Widget",
  label: "run",
  kind: "Method",
  insertText: "run(${1:input})",
  detail: "run(input: number): boolean;",
  returnType: "boolean",
  memberOf: "Widget",
});

const defaultsMember = entry({
  scope: "type:Widget",
  label: "defaults",
  kind: "Method",
  insertText: "defaults(${1:options})",
  detail: "static defaults(options: WidgetOptions): typeof Widget;",
  returnType: "typeof Widget",
  memberOf: "Widget",
  isStatic: true,
});

const versionMember = entry({
  scope: "type:Widget",
  label: "VERSION",
  kind: "Property",
  detail: "static VERSION: string;",
  type: "string",
  memberOf: "Widget",
  isStatic: true,
});

const retriesMember = entry({
  scope: "type:WidgetOptions",
  label: "retries",
  kind: "Property",
  detail: "retries: number;",
  type: "number",
  memberOf: "WidgetOptions",
});

const completions: CompletionResult = {
  flat: [widgetEntry, widgetOptionsEntry, defaultEntry, constructorMember, nameMember, optionsMember, runMember, defaultsMember, versionMember, retriesMember],
  byScope: {
    global: [widgetEntry, widgetOptionsEntry, defaultEntry],
    "type:Widget": [constructorMember, nameMember, optionsMember, runMember, defaultsMember, versionMember],
    "type:WidgetOptions": [retriesMember],
  },
  types: {
    Widget: {
      kind: "Class",
      detail: widgetEntry.detail,
      members: [constructorMember, nameMember, optionsMember, runMember, defaultsMember, versionMember],
    },
    WidgetOptions: {
      kind: "Interface",
      detail: widgetOptionsEntry.detail,
      members: [retriesMember],
    },
  },
};

attachCompletionTypeJsdoc(completions, {
  typeNameSuffix: "T",
  jsdoc: {
    format: "compact",
  },
});

assert.equal(typeof completions.types.Widget?.toJsdoc, "function");
assert.equal(Object.keys(completions.types.Widget || {}).includes("toJsdoc"), false);

const jsdoc = completions.types.Widget?.toJsdoc?.({
  format: "oneLine",
  space: "",
  tags: {
    property: "prop",
    argument: "arg",
  },
}) || "";

assert.ok(jsdoc.includes("@typedef WidgetT"));
assert.ok(jsdoc.includes("@prop {WidgetOptionsT} options"));
assert.equal(jsdoc.includes(" defaults"), false);
assert.equal(jsdoc.includes(" VERSION"), false);
assert.ok(jsdoc.includes("@typedef WidgetOptionsT"));
assert.ok(jsdoc.includes("@prop {n} retries"));
assert.ok(jsdoc.indexOf("@typedef WidgetOptionsT") < jsdoc.indexOf("@typedef WidgetT"));
assert.equal(jsdoc.includes("@property"), false);

const moduleWithoutDefaultMatch = {
  Widget: { name: "widget" },
  Missing: {},
};

const matches = buildRemoteEsmImportMatches(moduleWithoutDefaultMatch, completions, {
  importSpecifier: "https://esm.sh/widget",
  typeNameSuffix: "T",
});

assert.deepEqual(Object.keys(matches), ["Widget"]);
assert.equal(matches.Widget?.key, "Widget");
assert.equal(matches.Widget?.value, moduleWithoutDefaultMatch.Widget);
assert.equal(matches.Widget?.entry, widgetEntry);
assert.equal(matches.Widget?.type, completions.types.Widget);
assert.equal(typeof matches.Widget?.toJsdoc, "function");
assert.equal(typeof matches.Widget?.toGlobal, "function");
assert.equal(typeof matches.Widget?.toTypedBinding, "function");

const binding = matches.Widget?.toGlobal?.("O") || "";

assert.ok(binding.includes("@typedef WidgetOptionsT"));
assert.ok(binding.includes("@typedef WidgetT"));
assert.ok(binding.includes("/** @type {new (options?:WidgetOptionsT) => WidgetT} */"));
assert.equal(binding.includes("typeof import("), false);
assert.ok(binding.includes("const O = module.Widget;"));

const importBinding = matches.Widget?.toGlobal?.({
  localName: "OI",
  typeSource: "import",
}) || "";

assert.ok(importBinding.includes('/** @type {typeof import("https://esm.sh/widget").Widget} */'));
assert.ok(importBinding.includes("const OI = module.Widget;"));

const bindingWithoutTypedef = matches.Widget?.toTypedBinding?.({
  localName: "WidgetValue",
  moduleName: "imported",
  includeTypedef: false,
}) || "";

assert.equal(bindingWithoutTypedef.includes("@typedef WidgetT"), false);
assert.ok(bindingWithoutTypedef.includes("const WidgetValue = imported.Widget;"));

const completionsWithoutDefault: CompletionResult = {
  ...completions,
  flat: [widgetEntry, widgetOptionsEntry, constructorMember, nameMember, optionsMember, runMember, defaultsMember, versionMember, retriesMember],
  byScope: {
    global: [widgetEntry, widgetOptionsEntry],
    "type:Widget": [constructorMember, nameMember, optionsMember, runMember, defaultsMember, versionMember],
    "type:WidgetOptions": [retriesMember],
  },
};

const defaultSkipped = buildRemoteEsmImportMatches({ Widget: {}, default: {} }, completionsWithoutDefault);
assert.deepEqual(Object.keys(defaultSkipped), ["Widget"]);

const defaultMatched = buildRemoteEsmImportMatches({ Widget: {}, default: {} }, completions);
assert.deepEqual(Object.keys(defaultMatched), ["Widget", "default"]);
