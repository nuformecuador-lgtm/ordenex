# Ficha 393 — bitácora de implementación (MITAD DE SERVIDOR)

> Rama `feat/393-cierre-bodega-dos-cascadas`, base `6fd97d06` (lo que era `origin/dev` al empezar).
> Agente: **backend_dev**. Alcance entregado: **T0 · B1–B8 · C1–C4**.
> **F (componentes) y G1–G3 (guardias de pantalla) NO entran aquí** y quedan para `frontend_dev`:
> son componentes, y este rol no toca UI. El contrato que F necesita ya está publicado (§ «Lo que
> F encuentra hecho»).

---

## T0 — antes de tocar nada

### T0.1 · los once símbolos, confirmados EN DISCO (no en el índice del MCP)

Búsqueda hecha con `grep` sobre el árbol real. **El MCP `codebase-memory` no aparecía en mi juego
de herramientas en esta sesión**, así que se usó `grep` para todo y se dice explícitamente aquí.
Los once están, ninguno falta:

| Símbolo | Archivo | Línea |
| --- | --- | --- |
| `pagoTiendaOrdenex` | `lib/utils/ingreso-ordenex.ts` | 352 |
| `gananciaOrdenex` | `lib/utils/ingreso-ordenex.ts` | 334 |
| `totalesIngresoOrdenex` | `lib/utils/ingreso-ordenex.ts` | 282 |
| `derivarIngresoOrden` | `lib/utils/ingreso-ordenex.ts` | 145 |
| `pagoPorResultado` | `lib/utils/pago-mensajero.ts` | 13 |
| `toBodegaResumenRow` | `lib/repositories/CierreBodegaRepository.ts` | 78 |
| `HojaResumen` | `app/(app)/cierres-admin/_components/cierre-factura.tsx` | 596 |
| `CierreBodegaFacturaResumen` | `app/(app)/cierres-admin/_components/cierre-factura.tsx` | 800 |
| `verCierreBodegaDetalle` | `lib/actions/cierre-bodega.ts` (borde) · `lib/services/CierresBodegaAdminService.ts` (método) | 372 · 265 |
| `sumTotales` | `lib/services/CierreBodegaService.ts` | 42 |
| `FUENTE_CAJA` | `lib/utils/aporte-por-orden.ts` | 55 |

### T0.2 · la corrección de premisa, confirmada

- El detalle **YA pintaba** «Pago a tienda» (`PAGO_TIENDA_LABEL`, `CierresBodegaAdminModule.tsx:564`)
  y «Ganancia» (`GANANCIA_LABEL`, `:551`). La cascada A se **agrupa y renombra**, no se inventa.
- `grep -rni "para la central\|paraLaCentral" app lib tests db` → **cero resultados**. La cascada B
  se **crea**: ese número no existía en ninguna parte del árbol.

### T0.3 · MEDIDA POR EL LEADER contra producción el 2026-09-08 — no se repitió

- **14 cierres de bodega · 14 CUADRAN · 0 descuadran.** La identidad del snapshot agregado se
  sostiene al céntimo al consolidar varios días → `design.md §9` confirmado, ficha desbloqueada.
- **1 cierre con «Para la central» NEGATIVO**, el peor por **−₡1.000**.
- **2 cierres con el efectivo insuficiente**, el peor por **−₡2.000**.

Consecuencia que gobernó el código: **R36 y R37 no son programación defensiva, describen algo que
ya pasó.** Se implementaron como camino normal. Las tres cifras están escritas en los docstrings de
`paraLaCentral`, `efectivoCubreDescuentos` y en los tests, para que quien los lea dentro de un año
sepa que no son hipótesis.

### T0.4 · censo de los tests que localizan lo que se retira del detalle — **VACÍO**

Buscados los cinco `aria-label` (`"Ingreso bruto del cierre de bodega"`, `"Pago a mensajeros del
cierre de bodega"`, `"Ganancia del cierre de bodega"`, `"Ingreso de bodega por rechazos del cierre
de bodega"`, `"Pago a tienda del cierre de bodega"`) y sus gemelos `· <mensajero>` en todo `tests/`:
**ninguna aparición**. Tampoco hay ningún test que importe `INGRESO_BRUTO_LABEL`, `GANANCIA_LABEL`,
`PAGO_TIENDA_LABEL` ni `INGRESO_BODEGA_RECHAZOS_LABEL`.

**Para `frontend_dev`: la lección «el test que vive dentro de lo que borras» NO muerde aquí.** F7
(«trasladar las aserciones que T0.4 encontró») se queda **sin trabajo**, porque no había ninguna.

