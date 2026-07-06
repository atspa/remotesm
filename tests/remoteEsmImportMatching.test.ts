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
  detail: "interface Widget { name: string; run(input: number): boolean; }",
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

const runMember = entry({
  scope: "type:Widget",
  label: "run",
  kind: "Method",
  insertText: "run(${1:input})",
  detail: "run(input: number): boolean;",
  returnType: "boolean",
  memberOf: "Widget",
});

const completions: CompletionResult = {
  flat: [widgetEntry, defaultEntry, nameMember, runMember],
  byScope: {
    global: [widgetEntry, defaultEntry],
    "type:Widget": [nameMember, runMember],
  },
  types: {
    Widget: {
      kind: "Interface",
      detail: widgetEntry.detail,
      members: [nameMember, runMember],
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

assert.ok(jsdoc.includes("/** @typedef WidgetT @prop {s} name @prop {(input:n) => b} run */"));
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
  flat: [widgetEntry, nameMember, runMember],
  byScope: {
    global: [widgetEntry],
    "type:Widget": [nameMember, runMember],
  },
};

const defaultSkipped = buildRemoteEsmImportMatches({ Widget: {}, default: {} }, completionsWithoutDefault);
assert.deepEqual(Object.keys(defaultSkipped), ["Widget"]);

const defaultMatched = buildRemoteEsmImportMatches({ Widget: {}, default: {} }, completions);
assert.deepEqual(Object.keys(defaultMatched), ["Widget", "default"]);
