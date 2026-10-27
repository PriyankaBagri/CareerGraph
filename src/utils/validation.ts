export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
export const PASSWORD_RULES = [
  { id: 'len', label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { id: 'letter', label: 'Contains a letter', test: (p: string) => /[A-Za-z]/.test(p) },
  { id: 'num', label: 'Contains a number', test: (p: string) => /\d/.test(p) },
];
export const passwordValid = (p: string) => PASSWORD_RULES.every((r) => r.test(p));
