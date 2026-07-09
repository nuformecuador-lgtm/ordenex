# Feature 10 — Manejador de errores global (backend) — design.md

## Objetivo

Crear una estructura de error comun y un wrapper central de captura para el backend,
sin migrar aun a los consumidores (eso lo hara la feature 12) y sin cambiar el
comportamiento observable actual.

## Ubicacion del codigo

Modulo nuevo, autocontenido, en `lib/errors/`:

```
lib/errors/
  codes.ts            # AppErrorCode (UPPER_SNAKE), mapa code->http, mapa status_dominio->code, MSG
  app-error.ts        # clase base AppError (+ helpers de subclase)
  shape.ts            # tipo AppErrorShape + funcion toAppErrorShape / isAppErrorShape
  normalize.ts        # normalizeError(unknown, logger) -> AppErrorShape  (registro de mapeo)
  with-error-handler.ts  # withErrorHandler(fn, logger?) wrapper central
  http.ts             # appErrorToResponse(shape) -> NextResponse (solo Route Handlers)
  logger.ts           # interfaz ErrorLogger + ConsoleErrorLogger (default, canal servidor)
  index.ts            # barrel de exportacion publica
```

Motivo: `docs/architecture.md` separa capas; el manejador es transversal y no es
service ni repository ni controller. Un modulo `lib/errors/` mantiene el borde tipado
(R2 punto "Borde tipado") reutilizable por Server Actions y Route Handlers por igual.

## Modelo de datos

No hay tablas, migraciones ni RLS: esta feature es codigo puro de aplicacion. No toca
Prisma ni Supabase.

## Estructura de error comun (R1, R4)

```ts
// lib/errors/codes.ts
// R2: AppErrorCode en UPPER_SNAKE. Son DISTINTOS de los literales de `status` de
// dominio ("validation_error", "unauthenticated", ...). El puente lo da CODE_BY_DOMAIN_STATUS.
export type AppErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL";

// R3: HTTP de referencia por codigo (no acopla la shape a HTTP).
export const HTTP_STATUS_BY_CODE: Record<AppErrorCode, number> = {
  VALIDATION_ERROR: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
};

// R15: mensajes FIJOS en espanol, sin i18n ni claves de traduccion.
export const MSG: Record<AppErrorCode, string> = {
  VALIDATION_ERROR: "Los datos enviados no son validos.",
  UNAUTHORIZED: "No hay una sesion valida.",
  FORBIDDEN: "No tienes permiso para realizar esta accion.",
  NOT_FOUND: "El recurso solicitado no existe.",
  CONFLICT: "La operacion entra en conflicto con el estado actual.",
  INTERNAL: "Error interno del servidor.",
};

// R16: puente con los `status` de dominio ya usados por services/actions.
export const CODE_BY_DOMAIN_STATUS = {
  validation_error: "VALIDATION_ERROR",
  unauthenticated: "UNAUTHORIZED",
  forbidden: "FORBIDDEN",
  not_found: "NOT_FOUND",
  conflict: "CONFLICT",
} as const satisfies Record<string, AppErrorCode>;
```

```ts
// lib/errors/shape.ts (R1, R4)
export interface AppErrorShape {
  status: "error";                 // discriminante, no colisiona con "ok"/"validation_error"/...
  code: AppErrorCode;
  message: string;                 // seguro para cliente
  details?: Record<string, unknown>; // p. ej. { fieldErrors: Record<string,string[]> }
}

export function isAppErrorShape(v: unknown): v is AppErrorShape { /* ... */ }
```

Nota de compatibilidad (R4/R17): se elige `status: "error"` como NUEVO literal en vez
de reutilizar los literales de dominio existentes. Asi un consumidor puede tipar
`ResultadoDominio | AppErrorShape` como union discriminada por `status` sin romper los
tipos actuales, y mientras nadie lo adopte, el comportamiento no cambia.

## Clase base de error (R5, R6)

```ts
// lib/errors/app-error.ts
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: AppErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
  toShape(): AppErrorShape {
    return { status: "error", code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) };
  }
}
// Subclases de conveniencia opcionales: ValidationError, ForbiddenError, NotFoundError,
// ConflictError, UnauthenticatedError (cada una fija su code y un message por defecto).
```

## Normalizacion (R9, R10, R11, R12, R13)

```ts
// lib/errors/normalize.ts
// Registro de mapeo de errores de dominio conocidos (que NO extienden AppError) -> code.
// Se referencian por nombre de constructor para no crear dependencia inversa a repos.
const DOMAIN_ERROR_CODE: Record<string, AppErrorCode> = {
  NumRemisionDuplicadoError: "CONFLICT",       // R10
  UsuarioDuplicadoError: "CONFLICT",           // R10
  CatalogoInvalidoError: "VALIDATION_ERROR",   // R10
};

// R14a: el logger se inyecta; si no, se usa la implementacion por defecto (R14b).
export function normalizeError(err: unknown, logger: ErrorLogger = defaultLogger): AppErrorShape {
  if (err instanceof AppError) return err.toShape();                 // R9
  if (err instanceof ZodError) {                                     // R11
    return { status: "error", code: "VALIDATION_ERROR", message: MSG.VALIDATION_ERROR,
             details: { fieldErrors: err.flatten().fieldErrors } };
  }
  if (err instanceof Error && DOMAIN_ERROR_CODE[err.name]) {         // R10
    const code = DOMAIN_ERROR_CODE[err.name];
    return { status: "error", code, message: MSG[code] };
  }
  logger.logError(err);                                              // R14/R14a/R14b
  return { status: "error", code: "INTERNAL", message: MSG.INTERNAL }; // R12/R13
}
```

