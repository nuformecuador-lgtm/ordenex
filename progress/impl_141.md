# impl_141 — Tabla `carga` + `carga_id`/`download_url` en `orden`

> Rama `feature/141-tabla-cargas-orden` (worktree `ordenex-wt-141`), desde `origin/dev` @ 1cfb2ed.
> Alcance backend puro: **cero `.tsx` en el diff** (verificado con `git diff --name-only 1cfb2ed`).
> NO se ejecutó ninguna escritura contra la base (`prisma migrate deploy` / `db:migrate` /
> `db:rollback` NO se corrieron: el `.env` apunta a una DB compartida).

## Commits

| Hash | Qué |
| --- | --- |
| `e7ea97f` | Migración `20260727120000_carga_orden_carga_id` (UP+DOWN), `schema.prisma`, denylist de `zonas-migration` |
| `358efec` | Repositorio: `LoteContexto`, `CargaLoteAjenoError`, `ensureCargaEnTx`, `carga_id` en la misma tx |
| `daaa1c1` | Service, borde HTTP (chunk route) y cliente de chunks |
| `287368d` | Tests nuevos (R1–R30) |
| `8616ffe` | `tasks.md` `[x]` + notas de ejecución |

## Archivos creados

- `db/migrations/20260727120000_carga_orden_carga_id/migration.sql` y `down.sql`
- `lib/repositories/carga-lote.ts` — `ensureCargaEnTx(tx, {...})`, patrón `appendCambioEstado`
- `tests/fixtures/carga-lote.ts` — doble en memoria del delegate `carga` + `loteCtx()`
- `tests/integration/db/carga-migration.test.ts`
- `tests/unit/repositories/carga-lote.test.ts`
- `tests/unit/repositories/orden-repository.carga-lote.test.ts`
- `tests/unit/services/bulk-orden-service.carga-lote.test.ts`

## Archivos modificados

- `db/schema.prisma` — `model Carga` (`@@map("carga")`), `Orden.cargaId`/`Orden.downloadUrl` +
  relación `OrdenCarga` + `@@index([cargaId])`, `Usuario.cargasRealizadas`
- `lib/interfaces/repositories/IOrdenRepository.ts` — `LoteContexto`, `CargaLoteAjenoError`,
  nuevas firmas de `createManyOrdenes` (`{ inserted, cargaId }`) y `createManyOrdenesConGuia`
  (`{ creadas, cargaId }`)
- `lib/repositories/OrdenRepository.ts` — ensure del lote + `carga_id` en el INSERT dentro del
  mismo `$transaction`; guard `hayFilasPorInsertar` (sin lotes huérfanos); `carga` añadido al
  `Pick` del cliente Prisma
- `lib/services/BulkOrdenService.ts`, `lib/interfaces/services/IBulkOrdenService.ts`,
  `lib/types/carga-masiva.ts` — `options.cargaId`/`options.totalFiles`, `summary.cargaId` en
  ambos summaries
- `app/api/ordenes/carga-masiva/chunk/route.ts` — zod `cargaId?: uuid`, `totalFiles?: int>=0`;
  `CargaLoteAjenoError` → 403
- `app/(app)/ordenes/_components/carga-masiva-chunks.ts` — un `cargaId` por sesión en firme +
  `totalFiles` de la sesión en cada chunk; dry-run sin lote
- `tests/integration/db/zonas-migration.test.ts` — denylist `_carga_orden_carga_id`
- Adaptación de tests existentes a las nuevas firmas/summaries:
  `tests/unit/repositories/orden-repository.bulk.test.ts`,
  `tests/unit/repositories/orden-repository.carga-api.test.ts`,
  `tests/integration/repositories/orden-geocode-enqueue.test.ts`,
  `tests/unit/services/{bulk-orden-service,bulk-orden-service.carga-api,orden-service,rol-admin-satelite-authz,asignacion-mensajero-service}.test.ts`,
  `tests/integration/api/{ordenes-carga-masiva-chunk,ordenes-api-key-carga}.route.test.ts`,
  `tests/integration/carga-api-etiquetas.test.ts`, `tests/components/CargaMasivaChunks.test.ts`
