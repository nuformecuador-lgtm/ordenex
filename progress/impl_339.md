# Ficha 339 — bitácora de implementación (BACKEND, bloques B0–B4)

> Zona `fullstack`, backend primero. **Este documento cubre B0, B1, B2, B3 y B4.**
> Los bloques **B5 (la tarjeta) y B6 (censos ajenos de frontend)** los implementa el agente de
> frontend; lo que este bloque le deja cableado está en § 8.
>
> **AL DÍA (2026-08-31): B5 y B6 ya están hechos y su bitácora es la SEGUNDA MITAD de este
> archivo (§ 10 en adelante).** El párrafo de arriba se conserva tal cual porque describe el
> estado en el que este bloque terminó, no el de hoy.

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

---
---

# Ficha 339 — bitácora de implementación (FRONTEND, bloques B5–B6)

> **Este bloque AMPLÍA el documento de arriba, no lo sustituye.** Cubre **B5 (la tarjeta)** y
> **B6 (los censos ajenos de frontend)**. Lo que el backend dejó cableado está en § 8 de arriba;
> aquí se cuenta qué se hizo con ello.

Rama: `fix/339-otros-gastos`. Fecha: 2026-08-31.

---

## 10 — Qué se hizo, en una frase

La tarjeta «Cómo se compone la ganancia de Ordenex» pasa de **cinco filas de egreso con un cubo
anónimo de 227.300,00** a **seis filas con nombre + un cubo que sólo aparece cuando de verdad
queda algo**, y **cada una de sus catorce filas se abre** y enseña los movimientos que componen
su importe. El total de la columna no se mueve ni un céntimo: lo único que cambia es de qué
cubeta sale cada importe.

---

## 11 — Archivos creados

| archivo | qué es |
| --- | --- |
| `app/(app)/wallet/_components/composicion-detalle-labels.ts` | T5.1 — textos del detalle (4 columnas, vacío, error), rótulos de las dos filas nuevas, pista de «Otros» y los nombres accesibles (`DETALLE_FILA_NOMBRE.abrir/region/tabla/paginacion`) |
| `app/(app)/wallet/_components/DetalleFilaComposicion.tsx` | T5.2 — el panel: `useSWR` + `DataTable` (fecha · concepto · detalle · importe) + `Pagination`, sin subtotal y sin descarga |
| `app/(app)/wallet/_components/FilaComposicion.tsx` | T5.3 — la fila desplegable, **una sola pieza para las dos columnas** |
| `tests/components/DetalleFilaComposicion.test.tsx` | R15/R16/R17/R21–R26/R28/R35/R36 + la mitad de pantalla de R29 y R31 |

## 12 — Archivos modificados

| archivo | qué cambió |
| --- | --- |
| `app/(app)/wallet/_components/DesgloseEgresosLista.tsx` | T5.4 — dos filas nuevas recorriendo `WALLET_EGRESO_NOMBRADO_SEED`, «Otros» condicional a `hayOtrosEgresos` con su pista, y las filas pasan a ser desplegables. El `role="group"`, el `aria-label` y la estructura `<dt>`/`<dd>` NO cambian |
| `app/(app)/wallet/_components/ComposicionGananciaCard.tsx` | T5.5 — recibe `filtros` y los baja a las filas; las siete de ingreso también abren (Q1); `DESCRIPCION` pasa a nombrar los **ajustes** (R41) sin tocar lo que dice que queda fuera (R42) |
| `app/(app)/wallet/_components/WalletFiltros.tsx` | T5.6 — nace `inputDeFiltros(filtros)`, la ÚNICA función que traduce los filtros vigentes a un input de borde. Vive junto al tipo y al valor vacío que ya vivían ahí |
| `app/(app)/wallet/_components/WalletModule.tsx` | T5.6 — pasa `filtros` a la tarjeta; `buildInput` **compone** `inputDeFiltros` con la página y `buildInputCompleto` desaparece (era la segunda copia del mismo bucle) |
| `lib/actions/wallet.ts` | **Deber 1 del backend**: se BORRA la anotación de excepción del docstring de `listarMovimientosDeFilaAction` al cablear su pantalla |
| `tests/unit/descarga/censo-tablas.ts` + `tests/unit/descarga/cobertura-tablas.guardia.test.ts` | **T6.1** — la tabla nueva se registra `fuera` con su motivo, y los números suben (§ 14) |
| `tests/components/ComposicionGananciaCard.test.tsx` | **T6.3** — los literales-contrato actualizados A MANO + once casos nuevos (R1/R2/R3/R5/R6/R7/R8/R9/R10/R11-R12/R41/R42) |
| `tests/integration/wallet-page.test.tsx`, `tests/unit/components/wallet-page-cobros-pendientes.test.tsx`, `tests/components/descarga/WalletDescarga.test.tsx` | cambio de ARNÉS: los tres montan el `WalletModule` REAL, cuyo árbol importa ahora el borde del detalle. Sin declararlo en su doble, el import no resuelve y el archivo entero se queda sin ejecutar |

