import type { LanguageDefinition } from "../types.js";

const symbolQuery = `
[
  (function_definition
    declarator: (function_declarator declarator: [(identifier) (field_identifier) (qualified_identifier)] @name)) @declaration
  (function_declarator declarator: [(identifier) (field_identifier) (qualified_identifier)] @name) @declaration
  (class_specifier name: (type_identifier) @name) @declaration
  (struct_specifier name: (type_identifier) @name) @declaration
  (union_specifier name: (type_identifier) @name) @declaration
  (enum_specifier name: (type_identifier) @name) @declaration
  (namespace_definition name: (namespace_identifier) @name) @declaration
  (type_definition declarator: (type_identifier) @name) @declaration
  (field_declaration declarator: (field_identifier) @name) @declaration
  (declaration declarator: (init_declarator declarator: (identifier) @name)) @declaration
]
`;

const importQuery = `
(preproc_include) @include
`;

const exportQuery = `
[
  (function_definition
    declarator: (function_declarator declarator: [(identifier) (field_identifier) (qualified_identifier)] @name)) @declaration
  (declaration
    declarator: (function_declarator declarator: [(identifier) (field_identifier) (qualified_identifier)] @name)) @declaration
  (class_specifier name: (type_identifier) @name) @declaration
  (struct_specifier name: (type_identifier) @name) @declaration
]
`;

export const cppLanguage: LanguageDefinition = {
  id: "cpp",
  name: "C++",
  extensions: ["cpp", "cc", "cxx", "hpp", "hh", "hxx"],
  grammarVersion: "tree-sitter-cpp@0.22.3",
  loadGrammar: async () => (await import("tree-sitter-cpp")).default,
  symbolQuery,
  importQuery,
  exportQuery,
  commentNodeTypes: ["comment"],
  nestingNodeTypes: [
    "compound_statement",
    "class_specifier",
    "struct_specifier",
    "union_specifier",
    "enum_specifier",
    "namespace_definition",
    "if_statement",
    "for_statement",
    "range_for_statement",
    "while_statement",
    "do_statement",
    "switch_statement",
    "try_statement",
    "catch_clause",
    "lambda_expression",
  ],
  decisionNodeTypes: [
    "if_statement",
    "for_statement",
    "range_for_statement",
    "while_statement",
    "do_statement",
    "case_statement",
    "catch_clause",
    "conditional_expression",
    "binary_expression",
  ],
  capabilities: { symbols: true, imports: true, exports: true, metrics: true, complexityEstimate: true },
};