### T0.5 · veredicto del gate, escrito antes de empezar

El diff toca `cierre`, `ingreso`, `pago` y `factura`: **nombres de dinero**. `./init.sh --rapido`
**se niega**. El gate de esta ficha es **`./init.sh` completo**.

### T0.6 · foto en verde de los nueve archivos que no deben cambiar

`vitest run` sobre los nueve, ANTES de tocar nada: **9 archivos · 134 tests · 134 passed**.
Al terminar: **9 archivos · 140 tests · 140 passed** (+6 son los casos nuevos de C4, en el único
archivo de la lista que se editó).

---

## B — la aritmética, en el servidor

### B1 · `lib/utils/ingreso-ordenex.ts` — cuatro funciones puras nuevas

`cobradoSobreRecaudado`, `netoOrdenex`, `paraLaCentral`, `efectivoCubreDescuentos`.

- Las tres de importe son `new Prisma.Decimal(...).minus/plus(...).toFixed(2)`. La cuarta
  **compara** con `Decimal.gte` y devuelve booleano: no emite ningún importe.
- **La cuarta que el diseño no listaba es `cobradoSobreRecaudado`** (la línea puente de R10/R7).
  El diseño la describía como «se deriva server-side» sin darle nombre de función; se le puso uno
  porque la usan el agregado y cada `cierre_dia`, y escribir la suma dos veces era exactamente lo
  que R38 enseña a no hacer.
- `netoOrdenex` **no** se implementa encadenando `gananciaOrdenex`, a propósito: la identidad de R8
  vive en un solo sitio auditable.
- `gananciaOrdenex` y `pagoTiendaOrdenex` **sin tocar** (los lee el detalle del cierre de mensajero).
- Cero `Number(`, `parseFloat(`, `parseInt(`; el único `.toFixed(` es el del `Decimal` de salida.

### B3 · contratos — campos **requeridos**, y el rojo que lo demuestra

- `CierreBodegaResumenRow` (repositorio) y `CierreBodegaResumen` (servicio): `+paraLaCentral: string`,
  `+efectivoCubreDescuentos: boolean`.
- `CierreBodegaDetalleCierre` y el resultado de `verCierreBodegaDetalle`:
  `+cobradoSobreRecaudado`, `+netoOrdenex`, `+paraLaCentral`, `+efectivoCubreDescuentos`.
- `CierreBodegaResumenLite` **sin tocar** (R21).

**El typecheck enrojeció con 15 errores en 14 archivos de test**, todos «missing the following
properties … : paraLaCentral, efectivoCubreDescuentos». Ese rojo es la prueba de que los campos son
requeridos y no opcionales. **Ni un archivo de producción se rompió**: el servicio de la satélite
pasa las filas del repositorio tal cual.

### B4 · `toBodegaResumenRow` — el mapper que hace que R38 no pueda fallar

La derivación vive **ahí y sólo ahí**. Las **ocho** entradas de lectura a la cabecera de un cierre
de bodega pasan por él (`findCierresBodegaByZona`, `…ByZonaPaginado`, `findCierresBodega`,
`findHistoricoCompleto`, `findColaCompleta`, `findHistoricoPaginado`, `findColaPaginada`,
`findCierreBodegaConDetalle`). El mapper **llama** a las funciones puras; no escribe ni una resta.

Y el lado satélite lo hereda **sin una línea de código**: `CierreBodegaService` devuelve las filas
del repositorio tal cual en `cierresBodegaPasados` (`:174`), en `items` (`:257`) y en el conjunto de
la descarga (`:365`).

### B5 · `CierresBodegaAdminService.verCierreBodegaDetalle`

Cada nivel desde **sus propios** snapshots (R15). El agregado NO se calcula sumando los días, y los
días NO usan el pago agregado. `pagoTienda` y `ganancia` se siguen devolviendo con su fórmula de
siempre (R31).

### B2 · `tests/unit/utils/cascadas-cierre-bodega.test.ts` (nuevo) — 8 casos

**Céntimos en todos.** Con cifras redondas estas identidades cierran igual sin el arreglo.

### B6 · `cierres-bodega-admin-service.test.ts` — 7 casos nuevos

Dos `cierre_dia` con céntimos, uno de ellos **con un rechazo y con ingreso de bodega**. Los
esperados van como **literal**, nunca llamando a la función que el servicio usa (sería una aserción
contra su propia fuente, siempre verde).

### B7 · `cierre-bodega-repository.test.ts` — 4 casos nuevos, la red perenne de R38

