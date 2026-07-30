# Feature 158 — Implementación backend, camino del ADMIN (Fase 1B, T1.19–T1.32)

> Rama `feature/158b-incidente-admin`, apilada sobre `feature/158-incidente-indemnizacion`
> (**PR #208**). Worktree `.claude/worktrees/lote-135`.
> Alcance: **T1.19 a T1.32** — camino del **ADMIN** (R37–R64), que es el **PR 2 de 2**
> decidido por el humano (Q-L, T0.8).
> **NO se tocó** la Fase 2B (T2.7–T2.10, frontend del admin) ni nada de la Fase 1/Fase 2
> (camino del mensajero, R1–R36), que están mergeadas en el PR 1.

## Veredicto

**Fase 1B completa y verde.** `./init.sh` OK: **624 archivos / 7228 tests / 0 fallos**, lint
**0 errores / 19 warnings** (los mismos 19 del baseline), todas las migraciones con `down.sql`.
`tests/integration/db` completo: **73 archivos / 742 tests / 0 fallos**. Round-trip real de la
migración contra Postgres local (up→down→up) con la precondición del `down` verificada **por
mutación en las TRES tablas** que usan el enum, y el **orden de los dos `down.sql`** verificado
también contra la base. **18 mutaciones, 18 discriminan** — dos de ellas revelaron guardias que
sólo medían FORMA y obligaron a reforzar los tests antes de aceptarlas.

**R29 queda CUMPLIDO**: el guard de emisores de `egreso_indemnizacion` pasa de **UNO** a **DOS**,
nombrados y con `origen_tipo` distinto. Era la deuda que el PR 1 dejó declarada, con candado y
con un caso que exigía este cambio.

---

## 1. Qué se hizo, por task

### T1.19 — Migración `20260730130000_orden_incidente` ✅

`db/migrations/20260730130000_orden_incidente/{migration.sql,down.sql}`.

**UP** (aditivo; no altera ninguna tabla existente, no mueve datos):

1. `ALTER TYPE "wallet_origen_tipo" ADD VALUE IF NOT EXISTS 'orden_incidente'` (R37).
2. `CREATE TABLE "orden_incidente"` — 12 columnas, 3 FKs (`orden` RESTRICT, `reportado_por`
   RESTRICT, `resuelto_por` SET NULL), 4 índices, el **índice único PARCIAL**
   `(orden_id) WHERE estado <> 'rechazado'` (R47) y **RLS habilitada sin policies**.
3. `CREATE TABLE "orden_incidente_evidencia"` — FK `ON DELETE CASCADE`, `@@unique(incidente_id,
   indice)`, índice y RLS.

**No crea ningún enum**: reusa `gestion_causa_incidente` (158/PR1) y `cierre_estado` (37), que es
la tercera aplicación del patrón de aprobación (38 → `cierre_dia`, 40 → `cierre_bodega`).

**DOWN** (espejo exacto, en orden inverso): suelta la tabla hija, luego la madre, y recrea
`wallet_origen_tipo` con los **6** valores previos migrando `origen_tipo` con `USING` en **LAS
TRES** tablas que usan el tipo (`wallet_movimiento`, `wallet_tienda_movimiento`,
`pago_mensajero_movimiento`), soltando y recreando los **SEIS** índices que lo referencian —tres
de ellos parciales, con su predicado—. **No reescribe ningún `down.sql` previo** (Q-F), y hay un
test que barre el árbol para demostrar que ninguno recrea `wallet_origen_tipo`.

### T1.20 — `db/schema.prisma` ✅

`WalletOrigenTipo + orden_incidente`, modelos `OrdenIncidente` y `OrdenIncidenteEvidencia` con
sus relaciones inversas en `Orden` (`incidentesAdmin`) y `Usuario` (`incidentesReportados`,
`incidentesResueltos`). El comentario del modelo **cita la razón de no ser una `gestion_orden`**
con el nombre del método culpable (`CorteDiarioRepository.findMensajerosConActividadSinCierre`),
para que nadie lo «simplifique» dentro de seis meses. `prisma migrate status`: sin drift.

### T1.21 / T1.22 — SEED y test estático ✅

`WALLET_ORIGEN_TIPO_SEED + orden_incidente` (doble candado intacto) y
`tests/integration/db/orden-incidente-migration.test.ts` (24 casos): forma del UP, las 12
columnas de R39 una a una, las 3 FKs con su política de borrado, el índice parcial con su
predicado exacto, RLS en las dos tablas, y el DOWN con sus tres `ALTER COLUMN` y sus seis
índices. Incluye el barrido de Q-F.

### T1.23 / T1.24 — Las 10 aristas y el inventario ✅

**#48-#52** (los cinco orígenes → `incidente`) y **#54-#58** (sus cinco inversas), todas con la
familia `incidente` que la 154 dio de alta y con el `rol` calcado de las vecinas del mismo origen
(design §12.3). Las diez son pares NUEVOS: el inventario pasa de **42/40** a **52/50** y la
diferencia de 2 (los duplicados históricos #19/#23 y #20/#24) no se mueve.

⚠️ **Hallazgo que cambió cómo se escribieron los tests:** la FAMILIA no separa los dos caminos.
Q-G (PR 1) realineó el `via` de la **#44** a `incidente`, así que hay **SEIS** entradas con esa
familia y la sexta es la del MENSAJERO. Lo que los separa es el **ORIGEN** (`en_reparto` vs. los
cinco de bodega), y la dirección se lee de `estatus_destino_id`. Está escrito en los tres tests
que lo tocan, porque es justo el tipo de detalle que se lee mal a la segunda pasada.

### T1.25 — Borde zod `lib/types/incidente.ts` ✅

`reportarIncidenteSchema` (causa del **mismo SEED** importado, motivo no vacío, `evidencias`
1..N reusando `evidenciasSchema` —que se **exporta** desde `gestion-orden.ts` en vez de
reescribir los límites—), `aprobarIncidenteSchema`, `rechazarIncidenteSchema`,
`retractarIncidenteSchema` e `incidenteIdSchema`.

El **tope del monto se REUSA** (`INDEMNIZACION_MONTO_MAX` de `lib/types/cierres-admin.ts`, el que
salió del menor m5 del review del PR 1) y no se re-deriva: `orden_incidente.indemnizacion` es
`DECIMAL(12,2)`, la misma precisión que `gestion_orden.indemnizacion`. El reporte **no admite
monto**: quien reporta no tarifa, y que el campo no exista en el schema es la primera línea de
R51.

### T1.26 / T1.27 — `IncidenteAdminRepository` + el segundo feed ✅

`reportar` en UNA transacción: (1) pre-lectura de la orden guardada por los cinco estados,
`deletedAt: null` y el alcance —las cuatro condiciones juntas, indistinguibles (R42/R48)—;
(2) `updateMany` guardado por **ese** `estatusId` exacto (anti-TOCTOU); (3) `create` en
`solicitado`; (4) las N evidencias; (5) `appendCambioEstado` por el **choke point** con
`origen_tipo = incidente`. R47 lo decide el **índice único parcial** (P2002 → `duplicado`),
acotado a SU constraint: un P2002 de otra se propaga.

`resolver` guardado por `estado = 'solicitado'` + alcance. Rama `aprobado`: escribe el monto y
`WalletIndemnizacionIncidenteFeedService` **lee de la base lo que esa misma tx acaba de
escribir**. Rama `rechazado` (rechazo o retracto): devuelve la orden a su origen por el choke
point, sin monto y sin movimiento.

El feed lleva `estado: "aprobado"` en el WHERE **como guardia**: un incidente `solicitado` o
`rechazado` no puede producir dinero por esta vía ni invocándolo con su id.

### T1.28 / T1.29 — `IncidenteAdminService` ✅

Alcance por rol/zona resuelto server-side (espejo de `CierresAdminService.resolveAlcance`), las
dos colas, evidencias firmadas en **una** llamada, subida **secuencial y compensada** (molde de
`MisAsignacionesService`), y **R51 comprobado ANTES de mirar el estado y ANTES de validar el
monto** — si fuera al revés, el autor sabría por el mensaje que su monto era inválido y podría
reintentar hasta acertar, aunque nunca vaya a poder aprobar.

La reversión **deriva** el destino con `findOrigenesReversion` (149, reusado tal cual), lo valida
contra el conjunto CERRADO de los cinco y resuelve su id. Sin fila, con origen `null` o con un
origen fuera del conjunto → `conflict` **sin mover nada** (fallo cerrado, R58).

`retractar` es el espejo exacto de R51: allí el autor NO puede resolver; aquí **sólo** el autor
puede retractar.

### T1.30 — Aislamiento (R38/R56/R63) ✅

`tests/unit/guards/incidente-admin-aislamiento.test.ts`. Es el corazón de la fase y se verifica
**en las dos direcciones**: con el diseño elegido el corte diario NO devuelve al autor, y hay un
caso de **CONTROL** que reproduce la alternativa descartada (§9.7) y demuestra que **sí lo
devolvería**. Sin ese control, «no aparece» podría ser cierto por la razón equivocada.

### T1.31 — Server Actions ✅

`lib/actions/incidentes.ts` con los cinco verbos y el composition root. `reportarIncidente`
recibe `FormData` (lleva las fotos) y **revalida MIME y tamaño en el servidor** con el mismo
schema que valida el cliente.

### T1.32 — Cierre de fase ✅

`./init.sh` verde, `tests/integration/db` completo verde, mapa R→test escrito aquí.

---

## 2. Mapa R → test (R37–R64, más R29)

> Rutas relativas a la raíz del repo. Cuando un requisito tiene varios tests, se citan todos.

| R | Test(s) |
| --- | --- |
| **R37** | `tests/integration/db/orden-incidente-migration.test.ts` › «WALLET_ORIGEN_TIPO_SEED contiene orden_incidente y conserva los 6 previos, en orden» y «§9.12: el origen del incidente es un valor PROPIO, no el reservado `gestion_orden`» · `tests/unit/services/wallet-indemnizacion-incidente-feed.test.ts` › «R37/§9.12: el origen es `orden_incidente`…» |
| **R38** | `tests/unit/guards/incidente-admin-aislamiento.test.ts` › «con el diseño elegido (tabla propia): el autor NO entra en el corte», **«CONTROL (§9.7): con la alternativa DESCARTADA el corte SÍ lo devolvería»**, «el corte SIGUE devolviendo al MENSAJERO…», «`contarEntregadasPorMensajero` solo cuenta `entregada`…», y los tres `it.each` estructurales (4+4+8 casos) · `…/orden-incidente-migration.test.ts` › «R38: LAS DOS tablas nuevas nacen con RLS habilitada y SIN policies» |
| **R39** | `…/orden-incidente-migration.test.ts` › «R38/R39: crea `orden_incidente` con sus 12 columnas y los tipos exactos», «R43/R50: `estado` nace `solicitado` y el monto nace NULL», «R39: las tres FKs, con su política de borrado», «R46: crea `orden_incidente_evidencia`…» · `tests/unit/repositories/incidente-admin-repository.test.ts` › «R46/R50: la fila proyecta el monto como STRING y los paths CRUDOS del bucket» |
| **R40** | `…/orden-incidente-migration.test.ts` › bloque «DOWN — deja la base como estaba» (7 casos, incl. «migra `origen_tipo` con USING en LAS TRES tablas» y «suelta y recrea los SEIS índices, con su forma») · **round-trip real** §3 · **mutación P, verificada además contra Postgres** §4 |
| **R41** | `…/incidente-admin-repository.test.ts` › `it.each` «R41: desde `%s` crea el incidente y mueve la orden a `incidente`» (5 casos, uno por estado) · `tests/unit/services/incidente-admin-service.test.ts` › «R41: pasa los CINCO estados de origen y el destino, resueltos del catálogo» · `tests/integration/actions/incidentes-action.test.ts` › «un FormData válido llega al service…» |
| **R42** | `…/incidente-admin-repository.test.ts` › bloque «R42/R48 — el reporte se rechaza SIN efectos» (4 casos: no casa el WHERE → cero efectos; la pre-lectura exige los 5 estados + `deletedAt` + alcance; acceso total sin filtro; carrera) · `…/incidente-admin-service.test.ts` › «R42: si el repo rechaza la orden, se BORRAN las fotos ya subidas (cero huérfanas)» |
| **R43** | `…/incidente-admin-repository.test.ts` › «R43: el incidente NACE `solicitado` y con la causa y el motivo del reporte» y «R43: el reporte NO produce NINGÚN movimiento de dinero» |
| **R44** | `…/incidente-admin-repository.test.ts` › «R44: appendea con familia `incidente`, actor y el par (origen → incidente) real» (incluye que NO enlaza `gestion_orden_id`) · `tests/unit/repositories/orden-historial-cobertura.test.ts` › «feature 158/PR2: el camino del ADMIN aporta los puntos #25 (reporte) y #26 (reversión)» |
| **R45** | `tests/unit/types/incidente-schema.test.ts` › bloques «R45 — la causa es la MISMA lista CERRADA…» (7 casos, incl. «el conjunto ACEPTADO es exactamente el SEED») y «R45 — el motivo libre es OBLIGATORIO y APARTE de la causa» (4 casos) |
| **R46** | `…/incidente-schema.test.ts` › bloque «R46 (Q-B) — la evidencia es OBLIGATORIA 1..N en las TRES causas» (10 casos, incl. los `it.each` por causa) · `…/incidente-admin-repository.test.ts` › «R46: persiste las N evidencias con su índice» · `…/incidente-admin-service.test.ts` › bloque «R46 — la evidencia sale SOLO firmada, nunca el path crudo» (2 casos) y los 4 de compensación del bucket |
| **R47** | `…/incidente-admin-repository.test.ts` › bloque «R47 — a lo sumo UN incidente vivo por orden» (3 casos, incl. «un P2002 de OTRA constraint NO se disfraza de `duplicado`») · `…/incidente-admin-service.test.ts` › «R47: un segundo reporte vivo → conflict accionable, y también compensa el bucket» · `…/orden-incidente-migration.test.ts` › «R47: el índice ÚNICO PARCIAL … está presente» · **sonda REAL contra Postgres** §4 (4 casos) |
| **R48** | `…/incidente-admin-service.test.ts` › bloque «R48 — alcance por rol y por zona, resuelto SERVER-SIDE» (5 casos, incl. «un incidente fuera de alcance → `no_encontrada`, SIN revelar nada de la orden») · `…/incidente-admin-repository.test.ts` › bloque «R48/R49 — las lecturas van acotadas por alcance en el WHERE» (5 casos) |
| **R49** | `…/incidente-admin-service.test.ts` › bloque «R49 — dos colas» (2 casos). ⚠️ *La mitad de COMPONENTE (las dos `DataTable`) es **T2.8**.* |
| **R50** | `…/incidente-schema.test.ts` › bloque «R50/R55 — el monto de la aprobación es dinero válido» (16 casos) · `…/incidente-admin-service.test.ts` › «R50: un monto no positivo se rechaza en el service, sin tocar el repo» · `…/incidentes-action.test.ts` › `it.each` de 7 montos inválidos |
| **R51** | `…/incidente-admin-service.test.ts` › bloque **«R51 — QUIEN REPORTA NO APRUEBA (el doble control del dinero)»** (5 casos: no aprueba, no rechaza, no exime el acceso total, se comprueba ANTES que el monto, y otro admin SÍ puede) · `…/incidentes-action.test.ts` › «R51: el conflicto … llega al cliente con su mensaje». ⚠️ *La mitad de UI (acción deshabilitada con su motivo) es **T2.9**.* |
| **R52** | `…/incidente-admin-repository.test.ts` › bloque «R52/R53 — aprobar escribe el monto y emite UN egreso, en la MISMA tx» (9 casos, incl. **«el feed LEE de la base lo que la MISMA tx acaba de escribir»** con un monto distinto en el doble, y el orden escritura→lectura) · `…/wallet-indemnizacion-incidente-feed.test.ts` (19 casos) |
| **R53** | `…/incidente-admin-repository.test.ts` › «R53: reintentar sobre uno ya resuelto → `conflict` SIN tocar el feed», **«R53 (COMPORTAMIENTO)» ×2 + su control** · `tests/integration/db/wallet-idempotencia.test.ts` › «158/R53: el egreso del INCIDENTE del admin es idempotente por (orden_incidente, id)» |
| **R54** | `…/incidente-admin-repository.test.ts` › «R54: NO persiste monto y NO emite NINGÚN movimiento» · `…/incidente-admin-service.test.ts` › «R54: rechazar sin motivo → validation_error, sin tocar el repo» y el `it.each` de los 5 destinos · `…/incidentes-action.test.ts` › los 3 casos del motivo |
| **R55** | `…/incidente-schema.test.ts` › «R55: un monto NUMBER se rechaza» + las 11 formas inválidas · `…/incidente-admin-repository.test.ts` › «R52/R55: el monto se escribe como Decimal (money-safe), nunca como number» · `…/wallet-indemnizacion-incidente-feed.test.ts` › bloque «R52/R55 — money-safe de extremo a extremo» (5 casos) |
| **R56** | `…/incidente-admin-aislamiento.test.ts` › bloque «R56 — una orden NO puede acumular DOS egresos de indemnización pagados» (3 invariantes del grafo) · `…/wallet-idempotencia.test.ts` › «158/R56: dos incidentes de admin DISTINTOS no se deduplican entre sí» |
| **R57** | `…/incidente-admin-service.test.ts` › `it.each` «R57: si el historial dice `%s`, la orden vuelve EXACTAMENTE ahí» (5 casos, uno por origen) · `…/incidente-admin-repository.test.ts` › `it.each` «R57: la orden vuelve a `%s`, con la arista inversa declarada» (5 casos) |
| **R58** | `…/incidente-admin-service.test.ts` › «R58: sin fila de historial (origen null) → conflict SIN mover nada», `it.each` «R58: un origen fuera del conjunto cerrado (%s) → conflict, fallo CERRADO» (5 casos) y «R58: si el catálogo no resuelve el origen derivado → validation_error» |
| **R59** | `…/incidente-admin-service.test.ts` › «R59: un incidente APROBADO no se puede revertir — el dinero ya salió» (por rechazo Y por retracto), «R59: SÓLO el autor retracta», «R59: el RETRACTO del autor usa la MISMA derivación y NO lleva motivo» · `…/incidente-admin-repository.test.ts` › «R59: el RETRACTO del autor escribe lo mismo, con `motivoRechazo` null» · `…/incidente-schema.test.ts` › «R59: el RETRACTO no pide motivo» |
| **R60** | `…/incidente-admin-repository.test.ts` › «R60 (Q-K): el reporte NO toca `mensajero_asignado_id` ni `asignado_at`» (igualdad EXACTA de las claves de `data`) y el mismo assert dentro del `it.each` de la reversión · `…/incidente-admin-service.test.ts` › «R60: la reversión NO menciona `mensajeroAsignadoId` ni `asignadoAt` por ninguna parte» |
| **R61** | `tests/unit/domain/order-status-transiciones.guardia.test.ts` › «154/R16 + 158/R13/R61: desde incidente SÓLO son legales las 6 reversiones; el resto del catálogo sigue ilegal» (barrido de los 13 restantes) y **«158/R13/R61: las 6 salidas de `incidente` son de familia de REVERSIÓN, ninguna de negocio»** (11 familias prohibidas) · `…/connectividad.test.ts` › «154/R16 + 158/Q-D/R61: incidente es terminal, alcanzable y sus ÚNICAS salidas son las 6 reversiones» (igualdad exacta y ordenada) |
| **R62** | `…/guardia.test.ts` › «158/R62: las 10 aristas del camino del ADMIN están declaradas, con la familia `incidente`», «el mapa declara exactamente las aristas del inventario, ni una más», «los recuentos del inventario son 52 flujo / 50 pares / 2 creación» · `…/connectividad.test.ts` › «158/R57/R62: las entradas del admin y sus inversas son un conjunto SIMÉTRICO de 5» |
| **R63** | `…/incidente-admin-aislamiento.test.ts` › los `it.each` estructurales: los 4 módulos del admin NO tocan `gestion_orden`, `cierre_dia`, el libro del pago al mensajero ni el ledger por tienda; y los 8 módulos del mensajero NO conocen `orden_incidente` · + los casos del corte y del ranking |
| **R64** | `…/wallet-idempotencia.test.ts` › «158/R29/R64: los DOS egresos de indemnización coexisten (ninguno absorbe al otro)» · `tests/unit/guards/egreso-indemnizacion-emisores.test.ts` › «R29/R64: los dos emisores usan orígenes DISTINTOS» · `…/wallet-indemnizacion-incidente-feed.test.ts` › «R64: dos incidentes distintos producen movimientos con `origen_id` distinto» · **la suite completa en verde sin modificar ninguna expectativa del camino del mensajero** |
| **R29** *(deuda del PR 1, saldada aquí)* | `tests/unit/guards/egreso-indemnizacion-emisores.test.ts` (10 casos) › «R29: son EXACTAMENTE DOS emisores, uno por camino, y ningún tercero» y «R29/R64: … orígenes DISTINTOS» |

**Cobertura de F1B: 28 de 28 requisitos de I-M con test citado.** Dos (**R49** y **R51**) quedan
cubiertos **en su mitad de servidor**; su mitad visible es T2.8/T2.9 y está declarada arriba.

---

## 3. Round-trip real de la migración (Postgres local)

Ejecutado contra `localhost:5432`, base `ordenex` (verificado con `prisma migrate status`, que
imprime el host sin exponer la credencial). **Producción no se tocó.**

Estado de partida: **96/96** migraciones, «up to date», **67** filas en `orden`, **9** en
`gestion_orden`, **0** en las tres tablas de movimientos.

| dato | base (96 mig.) | tras UP | tras DOWN | tras 2.º UP |
| --- | --- | --- | --- | --- |
| valores de `wallet_origen_tipo` | 6 | **7** (+`orden_incidente`) | **6** | **7** |
| tabla `orden_incidente` | no existe | sí, RLS `true`, 0 policies | **no existe** | sí, RLS `true`, 0 policies |
| tabla `orden_incidente_evidencia` | no existe | sí, RLS `true`, 0 policies | **no existe** | sí, RLS `true`, 0 policies |
| índice `orden_incidente_orden_vivo_uq` | — | `… (orden_id) WHERE (estado <> 'rechazado'::cierre_estado)` | **no existe** | idéntico |
| FKs de `orden_incidente` | — | `orden`=RESTRICT, `reportado_por`=RESTRICT, `resuelto_por`=SET NULL | — | idénticas |
| los 6 índices de `origen_tipo` (3 tablas) | presentes | presentes | **presentes, mismos nombres y predicados** | presentes |
| `wallet_movimiento_origen_categoria_uq` | `… WHERE (origen_id IS NOT NULL)` | idéntico | **idéntico** | idéntico |
| **checksum de `orden`** (todas las columnas) | `aaa74f44…` | `aaa74f44…` | **`aaa74f44…`** | `aaa74f44…` |
| **checksum de `gestion_orden`** | `a22da141…` | `a22da141…` | **`a22da141…`** | `a22da141…` |
| migraciones aplicadas | 96 | 97 | **96** | 97 |

Comandos: `npx prisma migrate deploy` → `pnpm run db:rollback` → `npx prisma migrate deploy`.
`prisma migrate status` al final: **«Database schema is up to date!»**, 97 migraciones, sin drift.

### 3.1 El ORDEN de los dos `down.sql` — verificado, no supuesto

La 158 aterriza en DOS migraciones y sus `down` **no son independientes**: `orden_incidente.causa`
depende de `gestion_causa_incidente`, que crea la migración del PR 1. Se comprobó contra la base,
en transacciones revertidas:

| caso | resultado |
| --- | --- |
| SÓLO el `down` del MENSAJERO, con la del ADMIN aplicada | **ABORTA** en la sentencia 3/15: «no se puede eliminar tipo `gestion_causa_incidente` porque otros objetos dependen de él» |
| ADMIN y luego MENSAJERO (orden inverso al de aplicación) | **las dos corren completas** (20 + 15 sentencias) |

**Hallazgo colateral, declarado porque puede morder a otro:** `scripts/db-rollback.ts` elige la
última carpeta **por NOMBRE**, no la última migración **APLICADA**. Aquí coinciden (el timestamp
del admin es mayor), así que `pnpm run db:rollback` hace lo correcto — pero ejecutarlo dos veces
seguidas revierte **la misma** migración dos veces en vez de bajar dos escalones. No lo introduce
esta feature y no se arregla aquí; se escribe para que nadie lo descubra al revertir en caliente.

---

## 4. Verificación por mutación

Todas se aplicaron **en memoria** (`git checkout --` tras cada una; `git status` limpio al
terminar). **18 mutaciones, 18 discriminan.**

### 4.1 Precondición del `down.sql` y el índice parcial, contra Postgres REAL

Sonda que aplica el `down.sql` sentencia a sentencia dentro de una transacción revertida, tras
sembrar el caso. **Cierra desde el principio la limitación que el PR 1 tuvo que declarar** (las
tablas de movimientos están vacías en local): aquí se insertan filas reales.

| caso | resultado | qué demuestra |
| --- | --- | --- |
| control: sin filas con el valor nuevo | **DOWN CORRIÓ COMPLETO** (20 sentencias) | el arnés no está siempre en rojo |
| fila real en `wallet_movimiento` con `origen_tipo = 'orden_incidente'` | **ABORTA en la sentencia 11/20** (`ALTER TABLE "wallet_movimiento" ALTER COLUMN "origen_tipo"`) | la precondición discrimina y falla **exactamente** donde el archivo dice |
| fila real en `wallet_tienda_movimiento` | **ABORTA en la 12/20** | ídem para la 2.ª tabla |
| fila real en `pago_mensajero_movimiento` | **ABORTA en la 13/20** | ídem para la 3.ª — las TRES importan |
| **R47**: 2.º incidente `solicitado` sobre la misma orden | **RECHAZADO** por `orden_incidente_orden_vivo_uq` | el índice parcial es lo que no se puede saltar en una carrera |
| **R47**: dos `rechazado` sobre la misma orden | **ACEPTADOS** | el parcial los exime, como pide el diseño |
| **R47**: un `solicitado` nuevo tras dos rechazados | **ACEPTADO** | se puede re-reportar tras un rechazo |
| **R47**: un `aprobado` junto a un `solicitado` | **RECHAZADO** | el predicado `<> 'rechazado'` cubre también `aprobado` |

### 4.2 Mutaciones de código (18, todas discriminan)

| # | mutación | resultado |
| --- | --- | --- |
| A | se retira la arista **#48** (`en_bodega_central → incidente`) | **11 casos rojos** en 3 archivos |
| B | se retira la inversa **#54** | **12 casos rojos** en 5 archivos |
| C | se desactiva **R51** (quien reporta no aprueba) | **4 casos rojos**, los cuatro del bloque de R51 |
| D | el feed emite sin exigir `estado = 'aprobado'` | **3 casos rojos** (tras reforzar; ver §4.3) |
| E | `resolver` deja de guardar por `estado = 'solicitado'` | **3 casos rojos** (tras reforzar; ver §4.3) |
| F | el `updateMany` del reporte usa `{ in: los 5 }` en vez del estatus exacto (anti-TOCTOU) | **5 casos rojos**, uno por estado de origen |
| G | el append escribe `origen_tipo = "gestion"` en vez de `incidente` | **6 casos rojos** (el reporte y las 5 reversiones) |
| H | el reporte limpia `mensajero_asignado_id`/`asignado_at` (viola Q-K/R60) | 1 caso rojo: el de R60 |
| I | el service no compensa el bucket cuando el repo rechaza | 1 caso rojo: «cero huérfanas» |
| J | la reversión deja de validar el conjunto CERRADO (R58) | **5 casos rojos**, uno por origen ilegítimo |
| K | aparece un **tercer** emisor de `egreso_indemnizacion` en `lib/` | 1 caso rojo (igualdad, no un `some()` permisivo) |
| L | el `adminSatelite` pasa a tener alcance total | 1 caso rojo |
| M | `findByAlcance` filtra por el AUTOR en vez de por la zona de la ORDEN | 1 caso rojo |
| N | el repo del admin escribe además una fila de `gestion_orden` (la alternativa §9.7) | 1 caso rojo: el barrido estructural del aislamiento |
| P | el `down.sql` «olvida» una de las TRES tablas | 1 caso rojo · **y contra Postgres el DOWN ABORTA** en `DROP TYPE "wallet_origen_tipo_old"` («otros objetos dependen de él»), que es exactamente lo que §12.2 advertía |
| Q | el predicado del índice parcial pasa a `= 'solicitado'` | 1 caso rojo |
| R | el manejo de P2002 se amplía a CUALQUIER constraint | 1 caso rojo |
| S | la evidencia del reporte pasa a opcional (viola Q-B) | **4 casos rojos** en 2 archivos |
| T | el reporte no appendea al historial (R44) | 1 caso rojo |

### 4.3 Hallazgo de las mutaciones D y E, dicho porque cambió el trabajo

En su primera pasada, **D** y **E** pusieron rojo **UN** solo caso cada una, y en las dos era de
**FORMA** (el shape del `where`), no de comportamiento — la misma señal débil que el PR 1
encontró con su mutación K. Un doble que ignora el `where` no puede distinguir «la guardia está»
de «la guardia se lee bien».

Se añadieron dobles que **HONRAN el `where`**, como la base:

- el feed gana dos casos que exigen que un incidente `solicitado`/`rechazado` **con monto
  guardado** no emita nada;
- el repo gana dos que exigen que sobre un incidente ya resuelto **no salga un segundo egreso**.

Cada bloque lleva su **caso de CONTROL** con el mismo doble (un `aprobado`/`solicitado` que sí
pasa), para que los casos nuevos no puedan pasar por la razón equivocada. Las mismas mutaciones
ponen ahora **3** casos rojos cada una, dos de ellos sobre el dinero.

---

## 5. Tests de OTRAS features que esta fase rompió

**Ninguno se borró ni se debilitó.** Regla aplicada: si un test protegía un invariante y la
decisión del humano cambió el invariante, el test sigue protegiendo el invariante **nuevo** con la
misma fuerza.

| archivo (feature) | afirmaba | ahora afirma |
| --- | --- | --- |
| `tests/unit/domain/order-status-transiciones.guardia.test.ts` (140/154/158) | **«las 10 aristas del camino del ADMIN NO están declaradas todavía»** (§15.2); desde `incidente` sólo era legal #53; 42/40 | **INVERTIDO**: las 10 están, en las dos direcciones y con su familia. El barrido de salidas ilegales conserva su forma y pasa de eximir 1 a eximir 6, con los 13 restantes lanzando uno a uno. 52/50. **+1 caso NUEVO**: las 6 salidas son de familia de REVERSIÓN y ninguna de las 11 familias de negocio que R13 prohíbe aparece — que es lo que la guardia por par NO puede distinguir |
| `…/order-status-transiciones.connectividad.test.ts` (140/154/158) | igualdad exacta con la lista de UNA salida | igualdad exacta con las SEIS, en orden, y `salidas === 6`. **+1 caso NUEVO** de SIMETRÍA entrada/inversa |
| `tests/unit/types/criterio-intento-entrega.test.ts` (160) | «la única salida de `incidente` es la reversión `deshacer_gestion`» | las SEIS salidas son reversiones, y **ninguna** lleva a `devuelta` ni a `reprogramada` — que es lo que dispararía un `cobroRechazado` real. Mide lo mismo, sobre un conjunto mayor |
| `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` (140) | descuento nombrado de **3** aristas | **13** (las 3 previas + las 10 del admin), con la razón escrita |
| `tests/unit/repositories/orden-historial-cobertura.test.ts` (49/154/158) | 24 puntos; **«cada familia aparece UNA sola vez»**; cobertura por lista de puntos | 26 puntos (#25 reporte, #26 reversión); la regla pasa a **«una familia puede tener varios puntos SÓLO si está declarada en `FAMILIAS_CON_VARIOS_PUNTOS` con su recuento EXACTO»** (comparación por igualdad: un duplicado no declarado sigue poniéndolo rojo); la cobertura del enum se compara por CONJUNTO de familias. **+1 caso NUEVO** que fija dónde viven los dos puntos del admin |
| `tests/unit/guards/egreso-indemnizacion-emisores.test.ts` (158/PR1) | **«en ESTE PR hay UN emisor; el 2.º debe sumarse aquí cuando llegue»** | **INVERTIDO y COBRADO**: «son EXACTAMENTE DOS, uno por camino, y ningún tercero». **+1 caso NUEVO**: los dos usan `origen_tipo` distinto y cada uno lo declara en su código |
| `tests/fixtures/inventario-transiciones-140.ts` (140) | 42/40, con el pendiente de las 10 escrito | 52/50, con las 10 filas transcritas A MANO y la cadena aritmética completa |
| `tests/integration/db/wallet-idempotencia.test.ts` (42) | idempotencia del egreso por cierre | **+3 casos**: idempotencia del egreso del incidente, coexistencia de los DOS egresos con orígenes distintos, y dos incidentes distintos sin deduplicar |

**Ningún archivo perdió casos. Seis ganaron.**

---

## 6. Lo que NO se hizo, con su razón

### Tasks NO marcadas

- **T2.7–T2.10 (Fase 2B, frontend del ADMIN)** — fuera de alcance por instrucción explícita: van
  en otro subagente. En concreto y a propósito: **no** existe
  `app/(app)/ordenes/_components/ReportarIncidenteModal.tsx`, **no** existe
  `app/(app)/incidentes/`, y **no** se tocó `lib/auth/menu-visibility.ts`. Las Server Actions ya
  están listas y probadas para cuando lleguen.
- **T3.1 / T3.2 (pruebas de humo manuales)** — exigen levantar la app y operar de verdad; la del
  ADMIN (T3.2) además necesita la UI de la Fase 2B. Marcarlas sería fingir una verificación.
- **T3.3 (round-trip de las DOS migraciones)** — su parte técnica **está hecha y documentada**
  (§3, incluido el ORDEN de los dos `down` verificado contra Postgres). La casilla sigue sin
  marcar porque su cláusula «con los datos de las pruebas de humo BORRADOS antes» depende de
  T3.1/T3.2. Queda escrito en `tasks.md`.
- **T3.4 / T3.5** — del leader (estado en `feature_list.json`, `current.md`, follow-ups).

### Requisitos cubiertos SÓLO en su mitad de servidor

- **R49** (las dos colas) — el service las produce y hay test; las dos `DataTable` son **T2.8**.
- **R51** (quien reporta no aprueba) — el **servidor** lo rechaza con 5 casos de test, que es la
  mitad que importa; la acción deshabilitada con su motivo visible es **T2.9**. El diseño pide
  explícitamente que la regla esté **en los dos lados**, y aquí está el lado que no se puede
  saltar.

### Defectos encontrados en el PR 1 (declarados, NO arreglados aquí)

Ninguno. Se revisó lo heredado al integrarlo y el camino del mensajero se comporta como su
bitácora dice. Lo único que se **tocó** de él es lo que esta fase obliga: exportar
`evidenciasSchema` (para reusar los límites en vez de copiarlos) y actualizar los 6 tests +
1 fixture que el mapa nuevo invalida.

### Cambios fuera de `lib/` y `db/`, y por qué

**Uno solo:** `app/(app)/wallet/_components/wallet-labels.ts` gana la clave `orden_incidente` en
`ORIGEN_LABEL`. Es un `Record<WalletOrigenTipo, string>` completo: **el build no compila** sin
ella. Es exactamente la misma red de exhaustividad por la que el PR 1 tocó `CATEGORIA_LABEL`. La
etiqueta sigue la forma de su hermana `gestion_orden` («Gestión de orden» → «Incidente de
orden»): nombra la ENTIDAD que origina el movimiento, no la acción.

### Supuestos y decisiones tomadas donde el spec no llegaba

- **El estado final de un incidente RETRACTADO es `rechazado`.** El design dice «misma escritura
  que el rechazo pero sin motivo de aprobador» y no nombra el estado. Se eligió `rechazado`
  porque es el único que (a) existe en `CierreEstado` sin inventar un valor, y (b) sale del
  índice único parcial, que es lo que permite **re-reportar** la orden después — que es
  precisamente el sentido de retractarse. `motivo_rechazo` queda `null`, y eso distingue un
  retracto de un rechazo en la auditoría sin columna nueva. Hay test.
- **`retractar` es el espejo EXACTO de R51.** El design no dice qué pasa si un tercero intenta
  retractar. Se eligió `conflict` con mensaje propio («sólo quien reportó puede retractarlo; otro
  administrador debe rechazarlo»), no `forbidden`: no es un problema de permisos —ese admin sí
  puede resolverlo— es que le corresponde el otro verbo. Hay test.
- **El DTO NO expone el id del autor**; expone `esPropio`, calculado en el servidor. Así la UI no
  compara ids ni necesita conocer al autor para cumplir su mitad de R51, y R48 no depende de que
  el cliente se porte bien. Hay test.
- **`findByAlcance` filtra por la zona de la ORDEN, no por la del autor.** Un maestro puede
  reportar sobre una orden de cualquier zona; si el filtro fuera por autor, el `adminSatelite`
  vería incidentes de órdenes ajenas reportados por él y no vería los de su zona reportados por
  otro. Hay test **y** una mutación que lo caza.
- **El bucket de evidencias es el MISMO que el de gestión** (`gestionConfig.EVIDENCIA_BUCKET`), y
  los paths llevan el prefijo `incidente-`. Un bucket nuevo habría exigido configuración y
  permisos nuevos para el mismo tipo de objeto y el mismo TTL de firma.

### Preguntas abiertas que deja esta fase

1. **Q-J sigue abierta** (¿se entera el mensajero asignado?). Ahora es **real y observable**: un
   admin puede reportar un incidente sobre una orden en `por_recoger` ya asignada, y esa orden
   desaparece de «Mis asignaciones» **sin aviso** (Q-K: no se toca la asignación, así que el
   mensajero la sigue teniendo asignada pero el estado la saca de sus listas). El diseño lo dejó
   como follow-up recomendado y esta fase no lo cierra.
2. **`scripts/db-rollback.ts` elige por NOMBRE de carpeta, no por migración aplicada** (§3.1). No
   lo introduce esta feature; conviene saberlo antes de revertir dos escalones en caliente.
3. **`catalogoCache` nunca se invalida** (aviso heredado de la 154). Esta migración **no** hace
   crecer `order_status`, así que el riesgo no aumenta — pero el orden migrar-antes-de-desplegar
   sigue importando, y ahora hay dos migraciones que deben aplicarse **en orden**.
4. **El E2E sigue sin harness.** El review del PR 1 concedió la dispensa y la declaró **NO
   extensible a este PR**, que añade el segundo productor de dinero. Este PR **no** trae E2E: no
   hay harness que lo ejecute (`playwright.config.ts` existe pero ningún gate lo corre), así que
   una spec nueva sería un archivo que nadie ejecuta. **Queda como hallazgo abierto para el
   reviewer**, no como algo resuelto.

---

## 7. Salida real de la verificación

```
$ ./init.sh
== Arnes SDD :: init ==
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=2)
✓ specs presentes para features sdd en vuelo
-> pnpm run typecheck
✓ typecheck paso
-> pnpm run lint
✖ 19 problems (0 errors, 19 warnings)
✓ lint paso
-> pnpm run test
 Test Files  624 passed (624)
      Tests  7228 passed (7228)
   Duration  159.51s
✓ test paso
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

```
$ pnpm exec vitest run tests/integration/db
 Test Files  73 passed (73)
      Tests  742 passed (742)
```

```
$ npx prisma migrate status
Datasource "db": PostgreSQL database "ordenex", schema "public" at "localhost:5432"
97 migrations found in prisma/migrations
Database schema is up to date!
```

Baseline de la rama antes de empezar (cierre del PR 1): **617 archivos / 6973 tests**, lint
0 errores / 19 warnings.
**Delta: +7 archivos de test, +255 tests, 0 fallos, 0 warnings nuevos.**

---

## 8. Archivos creados / modificados

### Creados (18)

```
db/migrations/20260730130000_orden_incidente/migration.sql
db/migrations/20260730130000_orden_incidente/down.sql
lib/types/incidente.ts
lib/interfaces/repositories/IIncidenteAdminRepository.ts
lib/interfaces/services/IIncidenteAdminService.ts
lib/interfaces/services/IWalletIndemnizacionIncidenteFeedService.ts
lib/repositories/IncidenteAdminRepository.ts
lib/services/IncidenteAdminService.ts
lib/services/WalletIndemnizacionIncidenteFeedService.ts
lib/services/mensajes-incidente-admin.ts
lib/actions/incidentes.ts
tests/integration/db/orden-incidente-migration.test.ts
tests/integration/actions/incidentes-action.test.ts
tests/unit/types/incidente-schema.test.ts
tests/unit/repositories/incidente-admin-repository.test.ts
tests/unit/services/incidente-admin-service.test.ts
tests/unit/services/wallet-indemnizacion-incidente-feed.test.ts
tests/unit/guards/incidente-admin-aislamiento.test.ts
```

### Modificados — producción (5)

```
db/schema.prisma
lib/types/wallet.ts                                    ← WALLET_ORIGEN_TIPO_SEED
lib/types/order-status-transiciones.ts                 ← las 10 aristas
lib/types/gestion-orden.ts                             ← exporta `evidenciasSchema`
app/(app)/wallet/_components/wallet-labels.ts          ← ORIGEN_LABEL (exhaustividad, §6)
```

### Modificados — tests y fixtures (8)

```
tests/fixtures/inventario-transiciones-140.ts
tests/unit/domain/order-status-transiciones.connectividad.test.ts
tests/unit/domain/order-status-transiciones.guardia.test.ts
tests/unit/types/criterio-intento-entrega.test.ts
tests/unit/repositories/registrar-cambio-estado.guardia.test.ts
tests/unit/repositories/orden-historial-cobertura.test.ts
tests/unit/guards/egreso-indemnizacion-emisores.test.ts
tests/integration/db/wallet-idempotencia.test.ts
```

---

## 9. Commits

```
636390f  feat(158…): tabla propia del incidente del admin y su origen de wallet   (T1.19-T1.22)
cc696f8  feat(158…): declara las 10 aristas del camino del admin (#48-#52, #54-#58) (T1.23/T1.24)
291da10  feat(158…): borde, repo, service y actions del incidente del admin        (T1.25-T1.31)
b5ebe47  test(158…): cobertura del camino del admin y su aislamiento               (tests + T1.30)
e94aaee  test(158…): refuerza por mutacion las dos guardias que solo median forma  (§4.3)
```

**No se hizo `git push` ni se abrió PR**: lo decide el humano.
