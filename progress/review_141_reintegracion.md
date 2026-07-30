# review_141_reintegracion — Re-review de la 141 tras la reintegración de `dev` (PR #168)

> Worktree `.claude/worktrees/rescate-141`, rama `rescate/141-rebase`, HEAD `ee6676fc`
> (merge "integra dev (hotfix WhatsApp, #206 y #207) en la 141"). Base `origin/dev` = `664840f3`.
> **NO sustituye a `progress/review_141.md`** (2026-07-27, APROBADO-CON-NOTAS): lo REVALIDA.
> El reviewer NO editó código. Todas las mutaciones se aplicaron y se revirtieron (`git status`
> limpio al cerrar, verificado).

## Veredicto

**OK — 0 bloqueantes.** El veredicto del 2026-07-27 **SIGUE EN PIE** tras +220 commits de base.
Además, la **nota menor 2 de aquel informe (round-trip real de la migración pendiente) queda
SALDADA** con ejecución contra Postgres real (abajo).

## Alcance de este re-review

No se repite el mapa R1→R55 (ya verificado uno por uno el 27/07 y sin cambios de spec desde
entonces: 55 requisitos, 31 tasks `[x]`, 0 sin marcar). Se verifica lo que la base movió bajo la
feature, **por mutación y por ejecución**, no por lectura del mapa.

## 1. `BulkOrdenService` / `OrdenRepository` reescritos (153, 154, 155, 156, 149)

**Sin lógica huérfana ni duplicada.** El cableado del lote quedó exactamente en 3 puntos de
llamada y 2 de resolución, todos vivos:

- `BulkOrdenService.cargarMasiva` → `createManyOrdenesConGuia(..., lote)` (rama **b** de la 155)
  y `createManyOrdenes(..., lote)` (rama **a**). El objeto `lote` se construye UNA vez, ANTES de
  la bifurcación, y es idéntico en ambas ramas.
- `BulkOrdenService.cargarViaApi` → `createManyOrdenesConGuia(..., lote, { conGuia })`.
- `OrdenRepository` → `ensureCargaEnTx` en las 2 rutas batch, DENTRO del `$transaction` y ANTES
  del `createMany`.
- `setCargaDownloadUrl` / `setOrdenesDownloadUrl` → único consumidor `EtiquetasDescargaService`.
- **Ningún lector** de `carga.download_url` ni de `orden.download_url` en todo el repo (relevante
  para la deuda del TTL, menor 1 del 27/07: sigue latente, no dañina).

Mutaciones que lo prueban (ver §6): **M1** (rama b ignora el token) y **M26** (rama a lo ignora)
mueren cada una en su propio `describe` — la bifurcación de la 155 está cubierta **en las dos
ramas**, no solo en la histórica.

## 2. Borde de la API key

Contrato coherente con lo que hoy hace el borde: `download_type` se valida con zod (enum +
default `consolidate`), viaja al orquestador, se hace eco en `downloadType`, y convive sin
interferencia con el bloque `manifiesto` de la 155 y con `etiquetasPdf` de la 136. El tope de
etiquetas se aplica ANTES en AMBOS modos. `name` → 409 traducido desde `CargaNombreDuplicadoError`.
Mutaciones M4, M5, M18, M19, M21, M22, M23 mueren todas.

## 3. Convivencia con la 149 (`deshacer asignación`) — CONFIRMADO por lectura y por mutación

`deshacerAsignacionLote` ejecuta un UPDATE cuyo SET es exactamente
`estatus_id`, `mensajero_asignado_id = NULL`, `asignado_at = NULL`, `updated_at = NOW()`.
No menciona `carga_id` ni `download_url`. Barrido completo de los SET crudos de
`OrdenRepository`: los únicos son los de `num_guia` (x4), el de la asignación y este.
**Ninguna otra escritura toca las columnas de la 141.** Ejecutado ese mismo SET contra Postgres
real sobre una orden colgada de un lote: **la orden conserva `carga_id`** (ver §5).
Transacciones distintas, sin solape. **Correcto: una orden revertida CONSERVA su lote.**

## 4. Flujo de estados (catálogo v2 de la 154, creación bifurcada de la 155)

