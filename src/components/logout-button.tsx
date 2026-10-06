"use client";

import { useRouter } from "next/navigation";
import { cx } from "./ui";

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={cx("text-sm font-medium text-muted hover:text-ink", className)}
      onClick={async () => {
        await fetch("/api/v1/auth/logout", { method: "POST" });
        router.replace("/login");
        router.refresh();
      }}
    >
      Abmelden
    </button>
  );
}
