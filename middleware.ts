import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// OPTIONAL password gate for the dashboard itself.
//
// The dashboard is public by default — that is how the client is given access
// today, and changing it silently would lock them out. Set DASHBOARD_PASSWORD
// (and optionally DASHBOARD_USER, default "mb") to require HTTP Basic auth
// instead. While the variable is unset this middleware does nothing.
//
// Scope is deliberately narrow: the dashboard page and the two endpoints it
// reads. It must NOT cover the webhook receivers (their senders can't do Basic
// auth) or /api/cron/* and /api/diagnostics/* (those authenticate with an
// `Authorization: Bearer` header, which Basic auth would collide with).
export const config = {
  matcher: ['/', '/api/data', '/api/gbp/daily'],
};

export function middleware(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();

  const user = process.env.DASHBOARD_USER || 'mb';
  const header = req.headers.get('authorization') || '';

  if (header.startsWith('Basic ')) {
    let decoded = '';
    try {
      decoded = atob(header.slice(6));
    } catch {
      decoded = '';
    }
    // Split on the FIRST colon only — passwords may contain colons.
    const i = decoded.indexOf(':');
    if (i !== -1 && decoded.slice(0, i) === user && decoded.slice(i + 1) === password) {
      return NextResponse.next();
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      // ASCII only: header values are ByteStrings, so a non-latin-1 character
      // here (an em dash, say) makes constructing the response throw.
      'WWW-Authenticate': 'Basic realm="Lead Tracking", charset="UTF-8"',
    },
  });
}
