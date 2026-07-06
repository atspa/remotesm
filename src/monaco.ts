import type { CompletionEntry } from "./types";

/** Convert completion entries into Monaco CompletionItem objects. */
export function toMonacoSuggestions(monaco: any, entries: CompletionEntry[], range: any): any[] {
  const kindMap: Record<string, any> = {
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
    Export: monaco.languages.CompletionItemKind.Module,
  };

  return entries.map((entry) => ({
    label: entry.label,
    kind: kindMap[entry.kind] || monaco.languages.CompletionItemKind.Text,
    insertText: entry.insertText,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    detail: entry.detail,
    documentation: entry.documentation,
    range,
  }));
}
