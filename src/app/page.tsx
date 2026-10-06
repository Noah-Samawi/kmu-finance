import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveSession, SESSION_COOKIE } from "@/infrastructure/auth/session";
import { homeFor } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
  redirect(user ? homeFor(user.role) : "/login");
}
