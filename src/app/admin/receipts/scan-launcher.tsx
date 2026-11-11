"use client";

import { useState } from "react";
import { ExpenseForm, type PersonOption } from "@/components/cash-forms";
import type { BranchOption } from "@/components/branch-category";
import { Modal } from "@/components/modal";
import { ReceiptCapture } from "@/components/receipt-capture";
import { ErrorNote } from "@/components/use-api";
import type { ExpenseFund } from "@/domain/cash";

/**
 * "Belege prüfen": eigenen Beleg direkt scannen. Foto aufnehmen → KI füllt das Buchungsformular im Dialog,
 * das Foto wird mit der Ausgabe gespeichert.
 */
export function ScanLauncher({ today, persons, branches, balances }: {
  today: string; persons: PersonOption[]; branches?: BranchOption[]; balances?: Partial<Record<ExpenseFund, number>>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState(false);

  return (
    <div className="mb-5 rounded-xl border border-line bg-surface p-4">
      <p className="mb-3 text-sm text-muted">Eigenen Einkaufsbeleg erfassen: fotografieren – die KI trägt Datum, Händler, Betrag und Kategorie ein.</p>
      <div className="max-w-md">
        <ReceiptCapture showPreview={false} onFile={(f) => { setBooked(false); setFile(f); }} onError={setError} />
      </div>
      <div className="mt-2"><ErrorNote error={error} /></div>
      {booked && <p className="mt-2 text-sm font-medium text-ledger">Ausgabe gebucht – Beleg gespeichert.</p>}
      {file && (
        <Modal title="Beleg buchen" onClose={() => setFile(null)}>
          <div className="mt-3">
            <ExpenseForm today={today} persons={persons} branches={branches} balances={balances} initialFile={file}
              onBooked={() => { setFile(null); setBooked(true); }} />
          </div>
        </Modal>
      )}
    </div>
  );
}
