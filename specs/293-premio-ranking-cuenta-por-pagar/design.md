# 293 — Diseño técnico

El maestro registra el premio del podio de un día como **devengo imputado al cierre de ese día**, y
se cobra con el flujo de pago por cierre que ya existe.

Todo lo citado del código está **verificado en el árbol** el 2026-08-27, con archivo y línea cuando
la afirmación es load-bearing.

---

## 0. La decisión y su consecuencia

El humano decidió **imputar el premio al cierre del día del podio**. Lo que eso obliga a cambiar es
**una sola cosa**, y es donde vive todo el riesgo:

> **Lo pagable de un cierre pasa a ser `total_pago_mensajero` (vía su snapshot) + los premios vivos
> imputados a ese cierre − los pagos vigentes.**

`cierre_dia.total_pago_mensajero` **no se reescribe nunca** (R13). El premio es una **fila propia**
del libro del mensajero, con categoría propia y con el **origen del cierre**, así que se ve separado
en el desglose y, a la vez, el cierre sabe que lo arrastra.

El barrido de todos los consumidores de ese número está en **§6**. Es la lista que decide si esto
sale bien o mal.

---

## 1. Lo que ya existe (medido, no supuesto)

| Pieza | Dónde | Qué aporta |
| --- | --- | --- |
| `pago_mensajero_movimiento` | `db/schema.prisma:1538`, migración `20260712180000_pago_mensajero_movimiento` | Libro append-only por mensajero, filas **inmutables**. La cuenta por pagar se deriva (Σ devengo − Σ pago). |
| Único parcial `pago_mensajero_movimiento_origen_uq` | `20260712180000.../migration.sql:64-66` | `(origen_tipo, origen_id, mensajero_id, categoria) WHERE origen_id IS NOT NULL`. Es la idempotencia del feed del cierre. |
| CHECK `pago_mensajero_movimiento_tipo_categoria_check` | `20260802120000_liquidacion_pago/migration.sql:141-146` | Disyunción de **listas cerradas** tipo↔categoría, **falla cerrado**: una categoría nueva sin clasificar hace que todo INSERT se rechace (23514). |
| `ranking_snapshot_dia` / `ranking_snapshot_fila` | `db/schema.prisma:2419`, `:2461` | Podio congelado: `posicion`, `premio_monto`, `premio_descripcion`, `entregadas`, `asignadas`, nombre congelado. `fecha` UNIQUE, `@@unique([snapshotId, mensajeroId])`. Nada en el árbol borra snapshots. |
| `derivarPendienteCierre(P, E, pagadoVigente)` | `lib/utils/pendiente-cierre.ts` | **Fuente única** de «lo pagable de un cierre» = `calcularSplitPago(P,E).pendiente − Σ pagos vigentes`. |
| `calcularSplitPago(P, E)` | `lib/utils/cuenta-por-pagar.ts:22` | Fuente única de `min(P, E)`: lo que el mensajero ya se quedó del efectivo del día. |
| `wallet_movimiento` + `wallet_movimiento_origen_categoria_uq` | `20260712160000_wallet_movimiento`, `.../orden_incidente/down.sql:62-64` | Caja principal e idempotencia `(origen_tipo, origen_id, categoria) WHERE origen_id IS NOT NULL`. **Sin `mensajero_id`.** |
| `NATURALEZA_POR_CATEGORIA` | `lib/utils/caja-tesoreria.ts:57-70` | `egreso_pago_mensajero: "propio"`. Reusarla no obliga a tocar la clasificación de la caja. |
| Censo de escritores | `tests/unit/guards/caja-173-alcance.guardia.test.ts:91-105` | «El único módulo que escribe en `pago_mensajero_movimiento` es su repositorio». Este diseño lo respeta. |
| `esAccesoTotal` | `lib/auth/acceso-total.ts` | Cómo se expresa hoy «solo el maestro» en Wallet. |

Cuatro hechos más, medidos, que mandan sobre el diseño:

1. **`cierre_dia` no tiene ningún índice único** (`20260712100000_cierre_dia/migration.sql:39-42`:
   tres índices, ninguno `UNIQUE`; no hay ningún `CREATE UNIQUE INDEX` sobre esa tabla en todo
   `db/migrations`). **Un cierre puede arrastrar más de un día de trabajo** y un mensajero puede
   tener más de un cierre. Esto es lo que hace que la unicidad del premio **no pueda** apoyarse en
   el cierre (§3.3, R19).
2. **La caja ya tiene un `egreso_pago_mensajero` con origen `(cierre_dia, cierreId)`**, escrito por
   el feed al aprobar. Reusar esa clave para el premio lo borraría en silencio (§3.4).
3. **La conciliación analítica compara el snapshot del cierre contra Σ del ledger filtrando por
   `origen_tipo = cierre_dia` y `origen_id ∈ cierres`** (`ConciliacionCierresAnaliticaRepository`,
   cabecera y `ORIGEN_CIERRE_DIA`). Un premio con ese origen entraría en la Σ y declararía un
   descuadre falso (§6, fila 16).
