// Shortens long labels (e.g. graph nodes) so they never run past their column; the full text stays available in a <title>.
export const shortLabel = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1)).trimEnd()}…`);
