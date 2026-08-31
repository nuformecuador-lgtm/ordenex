# Ficha 336 — borrar `/mis-pagos` y `/qr` · bitácora de implementación

> **Worktree aislado:** `R:/job/singularis/wt-336` · **Rama:** `fix/336-borrar-mis-pagos-y-qr`
> **Fecha:** 2026-08-31 · **Rol:** `backend_dev`
> **Nota de alcance:** este agente NO ejecutó ningún comando `git` de escritura (prohibido en el
> encargo). Las tasks **F.1, F.2, F.7 y F.8** (gate rápido, gate completo, verificación del blob
> commiteado y apertura del PR) quedan **para el leader**, con la evidencia que hace falta pegada
> más abajo.

---

## 0 · La medición previa (Tanda 0), antes de borrar nada

Todas las cifras salen de correr los detectores, no de una suma de escritorio. Cuando el suelo de
una guardia pasaba en verde, se subió temporalmente a `99999` para que el propio detector
**imprimiera** el número que ve, y se restauró el archivo acto seguido (verificado con
`git status` limpio).

| Medida | Detector | ANTES |
| --- | --- | --- |
| `paginadas.size` | `contadores-cabecera.guardia` | **34** (suelo `>= 30`) |
| `TOTAL_ARCHIVOS_CON_DATATABLE` / `TOTAL_INSTANCIAS_DATATABLE` | `cobertura-tablas.guardia` | **29 / 29** (`toBe` exacto, en verde) |
| `excluidas.length` | idem | **9** |
| `totalCensado` | idem | **30** |
| tablas `con_descarga` / `fuera` | idem | **20 / 10** |
| constantes `COLUMNAS_DESCARGA_*` | `columnas-asercion-de-orden.guardia` | **41** (suelo `>= 35`) |
| llamantes de `filasDesdeResultado` en `app/` | `adaptador-conjunto.guardia` | **24** (suelo `>= 13`) |

> **Corrección medida al spec:** el `design.md` decía `28/28 → 27/27` para `cobertura-tablas`. En
> este worktree son **29/29**, porque `dev` se movió: las fichas **333** y **337** añadieron cada
> una una tabla después de escribirse el spec. Y el spec anticipaba **dos** números duros en ese
> archivo; hay **cuatro** (ver §4).

### T0.1 — la lista de acciones sin superficie, ANTES

`pnpm exec vitest run tests/unit/guards/superficie-de-uso.guardia.test.ts`

```
AssertionError: estas Server Actions no las importa NINGÚN módulo alcanzable desde una raíz de
ruta ...: expected [ Array(1) ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "lib/actions/tarifas.ts:67 obtenerTarifa",
+ ]

 Test Files  1 failed (1)
      Tests  1 failed | 17 passed (18)
```

**Contenido de la lista ANTES: exactamente una entrada, ajena — `lib/actions/tarifas.ts:67 obtenerTarifa`.**

### T0.2 — `useQrNavigate` es exclusivo de `/qr` (confirmado en los archivos reales)

`grep -rn "useQrNavigate"` en todo el árbol, fuera de `specs/`:

- `app/(app)/qr/page.tsx:5` — **el único import** (`import { useQrNavigate } from "@/hooks/useQrNavigate"`)
- `app/(app)/qr/page.tsx:8` — su única invocación
- `hooks/useQrNavigate.ts:17` — la definición
- `components/shared/QrScanner.tsx:61` y `tests/components/QrScanner.test.tsx:185,198` — **prosa**,
  no referencias de ejecución

### T0.3 — los importadores de `QrScanner` y las seis superficies de escaneo

**Importadores DIRECTOS de `components/shared/QrScanner.tsx` — hoy 3, tras la ficha 2:**

| Archivo | Tras la ficha |
| --- | --- |
| `components/shared/EscanerGuiaCard.tsx` | vive |
| `app/(app)/mis-asignaciones/_components/VerificarGuiaGate.tsx` | vive |
| `app/(app)/qr/page.tsx` | **se borra** |

El resto de archivos que el `grep` devolvía (`CierresAdminModule`, `RecogerPaqueteCard`,
`EscanerRecepcion`, `EscanerModal`, `app/globals.css`) **nombran `QrScanner` en un comentario o
en CSS**, no lo importan. Confirmado abriendo cada uno.

**Superficies que montan `<EscanerGuiaCard` — 6, y siguen siendo 6:**

