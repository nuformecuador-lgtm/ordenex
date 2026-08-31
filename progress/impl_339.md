# Ficha 339 — bitácora de implementación (BACKEND, bloques B0–B4)

> Zona `fullstack`, backend primero. **Este documento cubre B0, B1, B2, B3 y B4.**
> Los bloques **B5 (la tarjeta) y B6 (censos ajenos de frontend) NO están hechos**: los implementa
> el agente de frontend. Lo que este bloque le deja cableado está en § 8.

Rama: `fix/339-otros-gastos`. Fecha: 2026-08-31.

---

## 1 — B0: la foto de antes de tocar nada

**T0.1 — los tres censos ajenos, en verde y con sus números anotados.**

```
$ pnpm exec vitest run tests/unit/descarga/cobertura-tablas.guardia.test.ts \
    tests/integration/wallet-page.test.tsx \
    tests/components/paginacion/paginacion-transversal.test.tsx

 Test Files  3 passed (3)
      Tests  25 passed (25)
   Duration  9.89s
```

| censo | antes | después (backend) | quién lo mueve |
| --- | --- | --- | --- |
| `TOTAL_ARCHIVOS_CON_DATATABLE` | 28 | **28 (sin cambio)** | B6.1, cuando nazca `DetalleFilaComposicion.tsx` |
| `TOTAL_INSTANCIAS_DATATABLE` | 28 | **28 (sin cambio)** | B6.1 |
| `totalCensado` (`censo-tablas.ts`) | 29 = 19 `con_descarga` + 10 `fuera` | **29 (sin cambio)** | B6.1 → 30 = 19 + 11 |
| censo de paginación (`paginacion-transversal`) | 13 | **13 (sin cambio)** | nadie: el backend NO declara ninguna `PAGINACION_*_LABEL` |

El backend no añade ninguna `<DataTable>` ni ninguna constante con el prefijo `PAGINACION_`, así que
**dos de las tres guardias no se movieron**. La tercera —el barrido de STRING de
`wallet-page.test.tsx`— sí se tocó, porque el DTO gana dos claves; está en § 5.

**T0.2 — los cuatro símbolos, leídos EN EL ARCHIVO REAL (no en el grafo).**

| símbolo | archivo | línea (antes de esta ficha) |
| --- | --- | --- |
| `WALLET_EGRESO_DESGLOSADO_SEED` | `lib/types/wallet.ts` | 132–137 (cuatro categorías) |
| `ComposicionGananciaDTO` | `lib/types/wallet.ts` | 257–270 (cuatro claves) |
| `NATURALEZA_POR_CATEGORIA` | `lib/utils/caja-tesoreria.ts` | 57–78 (`Record` total, 17 categorías) |
| `derivarComposicionGanancia` | `lib/utils/caja-tesoreria.ts` | 271–304 |

Los cuatro estaban EXACTAMENTE como el diseño supone.

---

## 2 — Archivos creados

| archivo | qué es |
| --- | --- |
| `lib/config/composicion-detalle.ts` | T3.1 — `DEFAULT_PAGE_SIZE = 10`, `MAX_PAGE_SIZE = 50`, molde de `lib/config/gasto-fijo.ts`. NO se registra en el censo del Anexo III (motivo escrito en el archivo) |
| `tests/unit/config/composicion-detalle-config.test.ts` | R29/R30 |
| `tests/unit/actions/wallet-detalle-fila-action.test.ts` | R32/R34 (el borde) |
| `tests/integration/db/composicion-detalle-postgres.test.ts` | R18/R19/R20/R27/R31/R33 contra **Postgres real** |

## 3 — Archivos modificados

