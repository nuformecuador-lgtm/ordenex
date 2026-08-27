# Revisión — ficha 293: el premio del ranking en la cuenta por pagar del mensajero

**Rama:** `feature/293-premio-ranking-cuenta-por-pagar` · **Revisado:** 2026-08-27
**Estado del árbol revisado:** todo **sin commitear** (24 archivos nuevos + 61 modificados).
**Revisor:** subagente `reviewer`. No se editó código; las dos mutaciones de §5 se aplicaron,
se midieron y se restauraron **byte a byte** (verificado con `diff -q`).

> **Contexto de ejecución.** Había un gate completo corriendo en paralelo al arrancar la
> revisión (11 procesos `node`, `vitest run`). No se lanzó `./init.sh` ni la suite entera. Las
> mutaciones se aplicaron **después** de que el gate terminara (16:38), nunca en paralelo — la
> regla del repo: el gate lee el árbol mutado y su veredicto no vale.

---

## 1. Veredicto

## **RECHAZADO**

Dos bloqueantes, los dos de **evidencia que la propia entrega se exige por escrito y no entregó**.
Ninguno pide rediseño: el modelo de datos, el barrido de consumidores, la idempotencia y la
atomicidad están **medidos y correctos**. Lo que falta son dos artefactos concretos y baratos.

No hay ningún hallazgo que hoy mueva dinero mal. Lo que hay es un hueco de verificación
exactamente donde el compilador no llega (B2) y la ausencia del documento que sostiene tres
afirmaciones que hoy nadie puede comprobar (B1).

---

## 2. Checklist de CHECKPOINTS.md

### Especificación
- [x] `specs/293-.../requirements.md` con **R1..R35** en EARS, numerados.
- [x] `specs/293-.../design.md` con **siete** alternativas descartadas y su porqué (§11 A-G).
- [~] `specs/293-.../tasks.md` existe. **No usa casillas `[x]`**: el formato de esta ficha es
      `### T<n>` + criterio `**Hecho:**` por tarea. El registro de «hecho» vive, por diseño de la
      propia ficha (T6.2), en `progress/impl_293-...md` — **que no existe** (→ B1).

### Trazabilidad
- [x] Cada `R<n>` mapea a un test que existe y corre. Verificado uno a uno en §3; **35/35**.
- [ ] **`progress/impl_293-premio-ranking-cuenta-por-pagar.md` NO EXISTE** (→ **B1**).
      `ls progress/ | grep -i 293` devuelve vacío; tampoco aparece como untracked.

### Calidad de código
- [x] `pnpm run typecheck` → `TC_EXIT=0` (ejecutado por mí, 16:41).
- [x] `pnpm run lint` → `LINT_EXIT=0` (110 warnings preexistentes, **0 errores**).
- [x] Tests: **530 verdes en 19 archivos** relacionados con la 293 (ejecutados por mí, ver §5).
      La suite completa la corrió el gate en paralelo; no la dupliqué.
- [n/a] E2E Playwright para flujos de dinero: **inaplicable en este repo** (no hay harness E2E;
      los specs existentes lo declaran «NOT EXECUTED»). El riesgo se cubre con los tests [PG]
      contra Postgres real, que sí existen y sí corren.

### Datos y seguridad (Supabase)
- [x] **RLS:** no hay tabla nueva → no hay superficie RLS nueva. La migración **no toca RLS ni
      policies** (test estático: `not.toMatch(/ROW LEVEL SECURITY/i)` y `/POLICY/i`).
      `pago_mensajero_movimiento` y `wallet_movimiento` conservan RLS habilitada sin policies.
- [~] **Migración reversible:** existe `down.sql`. **No pude ejecutar `pnpm run db:rollback`**:
      la acción fue **denegada por el clasificador de permisos**. No la rodeé por otra vía.
      Lo que **sí** medí, en solo-lectura contra el Postgres local (ver §4.4): el `down.sql`
      suelta **todos** los objetos que de verdad dependen de los dos enums en el catálogo
      —9 para `wallet_origen_tipo`, 6 para `pago_mensajero_movimiento_categoria`—, ninguna de
      las tres columnas tiene `DEFAULT`, y no hay vistas, funciones ni reglas colgando.
      Queda **pendiente de ejecutar** el round-trip real (→ P1).
- [x] Sin secretos hardcodeados. Nada nuevo lee `process.env`.
- [n/a] Webhooks: esta feature no añade ninguno; R1/R3 lo prohíben y hay guardia que lo censa.

### Patrón de capas
- [x] Server Actions (`lib/actions/premio-ranking-devengo.ts`) sin queries ni negocio: resuelven
      actor, validan con zod y delegan.
