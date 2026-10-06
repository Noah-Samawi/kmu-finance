import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { AppError, badRequest, forbidden, unauthorized } from "@/domain/errors";
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

export function errorResponse(e: unknown) {
  if (e instanceof AppError) {
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  }
  if (e instanceof ZodError) {
    const message = e.issues.map((i) => `${i.path.join(".") || "Eingabe"}: ${i.message}`).join("; ");
    return NextResponse.json({ error: { code: "VALIDATION", message, issues: e.issues } }, { status: 400 });
  }
  // Postgres: Unique-Verletzung -> 409 statt 500
  if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "23505") {
    return NextResponse.json({ error: { code: "CONFLICT", message: "Eintrag existiert bereits" } }, { status: 409 });
  }
  const cause = (e as { cause?: { code?: string } })?.cause;
  if (cause?.code === "23505") {
    return NextResponse.json({ error: { code: "CONFLICT", message: "Eintrag existiert bereits" } }, { status: 409 });
  }
  console.error(e);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Interner Fehler" } }, { status: 500 });
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
