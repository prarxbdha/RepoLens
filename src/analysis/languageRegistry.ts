/** Central registry for supported languages, extensions, grammars, and AST queries. */

import type { LanguageDefinition, LanguageId } from "./types.js";
import { javascriptLanguage, jsxLanguage } from "./languages/javascript.js";
import { typescriptLanguage, tsxLanguage } from "./languages/typescript.js";
import { pythonLanguage } from "./languages/python.js";
import { javaLanguage } from "./languages/java.js";
import { rustLanguage } from "./languages/rust.js";
import { cLanguage } from "./languages/c.js";
import { cppLanguage } from "./languages/cpp.js";

const definitions: readonly LanguageDefinition[] = [
  javascriptLanguage,
  jsxLanguage,
  typescriptLanguage,
  tsxLanguage,
  pythonLanguage,
  javaLanguage,
  rustLanguage,
  cLanguage,
  cppLanguage,
];

const byId = new Map<LanguageId, LanguageDefinition>(
  definitions.map((definition) => [definition.id, definition]),
);
const byExtension = new Map<string, LanguageDefinition>();
for (const definition of definitions) {
  for (const extension of definition.extensions) {
    if (!byExtension.has(extension)) byExtension.set(extension, definition);
  }
}

export function getLanguage(id: string): LanguageDefinition | null {
  return byId.get(id as LanguageId) ?? null;
}

export function detectLanguage(path: string): LanguageDefinition | null {
  const suffix = path.split("/").pop() ?? "";
  const dot = suffix.lastIndexOf(".");
  if (dot === -1 || dot === suffix.length - 1) return null;
  return byExtension.get(suffix.slice(dot + 1).toLowerCase()) ?? null;
}

export function isSupportedPath(path: string): boolean {
  return detectLanguage(path) !== null;
}

export function supportedExtensions(): string[] {
  return [...byExtension.keys()].sort();
}

export function supportedLanguages(): LanguageDefinition[] {
  return [...definitions];
}