- [x] `PremioRankingDevengoService` no conoce HTTP ni Prisma: la transacción se inyecta
      (`PremioTxRunner`), y su `tx` es `Pick<PrismaClient, "pagoMensajeroMovimiento" | "walletMovimiento">`
      — no puede tocar `cierre_dia` ni el ledger de tienda **aunque quisiera**.
- [x] `CierreDelDiaRepository` es solo `findFirst`; `PagoMensajeroMovimientoRepository` sigue
      escribiendo únicamente por `createMany` (verificado: no hay `update`/`delete`/`upsert`).
- [x] Interfaces en `lib/interfaces/{repositories,services}/`.

### Permisos
- [x] `page.tsx` resuelve el actor por sesión y hace `notFound()` para todo lo que no sea acceso
      total; el panel vive dentro y **no decide rol en el cliente**.
- [x] El servicio responde `forbidden` **antes de la primera lectura**, en los tres métodos, con
      el mismo predicado `esAccesoTotal` (maestro/admin, paridad 94). Test con log vacío.
- [x] Mutaciones internas por Server Actions, no por API routes. La guardia lo censa.

### Multi-país / configuración
- [x] Ningún país, moneda ni cuenta hardcodeados. Los importes se pintan con `money` de
      `lib/config/moneda.ts`.

### Verificación final
- [~] `./init.sh` completo: lo corre el leader en paralelo; no lo dupliqué (encargo explícito).
- [x] Este archivo existe. Veredicto: **RECHAZADO**.
- [ ] **Sin entrada en `progress/history.md`** para la 293 (→ m5).

---

## 3. Trazabilidad R→test, requisito por requisito

Recorrida entera la matriz de `tasks.md`. **Los 35 tienen test, existe y corre.** Se buscaron
activamente las tres formas de test que mienten; el resultado está en la última columna.

