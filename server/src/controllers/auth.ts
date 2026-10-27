import type { Handler } from '../http/types';
import { Validator } from '../validation';

export const register: Handler = async (req, ctx) => {
  const v = new Validator(req.body);
  const name = v.string('name', { min: 1, max: 80 }), email = v.email('email'), password = v.newPassword('password');
  v.done();
  return { status: 201, body: await ctx.services.auth.register({ name: name as string, email: email as string, password: password as string }) };
};
export const login: Handler = async (req, ctx) => {
  const v = new Validator(req.body);
  const email = v.email('email'), password = v.secret('password');
  v.done();
  return { status: 200, body: await ctx.services.auth.login(email as string, password as string) };
};
export const me: Handler = async (req, ctx) => ({ status: 200, body: await ctx.services.auth.me(req.userId as string) });
// Stateless JWTs cannot be revoked server-side before they expire. Logout tells the client to discard its token; it does NOT invalidate it.
export const logout: Handler = () => ({ status: 204 });
