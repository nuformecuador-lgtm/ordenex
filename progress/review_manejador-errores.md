# Review — Feature 10: Manejador de errores global (backend)

Reviewer: agente reviewer. Worktree: `ordenex-f10`, rama `feature/10-manejador-errores`.
Fecha: 2026-07-09.

## Veredicto: APROBADO

Sin hallazgos mayores (bloqueantes). 2 hallazgos menores (no bloqueantes).

## Verificacion ejecutable (corrida por el reviewer, no confiada a la bitacora)

| Comando | Resultado |
|---|---|
| `pnpm run typecheck` (tsc --noEmit) | VERDE, sin errores |
| `pnpm run lint` (eslint) | VERDE, sin warnings/errores |
| `pnpm test` (suite completa) | VERDE: 45 archivos, 294 tests |
| `pnpm exec vitest run tests/unit/errors` | VERDE: 8 archivos, 31 tests |
| `./init.sh` | `== init OK ==`, EXIT=0 (aviso no bloqueante: no hay .env/.env.example) |

## No-regresion (R17 / T10)

`git status --porcelain` solo lista rutas nuevas: `lib/errors/`, `tests/unit/errors/`,
`specs/manejador-errores/`, `progress/impl_manejador-errores.md`. `git diff --name-only HEAD`
vacio. NINGUN archivo de `lib/actions/`, `lib/services/`, `lib/repositories/`, `lib/types/`
ni `app/` fue modificado. No se migro ningun switch-case (correcto; eso es feature 12).

## Trazabilidad R1..R20 -> test

| R | Test | Archivo | Estado |
|---|---|---|---|
| R1 | AppErrorShape con status/code/message/details? | shape.test.ts | OK |
| R2 | 6 codigos UPPER_SNAKE, distintos de literales de dominio | codes.test.ts | OK |
| R3 | cada code -> HTTP de referencia | codes.test.ts | OK |
| R4 | status "error" convive con "ok" (isAppErrorShape) | shape.test.ts | OK |
| R5 | AppError expone code y message | app-error.test.ts | OK |
| R6 | toShape preserva code/message/details (y omite details si falta) | app-error.test.ts | OK |
| R7 | withErrorHandler -> AppErrorShape al lanzar | with-error-handler.test.ts | OK |
| R8 | withErrorHandler devuelve valor original si no lanza (misma ref) | with-error-handler.test.ts | OK |
| R9 | normalizeError mapea AppError a su shape | normalize.test.ts | OK |
| R10 | NumRemisionDuplicado->CONFLICT, CatalogoInvalido->VALIDATION_ERROR | normalize.test.ts | OK |
| R11 | ZodError -> VALIDATION_ERROR con fieldErrors en details | normalize.test.ts | OK |
| R12 | error desconocido -> INTERNAL con message generico | normalize.test.ts | OK |
| R13 | INTERNAL no expone message/stack/details originales | normalize.test.ts + with-error-handler.test.ts | OK |
| R14 | registra error interno por canal servidor con el error original | normalize.test.ts | OK |
| R14a | usa el ErrorLogger inyectado en vez del default | normalize.test.ts + with-error-handler.test.ts | OK |
| R14b | sin logger inyectado usa ConsoleErrorLogger -> console.error | logger.test.ts + normalize.test.ts | OK |
| R15 | mensajes no-INTERNAL fijos en espanol, sin i18n | codes.test.ts | OK |
| R16 | CODE_BY_DOMAIN_STATUS mapea los 5 status de dominio | codes.test.ts | OK |
| R17 | API importable desde @/lib/errors + no-regresion git | index.test.ts + git status | OK |
| R18 | appErrorToResponse -> NextResponse con status del code | http.test.ts | OK |
| R19 | compila strict sin any injustificado | typecheck VERDE + revision codigo | OK |
| R20 | sin catch vacios; error interno registrado | lint VERDE + normalize.test.ts | OK |

