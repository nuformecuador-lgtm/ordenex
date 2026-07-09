// Feature 10 — Clase base de error de aplicacion y subclases de conveniencia (R5, R6).
import type { AppErrorCode } from "./codes";
import { MSG } from "./codes";
import type { AppErrorShape } from "./shape";

// R5: clase base con `code: AppErrorCode` y un `message` seguro.
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: AppErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }

  // R6: produce el AppErrorShape preservando code, message y details (si los hay).
  toShape(): AppErrorShape {
    return {
      status: "error",
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

// Subclases de conveniencia: cada una fija su `code` y un `message` por defecto
// tomado de MSG (mensajes fijos en espanol, R15).
export class ValidationError extends AppError {
  constructor(message: string = MSG.VALIDATION_ERROR, details?: Record<string, unknown>) {
    super("VALIDATION_ERROR", message, details);
    this.name = "ValidationError";
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message: string = MSG.UNAUTHORIZED, details?: Record<string, unknown>) {
    super("UNAUTHORIZED", message, details);
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = MSG.FORBIDDEN, details?: Record<string, unknown>) {
    super("FORBIDDEN", message, details);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = MSG.NOT_FOUND, details?: Record<string, unknown>) {
    super("NOT_FOUND", message, details);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string = MSG.CONFLICT, details?: Record<string, unknown>) {
    super("CONFLICT", message, details);
    this.name = "ConflictError";
  }
}
