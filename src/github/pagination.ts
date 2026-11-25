/** GitHub Link-header parsing and bounded page collection. */

export interface ParsedLinkHeader {
  next?: string;
  prev?: string;
  first?: string;
  last?: string;
}

export function parseLinkHeader(header: string | null): ParsedLinkHeader {
  if (header === null || header.trim() === "") return {};
  const result: ParsedLinkHeader = {};
  for (const part of header.split(",")) {
    const match = /^\s*<([^>]+)>\s*;\s*rel="([^"]+)"\s*$/.exec(part);
    if (match === null) continue;
    const [, url, rel] = match;
    if (rel === "next" || rel === "prev" || rel === "first" || rel === "last") {
      result[rel] = url;
    }
  }
  return result;
}

export function hasNextPage(headers: Headers): boolean {
  return parseLinkHeader(headers.get("link")).next !== undefined;
}

export interface Page<T> {
  data: T[];
  hasNextPage: boolean;
}

export interface CollectedPages<T> {
  items: T[];
  pagesFetched: number;
  truncated: boolean;
}

/** Fetches pages sequentially until the caller's bound is reached. */
export async function collectPages<T>(
  fetchPage: (page: number) => Promise<Page<T>>,
  maxItems: number,
  firstPage = 1,
  maxPages = 20,
): Promise<CollectedPages<T>> {
  const items: T[] = [];
  let pagesFetched = 0;
  let truncated = false;
  for (let page = firstPage; page < firstPage + maxPages; page += 1) {
    const result = await fetchPage(page);
    pagesFetched += 1;
    for (const item of result.data) {
      if (items.length >= maxItems) {
        truncated = true;
        break;
      }
      items.push(item);
    }
    if (truncated || !result.hasNextPage || result.data.length === 0) break;
  }
  return { items, pagesFetched, truncated };
}