`MSG` es un mapa de mensajes fijos en espanol por codigo (R15). Para `INTERNAL` el
mensaje es generico y no incluye datos de la excepcion (R13).

## Wrapper central (R7, R8)

```ts
// lib/errors/with-error-handler.ts
// R14a: acepta un ErrorLogger inyectable; por defecto usa defaultLogger (R14b).
export async function withErrorHandler<T>(
  fn: () => Promise<T>,
  logger: ErrorLogger = defaultLogger,
): Promise<T | AppErrorShape> {
  try {
    return await fn();                  // R8: exito devuelto sin envolver
  } catch (err) {
    return normalizeError(err, logger); // R7: error -> shape normalizado
  }
}
```

Uso previsto (documentado, sin migrar aun) en una Server Action:

```ts
export async function crearOrden(input: unknown, deps = {}) {
  return withErrorHandler(async () => {
    // ... logica actual; los throws inesperados se normalizan a INTERNAL
  });
}
```

## Puente HTTP para Route Handlers (R18)

```ts
// lib/errors/http.ts
export function appErrorToResponse(shape: AppErrorShape): NextResponse {
  return NextResponse.json(shape, { status: HTTP_STATUS_BY_CODE[shape.code] });
}
```

Solo se importa desde `app/api/**`. Las Server Actions NO usan HTTP: devuelven la shape
directamente (consistente con `docs/architecture.md`: "Server Action no crea ruta API").

## Logging seguro e inyectable (R14, R14a, R14b, R20)

```ts
// lib/errors/logger.ts
// R14a: interfaz minima de logging que el manejador recibe por inyeccion.
export interface ErrorLogger {
  logError(err: unknown): void;
}

// R14/R14b: implementacion por defecto, canal servidor, sin secretos ni PII.
export class ConsoleErrorLogger implements ErrorLogger {
  logError(err: unknown): void {
    console.error("[AppError:INTERNAL]", err instanceof Error ? err.stack ?? err.message : err);
  }
}

// Singleton por defecto que usan normalizeError/withErrorHandler cuando no se inyecta.
export const defaultLogger: ErrorLogger = new ConsoleErrorLogger();
```

`ErrorLogger` permite enchufar Sentry/Vercel mas tarde (una nueva clase que implemente
`logError`) e inyectarla en `withErrorHandler(fn, sentryLogger)` sin tocar el codigo del
manejador ni de `normalizeError` (R14a).

## Compatibilidad y no-regresion (R16, R17)

- No se edita ningun archivo de `lib/actions/`, `lib/services/`, `lib/repositories/`,
  `lib/types/` ni `app/` en esta feature. Solo se AGREGA `lib/errors/`.
- Los tipos de dominio existentes (`ActionError`, `LoginResult`, etc.) se dejan intactos.
- La migracion de los switch/case a `AppErrorShape` es responsabilidad de la feature 12;
  aqui se entrega solo el mapa `CODE_BY_DOMAIN_STATUS` que lo habilita.

## Alternativa descartada

**Alternativa A — Envolver TODO resultado en `{ status: "error" } | { status: "ok", data }`
y forzar que services/actions devuelvan siempre esa forma unificada ahora.**

Rechazada porque:

1. Rompe el contrato vigente (R17): hoy los `status` son ricos y semanticos
   (`"challenge_required"`, `"account_locked"`, `"invalid_credentials"`,
   `"validation_error"`, etc.). Colapsarlos a `ok/error` perderia informacion que la UI
   ya consume y obligaria a reescribir actions, services, tipos y tests en esta misma
   feature, contradiciendo el alcance "solo se crea el manejador; la feature 12 migra".
2. Aumenta el radio de cambio y el riesgo de regresion sin beneficio inmediato.
3. La solucion elegida (nuevo literal `status: "error"` conviviendo en union
   discriminada + wrapper opt-in) da la estructura comun exigida sin tocar el codigo
   existente, y deja la migracion como paso explicito y verificable en la feature 12.

**Alternativa B (parcial) descartada:** mapear errores de dominio por `instanceof`
importando las clases desde `lib/interfaces/repositories/*`. Se prefirio mapear por
`err.name` (string) en un registro para evitar que `lib/errors/` dependa hacia arriba de
repositorios concretos y para permitir registrar nuevos errores sin acoplar el modulo.
