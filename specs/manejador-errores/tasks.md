# Feature 10 — Manejador de errores global (backend) — tasks.md

Marca `[P]` = paralelizable con otras `[P]` del mismo grupo. Cada task indica su
criterio de "hecho" y los `R<n>` que cubre. No se edita codigo de produccion existente:
solo se AGREGA `lib/errors/` y sus tests.

## Grupo 0 — Andamiaje

- [x] **T0** Crear carpeta `lib/errors/` y el barrel `index.ts` vacio (se completa al
  final).
  - Hecho: la carpeta existe y `index.ts` compila.
  - Cubre: (infra)

## Grupo 1 — Tipos y constantes (todas `[P]` entre si tras T0)

- [x] **T1 [P]** `lib/errors/codes.ts`: `AppErrorCode` (UPPER_SNAKE), `HTTP_STATUS_BY_CODE`,
  `CODE_BY_DOMAIN_STATUS`, `MSG` (mensajes fijos en espanol por codigo, sin i18n).
  - Hecho: exporta los 6 codigos en UPPER_SNAKE (distintos de los literales de dominio);
    `HTTP_STATUS_BY_CODE` cubre los 6; `CODE_BY_DOMAIN_STATUS` mapea los 5 status de
    dominio; `MSG` tiene texto fijo en espanol; typecheck ok.
  - Cubre: R2, R3, R15, R16

- [x] **T2 [P]** `lib/errors/shape.ts`: `AppErrorShape` + `isAppErrorShape`.
  - Hecho: tipo con `status:"error"`, `code`, `message`, `details?`; guard funciona.
  - Cubre: R1, R4

- [x] **T3 [P]** `lib/errors/app-error.ts`: clase `AppError` + subclases de conveniencia
  (`ValidationError`, `UnauthenticatedError`, `ForbiddenError`, `NotFoundError`,
  `ConflictError`) con `toShape()`.
  - Hecho: `new AppError(code,msg,details).toShape()` produce shape correcta; subclases
    fijan su `code`.
  - Cubre: R5, R6

## Grupo 2 — Nucleo (depende de Grupo 1)

- [x] **T4** `lib/errors/logger.ts`: interfaz `ErrorLogger` (`logError`), clase
  `ConsoleErrorLogger` (default, canal servidor, sin PII/secretos) y `defaultLogger`.
  - Hecho: interfaz e implementacion existen; en test se puede inyectar un fake y espiar
    `console.error` en la default; no imprime datos de entrada del usuario.
  - Cubre: R14, R14a, R14b, R20

- [x] **T5** `lib/errors/normalize.ts`: `normalizeError(unknown, logger = defaultLogger)`
  con registro `DOMAIN_ERROR_CODE` (por `err.name`), ramas AppError / ZodError / dominio
  / desconocido; el logger inyectado registra el error INTERNAL.
  - Depende de: T1, T2, T3, T4
  - Hecho: cubre R9–R13; INTERNAL no expone message/stack originales y llama a
    `logger.logError`; ZodError -> `details.fieldErrors`; logger inyectable respetado.
  - Cubre: R9, R10, R11, R12, R13, R14a, R14b

- [x] **T6** `lib/errors/with-error-handler.ts`: `withErrorHandler(fn, logger?)`.
  - Depende de: T5
  - Hecho: exito pasa transparente; throw -> `normalizeError(err, logger)`; el logger
    inyectado se propaga.
  - Cubre: R7, R8, R14a

## Grupo 3 — Puente HTTP (depende de Grupo 1)

- [x] **T7 [P]** `lib/errors/http.ts`: `appErrorToResponse(shape)` -> `NextResponse`.
  - Hecho: status HTTP derivado de `HTTP_STATUS_BY_CODE`; body === shape.
  - Cubre: R18

## Grupo 4 — Barrel y calidad

- [x] **T8** Completar `lib/errors/index.ts` reexportando la API publica.
  - Depende de: T1–T7
  - Hecho: `import { withErrorHandler, AppError, normalizeError, appErrorToResponse } from "@/lib/errors"` funciona.
  - Cubre: R17 (importable sin tocar consumidores), R19

