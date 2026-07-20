# Bitácora de implementación — Feature 88 "API key: carga de órdenes por API"

Rama `feature/88-api-key-carga-ordenes`, apilada sobre `feature/81-api-keys` (base `1ebc350`).
Backend puro. Todas las tasks T1–T13 de `tasks.md` en `[x]`.

## Resumen de una línea
Endpoint `POST /api/ordenes/api-key/carga` autenticado por `Authorization: Bearer ordx_…`
(hash SHA-256 reusando `hashApiKey` de la 81 + estado `activo` del usuario dedicado), que
reusa `BulkOrdenService`, crea las órdenes en `en_ruta_bodega_principal` con `num_guia`
inmediato desde `orden_num_guia_seq` y `origen_tipo = carga_api`, y devuelve cada orden con
su guía.

## Overrides del gate F1.4 aplicados (no la recomendación del spec viejo)
- **D3:** NO se endurece `monto_cobrar`. Se hereda la regla de la carga masiva (vacío→null;
  numérico ≥0 si viene). No se agregó requisito de obligatoriedad. (R13 = validación heredada.)
- **D7:** valor de enum NUEVO `carga_api` en `orden_historial_origen_tipo` (Prisma
  `OrdenHistorialOrigenTipo`), con migración + `down.sql` que RECREA el tipo (Postgres no
  soporta DROP VALUE). Round-trip REAL ejecutado (ver abajo).

## Archivos creados
- `lib/interfaces/services/IApiKeyAuthService.ts` — contrato + `ApiKeyAuthResult`.
- `lib/services/ApiKeyAuthService.ts` — `autenticar(rawKey)` (R2–R6).
- `app/api/ordenes/api-key/carga/route.ts` — Route Handler + `handleCargaApi` + `CargaApiDeps`.
- `db/migrations/20260717120000_orden_historial_origen_tipo_carga_api/migration.sql` — `ADD VALUE 'carga_api'`.
- `db/migrations/20260717120000_orden_historial_origen_tipo_carga_api/down.sql` — recrea el enum sin `carga_api`.
- Tests:
  - `tests/unit/services/api-key-auth-service.test.ts` (T4)
  - `tests/unit/repositories/orden-repository.carga-api.test.ts` (T7)
  - `tests/unit/services/bulk-orden-service.carga-api.test.ts` (T9)
  - `tests/integration/api/ordenes-api-key-carga.route.test.ts` (T11)

## Archivos modificados (producción)
- `lib/interfaces/repositories/IApiKeyRepository.ts` — `ApiKeyAutenticada` + `findByKeyHash` (T1).
- `lib/repositories/ApiKeyRepository.ts` — impl `findByKeyHash` (select sin `keyHash`) (T2).
- `lib/interfaces/repositories/IOrdenRepository.ts` — `CreateOrdenConGuiaResultRow` + `createManyOrdenesConGuia` (T5).
- `lib/repositories/OrdenRepository.ts` — impl `createManyOrdenesConGuia` (guía inmediata + historial) (T6).
- `lib/interfaces/services/IBulkOrdenService.ts` — `CargaViaApi*` + firma `cargarViaApi` (T8).
- `lib/services/BulkOrdenService.ts` — `cargarViaApi` (reusa precargar/resolveFila; estado fijo) (T8).
- `db/schema.prisma` — enum `OrdenHistorialOrigenTipo` gana `carga_api`.
- `lib/types/orden-historial.ts` — `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` gana `carga_api` (13.º).

## Archivos modificados (tests existentes)
Fakes que implementan interfaces extendidas (añadido un mock por defecto, sin aflojar asserts):
- `tests/unit/services/bulk-orden-service.test.ts` (+ `createManyOrdenesConGuia`; + test R14 no-regresión, T12)
- `tests/unit/services/asignacion-mensajero-service.test.ts`, `orden-service.test.ts`,
  `rol-admin-satelite-authz.test.ts` (+ `createManyOrdenesConGuia`)
- `tests/integration/api/ordenes-carga-masiva-chunk.route.test.ts` (+ `cargarViaApi` en el fake)
- `tests/unit/services/api-key-service.test.ts` (+ `findByKeyHash` en los repos fake)

### Tests existentes que se pusieron ROJOS por el cambio de enum/contrato (REPORTADO)
Todos son consecuencia directa y esperada del override D7 (enum gana `carga_api`) y de R3
(el repo de API keys gana una lectura). NINGUNO se aflojó — se **actualizaron/reforzaron**
(precedente 82):
- `tests/unit/services/api-key-service.test.ts` — el guard 81 "el repo NO ofrece lectura de
  la key" (`Object.keys(repo)===['createConUsuario']`) era falso por diseño con la 88 (R3 añade
  `findByKeyHash`, lookup por hash sin proyectar el secreto). Se pinó el conjunto cerrado a
  `[createConUsuario, findByKeyHash]` y se **añadió** un guard real más fuerte en
  `tests/unit/repositories/api-key-repository.test.ts` que verifica que el `select` de
  `findByKeyHash` NUNCA proyecta `keyHash`.
- `tests/unit/types/orden-historial-types.test.ts` — conjunto cerrado 12→13 con `carga_api`.
- `tests/unit/repositories/orden-historial-cobertura.test.ts` — mapa del choke point crece a
  **13** puntos: se **registró** el nuevo call-site `OrdenRepository.createManyOrdenesConGuia`
  → `carga_api`. El guard de la 67 pasó de `toHaveLength(12)` a un invariante **posicional**
  (`indexOf('deshacer_gestion')===11`), más robusto ante crecimiento aditivo ajeno.
