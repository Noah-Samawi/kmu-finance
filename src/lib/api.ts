import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { isAppError, badRequest, forbidden, unauthorized } from "@/domain/errors";
import { resolveSession, SESSION_COOKIE, type AuthUser } from "@/infrastructure/auth/session";
import type { Role } from "@/infrastructure/db/schema";

type Params = Record<string, string>;

interface HandlerArgs<P extends Params> {
  req: NextRequest;
  ctx: AuthUser;
  params: P;
}

/**
 * Einheitlicher Wrapper für alle Route Handler:
 *  - Session prüfen + Rolle prüfen (RBAC)
 *  - CSRF-Schutz für schreibende Requests (Origin-Check)
 *  - Fehler -> sauberes JSON mit HTTP-Status
 */
export function route<P extends Params = Params>(
  roles: Role[] | "public",
  handler: (args: HandlerArgs<P>) => Promise<unknown>,
) {
  return async (req: NextRequest, segment: { params: Promise<P> }) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") assertSameOrigin(req);
      const params = (await segment?.params) ?? ({} as P);
      let ctx = null as unknown as AuthUser;
      if (roles !== "public") {
        const user = await resolveSession(req.cookies.get(SESSION_COOKIE)?.value);
        if (!user) throw unauthorized();
        if (!roles.includes(user.role)) throw forbidden();
        ctx = user;
      }
      const result = await handler({ req, ctx, params });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true }, { status: req.method === "POST" ? 201 : 200 });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return; // z. B. curl / Server-zu-Server; Cookie ist SameSite=Lax
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (new URL(origin).host !== host) throw forbidden("Ungültige Herkunft (CSRF-Schutz)");
}

export function errorDetails(e: unknown) {
  if (!e || typeof e !== "object") return { message: String(e) };
  const o = e as { name?: string; message?: string; code?: unknown; status?: unknown; cause?: unknown; stack?: string };
  const cause = o.cause && typeof o.cause === "object" ? (o.cause as { code?: unknown; message?: string }) : undefined;
  return {
    name: o.name,
    message: o.message,
    code: o.code,
    status: o.status,
    causeCode: cause?.code,
    causeMessage: cause?.message,
    stack: o.stack?.split("\n").slice(0, 12),
  };
}

function pgCode(e: unknown): string | undefined {
  if (typeof e === "object" && e && "code" in e && typeof (e as { code: unknown }).code === "string") {
    return (e as { code: string }).code;
  }
  const cause = (e as { cause?: { code?: string } })?.cause;
  return typeof cause?.code === "string" ? cause.code : undefined;
}

export function errorResponse(e: unknown) {
  if (isAppError(e)) {
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  }
  if (e instanceof ZodError) {
    const message = e.issues.map((i) => `${i.path.join(".") || "Eingabe"}: ${i.message}`).join("; ");
    return NextResponse.json({ error: { code: "VALIDATION", message, issues: e.issues } }, { status: 400 });
  }
  const code = pgCode(e);
  if (code === "23505") {
    return NextResponse.json({ error: { code: "CONFLICT", message: "Eintrag existiert bereits" } }, { status: 409 });
  }
  console.error("[api] uncaught", errorDetails(e));
  const hint = code ? ` (DB ${code})` : "";
  return NextResponse.json(
    { error: { code: "INTERNAL", message: `Interner Fehler${hint}` } },
    { status: 500 },
  );
}

export async function body<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw badRequest("Ungültiges JSON");
  }
  return schema.parse(json);
}

export function query(req: NextRequest) {
  return Object.fromEntries(req.nextUrl.searchParams.entries());
}

export function fileResponse(data: Uint8Array | Buffer, mime: string, filename: string, inline = false) {
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