1. `app/(app)/ordenes/_components/EscanerRecepcionOrigen.tsx`
2. `app/(app)/ordenes/_components/EscanerRecepcionBodegaCentral.tsx`
3. `app/(app)/recepcion-satelite/_components/EscanerRecepcion.tsx`
4. `app/(app)/recoleccion/_components/RecoleccionModule.tsx`
5. `app/(app)/mis-asignaciones/_components/RecogerPaqueteCard.tsx`
6. `app/(app)/cierres-admin/_components/cierre-confirmacion-fisica.tsx`

---

## 1 · Censo de lo BORRADO

### Producción — 8 archivos

| # | Archivo |
| --- | --- |
| 1 | `app/(app)/mis-pagos/page.tsx` |
| 2 | `app/(app)/mis-pagos/_components/MisPagosModule.tsx` |
| 3 | `app/(app)/mis-pagos/_components/CuentaPorPagarCard.tsx` |
| 4 | `app/(app)/mis-pagos/_components/DesglosePagos.tsx` |
| 5 | `app/(app)/mis-pagos/_components/mis-pagos-descarga-columnas.ts` |
| 6 | `app/(app)/mis-pagos/_components/mis-pagos-labels.ts` |
| 7 | `app/(app)/qr/page.tsx` |
| 8 | `hooks/useQrNavigate.ts` |

### Tests SUYOS — 2 archivos

| # | Archivo |
| --- | --- |
| 9 | `tests/integration/mis-pagos-page.test.tsx` |
| 10 | `tests/unit/services/wallet-mis-pagos-descarga.test.ts` |

### Símbolos retirados de `lib/` (4 archivos editados)

`lib/actions/wallet-mensajero.ts`
: `verMiCuentaPorPagarAction`, `listarMisPagosAction`, `listarMisPagosCompletoAction`,
  `VerMiCuentaPorPagarActionResult`, `ListarMisPagosActionResult` y los 5 imports que quedaron
  sin uso. **Sin una sola anotación `@sin-superficie` nueva.**

`lib/services/WalletMensajeroService.ts`
: `verMiCuentaPorPagar`, `listarMisPagos`, `listarMisPagosCompleto` y la constante
  `ROL_MENSAJERO`, que se quedó sin ningún lector (era la guardia de rol de esos tres métodos).

`lib/interfaces/services/IWalletMensajeroService.ts`
: las 3 firmas + `ListarMisPagosPayload`, `VerMiCuentaPorPagarServiceResult`,
  `ListarMisPagosServiceResult`, `ListarMisPagosCompletoServiceResult` y el import de
  `CuentaPorPagarDTO`, que se quedó sin ninguna firma que lo nombrara **en este archivo** (el
  tipo sigue vivo y exportado desde `lib/types/wallet-mensajero.ts`).

`lib/types/wallet-mensajero.ts`
: `listarMisPagosCompletoSchema`, `ListarMisPagosCompletoInput`, `ListarMisPagosCompletoResult`
  y — **fuera de lo que el spec listaba, y solo tras comprobar que no le quedaba ni una
  referencia en todo el árbol** — `ListarPagosMensajeroInput`, el alias inferido del schema base
  cuyo único consumidor era `WalletMensajeroService.listarMisPagos`.

---

## 2 · Censo de lo CONSERVADO (comprobado, no supuesto)

- **`components/shared/QrScanner.tsx`** y `tests/components/QrScanner.test.tsx` — **intactos**.
- **`components/shared/EscanerGuiaCard.tsx`** y **`components/shared/EscanerModal.tsx`** — intactos,
  con sus **6** superficies de escaneo montando la tarjeta.
- **`lib/services/WalletMensajeroService.ts`** — se queda, con sus 5 lecturas de administración.
- **`lib/repositories/PagoMensajeroMovimientoRepository.ts`** — **íntegro, ni una línea tocada**.
- **Las 4 Server Actions de administración** (`listarCuentasPorPagarAction`,
  `…PaginadoAction`, `…CompletoAction`, `listarPagosDeMensajeroAction`) + `listarPagosDeMensajeroCompletoAction`.
  **La wallet de mensajeros del admin (`/wallet/mensajeros`) sigue funcionando.**
- **`listarPagosMensajeroSchema`** — se queda. Parece «el schema de mis pagos» y **no lo es**: es
  la BASE de la que `listarPagosDeMensajeroSchema` deriva con `.extend(...)`. Borrarlo rompía la
  vista del maestro sin que ningún nombre lo delatara.
- **`CuentaPorPagarDTO`** — se queda (lo usan `DesglosePagosMensajero` y `lib/utils/cuenta-por-pagar.ts`).
- **`db/**` — CERO cambios.** `git diff --stat -- db/` vacío.

---

## 3 · La cobertura AJENA que sobrevivió (12 archivos + 1 e2e, editados, ninguno borrado)