4. **Un cierre `rechazado` no se sustituye: se reabre** (`ESTADOS_REABRIBLES = ["vencido",
   "rechazado"]`, `CierresAdminRepository:94`). Sus gestiones siguen colgando de él, así que la
   resolución día → cierre de §4 es estable.

---

## 2. Producción está vacía, y eso cambia cómo se verifica

Medido el 2026-08-27: **los tres libros de dinero están a cero** (`wallet_movimiento`,
`pago_mensajero_movimiento`, `wallet_tienda_movimiento`), con 4 cierres aprobados cuyo
`total_pago_mensajero` suma ₡0,00.

- **No hay backfill ni reconciliación**: ningún pago previo depende del cálculo viejo, y el cambio de
  §5 no puede alterar un número que alguien ya cobró.
- **La primera fila que escriba esta feature será el primer movimiento de dinero del sistema.** La
  puesta en producción **estrena los libros**: la verificación contra producción vale más que de
  costumbre y no puede sustituirse por «la suite está verde» (§10, T6.4 de `tasks.md`).
- Con `P = 0,00`, hoy todos los cierres salen «saldados». Tras esta feature, un premio los devuelve a
  «con pendiente» — que es exactamente el caso de borde 2 (R27) y se va a ver el primer día.

---

## 3. Modelo de datos

### 3.1 Categoría propia en el libro del mensajero

Valor nuevo del enum `pago_mensajero_movimiento_categoria`: **`premio_ranking`**, en la rama
`devengo` del CHECK (el premio sube la cuenta por pagar). No se reusa `ajuste_devengo`: se rotula
«Ajuste (devengo)» y ahí ya viven los contraasientos de la anulación de liquidaciones
(`LiquidacionService.ts:1185`); mezclarlos hace imposible responder «qué parte de esta cuenta es
premio» (decisión (d) del humano).

### 3.2 Origen del movimiento del libro: el CIERRE

`origen_tipo = 'cierre_dia'`, `origen_id = <cierreId>`. Es lo que hace que el premio:

- se vea **bajo su cierre** en el desglose —`PagoMensajeroMovimientoDTO.cierreId` se deriva de ahí:
  «`origen_tipo = cierre_dia` → el `origen_id` ES el cierre» (`lib/types/wallet-mensajero.ts:89`)—;
- entre en el filtro «todo lo que pertenece a ese cierre»
  (`ListarPorMensajeroFiltros.cierreId`), sin tocar una línea de ese código;
- sea **encontrable por cierre** para el cálculo de §5, con el índice `(origen_tipo, origen_id)` que
  ya existe.

### 3.3 La columna `premio_dia` y los dos índices únicos

```sql
ALTER TABLE "pago_mensajero_movimiento" ADD COLUMN "premio_dia" DATE;
```

`premio_dia` es la **fecha calendario CR del podio** (medianoche UTC, convención del repo para fecha
calendario). `NULL` en todo lo que no es premio — que es todo lo que existe hoy, así que la migración
es aditiva y **sin backfill**.

```sql
-- CHECK, falla cerrado (patrón del CHECK tipo↔categoría de la 172)
ALTER TABLE "pago_mensajero_movimiento" ADD CONSTRAINT "pago_mensajero_movimiento_premio_dia_check"
CHECK (
  ("premio_dia" IS NULL     AND "categoria" <> 'premio_ranking')
  OR
  ("premio_dia" IS NOT NULL AND "categoria" IN ('premio_ranking','ajuste_pago'))
);

-- R17: UN premio por (mensajero, dia del podio). La guarda no negociable, en la base.
CREATE UNIQUE INDEX "pago_mensajero_movimiento_premio_dia_uq"
  ON "pago_mensajero_movimiento"("mensajero_id","premio_dia")
  WHERE "categoria" = 'premio_ranking';

-- R31: UNA anulacion por premio.
CREATE UNIQUE INDEX "pago_mensajero_movimiento_premio_reverso_uq"
  ON "pago_mensajero_movimiento"("mensajero_id","premio_dia")
  WHERE "categoria" = 'ajuste_pago' AND "premio_dia" IS NOT NULL;
```

**Por qué una columna y no la clave de origen.** Con `origen_id = cierreId`, la unicidad que la base
impondría sería «un premio por (mensajero, **cierre**)», que no es lo que el humano pidió y además
**está mal**: medido en §1.1, un cierre puede arrastrar dos días de trabajo, y entonces el premio del
segundo día chocaría contra el del primero y volvería como «ya registrado» — un fallo mudo sobre
dinero, que es la familia de fallos que este repo persigue. Con `premio_dia` la guarda es
literalmente `(mensajero, día)`, medible con un `INSERT` y sin ningún razonamiento intermedio.

**Y por eso hay que retocar el único de origen**, o el choque anterior seguiría vivo:

```sql
DROP INDEX "pago_mensajero_movimiento_origen_uq";
CREATE UNIQUE INDEX "pago_mensajero_movimiento_origen_uq"
  ON "pago_mensajero_movimiento"("origen_tipo","origen_id","mensajero_id","categoria")
  WHERE "origen_id" IS NOT NULL AND "categoria" NOT IN ('premio_ranking','ajuste_pago');
```

