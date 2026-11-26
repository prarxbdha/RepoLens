import type { LanguageDefinition } from "../types.js";

const symbolQuery = `
[
  (function_definition declarator: (function_declarator declarator: (identifier) @name)) @declaration
  (function_declarator declarator: (identifier) @name) @declaration
  (struct_specifier name: (type_identifier) @name) @declaration
  (union_specifier name: (type_identifier) @name) @declaration
  (enum_specifier name: (type_identifier) @name) @declaration
  (type_definition declarator: (type_identifier) @name) @declaration
  (declaration declarator: (init_declarator declarator: (identifier) @name)) @declaration
  (declaration declarator: (identifier) @name) @declaration
]
`;

const importQuery = `
(preproc_include) @include
`;

const exportQuery = `
[
  (function_definition declarator: (function_declarator declarator: (identifier) @name)) @declaration
  (declaration declarator: (function_declarator declarator: (identifier) @name)) @declaration
]
`;

export const cLanguage: LanguageDefinition = {
  id: "c",
  name: "C",
  extensions: ["c", "h"],
  grammarVersion: "tree-sitter-c@0.21.4",
  loadGrammar: async () => (await import("tree-sitter-c")).default,
  symbolQuery,
  importQuery,
  exportQuery,
  commentNodeTypes: ["comment"],
  nestingNodeTypes: [
    "compound_statement",
    "struct_specifier",
    "union_specifier",
    "enum_specifier",
    "if_statement",
    "for_statement",
    "while_statement",
    "do_statement",
    "switch_statement",
    "case_statement",
    "label_statement",
  ],
  decisionNodeTypes: [
    "if_statement",
    "for_statement",
    "while_statement",
    "do_statement",
    "case_statement",
    "conditional_expression",
    "binary_expression",
  ],
  capabilities: { symbols: true, imports: true, exports: true, metrics: true, complexityEstimate: true },
};