| Archivo | Feature | Qué se le quitó | Qué sigue cubriendo |
| --- | --- | --- | --- |
| `tests/unit/actions/wallet-mensajero-actions.test.ts` | 44 / 170 | los 2 `describe` de la vista propia + los 3 métodos del doble | los **4** `describe` de las acciones del maestro |
| `tests/unit/actions/wallet-mensajero-descarga-action.test.ts` | 170 | el `describe` de `listarMisPagosCompletoAction`, su import y su mock | el de `listarPagosDeMensajeroCompletoAction` |
| `tests/unit/services/wallet-mensajero-service.test.ts` | 44 | los 2 `describe` de la vista propia + la const `OTRO_MENSAJERO` | `listarCuentasPorPagar`, `listarPagosDeMensajero` y el de **inmutabilidad (R3)** |
| `tests/unit/descarga/wallet-mensajero-descarga-columnas.test.ts` | 170 | el `it` de `COLUMNAS_DESCARGA_MIS_PAGOS`, su entrada de `LEDGERS`, su import y el `describe` de paridad | **el `it` que NOMBRA `COLUMNAS_DESCARGA_DESGLOSE_MENSAJERO`** |
| `tests/components/descarga/WalletDescarga.test.tsx` | 170 | `renderMisPagos`, su caso de `LEDGERS`, los 2 mocks y **la ruta borrada de la lista de módulos de presentación** | los 3 ledgers restantes |
| `tests/components/PremioRankingRotulo.test.tsx` | **293** | los 3 imports de `mis-pagos/*`, el `describe` de la vista del mensajero, el `it` de `filaDescargaMiPago` y su entrada del `it.each` | R34 sobre el desglose del maestro y su archivo |
| `tests/unit/guards/liquidacion-money-safe.test.ts` | **172** | las 2 rutas de `mis-pagos` de `ARCHIVOS_DE_LA_FEATURE` | el resto del censo (≈45 rutas) |
| `tests/unit/guards/caja-173-alcance.guardia.test.ts` | **173** | `app/(app)/mis-pagos/_components` de `PANTALLAS_CONGELADAS` | R63 sobre las 2 carpetas restantes |
| `tests/unit/descarga/censo-tablas.ts` | 170 | la entrada `mis-pagos/_components/DesglosePagos.tsx` | las 27 rutas restantes |
| `tests/unit/descarga/cobertura-tablas.guardia.test.ts` | 170 | — | los **4** totales duros, re-medidos (§4) |
| `tests/unit/descarga/contadores-cabecera.guardia.test.ts` | 170 | — (el suelo NO se toca) | un ejemplo rancio de la cabecera corregido + la medida `34 → 32` escrita |
| `tests/integration/db/pago-mensajero-liquidacion.test.ts` | 44/172 | los 2 `typeof` de las acciones retiradas | la afirmación negativa **y su control positivo re-anclado** |
| `tests/integration/wallet-mensajeros-page.test.tsx` | 44/293 | las 2 claves rancias del `vi.mock` | todo (higiene, no era bloqueante) |
| `e2e/wallet-mensajeros.spec.ts` | 44 | los 2 `test.describe` de `/mis-pagos` + la cabecera | los 2 de `/wallet/mensajeros` |

**NO se tocaron, y se verificó por qué:** `tests/components/QrScanner.test.tsx`,
`tests/unit/descarga/columnas-asercion-de-orden.guardia.test.ts` y
`tests/unit/descarga/adaptador-conjunto.guardia.test.ts` (§4).

### El control positivo re-anclado (R21)

`tests/integration/db/pago-mensajero-liquidacion.test.ts` afirmaba
`typeof actions.verMiCuentaPorPagarAction === "function"` como testigo de que el módulo existe.
Ahora los testigos son **dos acciones VIVAS** —`listarCuentasPorPagarAction` y
`listarPagosDeMensajeroAction`— y se añadieron tres `toBeUndefined` sobre las retiradas. Bajar a
un solo testigo dejaba la aserción negativa a un borrado de volverse vacua.

---

## 4 · Los censos compartidos: números medidos, ANTES → DESPUÉS

