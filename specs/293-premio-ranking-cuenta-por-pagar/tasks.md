# 293 — Tareas

`[P]` = paralelizable con las marcadas igual **dentro de la misma fase**. Cada tarea lleva su
criterio de «hecho»: si no se puede comprobar, no está hecha.

**Reglas de esta ficha**

- Es **dinero**, y además **estrena los libros en producción** (`design.md §2`): el gate final es
  `./init.sh` **completo**, nunca `--rapido` (el diff toca migraciones y `db/schema.prisma`, así que
  el modo rápido se niega solo).
- Cada `R<n>` de `requirements.md` termina mapeado a un test concreto (§Matriz).
- **[PG]** = exige **Postgres real**, no dobles. Medido en este repo: un test de servicio con dobles
  no ve el SQL y deja pasar una mutación del `WHERE`; y un test de integración puede reportar
  `passed` sin comprobar nada si sus datos no existen. Todo test [PG] lleva **control de no-vacuidad**
  explícito y queda `skipped` (nunca `passed`) sin `DATABASE_URL`.
- Zona `fullstack`: backend (fases 1-4) → frontend (fase 5) → cierre (fase 6).

---

## Fase 1 — Datos

### T1.1 — Migración `<timestamp>_premio_ranking_devengo` (UP)
**Dep:** ninguna.
Los siete pasos de `design.md §10`, en ese orden: los dos `ALTER TYPE ... ADD VALUE IF NOT EXISTS`;
`ADD COLUMN premio_dia DATE`; `DROP`+`ADD` del CHECK tipo↔categoría con `premio_ranking` en la rama
`devengo`; el CHECK de `premio_dia`; `DROP`+`CREATE` de `pago_mensajero_movimiento_origen_uq` con la
exclusión de categorías; y los dos únicos parciales del premio y su reverso. Sin `INSERT`/`UPDATE`/
`DELETE`, sin tocar RLS. Verificar antes que el timestamp es estrictamente mayor que el de la última
carpeta.
**Hecho:** `pnpm run db:migrate` la aplica en local sin error y `prisma migrate status` queda limpio.
Si apareciera `unsafe use of new value`, se parte en dos carpetas (§10); no se toca el `IF NOT EXISTS`.

### T1.2 — `down.sql`
**Dep:** T1.1.
Los siete pasos inversos de `design.md §10`, con la coreografía de los **seis** índices de
`origen_tipo` y el `origen_uq` recreado **con su predicado original**. Documentar la precondición y
por qué no se toca ningún `down.sql` previo.
**Hecho:** `pnpm run db:rollback` sobre una base sin premios revierte sin error; los dos enums quedan
con sus valores previos y `origen_uq` con su predicado viejo; volver a aplicar funciona.

### T1.3 — `db/schema.prisma`
**Dep:** T1.1.
`premio_ranking` en `PagoMensajeroMovimientoCategoria`; `ranking_snapshot_fila` en
`WalletOrigenTipo`; `premioDia DateTime? @map("premio_dia") @db.Date` en `PagoMensajeroMovimiento`,
con el comentario de que los dos únicos parciales y el CHECK **viven solo en la migración** (Prisma no
expresa índices parciales) y que un `migrate dev --create-only` futuro puede proponer un `DROP INDEX`
fantasma que **nunca** se resuelve borrando el índice. `prisma generate` + reiniciar el dev server.
**Hecho:** `pnpm exec tsc --noEmit` pasa; el cliente expone los dos valores y la columna.

### T1.4 — [PG] Cobertura de la migración
**Dep:** T1.1-T1.3.
`tests/integration/db/premio-ranking-devengo-migration.test.ts`, patrón de
`caja-tesoreria-migration.test.ts` (**no** el de `ranking-snapshot-migration.test.ts`, que ejecuta el
`migration.sql` dentro de una transacción en un esquema temporal: ahí un `ADD VALUE` seguido del uso
del valor falla siempre; `design.md §10`).
- **Estático**: los dos `ADD VALUE IF NOT EXISTS`; el CHECK recreado con `premio_ranking` en `devengo`
  y **no** en `pago`; el CHECK de `premio_dia`; el `origen_uq` con la exclusión; los dos únicos
  parciales; el UP sin `INSERT/UPDATE/DELETE` ni RLS; el DOWN suelta los seis índices por nombre y
  restaura el predicado original.
