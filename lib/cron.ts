import { NextResponse } from 'next/server';

// Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is
// configured. When it isn't set (e.g. preview deploys), we allow the request so
// the skeleton stays clickable. Manual invocations from the dashboard's refresh
// button pass through the same gate.
export function authorizeCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${secret}`;
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