- [x] **T9** Revision de calidad: sin `any` injustificado, sin `catch` vacio, strict ok.
  - Depende de: T8
  - Hecho: `pnpm typecheck` y `pnpm lint` verdes sobre `lib/errors/`.
  - Cubre: R19, R20

## Grupo 5 — No-regresion

- [x] **T10** Verificar que ningun archivo fuera de `lib/errors/**` y
  `tests/**/errors*` fue modificado (git status limpio para produccion existente).
  - Hecho: `git diff --name-only` no lista `lib/actions/`, `lib/services/`,
    `lib/repositories/`, `lib/types/`, `app/`.
  - Cubre: R17

---

## Bloque de tests (Mapa R -> test)

Ubicacion: `tests/unit/errors/`. Framework: Vitest (como el resto del repo).

| R | Test (descriptivo) | Archivo |
| --- | --- | --- |
| R1 | `AppErrorShape tiene status error, code, message y details opcional` | `shape.test.ts` |
| R2 | `AppErrorCode incluye los 6 codigos esperados` | `codes.test.ts` |
| R3 | `cada code mapea a su HTTP de referencia` | `codes.test.ts` |
| R4 | `status error convive con status ok en union discriminada (isAppErrorShape)` | `shape.test.ts` |
| R5 | `AppError expone code y message` | `app-error.test.ts` |
| R6 | `AppError.toShape preserva code, message y details` | `app-error.test.ts` |
| R7 | `withErrorHandler devuelve AppErrorShape cuando la operacion lanza` | `with-error-handler.test.ts` |
| R8 | `withErrorHandler devuelve el valor original cuando no lanza` | `with-error-handler.test.ts` |
| R9 | `normalizeError mapea una instancia de AppError a su shape` | `normalize.test.ts` |
| R10 | `normalizeError mapea NumRemisionDuplicadoError a CONFLICT y CatalogoInvalidoError a VALIDATION_ERROR` | `normalize.test.ts` |
| R11 | `normalizeError mapea ZodError a VALIDATION_ERROR con fieldErrors en details` | `normalize.test.ts` |
| R12 | `normalizeError mapea error desconocido a INTERNAL con message generico` | `normalize.test.ts` |
| R13 | `un error INTERNAL no expone el message ni el stack originales` | `normalize.test.ts` |
| R14 | `normalizeError registra el error interno por el canal de servidor` | `normalize.test.ts` |
| R14a | `normalizeError usa el ErrorLogger inyectado en vez del default` | `normalize.test.ts` |
| R14b | `sin logger inyectado, ConsoleErrorLogger registra por console.error` | `logger.test.ts` |
| R15 | `los mensajes de errores no-INTERNAL son textos fijos en espanol, sin i18n` | `codes.test.ts` |
| R16 | `CODE_BY_DOMAIN_STATUS mapea los 5 status de dominio a su AppErrorCode` | `codes.test.ts` |
| R17 | `la API publica se importa desde @/lib/errors sin tocar consumidores` (import + git no-regresion) | `index.test.ts` + T10 |
| R18 | `appErrorToResponse devuelve NextResponse con el status HTTP del code` | `http.test.ts` |
| R19 | `el modulo compila bajo strict sin any` (typecheck en verificacion) | verificacion |
| R20 | `no hay catch vacios; el error interno se registra` (lint + R14) | verificacion + `normalize.test.ts` |

Todos los R1..R20 (incluidos los sub-requisitos R14a y R14b) quedan trazados a un test
o a la verificacion ejecutable.

## Bloque de verificacion

- [x] `pnpm typecheck` (o `tsc --noEmit`) verde — cubre R19.
- [x] `pnpm lint` verde sobre `lib/errors/` — cubre R20.
- [x] `pnpm test tests/unit/errors` verde — cubre R1–R18, R20.
- [x] `./init.sh` en verde (una sola feature `in_progress`, suite completa pasa).
- [x] `git diff --name-only` no muestra cambios fuera de `lib/errors/**`,
  `tests/unit/errors/**`, `specs/manejador-errores/**` — cubre R17.