Ejercita las **ocho** lecturas de los **dos** repositorios con la MISMA fila cruda y afirma el mismo
valor, con el nombre del método en el mensaje de fallo.

### B8 · 14 archivos de test con literales actualizados

Sólo los campos nuevos, con valores **aritméticamente coherentes** con su propio fixture. Dos
excepciones razonadas:

- `cierres-bodega-pendientes-paginado.test.ts`: la fila es **paramétrica**, así que el doble llama a
  las funciones puras en vez de fijar un literal que quedaría rancio.
- `consolidacion-completo.test.ts`: los campos entran en el literal pero **NO** en la lista de claves
  vigiladas por `vigilarDinero` — esa lista es lo que el test AFIRMA, no parte del fixture.

---

## C — rótulos y descarga

- **C1** · `cierre-labels.ts` (módulo PURO, sin React): las **13 constantes** de `design.md §5`, cada
  una con el porqué de su nombre, incluido por qué «Para la central» y no «Entrega a la central» ni
  «Queda en caja», y **por qué NO se reusa `CENTRAL_DEBE_LABEL`**. Ninguna constante existente cambia
  de valor.
  ⚠️ **La re-exportación desde `cierre-detalle-shared.tsx` NO está hecha**: ese archivo es un
  componente. La hace `frontend_dev` (una línea en el bloque `export { … }` de `:88-104`).
- **C2** · `cierres-bodega-descarga-columnas.ts`: **una** columna `paraLaCentral` **al final** de los
  **tres** listados de cierre de bodega. El de consolidables **no** la gana.
  `efectivoCubreDescuentos` **no** va al archivo. La proyección **lee** el STRING del DTO.
- **C3** · Las tres aserciones de orden de `cierres-bodega-descarga-columnas.test.ts`, ampliadas
  **añadiendo el elemento al esperado**, nunca aflojando el `toEqual`.
  **`columnas-asercion-de-orden.guardia` y `cobertura-tablas.guardia` NO hicieron falta tocarlas**:
  son estructurales, no literales, y siguieron verdes. El diseño predijo una edición que no era.
- **C4** · 6 casos nuevos, incluido uno con un `paraLaCentral` **canario** (`77777.77`) que NO es la
  resta de los totales de su propia fila: si la proyección recalculara, se nota.

---

## Trazabilidad `R<n> → test` — lo cubierto por esta mitad

| R | Test |
| --- | --- |
| R6 | `cascadas-cierre-bodega` caso 7 · `cierres-bodega-admin-service` caso 1 |
| R7 | `cascadas-cierre-bodega` caso 6 · `cierres-bodega-admin-service` casos 1 y 3 |
| R8 | `cascadas-cierre-bodega` casos 1 y 2 · `cierres-bodega-admin-service` caso 1 |
| R9 | `cascadas-cierre-bodega` caso 3 · `cierres-bodega-admin-service` caso 1 · `cierre-bodega-repository` (B7) |
| R10 (dato) | `cierres-bodega-admin-service` caso 3 — la línea puente se emite también con flete por rechazo `"0.00"` |
| R12 | `cierres-bodega-admin-service` casos 1-6 · `cierre-bodega-repository` (B7, «STRING/boolean money-safe») |
| R14 (servidor) | `cascadas-cierre-bodega` › «no emite ningún importe en coma flotante» |
| R15 | `cierres-bodega-admin-service` casos 2 y 5b |
| R16 | `cierres-bodega-admin-service` caso 2 · **medición de T0.3** (14/14 cuadran) |
| R17 | `cierres-bodega-admin-service` caso 4 |
| R20 (servidor) | `cierre-bodega-repository` (B7) — el mapper deriva, el servicio sólo deja pasar |
| R21 | `cierres-bodega-descarga-columnas` › «el listado de CONSOLIDABLES no gana la columna ni el dato» · V3 |
| R22 | `cierres-bodega-descarga-columnas` (C3 orden + C4 valor) |
| R28 | **V4** — `git diff -- db/` vacío |
| R31 | `cierres-bodega-admin-service` caso 6 · B8 |
| R36 (dato) | `cascadas-cierre-bodega` caso 4 · `cierre-bodega-repository` › negativo sin recortar · `cierres-bodega-descarga-columnas` › negativo en el archivo |
| R37 (dato) | `cascadas-cierre-bodega` caso 5 · `cierres-bodega-admin-service` casos 5 y 5b · `cierre-bodega-repository` › «el aviso mira el EFECTIVO» |
| R38 | `cierre-bodega-repository` (B7) — las 8 lecturas, mismo valor |

