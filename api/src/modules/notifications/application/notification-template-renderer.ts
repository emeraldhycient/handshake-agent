/**
 * Deterministic, side-effect-free template rendering (NTF-07). Replaces every
 * `{{name}}` placeholder (optionally padded with inner whitespace) with the
 * matching variable value. Unknown placeholders render as blank — documented and
 * intentional: a missing variable never leaks the literal `{{name}}` token to a
 * user. No HTML/markup is interpreted; the input string is returned verbatim
 * except for the placeholder substitutions.
 */
const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function renderTemplate(
  content: string,
  vars: Record<string, string>,
): string {
  return content.replace(PLACEHOLDER, (_match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : '',
  );
}
