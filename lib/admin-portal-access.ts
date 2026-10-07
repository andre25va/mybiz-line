export function isExactActiveAdmin(rows: unknown): boolean {
  if (!Array.isArray(rows) || rows.length !== 1) return false;
  const row = rows[0];
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return false;
  const record = row as { is_admin?: unknown; is_active?: unknown };
  return record.is_admin === true && record.is_active === true;
}

export async function lookupActiveAdmin(userId: string): Promise<boolean> {
  if (!userId) return false;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return false;

  const lookupUrl =
    `${supabaseUrl}/rest/v1/users?id=eq.${encodeURIComponent(userId)}` +
    '&select=is_admin,is_active&limit=1';

  try {
    const lookup = await fetch(lookupUrl, {
      cache: 'no-store',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: 'application/json',
      },
    });
    if (!lookup.ok) return false;
    return isExactActiveAdmin(await lookup.json());
  } catch {
    return false;
  }
}