- `specs/141-tabla-cargas-orden/tasks.md` — tasks `[x]` + notas

`app/api/ordenes/api-key/carga/route.ts` **no se tocó** (0 líneas): el `cargaId` viaja por el
spread `{ ...summary, etiquetasPdf }` que ya existía (coordinación con la feature 136, T10).

## Mapa `R<n> → test`

| R | Test (archivo · caso) |
| --- | --- |
| R1 | `tests/integration/db/carga-migration.test.ts` · "R1: crea la tabla en SINGULAR con id, fecha_carga, download_url y total_files" + "el modelo Carga mapea a la tabla `carga`…" |
| R2 | idem · "R2: usuario_carga es NOT NULL con FK a usuario(id) ON DELETE RESTRICT" + "R2: Usuario expone el lado inverso (cargasRealizadas)" |
| R3 | idem · "R3: NO define batch_url, ni status, ni un enum nuevo…" + "R3: el modelo Carga NO declara status ni batchUrl" |
| R4 | idem · "R4: agrega carga_id TEXT NULLABLE con indice y FK … ON DELETE RESTRICT" + "R4/R5: el modelo Orden declara cargaId/downloadUrl nullable…" |
| R5 | idem · "R5: agrega download_url TEXT NULLABLE a `orden`" |
| R6 | idem · "R6: download_url es TEXT NULLABLE (nace sin valor)" |
| R7 | idem · "R7: total_files es INTEGER NOT NULL (tamano TOTAL del lote)" |
| R8 | idem · "R8: sin backfill — ningun UPDATE ni INSERT sobre las ordenes existentes" (+ R4: columna nullable) |
| R9 | idem · "R9: habilita RLS en `carga` y NO define ninguna policy" |
| R10 | idem · describe "DOWN — revierte exactamente (R10)" (3 casos) |
| R11 | idem · "R11: no toca num_guia…" · y `tests/unit/repositories/orden-repository.carga-lote.test.ts` · "R11/R29: la fila insertada no lleva num_guia ni download_url" |
| R12 | `tests/unit/services/bulk-orden-service.carga-lote.test.ts` · "R12/R13: propaga al repo el cargaId de la SESION…" · `tests/unit/repositories/carga-lote.test.ts` · "crea la fila con el id propuesto…" · `tests/components/CargaMasivaChunks.test.ts` · "R12/R13: los N chunks … MISMO cargaId" |
| R13 | `tests/unit/repositories/carga-lote.test.ts` · "R13: el segundo chunk con el MISMO id no crea una fila nueva" (+ los dos anteriores) |
| R14 | `tests/unit/services/bulk-orden-service.carga-lote.test.ts` · "R14: dry-run no persiste nada…" · `tests/components/CargaMasivaChunks.test.ts` · "R14: el dry-run NO envia cargaId ni totalFiles" |
| R15 | `tests/unit/services/bulk-orden-service.carga-lote.test.ts` · "R15: … TODAS duplicadas …" y "R15: … TODAS en error …" · `tests/unit/repositories/orden-repository.carga-lote.test.ts` · "un batch cuyas filas YA existen no toca `carga` ni inserta" |
| R16 | `tests/integration/api/ordenes-carga-masiva-chunk.route.test.ts` · "R16: cargaId que no es UUID -> 422…" + "R16/R18: cargaId UUID y totalFiles se propagan al service" |
| R17 | idem · "R17: lote de OTRO usuario -> 403…" · `tests/unit/repositories/carga-lote.test.ts` · "lanza CargaLoteAjenoError…" · `tests/unit/repositories/orden-repository.carga-lote.test.ts` · "R17: un lote de OTRO usuario aborta la insercion" |
| R18 | `tests/unit/services/bulk-orden-service.carga-lote.test.ts` · "R18: total_files = total de la SESION…" y "R18: sin total declarado, cae al tamaño del chunk" · `tests/unit/repositories/carga-lote.test.ts` · "R18: total_files NO se acumula…" y "…no degrada el valor ya escrito" · `tests/components/CargaMasivaChunks.test.ts` · "R18: todos los chunks declaran el total de la SESION" |
| R19 | `tests/unit/services/bulk-orden-service.carga-lote.test.ts` · "R19/R20/R21: un lote por peticion…" · `tests/unit/repositories/orden-repository.carga-lote.test.ts` · "R19: dos batches internos comparten UN solo lote" |
| R20 | `tests/unit/services/bulk-orden-service.carga-lote.test.ts` · "R19/R20/R21: … del usuario de la key …" |
| R21 | idem · "R19/R20/R21: … total = filas del payload" y "R21: total_files cuenta TAMBIEN las duplicadas y con error" · repo · "R19: … totalFiles: 2 con batchSize 1" |
| R22 | `tests/unit/services/bulk-orden-service.carga-lote.test.ts` · "R22: sin ninguna orden creada no se llama al repo y cargaId es null" · repo · "R22/R24: un lote 100% duplicado no crea fila en `carga`" |
| R23 | `tests/unit/repositories/orden-repository.carga-lote.test.ts` · "R23: el ensure … DENTRO del mismo $transaction y ANTES del insert" + "R23: si el insert falla, el error se propaga y la tx revierte" |
| R24 | idem · "un batch cuyas filas YA existen no toca `carga` ni inserta", "un batch mixto … SI crea el lote", "R22/R24: un lote 100% duplicado no crea fila en `carga`" |
| R25 | idem · "R25: todas las filas del createMany llevan el MISMO carga_id" + "R19: … ambas ordenes cuelgan del MISMO lote" (las duplicadas no entran al INSERT) |
| R26 | idem · "`create` no envia carga_id ni download_url y no toca `carga`" |
| R27 | `tests/unit/services/bulk-orden-service.carga-lote.test.ts` · "R27: el summary devuelve el cargaId resuelto por el repo" · route · "R27: la respuesta incluye el cargaId del summary" y "R27: dry-run devuelve cargaId null" |
| R28 | `tests/integration/api/ordenes-api-key-carga.route.test.ts` · "R28: el cargaId viaja en la respuesta junto al resto del summary" y "R28: sin ordenes creadas, cargaId es null…" · service · "R28: el summary devuelve el cargaId y conserva el resto de campos" |
| R29 | `tests/unit/repositories/carga-lote.test.ts` · "R29: la fila nace SIN download_url" · repo · "R11/R29: la fila insertada no lleva num_guia ni download_url" y "`create` no envia … download_url" · service · "R29 — download_url no se escribe por ningun camino del servicio" |
| R30 | `tests/unit/services/bulk-orden-service.carga-lote.test.ts` · "R30: un rol distinto de adminTienda…" y "R30: un rol distinto de apiKey…" · route · "R30: la autorizacion no cambia…" |

