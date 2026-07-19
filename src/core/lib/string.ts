export function escapeJsString(value: string): string {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function isIdentifierName(value: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(value);
}

export function sanitizeBindingName(name: string): string {
  if (name === "default") return "defaultExport";
  const value = String(name || "").replace(/[^\w$]/g, "_");
  if (!value) return "value";
  return /^\d/.test(value) ? `_${value}` : value;
}

export function propertyAccessor(key: string): string {
  return isIdentifierName(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

export const exportTypeAccessor = propertyAccessor;
export const runtimePropertyAccessor = propertyAccessor;
