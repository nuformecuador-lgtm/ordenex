# impl 69 — `cierre_detail` · bitácora

> Rama `feature/69-cierre-detail` (desde `origin/dev` `14f6548`; luego el leader mergeó `feature/72`,
> que desbloqueó T5). Spec: `specs/69-cierre-detail/` (**R1–R30**, 23 tasks).
> Gate F1.4 **APROBADA** 2026-07-15: (a)–(g), con **1 override**: (g).
> **T22 (bookkeeping) y el PR NO se hacen aquí**: los hace el leader.

## Idea en una frase

El cierre dejó de **preguntar** por los datos de la orden y de la tarifa cuando se aprueba, y pasa a
**recordar** los que había cuando se solicitó. `cierre_detail` es esa memoria; los feeds de wallet
leen a ella y a nadie más.

## Tasks

| Task | Estado | Commit |
| --- | --- | --- |
| T1 — renombrar el contrato del resolver | ✅ | `a966999` |
| T2 — `TarifaVigentePorTiendaRepository` | ✅ | `a966999` |
| T2b — `TODO:` de la deuda (g) | ✅ (texto confirmado por el humano) | `a966999` |
| T3 — test REAL del resolver | ✅ | `6e0f702` |
| T4 — `scripts/seed-zonas.ts` | ✅ | `c2ae9c3` |
| T5 — checkpoint del bloque 0 | ✅ (desbloqueado al mergear `feature/72`; medido por el leader) | — |
| T6 — modelo Prisma `CierreDetail` | ✅ | `42f039e` |
| T7 — migración + backfill + `down.sql` | ✅ | `005a3bb` |
| T8 — test estático de la migración | ✅ | `727b77a` |
| T9 — denylist de `zonas-migration` | ✅ | `9750ea1` |
| T10 — `crearCierre` puebla el snapshot | ✅ | `3e42177` |
| T11 — tests de `crearCierre` | ✅ | `fcfabd3` |
| T12 — test de inmutabilidad | ✅ | `6dc6f55` |
| T13 — corte diario (sin cambio de producción) | ✅ | `6dc6f55` |
| T14/T15/T16 — los feeds leen el snapshot + composition root | ✅ | `7f16fc8` |
| T17 — tests de los feeds | ✅ | `a536c11` |
| **T19 — test de la propiedad (R17/R18)** | ✅ | `a536c11` (ver desviación 5) |
| T18 — detalle del admin desde el snapshot | ✅ | `b04f7a0` |
| T20 — este mapa | ✅ | — |
| T21 — verificación final | ✅ medido (§Puertas) | — |
| T22 — bookkeeping | ⏸ **del leader, no mío** | — |

## Puertas (MEDIDO, no estimado)

| Puerta | Resultado |
| --- | --- |
| `pnpm typecheck` | **0 errores** (baseline 2 → 0), exit 0 |
| `pnpm lint` | **0 errores** (274 warnings preexistentes), exit 0 |
| `pnpm build` | **VERDE** — `✓ Compiled successfully in 25.9s`, 25/25 páginas |
| `pnpm test --testTimeout=30000` | **301/301 archivos · 2842/2842 tests · 0 fallos · exit 0** |
| `pnpm test` (timeout default 5000ms) | 12–15 fallos, **todos** `Test timed out in 5000ms` → §Flaky |
| Round-trip real de la migración | **UP → DOWN → UP verificado** contra Postgres local → §Migración |
| `./init.sh` | **ROJO sólo por el flaky ambiental** (`✓ typecheck`, `✓ lint`, `✗ test`) → §Flaky |

**Suite: +55 tests** (2787 → 2842), **0 fallos reales**.

## Migración: verificación REAL (no confianza)

- **`gen_random_uuid()`**: verificado disponible en la base **antes** de escribir el SQL (design §5
  pedía no asumirlo). Query real contra el Postgres local: OK.
- **Round-trip real**: `migrate deploy` → `db:rollback` → `migrate deploy`. El DOWN se comprobó de
  verdad: tras el rollback, consultar la tabla devuelve *"The underlying table for model
  `(not available)` does not exist"*.
- **Estructura afirmada en la propia base** (bloque `DO $$` que lanza excepción si no cuadra):
  `relrowsecurity = true` · **5 FKs** · **0 policies**.

## Trazabilidad `R1`–`R30` → test REAL