- **[PG] comportamiento** contra la base migrada: `devengo`+`premio_ranking` entra;
  `pago`+`premio_ranking` es rechazado (23514); `premio_ranking` con `premio_dia` NULL es rechazado;
  `pago_devengado` con `premio_dia` NOT NULL es rechazado; y las 6 combinaciones legítimas del libro
  siguen entrando (un CHECK que rechaza de más también está roto).
**Hecho:** verde con `DATABASE_URL`, `skipped` sin ella; mutar la rama del CHECK lo pone rojo.

### T1.5 — [P] Vocabulario de tipos
**Dep:** T1.3.
`"premio_ranking"` en `PAGO_MENSAJERO_MOVIMIENTO_CATEGORIA_SEED` (`lib/types/wallet-mensajero.ts`;
`_EnsureCategoriaExhaustive` rompe el build hasta que se haga: es la guardia) y
`ranking_snapshot_fila` donde `lib/types/wallet.ts` lista los orígenes. `premioDia` en
`PagoMensajeroMovimientoDTO` **no** se añade: la pantalla no lo necesita y el DTO no gana campos que
nadie pinte.
**Hecho:** `tsc` verde, ningún `satisfies` roto.

### T1.6 — [P] Rótulos (R34)
**Dep:** T1.5.
`premio_ranking: "Premio del ranking"` en los **dos** `Record<PagoMensajeroMovimientoCategoria, string>`
(`wallet-mensajeros-labels.ts`, `mis-pagos-labels.ts`) y `ranking_snapshot_fila` en los dos
`ORIGEN_PAGO_LABEL`.
**Hecho:** `tsc` verde (sin el rótulo no compila) y un test comprueba que el rótulo de
`premio_ranking` **no** coincide con el de `ajuste_devengo` en los dos archivos.

### T1.7 — [P] Catálogo de métricas
**Dep:** T1.5.
`"premio_ranking"` en `cuenta_por_pagar_mensajero.definicion.categorias` (`lib/analytics/metrics.ts:697`).
**Hecho:** `definiciones-catalogo.guardia.test.ts` sigue verde.

---

## Fase 2 — El cálculo nuevo y su barrido

### T2.1 — `derivarPendienteCierre` con firma por objeto
**Dep:** Fase 1.
`{ pagoDebido, efectivo, premiosVivos, pagadoVigente }` → `calcularSplitPago(P,E).pendiente +
premiosVivos − pagadoVigente`, nunca negativo, STRING escala 2, `Prisma.Decimal` en todo el camino.
**`calcularSplitPago` no se toca** (R25).
**Hecho:** `tests/unit/utils/pendiente-cierre.test.ts` extendido: los casos existentes siguen dando lo
mismo con `premiosVivos: "0.00"`; premio con `E ≥ P` **no** queda saldado (el caso que distingue esta
regla de la alternativa D); premio + pago parcial; céntimos exactos; y la guardia de que el archivo no
contiene `Number(` ni `parseFloat`.

### T2.2 — `sumarPremiosVivosPorCierre` en el repositorio del libro
**Dep:** Fase 1.
Método nuevo en `IPagoMensajeroMovimientoRepository` + implementación: Σ `premio_ranking` −
Σ `ajuste_pago con premio_dia NOT NULL`, `WHERE origen_tipo='cierre_dia' AND origen_id IN (...)`, una
entrada `"0.00"` por **cada** id pedido, **una** consulta por listado.
**Hecho:** unitario que fija el `WHERE` completo y el contrato de «una entrada por id»; y **[PG]** en
T4.4 se mide contra Postgres que un movimiento de **otro** origen o de otra categoría no entra —la
mutación que borra `origen_tipo` del `WHERE` tiene que ponerse roja ahí, no en el unitario—.

### T2.3 — Barrido de consumidores (lo que el reviewer comprueba)
**Dep:** T2.1, T2.2.
Con la firma nueva, `tsc` señala **todos** los call-sites. Pasan al cálculo nuevo exactamente estos
cuatro, cada uno alimentado con `sumarPremiosVivosPorCierre`:
- `LiquidacionService.imputablesDe` (reparto);
- `LiquidacionService.pendienteDelCierre` (pago contra UN cierre);
- `CierresAdminService.conPendiente` (listado, histórico y detalle) — requiere la dependencia nueva
  `Pick<IPagoMensajeroMovimientoRepository, "sumarPremiosVivosPorCierre">` en el constructor;
