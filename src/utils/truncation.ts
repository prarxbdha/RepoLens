/** Shared size bounds so every tool reports truncation explicitly. */

export interface TruncatedArray<T> {
  items: T[];
  total: number;
  truncated: boolean;
}

export interface TruncatedText {
  text: string;
  originalLength: number;
  truncated: boolean;
}

export function truncateArray<T>(items: readonly T[], max: number): TruncatedArray<T> {
  return {
    items: items.slice(0, max),
    total: items.length,
    truncated: items.length > max,
  };
}

export function truncateText(value: string, maxChars: number): TruncatedText {
  return {
    text: value.slice(0, maxChars),
    originalLength: value.length,
    truncated: value.length > maxChars,
  };
}