Es un cambio quirúrgico sobre la idempotencia del feed del cierre, así que se dice con precisión: el
feed escribe `pago_devengado` y `pago_efectivo`, que **siguen dentro** del predicado y conservan su
protección intacta; `ajuste_pago` **hoy no lo escribe nadie** (verificado: solo aparece en tipos,
rótulos y catálogo de métricas, en ninguna escritura), así que sacarlo del índice no relaja nada
vivo; y las dos categorías que salen quedan protegidas por índices **más** estrictos, no menos.

### 3.4 El egreso de la caja apunta a la FILA DEL PODIO, no al cierre

Valor nuevo del enum `wallet_origen_tipo`: **`ranking_snapshot_fila`**, con
`origen_id = ranking_snapshot_fila.id`, y se usa **solo en las dos filas de la caja** (el egreso del
premio y su reverso).

No puede apuntar al cierre, y no es preferencia: el único de la caja es
`(origen_tipo, origen_id, categoria)` **sin mensajero y sin más discriminante**, y el feed del cierre
**ya escribió** `(cierre_dia, cierreId, egreso_pago_mensajero)` al aprobar. Reusar esa clave haría
que el egreso del premio cayera en `ON CONFLICT DO NOTHING`: dinero que sale de la caja **sin quedar
registrado y sin error**. Con la fila del podio, cada premio tiene clave propia (`ranking_snapshot_fila`
es única por `(snapshot, mensajero)` y el snapshot es único por fecha).

Que las dos filas tengan orígenes distintos es correcto y significa cosas distintas: el libro del
mensajero apunta a **quién lo paga** (el cierre); la caja apunta a **de dónde nació** (el premio de
esa fila del podio).

### 3.5 Ninguna tabla nueva

No hay superficie RLS nueva; las dos tablas ya tienen RLS habilitada sin policies (solo service role)
y la migración **no la toca**.

---

## 4. La resolución «día del podio → cierre»

Función del servicio, **determinista y sin entrada del cliente**:

1. Ventana CR de la fecha del podio con `ventanaDelDia(fecha)` (`lib/ranking/snapshot-dia.ts:72`),
   **la misma** que usó el cron al congelar el ranking.
2. Cierres de ESE mensajero que contienen al menos una gestión vigente (`anulada_at IS NULL`) con
   `created_at` dentro de esa ventana. Es el vínculo semántico correcto: el cierre que liquida el
   trabajo de ese día, no el que se solicitó ese día (un cierre pedido a las 00:30 cubre el día
   anterior).
3. **Ninguno** → `sin_cierre` (R11): la pantalla dice «ese día no tiene cierre; el premio no se puede
   imputar todavía».
4. **Varios** → el más antiguo por `solicitado_at`, desempate por `id`. Determinista y estable:
   ninguna de las dos columnas cambia nunca. (Pregunta abierta Q5.)
5. El elegido **no está `aprobado`** → `cierre_no_aprobado` (R12), nombrando el estado. Un cierre
   `rechazado` **se reabre**, no se sustituye (§1.4), así que el premio se podrá registrar cuando ese
   mismo cierre se apruebe.

Se lee, no se escribe: esta feature no crea cierres ni cambia estados (fuera de alcance 6).

---

## 5. El cálculo nuevo, en un solo sitio

`lib/utils/pendiente-cierre.ts` sigue siendo la fuente única, con **firma nueva por objeto**:

```ts
derivarPendienteCierre({ pagoDebido, efectivo, premiosVivos, pagadoVigente }): string
//  = calcularSplitPago(pagoDebido, efectivo).pendiente + premiosVivos − pagadoVigente   (>= 0)
```

Tres decisiones dentro de esa línea:

1. **El premio se suma FUERA de `calcularSplitPago`** (R25). Meterlo dentro (`P + premio` contra `E`)
   daría el premio por entregado cada vez que el efectivo del día sobrara — y ese efectivo **nunca
   contuvo el premio**. Además cambiaría, a posteriori, el `min(P,E)` que el feed ya escribió al
   aprobar. `calcularSplitPago` **no se toca**.
2. **Parámetro por objeto, no posicional.** Los cuatro son montos del mismo tipo: en posicional, un
   orden equivocado compila y descuadra en silencio. Con campos nombrados, no. Y como el objeto es
   obligatorio, **cada consumidor deja de compilar** hasta que decida qué pasa: el barrido de §6 lo
   impone el compilador, no la memoria de nadie.
3. **`premiosVivos`** = Σ(`premio_ranking` de ese cierre) − Σ(`ajuste_pago` con `premio_dia` de ese
   cierre). Lo calcula el repositorio del libro en **una** consulta por listado:

```ts
// IPagoMensajeroMovimientoRepository
sumarPremiosVivosPorCierre(cierreIds: string[]): Promise<Record<string, string>>
// WHERE origen_tipo='cierre_dia' AND origen_id IN (...) AND (categoria='premio_ranking'
//       OR (categoria='ajuste_pago' AND premio_dia IS NOT NULL))
// -> una entrada "0.00" por CADA id pedido (patrón de `sumarVigentesPorCierre`)
```