- `CierresAdminService.pendienteTrasAprobar`.
Y **no** cambian los dieciséis restantes de la tabla de `design.md §6`.
**Hecho:** (a) `tsc` verde sin ningún call-site posicional; (b) un test por cada uno de los cuatro que
demuestra que el premio entra en su cifra; (c) tests de no-regresión para las filas «no cambia» más
frágiles: `calcularSplitPago` intacto, el feed del cierre intacto (`caja-173-alcance` sigue verde) y
`sumarVigentesPorCierre` intacto; (d) la tabla de §6 copiada en
`progress/impl_293-...md` con el resultado real de cada fila.

### T2.4 — Conciliación analítica: excluir el premio
**Dep:** T2.3.
En `ConciliacionCierresAnaliticaRepository`, el lado ledger de `pago_mensajero_movimiento` excluye
`premio_ranking` y el `ajuste_pago` con `premio_dia`. Comentario que explique el porqué (compara el
snapshot contra lo que el cierre movió **al aprobarse**; el premio nace después).
**Hecho:** test que siembra un cierre aprobado + su feed + un premio y comprueba que el lado ledger
**no** se mueve por el premio; control de no-vacuidad: sin el filtro, el mismo test es rojo.

### T2.5 — [P] Composition root de `CierresAdminService`
**Dep:** T2.3.
Cablear la dependencia nueva en `lib/actions/cierres-admin.ts`.
**Hecho:** un test comprueba que la action **construida de verdad** (sin `deps`) devuelve un
pendiente que incluye el premio — no que el módulo importe el repositorio. Medido en este repo: 2 de 7
notificadores quedaron muertos con la suite verde porque nadie comprobaba que alguien los **pasara**.

---

## Fase 3 — Lecturas del premio

### T3.1 — `listarPodioDeFecha`
**Dep:** Fase 1.
Método nuevo en `IRankingSnapshotRepository` + `RankingSnapshotRepository`: filas con
`posicion IS NOT NULL` de esa fecha, `ORDER BY posicion ASC`, devolviendo `filaId`, `posicion`,
`mensajeroId`, `mensajeroNombre`, `entregadas`, `asignadas`, `premioMonto` (STRING o `null`) y
`premioDescripcion`. Método propio y **no** un campo nuevo en el `SnapshotFilaRow` del histórico: ese
row alimenta un DTO cuyo contrato declara qué viaja al cliente (`lib/types/ranking-snapshot.ts:15`).
**Hecho:** unitario que fija `where` y `orderBy`; **[PG]** en T4.4 lee un podio sembrado real.

### T3.2 — [P] `resolverCierreDelDia` (`design.md §4`)
**Dep:** Fase 1.
Lectura nueva: cierres del mensajero con al menos una gestión vigente cuyo `created_at` cae en
`ventanaDelDia(fecha)`; ninguno → `sin_cierre`; varios → el más antiguo por `solicitado_at`,
desempate `id`; devuelve id **y estado** (el servicio decide si sirve).
**Hecho:** unitario que fija el `WHERE` (ventana, `anuladaAt: null`, `mensajeroId`, `cierreId` no
nulo) y el orden; **[PG]** en T4.4: dos cierres del mismo día → siempre el mismo; una gestión de otro
día no arrastra su cierre; una gestión anulada tampoco.

### T3.3 — [P] `listarPremiosPorDias`
**Dep:** Fase 1.
Estado del panel: filas `premio_ranking` y `ajuste_pago con premio_dia` de ese mensajero para esos
días.
**Hecho:** unitario del `WHERE`; alimenta el estado de R9.

---

## Fase 4 — Escritura

### T4.1 — Puerto estrecho de la caja
**Dep:** Fase 1.
`ICajaPremioRankingFeedService` con dos métodos que **no** aceptan tipo ni categoría, y
`CajaPremioRankingFeedService` que fija con literales `egreso`/`egreso_pago_mensajero` y
`ingreso`/`ingreso_ajuste`, con `origen_tipo='ranking_snapshot_fila'` y `origen_id=<filaId>`,
escribiendo por `WalletMovimientoRepository.crearMovimientos`.
**Hecho:** `tests/unit/services/caja-premio-ranking-feed.test.ts` fija las dos filas exactas y que el
puerto no puede expresar otra categoría.

### T4.2 — `PremioRankingDevengoService`
**Dep:** T3.1, T3.2, T3.3, T4.1.
Tres métodos, con `esAccesoTotal` **antes de leer nada** (R2):
- `listarPremiosDelDia` → podio + cierre resuelto + estado por fila (R4/R6/R7/R9), `hayPodio: false`
  sin snapshot;
