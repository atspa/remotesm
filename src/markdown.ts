/** Render a markdown code block without nested triple-backtick problems. */
export function markdownCodeBlock(code: string, lang = "js"): string {
  return "~~~~" + lang + "\n" + String(code || "") + "\n~~~~";
}
