# Kassenbuch – Einnahmen, Budgets, Belege, Rechnungen

Multi-Tenant-SaaS für kleine Betriebe (Bäckerei, Catering, Gastro).
Next.js 15 · TypeScript · PostgreSQL 16 · Drizzle ORM · Tailwind 4.

## Schnellstart (lokal)

```bash
npm install
cp .env.example .env
docker compose up -d                       # Postgres auf :5432

npm run db:migrate                         # Tabellen + RLS + Rolle app_user_role
psql "postgresql://postgres:postgres@localhost:5432/kmu_finance" \
  -c "CREATE ROLE kmu_app LOGIN PASSWORD 'kmu_app' IN ROLE app_user_role;"
npm run db:seed                            # Super-Admin anlegen

npm run dev                                # http://localhost:3000
npm run demo                               # optional: Demo-Firma mit Daten (Server muss laufen)
```

Zugänge:

| Rolle | Login | Passwort |
|---|---|---|
| System-Inhaber | super@kmu.local | Super123! |
| Geschäftsführer (Demo) | chef@baeckerei-sonne.de | Demo1234 |
| Mitarbeiter (Demo) | max@baeckerei-sonne.de | Demo1234 |

Die Mitarbeiter-App unter `/me` am besten am Handy öffnen (oder Browser-Gerätemodus).

## Tests

```bash
npm test          # Unit-Tests der Domain-Logik (Geld, Rechnung, Buchungsregeln, Zeitzonen)
npm run e2e       # 70 End-to-End-Prüfungen gegen den laufenden Server
npm run typecheck
```

`npm run e2e` braucht einen laufenden Server und eine Datenbank mit Super-Admin.

## Festgelegte Geschäftsregeln

1. **Kein Minus:** Weder Kassenbestand noch Mitarbeiterkonto dürfen negativ werden.
   Zuteilung, Beleg, Ausgleich, Rückgabe und Storno werden sonst blockiert (HTTP 422).
2. **Belege werden sofort abgezogen.** Der Admin prüft nachträglich.
   Ablehnen bucht den Betrag per Storno zurück aufs Mitarbeiterkonto.
3. **Bezahlt = Einnahme.** „Als bezahlt markieren“ bucht den Bruttobetrag automatisch in den Pool (genau einmal).
4. **Storno statt Löschen.** Rechnungen erhalten eine Stornorechnung mit eigener Nummer.
   Buchungen werden über Gegenbuchungen korrigiert. Nur Entwürfe dürfen gelöscht werden.
5. **Ausgleichsbuchung** = Ausgabe ohne Beleg. Sie senkt das Guthaben; „auf 0 setzen“ ist ein Klick.
   Geld kommt nur über eine Budget-Zuteilung aus dem Pool aufs Konto.
6. **Monatsabschluss sperrt** alle Buchungen des Monats. Der Tagesabschluss ist ein eingefrorenes Protokoll.
7. Alle Tages- und Monatsgrenzen gelten in deutscher Zeit (Europe/Berlin).

## Architektur

```
src/
├── domain/            Reine Logik ohne DB: Geld, Rechnung, Buchungsregeln, Zeiträume
├── application/       Use Cases: prüfen Rollen + Regeln, schreiben in Transaktionen
├── infrastructure/    DB (Drizzle, RLS-Kontext), Auth, Storage, PDF
├── lib/               API-Wrapper (RBAC, CSRF, Fehler), Zod-Schemas
├── components/        UI-Bausteine
└── app/               Seiten (/super, /admin, /me) und REST-API (/api/v1)
drizzle/               SQL-Migrationen (0001_rls.sql = Row Level Security)
tests/                 unit/ (Vitest) und e2e/ (Smoke-Test, Demo-Daten)
```

**Hauptbuch statt Saldo-Spalten:** Jede Geldbewegung ist eine unveränderliche Zeile
in `LedgerEntry` mit `poolDeltaCents` und `walletDeltaCents`. Salden = Summen.