La 141 **no asume ningún estado**: el diff completo (`lib/`, `app/`, `db/`) no contiene
`en_fulfillment`, `en_ruta` ni ningún literal de estado. El estado inicial lo resuelve
`resolverDestinoCreacion` (155) y la 141 solo cuelga el lote del canal de carga. Verificado
además contra el catálogo REAL de una base migrada desde cero: `en_fulfillment` ya no existe
(lo retira `20260729140000_order_status_retiro_en_fulfillment`), `en_reparto` y
`por_recolectar_en_tienda` sí, y `pendiente` sobrevive vestigial. Ningún test ni fixture de la
141 referencia un value retirado (la bitácora ya documenta el ajuste de
`orden-repository.carga-lote.test.ts` de `en_ruta_bodega_central` a `por_recolectar_en_tienda`).

## 5. Migración `20260727120000_carga_orden_carga_id` — ROUND-TRIP REAL (saldada la menor 2)

Base **desechable** creada al efecto (`ordenex_rt141` en `localhost:5432`, eliminada al cerrar).
**Producción NO se tocó** (host verificado antes de conectar; aborto duro si no es local).

| Fase | Resultado |
| --- | --- |
| 96 migraciones de `dev` aplicadas SIN la de la 141 (estado de `dev`) | OK |
| **UP de la 141 aplicada AL FINAL**, después de `20260728*`, `20260729*` y `20260730120000` | **OK, limpia** |
| Objetos creados | `carga` (8 col.), `carga_pkey`, `carga_usuario_carga_name_key`, `carga_usuario_carga_idx`, `carga_fecha_carga_idx`, `orden.carga_id`, `orden.download_url`, `orden_carga_id_idx`; ambas FK con `confdeltype = r` (RESTRICT) |
| RLS | `relrowsecurity = true`, **0 policies** (R12) |
| DOWN **con datos vivos** (5 lotes + 1 orden colgada) | OK — no exige vaciar nada |
| Tras el DOWN | tabla, columnas, índices y constraints de la 141 fuera; **nada ajeno perdido** (huella completa de `information_schema.columns` + `pg_indexes` + `pg_constraint` comparada); las órdenes SOBREVIVEN |
| **RE-UP** | OK — huella del esquema **idéntica** a la de antes del DOWN |
| `prisma migrate diff` DB→`schema.prisma` | **CERO drift de la 141** (`carga` no aparece). El drift reportado es preexistente de `dev`: `api_key`, `jobs`, `plantilla_mensaje`, `premio_ranking`, `ruta_optimizada`, `webhook_suscripcion`, `cierre_detail`, `chat_mensaje`, `notificacion` |

Semántica verificada con SQL real (no con dobles):

- **R9/R24** `u1` repite `name` → `23505` sobre `carga_usuario_carga_name_key`.
- **R25** `u2` usa el MISMO `name` → aceptado.
- **R10** dos lotes SIN nombre del mismo usuario → conviven (NULL distinto de NULL).
- **R2** borrar el usuario dueño de lotes → `23001` (`restrict_violation`, no `NO ACTION`).
- **R4** `carga_id` inexistente → `23503`; borrar un lote con órdenes → `23001`.
- **R11/R37** orden con `carga_id` NULL → válida.

**Nota operativa (ya declarada en la ficha):** el timestamp `20260727120000` es anterior al de
las migraciones que entraron después, así que `migrate deploy` la aplica fuera de orden de fecha.
Comprobado que eso es **inofensivo**: la migración es 100% aditiva y no depende de nada del lote
153-160. (Comparte timestamp con `20260727120000_notificacion`, ya aplicada en `dev`; el desempate
lexicográfico la deja antes, sin efecto.)

## 6. Mutaciones (27 aplicadas · 26 muertas · 1 superviviente)

Suite objetivo: los 18 archivos de test tocados por la feature (400 tests, baseline verde).
M10 se corrió además contra la **suite COMPLETA**.

