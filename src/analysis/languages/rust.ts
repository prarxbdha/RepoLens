import type { LanguageDefinition } from "../types.js";

const symbolQuery = `
[
  (function_item name: (identifier) @name) @declaration
  (function_signature_item name: (identifier) @name) @declaration
  (struct_item name: (type_identifier) @name) @declaration
  (enum_item name: (type_identifier) @name) @declaration
  (union_item name: (type_identifier) @name) @declaration
  (trait_item name: (type_identifier) @name) @declaration
  (type_item name: (type_identifier) @name) @declaration
  (mod_item name: (identifier) @name) @declaration
  (macro_definition name: (identifier) @name) @declaration
  (const_item name: (identifier) @name) @declaration
  (static_item name: (identifier) @name) @declaration
  (field_declaration name: (field_identifier) @name) @declaration
]
`;

const importQuery = `
(use_declaration) @import
`;

const exportQuery = `
[
  (function_item (visibility_modifier) @visibility name: (identifier) @name) @declaration
  (struct_item (visibility_modifier) @visibility name: (type_identifier) @name) @declaration
  (enum_item (visibility_modifier) @visibility name: (type_identifier) @name) @declaration
  (union_item (visibility_modifier) @visibility name: (type_identifier) @name) @declaration
  (trait_item (visibility_modifier) @visibility name: (type_identifier) @name) @declaration
  (type_item (visibility_modifier) @visibility name: (type_identifier) @name) @declaration
  (mod_item (visibility_modifier) @visibility name: (identifier) @name) @declaration
  (const_item (visibility_modifier) @visibility name: (identifier) @name) @declaration
  (static_item (visibility_modifier) @visibility name: (identifier) @name) @declaration
]
`;

export const rustLanguage: LanguageDefinition = {
  id: "rust",
  name: "Rust",
  extensions: ["rs"],
  grammarVersion: "tree-sitter-rust@0.21.0",
  loadGrammar: async () => (await import("tree-sitter-rust")).default,
  symbolQuery,
  importQuery,
  exportQuery,
  commentNodeTypes: ["line_comment", "block_comment"],
  nestingNodeTypes: [
    "block",
    "declaration_list",
    "field_declaration_list",
    "enum_variant_list",
    "if_expression",
    "while_expression",
    "for_expression",
    "loop_expression",
    "match_expression",
    "match_block",
    "try_expression",
    "closure_expression",
  ],
  decisionNodeTypes: [
    "if_expression",
    "while_expression",
    "for_expression",
    "loop_expression",
    "match_arm",
    "binary_expression",
  ],
  capabilities: { symbols: true, imports: true, exports: true, metrics: true, complexityEstimate: true },
};
