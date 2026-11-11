function getLyricsEntryText(entry: unknown): string[] {
  if (typeof entry === 'string') return entry.trim() ? [entry.trim()] : [];
  if (typeof entry !== 'object' || entry === null) return [];

  const record = entry as Record<string, unknown>;
  if (typeof record.text === 'string' && record.text.trim()) return [record.text.trim()];
  if (Array.isArray(record.syncText)) {
    return record.syncText.flatMap(item => getLyricsEntryText(item));
  }
  return [];
}

export function normalizeLyricsText(value: unknown): string | null {
  const lines = Array.isArray(value)
    ? value.flatMap(entry => getLyricsEntryText(entry))
    : getLyricsEntryText(value);
  return lines.length ? lines.join('\n') : null;
}