Los 20 requisitos (incluidos R14a/R14b) mapean a tests concretos, existentes y no vacios.
Verificados por inspeccion del contenido de cada test, no solo por el mapa de la bitacora.

## Cumplimiento del spec y decisiones humanas cerradas

- [x] `AppErrorShape` con `status:"error"` como discriminante (shape.ts). Convive con `"ok"`.
- [x] `normalizeError` y `withErrorHandler` implementados con ramas AppError/Zod/dominio/desconocido.
- [x] Logger INYECTABLE: interfaz `ErrorLogger`, `ConsoleErrorLogger`, `defaultLogger`
      (console.error). Inyeccion real verificada (test inyecta fake y confirma que el default
      no se llama). Default aplicado cuando no se inyecta.
- [x] `AppErrorCode` en UPPER_SNAKE, distintos de los literales de dominio.
- [x] Mensajes fijos en espanol, sin i18n (MSG).
- [x] Errores INTERNAL no filtran message/stack/details: verificado con caso de secreto en cadena.
- [x] Mapeo de dominio por `err.name` (evita dependencia hacia repos). Bien fundamentado en design.
- [x] `appErrorToResponse` para Route Handlers deriva status de HTTP_STATUS_BY_CODE.

## No-alcance respetado

- [x] No toca UI/componentes/paginas.
- [x] No migra switch-case existentes (feature 12).
- [x] Convive con el contrato `{ status }` sin romper features existentes (294 tests, cero regresiones).

## Calidad (docs/conventions.md, docs/architecture.md)

- [x] TypeScript strict: typecheck verde.
- [x] Sin `any` en la API publica de `lib/errors`. Los mapas usan `Record<AppErrorCode, ...>`
      via `satisfies`. Unico cast en tests (`as unknown as Record<...>`) para aseverar ausencia
      de stack; aceptable, es codigo de test.
- [x] Sin `catch` vacios: el unico catch (with-error-handler.ts) normaliza y devuelve shape.
- [x] Naming kebab-case en archivos, camelCase/PascalCase segun corresponde.
- [x] Modulo transversal en `lib/errors/`, separado de service/repository/controller.

## CHECKPOINTS.md (criterios aplicables)

- [x] requirements.md con EARS numerados; design.md con alternativas descartadas (A y B); tasks.md todas `[x]`.
- [x] Cada R mapea a >=1 test; bitacora contiene el mapa R->test.
- [x] typecheck / lint / test verdes.
- [x] E2E: N/A. La feature es un modulo utilitario no cableado aun a flujos criticos (la
      adopcion es feature 12). No introduce flujo auth/pagos/webhook nuevo.
- [x] Datos/seguridad Supabase: N/A. No hay tablas, migraciones ni RLS (codigo puro).
- [x] Sin secretos hardcodeados; el logger no concatena entrada de usuario.
- [x] Patron de capas respetado; Service no conoce HTTP (el puente HTTP esta aislado en http.ts).
- [x] Multi-pais: N/A, no se hardcodea pais/moneda/cuenta.
- [x] `./init.sh` verde.

## Hallazgos

### menor 1 — feature_list.json del worktree no incluye la feature 10
El `feature_list.json` de este worktree (base origin/dev) llega hasta id 9 y no tiene ninguna
feature en `in_progress`. La feature 10 no esta registrada aqui. No afecta el codigo entregado
ni el invariante de "una sola in_progress" (init.sh pasa). Es tarea de orquestacion del leader
antes de marcar la feature `done` y anadir la entrada a `progress/history.md`.

### menor 2 — pasos de cierre pendientes (no del implementer)
`progress/history.md` aun no tiene entrada para esta feature y no hay commit/push (esperado:
lo coordina el leader tras esta aprobacion). No bloquea la calidad del entregable.

## Resumen

Modulo `lib/errors/` completo, tipado, seguro e inyectable. 20/20 requisitos trazados a tests
reales, 294 tests verdes, typecheck y lint limpios, cero regresiones, no-alcance respetado.
APROBADO.