> Lo que **quedó**, no lo que el spec preveía. `M` = `tests/integration/db/cierre-detail-migration.test.ts` ·
> `CDR` = `tests/unit/repositories/cierre-dia-repository.test.ts` · `WF` = `tests/unit/services/wallet-feed-service.test.ts` ·
> `WTF` = `tests/unit/services/wallet-tienda-feed-service.test.ts` · `CAR` = `tests/unit/repositories/cierres-admin-repository.test.ts` ·
> `CONG` = `tests/integration/db/cierre-detail-congelado.test.ts` · `TAR` = `tests/unit/repositories/tarifa-vigente-por-tienda-repository.test.ts`.

| R | Test concreto |
| --- | --- |
| R1 | `M` :: "R1: crea la tabla con id TEXT NOT NULL + pkey" |
| R2 | `M` :: "R2: el GRANO — UNIQUE (cierre_id, orden_id)" · `M` :: "R2: el backfill mantiene el grano ORDEN (DISTINCT…)" · **`CDR` :: "R2 (EL GRANO): 2 gestiones vigentes de la MISMA orden => UNA sola fila"** |
| R3 | `CDR` :: "R3: puebla el snapshot en la MISMA $transaction que el INSERT y la vinculacion" · `CDR` :: "R3: lee lo que la tx VINCULO (where cierreId), no la lista del service" |
| R4 | `CDR` :: "R4: si el createMany del snapshot falla, el error se propaga (rollback, sin efectos)" |
| R5 | `CDR` :: "R5: no puede haber filas de gestiones anuladas (el updateMany ya solo vincula vigentes)" · `M` :: "R5: el backfill excluye gestiones anuladas" |
| R6 | `CDR` :: "R6: congela los datos money-critical de la orden" · `CDR` :: "R6: montoCobrar nulo en la orden se congela como null (no como 0)" · `M` :: "R6: congela las columnas money-critical" |
| R7 | `CDR` :: "R7: congela los descriptivos + los 5 nombres desnormalizados" · `CDR` :: "R7: distrito nulo … => distritoNombre null" · `M` :: "R7: congela los descriptivos, con num_guia SIN UNIQUE" |
| R8 | `CDR` :: "R8: congela los 7 valores de la tarifa + tarifa_id, resueltos EN LA MISMA tx" · `M` :: "R8: congela los 7 valores de tarifa + tarifa_id" · `TAR` :: "R8: el batch congela tambien `tarifaId`…" |
| R9 | `CDR` :: "R9: tienda SIN tarifa => fila con las 8 columnas NULL y el cierre se crea igual" · `M` :: "R9: las 8 columnas de tarifa son NULLABLE" · `WF` :: "R9: tarifa congelada ausente … sin lanzar" · `WTF` :: "R9/R14: tarifa congelada ausente → debitos 0.00 … credito COD intacto" · `CONG` :: "R9/(c): una tienda que se queda SIN tarifa vigente al aprobar sigue liquidando la congelada" |
| R10 | `tests/unit/repositories/cierre-detail-inmutable.test.ts` (3 tests: ningún `update*`/`delete*`/`upsert` en `lib/`; único camino de escritura; el modelo no expone `updated_at`/`deleted_at`) · `M` :: "R10: fila INMUTABLE — sin updated_at ni deleted_at" |
| R11 | `CDR` :: "R11: montoCobrar viaja como Decimal escala 2 (nunca number/parseFloat)" · `CDR` :: "R8…" (afirma `Decimal` + `toFixed(2)` en los 7 valores) · `TAR` :: "R8: proyecta los 7 campos … como STRING escala 2 (money-safe)" |
| R12 | `WF` :: "R12: lee cierre_detail por cierreId y NO consulta orden, zona ni tarifas" · `WF` :: "R12: de gestion_orden solo toma ordenId y resultado" |
| R13 | `WTF` :: "R13: la TIENDA destinataria sale del SNAPSHOT, no de la orden viva" · `WTF` :: "R13: no consulta orden, zona ni tarifas vivas; de la gestion solo toma lo que ES suyo" |
| R14 | `WF` :: "R14: lanza CierreDetalleFaltanteError y NO devuelve ningun movimiento" · `WF` :: "R14: el error identifica el cierre y la orden sin snapshot" · `WTF` :: "R14: falta la fila congelada -> lanza y NO emite ningun movimiento" · `CAR` :: "R14: falta la fila congelada de una orden -> error duro (sin fallback a datos vivos)" |
| R15 | `CAR` :: "R6/R15: cierre en alcance -> compone gestiones (WHERE cierre_id = X) con el SNAPSHOT" · `CAR` :: "R15: los descriptivos salen del SNAPSHOT, no de la orden viva" · ⚠ **cobertura parcial**: ver desviación 1 |
| R16 | `CDR` :: describe "Feature 69/R16 — la vista EN VIVO no depende del snapshot" :: "findGestionesPendientes sigue leyendo gestion_orden en vivo, sin tocar cierreDetail" · los describes 37/67 preexistentes siguen verdes **sin editar sus aserciones** |
| R17 | **`CONG` :: "los movimientos salen con los valores CONGELADOS y cuadran con los total_* del cierre"** |
| R18 | **`CONG` :: "los movimientos salen con la tarifa CONGELADA, no con la vigente al aprobar"** |
| R19 | `CAR` :: "R19: una orden con deleted_at sigue apareciendo en el detalle del cierre" |
| R20 | `TAR` :: "R20: resuelve por `tiendaId` (NO por zona…)" · `M` :: "R20: el backfill resuelve la tarifa por TIENDA, no por zona" |
| R21 | `tests/unit/utils/ingreso-ordenex.test.ts` (existente, **sin tocar**: la fórmula no cambió) · `WF` :: "central (esCentral) usa flete GAM" · `WTF` :: "esCentral usa flete GAM" |
| R22 | `TAR` :: "R22: excluye las borradas logicamente … y elige la MAS RECIENTE" · `TAR` :: "R22/(g): el `where` NO filtra por `status`" · `TAR` :: "R22/(g): el `where` del batch tampoco filtra por `status`" · `M` :: "(g)/R22: el LATERAL replica el WHERE del resolver y NO filtra tarifas.status" |
| R23 | `TAR` (todo el archivo: instancia la **clase real** contra un doble de `Pick<PrismaClient,"tarifa">` y afirma los argumentos exactos) |
| R24 | `M` :: "R24: DROP TABLE IF EXISTS cierre_detail (arrastra unique, indice, FKs y RLS)" · `M` :: "R24: contiene migration.sql y down.sql" · **+ round-trip real** |
| R25 | `M` :: "R25: habilita RLS SIN policies (solo service role)" · **+ verificado en la base viva: `relrowsecurity=true`, 0 policies** |
| R26 | `M` :: "R26: el UP contiene el INSERT .. SELECT de backfill" · `M` :: "R26: es idempotente (ON CONFLICT DO NOTHING)" |
| R27 | `M` :: "R27: no excluye ningun cierre — todo cierre existente queda con detalle" |
| R28 | `pnpm typecheck` = **0** · `tests/unit/scripts/seed-zonas.test.ts` (existente) verde |
| R29 | §Puertas + §Flaky (evidencia medida) |
| R30 | `TAR` :: "el fuente contiene un `TODO:` localizable por grep" · "…declara que `status` NO se filtra y que puede liquidar dinero una tarifa inactiva" · "…referencia la feature 69 y la decision (g)" · "…enmarca lo pendiente como la SELECCION de la fila, no como 'migrar a snapshot'" |

