// Feature 106 — Sirve el contrato OpenAPI 3.1 del canal integrador como JSON. Publico (no exige
// API key ni sesion): es documentacion. El middleware ya deja pasar toda la rama `/api/*` sin
// guard de cookie (ver middleware.ts). La fuente de verdad es `lib/api/openapi-spec.ts`.
import { NextResponse } from "next/server";
import { openApiSpec } from "@/lib/api/openapi-spec";

export const dynamic = "force-static";

export function GET(): NextResponse {
  return NextResponse.json(openApiSpec);
}
