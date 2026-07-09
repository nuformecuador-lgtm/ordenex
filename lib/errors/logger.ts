// Feature 10 — Logging de errores inyectable y seguro (R14, R14a, R14b, R20).

// R14a: interfaz minima de logging que el manejador recibe por inyeccion.
// Permite enchufar otra implementacion (Sentry, Vercel, ...) sin tocar el
// manejador ni normalizeError.
export interface ErrorLogger {
  logError(err: unknown): void;
}

// R14/R14b: implementacion por defecto, canal servidor (console.error).
// No concatena datos de entrada del usuario: solo registra el error original
// para diagnostico. El stack/mensaje quedan en el servidor, nunca en la respuesta.
export class ConsoleErrorLogger implements ErrorLogger {
  logError(err: unknown): void {
    console.error("[AppError:INTERNAL]", err instanceof Error ? (err.stack ?? err.message) : err);
  }
}

// Singleton por defecto usado por normalizeError/withErrorHandler cuando no se
// inyecta un logger (R14b).
export const defaultLogger: ErrorLogger = new ConsoleErrorLogger();
