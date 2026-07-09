// Feature 10 — Normalizacion de errores a AppErrorShape (R9-R14).
import { z, ZodError } from "zod";
import type { AppErrorCode } from "./codes";
import { MSG } from "./codes";
import type { AppErrorShape } from "./shape";
import { AppError } from "./app-error";
import type { ErrorLogger } from "./logger";
import { defaultLogger } from "./logger";

// R10: registro de errores de dominio conocidos (que NO extienden AppError).
// Se referencian por nombre de constructor (err.name) para no acoplar lib/errors/
// hacia arriba con las clases concretas de repositorios.
const DOMAIN_ERROR_CODE: Record<string, AppErrorCode> = {
  NumRemisionDuplicadoError: "CONFLICT",
  UsuarioDuplicadoError: "CONFLICT",
  CatalogoInvalidoError: "VALIDATION_ERROR",
};

// R14a: el logger se inyecta; si no, se usa la implementacion por defecto (R14b).
export function normalizeError(err: unknown, logger: ErrorLogger = defaultLogger): AppErrorShape {
  // R9: AppError (o subclase) -> su propia shape.
  if (err instanceof AppError) return err.toShape();

  // R11: ZodError -> VALIDATION_ERROR con fieldErrors aplanados, sin traza interna.
  // zod v4: se usa z.flattenError (ZodError.flatten esta deprecado).
  if (err instanceof ZodError) {
    return {
      status: "error",
      code: "VALIDATION_ERROR",
      message: MSG.VALIDATION_ERROR,
      details: { fieldErrors: z.flattenError(err).fieldErrors },
    };
  }

  // R10: error de dominio conocido por su nombre -> code mapeado.
  if (err instanceof Error) {
    const mapped = DOMAIN_ERROR_CODE[err.name];
    if (mapped) {
      return { status: "error", code: mapped, message: MSG[mapped] };
    }
  }

  // R12/R13/R14: error desconocido -> se registra por canal servidor y se devuelve
  // INTERNAL con message generico, SIN exponer message/stack/details originales.
  logger.logError(err);
  return { status: "error", code: "INTERNAL", message: MSG.INTERNAL };
}
