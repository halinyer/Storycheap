import "server-only";
import { cookies } from "next/headers";

export const ADMIN_INCLUDE_TESTS_COOKIE = "sc_admin_include_tests";

export async function getAdminIncludeTestsPreference(): Promise<boolean> {
  try {
    const store = await cookies();
    return store.get(ADMIN_INCLUDE_TESTS_COOKIE)?.value === "1";
  } catch {
    return false;
  }
}