## Verificación (salida real)

Baseline medido en el worktree ANTES de tocar nada (con `pnpm db:generate` desde el schema
limpio, usando un `DATABASE_URL` ficticio: `generate` no abre conexión):

```
$ pnpm typecheck        → sin errores
$ pnpm lint             → ✖ 144 problems (0 errors, 144 warnings)
$ pnpm test             → Test Files  515 passed (515) · Tests  5209 passed (5209)  [161.19s]
```

Después de la feature:

```
$ pnpm typecheck
> tsc --noEmit
(sin salida: 0 errores)

$ pnpm lint
✖ 144 problems (0 errors, 144 warnings)
(mismo recuento que el baseline: la feature no añade errores ni warnings)

$ pnpm test
 Test Files  519 passed (519)
      Tests  5275 passed (5275)
   Duration  210.41s
```

Delta: +4 archivos de test, +66 tests, 0 fallos. Nada venía rojo del baseline.

## Desviaciones respecto del spec (y por qué)

1. **T11 · quién genera el `cargaId`.** El diseño decía que lo genera *el llamador* de
   `procesarEnChunks`; sus llamadores son `OrdenesCargaMasivaButton.tsx` y
   `OrdenesCargaUpload.tsx`, y el alcance exige **cero `.tsx`**. Se generó dentro de
   `procesarEnChunks` (`.ts`), que recibe el arreglo COMPLETO de la sesión: una invocación =
   una sesión (R12) y `filas.length` = total de la sesión (R18). El comportamiento del spec
   queda intacto y `ProcesarChunksOpts` sigue aceptando `cargaId`/`totalFiles` explícitos.
