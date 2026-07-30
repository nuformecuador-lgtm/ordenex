# Feature 158 — Implementación backend, camino del MENSAJERO (Fase 1, T1.1–T1.18)

> Rama `feature/158-incidente-indemnizacion`, worktree `.claude/worktrees/lote-135`.
> Alcance: **T1.1 a T1.18** — camino del **MENSAJERO** (R1–R36), que es el **PR 1 de 2**
> decidido por el humano (Q-L).
> **NO se tocó** la Fase 1B (T1.19–T1.32, camino del ADMIN) ni la Fase 2 (frontend, T2.1–T2.6).

## Veredicto

**Fase 1 completa y verde.** `./init.sh` OK: **610 archivos / 6829 tests / 0 fallos**, lint
**0 errores / 19 warnings** (los mismos 19 del baseline), todas las migraciones con `down.sql`.
`tests/integration/db` completo: **72 archivos / 715 tests / 0 fallos**. Round-trip real de la
migración contra Postgres local ejecutado **dos veces** (up→down→up), con verificación por
mutación de la precondición del `down`.

---

## 1. Qué se hizo, por task

### T1.1 — Migración `20260730120000_incidente_indemnizacion` ✅

`db/migrations/20260730120000_incidente_indemnizacion/{migration.sql,down.sql}`.

**UP** (aditivo, sin datos, sin RLS, sin índices):

1. `CREATE TYPE "gestion_causa_incidente" AS ENUM ('danado', 'perdido', 'robado')`
2. `ALTER TYPE "gestion_resultado" ADD VALUE IF NOT EXISTS 'incidente'`
3. `ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'egreso_indemnizacion'`
4. `ALTER TABLE "gestion_orden" ADD COLUMN "causa_incidente" "gestion_causa_incidente"`
5. `ALTER TABLE "gestion_orden" ADD COLUMN "indemnizacion" DECIMAL(12,2)`

**DOWN** (espejo exacto, en orden inverso): suelta las dos columnas, dropea el enum nuevo,
recrea `wallet_movimiento_categoria` con los **14** previos (con drop/recreate de los DOS
índices que referencian `categoria`) y recrea `gestion_resultado` con los **4** previos. Los
dos con `USING` cast. **No toca RLS ni policies** y **no reescribe ningún `down.sql` previo**
(Q-F).

### T1.2 — `db/schema.prisma` ✅

`GestionResultado + incidente`, `WalletMovimientoCategoria + egreso_indemnizacion`, enum nuevo
`GestionCausaIncidente` y las dos columnas de `GestionOrden`. El comentario del enum nuevo deja
escrito **por qué va en español** aunque `gestion_causa_devolucion` (73) esté en inglés, con la
misma fórmula «decisión consciente, no abrir tickets de consistencia» — **en las dos
direcciones** (ni castellanizar la 73, ni traducir esta). `prisma migrate status`: sin drift.

### T1.3 / T1.4 — SEED y tipos ✅

`WALLET_MOVIMIENTO_CATEGORIA_SEED + egreso_indemnizacion` y `lib/types/causa-incidente.ts`
calcado de `causa-devolucion.ts` (SEED literal + `satisfies` + `_EnsureExhaustive`). Doble
candado intacto, verificado por mutación (ver §4).

### T1.5 — Test estático de la migración ✅

`tests/integration/db/incidente-indemnizacion-migration.test.ts` (patrón
`wallet-egreso-migration.test.ts`). Además de la forma del UP y del DOWN, incluye dos casos de
**Q-F**: que el down de la 45 sigue listando sus 12 valores punto-en-el-tiempo, y que **ningún**
`down.sql` previo recrea `gestion_resultado` (barrido real del árbol, no una afirmación de
prosa).

### T1.6 / T1.6b — Mapa de estados y la deuda de §14 ✅

- **#53** `incidente → en_reparto` vía `deshacer_gestion` rol `mensajero` (Q-D).
- **#44** cambia su `via` de `gestion` a `incidente` (Q-G).
- Comentario de `ESTADOS_TERMINALES` reescrito: la reversión queda **fechada** (2026-07-30) y
  la decisión de la 154 **no se borra**, se acota a lo que sigue vigente.
- `ESTADOS_ESPERADOS.incidente = ["incidente"]`.
- **Numeración**: se toma el **#53** y se saltan #48–#52 y #54–#58, reservados para el camino
  del admin. Hay un test que **fija** que esas diez NO están declaradas todavía, para que
  adelantarlas sea una decisión y no una inercia.

### T1.6c — La familia `incidente` gradúa ✅

`FAMILIAS_SIN_PRODUCTOR` pasa de 2 a 1 (`recoleccion_tienda`) y `incidente` entra en
`PUNTOS_DE_ESCRITURA` como punto **#24** con su símbolo real
(`GestionOrdenRepository.crearGestionYTransicionar`). Comparte símbolo con el #9 y eso es
correcto: el mapa es de **familias**, no de símbolos, y ya había precedente (#20/#22 son los dos
`resolverCierre`).

### T1.7 — Borde zod ✅

Quinta variante `incidente` en `gestionarUnionSchema`: `causaIncidente` (lista cerrada de 3),
`motivo` obligatorio y `evidencias` reusando `evidenciasSchema` (**1..N obligatorias en las TRES
causas**, Q-B). Sin `montoRecibido`/`metodoPago`: no hay recaudo, y al ser
`discriminatedUnion` un cliente no los puede colar.

### T1.8 — Service, repo y Server Action ✅