| archivo | qué cambió |
| --- | --- |
| `lib/types/wallet.ts` | T1.1–T1.4: `WALLET_EGRESO_NOMBRADO_SEED`, `WALLET_EGRESO_CON_FILA_SEED`, `COMPOSICION_FILA_OTROS`, `COMPOSICION_FILA_SEED`, `ComposicionFilaId`; `ComposicionGananciaDTO` gana `egresos` y `hayOtrosEgresos`; `listarMovimientosDeFilaSchema` derivado del schema del listado |
| `lib/utils/caja-tesoreria.ts` | T2.1/T2.2: `categoriasDeFilaComposicion` (pura) y el reparto contra `WALLET_EGRESO_CON_FILA_SEED` + `hayOtrosEgresos = !otrosEgresos.isZero()` |
| `lib/repositories/WalletMovimientoRepository.ts` | T3.2: `buildWhere` traduce `categorias` a `AND: [{ categoria: { in: … } }]` |
| `lib/interfaces/repositories/IWalletMovimientoRepository.ts` | T3.2/T3.5: `categorias?` en `ListarMovimientosFiltros` y en `BalanceFiltros`, con su docstring |
| `lib/services/WalletService.ts` | T3.3: `listarMovimientosDeFila` (guard → filtros → conjunto de la fila → `repo.listar`) |
| `lib/interfaces/services/IWalletService.ts` | T3.5: `ListarMovimientosDeFilaServiceResult` + el método en el contrato |
| `lib/actions/wallet.ts` | T3.4: `listarMovimientosDeFilaAction` + su tipo de resultado |
| `tests/unit/guards/caja-composicion-exhaustiva.guardia.test.ts` | T2.3: el censo de «otros» pasa de 3 categorías a 1; la columna pasa a «4 + 2 + otros»; caso nuevo de R13 |
| `tests/unit/utils/caja-composicion.test.ts` | T2.4: bloque nuevo R4/R9/R12/R14 y la partición actualizada |
| `tests/unit/services/wallet-service.test.ts` | R38/R39/R40 + alcance del conjunto de la fila y `total` del servidor |
| `tests/unit/actions/wallet-actions.test.ts` | fixture con las dos claves nuevas; el censo literal de acciones exportadas pasa de 4 a 5 (deliberado) |
| `tests/integration/wallet-page.test.tsx` | **T6.2 hecho aquí** (§ 5): el barrido de STRING se amplía, no se afloja |
| `tests/components/ComposicionGananciaCard.test.tsx`, `tests/components/descarga/WalletDescarga.test.tsx`, `tests/unit/components/wallet-page-cobros-pendientes.test.tsx` | SOLO las dos claves nuevas en sus fixtures, para que `tsc` siga verde. **Los literales-contrato de rótulos (T6.3) NO se tocaron**: son del frontend |

---

## 4 — Mapa `R<n> → test` (lo que cubre el backend)

| R | test | estado |
| --- | --- | --- |
| R4 | `tests/unit/utils/caja-composicion.test.ts` › R4: cada cubeta de `egresos` suma SOLO su categoria | ✅ |
| R9 | `tests/unit/utils/caja-composicion.test.ts` › R9: `hayOtrosEgresos` lo deriva el SERVIDOR… | ✅ |
| R11 | `tests/unit/guards/caja-composicion-exhaustiva.guardia.test.ts` › R11 (ficha 339): los cuatro conceptos + los dos nombrados + «otros» suman `egresosPropios` | ✅ |
| R12 | `tests/unit/utils/caja-composicion.test.ts` › R12: `otrosEgresos + egresos.*` es el MISMO importe que «otros» antes de la ficha | ✅ (mutación en § 6) |
| R13 | `caja-composicion-exhaustiva.guardia.test.ts` › R13: cada categoria propia aporta a UNA sola cubeta, nunca a dos + › R13 (ficha 339): los dos egresos NOMBRADOS salieron del complemento de verdad | ✅ |
| R14 | `tests/unit/utils/caja-composicion.test.ts` › R14: las cifras agregadas de la caja no cambian de valor… + › R38/R14 (los dos casos heredados) | ✅ |
| R18 | `tests/integration/db/composicion-detalle-postgres.test.ts` › R18/R33 … trae SOLO su categoria + › R18: «Otros» trae el COMPLEMENTO | ✅ |
| R19 | `…-postgres.test.ts` › R19: la Σ de TODAS las paginas del detalle es el importe de la fila | ✅ |
| R20 | `…-postgres.test.ts` › R20: los filtros vigentes de la wallet recortan el detalle | ✅ |
| R27 | `…-postgres.test.ts` › R27/R31: el detalle devuelve UNA pagina… | ✅ |
| R29 | `tests/unit/config/composicion-detalle-config.test.ts` › R29 (tres casos, incluido «el BORDE toma de esta config su default y su tope») | ✅ (la mitad de «la pantalla no declara literal» es de B5) |
| R30 | `composicion-detalle-config.test.ts` › R30 (override + basura) | ✅ |
| R31 | `…-postgres.test.ts` › R27/R31 + `wallet-service.test.ts` › R31/R34 | ✅ (mutación en § 6) |
| R32 | `tests/unit/actions/wallet-detalle-fila-action.test.ts` › R32 (tres casos: tope, fila fuera del catálogo, page/pageSize) | ✅ |
| R33 | `…-postgres.test.ts` (los seis casos) | ✅ (mutación en § 6) |
| R34 | `wallet-detalle-fila-action.test.ts` › R34: todo importe cruza la frontera como TEXTO | ✅ |
| R37 | `tests/unit/guards/caja-derivaciones.guardia.test.ts` (sin editar; corrido y verde) | ✅ |
| R38 | `tests/unit/services/wallet-service.test.ts` › R38/R39 | ✅ |
| R39 | `wallet-service.test.ts` › R38/R39: … SIN tocar el repo (cero invocaciones) | ✅ |
| R40 | `wallet-service.test.ts` › R40: el detalle usa el MISMO predicado de acceso que el listado, rol por rol | ✅ |
| R1, R2, R3, R5, R6, R7, R8, R10, R15, R16, R17, R21–R26, R28, R35, R36, R41, R42 | pantalla (B5/B6) | ⛔ pendiente frontend |