2. **T2 · ubicación del test estático de migración.** `tests/integration/db/carga-migration.test.ts`
   en vez de `tests/unit/db/`: no existe `tests/unit/db/` y las ~50 pruebas de migración del
   repo viven en `tests/integration/db/`.
3. **Guard `hayFilasPorInsertar` (añadido al diseño §3.1).** El diseño aseguraba el lote antes
   del `createMany` "solo si el batch tiene ≥1 orden que insertar", pero `skipDuplicates` puede
   saltar TODAS las filas y dejar un lote huérfano (R24). Se añadió una comprobación contra el
   snapshot `before` (que ya se leía dentro de la tx, ahora con `numRemision` en el `select`):
   si todas las remisiones del batch ya existen, no se toca `carga` ni se inserta.
4. **`ensureCargaEnTx` usa `carga.createMany({ skipDuplicates: true })`** en vez de SQL crudo
   `INSERT ... ON CONFLICT DO NOTHING`: es la MISMA sentencia que emite Prisma, pero tipada y
   sin `$executeRaw` (`skipDuplicates` es soportado en Postgres). Semántica idéntica.
5. **`CargaLoteAjenoError` vive en `lib/interfaces/repositories/IOrdenRepository.ts`** (no en
   `lib/repositories/carga-lote.ts`), junto a `NumRemisionDuplicadoError`: así el controller
   puede reconocerlo sin importar una implementación de repositorio.
6. **`app/api/ordenes/api-key/carga/route.ts` sin cambios** (T10 pedía "≤ 5 líneas"): el
   `cargaId` ya viaja por el spread existente. Cero solape con la feature 136.

No hubo choques con el código real de `origin/dev` (137–140): el rename de `order_status`, la
guardia central de transiciones (`appendCambioEstado` valida antes del append) y las etiquetas
PDF de la carga API no se tocan; el lote se asegura ANTES del `createMany`, así que la guardia
de la 140 sigue corriendo exactamente donde corría.

## Deuda / puntos abiertos

- **Round-trip real de la migración pendiente.** No se ejecutaron `pnpm db:migrate` ni
  `pnpm db:rollback` (DB compartida). La cobertura es estática (regex sobre `migration.sql` /
  `down.sql` / `schema.prisma`); el up→down→up contra Postgres debe hacerlo el reviewer, como
  en la feature 101.
- **`prisma migrate diff` no ejecutado** (requiere shadow DB): el no-drift schema↔migración se
  verifica por aserciones estáticas del test de migración, no por el CLI.
- **Carrera residual en R24.** Si entre el `SELECT before` y el `createMany` (misma tx) otra
  transacción inserta TODAS las remisiones del batch, el lote quedaría creado sin órdenes
  propias. Ventana estrecha e inocua (el `cargaId` de la sesión se reutiliza en los chunks
  siguientes). La alternativa —compensar con un `DELETE` del lote— se descartó: con FK
  RESTRICT podría fallar por órdenes de otro chunk concurrente y abortar un batch sano.
- **`download_url` sigue sin escritor** (decisión cerrada F1.4-4). Punto de integración futuro:
  la URL firmada del PDF consolidado de la feature 136 → `carga.download_url`.
- **Sin UI ni listado por lote** (gate F1.4-5): `carga_id` se persiste y se devuelve, nada más.