Una llamada por página, nunca una por fila: la misma propiedad que `sumarVigentesPorCierre` ya
cumple y que la 170 exige del listado.

---

## 6. El barrido: todos los consumidores, uno por uno

Quien responde «cuánto se le debe» o «¿está saldado?» **pasa al cálculo nuevo**. Quien responde «qué
dijo el cierre» **se queda con el snapshot**. La lista completa, con la decisión y el motivo:

| # | Consumidor | Qué responde | Decisión | Por qué |
| --- | --- | --- | --- | --- |
| 1 | `lib/utils/pendiente-cierre.ts::derivarPendienteCierre` | «cuánto falta por entregar de este cierre» | **PASA** (firma nueva) | Es la fuente única; todo lo demás cuelga de aquí. |
| 2 | `lib/utils/cuenta-por-pagar.ts::calcularSplitPago` | `min(P,E)` del día | **No cambia** | El efectivo del día no contenía el premio (R25). Tocarlo reescribiría lo que el feed ya escribió. |
| 3 | `LiquidacionService.imputablesDe` (`:994`) | «qué cierres tienen pendiente > 0» (reparto) | **PASA** | Sin esto el premio nunca entra en la ventana imputable y no se puede cobrar: es el corazón de la decisión humana. |
| 4 | `LiquidacionService.pendienteDelCierre` → `registrarPagoMensajero` | «cuánto puedo pagar contra ESTE cierre» | **PASA** | Sin esto, pagar el premio devolvería `excede` o `sin_saldo`. |
| 5 | `LiquidacionService.previsualizarRepartoMensajero` (`:374`) | «cuánto se puede saldar» y «deuda no imputable» | **PASA** (hereda de 3) | Con el premio imputable, `deudaNoImputable` deja de contarlo: la cifra se corrige sola, sin tocar ese bloque. |
| 6 | `CierresAdminService.conPendiente` (`:833`) → listado, histórico y detalle | «pendiente de liquidar» (badge) | **PASA** | Es la pantalla donde se ve el caso de borde 2 (R27). Necesita la dependencia nueva del §7. |
| 7 | `CierresAdminService.pendienteTrasAprobar` (`:888`) | pendiente del cierre recién aprobado | **PASA** | Misma función, por coherencia: al aprobar aún no puede haber premio, pero dos fórmulas para el mismo número es como dos pantallas dicen cifras distintas. |
| 8 | `LiquidacionPagoRepository.sumarVigentesPorCierre` (`:364`) | Σ pagos vigentes | **No cambia** | Mide pagos, no deuda. Sigue entrando como un término. |
| 9 | `LiquidacionPagoRepository.listarCierresImputables` (`:239`) | qué cierres se consideran | **No cambia el WHERE** (`estado: aprobado` + `mensajeroId`) | El recorte por «pendiente > 0» vive en el servicio (3) y ya pasa por el cálculo nuevo. |
| 10 | `WalletMensajeroFeedService` (aprobación del cierre) | qué escribe el cierre al aprobarse | **No cambia** | El premio no existe al aprobar; su egreso lo emite su propio registro. La guardia `caja-173-alcance` (egreso = `P`, no `min(P,E)`) sigue verde. |
| 11 | `cierre_dia.total_pago_mensajero` y `cierre_detail` | «qué dijo el cierre» | **Nunca se toca** (R13) | Es el snapshot; reescribirlo es reescribir la historia. |
| 12 | `cierre-factura.tsx` y las descargas de cierres | impresión y archivo | **No cambian** | Son la foto del cierre. Verificado además que **ninguna descarga proyecta `pendientePagoMensajero`** (no hay ninguna aparición en `_components/*descarga*`), así que no hay columna que corregir. |
| 13 | `/cierre-dia` (vista del mensajero) | «mi cierre» | **No cambia** | Verificado: no publica ningún pendiente de dinero; sus «pendientes» son órdenes sin gestionar. |
| 14 | Desglose por cierre del mensajero (`ListarPorMensajeroFiltros.cierreId`) | «movimientos de este cierre» | **No cambia** (hereda) | El premio entra solo, por `origen_tipo = cierre_dia`. Es justo lo que el humano pidió ver. |
| 15 | `PagoMensajeroMovimientoDTO.cierreId` (derivado, `wallet-mensajero.ts:82-95`) | «¿a qué cierre pertenece esta fila?» | **No cambia** (hereda) | Correcto por construcción con el origen de §3.2. |
| 16 | `ConciliacionCierresAnaliticaRepository` | «¿el ledger cuadra con el snapshot del cierre?» | **CAMBIA: excluye `premio_ranking` y el `ajuste_pago` con `premio_dia`** | Compara el snapshot contra lo que el cierre movió **al aprobarse**. El premio nace después y no está en el snapshot: sin el filtro, **cada premio declara un descuadre falso** y dispara el aviso del servicio. |
| 17 | Métrica `cuenta_por_pagar_mensajero` (`lib/analytics/metrics.ts:697`) | cuenta por pagar | **No cambia** el cálculo (agrega por `tipo`); **sí** se añade `premio_ranking` a las categorías citadas | El premio es un devengo más; el catálogo debe nombrarlo o queda incompleto. |
| 18 | `lib/utils/finanzas-diarias.ts` (caja por día) | «pago a mensajeros del día» | **No cambia** | El egreso del premio ya usa `egreso_pago_mensajero`, que esa función suma por categoría. |
| 19 | `CorteDiarioService` y `lib/utils/bloqueo-cierre.ts` | «¿hay que crear cierre?», «¿está bloqueado?» | **No cambian** | No leen dinero. |
| 20 | `WalletMensajeroService` (cuentas por pagar del maestro y `/mis-pagos`) | Σ devengo − Σ pago | **No cambia** | Se deriva del libro; el premio entra solo, con su rótulo. |

