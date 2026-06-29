// Type declarations for the plain-JS ETL modules so the TypeScript API routes
// get accurate signatures (the .js files are authored as runnable ESM).
import type { DashboardData } from '@/lib/types';

declare module '@/etl/_lib.js' {
  export function readJSON<T = unknown>(filename: string, fallback?: T): Promise<T>;
  export function writeJSON<T = unknown>(filename: string, data: T): Promise<T>;
  export function warnMissingEnv(source: string, vars: string[]): void;
}

declare module '@/etl/callrail.js' {
  export function pull(): Promise<any[]>;
}
declare module '@/etl/calendly.js' {
  export function pull(): Promise<any[]>;
}
declare module '@/etl/gbp.js' {
  export function pull(): Promise<any[]>;
}
declare module '@/etl/ga4.js' {
  export function pull(): Promise<any[]>;
}
declare module '@/etl/leadtrap.js' {
  export function pull(): Promise<any[]>;
}
declare module '@/etl/webflow.js' {
  export function pull(): Promise<any[]>;
}
declare module '@/etl/guard.js' {
  export function guardedWrite<T = unknown>(
    file: string,
    incoming: T,
    opts?: { allowEmpty?: boolean }
  ): Promise<T>;
}
declare module '@/etl/aggregate.js' {
  export function aggregate(): Promise<DashboardData>;
}