| R | Test que lo cubre | ¿De verdad lo cubre? |
| --- | --- | --- |
| R1 | `premio-ranking-alcance.guardia.test.ts` (censo del árbol) + `wallet-mensajeros-page.test.tsx` | **Sí.** El censo lleva no-vacuidad explícita (`FUENTES.length > 500`) y la lista de `lib/` se declara ENTERA con `toEqual`: un séptimo archivo rompe. |
| R2 | `premio-ranking-devengo-service.test.ts` («los TRES metodos… y no tocan un solo repositorio») × 3 roles | **Sí.** Afirma `expect(d.log).toEqual([])`: no es «devolvió forbidden», es «no consultó nada». |
| R3 | guardia de alcance («ni el feed del cierre, ni la liquidacion…»; «no hay ninguna ruta de API ni ningun cron») | **Sí.** Los 6 módulos prohibidos se comprueban y además se afirma que tienen contenido (no-vacuidad). |
| R4 | `premio-ranking-lecturas.test.ts` (`293/T3.1`) + servicio + **[PG]** «R4/R5/R7/R9» | **Sí.** El [PG] siembra 3 filas de podio reales y relee. |
| R5 | `PremiosRankingPanel.test.tsx` («0 de 21 se pinta con sus dos números, no con un guion») | **Sí.** Literal `0 / 21 entregadas`, ausencia del guion, y premio y botón en la MISMA fila. |
| R6 | servicio (`podio: null`) + panel + repo (`null` distinto de `[]`) + **[PG]** (`2026-01-01`) | **Sí.** |
| R7 | servicio, bucle `[null, "0.00", "0"]`, con `Prisma.Decimal` para el cero | **Sí.** Y comprueba que **no** se consulta el cierre. |
| R8 | `premio-ranking-devengo-actions.test.ts` (`2026-02-31`, `2026-8-26`, mañana en CR, y ACEPTA hoy) | **Sí.** El 31 de febrero es el caso que un regex de forma dejaría pasar. |
| R9 | servicio (las 6 ramas) + panel (los 6 textos) | **Sí.** |
| R10 | **[PG]** casos 4 y 7 + `premio-ranking-lecturas.test.ts` (`293/T3.2`) + **[PG]** §4.2/§4.4 | **Sí.** |
| R11 | servicio + panel + **[PG]** «un dia con podio pero SIN cierre» | **Sí.** El [PG] siembra un cierre cuya gestión es de OTRO día: no basta con que no haya cierre. |
| R12 | servicio (3 estados) + panel + **[PG]** (bucle `solicitado`/`rechazado`/`vencido`) | **Sí.** |
| R13 | guardia (censo de escritores de `totalPagoMensajero`) + **[PG]** casos 7 y 8, que **releen** `total_pago_mensajero` tras registrar y tras anular | **Sí.** |
| R14 | servicio (`toEqual` de la fila entera) + **[PG] migración**: `devengo`+`premio_ranking` ENTRA; `pago`+`premio_ranking` da 23514 | **Sí.** Es el paso 4 de §10 medido contra el motor. |
| R15 | servicio (monto congelado `1234.56`) + guardia («el servicio no puede leer el premio VIGENTE», con no-vacuidad: ese repo existe y otros lo usan) | **Sí.** |
| R16 | servicio (`toEqual` sobre lo escrito) + actions (`.strict()` mata `monto`, `mensajeroId`, `cierreId`, `premioDia`) | **Sí.** |
| R17 | **[PG]** caso 1 (dos registros, 1 fila) y caso 2 (**INSERT directo** con otro cierre da `P2002`) + catálogo `pg_indexes` con el predicado | **Sí, y es la base quien lo impide.** El caso 2 se salta el servicio entero. |
| R18 | **[PG]** casos 1 y 3 + servicio | **Sí.** |
| R19 | **[PG]** caso 4: dos días distintos al MISMO cierre dan 2 premios, mismo `origen_id`, `premio_dia` distinto | **Sí.** Es la medición que descarta la alternativa B. |
| R20 | `caja-premio-ranking-feed.test.ts` + **[PG]** casos 5 y 6 | **Sí.** El caso 5 siembra el `egreso_pago_mensajero` del feed del cierre ANTES y comprueba que sigue intacto y solo. |
| R21 | guardia (el servicio no llama a ninguna escritura de Prisma; su `tx` no expone `cierreDia`) + repo con solo `createMany` | **Sí.** |
| R22 | servicio: descripción **literal** con fecha, posición y descripción congelada; y el caso sin descripción | **Sí.** Literal, no derivado de la función que lo genera. |
| R23 | servicio (`not.toHaveProperty("fechaMovimiento")`) + puerto de caja (ídem) | **Sí.** |
| R24 | `pendiente-cierre.test.ts` + **[PG]** caso 7 + los 5 tests de call-site | **Sí.** |
| R25 | `pendiente-cierre.test.ts` («con E mayor o igual que P el premio NO se da por entregado») + `liquidacion-service.test.ts` (`excede`, `disponible: "5000.00"`) | **Sí, y con literales.** El test escribe además la contraprueba de la alternativa D. |
| R26 | `tsc` (firma por objeto) + los **5** tests de call-site | **Casi.** Falta la «guardia de que nadie reimplementa la fórmula» que la propia matriz promete (→ **m2**). |
| R27 | **[PG]** caso 7 + `CierrePremioPendiente.test.tsx` + `cierres-admin-pendiente.test.ts` | **Sí.** El fixture pone snapshot (10.000) y deuda (5.000) **en desacuerdo a propósito**: una pantalla que pintara el snapshot no pasaría. |
| R28 | `financiera-conciliacion-repo.test.ts` (4 casos) | **Sí.** El fake evalúa el `where` de verdad (se le añadieron `AND`/`OR`/`NOT` y el operador `not`), y hay no-vacuidad que afirma que las filas del premio existen, tienen importe y caen en el rango. |
| R29 | servicio + **[PG]** caso 8 | **Sí.** |
| R30 | actions (vacío, solo espacios, `null`, ausente) + panel (botón deshabilitado **y** segunda barrera en `confirmar()`) | **Sí.** |
| R31 | **[PG]** caso 8 (la segunda anulación responde `ya_anulado`, libro con 2 filas) + servicio | **Sí.** |
| R32 | **[PG]** caso 9 (responde `anulado`, no `ya_registrado`) + panel («anulado — no se puede volver a registrar») | **Sí.** |
| R33 | **[PG]** caso 8: con premio `5000.00`, tras anular `0.00`, sobre datos reales | **Sí.** |
| R34 | `PremioRankingRotulo.test.tsx`: desglose del maestro, `/mis-pagos` y las **dos** descargas | **Sí, y contra el LITERAL.** El propio archivo declara por qué no compara contra el mapa de rótulos. |
| R35 | guardia money-safe sobre 6 archivos nuevos + guardia sobre el panel **con contraprueba** | **Sí.** |

### Las tres formas de test que mienten — barrido específico

