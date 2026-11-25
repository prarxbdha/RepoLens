/** Boundary validation for every user-controlled argument. */

import { GitHubError } from "../github/errors.js";

const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;
const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/;

function invalid(message: string): never {
  throw new GitHubError("validation", message);
}

export function validateRepoPart(kind: "owner" | "repo", value: string): string {
  const trimmed = value.trim();
  if (!NAME_PATTERN.test(trimmed) || trimmed === "." || trimmed === "..") {
    invalid(`Invalid ${kind}: expected 1-100 characters using letters, digits, '.', '_' or '-'.`);
  }
  return trimmed;
}

export function validateRef(value: string | undefined, label = "ref"): string | undefined {
  if (value === undefined) return undefined;
  const ref = value.trim();
  if (ref.length === 0 || ref.length > 255 || CONTROL_PATTERN.test(ref)) {
    invalid(`Invalid ${label}: expected 1-255 printable characters.`);
  }
  if (ref.includes("..")) {
    invalid(`Invalid ${label}: '..' segments are not allowed.`);
  }
  return ref;
}

/** Alias retained for the existing public client API and legacy tool schema. */
export function validateBranch(value: string | undefined): string | undefined {
  return validateRef(value, "branch");
}

export function validatePath(value: string, label = "path"): string {
  const path = value.trim();
  if (path.length === 0 || path.length > 1_000 || CONTROL_PATTERN.test(path) || path.includes("\\")) {
    invalid(`Invalid ${label}: expected 1-1000 printable characters without backslashes.`);
  }
  if (path.startsWith("/") || path.endsWith("/") || path.includes("//")) {
    invalid(`Invalid ${label}: use a relative path without leading, trailing, or doubled slashes.`);
  }
  if (path.split("/").some((part) => part === "." || part === "..")) {
    invalid(`Invalid ${label}: '.' and '..' segments are not allowed.`);
  }
  return path;
}

export function validateLimit(
  value: number | undefined,
  fallback = 10,
  max = 50,
  label = "limit",
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > max) {
    invalid(`Invalid ${label}: expected an integer from 1 to ${max}.`);
  }
  return value;
}

export function validateState(value: string): "open" | "closed" | "all" {
  if (value === "open" || value === "closed" || value === "all") return value;
  invalid("Invalid state: expected 'open', 'closed' or 'all'.");
}

export function validateSha(value: string): string {
  const sha = value.trim();
  if (!/^[0-9a-fA-F]{7,40}$/.test(sha)) {
    invalid("Invalid sha: expected 7-40 hexadecimal characters.");
  }
  return sha;
}

export function validatePullNumber(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 1_000_000) {
    invalid("Invalid pull_number: expected an integer from 1 to 1000000.");
  }
  return value;
}

export function validateQuery(value: string): string {
  const query = value.trim();
  if (query.length === 0 || query.length > 200 || CONTROL_PATTERN.test(query)) {
    invalid("Invalid query: expected 1-200 printable characters.");
  }
  return query;
}

export function validateFilter(value: string | undefined, label: string, pattern: RegExp): string | undefined {
  if (value === undefined) return undefined;
  const filter = value.trim();
  if (filter.length === 0 || filter.length > 50 || !pattern.test(filter)) {
    invalid(`Invalid ${label}: expected a short identifier.`);
  }
  return filter;
}

export function validatePositiveInteger(
  value: number | undefined,
  label: string,
  fallback: number,
  min = 1,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    invalid(`Invalid ${label}: expected an integer from ${min} to ${max}.`);
  }
  return value;
}