| Medida | ANTES | DESPUÉS | ¿Se tocó? |
| --- | --- | --- | --- |
| `paginadas.size` (`contadores-cabecera`) | 34 | **32** (suelo 30) | **NO.** Sigue por encima: R19 rama (b) |
| `TOTAL_ARCHIVOS_CON_DATATABLE` | 29 | **28** | SÍ, al número medido |
| `TOTAL_INSTANCIAS_DATATABLE` | 29 | **28** | SÍ, al número medido |
| `totalCensado` | 30 | **29** | SÍ |
| tablas `con_descarga` | 20 | **19** | SÍ |
| tablas `fuera` / `excluidas.length` | 10 / 9 | **10 / 9** | **NO** (la tabla que se fue era `con_descarga`) |
| constantes `COLUMNAS_DESCARGA_*` | 41 | **40** (suelo 35) | **NO** |
| llamantes de `filasDesdeResultado` | 24 | **23** (suelo 13) | **NO** |
| componentes en `PANTALLAS_CONGELADAS` | 3 carpetas | **2 carpetas, 14 archivos (7+7)** | umbrales `> 12` y `> 3` **NO se tocan** |

> **El spec anticipaba DOS números duros en `cobertura-tablas`; hay CUATRO.** Los dos que el
> spec no vio son `expect(totalCensado).toBe(30)` (línea 286) y
> `expect(censadas.filter(con_descarga)).toHaveLength(20)` (línea 352), literales sueltos que no
> viven en una constante nombrada. Los cuatro se bajaron **al número que la guardia reportó**, y
> cada uno lleva escrito en el archivo el motivo nombrando la pantalla, que es la convención de
> ese archivo.
>
> **El diseño también decía que `PANTALLAS_CONGELADAS` quedaba con 13 componentes (7+6).** Son
> **14** (7+7): `mi-wallet/_components` tiene 7 archivos, no 6. El umbral `> 12` pasa con más
> holgura de la prevista.

### La cita rota de la ficha 172 (R23)

`specs/172-liquidacion/tasks.md:768` mapea su **R54** a `tests/integration/mis-pagos-page.test.tsx`.
No hay sustituto, así que se **anotó** al final de ese archivo (fuera de la tabla, que un
comentario dentro la parte) siguiendo la convención que la guardia exige: `@test-desaparecido`,
nombre del archivo, `:` y un motivo de ≥ 30 caracteres.

**Es el único archivo de `specs/` ajeno que esta ficha toca.**

Y como una guardia verde no prueba que la anotación se PARSEE, se comprobó por mutación
(renombrar el archivo citado en la anotación a uno que nadie cita):

```
× ninguna anotación `@test-desaparecido` cuelga de una cita que ya no existe
AssertionError: estas anotaciones no excusan ninguna cita de su propia ficha ...
+ Received
+   "specs/172-liquidacion/tasks.md:801 tests/integration/zzz-nadie-la-cita.test.tsx",
      Tests  1 failed | 12 passed (13)
```

El detector la ve, en su línea correcta. Restaurada.

> **Límite conocido, dicho aquí porque nadie más lo va a decir:** `test-citado-desaparecido`
> deriva su lista de borrados de `git log --diff-filter=D`. Como este agente **no commitea**,
> `mis-pagos-page.test.tsx` todavía **no está en la historia de git** y el caso principal de la
> guardia (`toda cita R → test a un archivo borrado está anotada`) pasa **trivialmente** ahora
> mismo. La anotación ya está puesta y probada; el caso empieza a medir de verdad **después del
> commit**. Es un dato para el leader, no un pendiente de código.

---

## 5 · La guardia nueva (R24, R25)

`tests/unit/guards/rutas-336-retiradas.guardia.test.ts` — **16 casos, 6 bloques**:

| Bloque | Qué afirma |
| --- | --- |
| 0 | **AUTOCOMPROBACIÓN**: el quitador de comentarios se prueba en las **dos direcciones** sobre texto sintético (código visible / prosa invisible), incluido el caso mixto en la misma línea; y **anti-vacuidad**: el recorrido leyó **> 800** módulos de producción, ninguno vacío, con dos controles positivos de ruta |
| 1 | `app/(app)/mis-pagos`, su `_components/` y `app/(app)/qr` no existen; `hooks/useQrNavigate.ts` no existe. **Control de no-vacuidad del `not`**: `app/(app)/mi-wallet/_components` SÍ existe |
| 2 | **Cero referencias de ejecución** a 12 patrones sobre `app/`, `components/`, `lib/`, `hooks/`, `providers/` y `middleware.ts`, **sin comentarios**. `DesglosePagos` con frontera de palabra para no casar `DesglosePagosMensajero`. + **control positivo**: el detector SÍ encuentra los 3 símbolos que siguen vivos |
| 3 | `QrScanner` exportado, con sus **DOS** importadores directos nominados y `>= 2`; las **SEIS** superficies montando `<EscanerGuiaCard`; `EscanerModal` vivo |
| 4 | Las 3 acciones no se exportan; **control positivo**: las 5 de administración SÍ; **exactamente UNA** anotación `@sin-superficie` en el módulo (leída del fuente CRUDO, porque vive en un comentario); servicio e interfaz sin los 3 métodos; `listarPagosMensajeroSchema` y su `.extend` intactos |
| 5 | El baseline no menciona `mis-pagos`, `useQrNavigate`, `wallet-mensajero` ni `336`; y si la entrada de la guardia de superficie sigue viva, su motivo sigue siendo `tarifas`/`obtenerTarifa` **y solo eso** |
| 6 | Los **15** archivos de cobertura ajena existen **y conservan su contenido**: ≥ 2 testigos positivos, ≥ 2 carpetas congeladas, censo money-safe > 30 rutas, la aserción que NOMBRA `COLUMNAS_DESCARGA_DESGLOSE_MENSAJERO`, ≥ 3 ledgers; y los 2 tests suyos sí se fueron |

