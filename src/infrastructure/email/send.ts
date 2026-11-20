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

export async function sendEmail(input: SendEmailInput): Promise<{ ok: boolean; mode: "resend" | "log" }> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim() || "Kassenbuch <onboarding@resend.dev>";

  if (key) {
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
        html: input.html ?? `<pre style="font-family:sans-serif">${escapeHtml(input.text)}</pre>`,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[email] Resend failed", res.status, body);
      throw new Error("E-Mail konnte nicht gesendet werden");
    }
    return { ok: true, mode: "resend" };
  }

  console.info("[email:dev]", { to: input.to, subject: input.subject, text: input.text });
  return { ok: true, mode: "log" };
}

export function appBaseUrl(): string {
  const explicit = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`;
  return "http://localhost:3000";
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