`case "incidente"` en `buildGestionData`, alta de `incidente` en la lista de resultados que
suben evidencia, causa persistida en su columna propia dentro del MISMO INSERT, y el append de
la transición con `origen_tipo = incidente` (Q-G). El borde de la action lee `causaIncidente`
del `FormData` y arma la rama. **Sin tocar** guardias, bloqueo 1-a-1 ni compensación de Storage:
ya eran genéricas.

### T1.9 — «El incidente no mueve dinero» ✅

`tests/unit/utils/incidente-no-mueve-dinero.test.ts` sobre `pagoPorResultado`,
`ingresoBodegaPorResultado` y `derivarIngresoOrden`, con tarifas de valor **alto** a propósito
(con tarifas en cero el test pasaría por la razón equivocada) y un **control de discriminación**
por función.

### T1.10 — `CierreGrupos` de 5 claves ✅

Los tres servicios que construyen `CierreGrupos` clasifican `incidente`. Tests: el
`updateMany` que vincula al cierre **no filtra por resultado** (y hay caso que exige que siga sin
hacerlo), la orden recibe su fila de `cierre_detail`, el snapshot de dinero es 0.00, y el grupo
propio aparece en el detalle del mensajero **y** en el del admin.

### T1.11 — Contrato de entrada ✅

`aprobarCierreSchema` gana `indemnizaciones[]` con `montoPositivoSchema`. `.default([])` lo hace
retrocompatible con el contrato de la 38 (R36).

### T1.12 — Guardias de cobertura EXACTA ✅

`CierresAdminService.aprobarCierre` valida, **antes de tocar el repo**, que el conjunto de
`gestionId` recibidos sea **igual** al de gestiones `incidente` del cierre, leídas dentro del
alcance (nuevo método de repo `findGestionesIncidenteDelCierre`, con el alcance en el WHERE por
la relación al cierre). Falta / sobra / duplicado → `validation_error` **por gestión**.

### T1.13 — `WalletIndemnizacionFeedService` ✅

Hermano de `WalletMensajeroFeedService`, con su interfaz en `lib/interfaces/services/`. **No
recibe el monto por parámetro**: lee de la misma `tx` la suma de `gestion_orden.indemnizacion` de
las gestiones `incidente` del cierre. Suma 0 → lista vacía (R27).

### T1.14 — Escritura y emisión en la MISMA transacción ✅

`ResolverCierreInput.indemnizaciones` (patrón de `liberacionSinGestionar`/`devolucionRechazadas`).
Dentro de la `tx`, sólo en la rama `aprobado` y **antes** de los feeds: `updateMany` guardado por
`(id, cierreId, resultado)` por cada monto, `throw IndemnizacionNoAplicableError` si algún
`count !== 1`. Después de 42/43/44, el feed y `crearMovimientos` con `skipDuplicates`. Inyección
del feed en el composition root de `lib/actions/cierres-admin.ts`.

### T1.15 — Guard estructural de emisores ✅

`tests/unit/guards/egreso-indemnizacion-emisores.test.ts`. Censa por **EMISIÓN**
(`categoria: "egreso_indemnizacion"`), no por mención del literal — la primera versión censaba
el literal suelto y marcaba comentarios como emisores, lo que habría hecho el guard
inutilizable. Comparación de **igualdad** sobre una lista explícita, y un caso que fija que hoy
hay **UNO** y que el segundo (camino del admin) debe sumarse cuando llegue.

### T1.16 — Desglose de la wallet (backend) ✅

`indemnizacion` en `DesgloseEgresosAgregado`, en `agregarPorCategoria`, en `DesgloseEgresosDTO` y
en el `total` de `verDesgloseEgresos` (suma con `Prisma.Decimal`).

### T1.17 — No reversable ✅

Test de que la reversa de la 45 (`origen_tipo = "gasto"`) rechaza el egreso de indemnización
(`cierre_dia`), **sin haber tocado `WalletEgresoService`** — y un caso que afirma justamente eso,
porque el invariante hoy sale de una condición escrita para otra feature.

### T1.18 — Cierre de fase ✅

`./init.sh` verde, `tests/integration/db` completo verde, mapa R→test escrito aquí.

---

## 2. Mapa R → test (R1–R36)

> Rutas relativas a la raíz del repo. Cuando un requisito tiene varios tests, se citan todos.