**La guardia NO afirma «cuatro importadores directos» ni «seis pantallas importan `QrScanner`»**
(E.3): afirma **dos importadores directos nominados** y **seis superficies que montan la tarjeta
compartida**, que es lo que el árbol dice. El criterio está escrito en la cabecera del archivo.

Un detalle de implementación que costó un rojo y queda documentado: la cabecera de
`lib/actions/wallet-mensajero.ts` explica por qué NO se anotaron las acciones, y escribir ahí el
token literal `@sin-superficie` hacía que la cuenta del bloque 4 diera **2**. Se escribe sin la
arroba, y el propio comentario dice por qué.

---

## 6 · Verificación

### `pnpm run typecheck`

```
> ordenex@0.1.0 typecheck R:\job\singularis\wt-336
> tsc --noEmit
```

**Cero errores.** (Salida vacía = éxito.)

### `pnpm run lint`

```
✖ 127 problems (0 errors, 127 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

**Cero errores.** Los 127 warnings son `@typescript-eslint/no-unused-vars` sobre parámetros
`_prefijados` de dobles de test, preexistentes y repartidos por todo el repo. Se comprobó
explícitamente que **ninguno cae en un archivo tocado por esta ficha** (grep de los 18 nombres
contra la salida de lint: cero coincidencias).

### Corrida explícita, por nombre, de cada archivo tocado

```
pnpm exec vitest run \
  tests/unit/guards/rutas-336-retiradas.guardia.test.ts \
  tests/unit/guards/superficie-de-uso.guardia.test.ts \
  tests/unit/guards/test-citado-desaparecido.guardia.test.ts \
  tests/unit/guards/liquidacion-money-safe.test.ts \
  tests/unit/guards/caja-173-alcance.guardia.test.ts \
  tests/unit/actions/wallet-mensajero-actions.test.ts \
  tests/unit/actions/wallet-mensajero-descarga-action.test.ts \
  tests/unit/services/wallet-mensajero-service.test.ts \
  tests/unit/services/wallet-cuentas-paginado.test.ts \
  tests/unit/services/wallet-desglose-mensajero-descarga.test.ts

 Test Files  1 failed | 9 passed (10)
      Tests  1 failed | 147 passed (148)
```

El único rojo es `superficie-de-uso.guardia.test.ts`, **con la deuda AJENA y solo ella** (ver §7).

```
pnpm exec vitest run \
  tests/unit/descarga/wallet-mensajero-descarga-columnas.test.ts \
  tests/unit/descarga/cobertura-tablas.guardia.test.ts \
  tests/unit/descarga/contadores-cabecera.guardia.test.ts \
  tests/unit/descarga/columnas-asercion-de-orden.guardia.test.ts \
  tests/unit/descarga/adaptador-conjunto.guardia.test.ts \
  tests/components/descarga/WalletDescarga.test.tsx \
  tests/components/PremioRankingRotulo.test.tsx \
  tests/components/QrScanner.test.tsx \
  tests/integration/db/pago-mensajero-liquidacion.test.ts \
  tests/integration/wallet-mensajeros-page.test.tsx

 Test Files  10 passed (10)
      Tests  74 passed (74)
```

### Barrido de colateral: TODAS las guardias del repo

```
pnpm exec vitest run tests/unit/guards
 Test Files  1 failed | 98 passed (99)
      Tests  1 failed | 1501 passed (1502)
