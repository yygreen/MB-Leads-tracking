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
declare module '@/etl/gbp.js' {
  export function pull(): Promise<any[]>;
  export function gbpCreds(): { clientId: string; clientSecret: string; refreshToken: string } | null;
  export function getAccessToken(c: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }): Promise<{ accessToken: string; scope: string | null }>;
  export function discover(accessToken: string): Promise<{
    account: { name: string; accountName: string | null; type: string | null };
    accountCandidates: Array<{ name: string; accountName?: string; type?: string }>;
    locations: Array<{
      location_id: string;
      name: string;
      title: string | null;
      storeCode: string | null;
      address: string;
      city: string;
      state: string | null;
      matched: boolean;
    }>;
  }>;
  export function fetchLocationMetrics(
    loc: { name: string; location_id: string; city: string; state: string | null },
    accessToken: string,
    opts?: { startDate: Date; endDate: Date; includeVisibility?: boolean }
  ): Promise<any[]>;
  export function metricsWindow(opts?: {
    backfillTo?: string | null;
    lagDays?: number;
    days?: number;
  }): { startDate: Date; endDate: Date };
}
declare module '@/etl/ga4.js' {
  export function pull(): Promise<any[]>;
}
declare module '@/etl/leadtrap.js' {
  export function pull(): Promise<any[]>;
}
declare module '@/etl/webflow.js' {
  export function pull(): Promise<any[]>;
  export function sampleRaw(): Promise<any>;
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
