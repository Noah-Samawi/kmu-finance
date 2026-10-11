"use client";

import { useRouter } from "next/navigation";
import { cx } from "./ui";
import { useT } from "./i18n";

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const t = useT();
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
      {t("auth.logout")}
    </button>
  );
}