```

99 archivos de guardia, **una** roja: la baselineada, por la misma deuda ajena.

### `./init.sh --rapido` se negará (F.1) — clasificación reproducida, no ejecutada

El encargo prohíbe correr el gate (lo corre el leader). Se reprodujo **el clasificador exacto de
`init.sh`** (`RUTAS_SENSIBLES` línea 134 + `NOMBRES_DE_DINERO` línea 135) contra el diff real:

```
app/(app)/mis-pagos/_components/CuentaPorPagarCard.tsx
app/(app)/mis-pagos/_components/DesglosePagos.tsx
app/(app)/mis-pagos/_components/MisPagosModule.tsx
app/(app)/mis-pagos/_components/mis-pagos-descarga-columnas.ts
app/(app)/mis-pagos/_components/mis-pagos-labels.ts
app/(app)/mis-pagos/page.tsx
lib/actions/wallet-mensajero.ts
lib/config/moneda.ts
lib/interfaces/services/ILiquidacionService.ts
lib/interfaces/services/IWalletMensajeroService.ts
lib/services/WalletMensajeroService.ts
lib/types/wallet-mensajero.ts        ← `^lib/types/` es RUTA SENSIBLE
```

12 archivos casan. **El modo rápido fallará (`fail`, no aviso). Va el completo (R26).**

### Alcance del diff (F.4, F.5)

```
git diff --stat -- tests/baseline-rojos.json   →  (vacío)
git diff --stat -- db/                         →  (vacío)
```

**R14 satisfecho: esta ficha no añadió ni una línea al baseline.**

---

## 7 · La comprobación que el gate NO puede hacer: la lista de huérfanas, ANTES y DESPUÉS

> **Por qué existe este apartado.** `superficie-de-uso.guardia.test.ts` **ya está** en
> `tests/baseline-rojos.json` por deuda ajena, y **el gate compara por ARCHIVO, no por
> contenido**. Si esta ficha hubiera dejado ahí sus tres acciones huérfanas, el gate habría
> salido **VERDE MINTIENDO**. Por eso se mide el CONTENIDO.

**ANTES**

```
+ [
+   "lib/actions/tarifas.ts:67 obtenerTarifa",
+ ]
```

**DESPUÉS**

```
+ [
+   "lib/actions/tarifas.ts:67 obtenerTarifa",
+ ]
```

**IDÉNTICAS. Una sola entrada, ajena (ficha 274, cascada de tarifas), la misma que el baseline
declara desde el 2026-08-28. Cero entradas atribuibles a la ficha 336.**

---

## 8 · Mutaciones, con su salida ROJA real

### Mutación 1 — dejar una de las tres acciones sin borrar

Se resucitó `listarMisPagosAction` en `lib/actions/wallet-mensajero.ts`. **Cuatro aserciones en
tres archivos distintos la delataron:**

```
× ningún módulo de producción referencia las rutas ni los símbolos borrados (sin contar comentarios)
+   "lib/actions/wallet-mensajero.ts nombra listarMisPagosAction"

