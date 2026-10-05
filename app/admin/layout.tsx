import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { verifySession } from '@/lib/session';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies();
  const token = cookieStore.get('mbl_session')?.value;

  if (!token) redirect('/login');

  const userId = verifySession(token);
  if (!userId) redirect('/login');

  // Check admin role
  const { data: user } = await supabase
    .from('users')
    .select('role')
    .eq('id', userId)
    .single();

  if (user?.role !== 'admin') redirect('/');

  return <>{children}</>;
}
