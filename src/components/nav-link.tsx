"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

export function NavLink({ href, children, badge, variant = "side" }: { href: string; children: React.ReactNode; badge?: number; variant?: "side" | "bottom" | "top" }) {
  const path = usePathname();
  const active = path === href || (href !== "/me" && path.startsWith(href + "/"));
  if (variant === "bottom") {
    return (
      <Link href={href} aria-current={active ? "page" : undefined}
        className={cx("flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-semibold", active ? "text-ledger" : "text-muted")}>
        {children}
      </Link>
    );
  }
  if (variant === "top") {
    return (
      <Link href={href} aria-current={active ? "page" : undefined}
        className={cx("shrink-0 rounded-full px-3 py-1.5 text-sm font-medium", active ? "bg-ledger text-white" : "text-muted")}>
        {children}{badge ? ` (${badge})` : ""}
      </Link>
    );
  }
  return (
    <Link href={href} aria-current={active ? "page" : undefined}
      className={cx("flex items-center justify-between rounded-lg px-3 py-2 text-[15px] font-medium",
        active ? "bg-ledger-soft text-ledger" : "text-ink/80 hover:bg-paper")}>
      <span>{children}</span>
      {!!badge && <span className="rounded-full bg-amber-soft px-2 text-xs font-semibold text-amber">{badge}</span>}
    </Link>
  );
}
