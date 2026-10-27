import type { Config } from '../config';
import type { Db } from '../db/types';
import type { Logger } from '../logger';
import type { Services } from '../services';

// Framework-agnostic request/response. Express is only a transport (app.ts), so routing, CORS, errors and health are all unit-testable.
export interface RawRequest { method: string; path: string; query: Record<string, string | undefined>; headers: Record<string, string | undefined>; body?: unknown }
export interface HttpRequest extends RawRequest { params: Record<string, string>; userId?: string } // userId is set ONLY by the auth step, from a verified token
export interface HttpResponse { status: number; headers?: Record<string, string>; body?: unknown }
export interface AppContext { config: Config; db: Db; logger: Logger; services: Services; now: () => Date; version: string; healthTimeoutMs: number }
export type Handler = (req: HttpRequest, ctx: AppContext) => Promise<HttpResponse> | HttpResponse;
export interface Route { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; auth?: boolean; handler: Handler }