| # | Mutación | Resultado |
| --- | --- | --- |
| M1 | `cargarMasiva` rama **b (155, conGuia)** ignora el token entrante (`cargaId: null`) | **muerta** (4) |
| M26 | `cargarMasiva` rama **a (sin guía)** ignora el token entrante | **muerta** (3) |
| M2 | `createManyOrdenesConGuia` no reutiliza el id entre batches internos (R30) | **muerta** (1) |
| M3 | `reutilizarCarga` sin guard de propiedad (R19) | **muerta** (2) |
| M9 | token inexistente → CREA la fila con el id que propone el cliente (R15/R19) | **muerta** (2) |
| M7 | `hayFilasPorInsertar` siempre true → lotes huérfanos (R28/R33/R35) | **muerta** (2) |
| M14 | el `createMany` no lleva `carga_id` (R36) | **muerta** (2) |
| M12 | el dry-run persiste (R27) | **muerta** (4) |
| M15 | la creación descarta el `name` (R21) | **muerta** (7) |
| M16 | reutilizar el lote REESCRIBE el `name` (R23) | **muerta** (1) |
| M8 | `cargarViaApi` `total_files` = solo creadas (R32) | **muerta** (1) |
| M25 | el lote de la vía API se atribuye a otro usuario (R31) | **muerta** (1) |
| M27 | `buildSummary` devuelve siempre `cargaId: null` (R38) | **muerta** (4) |
| M13 | `cargaId` sin validación de UUID en la vía sesión (R18) | **muerta** (1) |
| M24 | la vía sesión no traduce lote ajeno → 403 (R19) | **muerta** (1) |
| M23 | la vía API no traduce nombre duplicado → 409 (R24) | **muerta** (1) |
| M17 | el cliente INVENTA el `cargaId` del primer chunk (R15/R16) | **muerta** (3) |
| M20 | el cliente declara el total del CHUNK, no el de la SESIÓN (R29) | **muerta** (1) |
| M4 | default de `download_type` = `individual` (R43) | **muerta** (2) |
| M5 | el borde IGNORA `download_type` y pide siempre `consolidate` (R42/R55) | **muerta** (1) |
| M21 | la respuesta no hace eco de `downloadType` (R55) | **muerta** (4) |
| M22 | la respuesta no expone la URL por orden (R54) | **muerta** (2) |
| M18 | el borde no aplica el tope de etiquetas (R52) | **muerta** (2) |
| M19 | el fallo de generación deja de ser best-effort (R51) | **muerta** (8) |
| M11 | `setCargaDownloadUrl` escribe en `orden` en vez de `carga` (R47) | **muerta** (1) |
| M6 | modo `individual` no persiste `orden.download_url` (R48) | **muerta** (4) |
| **M10** | **`deshacerAsignacionLote` (149) añade `carga_id = NULL, download_url = NULL` a su SET** | **SUPERVIVIENTE — 622 archivos / 7110 tests verdes** |

> **Actualización 2026-07-30:** M10 **ya no sobrevive**. La fila se deja tal cual (estado en el
> momento del review); el cierre está en §9, menor 1. Marcador actual: **27 · 27 · 0**.

## 7. Auditoría de la resolución del conflicto (`tests/integration/db/zonas-migration.test.ts`)