**Sin cubrir todavía, porque son de pantalla:** R1, R2, R3, R4, R5, R11, R13, R18, R19, R23, R24,
R25, R26, R27, R29, R30, R32, R33, R34, R35, R39, y las mitades de pantalla de R10, R14, R20, R36 y
R37. Sus tests son F2, F4, F6 y las guardias G1, G2 y G3.

---

## Mutaciones — medidas, con la línea de fallo copiada del log

Aplicadas al árbol real, corrida la suite relacionada, **revertidas desde copia** (nunca
`git checkout`). Las 8 del backend; las 9 restantes (M4, M7–M12, M16, M17) son de componentes que
esta mitad no trae.

| # | Mutación | Rojo medido |
| --- | --- | --- |
| **M1** | `netoOrdenex` deja de restar la bodega | **2 rojos.** B2 caso 1: `expected '13134.83' to be '11884.38'`; B2 money-safe: `expected '-0.10' to be '-0.40'`. ⚠️ **B2 caso 2 NO cae, y es correcto**: afirma la igualdad con `gananciaOrdenex` cuando la bodega vale `0.00`, que es justo donde la mutación es un no-op. El caso discriminante es el 1. |
| **M2** | el agregado deriva `paraLaTienda` con `general − totalesIngreso.total` (alternativa A6) | **4 rojos.** B6 caso 1: `expected '97499.15' to be '98855.66'`; casos 2, 3 y 6 también. |
| **M3** | el `netoOrdenex` de cada día usa el `total_pago_mensajero` **agregado** | **1 rojo.** B6 caso 2: `expected '-9819.01' to be '-3818.56'`. |
| **M5** | el agregado se «corrige» para que iguale la suma de los días | **1 rojo.** B6 caso 4: `expected '90837.72' to be '866.66'`. |
| **M6** | la columna del archivo recalcula `paraLaCentral` en vez de leer el DTO | **2 rojos.** C4: `expected '90837.72' to be '77777.77'` y `expected '90837.72' to be '-1000.05'`. |
| **M13** | `paraLaCentral` recorta el negativo a `"0.00"` (alternativa A7) | **2 rojos.** B2 caso 4 y B7: `expected '0.00' to be '-1000.05'`. |
| **M14** | `efectivoCubreDescuentos` compara contra `general` en vez de contra `efectivo` | **Ver abajo: esta encontró un agujero REAL en mis propios tests.** |
| **M15** | derivar `paraLaCentral` en un servicio en vez de en el mapper | **6 rojos.** B7: `satelite · findCierresBodegaByZona no trae la cascada B: expected {…} to match object { paraLaCentral: '90837.72', …}` — literalmente el modo de fallo que el diseño predijo. |

### M14 — lo que encontró, y que es el motivo de correr mutaciones

En la **primera** pasada M14 mató **un solo** test, y era un literal de contrato **preexistente**.
**Ninguno de mis tests nuevos la vio**, porque mis fixtures no eran discriminantes: en unas el
efectivo y el general cubrían los dos descuentos, en otras no los cubría ninguno. En los dos casos,
comparar contra `general` da el mismo booleano que comparar contra `efectivo`.

Se arregló añadiendo **el caso que separa las dos lecturas** —«Para la central» positivo, el general
cubre, el efectivo **no**, porque casi todo entró por SINPE—, que además es exactamente el escenario
que R37 describe y que T0.3 midió (2 de 14 cierres):

- `cierre-bodega-repository.test.ts` › «el aviso mira el EFECTIVO y no el general».
- `cierres-bodega-admin-service.test.ts` › caso **5b**, para el aviso **por día**, que es el que el
  servicio deriva (el agregado le llega ya hecho del mapper).

**Re-medida M14 con los tests reforzados: 3 rojos**, `expected true to be false` en los dos casos
nuevos más el literal de contrato.

---

## V — verificación