× el módulo de acciones del pago por mensajero no exporta las tres lecturas de `/mis-pagos`
AssertionError: lib/actions/wallet-mensajero.ts sigue exportando listarMisPagosAction
+ Received: export async function listarMisPagosAction(

× las Server Actions del pago por mensajero NO exponen registrarLiquidacionMensajeroAction
AssertionError: expected [AsyncFunction listarMisPagosAction] to be undefined

× ninguna Server Action de `lib/actions/**` es inalcanzable sin su anotación `@sin-superficie`
+ Received
+   "lib/actions/tarifas.ts:67 obtenerTarifa",
+   "lib/actions/wallet-mensajero.ts:79 listarMisPagosAction",     ← LA ENTRADA NUEVA

 Test Files  3 failed (3)
      Tests  4 failed | 35 passed (39)
```

La última línea es **exactamente el escenario del «verde mintiendo»**: el archivo ya está en el
baseline, así que el gate lo habría dado por bueno. Se ve porque se lee el CONTENIDO. Restaurado.

### Mutación 2a — borrar un test AJENO

Se borró `tests/components/PremioRankingRotulo.test.tsx` (la única cobertura de R34, ficha 293):

```
× los archivos de test de OTRAS features siguen existiendo
AssertionError: estos archivos cubren features AJENAS a la 336 y ya no están: la ficha se llevó
por delante cobertura que no era suya
+ Received
+   "tests/components/PremioRankingRotulo.test.tsx",

× los censos compartidos conservan su contenido, no solo su nombre
Error: ENOENT: no such file or directory, open '...\tests\components\PremioRankingRotulo.test.tsx'

 Test Files  1 failed (1)
      Tests  2 failed | 14 passed (16)
```

Restaurado.

### Mutación 2b — el censo COMPARTIDO vuelve a citar el archivo borrado

Se devolvió la entrada `app/(app)/mis-pagos/_components/DesglosePagos.tsx` a
`tests/unit/descarga/censo-tablas.ts`. **Cayó el censo compartido entero, en cuatro sitios:**

```
× toda tabla del árbol o declara descarga o figura como exclusión justificada
AssertionError: app/(app)/mis-pagos/_components/DesglosePagos.tsx ya no monta DataTable:
expected false to be true

× las tablas declaradas fuera de alcance no montan control de descarga
AssertionError: expected 30 to be 29

× la FASE 1 del export queda cerrada: ninguna tabla del censo sigue pendiente
AssertionError: expected [...] to have a length of 19 but got 20

× los censos compartidos conservan su contenido, no solo su nombre
AssertionError: expected ' \n \n ...' not to match /mis-pagos/
+ Received:     ruta: \"app/(app)/mis-pagos/_components/DesglosePagos.tsx\",

 Test Files  2 failed (2)
      Tests  4 failed | 16 passed (20)
```

Restaurado.

> **Y un dato del método, porque es la lección:** el primer intento de esta mutación **pasó en
> verde**. No porque el detector fallara, sino porque mi `replace` no encontró su ancla y la
> mutación **nunca se aplicó**. Se detectó comprobando con `grep` que la línea mutada existía de
> verdad antes de creerse el resultado. Una mutación que no se autocomprueba miente igual que la
> guardia que pretende validar.

### Mutación 3a — romper el RECORRIDO de la guardia nueva

`ARBOLES_DE_PRODUCCION = ["providers"]` (el recorrido deja de ver `app/`, `components/`, `lib/`,
`hooks/`). Sin la autocomprobación, el bloque 2 habría pasado **en verde sin mirar nada**:

```
× anti-vacuidad: el árbol de producción se leyó ENTERO y ningún archivo salió vacío
AssertionError: el recorrido del árbol de producción devolvió menos archivos de los que este repo
tiene: el detector se rompió y todo lo que afirma este archivo es vacuo: expected 3 to be greater than 800

× CONTROL POSITIVO del bloque anterior: el detector SÍ encuentra lo que sigue vivo
AssertionError: expected 0 to be greater than 0

× `QrScanner` sigue exportado y con sus importadores directos
AssertionError: components/shared/EscanerGuiaCard.tsx dejó de importar la cámara: expected [] to
include 'components/shared/EscanerGuiaCard.tsx'

 Test Files  1 failed (1)
      Tests  3 failed | 13 passed (16)
```

Restaurado.

### Mutación 3b — neutralizar el quitador de comentarios

`quitarComentarios` sustituido por la identidad (deja de quitar nada):

```
× AUTOCOMPROBACIÓN: el detector ve el código y no lee la prosa
AssertionError: expected '// import { useQrNavigate } from "@/h…' not to contain 'useQrNavigate'

 Test Files  1 failed (1)
      Tests  1 failed | 15 passed (16)
```

Restaurado. **Tras restaurar las cinco mutaciones, la corrida vuelve a verde: 4 archivos, 30
casos, 0 fallos.**

---

## 9 · Trazabilidad `R1..R27 → test`

| R | Cubierto por |
| --- | --- |
| R1 | `rutas-336-retiradas.guardia.test.ts` › «las dos rutas y sus carpetas no están en el árbol» |
| R2 | idem › «`hooks/useQrNavigate.ts` no existe» |
| R3 | idem › «ningún módulo de producción referencia las rutas ni los símbolos borrados (sin contar comentarios)» + su control positivo |
| R4 | idem › «el módulo de acciones del pago por mensajero no exporta las tres lecturas de `/mis-pagos`» |
| R5 | idem › «el servicio y su interfaz tampoco declaran ya los tres métodos» + `wallet-mensajero-service.test.ts` + `pnpm run typecheck` |
| R6 | idem › «`QrScanner` sigue exportado y con sus importadores directos» + `tests/components/QrScanner.test.tsx` (intacto) |
| R7 | idem › «las seis superficies de escaneo siguen montando la tarjeta compartida» |
| R8 | `wallet-mensajero-actions.test.ts`, `wallet-mensajero-descarga-action.test.ts`, `wallet-mensajero-service.test.ts`, `wallet-cuentas-paginado.test.ts`, `wallet-desglose-mensajero-descarga.test.ts` (los 5 en verde) |
| R9 | `rutas-336-retiradas` › «el servicio y su interfaz…» (afirma el `.extend`) + `wallet-mensajero-actions.test.ts` › `listarPagosDeMensajeroAction` |
| R10 | `git diff --stat -- db/` vacío + `tests/integration/db/pago-mensajero-liquidacion.test.ts` en verde |
| R11 | `superficie-de-uso.guardia.test.ts` › R-A — **contenido pegado en §7** |
| R12 | `rutas-336-retiradas` › «ninguna acción del pago por mensajero lleva `@sin-superficie` nueva» (exactamente 1) |
| R13 | idem › «el baseline no ganó entradas de esta ficha» + §7 |
| R14 | **Evidencia, no caso ejecutable**: `git diff --stat -- tests/baseline-rojos.json` vacío (§6) |
| R15 | `rutas-336-retiradas` › bloque 6 (los 15 existen y conservan contenido) + los 10+10 archivos corridos en verde (§6) |
| R16 | `cobertura-tablas.guardia.test.ts` (4/4 en verde con los totales medidos) |
| R17 | `liquidacion-money-safe.test.ts` › «el censo de archivos de la feature existe entero» |
| R18 | `caja-173-alcance.guardia.test.ts` › «R63: ninguna de las pantallas congeladas sabe nada de la caja» |
| R19 | `contadores-cabecera.guardia.test.ts` (34→32 ≥ 30: **suelo intacto**), `columnas-asercion-de-orden.guardia.test.ts` (41→40 ≥ 35), `adaptador-conjunto.guardia.test.ts` (24→23 ≥ 13) — los tres en verde, los dos últimos **sin editar** |
| R20 | `tests/components/PremioRankingRotulo.test.tsx`, con el número de superficies declarado por escrito en su cabecera |
| R21 | `pago-mensajero-liquidacion.test.ts` › «las Server Actions … NO exponen `registrarLiquidacionMensajeroAction`» (2 testigos vivos) + `rutas-336-retiradas` › bloque 6, que exige `>= 2` |
| R22 | `wallet-mensajero-descarga-columnas.test.ts` › «el DESGLOSE por cierre (admin) declara sus columnas en el orden de la pantalla» |
| R23 | `test-citado-desaparecido.guardia.test.ts` (13/13) + la anotación en `specs/172-liquidacion/tasks.md`, **probada por mutación** (§4) |
| R24 | `tests/unit/guards/rutas-336-retiradas.guardia.test.ts` — el archivo entero (16 casos) |
| R25 | idem › «AUTOCOMPROBACIÓN: el detector ve el código y no lee la prosa» y «anti-vacuidad: el árbol de producción se leyó ENTERO…» — **probadas por las mutaciones 3a y 3b** |
| R26 | **Pendiente del leader**: `./init.sh` completo. La clasificación que fuerza el completo está reproducida y pegada en §6 |
| R27 | **Este documento**, §7 |

---

## 10 · Lo que queda abierto o dudoso

1. **La capacidad desaparece sin sustituto, y ahora está escrito en tres sitios más.** Tras esta
   ficha ningún mensajero puede consultar en la app lo que Ordenex le debe. Es la decisión, no un
   efecto colateral, y así consta en `censo-tablas.ts`, en `cobertura-tablas.guardia` y en la
   anotación de la 172. **No se registró ficha de seguimiento** (el spec asume que no se registra;
   si el humano quiere una, es una decisión suya, no mía).

2. **`test-citado-desaparecido` todavía no mide lo que va a medir.** Su lista de borrados sale de
   `git log`, y este agente no commitea: hoy el caso principal pasa trivialmente. La anotación
   está puesta y **probada por mutación**, pero el primer veredicto real llega con el commit. Si
   el leader ve ese caso rojo tras commitear, el problema estará en el texto de la anotación, no
   en la ficha.

3. **Tres números duros más de los que el spec anticipaba**, y todos en el mismo archivo
   (`cobertura-tablas.guardia`: `totalCensado` y el conteo de `con_descarga`, además de los dos
   nombrados). El patrón que los hizo invisibles al spec es que son **literales sueltos dentro de
   un `it`**, no constantes con nombre. Si mañana otra ficha resta una tabla, va a tropezar con lo
   mismo.

4. **Retiré `ListarPagosMensajeroInput`, que el spec no listaba.** Se quedó sin una sola
   referencia en todo el árbol al irse `listarMisPagos`, y dejarlo era un tipo huérfano exportado.
   El schema del que deriva (`listarPagosMensajeroSchema`) **sí se conserva**, y su comentario
   ahora dice por qué, para que nadie lo borre por parecer «el de mis pagos». Si se prefiere
   minimizar el diff en `lib/types/**`, es un `revert` de cuatro líneas — pero el gate ya va al
   completo de todas formas, así que no ahorra nada.

5. **`e2e/wallet-mensajeros.spec.ts` es contabilidad, no verificación.** En este repo los E2E no
   se ejecutan (sin harness; el propio archivo se declara `NOT EXECUTED`). Los dos `describe` de
   `/mis-pagos` se retiraron y los dos de `/wallet/mensajeros` sobreviven, pero **nadie ha visto
   correr ninguno de los cuatro**, ni antes ni ahora.
