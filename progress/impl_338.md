# impl 338 — «Flete por rechazo» en toda la app, y el panel del cierre dice qué se cobró

Rama `fix/338-claridad-cobros`, worktree aislado `R:/job/singularis/wt-backport`.
Fecha: 2026-08-31. Ningún comando de git que escriba; `feature_list.json` y `progress/current.md`
no se tocan.

**Herramienta:** el MCP `codebase-memory` (`R-job-singularis-projects-ordenex`) SÍ estaba
disponible y se usó (`search_graph`) para localizar el panel; el inventario fino de literales se
hizo con `grep`, que es lo que corresponde para texto plano, y **cada símbolo se confirmó en el
archivo real** antes de tocarlo.

---

## A. El vocabulario: «flete de devolución» / «flete devuelto» → **«Flete por rechazo»**

La lógica ya estaba bien y no se tocó: `lib/utils/ingreso-ordenex.ts` sólo deriva estos conceptos
con `resultado === "rechazada"` (ficha 301). No había plata mal cobrada; había un nombre que decía
justo el caso que NO cobra.

| Archivo | Qué cambió |
| --- | --- |
| `app/(app)/cierres-admin/_components/cierre-labels.ts` | `FLETE_DEV_CON_IVA_LABEL` → «Flete por rechazo + IVA» |
| `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx` | las cuatro etiquetas inline pasan a constantes exportadas (`FLETE_RECHAZO_LABEL`, `IVA_FLETE_RECHAZO_LABEL`, `VALOR_FLETE_LABEL`, `VALOR_FLETE_GAM_LABEL`, `FLETE_RECHAZO_GAM_LABEL`, `FLETE_LABEL`, `IVA_FLETE_LABEL`, `COMISION_COD_LABEL`, `IVA_COMISION_LABEL`) + `PAGO_TIENDA_NOTA` reescrita |
| `app/(app)/mi-wallet/_components/mi-wallet-labels.ts` | `flete_devolucion`, `iva_flete_devolucion` |
| `app/(app)/wallet/_components/wallet-labels.ts` | `ingreso_flete_devolucion`, `ingreso_iva_flete_devolucion` |
| `app/(app)/wallet/_components/cobro-rechazo-tienda-labels.ts` | columna «Flete devuelto» → «Flete por rechazo» |
| `app/(app)/configuracion/tarifas/_components/tarifas-labels.ts` | «Flete de retorno (solo rechazos)» / «… GAM (solo rechazos)» → «Flete por rechazo» / «Flete por rechazo GAM» (era el primer intento de la 303) |
| `app/(app)/novedades/_components/RechazarNovedadModal.tsx` | `RECHAZO_AVISO`: «el flete de devolución» → «el flete por rechazo» |
| `lib/api/openapi-spec.ts` | descripciones de `CotizacionEscenarioDevuelto.flete` / `.iva` |

**La frase que enseñaba mal** (`PAGO_TIENDA_NOTA`, antes l. 273): decía «No descuenta el flete de
devolución: una devolución no cobra COD», que deja entender que una devolución cobra ALGO. Ahora
dice el motivo real, el que está en `pagoTiendaOrdenex`: «No descuenta el flete por rechazo: un
rechazo no recauda contra entrega, así que ese dinero nunca entró en el total general.»

**NO se renombró** (dato histórico / decisión de negocio previa, y así queda escrito en el código):
columnas de base, la categoría `ingreso_flete_devolucion` del ledger, los identificadores
`fleteDevolucion*` del DTO, y «Tarifa especial devuelta» (nombra la columna `tarifa_especial_devuelta`
y `tarifas-labels.ts` ya tenía escrita la decisión de no tocar los dos campos de «Tarifa especial»).

