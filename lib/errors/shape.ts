// Feature 10 — Estructura de error comun (R1, R4).
import type { AppErrorCode } from "./codes";
import { HTTP_STATUS_BY_CODE } from "./codes";

// R1: tipo comun de error de aplicacion.
// R4: `status: "error"` es el discriminante; no colisiona con los literales de
// dominio ("ok", "validation_error", "unauthenticated", ...), de modo que un
// resultado de dominio y un AppErrorShape conviven en una union discriminada.
export interface AppErrorShape {
  status: "error";
  code: AppErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

// R1/R4: type guard para distinguir un AppErrorShape dentro de una union.
export function isAppErrorShape(v: unknown): v is AppErrorShape {
  if (typeof v !== "object" || v === null) return false;
  const candidate = v as Record<string, unknown>;
  return (
    candidate.status === "error" &&
    typeof candidate.code === "string" &&
    candidate.code in HTTP_STATUS_BY_CODE &&
    typeof candidate.message === "string"
  );
}