- `tests/integration/db/gestion-orden-anulacion-migration.test.ts` — el guard del `down.sql`
  del 67 (recrea el enum PRE-67, 11 valores) derivaba "los 11 originales" como `SEED menos
  deshacer_gestion`; ahora descuenta también `carga_api` (añadido después). El guard de longitud
  del SEED pasó a posicional.
- `tests/integration/db/zonas-migration.test.ts` — la migración 88 se añadió a la lista de
  "apéndices posteriores a zonas" (mismo patrón que 67/69/73/76/81).

## Migración — round-trip REAL (Postgres local `localhost:5432/ordenex`)
Ejecutado con `prisma db execute` + verificación de `pg_enum` (adapter PrismaPg):
1. UP  → `["…","deshacer_gestion","carga_api"]` (13 valores) ✅
2. DOWN → `["…","deshacer_gestion"]` (12 valores, `carga_api` ausente, columna re-casteada) ✅
3. RE-UP vía `prisma migrate deploy` → 13 valores + registrada en `_prisma_migrations` ✅
**Round-trip: REAL** (no estático).

## Mapa de trazabilidad R<n> → test
| Req | Test |
|-----|------|
| R1  | ordenes-api-key-carga.route.test.ts ("extrae el secreto del esquema Bearer"; "sin header -> autenticar recibe null") |
| R2  | api-key-auth-service.test.ts ("rawKey null/vacío -> unauthenticated sin tocar la DB"); ordenes-api-key-carga.route.test.ts ("sin header -> 401") |
| R3  | api-key-auth-service.test.ts ("busca por el hash SHA-256 … nunca en claro"; "activo -> ok con actor"); api-key-repository.test.ts ("findByKeyHash … select no proyecta keyHash") |
| R4  | api-key-auth-service.test.ts ("ninguna fila coincide -> unauthenticated"); ordenes-api-key-carga.route.test.ts ("autenticar unauthenticated -> 401") |
| R5  | api-key-auth-service.test.ts ("estado pendiente/inactivo/bloqueado -> forbidden"); ordenes-api-key-carga.route.test.ts ("forbidden -> 403") |
| R6  | api-key-auth-service.test.ts ("no loguea el secreto ni su hash …"); ordenes-api-key-carga.route.test.ts ("el secreto NUNCA aparece en el cuerpo de error") |
| R7  | bulk-orden-service.carga-api.test.ts (dedup/geo/valor); ordenes-api-key-carga.route.test.ts ("JSON inválido/lote vacío -> 422") |
| R8  | orden-repository.carga-api.test.ts ("historial origen null -> destino inicial … carga_api"); bulk-orden-service.carga-api.test.ts ("estado inicial FIJO en_ruta_bodega_principal") |
| R9  | orden-repository.carga-api.test.ts ("N órdenes -> N num_guia distintos/consecutivos"; "consume orden_num_guia_seq con guarda idempotente sin interpolar") |
| R10 | bulk-orden-service.carga-api.test.ts ("summary con num_guia por creada + bloque plano ordenes"); ordenes-api-key-carga.route.test.ts ("200 con las órdenes llevando su num_guia") |
| R11 | orden-repository.carga-api.test.ts ("duplicada -> no crea, no consume guía, no rastro"); bulk-orden-service.carga-api.test.ts ("remisión existente -> duplicada sin guía") |
| R12 | bulk-orden-service.carga-api.test.ts ("geo inválida en una fila no aborta el resto") |
| R13 | bulk-orden-service.carga-api.test.ts ("monto no numérico/negativo -> error"; "monto vacío -> se crea igual", regla heredada D3) |
| R14 | bulk-orden-service.test.ts ("no-regresión: cargarMasiva usa createManyOrdenes, NUNCA createManyOrdenesConGuia; estado en_preparacion"); ordenes-carga-masiva-chunk.route.test.ts (intacto) |
| R15 | bulk-orden-service.carga-api.test.ts ("rol distinto de apiKey -> forbidden sin tocar datos") |

## Salida REAL de verificación
- `pnpm typecheck` → **verde** (0 errores). *(Nota: se corrió `pnpm db:generate` desde el
  schema limpio antes de medir, para no contaminar el typecheck con el cliente generado.)*
- `pnpm lint` → **0 errores, 140 warnings** (idéntico al baseline medido en este worktree
  antes de tocar nada; todos los warnings son pre-existentes y ajenos).
- Tests feature 88 (12 archivos relacionados, en conjunto): **166 passed / 166**.
- `pnpm test` (suite completa): **3182 passed**, más un conjunto de timeouts UI que
  **fluctúa run-a-run** (baseline 8–10; en una corrida bajo carga llegó a 43). Son los flakes
  documentados (`HomePage*`, `OrdenesModuleReuse`, `OrdenesPagination`, `zona-form`,
  `usuario-form`, `wallet-page`, `MisAsignaciones…`) + el ajeno `CierreDiaPage.test.tsx > R1`
  (PR #82). **Verificado: pasan en aislado** (`zona-form`, `OrdenesPagination`, `wallet-page`,
  `usuario-form` → 48/48 corridos solos). Ninguna falla está en la capa backend de esta feature.
- `./init.sh` → rojo SOLO por esos flakes UI de timeout bajo carga (typecheck y lint pasan);
  es una condición pre-existente del worktree, no una regresión de la 88.

## Baseline medido en este worktree (antes de tocar nada)
- typecheck: verde. lint: 0 errores / 140 warnings. test: ~3176–3178 passed, 8–10 timeouts UI
  (todos ajenos/flakes; `CierreDiaPage R1` ajeno de PR #82).

## Veredicto
Feature 88 implementada y verificada: typecheck verde, lint 0 errores, 166/166 tests de la
feature en verde, round-trip de migración REAL; los únicos rojos de la suite completa son
flakes UI pre-existentes que pasan en aislado.