### Los dos contratos, actualizados A MANO
- **Excel/CSV** — los `toEqual` literales de `tests/unit/descarga/cierre-gestiones-descarga-columnas.test.ts`
  (2 secciones) y `tests/unit/descarga/cierres-gestiones-fundida-descarga-columnas.test.ts` (hoja
  fundida). Se editó el literal, uno a uno; **no** se derivó de la constante — eso los dejaría
  verdes por construcción.
- **API pública** — `lib/api/openapi-spec.ts`. Se cambiaron las **descripciones**, que es lo que
  lee un humano. **No** se tocaron la clave `devuelto` ni el nombre de schema
  `CotizacionEscenarioDevuelto`: eso no es texto, es la forma del payload, y renombrarlo exigiría
  cambiar `CotizacionOrdenService` y rompería a todo integrador. Ver «Lo dudoso», punto 2.

---

## B. El panel: «Tarifa aplicada» (9 precios) → **«Cobros de esta gestión»**

Todo en `DesgloseIngresoOrdenex` (`cierre-detalle-shared.tsx`).

- **Título**: `TARIFA_TITULO` («Tarifa aplicada») se retira; entra `COBROS_TITULO` =
  «Cobros de esta gestión».
- **`APLICADA_HINT` («← se aplicó») se retira entero.**
- **Cada fila lleva el IMPORTE cobrado, y ₡0 donde no aplica.** Las tres filas de flete de entrega
  (normal / GAM / pacto) y las tres de rechazo son cobros que se excluyen entre sí, así que se
  listan las seis y **suman sin contar dos veces**.
- **Los porcentajes pasan a importe**: «Comisión COD 5,00 %» e «IVA flete 13,00 %» ahora pintan
  `ing.comisionCod` / `ing.ivaFlete` (₡0 si no aplica). Se añadió la fila que faltaba para que la
  columna cierre: «IVA del flete por rechazo» (`ing.ivaFleteDevolucion`).
- **Total**: fila `COBROS_TOTAL_LABEL` («Total cobrado»). **Sale del DTO**: `ingresoOrdenex.total`,
  que `CierresAdminRepository.toIngresoOrdenex` ya suma con `Prisma.Decimal`. **No se sumó nada en
  el navegador.**
- **Ni una operación de dinero nueva**: el componente sólo *elige* entre el STRING que mandó el
  servidor y el literal `COBRO_CERO = "0.00"`. Cero `Number(`, cero `parseFloat`, cero aritmética.
- **Accesibilidad**: los dos paneles pasan de `<div>` a `<section aria-label={…}>`, así que ahora
  son regiones con nombre. No es cosmética de test: los dos repiten rótulos a propósito (el de la
  izquierda explica la fórmula del mismo concepto) y sin región no hay forma de decir «esta fila,
  la del panel de cobros».
- **El límite aceptado queda escrito junto al código** (docstring de `COBROS_TITULO` y comentario
  del JSX): la pantalla deja de mostrar la lista de precios de la tarifa congelada, así que «por
  qué ₡2.400 y no ₡2.800» ya no se audita ahí. Los precios siguen en `/configuracion/tarifas`, el
  snapshot entero en `TarifaSnapshotDTO`, y los `hint` del desglose de la izquierda siguen citando
  el precio del concepto que SÍ se cobró.

⚠️ Nota de formato, no de esta ficha: `money()` pinta **sin céntimos** desde la 230, así que el
cero se lee `₡0` y no `0,00`. La nota del panel compone el cero con el propio `money()` en vez de
escribirlo a mano (precedente `PAGO_SIN_TARIFA_NOTA`).

---

## Archivos

**Creados**
- `tests/components/CierreCobrosDeLaGestion.test.tsx` (15 casos)
- `tests/unit/guards/flete-por-rechazo-censo.guardia.test.ts` (4 casos: 3 de autocomprobación + el censo)

