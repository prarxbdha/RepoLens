/** Language distribution shared by the language tool and composite analysis. */

export interface LanguageShare {
  name: string;
  bytes: number;
  percentage: number;
}

export function languageBreakdown(languages: Record<string, number>): LanguageShare[] {
  const entries = Object.entries(languages)
    .filter(([, bytes]) => Number.isFinite(bytes) && bytes >= 0)
    .sort((left, right) => right[1] - left[1]);
  const total = entries.reduce((sum, [, bytes]) => sum + bytes, 0);
  return entries.map(([name, bytes]) => ({
    name,
    bytes,
    percentage: total === 0 ? 0 : Number(((bytes / total) * 100).toFixed(2)),
  }));
}