**Ningún `R<n>` queda sin test.** (R15 con la salvedad de la desviación 1.)

## Tests verificados ROJO a mano (no pasan por casualidad)

Un test que nunca se ha visto fallar no prueba nada. Se comprobó invirtiendo el código y restaurándolo:

1. **T19 (R17/R18) — el corazón.** Se restauraron **desde git** los dos feeds pre-T14 y se corrió el
   **mismo** test con el **mismo** harness. **ROJO 3/3:**
   - `expected '7777.00' to be '1000.00'` → liquidaba con la tarifa **nueva** (R18).
   - `expected undefined to be '500.00'` → la orden re-apuntada a otra tienda: el dinero
     **desaparecía** (R17).
   - `expected undefined to be '1000.00'` → tarifa borrada ⇒ liquidaba en **cero**.
   Con T14/T15: **VERDE 3/3**. *La feature vale exactamente lo que vale este rojo.*
2. **(g) en el backfill (`M`).** Añadir `AND ta."status" = 'activo'` al `LATERAL` ⇒ **ROJO**.
3. **R2, el grano (`CDR`).** Quitar el dedupe por `ordenId` ⇒ **ROJO**.
4. **R10, inmutabilidad.** Añadir un `cierreDetail.updateMany` en `lib/` ⇒ **ROJO**.

## Flaky: por qué `./init.sh` sale rojo y por qué NO es de la 69

- **Con `--testTimeout=30000`: `301/301` archivos, `2842/2842` tests, exit `0`.** Cero fallos.
- **Con el timeout default (5000ms):** 12–15 fallos, **todos** `Test timed out in 5000ms`.
- **Es load-dependiente, probado:** el conjunto de archivos que falla **cambia entre dos corridas del
  MISMO commit** (una añade `LoginForm`, otra `zona-form`/`OrdenesPagination`…). Un fallo real es
  determinista; éste no lo es.
