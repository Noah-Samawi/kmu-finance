/**
 * End-to-End-Test aller Kernabläufe gegen einen laufenden Server.
 *   BASE_URL=http://localhost:3000 npm run e2e
 * Erwartet einen frisch migrierten + geseedeten Datenbestand (Super-Admin).
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SUPER = { email: process.env.SEED_SUPERADMIN_EMAIL ?? "super@kmu.local", password: process.env.SEED_SUPERADMIN_PASSWORD ?? "Super123!" };
const RUN = Date.now().toString(36);

let passed = 0;
function check(cond: unknown, msg: string) {
  if (!cond) throw new Error(`✗ ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

class Client {
  cookie = "";
  constructor(public label: string) {}
  async req(method: string, path: string, body?: unknown, isForm = false) {
    const headers: Record<string, string> = { cookie: this.cookie };
    if (body && !isForm) headers["content-type"] = "application/json";
    const res = await fetch(BASE + path, {
      method, headers, body: isForm ? (body as FormData) : body ? JSON.stringify(body) : undefined, redirect: "manual",
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const ct = res.headers.get("content-type") ?? "";
    const data = ct.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data: data as any, ct };
  }
  get = (p: string) => this.req("GET", p);
  post = (p: string, b?: unknown) => this.req("POST", p, b ?? {});
  patch = (p: string, b: unknown) => this.req("PATCH", p, b);
  del = (p: string) => this.req("DELETE", p);
  async login(email: string, password: string) {
    const r = await this.post("/api/v1/auth/login", { email, password });
    if (r.status !== 200) throw new Error(`Login ${email} fehlgeschlagen: ${JSON.stringify(r.data)}`);
    return r;
  }
}

// Kleinste gültige PNG-Datei + Zufallsbytes, damit jeder Beleg einen eigenen Hash hat
function fakePng(seed: string) {
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b80000000049454e44ae426082", "hex");
  return new Blob([png, Buffer.from(seed)], { type: "image/png" });
}

async function receipt(c: Client, amount: string, merchant: string, seed: string) {
  const f = new FormData();
  f.set("file", fakePng(seed), "bon.png");
  f.set("amount", amount);
  f.set("merchant", merchant);
  f.set("receiptDate", new Date().toISOString().slice(0, 10));
  return c.req("POST", "/api/v1/receipts", f, true);
}

async function main() {
  console.log(`E2E gegen ${BASE}\n`);
  const sup = new Client("super");
  await sup.login(SUPER.email, SUPER.password);

  console.log("Super-Admin: Mandanten");
  const mkTenant = (n: string) => sup.post("/api/v1/super/tenants", {
    name: `Firma ${n}`, slug: `firma-${n}-${RUN}`, legalName: `Firma ${n} GmbH`, street: "Teststr. 1", zip: "60311", city: "Frankfurt",
    taxNumber: "045 111 22222", vatId: "DE999999999", iban: "DE02120300000000202051",
    admin: { name: `Chef ${n}`, email: `chef-${n}-${RUN}@test.local`, password: "Passwort123" },
  });
  const tA = await mkTenant("a");
  check(tA.status === 201, "Mandant A angelegt");
  const tB = await mkTenant("b");
  check(tB.status === 201, "Mandant B angelegt");
  check((await mkTenant("a")).status === 409, "Doppelter Slug -> 409");

  const A = new Client("adminA");
  await A.login(`chef-a-${RUN}@test.local`, "Passwort123");
  const B = new Client("adminB");
  await B.login(`chef-b-${RUN}@test.local`, "Passwort123");
  check((await A.get("/api/v1/super/tenants")).status === 403, "Admin darf keine Mandanten verwalten");

  console.log("\nModul A: Kunden & Rechnungen");
  const e1r = await A.post("/api/v1/employees", { name: "Max Einkauf", email: `max-${RUN}@test.local`, password: "Passwort123" });
  const e2r = await A.post("/api/v1/employees", { name: "Fiona Fahrerin", email: `fiona-${RUN}@test.local`, password: "Passwort123" });
  check(e1r.status === 201 && e2r.status === 201, "2 Mitarbeiter angelegt");
  const e1 = e1r.data.employee.id, e2 = e2r.data.employee.id;

  const contact = (await A.post("/api/v1/contacts", { name: "Bäckerei Müller", street: "Brotweg 3", zip: "60313", city: "Frankfurt" })).data.contact;
  check(contact?.id, "Kontakt 'Bäckerei Müller' angelegt");

  const draft = await A.post("/api/v1/invoices", {
    contactId: contact.id, notes: "Danke für den Auftrag!",
    items: [
      { description: "Catering Buffet", quantity: "2", unit: "Pers.", unitPriceCents: "1000,00", vatRate: 1900 },
      { description: "Brot (kg)", quantity: "1,5", unit: "kg", unitPriceCents: "3,33", vatRate: 700 },
    ],
  });
  check(draft.status === 201, "Rechnungsentwurf angelegt");
  const inv = draft.data.invoice;
  // 2000,00 + 4,995->5,00 netto; USt 380,00 + 0,35
  check(inv.netCents === 200500 && inv.vatCents === 38035 && inv.grossCents === 238535, `Summen korrekt (brutto ${inv.grossCents / 100} €)`);
  check(inv.status === "DRAFT" && inv.number === null, "Entwurf hat noch keine Nummer");

  const issued = await A.post(`/api/v1/invoices/${inv.id}/issue`);
  const year = new Date().getFullYear();
  check(issued.data.invoice?.number === `RE-${year}-0001`, `Nummer vergeben: ${issued.data.invoice?.number}`);
  check((await A.patch(`/api/v1/invoices/${inv.id}`, { notes: "x" })).status === 422, "Ausgestellte Rechnung nicht editierbar");
  const pdf = await A.get(`/api/v1/invoices/${inv.id}/pdf`);
  check(pdf.status === 200 && (pdf.data as Buffer).subarray(0, 4).toString() === "%PDF", "PDF erzeugt");

  const inv2 = (await A.post("/api/v1/invoices", { contactId: contact.id, items: [{ description: "Kuchen", quantity: "10", unitPriceCents: 250, vatRate: 700 }] })).data.invoice;
  const issued2 = await A.post(`/api/v1/invoices/${inv2.id}/issue`);
  check(issued2.data.invoice.number === `RE-${year}-0002`, "Fortlaufende Nummer 0002");

  // Mandant B beginnt bei 0001
  const cB = (await B.post("/api/v1/contacts", { name: "Kunde B" })).data.contact;
  const invB = (await B.post("/api/v1/invoices", { contactId: cB.id, items: [{ description: "X", quantity: "1", unitPriceCents: 100, vatRate: 1900 }] })).data.invoice;
  check((await B.post(`/api/v1/invoices/${invB.id}/issue`)).data.invoice.number === `RE-${year}-0001`, "Nummernkreis je Mandant getrennt");

  const paid = await A.post(`/api/v1/invoices/${inv.id}/pay`);
  check(paid.data.invoice?.status === "PAID", "Rechnung als bezahlt markiert");
  check((await A.post(`/api/v1/invoices/${inv.id}/pay`)).status === 422, "Doppelt bezahlen blockiert");
  let pool = (await A.get("/api/v1/pool")).data.poolBalanceCents;
  check(pool === 238535, "Bezahlter Betrag automatisch im Einnahmen-Pool");

  const hist = await A.get(`/api/v1/contacts/${contact.id}`);
  check(hist.data.invoices.length === 2 && hist.data.stats.paidCents === 238535 && hist.data.stats.openCents === 2675, "Kundenhistorie mit Status");

  console.log("\nModul B: Pool & Budget");
  check((await A.post("/api/v1/pool/income", { amountCents: "500,00", description: "Barverkauf Tageskasse" })).status === 201, "Manuelle Einnahme 500 €");
  pool = (await A.get("/api/v1/pool")).data.poolBalanceCents;
  check(pool === 288535, "Pool = 2.885,35 €");
  const tooMuch = await A.post("/api/v1/pool/allocations", { employeeId: e1, amountCents: pool + 1 });
  check(tooMuch.status === 422, "Zuteilung über Pool hinaus blockiert");
  check((await A.post("/api/v1/pool/allocations", { employeeId: e1, amountCents: "1.000,00" })).data.walletBalanceCents === 100000, "1.000 € an Max zugeteilt");
  check((await A.get("/api/v1/pool")).data.poolBalanceCents === 188535, "Rest-Kassenbestand = Einnahmen − Budgets");

  console.log("\nModul C: Belege & Mitarbeiter-Konto");
  const M = new Client("max");
  await M.login(`max-${RUN}@test.local`, "Passwort123");
  check((await M.get("/api/v1/me")).data.balanceCents === 100000, "Max sieht Guthaben 1.000 €");
  const r1 = await receipt(M, "230,50", "Metro", "r1");
  check(r1.status === 201 && r1.data.walletBalanceCents === 76950, "Beleg 230,50 € sofort abgezogen");
  check((await receipt(M, "230,50", "Metro", "r1")).status === 409, "Gleiches Foto doppelt -> 409");
  const over = await receipt(M, "800,00", "Großmarkt", "r2");
  check(over.status === 422, "Beleg über Guthaben blockiert (kein Minus)");
  check((await M.get("/api/v1/employees")).status === 403, "Mitarbeiter: keine Mitarbeiterliste");
  check((await M.get("/api/v1/invoices")).status === 403, "Mitarbeiter: keine Rechnungen");
  check((await M.get("/api/v1/pool")).status === 403, "Mitarbeiter: kein Pool");
  check((await M.post("/api/v1/pool/allocations", { employeeId: e1, amountCents: 100 })).status === 403, "Mitarbeiter kann sich nichts zuteilen");
  check((await M.post(`/api/v1/employees/${e1}/adjust`, { toZero: true, description: "hack" })).status === 403, "Mitarbeiter kann keine Ausgleiche buchen");
  const ownLedger = (await M.get(`/api/v1/ledger?employeeId=${e2}`)).data.entries;
  check(ownLedger.every((e: any) => e.employeeId === e1), "Mitarbeiter sieht nur eigene Buchungen (auch bei Fremd-ID)");
  check((await M.get(`/api/v1/receipts/${r1.data.receipt.id}/file`)).status === 200, "Eigenes Belegfoto abrufbar");

  const queue = (await A.get("/api/v1/receipts?status=SUBMITTED")).data.receipts;
  check(queue.length === 1, "Beleg in Prüf-Queue des Admins");
  const rej = await A.post(`/api/v1/receipts/${r1.data.receipt.id}/review`, { action: "reject", reason: "Privatkauf" });
  check(rej.data.receipt?.status === "REJECTED", "Beleg abgelehnt");
  check((await M.get("/api/v1/me")).data.balanceCents === 100000, "Ablehnung bucht Betrag zurück aufs Konto");
  const r3 = await receipt(M, "99,99", "Bäckerbedarf", "r3");
  check((await A.post(`/api/v1/receipts/${r3.data.receipt.id}/review`, { action: "approve" })).data.receipt.status === "APPROVED", "Beleg freigegeben");

  const adj = await A.post(`/api/v1/employees/${e1}/adjust`, { amountCents: "1.000,00", description: "zu viel" });
  check(adj.status === 422, "Ausgleich über Guthaben blockiert");
  const zero = await A.post(`/api/v1/employees/${e1}/adjust`, { toZero: true, description: "Barzahlung ohne Quittung" });
  check(zero.data.walletBalanceCents === 0, "Ausgleich setzt Konto auf 0,00 €");

  await A.post("/api/v1/pool/allocations", { employeeId: e2, amountCents: 5000 });
  const ret = await A.post(`/api/v1/employees/${e2}/return`, { all: true });
  check(ret.data.walletBalanceCents === 0 && ret.data.poolBalanceCents === 188535, "Rückführung: Restgeld zurück in den Pool");

  const alloc = (await A.post("/api/v1/pool/allocations", { employeeId: e2, amountCents: 1000 })).data.entry;
  check((await A.post(`/api/v1/ledger/${alloc.id}/reverse`, { reason: "Falscher Mitarbeiter" })).status === 201, "Fehlbuchung storniert");
  check((await A.post(`/api/v1/ledger/${alloc.id}/reverse`, { reason: "nochmal" })).status === 422, "Doppelstorno blockiert");

  console.log("\nNebenläufigkeit");
  const poolNow = (await A.get("/api/v1/pool")).data.poolBalanceCents;
  const part = Math.floor(poolNow / 3);
  const results = await Promise.all(Array.from({ length: 6 }, () => A.post("/api/v1/pool/allocations", { employeeId: e2, amountCents: part })));
  const ok = results.filter((r) => r.status === 201).length;
  check(ok === 3, `6 parallele Zuteilungen à ${part / 100} € -> genau 3 erfolgreich`);
  check((await A.get("/api/v1/pool")).data.poolBalanceCents >= 0, "Pool nie negativ");
  await A.post(`/api/v1/employees/${e2}/return`, { all: true });

  console.log("\nStorno bezahlter Rechnung");
  const blocked = await A.post(`/api/v1/invoices/${inv.id}/cancel`, { reason: "Falscher Kunde" });
  check(blocked.status === 422, "Storno blockiert: Einnahme bereits als Budget verteilt");
  await A.post("/api/v1/pool/income", { amountCents: 50000, description: "Nachzahlung" });
  const canc = await A.post(`/api/v1/invoices/${inv.id}/cancel`, { reason: "Falscher Kunde" });
  check(canc.data.invoice?.status === "CANCELED" && canc.data.invoice?.canceledBy?.number === `RE-${year}-0003`, "Stornorechnung RE-…-0003 erzeugt");
  check((await A.get("/api/v1/pool")).data.poolBalanceCents === poolNow + 50000 - 238535, "Einnahme aus Pool zurückgebucht");
  const cancOpen = await A.post(`/api/v1/invoices/${inv2.id}/cancel`, { reason: "Doppelt erstellt" });
  check(cancOpen.data.invoice?.status === "CANCELED", "Offene Rechnung storniert");

  console.log("\nMandantentrennung");
  check((await B.get(`/api/v1/invoices/${inv.id}`)).status === 404, "Admin B sieht Rechnung von A nicht");
  check((await B.get(`/api/v1/contacts/${contact.id}`)).status === 404, "Admin B sieht Kontakt von A nicht");
  check((await B.get(`/api/v1/employees/${e1}`)).status === 404, "Admin B sieht Mitarbeiter von A nicht");
  check((await B.post("/api/v1/pool/allocations", { employeeId: e1, amountCents: 1 })).status === 404, "Admin B kann A-Mitarbeiter kein Budget geben");
  check((await B.get("/api/v1/ledger")).data.entries.every((e: any) => !e.employeeId || e.employeeId !== e1), "Journal B enthält keine A-Buchungen");
  check((await B.get(`/api/v1/receipts/${r3.data.receipt.id}/file`)).status === 404, "Admin B kann Belegfoto von A nicht laden");

  console.log("\nModul D: Berichte & Abschlüsse");
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + "01";
  const sum = (await A.get(`/api/v1/reports/summary?from=${monthStart}&to=${today}`)).data.summary;
  check(sum.pool.closingCents === (await A.get("/api/v1/pool")).data.poolBalanceCents, "Bericht: Pool-Endbestand = Live-Saldo");
  const max = sum.employees.find((e: any) => e.employeeId === e1);
  check(max.allocatedCents === 100000 && max.receiptsCents === 9999 && max.adjustmentsCents === 90001 && max.closingCents === 0, "Bericht: Max 1.000 erhalten, 99,99 Belege, 900,01 Ausgleich, Rest 0");
  const mSum = (await M.get(`/api/v1/reports/summary?from=${monthStart}&to=${today}`)).data.summary;
  check(mSum.employees.length === 1 && mSum.pool.closingCents === 0, "Mitarbeiter-Bericht: nur eigene Zeile, keine Pool-Zahlen");
  const csv = await A.get(`/api/v1/reports/export?format=csv&from=${monthStart}&to=${today}`);
  check(csv.status === 200 && (csv.data as Buffer).toString("utf-8").includes("Budget-Zuteilung"), "CSV-Export");
  const rpdf = await A.get(`/api/v1/reports/export?format=pdf&from=${monthStart}&to=${today}`);
  check((rpdf.data as Buffer).subarray(0, 4).toString() === "%PDF", "PDF-Export");
  const mpdf = await M.get(`/api/v1/reports/export?format=pdf&from=${monthStart}&to=${today}`);
  check((mpdf.data as Buffer).subarray(0, 4).toString() === "%PDF", "Mitarbeiter-PDF-Protokoll");
  check((await A.post("/api/v1/reports/closings", { periodType: "DAY", period: today })).status === 201, "Tagesabschluss erstellt");
  check((await A.post("/api/v1/reports/closings", { periodType: "DAY", period: today })).status === 409, "Tagesabschluss doppelt -> 409");
  check((await A.post("/api/v1/reports/closings", { periodType: "MONTH", period: today.slice(0, 7) })).status === 422, "Laufender Monat nicht abschließbar");

  console.log("\nSperren");
  const F = new Client("fiona");
  await F.login(`fiona-${RUN}@test.local`, "Passwort123");
  check((await F.get("/api/v1/me")).status === 200, "Fiona eingeloggt");
  await A.patch(`/api/v1/employees/${e2}`, { isActive: false });
  check((await F.get("/api/v1/me")).status === 401, "Gesperrte Mitarbeiterin sofort ausgeloggt");
  check((await new Client("x").post("/api/v1/auth/login", { email: `fiona-${RUN}@test.local`, password: "Passwort123" })).status === 403, "Login gesperrt");
  check((await A.post("/api/v1/pool/allocations", { employeeId: e2, amountCents: 100 })).status === 422, "Gesperrte Mitarbeiterin erhält kein Budget");
  await sup.patch(`/api/v1/super/tenants/${tB.data.tenant.id}`, { status: "SUSPENDED" });
  check((await B.get("/api/v1/dashboard")).status === 401, "Gesperrter Mandant sofort ausgeloggt");

  const dash = await A.get("/api/v1/dashboard");
  check(dash.status === 200 && typeof dash.data.poolBalanceCents === "number", "Admin-Dashboard");

  console.log(`\n${passed} Prüfungen bestanden.`);
}

main().catch((e) => {
  console.error("\n" + (e as Error).message);
  console.error(`(${passed} Prüfungen bis dahin bestanden)`);
  process.exit(1);
});

export {};
