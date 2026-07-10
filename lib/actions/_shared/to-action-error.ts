// Feature 10/16 — Extraido de lib/actions/ordenes.ts (T3.1) sin cambiar
// comportamiento, para compartirlo entre Server Actions (ordenes, mensajeros).
import type { ActionError } from "@/lib/types/orden";
import type { AppErrorShape } from "@/lib/errors";

/**
 * Adaptador inverso de CODE_BY_DOMAIN_STATUS: traduce el AppErrorShape que produce
 * el manejador global de errores al ActionError tipado que consume la UI, SIN
 * cambiar el contrato publico. Switch exhaustivo sobre los 6 AppErrorCode.
 */
export function toActionError(shape: AppErrorShape): ActionError {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
        // La frontera ya fue validada por el handler global (normalizeError produce
        // details.fieldErrors via z.flattenError o via ValidationError con details).
        // Casteo seguro en esa frontera, sin `any`.
        fieldErrors: (shape.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
      };
    case "UNAUTHORIZED":
      return { status: "unauthenticated" };
    case "FORBIDDEN":
      return { status: "forbidden" };
    case "NOT_FOUND":
      return { status: "not_found" };
    case "CONFLICT":
      return { status: "conflict" };
    case "INTERNAL":
      // R: re-lanzar. El handler global ya loggeo el error real; preservamos el 500
      // actual sin exponer detalles internos ni ampliar el contrato ActionError.
      throw new Error("internal");
    default: {
      const _exhaustive: never = shape.code;
      throw new Error(`Unhandled AppErrorCode: ${String(_exhaustive)}`);
    }
  }
}
