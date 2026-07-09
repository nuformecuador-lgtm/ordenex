// Feature 10 — Barrel de la API publica del manejador de errores (R17, R19).
// Importable como `@/lib/errors` sin tocar consumidores existentes.

export type { AppErrorCode } from "./codes";
export { HTTP_STATUS_BY_CODE, MSG, CODE_BY_DOMAIN_STATUS } from "./codes";

export type { AppErrorShape } from "./shape";
export { isAppErrorShape } from "./shape";

export {
  AppError,
  ValidationError,
  UnauthenticatedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
} from "./app-error";

export type { ErrorLogger } from "./logger";
export { ConsoleErrorLogger, defaultLogger } from "./logger";

export { normalizeError } from "./normalize";
export { withErrorHandler } from "./with-error-handler";
export { appErrorToResponse } from "./http";
