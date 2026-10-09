// Fachliche Fehler mit HTTP-Status. Use Cases werfen diese,
// der API-Layer übersetzt sie in JSON-Antworten.
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Duck-Typing: `instanceof` kann in Next.js-Bundles fehlschlagen und dann als 500 „Interner Fehler“ enden. */
export function isAppError(e: unknown): e is AppError {
  if (e instanceof AppError) return true;
  if (!e || typeof e !== "object") return false;
  const o = e as { status?: unknown; code?: unknown; message?: unknown; name?: unknown };
  return (
    typeof o.status === "number" &&
    typeof o.code === "string" &&
    typeof o.message === "string" &&
    o.status >= 400 &&
    o.status < 600
  );
}

export const notFound = (what = "Eintrag") => new AppError(404, "NOT_FOUND", `${what} nicht gefunden`);
export const forbidden = (msg = "Keine Berechtigung") => new AppError(403, "FORBIDDEN", msg);
export const unauthorized = (msg = "Nicht angemeldet") => new AppError(401, "UNAUTHORIZED", msg);
export const conflict = (msg: string) => new AppError(409, "CONFLICT", msg);
export const badRequest = (msg: string) => new AppError(400, "BAD_REQUEST", msg);
/** Geschäftsregel verletzt, z. B. "Guthaben reicht nicht" */
export const rule = (msg: string) => new AppError(422, "BUSINESS_RULE", msg);