- `registrarPremio` → fila congelada → `sin_premio` / `sin_cierre` / `cierre_no_aprobado` → **una
  transacción**: devengo `premio_ranking` (monto congelado, `origen_tipo='cierre_dia'`,
  `origen_id=<cierreId>`, `premio_dia`=fecha del podio, `registrado_por`, descripción de R22) +
  `emitirEgresoPremio`; 0 filas insertadas → `ya_registrado`, o `anulado` si existe la compensación;
- `anularPremio` → `no_registrado` / `ya_anulado` → transacción: `ajuste_pago` con el motivo +
  `reversarEgresoPremio`.
Nunca se pasa `fechaMovimiento` (R23); el monto nunca sale del input ni del premio vigente (R15/R16).
**Hecho:** `tests/unit/services/premio-ranking-devengo-service.test.ts` cubre cada rama, incluido
«el premio vigente vale otra cosa» (se escribe el congelado) y «el input no trae mensajero ni cierre».

### T4.3 — Server Actions + composition root
**Dep:** T4.2.
`lib/actions/premio-ranking-devengo.ts` con los tres contratos de `design.md §7.3`: `'use server'`,
actor por sesión (`unauthenticated` antes del servicio), zod en el borde (fecha válida y no futura,
`filaId` no vacío, `motivo` no vacío), `deps` inyectables.
**Hecho:** `tests/unit/actions/premio-ranking-devengo-actions.test.ts` cubre sin sesión, fecha
inválida, fecha futura, motivo vacío y el paso limpio; y el bloque «T4.3 — `buildService()`: la action
construida DE VERDAD» ejercita el composition root llamando a la action **sin `deps.service`**: las
cuatro dependencias son las clases reales (`instanceof`, no un `import` en el texto del módulo) y el
runner **abre una transacción de Prisma y entrega el cliente DE ESA transacción**, no el de fuera.
Medido con la mutación que la revisión encontró viva —`(fn) => fn(prisma)` en vez de
`prisma.$transaction(...)`—: con ella, 18 de los 19 archivos de la feature siguen verdes (535 tests) y
sólo esta guardia se pone roja (2 casos).

### T4.4 — [PG] La guarda de la base y el ciclo completo
**Dep:** T4.3.
`tests/integration/db/premio-ranking-idempotencia.test.ts`, Postgres real, transacción revertida,
sembrando sus propios usuarios, snapshot, filas, cierre y gestiones (nunca datos preexistentes):
1. **R17** — dos registros del mismo `filaId` dejan **una** fila en el libro y **una** en la caja.
2. **R17** — un segundo premio para el mismo (mensajero, día) insertado por otra vía → lo rechaza **la
   base** (violación del único parcial), no el servicio.
3. **R18** — el segundo intento por la API pública responde `ya_registrado`, sin error.
4. **R19** — dos días de podio distintos imputados al **mismo** cierre → **dos** premios registrados
   (es la medición que descarta la alternativa B de `design.md §11`).
5. **R20** — las tres posiciones del mismo día producen **tres** egresos distintos en la caja, y
   ninguno colisiona con el `egreso_pago_mensajero` que el feed del cierre ya escribió (alternativa C).
6. **R20** — si la escritura de la caja falla, no queda la fila del libro.
7. **R24/R27** — cierre saldado + premio → `derivarPendienteCierre` sobre datos reales devuelve el
   importe del premio; el cierre vuelve a `imputablesDe`.
8. **R29/R31/R33** — anular deja neto cero, baja lo pagable del cierre y el segundo intento responde
   `ya_anulado` sin escribir.
9. **R32** — tras anular, registrar de nuevo el mismo `filaId` no crea nada y responde `anulado`.
10. **No-regresión** — doble aprobación del mismo cierre sigue produciendo un solo set de movimientos
    (el `origen_uq` retocado no aflojó la idempotencia del feed).
**Hecho:** verde con `DATABASE_URL`, `skipped` sin ella; cada caso afirma sobre filas **contadas**; y
se anota en `progress/` el resultado de matar con mutaciones el `WHERE` de T2.2, el `premio_dia` de
T4.2 y el orden de T3.2 (el arnés de mutaciones de este repo ya mintió una vez: exige
autocomprobación).

---

## Fase 5 — Pantalla

