import { useAuthSession } from "@/hooks/useAuthSession";
import { isGuestUser } from "@/lib/guest";

/** True when the signed-in person is a sample-family guest (anonymous sign-in). */
export function useIsGuest(): boolean {
  const { user } = useAuthSession();
  return isGuestUser(user);
}