**Cómo se comprueba que la lista está completa y no es una promesa:** la firma por objeto de §5 hace
que **todo** consumidor de `derivarPendienteCierre` deje de compilar. Los que aparecen arriba como
«PASA» son exactamente los que `tsc` señala (1, 3, 4, 6, 7 + sus tests). Si mañana apareciera uno
nuevo, tampoco compilaría. Las filas «no cambia» son las que responden a la otra pregunta, y cada una
tiene su test de no-regresión en `tasks.md`.

---

## 7. Capas y archivos

```
app/(app)/wallet/mensajeros/page.tsx                  (existente) monta la sección nueva
  └─ _components/PremiosRankingPanel.tsx              NUEVO (client): fecha + podio + acciones
lib/actions/premio-ranking-devengo.ts                 NUEVO ('use server'): 3 Server Actions
  └─ lib/services/PremioRankingDevengoService.ts      NUEVO: gate de rol, resolución §4 y escritura
       ├─ IRankingSnapshotRepository.listarPodioDeFecha()          NUEVO (lectura)
       ├─ ICierreDelDiaRepository.resolverCierreDelDia()           NUEVO (lectura, §4)
       ├─ IPagoMensajeroMovimientoRepository
       │    ├─ listarPremiosPorDias()                              NUEVO (estado del panel)
       │    ├─ sumarPremiosVivosPorCierre()                        NUEVO (§5; lo usan 3, 4, 6, 7)
       │    └─ crearMovimientos()                                  EXISTENTE (única escritura)
       ├─ ICajaPremioRankingFeedService                            NUEVO puerto estrecho de caja
       └─ PremioTxRunner                                           transacción inyectada

lib/utils/pendiente-cierre.ts                         CAMBIA (firma por objeto, §5)
lib/services/LiquidacionService.ts                    CAMBIA (2 call-sites + nueva lectura)
lib/services/CierresAdminService.ts                   CAMBIA (2 call-sites + dependencia nueva)
lib/repositories/ConciliacionCierresAnaliticaRepository.ts  CAMBIA (filtro de categorías, §6/16)
```

- **Server Actions y no route handler**: mutación interna del propio proyecto, igual que
  `lib/actions/wallet-mensajero.ts`.
- **Puerto estrecho para la caja**: `ICajaPremioRankingFeedService` expone `emitirEgresoPremio` y
  `reversarEgresoPremio` y **no acepta tipo ni categoría** (los fija su implementación con
  literales), de modo que el servicio del premio no puede *expresar* otra escritura en la caja. Es el
  patrón de `ICajaPagoTiendaFeedService` (173/R23).
- **El repositorio sigue siendo el único escritor** de cada libro (censo de
  `caja-173-alcance.guardia.test.ts:91-105`): el servicio llama a `crearMovimientos`, nunca a
  `prisma.pagoMensajeroMovimiento.*`.
- **`CierresAdminService` gana una dependencia de solo lectura**, con el mismo criterio con el que ya
  recibe la de liquidación: `Pick<IPagoMensajeroMovimientoRepository, "sumarPremiosVivosPorCierre">`.
  Un `Pick` de un método deja escrito —y hace que el typecheck lo imponga— que la pantalla de cierres
  puede **derivar** el pendiente y no puede escribir un premio.

### 7.1 Las dos escrituras

**Registro** (una transacción, todo o nada):

| Libro | tipo | categoría | monto | origen_tipo | origen_id | premio_dia |
| --- | --- | --- | --- | --- | --- | --- |
| `pago_mensajero_movimiento` | `devengo` | `premio_ranking` | congelado | `cierre_dia` | `<cierreId>` | fecha del podio |
| `wallet_movimiento` | `egreso` | `egreso_pago_mensajero` | el mismo | `ranking_snapshot_fila` | `<filaId>` | — |

Descripción (R22): `Premio del ranking 2026-08-26 · posición 1 · Bono por buen rendimiento`.
`registrado_por` = actor. `fecha_movimiento` = **default de la columna** (instante del registro,
R23): no se pasa el parámetro opcional que la 172 añadió para fechar en el pasado, porque
`lib/utils/finanzas-diarias.ts` agrega la caja **por día** y fechar hoy un egreso en el 26/08
reescribiría el dinero de un día ya leído.

**Anulación** (misma transacción, mismas claves, filas originales intactas):

