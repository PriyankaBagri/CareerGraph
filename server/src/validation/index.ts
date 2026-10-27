import { AppError } from '../errors';

export class ValidationError extends AppError {
  constructor(public readonly fields: Record<string, string>) { super(400, 'validation_failed', 'Some fields are invalid.', fields); }
}
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface Opt { optional?: boolean }
// Collects every field problem, then throws ONE ValidationError (400) from done(). Controllers use this for bodies and queries.
export class Validator {
  private readonly errors: Record<string, string> = {};
  private readonly src: Record<string, unknown>;
  constructor(source: unknown) {
    if (!isObject(source)) throw new ValidationError({ _: 'A JSON object is required.' });
    this.src = source;
  }
  private fail(field: string, msg: string): undefined { this.errors[field] = msg; return undefined; }
  private raw(field: string, o: Opt): unknown { const v = this.src[field]; if (v === undefined || v === null) { if (!o.optional) this.fail(field, 'This field is required.'); return undefined; } return v; }
  string(field: string, o: Opt & { min?: number; max?: number; pattern?: RegExp; patternMessage?: string } = {}): string | undefined {
    const v = this.raw(field, o); if (v === undefined) return undefined;
    if (typeof v !== 'string') return this.fail(field, 'Must be text.');
    const s = v.trim();
    if (s.length < (o.min ?? 1)) return this.fail(field, o.min && o.min > 1 ? `Must be at least ${o.min} characters.` : 'This field is required.');
    if (s.length > (o.max ?? 500)) return this.fail(field, `Must be at most ${o.max ?? 500} characters.`);
    if (o.pattern && !o.pattern.test(s)) return this.fail(field, o.patternMessage ?? 'Has an invalid format.');
    return s;
  }
  int(field: string, o: Opt & { min?: number; max?: number } = {}): number | undefined {
    const v = this.raw(field, o); if (v === undefined) return undefined;
    if (typeof v !== 'number' || !Number.isInteger(v)) return this.fail(field, 'Must be a whole number.');
    if (v < (o.min ?? Number.MIN_SAFE_INTEGER) || v > (o.max ?? Number.MAX_SAFE_INTEGER)) return this.fail(field, `Must be between ${o.min ?? 'any'} and ${o.max ?? 'any'}.`);
    return v;
  }
  bool(field: string, o: Opt = {}): boolean | undefined {
    const v = this.raw(field, o); if (v === undefined) return undefined;
    return typeof v === 'boolean' ? v : this.fail(field, 'Must be true or false.');
  }
  enum<T extends string>(field: string, allowed: readonly T[], o: Opt = {}): T | undefined {
    const v = this.raw(field, o); if (v === undefined) return undefined;
    return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : this.fail(field, `Must be one of: ${allowed.join(', ')}.`);
  }
  uuid(field: string, o: Opt = {}): string | undefined {
    const v = this.raw(field, o); if (v === undefined) return undefined;
    return typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : this.fail(field, 'Must be a valid id.');
  }
  stringArray(field: string, o: Opt & { minItems?: number; maxItems?: number; maxLength?: number } = {}): string[] | undefined {
    const v = this.raw(field, o); if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x.trim() || x.length > (o.maxLength ?? 200))) return this.fail(field, 'Must be a list of non-empty text values.');
    if (v.length < (o.minItems ?? 0) || v.length > (o.maxItems ?? 100)) return this.fail(field, `Must contain between ${o.minItems ?? 0} and ${o.maxItems ?? 100} items.`);
    return [...new Set(v.map((x: string) => x.trim()))];
  }
  email(field: string, o: Opt = {}): string | undefined {
    const v = this.raw(field, o); if (v === undefined) return undefined;
    if (typeof v !== 'string') return this.fail(field, 'Must be text.');
    const s = v.trim().toLowerCase(); // emails are normalized once, here: trimmed + lower-cased
    return s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : this.fail(field, 'Enter a valid email address.');
  }
  // New passwords: 8-128 chars with a letter and a number. Never trimmed or logged.
  newPassword(field: string): string | undefined {
    const v = this.raw(field, {}); if (v === undefined) return undefined;
    if (typeof v !== 'string') return this.fail(field, 'Must be text.');
    if (v.length < 8) return this.fail(field, 'Must be at least 8 characters.');
    if (v.length > 128) return this.fail(field, 'Must be at most 128 characters.');
    return /[A-Za-z]/.test(v) && /\d/.test(v) ? v : this.fail(field, 'Must contain a letter and a number.');
  }
  // Existing password at login: presence and length only (rules may have changed since it was set).
  secret(field: string): string | undefined {
    const v = this.raw(field, {}); if (v === undefined) return undefined;
    return typeof v === 'string' && v.length > 0 && v.length <= 128 ? v : this.fail(field, 'Enter your password.');
  }
  // Optional nullable text: absent -> undefined (leave unchanged); null or "" -> null (clear); otherwise trimmed text.
  nullableText(field: string, max: number): string | null | undefined {
    if (!(field in this.src)) return undefined;
    const v = this.src[field];
    if (v === null) return null;
    if (typeof v !== 'string') return this.fail(field, 'Must be text or null.');
    const s = v.trim();
    if (s.length > max) return this.fail(field, `Must be at most ${max} characters.`);
    return s === '' ? null : s;
  }
  done(): void { if (Object.keys(this.errors).length) throw new ValidationError({ ...this.errors }); }
}
export const parseUuid = (value: unknown): string | null => (typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null);
