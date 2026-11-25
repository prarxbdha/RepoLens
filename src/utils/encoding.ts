/** Safe decoding of GitHub content payloads without executing repository data. */

import { GitHubError } from "../github/errors.js";

export interface DecodedContent {
  bytes: Buffer;
  text: string;
  truncated: boolean;
  binary: boolean;
  /** Byte length before the size limit was applied. */
  originalBytes: number;
}

export interface NumberedLine {
  number: number;
  content: string;
}

export interface LineRangeResult {
  lines: NumberedLine[];
  startLine: number;
  endLine: number;
  requestedEndLine: number;
  truncated: boolean;
}

function isBinary(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8_192));
  if (sample.includes(0)) return true;
  if (sample.length === 0) return false;
  let controls = 0;
  for (const byte of sample) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) controls += 1;
  }
  return controls / sample.length > 0.1;
}

function finalize(bytes: Buffer, limit: number): DecodedContent {
  const truncated = bytes.length > limit;
  const kept = truncated ? bytes.subarray(0, limit) : bytes;
  return {
    bytes: kept,
    text: kept.toString("utf8"),
    truncated,
    binary: isBinary(kept),
    originalBytes: bytes.length,
  };
}

export function decodeBase64Content(encoded: string, maxBytes: number): DecodedContent {
  const compact = encoded.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 === 1) {
    throw new GitHubError("invalid-response", "GitHub returned an invalid base64 payload.");
  }
  return finalize(Buffer.from(compact, "base64"), maxBytes);
}

export function decodePlainContent(text: string, maxBytes: number): DecodedContent {
  return finalize(Buffer.from(text, "utf8"), maxBytes);
}

/** Supports the encodings GitHub's contents API can return for text files. */
export function decodeGitHubContent(
  encoding: string,
  content: string,
  maxBytes: number,
): DecodedContent {
  const normalized = encoding.trim().toLowerCase();
  if (normalized === "base64") return decodeBase64Content(content, maxBytes);
  if (normalized === "none") return decodePlainContent(content, maxBytes);
  throw new GitHubError("invalid-response", `Unsupported GitHub content encoding: ${encoding}.`);
}

export function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function extractLineRange(
  lines: string[],
  startLine: number,
  endLine: number,
): LineRangeResult {
  const requestedEndLine = endLine;
  const last = Math.min(endLine, lines.length);
  const selected: NumberedLine[] = [];
  for (let number = startLine; number <= last; number += 1) {
    selected.push({ number, content: lines[number - 1] ?? "" });
  }
  return {
    lines: selected,
    startLine,
    endLine: last,
    requestedEndLine,
    truncated: last < requestedEndLine,
  };
}