| Libro | tipo | categoría | monto | origen_tipo | origen_id | premio_dia |
| --- | --- | --- | --- | --- | --- | --- |
| `pago_mensajero_movimiento` | `pago` | `ajuste_pago` | el mismo | `cierre_dia` | `<cierreId>` | fecha del podio |
| `wallet_movimiento` | `ingreso` | `ingreso_ajuste` | el mismo | `ranking_snapshot_fila` | `<filaId>` | — |

En la caja se usa `ingreso_ajuste` y **no** se crea un `ingreso_reverso_pago_mensajero`: la 173 creó
`ingreso_reverso_pago_tienda` porque allí el reverso habría inflado la ganancia con dinero de
terceros (`20260803120000_caja_tesoreria/migration.sql:7-11`); aquí el egreso original **ya era
propio**, así que revertirlo con `ingreso_ajuste` deja la ganancia exactamente como estaba.

### 7.2 Idempotencia: qué pasa exactamente al reintentar

Las dos escrituras van por `createMany({ skipDuplicates: true })` → `ON CONFLICT DO NOTHING` sobre
índices únicos, sin check-then-insert y sin TOCTOU, devolviendo cuántas filas se insertaron.

- Primer intento: 1 + 1 → `{ status: "ok" }`.
- Reintento (doble clic, reintento de red, dos pestañas): 0 + 0 → `{ status: "ya_registrado" }`, sin
  error, sin segunda fila y sin tocar la existente. `DO NOTHING` no lanza: la transacción no aborta.
- Premio de **otro día** imputado al **mismo cierre**: claves distintas
  (`premio_dia` distinto, fila del podio distinta) → se registra (R19).
- Tras anular: la fila del premio sigue ahí, así que el índice de R17 rechaza un nuevo registro; el
  servicio lo responde como `anulado` (R32) y **no** como `ya_registrado`, para que la pantalla pueda
  decir la verdad.

### 7.3 Contratos de las Server Actions

```ts
listarPremiosDelDiaAction(input: { fecha: string })
  -> { status: "ok"; fecha: string; hayPodio: boolean; filas: PremioPodioDTO[] }
   | { status: "forbidden" } | { status: "unauthenticated" } | { status: "validation_error"; ... }

interface PremioPodioDTO {
  filaId: string; posicion: number; mensajeroNombre: string;
  entregadas: number; asignadas: number;                 // R5: siempre, aunque sean 0
  premioMonto: string | null; premioDescripcion: string | null;
  estado: "sin_premio" | "sin_cierre" | "cierre_no_aprobado"
        | "no_registrado" | "registrado" | "anulado";    // R9
  cierreEstado: string | null;                           // para el texto de R12
}

registrarPremioAction(input: { filaId: string })
  -> { status: "ok"; monto: string; cierreId: string }
   | { status: "ya_registrado" } | { status: "anulado" }
   | { status: "sin_premio" } | { status: "sin_cierre" }
   | { status: "cierre_no_aprobado"; estado: string }
   | { status: "no_encontrado" } | { status: "forbidden" } | { status: "unauthenticated" }
   | { status: "validation_error"; ... }

anularPremioAction(input: { filaId: string; motivo: string })
  -> { status: "ok" } | { status: "ya_anulado" } | { status: "no_registrado" }
   | { status: "forbidden" } | { status: "unauthenticated" } | { status: "validation_error"; ... }
```

**La entrada del cliente es `filaId` (y el motivo) y nada más** (R16): mensajero, fecha, posición,
monto y **cierre** los resuelve el servidor. Validación con zod en el borde: `filaId` no vacío;
`fecha` con `esFechaCalendarioValida` (`lib/utils/fecha-cr.ts:73`, el mismo refinamiento que usa
`lib/actions/ranking-historico.ts:31-35`) y no posterior a `fechaCalendarioCR()` (R8); `motivo`
recortado y no vacío (R30).

---

## 8. Permisos

«Solo el maestro» se expresa hoy en Wallet con `esAccesoTotal(actor.rol)` = `maestro` **o** `admin`
(paridad de la feature 94). Se usa **el mismo predicado**, en las dos mitades:

1. **Pantalla**: `page.tsx` ya hace `notFound()` para cualquier otro rol o sin sesión; el panel vive
   dentro, así que el rol no existe en el cliente.
2. **Servicio**: `forbidden` **antes de leer o escribir nada**, en los tres métodos, igual que
   `WalletMensajeroService.listarCuentasPorPagar` (`:174`).

Sin sesión → `unauthenticated` resuelto en el borde de la action (patrón de
`lib/actions/wallet-mensajero.ts:91`).

---

## 9. Pantalla

Sección nueva en `/wallet/mensajeros`, encima de la tabla de cuentas por pagar:

```
Premios del ranking
[ fecha: 2026-08-26 ▾ ]     (por defecto: ayer en CR — `fechaObjetivo`, el día que congela el cron)

 1.º  Kevin Rojas    0 / 21 entregadas    ₡5.000  «Bono por buen rendimiento»   [ Registrar ]
 2.º  Ana Mora      14 / 20 entregadas    sin premio
 3.º  Luis Vargas   11 / 19 entregadas    ₡2.000  — ese día no tiene cierre; no se puede imputar
```