- **No es de la 69:** los 8 archivos son de UI (`HomePage*`, `LoginForm`, `OrdenesPagination`,
  `zona-form`, `recuperar-contrasena-form`, `OrdenesModuleReuse`) y **ninguno importa nada que la 69
  toque** (verificado por grep). El alcance de la 69 es **backend**.
- **Honestidad sobre el baseline:** el leader midió **3** archivos flaky; aquí se ven **7–8**. No es
  regresión de código: la suite es más grande (+55 tests) y más lenta, así que la ventana de 5000ms se
  desborda en más sitios. Si alguno fuera un fallo real, subir el timeout **no lo arreglaría** — y lo
  arregla.
- **Conclusión: `./init.sh` ROJO sólo por esta clase** (sus otras puertas pasan: `✓ typecheck`,
  `✓ lint`). **Es deuda de arnés registrada, no de esta feature. No se maquilla.**

## Archivos tocados

### Bloque 0 (T1–T4)

**Creados:** `lib/interfaces/repositories/ITarifaVigentePorTiendaRepository.ts` ·
`lib/repositories/TarifaVigentePorTiendaRepository.ts` ·
`tests/unit/repositories/tarifa-vigente-por-tienda-repository.test.ts` (15 tests).
**Eliminados** (renombrados): `…/ITarifaVigentePorZonaRepository.ts` · `…/TarifaVigentePorZonaRepository.ts`.
**Modificados:** los dos feeds (resolver por tienda) · `lib/utils/ingreso-ordenex.ts` (sólo tipo/comentarios:
**fórmula intacta**, R21) · `lib/actions/cierres-admin.ts` · `scripts/seed-zonas.ts` (cruce → `zona_distrito`)
· tests de 42/43 y `seed-zonas` adaptados al rename.

### T6–T21

**Producción**
- `db/schema.prisma` — modelo `CierreDetail` + lados inversos en `CierreDia`, `Orden`, `Zona`,
  `Usuario`, `Tarifa`. (`prisma format` realineó de paso `GestionOrden`/`CierreBodega`: whitespace, sin
  cambio semántico. Efecto colateral en la desviación 3.)
- `db/migrations/20260715140000_cierre_detail/{migration.sql,down.sql}` — **nueva**.
- `lib/utils/cierre-detalle.ts` — **nuevo**: lectura compartida del snapshot por los dos feeds (si
  divergieran, la caja y el ledger liquidarían distinto el mismo cierre) + `CierreDetalleFaltanteError`.
- `lib/repositories/CierreDiaRepository.ts` — el snapshot dentro de la tx de `crearCierre`.
- `lib/repositories/CierresAdminRepository.ts` — el detalle del admin desde el snapshot.
- `lib/services/WalletFeedService.ts` · `lib/services/WalletTiendaFeedService.ts` — leen el snapshot y
  **pierden** el resolver de tarifa y sus cachés.
- `lib/interfaces/services/IWalletFeedService.ts` · `IWalletTiendaFeedService.ts` — el tx client gana
  `cierreDetail`.
- `lib/actions/cierre-dia.ts` · `lib/actions/cierres-admin.ts` · `app/api/cron/corte-diario/route.ts`
  — composition roots.
- **`lib/utils/ingreso-ordenex.ts`: NO se tocó en T6–T21** (R21). Es la prueba de que la fórmula no cambió.

**Tests**
- Nuevos: `cierre-detail-migration.test.ts` (24) · `cierre-detail-congelado.test.ts` (3) ·
  `cierre-detail-inmutable.test.ts` (3).
- Extendidos: `cierre-dia-repository.test.ts` (30 → 45) · `cierres-admin-repository.test.ts` (25 → 28) ·
  `wallet-feed-service.test.ts` (7 → 11) · `wallet-tienda-feed-service.test.ts` (14 → 17) ·
  `corte-diario-service.test.ts` (6 → 7) · `zonas-migration.test.ts` (denylist) ·
  `cierres-admin-service.test.ts` y `wallet-idempotencia.test.ts` (dobles) ·
  `gestion-orden-anulacion-migration.test.ts` (desviación 3).

## Decisiones F1.4 aplicadas