1. **Comparar contra la propia fuente.** Encontrada **una** de la 293:
   `tests/integration/wallet-mensajeros-page.test.tsx` afirma
   `toHaveValue(fechaObjetivo(ahora))` y `toHaveAttribute("max", fechaCalendarioCR(ahora))`
   contra las MISMAS funciones que usa `app/(app)/wallet/mensajeros/page.tsx:52-53` (→ **m3**).
   El test de componente equivalente (`PremiosRankingPanel.test.tsx`) sí usa literales, y las dos
   funciones tienen tests propios de la 46/166, así que el riesgo residual es bajo.
   *(Preexistente, no de esta ficha: `cierres-admin-pendiente.test.ts:217` compara el servicio
   contra `derivarPendienteCierre` — ahí es deliberado y documentado: mide «no reimplementa».)*
2. **Salir por la puerta antes de comprobar nada.** **No encontrada.** Los dos archivos [PG]
   usan `describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip` — `skipped`, nunca
   `passed` — y con base pero sin catálogo **fallan ruidosamente en el `beforeAll`** con un
   mensaje que dice qué seed falta. No hay ni un `if (!datos) return;`.
   **Medido:** los dos archivos corren **47 tests, 0 skipped** en esta máquina.
3. **Afirmar sobre un doble donde el riesgo está en el SQL.** Los casos marcados [PG] **van de
   verdad contra Postgres**: `_postgres-real.ts` abre un `PrismaClient` con `PrismaPg` y
   `DATABASE_URL`, todo ocurre en transacciones revertidas, y la transacción del servicio se
   modela con `SAVEPOINT` / `ROLLBACK TO SAVEPOINT` (mismo motor, misma atomicidad). El caso 6
   —«si la caja revienta no queda la fila del libro»— solo es medible así, y lo mide.
   La única afirmación de la matriz que **no** es [PG] y podría serlo es R28 (conciliación); el
   fake interpreta el `where` correctamente y lleva no-vacuidad, así que se acepta.

---

## 4. Los cuatro puntos donde esto se rompe

### 4.1 El barrido del §6 — completo, y el 21.º consumidor está resuelto

`derivarPendienteCierre` tiene **5** call-sites en `lib/` y **los cinco** pasan por
`sumarPremiosVivosPorCierre` (verificado por grep sobre el árbol, no por la lista del design):

| # | Call-site | Con premios | Test que lo demuestra |
| --- | --- | --- | --- |
| §6/3 | `LiquidacionService.imputablesDe` (`:1004`) | sí | `liquidacion-reparto-service.test.ts` — sin premio `imputable "0.00"`, con premio `"2000.00"`, `enVentana` 0→1 |
| §6/4 | `LiquidacionService.pendienteDelCierre` (`:1270`) | sí | `liquidacion-service.test.ts` — `sin_saldo` pasa a `ok`, y `excede` con `disponible "5000.00"` |
| **21.º** | `LiquidacionService.restanteTrasAnular` (`:1150`) | sí | `liquidacion-anulacion.test.ts` — restante `55000.00`, no `50000.00` |
| §6/6 | `CierresAdminService.conPendiente` (`:867`) | sí | `cierres-admin-pendiente.test.ts` — badge `0.00` pasa a `5000.00` |
| §6/7 | `CierresAdminService.pendienteTrasAprobar` (`:923`) | sí | mismo archivo, «el detalle dice la MISMA cifra que el listado» |

**No queda ninguno más.** `calcularSplitPago` tiene exactamente 2 consumidores en `lib/`
(`pendiente-cierre.ts` y `WalletMensajeroFeedService`), y el segundo es el feed de la aprobación,
que §6/10 declara intacto y sigue verde.

Las filas «no cambia» que verifiqué a mano por ser las que el premio podría torcer:

- **§6/16 conciliación** — *sí cambia y está hecho*: `NOT: { OR: [...] }` sobre el libro del
  mensajero, escrito de forma inequívoca, y **solo** en ese libro (los otros dos no lo necesitan:
  el egreso del premio va con `origen_tipo='ranking_snapshot_fila'`, que el `where` de la
  conciliación —`origen_tipo='cierre_dia'`— ya excluye). El `ajuste_pago` **normal** sigue
  conciliando: el filtro no saca la categoría entera.
- **§6/17 métrica `cuenta_por_pagar_mensajero`** — agrega por `tipo`, el premio es un devengo
  más; se añadió `premio_ranking` al catálogo. Correcto.
- **§6/18 `finanzas-diarias`** — el egreso del premio usa `egreso_pago_mensajero`, que ya se suma
  por categoría, y `NATURALEZA_POR_CATEGORIA` lo declara `propio`. **Sin doble conteo**: verifiqué
  que `LiquidacionService` **no** toca la caja al pagar a un mensajero (`emitirEgresoDePago` solo
  se llama en la rama de tienda, `:682`), así que la caja registra `P` al aprobar el cierre y el
  premio al registrarlo, y nada más.