**La resolución es CORRECTA y no pierde cobertura real.** Tomar la versión de `dev` (baseline
pinneado del PR #207) sobre la denylist a mano de la rama es lo correcto, y además es
**estrictamente más fuerte**:

- La aserción vieja era `thisDir >= max(dirs menos denylist)`. Como la denylist enumeraba TODAS
  las migraciones posteriores, su contenido efectivo era "zonas >= la más reciente que existía
  cuando se escribió" — exactamente lo que el baseline pinnea (`TS >= 20260711000000`).
- Lo único que la vieja cazaba de verdad —renombrar esta carpeta a un timestamp anterior— la
  nueva lo caza **mejor**: añade `TS(thisDir) === 20260711120000`, que además detecta un
  renombrado *hacia adelante* (que la vieja dejaba pasar).
- Lo que la vieja NO cazaba: una migración nueva **retrodatada** por debajo de zonas seguía
  pasando (no altera el max). Ninguna de las dos lo cubre; no es una pérdida del cambio.
- Lo único perdido es **fricción de proceso** (obligar a tocar la lista con cada migración), que
  es justamente lo que rompió cinco veces el 2026-07-29. No es cobertura de comportamiento.
- La entrada `!d.endsWith("_carga_orden_carga_id")` desaparece **sin dejar hueco**: el invariante
  de orden de la 141 lo cubre su propio test, `carga-migration.test.ts` → "la carpeta contiene
  migration.sql y down.sql, con timestamp posterior a la que la precede", que compara contra la
  carpeta inmediatamente anterior (no contra la última del árbol) y por tanto **no envejece**.

El archivo quedó **byte-idéntico a `dev`** (no aparece en `git diff origin/dev..HEAD`).

## 8. Checklist (CHECKPOINTS.md)

### Especificación
- [x] `requirements.md` con R1–R55 EARS + D1–D11.
- [x] `design.md` con 15 alternativas descartadas (A–O).
- [x] `tasks.md`: 31 `[x]`, **0** sin marcar.

### Trazabilidad
- [x] Los 55 requisitos mapean a tests vivos; todos los archivos citados en `impl_141.md`
      existen salvo `asignacion-mensajero-service.test.ts`, borrado por la 159 y **documentado
      como aceptado** en la propia bitácora.
- [x] `progress/impl_141.md` contiene el mapa R → test.

### Calidad de código (ejecutado por el reviewer en esta rama)
- [x] `typecheck` — 0 errores.
- [x] `lint` — **19 problems (0 errors, 19 warnings)**; ninguna warning en archivos de la 141.
- [x] `pnpm test` — **622 archivos / 7110 tests / 0 fallos**.
- [x] `./init.sh` — `== init OK ==` (typecheck, lint, test, down.sql, .env presente).
- [~] **E2E: dispensa CONCEDIDA, explícita y acotada.** CHECKPOINTS la pide para ingesta de
      órdenes. **No existe harness de E2E ejercitable en el repo** (no hay spec previo de carga
      masiva y `pnpm test:e2e` no forma parte de `./init.sh`), y esta feature no toca UI: **0
      archivos `.tsx` en el diff**. La cobertura equivalente la dan los tests de integración de
      los dos bordes HTTP más el test del cliente troceador. Dispensa por ausencia de harness, no
      por inercia; caduca el día que el repo tenga uno.

### Datos y seguridad
- [x] `carga` con RLS habilitada y **0 policies** — verificado contra Postgres real, no por regex.
- [x] Migración reversible: **round-trip real up→down→up ejecutado y verde**, con huella de
      esquema idéntica y sin daño colateral.
- [x] Sin secretos hardcodeados (barrido del diff: 0 coincidencias de secret/key/token/URL).
- [x] Webhooks: no aplica.

### Patrón de capas
- [x] Los dos route handlers solo validan (zod), traducen errores de dominio (403/409/422) y
      componen la respuesta. La escritura de `download_url` pasa por `EtiquetasDescargaService`
      (inyectable). Los `new OrdenRepository(...)` del borde están confinados a los
      *composition roots* (`buildDescargaService`, `buildBulkService`), que construyen, no llaman.
- [x] Services sin HTTP; repository solo Prisma; interfaces en `lib/interfaces/`.

### Permisos / multi-país
- [x] R41 intacto: vía sesión `adminTienda`, vía API key `apiKey` más auth de key.
- [x] Sin hardcode de país, moneda ni contexto (barrido del diff: 0 coincidencias).

### Verificación final
- [x] `./init.sh` verde.
- [ ] Entrada en `progress/history.md` — pendiente del leader al cerrar.

## 9. Hallazgos

### BLOQUEANTES

Ninguno.

### Menores NUEVOS de este re-review

1. **menor — hueco de cobertura en la frontera con la 149 (mutante M10 superviviente).**
   Añadir `carga_id = NULL, download_url = NULL` al SET de `deshacerAsignacionLote` deja
   **7110/7110 tests en verde**. El comportamiento de HOY es correcto (verificado en Postgres
   real: la orden revertida conserva su lote), pero **no hay red**: nadie detectaría que una
   futura reasignación o corrección de estado desvincule órdenes de su lote. No es bloqueante
   porque ningún requisito R1–R55 enuncia ese invariante (R36 habla del camino de carga, no del
   de reversión) y el código es correcto. Recomendación: un test de invariante —"ninguna vía de
   cambio de estado escribe `carga_id` ni `download_url`"— cuando la 141 gane su primer lector.

   > **CERRADO el 2026-07-30 (backend_dev).** El hallazgo se deja arriba **íntegro**: el rastro
   > importa, porque el valor del test nuevo se mide contra el mutante que sobrevivió.
   >
   > - **Comportamiento: SIN CAMBIOS.** El `SET` de `deshacerAsignacionLote` queda exactamente
   >   como estaba (`git diff` de `lib/repositories/OrdenRepository.ts` vacío). Lo que faltaba
   >   era la red, no el arreglo.
   > - **Test creado:** `tests/integration/repositories/deshacer-asignacion.trazabilidad-carga.test.ts`
   >   (2 casos). Va ahí —y no con los vecinos unitarios de `deshacerAsignacionLote`— porque esos
   >   afirman la **forma** del SQL y un aserto de esa familia habría fijado el texto del `SET`.
   >   Este vive con los de **semántica**: el doble de `$queryRaw` reconstruye el SQL como Prisma,
   >   **parsea y EJECUTA** el `SET`/`WHERE` sobre filas en memoria, y el aserto mira **la fila
   >   resultante**. Afirma que la orden revertida conserva `carga_id` y `download_url` —es decir,
   >   que **no pierde la trazabilidad de su carga**—, junto a los asertos de que la reversión sí
   >   ocurrió (estado, mensajero y `asignado_at`), para que el invariante no sea vacuo. El caso
   >   (b) añade la guarda de zona y una orden de alta manual: el invariante **conserva, no
   >   escribe**.
   > - **M10 MUERTO, comprobado en ejecución** (mutación aplicada de verdad y revertida; `git
   >   diff` vacío al cerrar): con `carga_id = NULL, download_url = NULL` en el `SET`, los **2
   >   casos fallan** (`expected null to be 'carga-2026-07-30-tienda-1'`). Sin ella, verdes.
   > - **Requisito:** sigue sin existir. Se propone **R56** en `progress/impl_141.md`; la spec
   >   **no se tocó** (decisión del leader).
   > - **Lo que NO cierra:** el invariante general de §11.1 ("ninguna vía de cambio de estado
   >   escribe esas columnas") sigue abierto — este test cubre la única vía que este review
   >   identificó como riesgo real, no las futuras.
   >
   > Marcador de mutación tras el cierre: **27 aplicadas · 27 muertas · 0 supervivientes.**

2. **menor — el contrato público publicado no refleja el borde nuevo.**
   `lib/api/openapi-spec.ts` documenta `/api/ordenes/api-key/carga` **sin** `name` ni
   `download_type` en `CargaRequest`, **sin** `cargaId`, `downloadType` ni
   `ordenes[].downloadUrl` en `CargaResponse`, y **sin** el 409 en `responses`. Un integrador
   que genere cliente desde la spec no puede usar la feature. **Deuda preexistente compartida**:
   la misma spec tampoco documenta `etiquetasPdf` (136) ni `manifiesto` (155). Por eso es menor y
   no bloqueante: la 141 no empeora un contrato que ya iba dos features por detrás. Corresponde
   una feature de puesta al día de la spec.

3. **menor — mensaje del tope inexacto en modo `individual`.** `msgLoteExcedeTope` afirma
   "el PDF **consolidado** no se genero (divide el lote o imprime las etiquetas por guia)" también
   cuando `download_type = individual`, donde nunca hubo consolidado. El test del caso solo asserta
   que el mensaje contiene el número del tope, así que la redacción no está fijada. Cosmético,
   pero es texto de cara al integrador.

4. **menor — `pnpm db:rollback` ya no alcanza a esta migración.** El script revierte
   **solo la última carpeta** por orden lexicográfico, y `20260727120000_carga_orden_carga_id`
   quedó en medio del historial. El checkpoint "el script `db:rollback` funciona" se cumple hoy
   por su `down.sql` (verificado en ejecución real contra Postgres), no por el script. Limitación
   general de la herramienta para cualquier migración no-última, no un defecto de la 141.

5. **menor — bookkeeping desactualizado (del leader, no del implementer).**
   (a) `progress/impl_141.md` documenta **solo la primera** reintegración (`c473ecf0`, "587
   archivos / 6523 tests"); faltan `6acad912` (#203/#204) y `ee6676fc` (#206/#207), y los números
   reales de hoy son **622 / 7110**. (b) `feature_list.json` no lleva campo `pr` pese a que el PR
   #168 está abierto, y su `branch` dice `feature/141-tabla-cargas-orden` mientras el trabajo vive
   en `rescate/141-rebase`. El `status_note`, en cambio, **sí** está al día (incluye el aviso de
   re-review y el follow-up del `loteId` de la 146).

6. **menor (observación, NO de la 141) — drift preexistente en `dev`.** `prisma migrate diff`
   entre una base migrada desde cero y `schema.prisma` reporta diferencias en `api_key`, `jobs`,
   `plantilla_mensaje`, `premio_ranking`, `ruta_optimizada`, `webhook_suscripcion`,
   `cierre_detail`, `chat_mensaje` y `notificacion` (defaults de `updated_at`, un ON DELETE y
   dos nombres de índice). **Ni una sola línea del drift toca `carga`, `carga_id` ni
   `download_url`.** Se deja anotado porque lo hará visible el primer `migrate dev` que alguien
   corra, y no debe atribuirse a esta rama.

### Menores del 27/07 — estado tras la reintegración

| # (27/07) | Estado |
| --- | --- |
| 1. TTL de las URLs firmadas persistidas | **VIGENTE.** Confirmado que sigue sin existir ningún lector de esas columnas: la deuda es latente, no dañina. Caduca el día que se exponga la columna |
| 2. Round-trip real de la migración pendiente | **SALDADA** por este review (§5) |
| 3. Flakiness de la suite bajo carga | **NO REPRODUCIDA.** `./init.sh` verde a la primera, 622/622 |
| 4. Fallback de `totalFiles` en la vía sesión | VIGENTE (el mutante M20 confirma que el cliente del repo sí declara el total de la sesión) |
| 5. Carrera residual de R35 | VIGENTE, aceptada |
| 6. Guard R19 no corre en un chunk 100% duplicado | VIGENTE, aceptada |
| 7. Objetos huérfanos en Storage ante fallo parcial | VIGENTE, aceptada |
| 8. Sin E2E | VIGENTE — dispensa reafirmada arriba, explícita y acotada |
| 9. Bookkeeping | Parcialmente resuelto (`description` y `status_note` al día); ver menor 5 nuevo |
| 10. Test de rollback de R34 con `$transaction` mockeada | VIGENTE. Mitigado en parte: la atomicidad estructural (ensure dentro del callback, antes del insert) sigue probada por la traza de orden, y ahora la FK RESTRICT está verificada contra Postgres real |
| 11. Coste del modo `individual` | VIGENTE, aceptada |

## 10. Salida real de verificación (reviewer, worktree `rescate-141`)

```
$ git status --porcelain            (vacío, antes y después de las 27 mutaciones)

$ ./init.sh
node v22.13.1 · dependencias presentes
typecheck paso
19 problems (0 errors, 19 warnings)  -> lint paso
 Test Files  622 passed (622)
      Tests  7110 passed (7110)
   Duration  199.51s
test paso
todas las migraciones tienen down.sql
.env presente
== init OK ==

$ round-trip contra Postgres local (base desechable ordenex_rt141, eliminada al cerrar)
host: localhost port: 5432
FASE 1 OK: 96 migraciones de dev aplicadas (sin la 141)
FASE 2 OK: UP de la 141 aplicada DESPUES de las posteriores de dev
  RLS carga: relrowsecurity=true · policies: []
  FKs: carga_usuario_carga_fkey confdeltype=r · orden_carga_id_fkey confdeltype=r
  12/12 aserciones de semantica SQL OK (unicidad por usuario, NULLs multiples, RESTRICT x2,
  carga_id NULL valido, la orden revertida conserva su lote)
  DOWN con datos vivos OK · nada ajeno perdido · RE-UP OK · esquema identico
  TOTAL FAILS: 0

$ prisma migrate diff (DB con la 141) -> schema.prisma
  drift preexistente de dev; CERO lineas de carga / carga_id / download_url

$ mutaciones: 27 aplicadas · 26 muertas · 1 superviviente (M10)
```

## 11. Deuda que queda abierta

1. ~~Test de invariante que proteja `carga_id`/`download_url` frente a las vías de cambio de estado
   (mata M10).~~ **PARCIALMENTE CERRADA el 2026-07-30:** la vía de la 149 ya tiene su test
   (`tests/integration/repositories/deshacer-asignacion.trazabilidad-carga.test.ts`, M10 muerto).
   Queda abierta la forma **general** —"NINGUNA vía de cambio de estado escribe esas columnas"—,
   que hoy solo sostiene el barrido manual de los `SET` crudos del repositorio (§3).
2. Re-firma bajo demanda de las URLs persistidas (alternativa N del design): obligatoria ANTES de
   exponer `download_url` en UI o API de lectura.
3. Puesta al día de `lib/api/openapi-spec.ts` con lo que este endpoint devuelve desde la 136
   (`etiquetasPdf`), la 155 (`manifiesto`) y la 141 (`name`, `download_type`, `cargaId`,
   `downloadType`, `ordenes[].downloadUrl`, 409).
4. Unificar el `loteId` del aviso de la 146 con `carga.id` (ya declarado como follow-up
   no bloqueante en la ficha; cambiaría alcance).
5. Bookkeeping del leader: actualizar `impl_141.md` con las dos reintegraciones posteriores y sus
   números reales; rellenar `pr` y `branch` en `feature_list.json`; entrada en `history.md`.
