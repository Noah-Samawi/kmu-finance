"use client";

import { useRouter } from "next/navigation";
import type { BranchOption } from "@/components/branch-category";
import { BelegReview } from "./beleg-review";

/** Client-Wrapper: schließt Review und entfernt ?beleg= aus der URL */
export function BelegReviewHost({ belegId, branches, today }: {
  belegId: string; branches?: BranchOption[]; today: string;
}) {
  const router = useRouter();
  return (
    <BelegReview
      belegId={belegId}
      branches={branches}
      today={today}
      onClose={() => {
        const u = new URL(window.location.href);
        u.searchParams.delete("beleg");
        router.push(u.pathname + (u.search || "?tab=inbox"));
      }}
    />
  );
}
