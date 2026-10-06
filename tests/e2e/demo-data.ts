/**
 * Füllt einen laufenden Server mit realistischen Demo-Daten (über die API).
 *   BASE_URL=http://localhost:3000 npm run demo
 * Zugänge danach:
 *   chef@baeckerei-sonne.de / Demo1234   (Admin)
 *   max@baeckerei-sonne.de  / Demo1234   (Mitarbeiter)
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

async function client(email: string, password: string) {
  let cookie = "";
  const req = async (method: string, path: string, body?: unknown, form?: FormData) => {
    const res = await fetch(BASE + path, {
      method, headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
      body: form ?? (body ? JSON.stringify(body) : undefined),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${path}: ${JSON.stringify(data)}`);
    return data as any;
  };
  await req("POST", "/api/v1/auth/login", { email, password });
  return req;
}

const png = (seed: string) => new Blob([Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b80000000049454e44ae426082", "hex"), Buffer.from(seed)], { type: "image/png" });

async function main() {
  const sup = await client(process.env.SEED_SUPERADMIN_EMAIL ?? "super@kmu.local", process.env.SEED_SUPERADMIN_PASSWORD ?? "Super123!");
  await sup("POST", "/api/v1/super/tenants", {
    name: "Bäckerei Sonne", slug: "baeckerei-sonne", legalName: "Bäckerei Sonne GmbH", street: "Eschersheimer Landstraße 210",
    zip: "60320", city: "Frankfurt am Main", taxNumber: "045 238 61904", vatId: "DE318204411",
    iban: "DE02120300000000202051", bic: "BYLADEM1001",
    admin: { name: "Sabine Sonne", email: "chef@baeckerei-sonne.de", password: "Demo1234" },
  });
  await sup("POST", "/api/v1/super/tenants", {
    name: "Catering Rhein-Main", slug: "catering-rhein-main", street: "Hanauer Landstraße 12", zip: "60314", city: "Frankfurt am Main",
    legalName: "Catering Rhein-Main UG", admin: { name: "Tarek Aziz", email: "chef@catering-rm.de", password: "Demo1234" },
  });

  const a = await client("chef@baeckerei-sonne.de", "Demo1234");
  const max = (await a("POST", "/api/v1/employees", { name: "Max Becker", email: "max@baeckerei-sonne.de", password: "Demo1234" })).employee;
  const lea = (await a("POST", "/api/v1/employees", { name: "Lea Wagner", email: "lea@baeckerei-sonne.de", password: "Demo1234" })).employee;
  await a("POST", "/api/v1/employees", { name: "Jonas Schmitt", email: "jonas@baeckerei-sonne.de", password: "Demo1234" });

  const hotel = (await a("POST", "/api/v1/contacts", { name: "Hotel am Main", street: "Mainkai 5", zip: "60311", city: "Frankfurt am Main", email: "einkauf@hotel-am-main.de" })).contact;
  const kita = (await a("POST", "/api/v1/contacts", { name: "Kita Sonnenblume", street: "Am Weingarten 3", zip: "60487", city: "Frankfurt am Main" })).contact;
  const cafe = (await a("POST", "/api/v1/contacts", { name: "Café Feldberg", street: "Feldbergstraße 9", zip: "60323", city: "Frankfurt am Main" })).contact;
  await a("POST", "/api/v1/contacts", { name: "Mühle Vogelsberg", type: "SUPPLIER", city: "Schotten" });

  const mk = async (contactId: string, items: unknown[], issue = true) => {
    const inv = (await a("POST", "/api/v1/invoices", { contactId, items })).invoice;
    if (issue) await a("POST", `/api/v1/invoices/${inv.id}/issue`);
    return inv;
  };
  const i1 = await mk(hotel.id, [
    { description: "Frühstücksbrötchen, gemischt", quantity: "1200", unit: "Stk", unitPriceCents: "0,45", vatRate: 700 },
    { description: "Croissants", quantity: "300", unit: "Stk", unitPriceCents: "0,95", vatRate: 700 },
    { description: "Lieferpauschale", quantity: "20", unit: "Fahrt", unitPriceCents: "12,00", vatRate: 1900 },
  ]);
  const i2 = await mk(kita.id, [{ description: "Vollkornbrot 1 kg", quantity: "40", unit: "Stk", unitPriceCents: "4,20", vatRate: 700 }]);
  await mk(cafe.id, [{ description: "Kuchenplatten für Wochenende", quantity: "6", unit: "Platte", unitPriceCents: "38,00", vatRate: 700 }]);
  await mk(hotel.id, [{ description: "Hochzeitstorte, drei Etagen", quantity: "1", unit: "Stk", unitPriceCents: "420,00", vatRate: 700 }], false);
  await a("POST", `/api/v1/invoices/${i1.id}/pay`);
  await a("POST", `/api/v1/invoices/${i2.id}/pay`);
  await a("POST", "/api/v1/pool/income", { amountCents: "1.840,50", description: "Tageskasse Laden" });

  await a("POST", "/api/v1/pool/allocations", { employeeId: max.id, amountCents: "600,00", description: "Wareneinkauf Großmarkt" });
  await a("POST", "/api/v1/pool/allocations", { employeeId: lea.id, amountCents: "150,00", description: "Tankgeld Lieferfahrten" });

  const m = await client("max@baeckerei-sonne.de", "Demo1234");
  const rc = async (amount: string, merchant: string, description: string) => {
    const f = new FormData();
    f.set("file", png(merchant + amount), "bon.png");
    f.set("amount", amount); f.set("merchant", merchant); f.set("description", description);
    f.set("receiptDate", new Date().toISOString().slice(0, 10)); f.set("vatRate", "700");
    return m("POST", "/api/v1/receipts", undefined, f);
  };
  const r1 = await rc("186,40", "Metro Frankfurt", "Butter, Eier, Sahne");
  await rc("94,15", "Mühle Vogelsberg", "Roggenmehl 50 kg");
  await rc("23,80", "Rewe", "Backpapier");
  await a("POST", `/api/v1/receipts/${r1.receipt.id}/review`, { action: "approve" });
  console.log("✓ Demo-Daten angelegt. Login: chef@baeckerei-sonne.de / Demo1234 · max@baeckerei-sonne.de / Demo1234");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

export {};
