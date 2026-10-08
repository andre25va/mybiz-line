import { unstable_noStore as noStore } from 'next/cache';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import AdminPortalClient from '@/components/admin/AdminPortalClient';
import { lookupActiveAdmin } from '@/lib/admin-portal-access';
import { verifySession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export default async function AdminPage() {
  noStore();
  let authorized = false;
  try {
    const token = cookies().get('mbl_session')?.value;
    const userId = token ? verifySession(token) : null;
    authorized = !!userId && await lookupActiveAdmin(userId);
  } catch {
    authorized = false;
  }
  if (!authorized) notFound();
  return <AdminPortalClient />;
}
