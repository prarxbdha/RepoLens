import type { LanguageDefinition } from "../types.js";

const symbolQuery = `
[
  (class_definition name: (identifier) @name) @declaration
  (function_definition name: (identifier) @name) @declaration
  (expression_statement (assignment left: (identifier) @name right: (_)) @declaration)
]
`;

const importQuery = `
[
  (import_statement) @import
  (import_from_statement) @import
]
`;

const exportQuery = `
(expression_statement
  (assignment left: (identifier) @name right: (list)) @export)
`;

export const pythonLanguage: LanguageDefinition = {
  id: "python",
  name: "Python",
  extensions: ["py", "pyi"],
  grammarVersion: "tree-sitter-python@0.21.0",
  loadGrammar: async () => (await import("tree-sitter-python")).default,
  symbolQuery,
  importQuery,
  exportQuery,
  commentNodeTypes: ["comment"],
  nestingNodeTypes: [
    "block",
    "class_definition",
    "function_definition",
    "if_statement",
    "elif_clause",
    "else_clause",
    "for_statement",
    "while_statement",
    "try_statement",
    "except_clause",
    "with_statement",
    "match_statement",
    "case_clause",
    "list_comprehension",
    "dictionary_comprehension",
    "set_comprehension",
    "generator_expression",
  ],
  decisionNodeTypes: [
    "if_statement",
    "elif_clause",
    "for_statement",
    "while_statement",
    "except_clause",
    "case_clause",
    "conditional_expression",
    "boolean_operator",
    "comparison_operator",
  ],
  capabilities: { symbols: true, imports: true, exports: true, metrics: true, complexityEstimate: true },
};