- **§6/20 `WalletMensajeroService`** — `agregarCuentaPorPagar` hace `groupBy(["tipo"])` sin
  filtrar categorías: el premio entra solo, con su rótulo. Correcto.
- **§6/12** — confirmado: ninguna descarga proyecta `pendientePagoMensajero`.

### 4.2 La idempotencia (mensajero, día) — la impone la base, medido

Contra el catálogo del Postgres local, en solo-lectura:

```
pago_mensajero_movimiento_premio_dia_uq
  UNIQUE btree (mensajero_id, premio_dia) WHERE categoria = 'premio_ranking'
pago_mensajero_movimiento_premio_reverso_uq
  UNIQUE btree (mensajero_id, premio_dia) WHERE categoria = 'ajuste_pago' AND premio_dia IS NOT NULL
pago_mensajero_movimiento_origen_uq
  UNIQUE btree (origen_tipo, origen_id, mensajero_id, categoria)
  WHERE origen_id IS NOT NULL AND categoria <> ALL (ARRAY['premio_ranking','ajuste_pago'])
```

Y el agujero por el que un índice parcial se evapora —filas con `premio_dia` NULL— lo cierra
`pago_mensajero_movimiento_premio_dia_check`, **ejercido contra el motor**: `premio_ranking` sin
`premio_dia` da 23514 nombrando ese CHECK. El caso 2 del [PG] inserta **saltándose el servicio**,
con otro cierre y otra descripción, y la base devuelve `P2002`. No es una comprobación del código.

El retoque de `origen_uq` no aflojó nada vivo: verifiqué en el árbol que `ajuste_pago` **solo lo
escribe el servicio del premio** y que el feed escribe `pago_devengado`/`pago_efectivo`, que
siguen dentro del predicado. El caso 10 del [PG] mide la doble aprobación: primera 2 filas,
segunda 0, total 2.

### 4.3 El origen del egreso de caja — no puede caer en DO NOTHING

El egreso va con `origen_tipo='ranking_snapshot_fila'`, `origen_id=<filaId>`, y el reverso con la
misma clave y `ingreso_ajuste`. El único de la caja es `(origen_tipo, origen_id, categoria)`, así
que las dos filas conviven y ninguna choca con el `(cierre_dia, cierreId, egreso_pago_mensajero)`
del feed. El caso 5 del [PG] **siembra ese egreso del feed primero** y comprueba que sigue solo e
intacto tras registrar dos premios.

Y para el caso imposible-en-teoría hay red: `lib/services/PremioRankingDevengoService.ts:218-226`
**lanza** si `emitirEgresoPremio` devuelve 0, en vez de devolver `ok`. Está testeado
(`cajaDevuelveCero` acaba en `rejects.toThrow(/egreso de caja no/)` y libro vacío). Es exactamente
lo contrario de un fallo mudo.

### 4.4 La migración

- **UP**: los 7 pasos de §10, en orden, con el paso 4 (recrear el CHECK tipo↔categoría) presente
  y **ejercido** contra el motor. Timestamp `20260827120000` mayor que `20260827100000`, y hay un
  test que lo compara contra **todas** las demás carpetas con control de no-vacuidad.
- **`prisma migrate status`**: `Database schema is up to date!` (163 migraciones, localhost:5432).
- **Añadir un valor de enum — lo que el repo exige de más:** sí, y está hecho.
  `WALLET_ORIGEN_TIPO_SEED` y `PAGO_MENSAJERO_MOVIMIENTO_CATEGORIA_SEED` con
  `satisfies readonly Prisma...[]` y sus `_Ensure*Exhaustive` (el build rompe si falta);
  los dos `Record<PagoMensajeroMovimientoCategoria, string>` de rótulos; el
  `Record<WalletOrigenTipo, string>` de `wallet-labels.ts`; el catálogo de métricas; y el CHECK
  tipo↔categoría de la 172. **Los cinco puntos están.**
