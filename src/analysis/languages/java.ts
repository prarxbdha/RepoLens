import type { LanguageDefinition } from "../types.js";

const symbolQuery = `
[
  (class_declaration name: (identifier) @name) @declaration
  (interface_declaration name: (identifier) @name) @declaration
  (enum_declaration name: (identifier) @name) @declaration
  (annotation_type_declaration name: (identifier) @name) @declaration
  (method_declaration name: (identifier) @name) @declaration
  (constructor_declaration name: (identifier) @name) @declaration
  (field_declaration declarator: (variable_declarator name: (identifier) @name)) @declaration
]
`;

const importQuery = `
(import_declaration) @import
`;

const exportQuery = `
[
  (class_declaration (modifiers) @modifiers name: (identifier) @name) @declaration
  (interface_declaration (modifiers) @modifiers name: (identifier) @name) @declaration
  (enum_declaration (modifiers) @modifiers name: (identifier) @name) @declaration
  (method_declaration (modifiers) @modifiers name: (identifier) @name) @declaration
  (constructor_declaration (modifiers) @modifiers name: (identifier) @name) @declaration
  (field_declaration (modifiers) @modifiers declarator: (variable_declarator name: (identifier) @name)) @declaration
]
`;

export const javaLanguage: LanguageDefinition = {
  id: "java",
  name: "Java",
  extensions: ["java"],
  grammarVersion: "tree-sitter-java@0.21.0",
  loadGrammar: async () => (await import("tree-sitter-java")).default,
  symbolQuery,
  importQuery,
  exportQuery,
  commentNodeTypes: ["line_comment", "block_comment"],
  nestingNodeTypes: [
    "block",
    "class_body",
    "interface_body",
    "enum_body",
    "constructor_body",
    "if_statement",
    "for_statement",
    "enhanced_for_statement",
    "while_statement",
    "do_statement",
    "switch_expression",
    "try_statement",
    "catch_clause",
    "lambda_expression",
  ],
  decisionNodeTypes: [
    "if_statement",
    "for_statement",
    "enhanced_for_statement",
    "while_statement",
    "do_statement",
    "switch_label",
    "catch_clause",
    "ternary_expression",
    "binary_expression",
  ],
  capabilities: { symbols: true, imports: true, exports: true, metrics: true, complexityEstimate: true },
};