### 12.1 · Decisiones de forma que conviene dejar escritas

- **El orden**: las cuatro filas existentes **se quedan donde están** y las dos nuevas entran
  **justo antes de «Otros»** (decisión cerrada, distinta de la que proponía `design.md § Q2`).
  Aparecen donde el dinero se venía mostrando, en vez de reordenar una tarjeta ya conocida.
- **Rótulos**: «Pagos a mensajeros» y «Ajustes (egreso)», en la voz PLURAL de sus vecinas de
  columna («Sueldos», «Indemnizaciones»). El de los ajustes es el concepto que el diálogo
  «Registrar movimiento» promete por `nombreEnElLibro` («Ajuste (egreso)»), y está escrito **a
  mano** en el módulo de textos: derivarlo de `CATEGORIA_LABEL` dejaría el caso de R3 comparando
  el rótulo contra su propia fuente, es decir, siempre verde.
- **La estructura de la fila** es un `<div>` hijo de la `<dl>` con `<dt>` (botón), `<dd>`
  (importe) y —cuando toca— un `<dd>` para la pista y otro para el panel. Es lo que mantiene en
  pie las aserciones heredadas de las fichas 45, 158 y 231, que leen `dt`/`dd` fila a fila.
- **`aria-controls` va SIEMPRE puesto**, abierto o cerrado: es el precedente vivo del botón de
  expandir de `DataTable`, y no se inventa una convención nueva para esta tarjeta.
- **La paginación NO se llama `PAGINACION_*_LABEL`** (design § 6). Es
  `DETALLE_FILA_NOMBRE.paginacion(fila)`, que además compone el nombre de SU fila (R24). El
  censo de paginación sigue midiendo **13** y se corrió para comprobarlo.

---

## 13 — Mapa `R<n> → test` (lo que cubre el frontend)

