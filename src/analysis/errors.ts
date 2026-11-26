import type { AnalysisErrorInfo } from "./types.js";

/** Failures raised by the static analysis engine, independent of GitHub/MCP. */
export class AnalysisError extends Error {
  readonly kind: AnalysisErrorInfo["kind"];

  constructor(kind: AnalysisErrorInfo["kind"], message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "AnalysisError";
    this.kind = kind;
  }
}
