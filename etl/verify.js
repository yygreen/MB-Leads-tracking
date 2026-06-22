// Data integrity gate: validates that a DashboardData object has the shape the
// UI depends on before it is served or persisted. Returns { ok, errors }.
export function verifyDashboard(data) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    return { ok: false, errors: ['not an object'] };
  }
  const required = [
    'lastUpdated',
    'summary',
    'timeline',
    'channelMix',
    'utmSources',
    'forms',
    'gbpLocations',
    'sources',
  ];
  for (const key of required) {
    if (!(key in data)) errors.push(`missing field: ${key}`);
  }
  if (data.summary && typeof data.summary.totalLeads30d !== 'number') {
    errors.push('summary.totalLeads30d must be a number');
  }
  if (!Array.isArray(data.timeline)) {
    errors.push('timeline must be an array');
  } else if (data.timeline.length > 0) {
    const p = data.timeline[0];
    for (const k of ['date', 'callrail', 'forms', 'calendly', 'leadtrap', 'gbpCalls', 'ga4Sessions']) {
      if (!(k in p)) errors.push(`timeline points missing: ${k}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