| R | test | estado |
| --- | --- | --- |
| R1 | `ComposicionGananciaCard.test.tsx` › R1: la columna de egresos tiene fila «Pagos a mensajeros» con su importe | ✅ |
| R2 | `ComposicionGananciaCard.test.tsx` › R2: … fila «Ajustes (egreso)» con su importe | ✅ |
| R3 | `ComposicionGananciaCard.test.tsx` › R3: el rótulo de los ajustes usa el concepto que el diálogo promete en el libro | ✅ |
| R5 | `ComposicionGananciaCard.test.tsx` › R5: ningún rótulo de la columna de egresos es el valor del enum (+ el heredado de la 231 para ingresos) | ✅ |
| R6 | `ComposicionGananciaCard.test.tsx` › R28: el orden es el declarado, no el de magnitud (la columna de egresos, con su contraprueba: ni el mayor ni el menor están en los extremos) | ✅ |
| R7 | `ComposicionGananciaCard.test.tsx` › R7: con `hayOtrosEgresos` falso, la fila «Otros gastos de Ordenex» no está en el DOM | ✅ (mutación en § 15.1) |
| R8 | `ComposicionGananciaCard.test.tsx` › R8: con `hayOtrosEgresos` verdadero, la fila aparece con su importe | ✅ |
| R9 | `ComposicionGananciaCard.test.tsx` › R9: la decisión es del SERVIDOR — la tarjeta no compara importes | ✅ |
| R10 | `ComposicionGananciaCard.test.tsx` › R10: la fila «Otros» lleva su pista sobre el dinero sin clasificar | ✅ |
| R11/R12 | `ComposicionGananciaCard.test.tsx` › R11/R12: el total de la columna no se movió al sacar dos conceptos del cubo | ✅ |
| R15 | `DetalleFilaComposicion.test.tsx` › R15: al abrir una fila se muestran los movimientos que componen su importe | ✅ |
| R16 | `DetalleFilaComposicion.test.tsx` › R16: cada movimiento muestra fecha, concepto, detalle e importe | ✅ |
| R17 | `DetalleFilaComposicion.test.tsx` › R17: un movimiento sin descripción muestra su origen legible | ✅ |
| R20 | `DetalleFilaComposicion.test.tsx` › R20: los filtros vigentes de la wallet bajan al detalle, y sólo ellos | ✅ (la mitad del `WHERE` la mide Postgres, § 6 de arriba) |
| R21 | `DetalleFilaComposicion.test.tsx` › R21: con las filas cerradas no se lee nada | ✅ |
| R22 | `DetalleFilaComposicion.test.tsx` › R22: abrir una fila cuesta exactamente UNA lectura, y sólo de esa fila | ✅ |
| R23 | `DetalleFilaComposicion.test.tsx` › R23: dos filas abiertas mantienen páginas independientes | ✅ |
| R24 | `DetalleFilaComposicion.test.tsx` › R24: el control de abrir nombra SU fila, y no hay dos que se llamen igual (+ el caso del estado del disclosure) | ✅ |
| R25 | `DetalleFilaComposicion.test.tsx` › R25: una fila sin movimientos muestra su estado vacío | ✅ |
| R26 | `DetalleFilaComposicion.test.tsx` › R26: un fallo de lectura se cuenta DENTRO de la fila y la tarjeta sigue en pie | ✅ |
| R28 | `DetalleFilaComposicion.test.tsx` › R28: con más movimientos que la página se puede navegar a la siguiente | ✅ |
| R29 (mitad de pantalla) | `DetalleFilaComposicion.test.tsx` › R29: el tamaño de página lo manda la CONFIGURACIÓN, y la pantalla no lo escribe | ✅ |
| R31 (mitad de pantalla) | `DetalleFilaComposicion.test.tsx` › R31: el total que pagina es el del SERVIDOR, no el largo de la página pintada | ✅ (mutación en § 15.2) |
| R35 | `DetalleFilaComposicion.test.tsx` › R35: ninguna fuente nueva opera con dinero + `ComposicionGananciaCard.test.tsx` › R12 (ampliado a `FilaComposicion.tsx`) | ✅ |
| R36 | `DetalleFilaComposicion.test.tsx` › R36: el detalle no pinta ningún subtotal de la página visible | ✅ |
| R41 | `ComposicionGananciaCard.test.tsx` › R41: la descripción nombra también los ajustes | ✅ |
| R42 | `ComposicionGananciaCard.test.tsx` › R42: la descripción sigue diciendo que el dinero de las tiendas no entra | ✅ |
| design § 10-A1 | `DetalleFilaComposicion.test.tsx` › el input de una fila es su token y su página, y ninguna lista de categorías | ✅ (mutación en § 15.3) |

---

## 14 — Los tres censos ajenos, cerrados

1. **Censo de tablas (T6.1).** La guardia **se dejó fallar primero**, como manda la convención
   escrita en ese propio archivo:

   ```
   FAIL  tests/unit/descarga/cobertura-tablas.guardia.test.ts
   AssertionError: hay tablas sin registrar en tests/unit/descarga/censo-tablas.ts:
     expected [ Array(1) ] to deeply equal []
   +   "app/(app)/wallet/_components/DetalleFilaComposicion.tsx #1",
   ```

   Y después se registró `fuera` (motivo de `design.md § 8`, entre
   `CobrosRechazoTiendaPendientesPanel` y `GastosFijosPlantillasPanel`, que es donde cae por el
   orden alfabético con el que la guardia recorre el árbol) y se subieron los números:

   | número | antes | después |
   | --- | --- | --- |
   | `TOTAL_ARCHIVOS_CON_DATATABLE` | 28 | **29** |
   | `TOTAL_INSTANCIAS_DATATABLE` | 28 | **29** |
   | `totalCensado` | 29 | **30** |
   | instancias `fuera` (`excluidas.length`) | 9 | **10** |
   | tablas censadas `fuera` | 10 | **11** |
   | tablas censadas `con_descarga` | 19 | **19 (sin cambio)** |

2. **Barrido de STRING de `wallet-page.test.tsx` (T6.2).** Ya lo hizo el backend (§ 5.2 de
   arriba) y se corrió otra vez aquí: verde. El frontend no lo tocó — sólo añadió al doble de
   `@/lib/actions/wallet` el export nuevo, sin el cual ese archivo no ejecuta ni un caso.

3. **Censo de paginación (`paginacion-transversal.test.tsx`).** **Intacto en 13.** El nombre
   accesible del control del detalle se declara como `DETALLE_FILA_NOMBRE.paginacion(fila)` y
   NO como `export const PAGINACION_*_LABEL`; corrido y verde.

---

## 15 — Las tres mutaciones exigidas (ejecutadas y revertidas)

