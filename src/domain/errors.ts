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

export const notFound = (what = "Eintrag") => new AppError(404, "NOT_FOUND", `${what} nicht gefunden`);
export const forbidden = (msg = "Keine Berechtigung") => new AppError(403, "FORBIDDEN", msg);
export const unauthorized = (msg = "Nicht angemeldet") => new AppError(401, "UNAUTHORIZED", msg);
export const conflict = (msg: string) => new AppError(409, "CONFLICT", msg);
export const badRequest = (msg: string) => new AppError(400, "BAD_REQUEST", msg);
/** Geschäftsregel verletzt, z. B. "Guthaben reicht nicht" */
export const rule = (msg: string) => new AppError(422, "BUSINESS_RULE", msg);
