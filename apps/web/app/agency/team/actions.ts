'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';

/**
 * These writes are not trusted from the client. RLS lets only an owner touch
 * user_permissions and only an owner/admin touch user_location_access, and both
 * policies also check the target belongs to the caller's agency — so a forged call
 * from a manager's browser fails at the database, not here.
 */
export async function setPermission(
  agencyUserId: string,
  resource: string,
  allowed: boolean,
): Promise<void> {
  const db = await supabaseServer();
  await db.from('user_permissions').upsert(
    { agency_user_id: agencyUserId, resource, allowed },
    { onConflict: 'agency_user_id,resource' },
  );
  revalidatePath('/agency/team');
}

export async function setLocationAccess(
  agencyUserId: string,
  locationId: string,
  allowed: boolean,
): Promise<void> {
  const db = await supabaseServer();
  if (allowed) {
    await db.from('user_location_access')
      .upsert({ agency_user_id: agencyUserId, location_id: locationId });
  } else {
    await db.from('user_location_access')
      .delete()
      .eq('agency_user_id', agencyUserId)
      .eq('location_id', locationId);
  }
  revalidatePath('/agency/team');
}