### 15.1 · R7/R9 — que «Otros» se pinte SIEMPRE, aunque valga 0,00

Mutación en `DesgloseEgresosLista.tsx`: la condición `hayOtrosEgresos` del ternario que decide
si la fila entra en el DOM se sustituye por `true`.

```
 ❯ tests/components/ComposicionGananciaCard.test.tsx (29 tests | 3 failed) 964ms
     × R7: con `hayOtrosEgresos` falso, la fila «Otros gastos de Ordenex» no está en el DOM
     × R9: la decisión es del SERVIDOR — la tarjeta no compara importes
     × R10: la fila «Otros» lleva su pista sobre el dinero sin clasificar

 AssertionError: expected <span class="truncate"></span> to be null
 - Expected: null
 + Received: <span class="truncate">Otros gastos de Ordenex</span>

 AssertionError: expected <dd …(1)></dd> to be null
 + Received: <dd class="col-span-2 …">Acá hay dinero de un concepto que esta tarjeta todavía
             no sabe nombrar. Abrí la fila para ver de dónde viene.</dd>

 Test Files  1 failed (1)
      Tests  3 failed | 26 passed (29)
```

Lo que demuestra: la fila «Otros» con importe cero **no puede volver a aparecer en silencio**, y
la pista tampoco se queda de adorno permanente. Revertida (la condición vuelve a ser la del
servidor, comprobado en el archivo) y 29/29 en verde.

### 15.2 · R31 — usar el largo de la página como `total` del detalle

Mutación en `DetalleFilaComposicion.tsx`: el `total` deja de leerse de la respuesta del servidor
y pasa a ser el número de movimientos pintados.

```
 ❯ tests/components/DetalleFilaComposicion.test.tsx (17 tests | 4 failed) 5199ms
     × R23: dos filas abiertas mantienen páginas independientes
     × R28: con más movimientos que la página se puede navegar a la siguiente
     × R31: el total que pagina es el del SERVIDOR, no el largo de la página pintada
     × R29: el tamaño de página lo manda la CONFIGURACIÓN, y la pantalla no lo escribe

 AssertionError: expected "vi.fn()" to be called 3 times, but got 2 times
 TestingLibraryElementError: Unable to find an element with the text: 1-10 de 12
 TestingLibraryElementError: Unable to find an element with the text: 1-3 de 7

 Test Files  1 failed (1)
      Tests  4 failed | 13 passed (17)
```

Lo que demuestra, y es el motivo de que este caso exista: con el largo de la página como total,
**la barra diría «1-3 de 3» y el botón de siguiente se apagaría** — los otros nueve movimientos
de la fila quedan inalcanzables sin que nada falle ni se rompa la pantalla. Revertida y 17/17
verde.

### 15.3 · design § 10-A1 — que el navegador mande CATEGORÍAS en vez del token de fila

Mutación en el fetcher de `DetalleFilaComposicion.tsx`: el cliente resuelve el complemento y
manda la lista de categorías —las tres correctas de hoy para «Otros», y la propia para el resto—
en lugar del token.

```
 ❯ tests/components/DetalleFilaComposicion.test.tsx (17 tests | 5 failed) 2143ms
     × R22: abrir una fila cuesta exactamente UNA lectura, y sólo de esa fila
     × R23: dos filas abiertas mantienen páginas independientes
     × R28: con más movimientos que la página se puede navegar a la siguiente
     × el input de una fila es su token y su página, y ninguna lista de categorías
     × R20: los filtros vigentes de la wallet bajan al detalle, y sólo ellos

 AssertionError: expected { categorias: [ …(3) ], page: 1 } to deeply equal
                          { fila: 'otros_egresos', page: 1 }
 - "fila": "otros_egresos",
 + "categorias": [ "egreso_gasto", "egreso_pago_mensajero", "egreso_ajuste" ],

 AssertionError: expected { tipo: 'egreso', …(5) } to deeply equal { tipo: 'egreso', …(5) }
 + "categorias": [ "egreso_pago_mensajero" ],
 - "fila": "egreso_pago_mensajero",

 Test Files  1 failed (1)
      Tests  5 failed | 12 passed (17)
```

Lo que demuestra: existe una red que impide que el navegador vuelva a tener **una segunda
definición del complemento**. Y nótese que la mutación es *plausible* —la lista que escribe es la
correcta HOY—: el fallo que evita no es un error de cálculo, es que esa lista y la del servidor
puedan separarse mañana sin que nada avise. Revertida (en el archivo sólo queda la palabra
«categorias» dentro del comentario que explica por qué no se mandan) y 17/17 verde.

