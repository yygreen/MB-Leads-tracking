import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

// Constant-time compare so a wrong token can't be discovered byte by byte.
function secretMatches(header: string | null, secret: string): boolean {
  if (!header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

// SCHEDULED PULLS ONLY (the routes listed in vercel.json's `crons`, plus the
// dashboard's refresh button).
//
// Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is
// configured. When it isn't set, we allow the request — fail-closed here would
// silently stop every scheduled pull the moment the variable went missing, and
// these routes only re-fetch data we already own. They are idempotent reads,
// so the worst an anonymous caller achieves is spending upstream API quota.
//
// This is deliberately WEAKER than authorizeAdmin. Anything that reads stored
// records, mutates them, or hits a paid API on demand must use that instead.
export function authorizeCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return secretMatches(req.headers.get('authorization'), secret);
}

// ADMIN / DIAGNOSTIC SURFACES — fail closed.
//
// Destructive operations (?reset=1, ?removeDate=), anything that reads stored
// lead records back out, and anything that spends API quota on demand. Unlike
// authorizeCron this denies when CRON_SECRET is absent: no secret configured
// means no admin access, never open access. Nothing scheduled depends on it,
// so denying costs availability nowhere.
export function authorizeAdmin(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return secretMatches(req.headers.get('authorization'), secret);
}

// Shared 401 body, plus the reason an admin call was refused — without it a
// missing CRON_SECRET is indistinguishable from a wrong token.
export function unauthorized(req?: Request) {
  const configured = Boolean(process.env.CRON_SECRET);
  return NextResponse.json(
    {
      ok: false,
      error: 'unauthorized',
      ...(configured ? {} : { reason: 'CRON_SECRET is not configured; admin endpoints are disabled' }),
    },
    { status: 401 }
  );
}

type PullFn = () => Promise<unknown[]>;

// Wraps the common cron lifecycle: auth gate -> pull -> persist -> respond.
export async function runCron(
  req: Request,
  opts: {
    source: string;
    file: string;
    pull: PullFn;
    write: (file: string, data: unknown) => Promise<unknown>;
  }
) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const records = await opts.pull();
    await opts.write(opts.file, records);
    return NextResponse.json({
      ok: true,
      source: opts.source,
      count: records.length,
      ranAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error(`[cron:${opts.source}] failed:`, err);
    return NextResponse.json(
      { ok: false, source: opts.source, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
