// Feature 10 — Puente HTTP para Route Handlers (R18).
import { NextResponse } from "next/server";
import { HTTP_STATUS_BY_CODE } from "./codes";
import type { AppErrorShape } from "./shape";

// R18: convierte un AppErrorShape en una respuesta HTTP con el status derivado de
// HTTP_STATUS_BY_CODE (R3) y el cuerpo igual al shape. Solo se usa en app/api/**.
export function appErrorToResponse(shape: AppErrorShape): NextResponse {
  return NextResponse.json(shape, { status: HTTP_STATUS_BY_CODE[shape.code] });
}
