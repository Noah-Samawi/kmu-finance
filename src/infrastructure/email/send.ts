/**
 * E-Mail-Versand: Resend-API wenn RESEND_API_KEY gesetzt, sonst Dev-Log.
 * Kein Hard-Fail – Registrierung/Reset bleiben nutzbar ohne Mail-Provider.
 */
export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Resend-Test-Absender (verifizierte Domain von Resend) */
const DEFAULT_FROM = "onboarding@resend.dev";

export async function sendEmail(input: SendEmailInput): Promise<{ ok: boolean; mode: "resend" | "log"; id?: string }> {
  const key = process.env.RESEND_API_KEY?.trim();
  // Fester Resend-Test-Absender (eigene Domain erst nach Verifizierung via EMAIL_FROM)
  const fromEnv = process.env.EMAIL_FROM?.trim();
  const from = fromEnv === DEFAULT_FROM || fromEnv?.endsWith("@resend.dev")
    ? (fromEnv || DEFAULT_FROM)
    : DEFAULT_FROM;

  console.info("[email] send start", {
    to: input.to,
    subject: input.subject,
    from,
    hasKey: Boolean(key),
    keyPrefix: key ? `${key.slice(0, 6)}…` : null,
  });

  if (!key) {
    console.warn("[email] RESEND_API_KEY fehlt – nur Console-Log", {
      to: input.to,
      subject: input.subject,
    });
    console.info("[email:dev]", { to: input.to, subject: input.subject, text: input.text });
    return { ok: true, mode: "log" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html ?? `<pre style="font-family:sans-serif;white-space:pre-wrap">${escapeHtml(input.text)}</pre>`,
      }),
    });

    const bodyText = await res.text().catch(() => "");
    let parsed: { id?: string; message?: string; name?: string } = {};
    try {
      parsed = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      /* plain text */
    }

    if (!res.ok) {
      console.error("[email] Resend failed", {
        status: res.status,
        statusText: res.statusText,
        to: input.to,
        from,
        body: bodyText.slice(0, 2000),
        errorName: parsed.name,
        errorMessage: parsed.message,
      });
      throw new Error(`E-Mail konnte nicht gesendet werden (${res.status}): ${parsed.message || bodyText.slice(0, 200)}`);
    }

    console.info("[email] Resend ok", { to: input.to, id: parsed.id, from });
    return { ok: true, mode: "resend", id: parsed.id };
  } catch (e) {
    console.error("[email] send exception", {
      to: input.to,
      from,
      subject: input.subject,
      error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack?.split("\n").slice(0, 8) } : String(e),
    });
    throw e;
  }
}

/** Kanonische Production-URL (E-Mail-Links; APP_URL oft falsch/Preview) */
export const PRODUCTION_APP_URL = "https://kmu-finance-eosin.vercel.app";

export function appBaseUrl(): string {
  const explicit = (process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim() || "").replace(/\/$/, "");
  // Nur akzeptieren, wenn es wirklich die Production-Domain ist
  if (explicit.includes("kmu-finance-eosin.vercel.app")) return explicit.startsWith("http") ? explicit : `https://${explicit}`;
  // Auf Vercel Production immer kanonische Domain (nicht Preview-URL aus VERCEL_URL)
  if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
    return PRODUCTION_APP_URL;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`;
  return "http://localhost:3000";
}

/** Platform-Admin-Inbox für neue Registrierungen */
export function platformAdminNotifyEmail(): string {
  return (
    process.env.PLATFORM_ADMIN_EMAIL?.trim()
    || "noah.alsamawi@gmail.com"
  );
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
