"use server";

import { getAdminSession } from "@/lib/admin-auth";

export async function checkIsAdmin(): Promise<boolean> {
  const session = await getAdminSession();
  return !!session;
}