| R | Test(s) |
| --- | --- |
| **R1** | `tests/integration/db/incidente-indemnizacion-migration.test.ts` › «R1: ALTER TYPE ADD VALUE IF NOT EXISTS 'incidente'…» · `tests/unit/services/mis-asignaciones-incidente.test.ts` › «R6: `incidente` → UNA llamada al repo…» (fija el mapeo 1:1 resultado→estado por nombre) |
| **R2** | `…/incidente-indemnizacion-migration.test.ts` › «R2: ALTER TYPE ADD VALUE IF NOT EXISTS 'egreso_indemnizacion'…» y «R2/R3: WALLET_MOVIMIENTO_CATEGORIA_SEED… conserva las 14 previas» |
| **R3** | `…/incidente-indemnizacion-migration.test.ts` › «R2/R3: …SEED contiene egreso_indemnizacion», «R9 (Q-B): CAUSA_INCIDENTE_SEED es la lista CERRADA…», «el SEED de causa y el enum del SQL declaran EXACTAMENTE los mismos 3 valores» · **mutación F** (quitar un valor rompe el BUILD) |
| **R4** | `…/incidente-indemnizacion-migration.test.ts` › bloque «DOWN — recrea los dos enums sin los valores nuevos» (5 casos) + «R4: documenta la PRECONDICIÓN» · **round-trip real** §3 · **mutación de la precondición** §4 |
| **R5** | `tests/unit/guards/incidente-exhaustividad.test.ts` (8 casos: `ESTADOS_ESPERADOS`, `buildGestionData` sin `default`, los tres `CierreGrupos`, `CATEGORIA_LABEL` completo, etiquetas de los dos detalles, sin `as any`/`ts-ignore`) |
| **R6** | `tests/unit/services/mis-asignaciones-incidente.test.ts` › bloque «R6 — la gestión y la transición viajan en UNA sola transacción» (3 casos) |
| **R7** | `…/mis-asignaciones-incidente.test.ts` › bloque «R7 — el reporte se rechaza SIN efectos…» (6 casos: estado ≠ `en_reparto` ×4, orden ajena, orden borrada, mensajero bloqueado, rol, otra orden activa) |
| **R8** | `tests/unit/repositories/gestion-orden-repository.test.ts` › «158/R8/Q-G: el historial de la transición usa la familia `incidente`, NO `gestion`» · `tests/unit/repositories/orden-historial-cobertura.test.ts` › «feature 158/Q-G: `incidente` tiene productor (#24)…» |
| **R9** | `tests/unit/types/gestion-orden-causa-incidente.test.ts` › bloque «R9 — la causa es una lista CERRADA de 3 valores en español» (5 casos) · `…/mis-asignaciones-incidente.test.ts` › «R9: la causa `%s` viaja en `GestionOrdenData.causaIncidente`» · `tests/unit/repositories/gestion-orden-repository.test.ts` › «158/R9: el INSERT… lleva la causa en su columna propia» |
| **R10** | `…/gestion-orden-causa-incidente.test.ts` › bloque «R10 (Q-B) — la evidencia es OBLIGATORIA en las TRES causas» (5 casos, incl. **«`perdido` y `robado` NO están exentos de la foto»**) · `…/mis-asignaciones-incidente.test.ts` › bloque «R10 — las 1..N evidencias se suben y se persisten» (4 casos, incl. compensación de Storage) · `tests/unit/repositories/gestion-orden-evidencia.test.ts` › «158/R10: persiste las N filas hijas y la portada…» |
| **R11** | `…/gestion-orden-causa-incidente.test.ts` › bloque «R11 — el motivo libre sigue obligatorio y APARTE de la causa» (4 casos) · `…/mis-asignaciones-incidente.test.ts` › «R11: el motivo emitido es EXACTAMENTE el de entrada…» |
| **R12** | ⚠️ **SIN test en F1 — es frontend.** El gate de verificación de guía vive en `GestionarOrdenPanel` (`VerificarGuiaGate`). Lo cubre **T2.1**. Ver §6. |
| **R13** | `tests/unit/domain/order-status-transiciones.guardia.test.ts` › «154/R16 + 158/R13: desde `incidente` SOLO es legal el deshacer (#53); el resto del catálogo sigue ilegal» (barrido de los 18 destinos restantes) + «158/R13: %s NO puede sacar una orden de `incidente`» (`it.each` con las 10 vías que R13 nombra) · `tests/unit/services/cierre-dia-service.test.ts` › «R13/R14: si la orden YA NO está en `incidente`, el deshacer da conflict» (6 estados) |
| **R14** | `tests/unit/services/cierre-dia-service.test.ts` › bloque «Feature 158 · deshacerGestion de un `incidente`» › «R14: … SE PUEDE deshacer», «R14: el destino es `en_reparto` … y REPONE la asignación al autor», «R14: el deshacer… NO mueve dinero» · `tests/unit/domain/order-status-transiciones.connectividad.test.ts` › «154/R16 + 158/Q-D: … su ÚNICA salida es el deshacer» |
| **R15** | `…/cierre-dia-service.test.ts` › «R15: gestión `incidente` YA vinculada a un cierre → conflict accionable», «R15: quien NO es el mensajero autor → forbidden, sin revelar NADA», «R15: un rol que no es mensajero tampoco puede deshacer» |
| **R16** | `tests/unit/repositories/cierre-dia-repository.test.ts` › bloque «Feature 158/R16 — crearCierre vincula también las gestiones `incidente`» (3 casos) · `…/cierre-dia-service.test.ts` › «R16: un día SOLO con incidentes se puede cerrar» |
| **R17** | `tests/unit/utils/incidente-no-mueve-dinero.test.ts` (7 casos) · `…/cierre-dia-service.test.ts` › «R17: un `incidente` no aporta pago… ni ingreso… ni totales» y «R17: mezclado con una entrega, no altera el pago de la entrega» · `tests/unit/services/cierres-admin-service.test.ts` › «R17: un incidente NO aporta ingreso de Ordenex a los totales» · `…/cierre-dia-repository.test.ts` › «R17: el snapshot de dinero de un `incidente` es 0.00» |
| **R18** | `…/cierre-dia-service.test.ts` › «R18: el `incidente` cae en su grupo PROPIO…» · `tests/unit/services/cierres-admin-service.test.ts` › «R18: la gestión `incidente` cae en `grupos.incidente` y no se mezcla». *(Los tests de COMPONENTE de los dos detalles son T2.2/T2.3.)* |
| **R19** | `tests/unit/services/cierres-admin-indemnizacion.test.ts` › bloque «R19/R20 — falta el monto de alguna gestión `incidente`» (2 casos) y «R19/R22 — con cobertura EXACTA la aprobación procede» (2 casos) |
| **R20** | `tests/unit/types/cierres-admin-indemnizacion-schema.test.ts` › bloque «R20/R24 — montos inválidos» (11 casos `it.each` + number + ausente + índice del error) · `…/cierres-admin-indemnizacion.test.ts` (service) |
| **R21** | `…/cierres-admin-indemnizacion.test.ts` (service) › bloque «R21 — sobra un monto, o no corresponde a este cierre» (4 casos, incl. **duplicado**) · `tests/unit/repositories/cierres-admin-indemnizacion.test.ts` › «R21/R22: un monto que NO aplica lanza y NADA queda aplicado» |
| **R22** | `tests/unit/repositories/cierres-admin-indemnizacion.test.ts` › bloque «R22 — persistir los montos y emitir el egreso, en la MISMA transacción» (5 casos, incl. el orden escritura→lectura del feed) |
| **R23** | `…/cierres-admin-indemnizacion.test.ts` (repo) › «rechazar con `indemnizaciones` presentes NO las aplica» · `…/cierres-admin-indemnizacion.test.ts` (service) › «rechazarCierre no consulta incidentes ni pasa `indemnizaciones`» |
| **R24** | `tests/unit/types/cierres-admin-indemnizacion-schema.test.ts` › «acepta gestionId uuid + monto STRING…» y «R24: un monto NUMBER se rechaza» · `tests/unit/services/wallet-indemnizacion-feed-service.test.ts` › «R24/R26: money-safe — suma con Decimal…» y «R24: … no acumula error de redondeo» · service › «los montos llegan TAL CUAL al repo» |
| **R25** | `…/cierres-admin-indemnizacion.test.ts` (service) › bloque «R25 — alcance» (5 casos) · `…/cierres-admin-indemnizacion.test.ts` (repo) › bloque «R25 — la lectura de incidentes va acotada por alcance en el WHERE» (2 casos) |
| **R26** | `tests/unit/services/wallet-indemnizacion-feed-service.test.ts` › bloque «R26 — el movimiento emitido» (5 casos) y «R26 — el feed suma SOLO los incidentes» (2 casos) · repo › «escribe cada monto… y emite UN egreso con la SUMA» |
| **R27** | `…/wallet-indemnizacion-feed-service.test.ts` › bloque «R27 — sin incidentes NO se emite ni una fila en 0.00» (4 casos) · repo › «R27: cierre sin gestiones `incidente` → NINGÚN movimiento» |
| **R28** | `tests/unit/repositories/cierres-admin-indemnizacion.test.ts` › bloque «R27/R28» › «aprobar DOS veces… emite UN solo egreso», «el segundo intento NO altera el monto ya emitido», «un cierre que NO se aprueba no escribe ni emite» |
| **R29** | `tests/unit/guards/egreso-indemnizacion-emisores.test.ts` (8 casos). ⚠️ **Adaptado al corte en dos PRs**: R29 pide «exactamente DOS» emisores y en este PR hay **UNO**; el test lo declara así y exige que el segundo se sume cuando llegue su PR. Ver §6. |
| **R30** | `tests/unit/services/wallet-indemnizacion-no-reversable.test.ts` (5 casos) |
| **R31** | `tests/unit/guards/incidente-exhaustividad.test.ts` › «R31: `CATEGORIA_LABEL` tiene etiqueta legible EN ESPAÑOL» y «R31: la categoría aparece como opción del filtro». *(El test de componente del libro es T2.5.)* |
| **R32** | `tests/unit/services/wallet-egreso-service.test.ts` › «R11: maestro → desglose por tipo + total» (reescrito: la indemnización entra en el desglose **y** suma al total, 1150.50 → 1175.75). *(El test de componente de la tarjeta es T2.5.)* |
| **R33** | ⚠️ **SIN test en F1 — es frontend.** Panel del mensajero. Lo cubre **T2.1**. |
| **R34** | ⚠️ **SIN test en F1 — es frontend.** Sub-modal de captura al aprobar. Lo cubre **T2.4**. |
| **R35** | `tests/unit/types/gestion-orden-causa-incidente.test.ts` › «R35: las cuatro ramas previas siguen validando exactamente igual» y el bloque de blindaje de la unión · `tests/unit/repositories/gestion-orden-repository.test.ts` › «158/Q-G: los CUATRO resultados previos siguen appendeando con `gestion`» · `tests/unit/services/mis-asignaciones-incidente.test.ts` › bloque «R35» (2 casos) · **la suite completa en verde, sin modificar las expectativas de los 4 resultados previos** |
| **R36** | `tests/unit/types/cierres-admin-indemnizacion-schema.test.ts` › bloque «R36 — el contrato de la 38 sigue siendo válido tal cual» (3 casos) · `tests/unit/services/cierres-admin-indemnizacion.test.ts` › bloque «R36» (2 casos) · `tests/integration/actions/cierres-admin-action.test.ts` › «aprobarCierre con actor → delega con el cierreId parseado» |

**Cobertura de F1: 33 de 36.** Los tres sin test aquí (**R12, R33, R34**) son 100 % superficie
visible y sus tasks son de la Fase 2. R31 y R32 quedan cubiertos **en su mitad backend**; su
mitad de componente es T2.5.

---

## 3. Round-trip real de la migración (Postgres local)

**Ejecutado dos veces** contra `localhost:5432`, base `ordenex` (verificado con
`prisma migrate status`, que imprime el host sin exponer la credencial). **Producción no se tocó.**

Estado de partida de la base local: **95/95 migraciones**, «up to date», **9 filas** en
`gestion_orden` (datos reales), **0** en `wallet_movimiento`.

| dato | base (95 mig.) | tras UP | tras DOWN | tras 2.º UP |
| --- | --- | --- | --- | --- |
| valores de `gestion_resultado` | 4 | **5** (+`incidente`) | 4 | **5** |
| valores de `wallet_movimiento_categoria` | 14 | **15** (+`egreso_indemnizacion`) | 14 | **15** |
| tipo `gestion_causa_incidente` | no existe | `danado,perdido,robado` | **no existe** | `danado,perdido,robado` |
| columnas nuevas de `gestion_orden` | ninguna | `causa_incidente,indemnizacion` | **ninguna** | `causa_incidente,indemnizacion` |
| filas de `gestion_orden` | 9 | 9 | 9 | 9 |
| **checksum de `gestion_orden`** (todas las columnas menos las dos nuevas) | `b0347c2c…` | `b0347c2c…` | **`b0347c2c…`** | `b0347c2c…` |
| índices de `wallet_movimiento` | 5 | 5 | **5 (mismos nombres)** | 5 |
| índices de `gestion_orden` | 6 | 6 | 6 | 6 |
| RLS `gestion_orden` / `wallet_movimiento` | `true` / `true` | `true` / `true` | `true` / `true` | `true` / `true` |
| policies sobre esas dos tablas | 0 | 0 | 0 | 0 |
| migraciones aplicadas | 95 | 96 | **95** | 96 |

Comandos: `npx prisma migrate deploy` → `pnpm run db:rollback` → `npx prisma migrate deploy`.
`prisma migrate status` al final: **«Database schema is up to date!»**, sin drift contra
`schema.prisma`.

Lo que el round-trip demuestra y una lectura no demostraría:

- el `USING` cast del DOWN funciona **con datos reales** en `gestion_orden.resultado` (9 filas),
  no sobre una tabla vacía;
- los dos índices de `wallet_movimiento` vuelven **con el mismo nombre y forma** (incluido el
  único parcial `WHERE origen_id IS NOT NULL`);
- el UP es **reaplicable** tras el rollback (el `IF NOT EXISTS` y el `CREATE TYPE` conviven bien
  con el `db-rollback.ts`, que borra el registro de `_prisma_migrations`);
- ninguna columna preexistente de `gestion_orden` cambió, ida y vuelta (checksum de `to_jsonb`
  de toda la tabla menos las dos columnas nuevas — cubre todas las columnas de todas las filas
  sin nombrarlas una a una).

**Limitación declarada:** `wallet_movimiento` está **vacía** en local (0 filas), así que el
`USING` cast de la categoría se ejerció sobre una tabla sin datos. La discriminación de esa
mitad la aporta la mutación (c) de §4, que **inserta** una fila con el valor nuevo y comprueba
que el DOWN aborta.

---

## 4. Verificación por mutación

Todas se aplicaron **en memoria** (los archivos del repo se restauraron; ningún `.sql` ni
módulo quedó modificado).

### Precondición del `down.sql` (R4)

Script de sonda que aplica el `down.sql` **sentencia a sentencia dentro de una transacción
revertida**, tras sembrar el caso:

| caso | resultado | qué demuestra |
| --- | --- | --- |
| control: sin filas con los valores nuevos | **DOWN CORRIÓ (verde)** | el arnés no está siempre en rojo |
| con `gestion_orden.resultado = 'incidente'` | **ABORTA en la sentencia 14/15** (`ALTER TABLE "gestion_orden" ALTER COLUMN "resultado" TYPE …`) | la precondición discrimina, y falla **exactamente** donde el `down.sql` dice |
| con `wallet_movimiento.categoria = 'egreso_indemnizacion'` | **ABORTA en la sentencia 8/15** (`ALTER TABLE "wallet_movimiento" ALTER COLUMN "categoria" TYPE …`) | ídem para la otra mitad, y cubre el hueco de la tabla vacía |

### Mutaciones de código (11, todas discriminan)

| # | mutación | resultado |
| --- | --- | --- |
| A | `ESTADOS_ESPERADOS.incidente = []` | 3 casos rojos (`cierre-dia-service`) |
| B | se retira la arista **#53** | **7** casos rojos en 3 archivos |
| C | el `via` de **#44** vuelve a `gestion` | 1 caso rojo: «el mapa declara exactamente las aristas del inventario» (el que garantiza que no se olvide ninguna) |
| D | la evidencia del incidente pasa a opcional | 5 casos rojos, incluido «`perdido` y `robado` NO están exentos» |
| E | el append vuelve a `origen_tipo = gestion` | 2 casos rojos en 2 archivos |
| F | se quita un valor de `CAUSA_INCIDENTE_SEED` | **el BUILD rompe** (`_EnsureExhaustive` + el uso en un test) |
| G | se cae la guardia de «falta un monto» | 4 casos rojos |
| H | el WHERE de la escritura del monto deja de guardar `cierreId`+`resultado` | 4 casos rojos |
| I | el feed emite aunque la suma sea 0 | 3 casos rojos |
| J | la reversa deja de exigir `origen_tipo = "gasto"` | 3 casos rojos |
| K | el feed deja de filtrar por `resultado` | **3** casos rojos |
| L | `default:` en `buildGestionData` | 1 caso rojo (`incidente-exhaustividad`) |

**Hallazgo de la mutación K, dicho porque cambió el trabajo:** en su primera pasada la mutación
sólo puso rojo **un** caso, y era de **forma** (el shape del `where`), no de comportamiento —
señal débil. Se añadieron dos casos de comportamiento (un doble que honra `where.resultado`, con
una fila `entregada` que lleva un monto colado) y ahora la misma mutación pone rojo **3** casos,
dos de ellos sobre el monto emitido.

---

## 5. Tests de OTRAS features que esta feature rompió

**Ninguno se borró ni se debilitó.** Regla aplicada: si un test protegía un invariante y la
decisión del humano cambió el invariante, el test sigue protegiendo el invariante **nuevo** con
la misma fuerza.

### 5.1 Los que §14 del design anticipaba (8 de 10)

| archivo | afirmaba | ahora afirma |
| --- | --- | --- |
| `tests/unit/domain/order-status-transiciones.connectividad.test.ts:87-93` | `salidas === 0` y `TRANSICIONES.incidente === []` | igualdad **exacta** con la lista de una sola arista (#53) + que `indemnizada` sigue sin existir |
| `…guardia.test.ts:209-216` | «`incidente` no tiene NINGUNA salida legal», barriendo el catálogo | conserva el **barrido completo** y sólo exime la #53: los otros 18 destinos deben seguir lanzando, uno a uno. **Se le sumó** un `it.each` que nombra las 10 vías que R13 enumera, para que el fallo diga *cuál* se abrió |
| `…guardia.test.ts:364-380` | usaba `incidente → en_reparto` como ejemplo de par **ilegal** | usa `incidente → entregada`, que sigue siendo ilegal y conserva la propiedad medida (par ilegal **con** el value nuevo) |
| `…guardia.test.ts:266-272` + `tests/fixtures/inventario-transiciones-140.ts:149-153` | `aristasFlujo: 41`, `paresUnicos: 39` | **42 / 40**, con la cadena aritmética completa escrita en el fixture |
| `…guardia.test.ts:384-389` + `fixtures:109` | `"en_reparto->incidente (gestion)"` | `"en_reparto->incidente (incidente)"` **y** que el `(gestion)` ya no está |
| `…guardia.test.ts:36-42` | mapa vs. fixture incluyendo `via` | pasa al actualizar el fixture; es el test que caza la mutación C |
| `tests/unit/repositories/orden-historial-cobertura.test.ts:210-213,259-265` | `FAMILIAS_SIN_PRODUCTOR = ["recoleccion_tienda","incidente"]` | `["recoleccion_tienda"]`, `incidente` movida a `PUNTOS_DE_ESCRITURA` (#24). **Se le sumó** un caso que fija *dónde* se emite |
| `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` | `aristasFlujo - 2` | `aristasFlujo - 3`, con el descuento **nombrado** (`ARISTAS_QUE_TOCAN_LOS_VALUES_154`) en vez de un número mágico |

`tests/integration/db/wallet-idempotencia.test.ts` (el 10.º de la lista) **no se invirtió**: su
extensión a los dos orígenes es del PR del admin. Aquí sólo recibió el doble del feed nuevo, con
la razón escrita en el propio archivo (su caso cubre la idempotencia de los conceptos de
**ingreso**; la del egreso de indemnización tiene su propia suite).

### 5.2 DOS que §14 NO listaba — **la spec se equivocaba sobre el código**

Se descubrieron corriendo la suite completa. Corregido el rumbo y dejado escrito, como pide la
regla del lote:

1. **`tests/unit/types/criterio-intento-entrega.test.ts`** (feature 160) afirmaba «`incidente` no
   tiene salidas declaradas». §14 daba por bueno este archivo porque miró el caso `:32-43` (que
   deriva su recuento del SEED de familias y efectivamente **no** rompe), pero no el `:99-110`.
   **Reescrito** al invariante que R3 de la 160 protege de verdad y que además es **más fuerte**:
   *ninguna* arista que **toque** `incidente` —ni de entrada ni de salida— entra en el conteo de
   intentos (que es lo que gobierna el escalado del cron SLA y con él un `cobroRechazado` real).
   Se le sumó un caso que fija que su única salida es la reversión.

2. **`tests/unit/guards/censo-catalogo-estados-v2.test.ts`** (feature 154, censo de «declarado y
   sin productor»). `incidente` **gradúa**, exactamente como la 155 graduó sus dos literales, y
   el censo queda **vacío**.
   ⚠️ **Pérdida de poder declarada, no disimulada:** con la lista vacía, el caso del barrido
   («ningún archivo fuera de la allowlist lo nombra») pasa a ser trivialmente cierto. No es un
   agujero —el invariante que protegía dejó de existir en cuanto llegó el productor, que era el
   final previsto del guard— pero **sí** es una pérdida real de discriminación y por eso está
   escrita en la cabecera del archivo y aquí. A cambio se **reforzó** la graduación: hay un caso
   nuevo que exige que el productor esté **en los dos archivos que se nombran**
   (`MisAsignacionesService` para el estado y `GestionOrdenRepository` para la familia), y ese
   caso sí discrimina (lo caza la mutación E).

### 5.3 Dobles de test que hubo que hacer más fieles (no son inversiones)

- `tests/unit/services/cierres-admin-service.test.ts`: el doble de `gestionOrden.findMany`
  ignoraba el `where`. Ahora **honra `where.resultado`**, porque desde la 158 hay dos
  consumidores con predicados distintos y sin honrarlo la guardia de cobertura vería gestiones
  `entregada` como si fueran incidentes.
- `tests/integration/db/devolucion-rechazadas-flow.test.ts`: su doble de Prisma no exponía
  `gestionOrden`. Se añadió, respondiendo vacío (ese recorrido no tiene incidentes, R64).
- `cierres-admin-repository.test.ts`, `CierresAdminRepository.resolverCierre.devolucion.test.ts`,
  `wallet-idempotencia.test.ts`, `cierre-detail-congelado.test.ts`: +1 argumento en el
  constructor del repo (feed nuevo), con doble o con el feed real según lo que cada suite mide.
- Fixtures de `DesgloseEgresosDTO` y `CierreGrupos` en 7 archivos: +1 clave.

---

## 6. Lo que NO se hizo, con su razón

### Tasks NO marcadas (quedan sin `[x]` en `tasks.md`)

- **T1.19–T1.32 (Fase 1B, camino del ADMIN)** — fuera de alcance por instrucción explícita: van
  en el **PR 2**. En concreto, y a propósito: **no** existe `orden_incidente` ni su tabla de
  evidencias, **no** se añadió `orden_incidente` a `wallet_origen_tipo`, y **no** se declararon
  las 10 aristas del admin (#48–#52, #54–#58). La razón está en `design.md` §15.2: declararlas
  ahora dejaría diez aristas legales sin productor, que es la lección de la 154 aplicada al
  revés. Hay un **test que lo fija** (`guardia.test.ts` › «158/§15.2: las 10 aristas del camino
  del ADMIN NO están declaradas todavía»), para que adelantarlas sea una decisión consciente.
- **T2.1–T2.6 (Fase 2, frontend)** — otro subagente, dentro de este mismo PR.
- **T3.1–T3.5 (verificación final)** — T3.1 (humo manual del camino del mensajero) exige la UI
  de la Fase 2; T3.2/T3.5 son del PR del admin y del leader. **T3.3 (round-trip) SÍ está hecho
  para la migración de este PR** y documentado en §3, pero la casilla cubre *las dos*
  migraciones, así que se deja sin marcar.

### Requisitos de F1 sin test **en esta fase**

- **R12** (gate de verificación de guía) → **T2.1**. No tiene superficie backend: el gate es un
  componente del panel del mensajero.
- **R33** (opción diferenciada en el panel + validación en cliente con el mismo esquema) →
  **T2.1**. La mitad «mismo esquema» ya está garantizada por construcción (cliente y servidor
  importan `gestionarSchema`), pero el test de componente es de la Fase 2.
- **R34** (sub-modal de captura al aprobar) → **T2.4**.
- **R31/R32**: cubiertos **en su mitad backend**; los tests de componente son **T2.5**.

### R29 no se cumple literalmente en este PR — y es por diseño

R29 (reescrito) pide **«exactamente DOS»** puntos de emisión de `egreso_indemnizacion`. En este
PR hay **UNO**, porque el segundo es el del camino del admin. El guard estructural lo declara
así de forma explícita y tiene un caso que **exige** que el segundo se sume a la lista cuando
llegue su PR (`expect(EMISORES_DECLARADOS).toHaveLength(1)`), de modo que no pueda entrar sin
que alguien lo mire. **El reviewer del PR 2 debe verificar que ese número pasa a 2.**

### Cambios en `.tsx` de producción, y por qué

La instrucción era no tocar `.tsx` salvo que una task de F1 lo exija. Se tocaron **tres**
archivos, todos por la **red de exhaustividad** o por coherencia de dinero, y todos con el
mínimo imprescindible:

1. `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx` y
   `app/(app)/cierre-dia/_components/CierreDiaModule.tsx`: `RESULTADO_LABEL` y `RESULTADO_VACIO`
   son `Record<CierreResultado, string>` — **el build no compila** sin la clave. Se añadió sólo
   la etiqueta. El resto (orden de grupos, columnas del grupo, evidencias, monto) es T2.3/T2.2.
2. `app/(app)/wallet/_components/DesgloseEgresosCard.tsx`: se añadió **la fila**
   «Indemnizaciones». No es adorno: T1.16 mete la indemnización en el **total** que calcula el
   backend, así que sin la fila la tarjeta mostraría un total que no cuadra con la suma de lo
   que se ve. El copy del título (que deja de ser exacto, porque la indemnización es
   **operativa** y no administrativa) y el test de componente siguen siendo **T2.5**.

`app/(app)/wallet/_components/wallet-labels.ts` (que es `.ts`, no `.tsx`) también ganó su
entrada en `CATEGORIA_LABEL`, por la misma razón de exhaustividad.

### Supuestos y decisiones tomadas donde el spec no llegaba

- **Firma de `aprobarCierre`.** El design no la fija. Se eligió
  `aprobarCierre(cierreId, actor, indemnizaciones = [])` en vez de un objeto de entrada nuevo:
  conserva la firma de la 38 (R36 pide exactamente eso) y el `.default([])` del schema hace que
  el camino sin incidentes no cambie ni una línea. **Coste:** rompe la convención «actor al
  final» que sí siguen `rechazarCierre`/`verCierreDetalle`. Se acepta y queda dicho.
- **Un monto ausente en el feed.** Si una gestión `incidente` del cierre llegara al feed sin
  monto (sólo posible por una carrera, porque la guardia de cobertura y el `updateMany` guardado
  lo impiden), **no aporta** — misma semántica que el `SUM(…)` de SQL, que ignora los `NULL`, y
  que es lo que el design §6.3 describe. Consecuencia elegida: emitir de **menos** antes que de
  más. Hay test.
- **Predicado único.** La lectura de la guardia, la escritura del monto y la lectura del feed
  usan **el mismo** predicado `(cierreId, resultado = "incidente")`. Deliberado: si divergieran,
  el service podría exigir un monto para una gestión que el feed luego no sumaría. Está escrito
  en los tres sitios.

### Preguntas abiertas que deja esta fase

1. **`wallet_movimiento` está vacía en local.** El round-trip no pudo ejercer el `USING` cast de
   la categoría con datos reales. Se cubrió con la mutación (c), pero conviene saberlo antes de
   revertir esta migración en un entorno **con** movimientos.
2. **`catalogoCache` nunca se invalida** (aviso heredado de la 154). Esta migración **no** hace
   crecer `order_status`, así que el riesgo no aumenta — pero el orden migrar-antes-de-desplegar
   sigue importando, y el PR del admin tampoco lo cambia.
3. **Q-J sigue abierta** (¿se entera el mensajero asignado?). No bloquea nada de este PR: en el
   camino del mensajero es él mismo quien reporta. Es del camino del admin.

---

## 7. Salida real de la verificación

```
$ ./init.sh
== Arnes SDD :: init ==
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=…)
✓ specs presentes para features sdd en vuelo
-> pnpm run typecheck
✓ typecheck paso
-> pnpm run lint
✖ 19 problems (0 errors, 19 warnings)
✓ lint paso
-> pnpm run test
 Test Files  610 passed (610)
      Tests  6829 passed (6829)
   Duration  158.07s
✓ test paso
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

```
$ npx vitest run tests/integration/db
 Test Files  72 passed (72)
      Tests  715 passed (715)
```

```
$ npx prisma migrate status
96 migrations found in prisma/migrations
Database schema is up to date!
```

Baseline de la rama antes de empezar: 599 archivos / 6634 tests, lint 0 errores / 19 warnings.
**Delta: +11 archivos de test, +195 tests, 0 fallos, 0 warnings nuevos.**

---

## 8. Archivos creados / modificados

### Creados (11)

```
db/migrations/20260730120000_incidente_indemnizacion/migration.sql
db/migrations/20260730120000_incidente_indemnizacion/down.sql
lib/types/causa-incidente.ts
lib/interfaces/services/IWalletIndemnizacionFeedService.ts
lib/services/WalletIndemnizacionFeedService.ts
tests/integration/db/incidente-indemnizacion-migration.test.ts
tests/unit/types/gestion-orden-causa-incidente.test.ts
tests/unit/types/cierres-admin-indemnizacion-schema.test.ts
tests/unit/services/mis-asignaciones-incidente.test.ts
tests/unit/services/cierres-admin-indemnizacion.test.ts
tests/unit/services/wallet-indemnizacion-feed-service.test.ts
tests/unit/services/wallet-indemnizacion-no-reversable.test.ts
tests/unit/repositories/cierres-admin-indemnizacion.test.ts
tests/unit/utils/incidente-no-mueve-dinero.test.ts
tests/unit/guards/egreso-indemnizacion-emisores.test.ts
tests/unit/guards/incidente-exhaustividad.test.ts
```

### Modificados — producción

```
db/schema.prisma
lib/types/wallet.ts
lib/types/gestion-orden.ts
lib/types/cierres-admin.ts
lib/types/order-status-transiciones.ts
lib/interfaces/repositories/IGestionOrdenRepository.ts
lib/interfaces/repositories/ICierresAdminRepository.ts
lib/interfaces/repositories/IWalletMovimientoRepository.ts
lib/interfaces/services/IMisAsignacionesService.ts
lib/interfaces/services/ICierresAdminService.ts
lib/services/MisAsignacionesService.ts
lib/services/CierreDiaService.ts
lib/services/CierresAdminService.ts
lib/services/CierresBodegaAdminService.ts
lib/services/WalletEgresoService.ts
lib/repositories/GestionOrdenRepository.ts
lib/repositories/CierresAdminRepository.ts
lib/repositories/WalletMovimientoRepository.ts
lib/actions/mis-asignaciones.ts
lib/actions/cierres-admin.ts
app/(app)/wallet/_components/wallet-labels.ts
app/(app)/wallet/_components/DesgloseEgresosCard.tsx        ← fila del desglose (§6)
app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx  ← solo etiquetas (§6)
app/(app)/cierre-dia/_components/CierreDiaModule.tsx           ← solo etiquetas (§6)
```

### Modificados — tests y fixtures

```
tests/fixtures/inventario-transiciones-140.ts
tests/unit/domain/order-status-transiciones.connectividad.test.ts
tests/unit/domain/order-status-transiciones.guardia.test.ts
tests/unit/types/criterio-intento-entrega.test.ts
tests/unit/guards/censo-catalogo-estados-v2.test.ts
tests/unit/repositories/registrar-cambio-estado.guardia.test.ts
tests/unit/repositories/orden-historial-cobertura.test.ts
tests/unit/repositories/gestion-orden-repository.test.ts
tests/unit/repositories/gestion-orden-evidencia.test.ts
tests/unit/repositories/cierre-dia-repository.test.ts
tests/unit/repositories/cierres-admin-repository.test.ts
tests/unit/repositories/CierresAdminRepository.resolverCierre.devolucion.test.ts
tests/unit/services/cierre-dia-service.test.ts
tests/unit/services/cierres-admin-service.test.ts
tests/unit/services/CierresAdminService.aprobar.devolucion.test.ts
tests/unit/services/wallet-egreso-service.test.ts
tests/unit/actions/wallet-egresos-actions.test.ts
tests/unit/components/wallet-desglose-egresos-card.test.tsx
tests/integration/actions/cierres-admin-action.test.ts
tests/integration/db/cierre-detail-congelado.test.ts
tests/integration/db/devolucion-rechazadas-flow.test.ts
tests/integration/db/wallet-idempotencia.test.ts
tests/integration/wallet-page.test.tsx
tests/components/CierreDiaModule.test.tsx
tests/components/CierreDiaPage.test.tsx
tests/components/CierresAdminModule.test.tsx
```

---

## 9. Commits

```
8bd30fe  feat(158…): migracion, catalogos y tipos del incidente del mensajero        (T1.1-T1.5)
052e4ba  feat(158…): declara la arista de deshacer un incidente y realinea el via de #44 (T1.6/T1.6b)
8659057  feat(158…): quinta variante de gestion, borde zod y familia de historial    (T1.6c/T1.7-T1.9)
06f9dd3  feat(158…): captura del monto al aprobar el cierre y egreso de indemnizacion (T1.10-T1.17)
```

**No se hizo `git push` ni se abrió PR**: lo decide el humano.
