// Feature 10 — Wrapper central de captura (R7, R8, R14a).
import type { AppErrorShape } from "./shape";
import type { ErrorLogger } from "./logger";
import { defaultLogger } from "./logger";
import { normalizeError } from "./normalize";

// R7/R8: ejecuta una operacion asincrona; devuelve su valor si tiene exito
// (paso transparente, sin envolver) o un AppErrorShape normalizado si lanza.
// R14a: acepta un ErrorLogger inyectable; por defecto usa defaultLogger (R14b).
export async function withErrorHandler<T>(
  fn: () => Promise<T>,
  logger: ErrorLogger = defaultLogger,
): Promise<T | AppErrorShape> {
  try {
    return await fn(); // R8: exito devuelto sin modificar.
  } catch (err) {
    return normalizeError(err, logger); // R7: error -> shape normalizado.
  }
}