### T5.1 — `PremiosRankingPanel`
**Dep:** T4.3.
`app/(app)/wallet/mensajeros/_components/PremiosRankingPanel.tsx`: selector de fecha (defecto ayer
CR), podio por posición con `entregadas / asignadas` **siempre visible y pegado al premio** (R5),
monto y descripción congelados, los seis estados de R9 con **texto**, y los controles Registrar /
Anular. Sin `Number(`, sin `parseFloat`, sin restas (R35). Refresco dirigido tras escribir, incluida
la clave del listado de cuentas por pagar.
**Hecho:** `tests/components/PremiosRankingPanel.test.tsx`: se pinta `0 / 21` y no un guion; existen
como texto «sin premio», «ese día no tiene ranking congelado», «ese día no tiene cierre», «el cierre
de ese día está …» y «anulado — no se puede volver a registrar»; guardia money-safe sobre el archivo.

### T5.2 — Diálogo de anulación con motivo
**Dep:** T5.1.
**Hecho:** con motivo vacío no se llama a la action.

### T5.3 — Montaje en la página
**Dep:** T5.1.
La sección se monta encima de la tabla; **ninguna decisión de rol en el cliente**.
**Hecho:** `tests/integration/wallet-mensajeros-page.test.tsx` extendido: con `maestro` aparece; con
`mensajero`/`adminTienda`/`adminSatelite`/sin sesión la página sigue dando `notFound`.

### T5.4 — [P] Desglose, `/mis-pagos` y descargas (R34)
**Dep:** T1.6.
El premio se rotula «Premio del ranking», aparece **bajo su cierre** en el desglose (filtro por
`cierreId`) y en las dos descargas.
**Hecho:** tests de los dos desgloses y de las dos columnas de descarga con un movimiento
`premio_ranking` en el fixture; las aserciones comparan contra el **literal** esperado, no contra la
función que lo genera.

### T5.5 — [P] El badge del cierre (R27)
**Dep:** T2.5.
**Hecho:** test de `CierresAdminModule`/`PendienteLiquidarBadge` con un cierre saldado + premio: se
pinta «Pendiente de liquidar» con el importe del premio.

---

## Fase 6 — Cierre

### T6.1 — Guardia de alcance
**Dep:** Fase 5.
`tests/unit/guards/premio-ranking-alcance.guardia.test.ts`, censo sobre el **árbol** con control de
no-vacuidad: el único módulo que escribe `premio_ranking` es `PremioRankingDevengoService`; ni
`app/api/**` ni ningún cron la mencionan; `CierreDiaService`, `CierresAdminService`,
`LiquidacionService` y los feeds del cierre **no** la escriben (R3); el único escritor de cada libro
sigue siendo su repositorio; y **nadie escribe `cierre_dia.totalPagoMensajero` fuera de los caminos
que ya lo hacían** (R13).
**Hecho:** verde, y borrar la mención en el servicio nuevo la pone roja.

### T6.2 — Mapa de trazabilidad
**Dep:** todas.
`progress/impl_293-premio-ranking-cuenta-por-pagar.md` con la tabla `R<n>` → archivo::test, la tabla
del barrido de §6 con su resultado real, y las mutaciones de T4.4. **Commitearlo** (en este repo se ha
perdido tres veces por no commitearlo).
**Hecho:** los 35 requisitos tienen fila con un test que existe y corre.

### T6.3 — Gate completo
**Dep:** T6.2.
`./init.sh` completo, con `INIT_EXIT=$?` capturado **dentro** del log (un `echo` posterior ya tapó un
rojo aquí).
**Hecho:** el log termina con `INIT_EXIT=0`.

### T6.4 — Verificación con la app, y contra producción
**Dep:** T6.3.
En local, con base migrada, snapshot y cierre sembrados: registrar el premio, ver subir la cuenta por
pagar, ver el badge del cierre volver a «pendiente», pagarlo con el diálogo existente, ver la cuenta
bajar, anular un segundo premio y ver el neto en cero.
En producción, **antes de anunciar la feature**: comprobar con solo-lectura que los tres libros
seguían a cero antes del deploy y que la primera fila escrita es exactamente el premio esperado
(`design.md §2`: esta feature estrena los libros).
**Hecho:** las observaciones anotadas en `progress/` con importes, y la comprobación de producción con
su cifra antes y después.

---

## Matriz de trazabilidad (R → test)