---

## 5 — Las tres guardias ajenas que el spec identificó

1. **Censo de tablas** (`cobertura-tablas.guardia.test.ts`): **no se movió** — el backend no añade
   ninguna `<DataTable>`. Sigue en 28/28 y `totalCensado` 29. Corrida verde tras el cambio.
2. **Barrido de STRING** (`tests/integration/wallet-page.test.tsx`): **ampliado, no aflojado.**
   `egresos` se desestructura como se desestructura `ingresos` y recibe **el mismo** bucle de
   `typeof === "string"`, con su control de no-vacuidad; `hayOtrosEgresos` se exceptúa **por
   NOMBRE** (jamás con un `typeof !== "string" → salta`) y gana su propia aserción de booleano más
   la de su valor (`false` con `otrosEgresos: "0.00"`). El caso espejo —importe ≠ 0 ⇒ `true`— se
   mide donde se produce, en `caja-composicion.test.ts`.
3. **Censo de paginación** (`paginacion-transversal.test.tsx`): **intacto en 13.** El backend NO
   declara ninguna constante `PAGINACION_*_LABEL`; el nombre accesible de la paginación del detalle
   es cosa de B5 y **debe** declararse como propiedad/función del módulo de textos.

---

## 6 — Las tres mutaciones exigidas (ejecutadas y revertidas)

### 6.1 · R33 — quitar el `categoria IN (…)` del `WHERE`

Mutación aplicada a `lib/repositories/WalletMovimientoRepository.ts`:

```diff
-  if (f.categorias !== undefined) where.AND = [{ categoria: { in: [...f.categorias] } }];
+  // MUTACION DELIBERADA (T4.1): se quita la restriccion de categoria del WHERE.
```

Salida REAL (recortada a lo que nombra el dinero intruso):

```
 ❯ tests/integration/db/composicion-detalle-postgres.test.ts (6 tests | 5 failed) 352ms
     × R18/R33: el detalle de «Pagos a mensajeros» trae SOLO su categoria 225ms
     × R18: «Otros» trae el COMPLEMENTO — y ya NO trae el pago al mensajero 15ms
     × R20: los filtros vigentes de la wallet recortan el detalle 14ms
     × R19: la Σ de TODAS las paginas del detalle es el importe de la fila, centimo a centimo 32ms
     × los DOS agregados no cambiaron de SQL al ganar el repositorio la clave `categorias` 14ms

 FAIL  … > R18/R33: el detalle de «Pagos a mensajeros» trae SOLO su categoria
 AssertionError: expected Set{ …(7) } to deeply equal Set{ …(2) }

 FAIL  … > R19: la Σ de TODAS las paginas del detalle es el importe de la fila, centimo a centimo
 AssertionError: egreso_pago_mensajero: la suma del detalle no es el importe de la fila:
   expected '18611.08' to be '3333.33'

 FAIL  … > los DOS agregados no cambiaron de SQL …
 AssertionError: expected [ Array(6) ] to deeply equal [ [ 'egreso_gasto', '55.55' ] ]
   +   [ "ingreso_flete", "7777.77" ],
   +   [ "egreso_pago_tienda", "6666.66" ],
   +   [ "egreso_pago_mensajero", "3333.33" ],
       [ "egreso_gasto", "55.55" ],
   +   [ "egreso_sueldo", "444.44" ],
   +   [ "egreso_ajuste", "333.33" ],

 Test Files  1 failed (1)
      Tests  5 failed | 1 passed (6)
```

