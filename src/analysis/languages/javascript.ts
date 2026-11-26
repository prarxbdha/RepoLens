import type { LanguageDefinition } from "../types.js";

const symbolQuery = `
[
  (function_declaration name: (_) @name) @declaration
  (generator_function_declaration name: (_) @name) @declaration
  (function_expression name: (_) @name) @declaration
  (class_declaration name: (_) @name) @declaration
  (class name: (_) @name) @declaration
  (method_definition name: (_) @name) @declaration
  (variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)]) @declaration
  (lexical_declaration "const" (variable_declarator name: (identifier) @name)) @declaration
  (variable_declaration (variable_declarator name: (identifier) @name)) @declaration
]
`;

const importQuery = `
[
  (import_statement) @import
  (call_expression
    function: (identifier) @callee
    arguments: (arguments (string) @module)
    (#eq? @callee "require")) @require
]
`;

const exportQuery = `
[
  (export_statement) @export
  (assignment_expression
    left: (member_expression
      object: (identifier) @object
      property: (property_identifier) @property)
    right: (_) @value) @assignment
]
`;

export const javascriptLanguage: LanguageDefinition = {
  id: "javascript",
  name: "JavaScript",
  extensions: ["js", "mjs", "cjs"],
  grammarVersion: "tree-sitter-javascript@0.21.4",
  loadGrammar: async () => (await import("tree-sitter-javascript")).default,
  symbolQuery,
  importQuery,
  exportQuery,
  commentNodeTypes: ["comment"],
  nestingNodeTypes: [
    "statement_block",
    "class_body",
    "if_statement",
    "for_statement",
    "for_in_statement",
    "while_statement",
    "do_statement",
    "switch_statement",
    "try_statement",
    "catch_clause",
    "arrow_function",
    "function_expression",
  ],
  decisionNodeTypes: [
    "if_statement",
    "for_statement",
    "for_in_statement",
    "while_statement",
    "do_statement",
    "case_clause",
    "catch_clause",
    "conditional_expression",
    "binary_expression",
  ],
  capabilities: { symbols: true, imports: true, exports: true, metrics: true, complexityEstimate: true },
};

export const jsxLanguage: LanguageDefinition = {
  ...javascriptLanguage,
  id: "jsx",
  name: "JavaScript (JSX)",
  extensions: ["jsx"],
};