- **`entregadas / asignadas` siempre visible y pegado al premio** (R5): es el aviso del 26/08.
- Estados (R9), todos con **texto**, nunca con la ausencia del control: `Registrar` / `Registrado el
  … — se cobra con el cierre del <fecha>` + `Anular` / `Anulado — no se puede volver a registrar`
  (R32) / `Sin premio asignado` / `Ese día no tiene cierre` (R11) / `El cierre de ese día está
  <estado>` (R12).
- Fecha sin podio (R6): «Ese día no tiene ranking congelado», sin controles.
- La anulación pide **motivo** en un diálogo antes de enviar (R30).
- Money-safe (R35): montos STRING del servidor, pintados con el helper `money` de
  `wallet-mensajeros-labels.ts`. Ni `Number(`, ni `parseFloat`, ni una resta en el cliente.
- Tras registrar o anular se refrescan **solo** las claves SWR de este panel y del mensajero
  afectado, y **el listado de cuentas por pagar** (su cifra cambió).

**Caso de borde 2 (R27), lo que ve el usuario:** el cierre que estaba saldado vuelve a aparecer en
`/cierres-admin` con el badge «Pendiente de liquidar ₡5.000», y en `/wallet/mensajeros` el diálogo de
pago vuelve a habilitarse con ₡5.000 disponibles y una imputación a ese cierre. No hay ningún estado
nuevo que inventar: es deuda nueva sobre un cierre aprobado, y todas las pantallas lo derivan de §5.

### 9.1 Rótulos (R34)

`CATEGORIA_PAGO_LABEL` es un `Record<PagoMensajeroMovimientoCategoria, string>` en **dos** archivos
(`wallet-mensajeros-labels.ts:161` y `mis-pagos-labels.ts:28`): al añadir el valor al enum **los dos
dejan de compilar** hasta que se añade el rótulo — el compilador es la guardia. Se añade
`premio_ranking: "Premio del ranking"` en ambos, y con eso quedan cubiertos el desglose del maestro,
`/mis-pagos` y las dos descargas, que derivan su columna «concepto» del mismo mapa
(`desglose-mensajero-descarga-columnas.ts:52`, `mis-pagos-descarga-columnas.ts:49`).

---

## 10. Migración

Una carpeta, `db/migrations/<timestamp>_premio_ranking_devengo/`, con `migration.sql` y `down.sql`.
El timestamp debe ser estrictamente mayor que el de la última carpeta existente.

**UP**, en este orden:

1. `ALTER TYPE "pago_mensajero_movimiento_categoria" ADD VALUE IF NOT EXISTS 'premio_ranking';`
2. `ALTER TYPE "wallet_origen_tipo" ADD VALUE IF NOT EXISTS 'ranking_snapshot_fila';`
3. `ADD COLUMN "premio_dia" DATE` (nullable; sin backfill: hoy no hay ninguna fila de premio).
4. `DROP` + `ADD` de `pago_mensajero_movimiento_tipo_categoria_check` con `premio_ranking` en la rama
   `devengo`.
5. `ADD CONSTRAINT "pago_mensajero_movimiento_premio_dia_check"` (§3.3).
6. `DROP` + `CREATE` de `pago_mensajero_movimiento_origen_uq` con el predicado nuevo (§3.3).
7. Los dos índices únicos parciales del premio y su reverso (§3.3).

**El paso 4 es el que nadie ve venir.** El CHECK de la 172 es una disyunción de listas cerradas
escrita para fallar cerrado: «mejor que la feature que añada el concepto tenga que tocar este CHECK, a
que su primera fila caiga en la cubeta equivocada»
(`20260802120000_liquidacion_pago/migration.sql:114-117`). Si se olvida, el síntoma no es un saldo
torcido: es que **ningún premio se puede registrar jamás**, con un 23514 en producción.

**Usar los valores nuevos del enum en la misma migración que los añade** tiene precedente aplicado en
producción: `20260803120000_caja_tesoreria/migration.sql` añade dos valores (líneas 28 y 31) y los usa
en el CHECK de las líneas 61-71 del mismo archivo. Se replica ese patrón. **Si al aplicarla el runner
devolviera `unsafe use of new value`**, la salida es partir la carpeta en dos (los dos `ALTER TYPE` en
la primera y el resto en la segunda); **no** se resuelve quitando el `IF NOT EXISTS` ni metiendo
`COMMIT` a mano.

**DOWN**, en orden inverso y con la coreografía de índices que exige Postgres (no hay `DROP VALUE`;
los tipos se recrean):

1. Soltar los dos índices del premio y el CHECK de `premio_dia`.
2. Soltar `..._tipo_categoria_check` (nombra `'premio_ranking'`).
3. Soltar los **seis** índices que referencian `origen_tipo` — dos por cada uno de los tres libros que
   comparten `wallet_origen_tipo` (`wallet_movimiento`, `wallet_tienda_movimiento`,
   `pago_mensajero_movimiento`). Olvidar uno deja el tipo `_old` con dependientes y el `DROP TYPE`
   **aborta el rollback a mitad** (está escrito en `.../orden_incidente/down.sql:13-18`).