**5 de 6 casos rojos, nombrando cada importe intruso.** Revertida (`grep -c MUTACION` → 0) y el
archivo vuelve a 6/6 en verde.

### 6.2 · R31 — devolver `movimientos.length` como `total`

Mutación en `WalletService.listarMovimientosDeFila` (`total: movimientos.length`):

```
 ❯ tests/integration/db/composicion-detalle-postgres.test.ts (6 tests | 2 failed)
     × R27/R31: el detalle devuelve UNA pagina y el `total` es el del CONJUNTO 25ms
     × R19: la Σ de TODAS las paginas del detalle es el importe de la fila… 13ms

 AssertionError: expected [ 2, 2, 1 ] to deeply equal [ 5, 5, 5 ]
```

Revertida y verde.

### 6.3 · R12 — cambiar una categoría de cubeta sin tocar el total

Mutación en `derivarComposicionGanancia` (`egreso_ajuste` deja de ir a su cubeta):

```
 ❯ tests/unit/utils/caja-composicion.test.ts (21 tests | 4 failed)
     × R26: la columna de egresos suma `egresosPropios`   → expected '7272.00' to be '8484.00'
     × R4: cada cubeta de `egresos` suma SOLO su categoria → expected '0.00' to be '45.75'
     × R12: `otrosEgresos + egresos.*` es el MISMO importe que «otros» antes de la ficha
            → expected '227313.20' to be '227358.95'
     × R14: las cifras agregadas de la caja no cambian de valor al repartir la columna
            → expected '228513.20' to be '228558.95'
```

Lo que esta mutación demuestra, y es el motivo de que R12 exista: **`totalEgresos` y
`egresosPropios` no se mueven ni un céntimo** —el dinero sigue en la suma—, y aun así la columna
deja de cuadrar. Un test que solo mirase el total habría pasado en verde. Revertida y verde.

---

## 7 — Verificación

```
$ pnpm typecheck
> tsc --noEmit
TYPECHECK_EXIT=0        (sin una sola línea de salida)

$ pnpm lint
✖ 127 problems (0 errors, 127 warnings)
LINT_EXIT=0
```

Los 127 avisos son PREEXISTENTES (`no-unused-vars` en tests ajenos). Ninguno cae en un archivo de
esta ficha: `pnpm lint | grep -E "composicion-detalle|caja-tesoreria|wallet\.ts|WalletService|…"`
no devuelve nada.

Corrida explícita, por nombre, de **todos** los archivos de test creados o modificados:

```
$ pnpm exec vitest run \
    tests/unit/utils/caja-composicion.test.ts \
    tests/unit/guards/caja-composicion-exhaustiva.guardia.test.ts \
    tests/unit/services/wallet-service.test.ts \
    tests/unit/actions/wallet-actions.test.ts \
    tests/unit/actions/wallet-detalle-fila-action.test.ts \
    tests/unit/config/composicion-detalle-config.test.ts \
    tests/integration/db/composicion-detalle-postgres.test.ts \
    tests/integration/wallet-page.test.tsx \
    tests/components/ComposicionGananciaCard.test.tsx \
    tests/components/descarga/WalletDescarga.test.tsx \
    tests/unit/components/wallet-page-cobros-pendientes.test.tsx

 Test Files  11 passed (11)
      Tests  156 passed (156)
   Duration  13.27s
```

**La suite de Postgres CORRIÓ de verdad** (no se saltó): hay base alcanzable y los 6 casos
ejecutaron contra el motor, dentro de una transacción revertida.

