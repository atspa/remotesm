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
    ...partial,
  };
}

const widgetEntry = entry({
  label: "Widget",
  kind: "Interface",
  detail: "interface Widget { name: string; options: WidgetOptions; run(input: number): boolean; }",
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

const retriesMember = entry({
  scope: "type:WidgetOptions",
  label: "retries",
  kind: "Property",
  detail: "retries: number;",
  type: "number",
  memberOf: "WidgetOptions",
});

const completions: CompletionResult = {
  flat: [widgetEntry, widgetOptionsEntry, defaultEntry, nameMember, optionsMember, runMember, retriesMember],
  byScope: {
    global: [widgetEntry, widgetOptionsEntry, defaultEntry],
    "type:Widget": [nameMember, optionsMember, runMember],
    "type:WidgetOptions": [retriesMember],
  },
  types: {
    Widget: {
      kind: "Interface",
      detail: widgetEntry.detail,
      members: [nameMember, optionsMember, runMember],
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
assert.ok(jsdoc.includes("@typedef WidgetOptionsT"));
assert.ok(jsdoc.includes("@prop {n} retries"));
assert.ok(jsdoc.indexOf("@typedef WidgetOptionsT") < jsdoc.indexOf("@typedef WidgetT"));
assert.equal(jsdoc.includes("@property"), false);

const moduleWithoutDefaultMatch = {
  Widget: { name: "widget" },
  Missing: {},
};

const matches = buildRemoteEsmImportMatches(moduleWithoutDefaultMatch, completions);

assert.deepEqual(Object.keys(matches), ["Widget"]);
assert.equal(matches.Widget?.key, "Widget");
assert.equal(matches.Widget?.value, moduleWithoutDefaultMatch.Widget);
assert.equal(matches.Widget?.entry, widgetEntry);
assert.equal(matches.Widget?.type, completions.types.Widget);
assert.equal(typeof matches.Widget?.toJsdoc, "function");

const completionsWithoutDefault: CompletionResult = {
  ...completions,
  flat: [widgetEntry, widgetOptionsEntry, nameMember, optionsMember, runMember, retriesMember],
  byScope: {
    global: [widgetEntry, widgetOptionsEntry],
    "type:Widget": [nameMember, optionsMember, runMember],
    "type:WidgetOptions": [retriesMember],
  },
};

const defaultSkipped = buildRemoteEsmImportMatches({ Widget: {}, default: {} }, completionsWithoutDefault);
assert.deepEqual(Object.keys(defaultSkipped), ["Widget"]);

const defaultMatched = buildRemoteEsmImportMatches({ Widget: {}, default: {} }, completions);
assert.deepEqual(Object.keys(defaultMatched), ["Widget", "default"]);