- **`down.sql`, verificado contra el catálogo real** (solo-lectura, sin tocar nada):
  - `wallet_origen_tipo` tiene exactamente **9** dependientes: 3 columnas `origen_tipo` +
    **6 índices**, que son los seis que el `down.sql` suelta por nombre. Sin vistas, sin
    funciones, sin reglas, sin CHECK.
  - `pago_mensajero_movimiento_categoria` tiene **6**: la columna, los 3 índices
    (`origen_uq`, `premio_dia_uq`, `premio_reverso_uq`) y los 2 CHECK
    (`tipo_categoria_check`, `premio_dia_check`). El `down.sql` los suelta **todos** antes de
    recrear el tipo, y en el orden correcto.
  - Ninguna de las columnas afectadas tiene `DEFAULT` (lo que el propio `down.sql` afirma).
  - Ningún `down.sql` previo se toca, y hay test que lo comprueba sobre **más de 100** carpetas
    buscando los literales de enum con comilla simple (para no confundirlos con la tabla
    `premio_ranking` de la 76 ni con `ranking_snapshot_fila` de la 196).
  - **Round-trip UP→DOWN→UP: NO ejecutado.** `pnpm run db:rollback` fue **denegado por el
    clasificador de permisos** y no lo rodeé (→ **P1**). Precondición medida y favorable:
    **0 filas** con `categoria='premio_ranking'`, **0** con `premio_dia IS NOT NULL`, **0** en
    los tres libros con `origen_tipo='ranking_snapshot_fila'`.

---

## 5. Mutaciones ejecutadas por mí, con los números

Gate parado (16:38). Copia de seguridad en scratchpad, mutación, medición, restauración y
`diff -q` byte a byte. **Línea base antes y después: 4 archivos, 94 tests, todos verdes.**

### Mutación A — quitar `origenTipo: "cierre_dia"` del WHERE de `sumarPremiosVivosPorCierre`

Es la que el implementador dice que se le escapó y tuvo que reforzar. **Ahora la ven dos tests:**

```
FAIL tests/unit/repositories/premio-ranking-lecturas.test.ts
     > el WHERE lleva las TRES piezas: origen_tipo, los ids y las dos categorias del premio
     AssertionError: expected { ...(3) } to deeply equal { ...(3) }
     -     "origenTipo": "cierre_dia",

FAIL tests/integration/db/premio-ranking-idempotencia.test.ts
     > R24: la Sigma de premios vivos esta acotada por ORIGEN, no solo por el id
     AssertionError: expected '5444.00' to be '5000.00'
```

`5444.00 = 5000 + 777 - 333`: los dos señuelos sembrados (un `premio_ranking` y un `ajuste_pago`
de **otro** mensajero con `origen_tipo='pago_mensajero'` y un `origen_id` que **coincide** con el
del cierre) entran en la suma. **El [PG] la caza, no solo el unitario.** Refuerzo confirmado.

- Con la mutación: `Tests 2 failed | 32 passed (34)`. Restaurado: verde.

### Mutación B — dejar atrás un consumidor: `premiosVivos: "0.00"` en `CierresAdminService.conPendiente`

Es el fallo que el barrido del §6 existe para impedir, y el más mudo de todos: la pantalla de
cierres declararía **saldado** un cierre que debe 5.000.

```
FAIL tests/unit/services/cierres-admin-pendiente.test.ts
     > `conPendiente` (listado): el badge pasa de `0.00` al importe del premio
     AssertionError: expected '0.00' to be '5000.00'
FAIL tests/unit/services/cierres-admin-pendiente.test.ts
     > el detalle de UN cierre dice la MISMA cifra que el listado (R26)
     AssertionError: expected '0.00' to be '5000.00'
```

- Con la mutación: `Tests 2 failed | 43 passed (45)`. Restaurado: verde.

**Los dos supervivientes serían fallos sobre dinero y ninguno sobrevive.** No repliqué las otras
cuatro del backend ni las dos del frontend: el implementador dice haberlas hecho, pero **su
constancia no existe** (→ B1), así que se anotan como **no verificadas**.

---

## 6. Hallazgos

### BLOQUEANTES

**B1 — No existe `progress/impl_293-premio-ranking-cuenta-por-pagar.md`.**
`CHECKPOINTS.md:13` y `specs/293-premio-ranking-cuenta-por-pagar/tasks.md` T6.2 lo exigen, y T6.2
añade «**Commitearlo** (en este repo se ha perdido tres veces por no commitearlo)».
`ls progress/ | grep -i 293` devuelve vacío, y tampoco aparece como untracked.

No es papeleo: **tres afirmaciones de la entrega se apoyan en ese archivo y hoy no se pueden
comprobar**:

1. `tests/integration/db/premio-ranking-devengo-migration.test.ts:34-35` dice literalmente
   *«El round-trip REAL up -> down -> up contra el Postgres local está ejecutado y anotado en el
   informe de implementación»*. El informe no existe.
2. `tasks.md` T4.4 exige anotar el resultado de matar con mutaciones el `WHERE` de T2.2, el
   `premio_dia` de T4.2 y el orden de T3.2, y lo justifica: *«el arnés de mutaciones de este repo
   ya mintió una vez: exige autocomprobación»*. Verifiqué **dos** yo mismo (§5); de las otras
   cuatro no hay ni número ni salida.
