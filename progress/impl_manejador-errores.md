# Bitacora de implementacion — Feature 10: Manejador de errores global (backend)

Rama: `feature/10-manejador-errores` (worktree `ordenex-f10`, desde `origin/dev`).
Alcance: backend puro. Modulo nuevo `lib/errors/`. NO se migran switch-case (feature 12).
NO hay trabajo frontend. Sin commit/push (lo coordina el leader tras el reviewer).

## Delegacion
- `backend_dev` (opus): implemento el modulo completo `lib/errors/` + tests `tests/unit/errors/`.
- El implementer (este agente) coordino, corrio verificacion completa y consolido esta bitacora.

## Archivos creados

### Produccion — `lib/errors/` (8)
- `lib/errors/codes.ts` — `AppErrorCode` (UPPER_SNAKE), `HTTP_STATUS_BY_CODE`, `MSG` (ES fijo), `CODE_BY_DOMAIN_STATUS`
- `lib/errors/shape.ts` — `AppErrorShape` + `isAppErrorShape`
- `lib/errors/app-error.ts` — clase `AppError` + subclases (`ValidationError`, `UnauthenticatedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`), `toShape()`
- `lib/errors/logger.ts` — interfaz `ErrorLogger`, `ConsoleErrorLogger`, `defaultLogger`
- `lib/errors/normalize.ts` — `normalizeError(err, logger=defaultLogger)` + registro `DOMAIN_ERROR_CODE` (por `err.name`)
- `lib/errors/with-error-handler.ts` — `withErrorHandler(fn, logger?)`
- `lib/errors/http.ts` — `appErrorToResponse(shape) -> NextResponse`
- `lib/errors/index.ts` — barrel API publica

### Tests — `tests/unit/errors/` (8)
- `codes.test.ts`, `shape.test.ts`, `app-error.test.ts`, `logger.test.ts`,
  `normalize.test.ts`, `with-error-handler.test.ts`, `http.test.ts`, `index.test.ts`

### Archivos NO de codigo tocados
- `specs/manejador-errores/tasks.md` — tasks T0..T10 + verificacion marcadas `[x]`
- `progress/impl_manejador-errores.md` — esta bitacora

## No-regresion (R17 / T10)
`git status --porcelain` solo lista `lib/errors/`, `tests/unit/errors/`, `specs/manejador-errores/`.
NINGUN cambio en `lib/actions/`, `lib/services/`, `lib/repositories/`, `lib/types/`, `app/`.

## Mapa R -> test

| R | Cubierto por | Archivo |
|---|---|---|
| R1  | AppErrorShape tiene status/code/message/details? | shape.test.ts |
| R2  | 6 codigos UPPER_SNAKE, distintos de literales de dominio | codes.test.ts |
| R3  | cada code -> HTTP de referencia (HTTP_STATUS_BY_CODE) | codes.test.ts |
| R4  | status "error" convive con "ok" en union discriminada (isAppErrorShape) | shape.test.ts |
| R5  | AppError expone code y message | app-error.test.ts |
| R6  | AppError.toShape preserva code/message/details | app-error.test.ts |
| R7  | withErrorHandler -> AppErrorShape cuando lanza | with-error-handler.test.ts |
| R8  | withErrorHandler devuelve valor original si no lanza | with-error-handler.test.ts |
| R9  | normalizeError mapea AppError a su shape | normalize.test.ts |
| R10 | NumRemisionDuplicadoError->CONFLICT, CatalogoInvalidoError->VALIDATION_ERROR | normalize.test.ts |
| R11 | ZodError -> VALIDATION_ERROR con fieldErrors en details | normalize.test.ts |
| R12 | error desconocido -> INTERNAL con message generico | normalize.test.ts |
| R13 | INTERNAL no expone message ni stack originales | normalize.test.ts |
| R14 | registra el error interno por canal servidor | normalize.test.ts |
| R14a| usa el ErrorLogger inyectado en vez del default | normalize.test.ts + with-error-handler.test.ts |
| R14b| sin logger inyectado, ConsoleErrorLogger -> console.error | logger.test.ts + normalize.test.ts |
| R15 | mensajes no-INTERNAL fijos en espanol, sin i18n | codes.test.ts |
| R16 | CODE_BY_DOMAIN_STATUS mapea los 5 status de dominio | codes.test.ts |
| R17 | API publica importable desde @/lib/errors + git no-regresion | index.test.ts + git status (T10) |
| R18 | appErrorToResponse -> NextResponse con status del code | http.test.ts |
| R19 | compila strict sin any | typecheck (verde) |
| R20 | sin catch vacios; error interno registrado | lint (verde) + normalize.test.ts |

Trazabilidad completa: R1..R20 (incl. R14a/R14b) cubiertos.

## Salida real de verificacion (dentro del worktree)

- `pnpm run typecheck` -> VERDE (tsc --noEmit, sin errores)
- `pnpm run lint` -> VERDE (eslint, sin warnings/errores)
- `pnpm test` (suite completa) -> VERDE: **45 archivos, 294 tests passing** (dur ~26s)
  - Incluye los 8 nuevos archivos de `tests/unit/errors/` (31 tests) + los existentes de origin/dev, sin regresiones.
- `./init.sh` -> `== init OK ==`, EXIT=0 (typecheck+lint+test verdes; una sola feature in_progress; migraciones con down.sql)
  - Aviso no bloqueante preexistente: "no hay .env ni .env.example".

## Notas tecnicas
- **zod v4** (4.4.3): se uso `z.flattenError(err).fieldErrors` (el deprecado `ZodError.flatten()` no se uso).
- El worktree venia sin `node_modules`; se corrio `pnpm install`. `prisma generate` necesitaba DATABASE_URL/DIRECT_URL: se pasaron valores dummy SOLO para generar el cliente (no se toco ningun `.env` ni config).
- Sin `any` en API publica; sin `catch` vacios. Unico cast en tests: `as unknown as Record<...>` para aseverar ausencia de `stack` en R13.

## Estado
Implementacion completa y verificada. Pendiente: revision del reviewer. Sin commit/push.