**Modificados — producción**
- `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx`
- `app/(app)/cierres-admin/_components/cierre-labels.ts`
- `app/(app)/configuracion/tarifas/_components/tarifas-labels.ts`
- `app/(app)/mi-wallet/_components/mi-wallet-labels.ts`
- `app/(app)/novedades/_components/RechazarNovedadModal.tsx`
- `app/(app)/wallet/_components/cobro-rechazo-tienda-labels.ts`
- `app/(app)/wallet/_components/wallet-labels.ts`
- `lib/api/openapi-spec.ts`

**Modificados — tests**
- `tests/components/CierreTarifaAplicada.test.tsx` (reescrito: la invariante de la 337 pasa de
  afirmar una MARCA a afirmar el DINERO)
- `tests/components/CierreTarifaEspecial.test.tsx`
- `tests/components/CierresAdminModule.test.tsx`
- `tests/components/CierreDetalleIncidente.test.tsx`
- `tests/components/CierreFacturaSinGestionar.test.tsx`
- `tests/components/ComposicionGananciaCard.test.tsx`
- `tests/components/RechazarNovedad.test.tsx`
- `tests/components/TarifasClaridadMontos.test.tsx`
- `tests/components/TarifasAlineacionRejilla.test.tsx`
- `tests/unit/descarga/cierre-gestiones-descarga-columnas.test.ts`
- `tests/unit/descarga/cierres-gestiones-fundida-descarga-columnas.test.ts`

---

## Mapa requisito → test

| Requisito (de la ficha) | Test |
| --- | --- |
| El concepto se llama «Flete por rechazo» en TODA la app | `tests/unit/guards/flete-por-rechazo-censo.guardia.test.ts` › censo |
| … y el censo no miente por estar vacío | mismo archivo › los 3 casos de autocomprobación |
| Rótulos de `/configuracion/tarifas` | `TarifasClaridadMontos.test.tsx` › «el flete se llama «por rechazo»…» |
| Rótulos de la wallet (caja y tienda) | `ComposicionGananciaCard.test.tsx` |
| Aviso de la ventana de rechazo (novedades) | `RechazarNovedad.test.tsx` |
| Contrato Excel/CSV (5 secciones + hoja fundida) | `cierre-gestiones-descarga-columnas.test.ts`, `cierres-gestiones-fundida-descarga-columnas.test.ts`, `CierreDetalleIncidente.test.tsx` |
| El título pasa a «Cobros de esta gestión» | `CierreCobrosDeLaGestion.test.tsx` › «el panel se titula…» |
| Una reprogramada pinta TODO en cero (y lo DICE, no se deduce) | idem › «una REPROGRAMADA pinta TODAS las filas en cero» + «una DEVUELTA…» |
| Cada fila lleva el importe realmente cobrado | idem › «una ENTREGA en GAM…», «un RECHAZO en GAM…», «con pacto especial…» |
| La columna es SUMABLE y el total cuadra | idem › «la columna suma exactamente lo que dice el total» (6 escenarios, leídos del DOM y sumados con `Prisma.Decimal`) |
| El total sale del servidor, no del navegador | idem › misma tabla, `expect(total.valor).toBe(money(caso.ing.total))` |
| Los porcentajes pasan a importe y el `← se aplicó` se retira | idem › «en la columna de cobros no queda ni un porcentaje ni ningún «se aplicó»» |
| Invariante 337: como mucho UNA fila de flete lleva importe | `CierreTarifaAplicada.test.tsx` (8 casos) |
| Un flete legítimo de «0.00» sigue siendo un cobro | idem › «un flete de «0.00» SIGUE siendo un cobro» |
| El pacto especial gana a la columna normal, y sólo si se cobró | `CierreTarifaEspecial.test.tsx` › «el pacto lleva el importe cobrado…» |
| La pantalla del cierre completa, de punta a punta | `CierresAdminModule.test.tsx` › «el desglose de una orden…» |

---

## Verificación (salida real)

```
$ pnpm typecheck
> ordenex@0.1.0 typecheck R:\job\singularis\wt-backport
> tsc --noEmit
TYPECHECK_EXIT=0
```