- **V1 · `./init.sh` COMPLETO** (no `--rapido`: se niega por nombres de dinero).
  Log propio del agente, sin `tail` en la tubería, con `INIT_EXIT=$?` escrito **dentro** y en su
  propia línea:
  - `✓ DATABASE_URL resuelta: los 132 archivos de tests contra Postgres SI se ejecutan`
    → **el `.env` se copió** de la raíz; el gate no miente en verde.
  - `Test Files  1777 passed (1777)`
  - `Tests  25449 passed | 26 skipped (25475)` · `Duration 1026.70s`
  - `✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1777 ejecutado(s), todos en el baseline conocido)`
  - `! migraciones sin down.sql: 20260814120000_… 20260814140000_… 20260814160000_…` → **aviso
    preexistente**, de tres migraciones de ruta de agosto; esta ficha no añade ninguna migración.
  - `✓ .env presente` · `== init OK ==` · **`INIT_EXIT=0`**
  - **Los 26 `skipped`, contados y explicados:** 17 en `tests/components/AnaliticaPage.test.tsx` y
    9 en `tests/components/AnaliticaShell.test.tsx`, todos `describe.skip`/`it.skip` **escritos en
    el propio archivo** y anteriores a esta ficha (analítica). **Ninguno se salta por falta de
    `DATABASE_URL`** — esa es la trampa que la línea de arriba descarta.
  - `pnpm run typecheck`: verde, sin salida.
  - `pnpm run lint`: **0 errores**, 161 warnings, **todos preexistentes**; ni uno en un archivo de
    este diff (comprobado por nombre de archivo).
- **V3 · de los nueve archivos de T0.6 se editó UNO**: `tests/unit/descarga/cierres-bodega-descarga-columnas.test.ts`,
  que es exactamente la ampliación declarada de C3+C4. Los otros ocho, intactos y verdes —incluidas
  `factura-contraste.guardia` (G4) y `cierre-detalle-superficies.guardia` (G5), verdes **sin
  editarlas**.
- **V4 · sin migración**: `git diff --name-only origin/dev -- db/` → **vacío** (R28). No hizo falta
  ninguna columna: los tres snapshots ya existían y el resto es resta.
- **V2 · verificación humana en la app real: PENDIENTE, y no puede hacerse todavía.** No hay
  pantalla que mirar hasta que entre la mitad de `frontend_dev`. No se inventa un E2E.

---

## Lo que F encuentra hecho (contrato publicado)

```ts
// lib/interfaces/services/ICierreBodegaService.ts
CierreBodegaResumen.paraLaCentral: string            // puede ser NEGATIVO, con signo
CierreBodegaResumen.efectivoCubreDescuentos: boolean // false ⇒ enciende la nota de R37
CierreBodegaDetalleCierre.{cobradoSobreRecaudado, netoOrdenex, paraLaCentral, efectivoCubreDescuentos}

// lib/interfaces/services/ICierresBodegaAdminService.ts — el AGREGADO del detalle
{ cobradoSobreRecaudado, netoOrdenex, paraLaCentral, efectivoCubreDescuentos }
```

Las 13 constantes están en `app/(app)/cierres-admin/_components/cierre-labels.ts`.

**Lo que F tiene que hacer y aquí no se hizo:** F1 (`CascadaDinero.tsx`), F2, F3 (`cierre-factura.tsx`
+ la prop `cascadaCentral`), F4, F5 (`CierresBodegaAdminModule.tsx`), F6, F7 (**sin trabajo**, T0.4
salió vacío), G1, G2, G3, y la re-exportación de las constantes desde `cierre-detalle-shared.tsx`.

---

## Riesgos y cosas vivas

1. **`origin/dev` se movió mientras trabajaba**: de `6fd97d06` (mi base) a `ee56f461`
   («chore(379): la mitad de servidor entra en dev»). El gate de arriba se corrió sobre **mi base**,
   no sobre el `dev` de ahora. Hay que rebasar antes de mergear. La 379 tocó `usuarios`/`zonas` y
   **borró** `tests/integration/db/cierre-bodega-resumen-pendientes.test.ts`, que mi árbol todavía
   tiene; no hay solape con estos archivos, pero el gate hay que repetirlo ya rebasado.
2. **Q7 sigue abierta**: un «Para la central» negativo **se enseña**, pero esta ficha no toca el
   flujo de aprobación ni cuantifica cuánto falta. Es ficha aparte si el humano quiere una puerta.
3. **Q4 sigue abierta**: `INGRESO_BODEGA_RECHAZOS_LABEL` no se renombró en toda la app; conviven
   «Gana la bodega satélite» (bodega) e «Ingreso de bodega por rechazos» (mensajero).
4. **Riesgo declarado de D7**, sin medir y sin forma de medirlo desde el repo: el archivo de los tres
   listados de bodega cambia de encabezados. Se mitiga poniendo la columna **la última**.

---

## Veredicto

La mitad de servidor de la 393 está hecha y medida: el número que la satélite necesita para operar
se deriva **una vez**, en el mapper que comparten las ocho lecturas, viaja como STRING con su signo
—también cuando es negativo— y llega ya al archivo de descarga; gate completo en verde con
`INIT_EXIT=0` leído de dentro del log y la base de datos realmente ejercitada. **Falta la pantalla**,
y sin ella el humano todavía no ve nada.