3. `tasks.md` T6.4 exige las observaciones de la verificación con la app y **contra producción**,
   con importes. Esta feature **estrena los libros de dinero de producción** (design §2), así que
   esa comprobación no es sustituible por «la suite está verde».

**Qué falta para cumplirlo:** escribir el archivo con (a) la tabla `R<n>` → `archivo::test` de los
35, (b) la tabla del barrido de §6 con el resultado real de cada una de las 20 filas más la 21.ª
(`restanteTrasAnular`), (c) las mutaciones de T4.4 con su salida, (d) el round-trip de la
migración y (e) las observaciones de T6.4; y **commitearlo**.

---

**B2 — Nadie ejercita `buildService()` de `lib/actions/premio-ranking-devengo.ts`.**
`tasks.md` T4.3 «Hecho» lo pide con nombre y apellido: *«y un test comprueba que la action
**construida de verdad** escribe también en la caja»*.

Medido: `tests/unit/actions/premio-ranking-devengo-actions.test.ts` inyecta `deps.service` en
**todos** sus casos, y el único test de composition root que existe es el de `listarCierresAdmin`
(T2.5, en `tests/integration/db/premio-ranking-idempotencia.test.ts:996`). El `buildService()` del
premio (`lib/actions/premio-ranking-devengo.ts:88-98`) **no lo ejecuta ningún test de la suite**.

Por qué es bloqueante y no cosmético: el compilador cubre las cuatro primeras dependencias
(tienen tipos distintos entre sí), pero **no cubre la quinta**, que es el runner de transacción:

```ts
(fn) => prisma.$transaction((tx) => fn(tx as unknown as PremioTx)),   // línea 96
```

Cambiarlo por `(fn) => fn(prisma as unknown as PremioTx)` **compila**, pasa `typecheck`, `lint` y
**toda** la suite —el test de servicio inyecta su runner en memoria y el [PG] inyecta uno de
`SAVEPOINT`—, y **rompe R20 en silencio**: el devengo quedaría escrito con la caja sin cargar, o
al revés. Es exactamente la familia que la memoria del repo documenta («el composition root que no
inyecta»: 2 de 7 notificadores muertos con la suite verde) y la que esta ficha nombra como su
riesgo central.

**El código de hoy es correcto.** Lo que falta es la guardia que impide que deje de serlo, y es la
única que `tasks.md` nombró para este punto.

**Qué falta para cumplirlo:** un caso que llame a `registrarPremioAction({ filaId })` **sin
`deps.service`** (con `deps.getActor` puesto), sobre datos sembrados, y compruebe que quedan las
**dos** filas —libro y caja— y que si la caja falla no queda ninguna. Cabe en el archivo [PG] que
ya existe, junto al de T2.5.

### Menores

**m1 — Dos nombres de test equivocados en la matriz de `tasks.md`.**
`tasks.md:317` cita `ranking-snapshot-podio-repository.test.ts` (R4) y `tasks.md:323`
`resolver-cierre-del-dia.test.ts` (R10). **Ninguno de los dos archivos existe.** Los tests están,
en `tests/unit/repositories/premio-ranking-lecturas.test.ts` (describes `293/T3.1` y `293/T3.2`).
Falla el índice, no la cobertura; se corrige en la matriz o renombrando.

**m2 — R26 promete una guardia que no existe.**
`tasks.md:339` mapea R26 a *«`tsc` (firma por objeto) + los cuatro tests de T2.3 + guardia de que
nadie reimplementa la fórmula»*. Barrí `tests/` y esa guardia no está. Lo que sí hay: la firma por
objeto (que rompe la compilación en todo consumidor), los 5 tests de call-site y la aserción
estática de que `lib/utils/pendiente-cierre.ts` importa `calcularSplitPago` y no contiene
`Number(`, `parseFloat` ni `Math.min`. Cobertura razonable; la guardia prometida, no.

**m3 — Aserción contra su propia fuente en `tests/integration/wallet-mensajeros-page.test.tsx`.**
En «abre en el día que el ranking congela…»: `expect(selector).toHaveValue(fechaObjetivo(ahora))`
y `expect(selector).toHaveAttribute("max", fechaCalendarioCR(ahora))` comparan lo pintado contra
las **mismas** funciones que usa `app/(app)/wallet/mensajeros/page.tsx:52-53`. Si `fechaObjetivo`
devolviera el día equivocado, el test seguiría verde — y ese día decide qué premio se ofrece
registrar. Riesgo residual bajo (esas funciones tienen tests propios de la 46/166 y el test de
componente sí usa literales), pero es la forma exacta que este repo persigue.