```
$ pnpm lint
✖ 127 problems (0 errors, 127 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```
Los 127 warnings son preexistentes (`no-unused-vars` en dobles de test de otras fichas).
**Ninguno cae en un archivo tocado por la 338** — comprobado filtrando la salida por los nueve
nombres.

**Corrida explícita, por nombre, de los 13 archivos de test creados o modificados:**
```
$ pnpm exec vitest run tests/components/CierreCobrosDeLaGestion.test.tsx \
    tests/components/CierreTarifaAplicada.test.tsx tests/components/CierreTarifaEspecial.test.tsx \
    tests/components/CierresAdminModule.test.tsx tests/components/CierreDetalleIncidente.test.tsx \
    tests/components/CierreFacturaSinGestionar.test.tsx tests/components/ComposicionGananciaCard.test.tsx \
    tests/components/RechazarNovedad.test.tsx tests/components/TarifasClaridadMontos.test.tsx \
    tests/components/TarifasAlineacionRejilla.test.tsx \
    tests/unit/descarga/cierre-gestiones-descarga-columnas.test.ts \
    tests/unit/descarga/cierres-gestiones-fundida-descarga-columnas.test.ts \
    tests/unit/guards/flete-por-rechazo-censo.guardia.test.ts

 Test Files  13 passed (13)
      Tests  200 passed (200)
   Duration  27.39s
```

**Radio ampliado, porque el rename toca rótulos que afirman muchas pantallas:**
```
$ pnpm exec vitest run tests/components
 Test Files  282 passed (282)
      Tests  3805 passed | 26 skipped (3831)

$ pnpm exec vitest run tests/unit/descarga tests/unit/api tests/unit/repositories tests/unit/utils
 Test Files  237 passed (237)
      Tests  3202 passed (3202)

$ pnpm exec vitest run tests/unit/guards
 Test Files  1 failed | 96 passed (97)
      Tests  1 failed | 1466 passed (1467)
```

El único rojo de las guardias es **`superficie-de-uso.guardia.test.ts` →
`lib/actions/tarifas.ts:67 obtenerTarifa`**, y **no es de esta ficha**: `git grep obtenerTarifa HEAD`
confirma que ya estaba sin importadores en el commit de partida, y el archivo está en
`tests/baseline-rojos.json` como deuda conocida de `dev` (`docs/verification.md` lo nombra por su
nombre). No toqué `lib/actions/**` ni ningún importador suyo.

`./init.sh` **no se corrió**: lo corre el leader.

---

## Mutaciones (rojo real, pegado)

### 1 — que una REPROGRAMADA pinte un importe distinto de cero
`cobroFlete` deja de mirar si el concepto se cobró y vuelve a pintar el precio de la tarifa
(exactamente lo que hacía el panel antes de la ficha):
```
-  const cobroFlete = (col: ColumnaTarifa): string =>
-    fleteAplicadoEs(col) ? (ing.flete as string) : COBRO_CERO;
+  const cobroFlete = (col: ColumnaTarifa): string =>
+    col === "normal-gam" ? t.valorFleteGam : COBRO_CERO;
```
```
Test Files  2 failed (2)      Tests  15 failed | 10 passed (25)

FAIL … > una REPROGRAMADA pinta TODAS las filas en cero, incluido el total
AssertionError: expected [ Array(9) ] to deeply equal [ '₡0', '₡0', '₡0', '₡0', '₡0', …(4) ]

FAIL … > la columna suma exactamente lo que dice el total > reprogramada (no cobra nada)
AssertionError: filas: Valor flete=₡0 | Valor flete GAM=₡800 | Flete por rechazo=₡0 |
Flete por rechazo GAM=₡0 | IVA flete=₡0 | IVA del flete por rechazo=₡0 | Comisión COD=₡0 |
IVA comisión=₡0 | Total cobrado=₡0: expected '800.00' to be '0.00'

FAIL … > una REPROGRAMADA (cobra 0,00) no carga importe en NINGUNA fila
AssertionError: expected [ 'Valor flete GAM' ] to deeply equal []
```