- **(a)** backfill en el UP, lectores **sin fallback**: falta la fila ⇒ `CierreDetalleFaltanteError`.
- **(b)** tarifa como columnas de **ENTRADA** (no conceptos derivados).
- **(c)** el gap se conserva: tienda sin tarifa ⇒ `null` ⇒ conceptos 0.00, **no bloquea**.
- **(e)** **sin** guarda al UPDATE de `orden`.
- **(f)** punto único de escritura confirmado (T13, sin cambio de producción).
- **(g) OVERRIDE — respetado al carácter.** El resolver filtra **sólo** `deletedAt: null` +
  `orderBy createdAt desc`; `tarifas.status` **NO** entra (ni singular ni batch), y el `LEFT JOIN
  LATERAL` del backfill **tampoco** — coinciden **al carácter**, o un cierre backfilleado y uno nuevo
  liquidarían distinto. Fijado por test de la **ausencia** en los tres sitios.
- **(d)** el test del resolver ejercita la **clase real**. **R30**: `TODO:` con las 4 piezas.

## Desviaciones (reportadas, no decididas por mi cuenta)

1. **`design.md` §4.4 es FÁCTICAMENTE FALSO — hueco real de R15.** Afirma que los consumidores de
   `WITH_DETALLE` son *"sólo `CierreDiaRepository` y `CierresAdminRepository`"*. **No es cierto:**
   **`CierresBodegaAdminRepository` (feature 40, `:102`) también lo consume**, para mostrar las gestiones
   de los `cierre_dia` **YA CREADOS** que consolida ⇒ **esa vista sigue mostrando datos VIVOS**, y R15
   ("un administrador consulta el detalle de un cierre ya creado ⇒ datos congelados") **la alcanza por su
   texto**. **No se corrigió**: T18 acota el alcance a `findCierreByIdEnAlcance`, y tocar una vista de la
   40 excede lo aprobado. **No mueve dinero** (los feeds ya leen el snapshot; esto es display).
   **Requiere decisión del humano:** ¿entra en la 69 o va a feature aparte?
2. **`pnpm db:migrate` (`prisma migrate dev`) inutilizable en este repo** — drift de checksum
   **PREEXISTENTE** en `20260714123909_reconcile_fks_drop_order_status_value` (modificada tras aplicarse,
   commit `22cf7a3`): aborta pidiendo reset de la base. El round-trip se hizo con `migrate deploy` +
   `db:rollback`, que no dependen del checksum. **Ninguna migración de la 69 lo causa.**
3. **Regresión mía, detectada por la suite y corregida:** `prisma format` (T6) realineó `GestionOrden` y
   puso roja una aserción de la 67 que exigía **un espacio exacto**
   (`gestion-orden-anulacion-migration.test.ts:152`). Se pasó a `\s+`, como ya hacían sus dos aserciones
   vecinas: se afirma que la relación es opcional con `onDelete: SetNull`, no el ancho de la alineación.
4. **T13 sin cambio de producción**, como el diseño preveía (verificado: los únicos llamadores de
   `crearCierre` son `CierreDiaService:244` y `CorteDiarioService:80`; `CorteDiarioRepository` sólo
   consulta). Sólo se añadió la regresión.
5. **Convención rota (menor):** "un commit por task". **T19 quedó dentro del commit de T17** (`a536c11`)
   por un `git add -A`. El contenido está completo y verificado (rojo-antes/verde-después documentado);
   no se reescribió la historia por el bug del harness. Se reporta en vez de disimularlo.
6. **Extensión del contrato (heredada del bloque 0):** el batch devuelve
   `TarifaVigenteResuelta = TarifaVigente & { tarifaId }` porque `cierre_detail` necesita `tarifa_id`
   (design §2.1). `TarifaVigente` (los 7 campos) **no cambia**: es extensión, no cambio.

## Lo que esta feature NO hace (para que nadie lo suponga)

- **No repara descuadres pasados.** El backfill congela el valor **actual**; para un cierre ya
  descuadrado ése puede no ser el que había al solicitarlo (no hay historial de `monto_cobrar`: el dato
  original se perdió). **Detiene la sangría, no cura la herida.** Riesgo aceptado en (a).
- **No arregla la deuda (g).** El dinero **puede** derivarse de una tarifa `inactivo`, y ahora además
  queda **congelado** en un libro inmutable. Contrapartida real: `tarifa_id` en el snapshot la hace
  **auditable por primera vez** (se puede listar qué cierres liquidaron contra una tarifa hoy inactiva).
- **No cierra el gap (c).** Sólo lo hace **visible**: `tarifa_* IS NULL` deja rastro consultable de qué
  órdenes se cerraron sin tarifa.
