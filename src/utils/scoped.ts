// Async results are tagged with the id they were loaded for, and only returned when that id is still current.
// This prevents a view from mixing data from a previous target career with a new targetCareerId.
export interface Scoped<T> { id: string; value: T }
export const scoped = <T>(slot: Scoped<T> | null, id: string): T | null => (slot && slot.id === id ? slot.value : null);