Guardias completas (`pnpm exec vitest run guard`, 169 archivos):

```
 Test Files  1 failed | 168 passed (169)
      Tests  1 failed | 2561 passed (2562)
```

El único rojo es **`superficie-de-uso.guardia.test.ts` por `lib/actions/tarifas.ts:67
obtenerTarifa`**, que es **deuda AJENA y CONOCIDA de `dev`**: está declarada en
`tests/baseline-rojos.json` desde el 2026-08-28 con ese mismo motivo, y `git grep obtenerTarifa
origin/dev` confirma que ya no tiene un solo importador allí. Esta ficha **no añadió nada a esa
entrada**: ver § 8.2.

---

## 8 — Lo que se le deja al frontend

### 8.1 · El contrato

```ts
listarMovimientosDeFilaAction(input: unknown, deps?: WalletDeps)
  → { status: "ok"; data: { movimientos: WalletMovimientoDTO[]; total: number; page: number; pageSize: number } }
  | { status: "forbidden" }
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
```

`input` = **token de fila** + los filtros vigentes del libro:
`{ fila: ComposicionFilaId, page?, pageSize?, tipo?, categoria?, desde?, hasta? }`.
`fila` es uno de los 14 valores de `COMPOSICION_FILA_SEED` (7 ingresos + 6 egresos +
`"otros_egresos"`). El cliente **nunca** manda una lista de categorías.
`page` por defecto 1; `pageSize` por defecto `composicionDetalleConfig.DEFAULT_PAGE_SIZE` (10) y
tope `MAX_PAGE_SIZE` (50) — la pantalla **no** debe escribir ninguno de los dos como literal.
Cada movimiento es un `WalletMovimientoDTO` ya existente: `id`, `tipo`, `categoria`, `monto`
(STRING escala 2), `origenTipo`, `origenId`, `descripcion` (**`null` en los pagos a mensajeros**),
`registradoPor`, `fechaMovimiento` (ISO), `dueno`.
`total` es el del CONJUNTO y lo cuenta la base: **no uses `movimientos.length`**.

`ComposicionGananciaDTO` gana `egresos: Record<"egreso_pago_mensajero" | "egreso_ajuste", string>`
y `hayOtrosEgresos: boolean` (lo decide el servidor; la pantalla **no** compara importes).

### 8.2 · Tres cosas que el frontend TIENE que hacer

1. **Borrar la anotación `@sin-superficie`** del docstring de `listarMovimientosDeFilaAction` en
   `lib/actions/wallet.ts` al cablear el desplegable. Está puesta porque hoy la acción no tiene
   pantalla que la dispare, y **caduca sola**: `superficie-de-uso.guardia.test.ts` se pone rojo si
   un export anotado vuelve a ser alcanzable. Sin ese borrado, el gate cae.
2. **B6.1 — el censo de tablas**: al nacer `DetalleFilaComposicion.tsx` con su `<DataTable>`, la
   guardia dirá «29 recibido / 28 esperado». Se deja fallar primero (convención de ese archivo) y
   luego: archivos 28 → 29, instancias 28 → 29, `totalCensado` 29 → 30, `fuera` 10 → 11,
   `con_descarga` sin cambio (19), con el motivo de `design.md § 8`.
3. **B6.3 — los literales-contrato de `ComposicionGananciaCard.test.tsx`**: su fixture recibió SOLO
   las dos claves nuevas (con las cubetas a `0.00` y los 940,00 intactos en «otros», para que la
   tarjeta siguiera pintando exactamente lo mismo). Los `toEqual` de rótulos y de pares
   rótulo↔importe hay que **actualizarlos deliberadamente** con las filas nuevas, no derivarlos de
   su propia fuente.

---

## 9 — Veredicto

Backend de la 339 completo (B0–B4): «Otros» ya solo puede contener `egreso_gasto`, el detalle de
cada fila se lee del `WHERE` con la MISMA definición que produce su importe, y las tres mutaciones
—el `WHERE`, el `total` y la cubeta— se ejecutaron, salieron rojas nombrando el dinero y se
revirtieron; typecheck y lint en 0, 156 tests verdes en los 11 archivos tocados.