---

## 16 — Verificación (frontend)

```
$ pnpm typecheck
> tsc --noEmit
TYPECHECK_EXIT=0        (sin una sola línea de salida)

$ pnpm lint
✖ 127 problems (0 errors, 127 warnings)
LINT_EXIT=0
```

Los 127 avisos son los MISMOS preexistentes que anotó el backend (`no-unused-vars` en tests
ajenos). Ninguno cae en un archivo de este bloque: filtrar la salida de `pnpm lint` por
`composicion`, `FilaComposicion`, `DesgloseEgresosLista`, `WalletFiltros`, `WalletModule` y
`DetalleFila` no devuelve nada.

Corrida explícita, **por nombre**, de todos los archivos de test creados o modificados en B5/B6:

```
$ pnpm exec vitest run \
    tests/components/DetalleFilaComposicion.test.tsx \
    tests/components/ComposicionGananciaCard.test.tsx \
    tests/unit/descarga/cobertura-tablas.guardia.test.ts \
    tests/integration/wallet-page.test.tsx \
    tests/unit/components/wallet-page-cobros-pendientes.test.tsx \
    tests/components/descarga/WalletDescarga.test.tsx \
    tests/components/paginacion/paginacion-transversal.test.tsx \
    tests/components/CajaComposicionBarra.test.tsx

 Test Files  8 passed (8)
      Tests  106 passed (106)
```

Todo lo que toca la wallet, la composición y la caja:

```
$ pnpm exec vitest run wallet composicion caja
 Test Files  93 passed (93)
      Tests  1281 passed (1281)
```

Guardias completas (`pnpm exec vitest run guard`, 169 archivos):

```
 Test Files  1 failed | 168 passed (169)
      Tests  1 failed | 2561 passed (2562)
```

**Los mismos números, test a test, que midió el backend en § 7.** El único rojo sigue siendo
`superficie-de-uso.guardia.test.ts` por `lib/actions/tarifas.ts:67 obtenerTarifa`, deuda AJENA
declarada en `tests/baseline-rojos.json` desde el 2026-08-28. Lo que sí cambió es que
**`listarMovimientosDeFilaAction` ya NO aparece en esa lista**: al cablearse el desplegable, la
action pasó a ser alcanzable y su anotación de excepción se borró — que es exactamente el deber
que el backend dejó escrito.

---

## 17 — Lo que quedó dudoso (frontend)

1. **No se ha visto en el navegador.** Todo lo de arriba es jsdom. El disclosure sobre una `<dl>`
   en rejilla (`grid-cols-[1fr_auto]` con el panel a `col-span-2`) es la primera vez que este
   repo lo hace, y el aspecto en móvil —una `DataTable` de cuatro columnas dentro de media
   tarjeta— no está medido. La memoria del repo dice que ver la app encuentra lo que la suite no.
2. **`aria-controls` apunta a un id que no existe mientras la fila está cerrada.** Es el
   precedente vivo del `DataTable`, y por eso se copió en vez de inventar otra convención; pero
   es una elección discutible y está aquí escrita para que se pueda discutir.
3. **«Ajustes (egreso)» en plural frente a «Ajuste (egreso)» que promete el diálogo.** Se eligió
   la voz plural de sus vecinas de columna; si se prefiere la coincidencia byte a byte con la
   promesa, es una línea en `composicion-detalle-labels.ts` y dos literales en su test.
4. **Cerrar una fila olvida su página.** El estado vive dentro del panel, que se desmonta al
   cerrar (es lo que compra el «cero lecturas» de R21). Reabrir vuelve a la primera página.
5. **`inputDeFiltros` vive en `WalletFiltros.tsx`**, que es un componente `"use client"`. Es
   donde ya viven el tipo y el valor vacío, pero si mañana la usara algo fuera de la wallet
   convendría mudarla a un módulo puro.

---

## 18 — Veredicto (frontend)

B5 y B6 completos. «Otros gastos de Ordenex» sólo se pinta cuando el SERVIDOR dice que ahí queda
dinero y, cuando se pinta, lo dice con una pista; los pagos a mensajeros y los ajustes tienen
fila propia con su nombre; las catorce filas se abren y leen su detalle con el TOKEN de la fila,
nunca con una lista de categorías; el total de la columna no se movió ni un céntimo. Las tres
mutaciones se ejecutaron, salieron rojas nombrando lo que protegen y se revirtieron. Typecheck y
lint en 0; 106 tests verdes en los ocho archivos tocados y 1.281 en todo lo que toca la wallet.