4. Recrear `wallet_origen_tipo` con sus 7 valores previos + `ALTER COLUMN` en las tres tablas +
   `DROP TYPE _old`.
5. `DROP COLUMN "premio_dia"` (antes de recrear el enum de categoría: la columna ya no existe, así
   que nada la referencia).
6. Recrear `pago_mensajero_movimiento_categoria` con sus 5 valores previos + `ALTER COLUMN` +
   `DROP TYPE _old`.
7. Recrear los seis índices con el mismo nombre y forma, incluido
   `pago_mensajero_movimiento_origen_uq` **con su predicado original** (`WHERE origen_id IS NOT NULL`,
   sin la exclusión de categorías), y volver a poner el CHECK con la lista original de cinco.

Precondición documentada en el propio `down.sql`: ninguna fila puede usar los valores que se retiran;
si la hay, el `USING ('...'::text::"tipo")` falla y el rollback **aborta con un error claro**, que es
lo correcto: revertir con premios ya devengados no es seguro.

**Ningún `down.sql` previo se toca.** Verificado: los únicos archivos que mencionan
`pago_mensajero_movimiento_categoria` son la migración que lo crea y su `down.sql`, que hace
`DROP TYPE IF EXISTS` (no recrea con lista). Para `wallet_origen_tipo`, el único down que lo recrea
con lista es el de la 158, y en un rollback los downs corren del más nuevo al más viejo: cuando se
ejecute, el valor de esta feature ya se habrá retirado. Son fotos históricas.

---

## 11. Alternativas descartadas

**A. Reescribir `cierre_dia.total_pago_mensajero` sumándole el premio.** Es lo primero que se piensa y
lo peor que se puede hacer: ese snapshot es la foto de lo que el cierre dijo el día en que se aprobó,
la factura del mensajero se imprime de él y la conciliación analítica lo usa como lado «declarado».
Reescribirlo hace que la factura de ayer cambie hoy y que el descuadre se vuelva indetectable. **La
prohibición es explícita del humano** (R13).

**B. Unicidad del premio por la clave de origen (`origen_tipo`, `origen_id`, `mensajero_id`,
`categoria`), sin columna nueva.** Cero DDL sobre columnas. Descartada por medición: `cierre_dia` no
tiene ningún índice único, así que un cierre puede arrastrar dos días de trabajo; el premio del
segundo día chocaría con el del primero y volvería como «ya registrado» — un fallo mudo sobre dinero
(R19). Y además la guarda que impondría sería «por cierre», no «por (mensajero, día)», que es lo que
el humano pidió.

**C. El egreso de la caja con origen `(cierre_dia, cierreId)`.** Habría dado un origen único para las
dos filas. Descartada por medición: el feed del cierre ya escribió
`(cierre_dia, cierreId, egreso_pago_mensajero)` al aprobar, y el único de la caja no distingue nada
más, así que el egreso del premio caería en `DO NOTHING` — dinero fuera de la caja sin registro y sin
error (§3.4).

**D. Sumar el premio dentro de `calcularSplitPago` (`P + premio` contra `E`).** Sería una línea menos.
Descartada: con efectivo de sobra el premio saldría **ya pagado**, cuando ese efectivo nunca lo
contuvo; y cambiaría a posteriori el `min(P,E)` que el feed ya escribió al aprobar el cierre (R25).

**E. Reusar `ajuste_devengo` en vez de una categoría propia.** Cero migración. Descartada por la
decisión (d): se rotula «Ajuste (devengo)», mezclada con los contraasientos de anulación de
liquidaciones, y no habría forma de responder «cuánto de esta cuenta es premio» sin leer
descripciones a ojo.

**F. Emitir el premio automáticamente al congelar el ranking o al aprobar el cierre.** Descartada por
las decisiones (a) y (b): siempre hay acto humano, y dos caminos que escriben el mismo asiento de
dinero es como se paga dos veces. Además el podio puede salir por orden alfabético con todos a 0 %.

**G. Fechar el movimiento en el día del podio.** Descartada por R23: la caja se agrega por día y
fechar hoy un egreso en el 26/08 cambia el dinero de un día ya leído. La fecha del podio no se pierde:
está en `premio_dia` y en la descripción.

---

## 12. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Olvidar el CHECK tipo↔categoría | Test [PG] que registra un premio de verdad; un 23514 sale rojo en el acto. |
| Que un consumidor de «lo pagable» se quede atrás | La firma por objeto rompe la compilación en todos; §6 los enumera uno a uno y cada uno tiene test. |
| Descuadre falso en la conciliación | §6/16: filtro explícito + test que lo mide con un premio sembrado. |
| Retocar `pago_mensajero_movimiento_origen_uq` afloja la idempotencia del feed | El feed escribe categorías que **siguen dentro** del predicado; test [PG] de doble aprobación del mismo cierre. |
| Base local compartida entre worktrees: la migración pone rojos gates ajenos | Conocido. Se aplica con `prisma migrate deploy` y se avisa. |
| Cliente Prisma rancio tras el enum nuevo | `prisma generate` + reiniciar el dev server. |
| Estrenar los libros en producción | §2: la verificación contra producción es obligatoria y va con importes anotados. |