### 2 — que el total no cuadre con la suma de las filas
Una fila se pinta en cero aunque su concepto SÍ se cobró; el total (que sale del DTO) lo sigue
contando:
```
-        <DesgloseFila label={IVA_FLETE_LABEL} value={money(cobrado(ing.ivaFlete))} />
+        <DesgloseFila label={IVA_FLETE_LABEL} value={money(COBRO_CERO)} />
```
```
Test Files  1 failed (1)      Tests  4 failed | 11 passed (15)

FAIL … > la columna suma exactamente lo que dice el total > entrega en GAM con comisión
AssertionError: filas: Valor flete=₡0 | Valor flete GAM=₡800 | Flete por rechazo=₡0 |
Flete por rechazo GAM=₡0 | IVA flete=₡0 | IVA del flete por rechazo=₡0 | Comisión COD=₡500 |
IVA comisión=₡65 | Total cobrado=₡1.469: expected '1365.00' to be '1469.00'

FAIL … > entrega con pacto especial
AssertionError: … Total cobrado=₡3.390: expected '3065.00' to be '3390.00'
```

### 3 — que quede un texto diciendo «devolución» donde debe decir «rechazo»
```
-export const FLETE_DEV_CON_IVA_LABEL = "Flete por rechazo + IVA";
+export const FLETE_DEV_CON_IVA_LABEL = "Flete devolución + IVA";
```
```
Test Files  4 failed (4)      Tests  5 failed

FAIL tests/unit/guards/flete-por-rechazo-censo.guardia.test.ts > censo: ningún texto visible de
`app/` dice «flete de devolución» ni «flete devuelto» > no queda ni una etiqueta con el nombre retirado
AssertionError: este cobro sólo lo genera un RECHAZO (ficha 301). Se llama «Flete por rechazo»:
nombrarlo por la devolución dice justo el caso que NO cobra.: expected [ Array(1) ] to deeply equal []
+   "app/(app)/cierres-admin/_components/cierre-labels.ts:103",

FAIL … cierres-gestiones-fundida-descarga-columnas.test.ts > declara las 27 columnas …
-   "Flete por rechazo + IVA"     +   "Flete devolución + IVA"

FAIL … cierre-gestiones-descarga-columnas.test.ts > la sección DEVUELTAS / RECHAZADAS …
FAIL … CierreDetalleIncidente.test.tsx > un RECHAZO conserva exactamente sus columnas (R35)
AssertionError: el rechazo perdió la columna "Flete por rechazo + IVA"
```

### 4 (extra) — que la guardia estática, rota, NO calle
El requisito de la autocomprobación es que la guardia sepa que dejó de mirar. Se rompió el
recorrido (`if (dir === APP) return salida;`):
```
Test Files  1 failed (1)      Tests  2 failed | 2 passed (4)

FAIL … > el recorrido ve los fuentes de `app/**`, y no una lista vacía
AssertionError: expected 0 to be greater than 200

FAIL … > el MISMO extractor encuentra el nombre VIGENTE en `app/`
AssertionError: el nombre «Flete por rechazo» no aparece en app/: expected 0 to be greater than 5
```
El censo, mientras tanto, **salió verde** — que es exactamente el fallo que la autocomprobación
existe para cazar.

Las cuatro mutaciones se revirtieron y el árbol volvió a verde (`git diff --stat` sin restos, y la
corrida de los 13 archivos repetida al final).

---

## Veredicto

Vocabulario unificado en «Flete por rechazo» (9 archivos de `app/` + los dos contratos), y el panel
del cierre pasa a decir qué se cobró —importe por concepto, cero explícito y total del servidor—
sin una sola operación de dinero nueva; typecheck y lint limpios, 200 tests dirigidos en verde y
tres mutaciones más la del autocontrol de la guardia caídas en rojo real.