| R | Qué exige | Test | [PG] |
| --- | --- | --- | --- |
| R1 | única puerta | `premio-ranking-alcance.guardia.test.ts` + `wallet-mensajeros-page.test.tsx` | |
| R2 | forbidden sin acceso total | `premio-ranking-devengo-service.test.ts` (3 métodos × roles) + página | |
| R3 | nunca automático | `premio-ranking-alcance.guardia.test.ts` | |
| R4 | podio congelado con sus datos | `premio-ranking-devengo-service.test.ts` + `premio-ranking-lecturas.test.ts` (`293/T3.1`) | |
| R5 | `0 / 21` visible | `PremiosRankingPanel.test.tsx` | |
| R6 | fecha sin snapshot | servicio + panel | |
| R7 | fila sin premio (nulo y `0.00`) | servicio | |
| R8 | fecha inválida o futura | `premio-ranking-devengo-actions.test.ts` | |
| R9 | los seis estados | servicio + panel | |
| R10 | imputación al cierre del día | `premio-ranking-idempotencia.test.ts` casos 4 y 7 + `premio-ranking-lecturas.test.ts` (`293/T3.2`) | **sí** |
| R11 | sin cierre → mensaje propio | servicio + panel | |
| R12 | cierre no aprobado → mensaje propio | servicio + panel | |
| R13 | no se toca el snapshot | `premio-ranking-alcance.guardia.test.ts` + caso [PG] que relee `total_pago_mensajero` tras registrar y anular | **sí** |
| R14 | devengo con categoría propia | servicio + migración (el CHECK lo admite) | **sí** |
| R15 | monto congelado, no el vigente | servicio (premio vigente distinto) | |
| R16 | mensajero/fecha/cierre del servidor | servicio + contrato de la action | |
| R17 | un premio por (mensajero, día), por índice | `premio-ranking-idempotencia.test.ts` casos 1 y 2 | **sí** |
| R18 | reintento = ya registrado | caso 3 | **sí** |
| R19 | dos días en un mismo cierre | caso 4 | **sí** |
| R20 | egreso de caja, misma transacción, sin colisión | `caja-premio-ranking-feed.test.ts` + casos 5 y 6 + `premio-ranking-devengo-actions.test.ts` (el composition root: el runner ABRE la transacción) | **sí** |
| R21 | filas inmutables | guardia de alcance (sin `update`/`delete`) | |
| R22 | actor y descripción | servicio | |
| R23 | fecha = instante del registro | servicio (no se pasa `fechaMovimiento`) | |
| R24 | lo pagable = snapshot + premios − pagos | `pendiente-cierre.test.ts` + caso 7 | **sí** |
| R25 | el premio fuera de `min(P,E)` | `pendiente-cierre.test.ts` (premio con `E ≥ P`) | |
| R26 | un solo cálculo | `tsc` (firma por objeto) + los cuatro tests de T2.3 + guardia de que nadie reimplementa la fórmula | |
| R27 | cierre saldado vuelve a pendiente | caso 7 + `PendienteLiquidarBadge` | **sí** |
| R28 | conciliación sin premios | test de `ConciliacionCierresAnaliticaRepository` (T2.4) | |
| R29 | compensación + reverso de caja | servicio + caso 8 | **sí** |
| R30 | motivo obligatorio | actions + panel | |
| R31 | segunda anulación = ya anulado | caso 8 | **sí** |
| R32 | anulado no se re-registra, y se dice | caso 9 + panel | **sí** |
| R33 | anular baja lo pagable | caso 8 | **sí** |
| R34 | rótulo propio y bajo su cierre | T1.6 y T5.4 | |
| R35 | money-safe STRING | guardia sobre el panel + aserciones de tipo en el servicio | |

**Por qué esos son [PG] y no dobles.** Todos afirman «la **base** impide esto» o «este número sale de
datos reales». Un doble en memoria puede emular un índice único y quedarse verde con un `WHERE`
mutado —medido cuatro veces seguidas en este repo—, y aquí las restricciones son **parciales y
compuestas** (`WHERE categoria = 'premio_ranking'`, `WHERE origen_id IS NOT NULL AND categoria NOT IN
(...)`): exactamente el tipo que un doble simplifica sin querer. R20 depende además de que el único de
la caja **no** incluya el mensajero, que es un hecho del DDL y de ningún otro sitio; y R24/R27/R33
solo significan algo si el pendiente se deriva de filas que existen de verdad.