**Mandantentrennung doppelt:**
1. App: jede Abfrage filtert auf `tenantId`, jede Route prüft die Rolle.
2. Datenbank: Row Level Security. Die App verbindet als `kmu_app` (kein Owner).
   Pro Transaktion werden `app.tenant_id`, `app.user_id`, `app.role` gesetzt.
   Mitarbeiter sehen per RLS nur eigene Buchungen/Belege, keine Rechnungen.
   `UPDATE`/`DELETE` auf `LedgerEntry` ist für die App-Rolle gesperrt (GoBD).

**Nebenläufigkeit:** Alle Geldbewegungen eines Mandanten laufen unter einem
Postgres-Advisory-Lock. Getestet: 6 parallele Zuteilungen à ⅓ des Pools → genau 3 erfolgreich.

## REST-API (`/api/v1`)

| Methode | Pfad | Rolle | Zweck |
|---|---|---|---|
| POST | `/auth/login`, `/auth/logout` | – | Session-Cookie (httpOnly) |
| GET | `/auth/me` | alle | Aktueller Benutzer |
| GET/POST | `/super/tenants` | Super-Admin | Mandanten listen / anlegen (inkl. erstem Admin) |
| GET/PATCH | `/super/tenants/:id` | Super-Admin | Stammdaten, `{status: "SUSPENDED"}` sperrt sofort |
| GET/POST | `/employees` | Admin | Mitarbeiter mit Guthaben / anlegen |
| GET/PATCH | `/employees/:id` | Admin | Details, sperren (`isActive`), Passwort |
| POST | `/employees/:id/adjust` | Admin | Ausgleich `{toZero}` oder `{amountCents}` + Begründung |
| POST | `/employees/:id/return` | Admin | Restgeld zurück in den Pool |
| GET/POST | `/contacts` | Admin | Kunden/Lieferanten |
| GET/PATCH | `/contacts/:id` | Admin | inkl. Rechnungshistorie, archivieren |
| GET/POST | `/invoices` | Admin | Liste (`?status=OVERDUE`) / Entwurf anlegen |
| GET/PATCH/DELETE | `/invoices/:id` | Admin | Entwurf bearbeiten/löschen |
| POST | `/invoices/:id/issue` | Admin | Nummer vergeben, PDF archivieren |
| POST | `/invoices/:id/pay` | Admin | Bezahlt → Einnahme im Pool |
| POST | `/invoices/:id/cancel` | Admin | Stornorechnung |
| GET | `/invoices/:id/pdf` | Admin | PDF (`?inline=1`) |
| GET | `/pool` | Admin | Kassenbestand + Bewegungen |
| POST | `/pool/income` | Admin | Manuelle Einnahme |
| POST | `/pool/allocations` | Admin | Budget an Mitarbeiter |
| GET | `/ledger` | Admin, MA | Journal (MA: nur eigenes) |
| POST | `/ledger/:id/reverse` | Admin | Fehlbuchung stornieren |
| GET/POST | `/receipts` | Admin, MA | Belege / Upload (multipart, nur MA) |
| GET | `/receipts/:id/file` | Admin, MA | Belegfoto |
| POST | `/receipts/:id/review` | Admin | `approve` / `reject` + Grund |
| GET | `/me` | MA | Guthaben, Tag/Monat, letzte Buchungen |
| GET | `/dashboard` | Admin | Kennzahlen |
| GET | `/reports/summary` | Admin, MA | `?from&to[&employeeId]` |
| GET | `/reports/export` | Admin, MA | `?format=csv\|pdf&from&to` |
| GET/POST | `/reports/closings` | Admin | Tages-/Monatsabschluss |

Beträge können als Cent-Zahl (`1250`) oder als Euro-Text (`"12,50"`, `"15.000"`) gesendet werden.

## Bewusst offen (nächste Schritte)

- **E-Rechnung (ZUGFeRD/XRechnung)**: B2B-Pflicht schrittweise ab 2027/2028.
- **S3/MinIO** statt lokaler Ablage (`src/infrastructure/storage/local.ts` hat das Interface schon).
- **Login-Rate-Limit** ist In-Memory; bei mehreren Server-Instanzen auf Redis umstellen.
- Passwort-vergessen-Flow per E-Mail, Mahnwesen, Offline-Modus der Mitarbeiter-App.
# kmu-finance