**m4 — La relectura que distingue `ya_registrado` de `anulado` sale de la transacción.**
`lib/services/PremioRankingDevengoService.ts:205-207`: dentro del `runTransaction`, llama a
`this.libroRepo.listarPremiosPorDias(...)`, que usa el cliente propio del repositorio y **no** el
`tx`. Hoy es inocuo —esa rama solo corre cuando no se insertó nada, así que no hay nada de la
propia transacción que leer— y no mueve un colón, pero mezcla dos conexiones dentro de un bloque
que el comentario presenta como transaccional. Merece pasar el `tx` o decir por escrito por qué no.

**m5 — Sin entrada en `progress/history.md`** (`CHECKPOINTS.md:46`).

**m6 — `feature_list.json` viene con las fichas 294, 295 y 296 nuevas** en el mismo árbol sin
commitear. Son ajenas a la 293 (backlog registrado en paralelo). Conviene que el commit de esta
feature no las arrastre, o que se separen en su propio commit de `chore`.

### Pendiente (no imputable a la implementación)

**P1 — Round-trip UP→DOWN→UP no ejecutado.** `pnpm run db:rollback` fue **denegado por el
clasificador de permisos** en esta sesión y no lo rodeé por otra vía. Lo verificable en
solo-lectura está en §4.4 y sale limpio: la coreografía del `down.sql` cubre **todos** los
dependientes reales de los dos enums, no hay `DEFAULT` que soltar y no hay ninguna fila que use
los valores nuevos. Falta la ejecución. Es un checkpoint (`CHECKPOINTS.md:24-25`) y va antes de la
release, no después.

---

## 7. Opiniones sobre decisiones ya cerradas (NO son hallazgos)

Marcadas como pide el encargo: **opinión**, no bloqueo. Ninguna se propone reabrir.

**O1 — Q2 («anular consume el cupo para siempre») se cerró apoyándose en una salida que el
producto no tiene.** La `status_note` dice: *«corregir es un movimiento compensatorio, y si
hiciera falta reponer existe el ajuste manual»*. Medido en el árbol: **no hay ninguna superficie
que escriba un ajuste manual en el libro del mensajero**. `ajuste_devengo` solo lo escribe
`LiquidacionService` como contraasiento de un pago anulado (`:1200`), `ajuste_pago` solo lo escribe
el servicio del premio, y `WalletService.registrarMovimientoManual` (`:189`) escribe en la **caja
principal**, que es otra tabla. Es decir: si el maestro anula un premio por error, hoy **no hay
forma de reponerlo desde la aplicación**. La decisión sigue siendo coherente con la guarda no
negociable y R32 lo dice en pantalla antes de confirmar; lo que no es cierto es el argumento con
el que se cerró. Vale la pena saberlo antes del primer error real.

**O2 — Q5 (dos cierres para el mismo día) elige el más antiguo por `solicitado_at`, y está bien,
pero el usuario no se entera.** El desempate es determinista, inmutable y está medido [PG] (tres
lecturas, el mismo cierre). Sin embargo la pantalla no dice **a qué cierre** se imputó el premio:
`PremioPodioDTO` no publica `cierreId`, y el estado «Registrado» dice «se cobra con el cierre de
ese día», en singular. Con dos cierres vivos del mismo día —que la memoria del repo documenta como
algo que **ya pasó en producción**— el maestro pagaría desde uno y no sabría cuál. Coste de
arreglarlo: publicar el `cierreId` en el DTO y nombrarlo en el texto.

---

## 8. Resumen para el leader

Trabajo sólido y por encima del listón habitual: el modelo de datos está razonado y **medido**, la
guarda de R17 la impone la base y se demuestra saltándose el servicio, la atomicidad de R20 se mide
con `SAVEPOINT` contra el motor, el barrido del §6 lo impone el compilador y aparece un consumidor
(`restanteTrasAnular`) que el diseño no había visto, y la mutación que antes escapaba ahora la
cazan **dos** tests. **35/35 requisitos con test real.** typecheck y lint verdes; 530 tests verdes
en los 19 archivos de la feature.

**RECHAZADO** por dos cosas que no piden rediseño ni tocar una línea de lógica: falta el informe de
implementación con el mapa de trazabilidad, el round-trip de la migración y las mutaciones (**B1**),
y falta el único test que `tasks.md` nombró para el punto donde el compilador no llega —el
composition root de las Server Actions del premio y su runner de transacción— (**B2**).

Vuelve al implementer.
