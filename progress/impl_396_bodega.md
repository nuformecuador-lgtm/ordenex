# impl_396 · BODEGA — el servidor de las superficies 2 y 3 (tanda D1 + D4)

## Lo primero, porque cambia cómo se lee todo lo demás

**El dinero está BIEN. Esto es presentación, no una corrección de dinero.**
`wallet_tienda_movimiento` lleva los movimientos **separados por tienda** desde siempre, cada uno
con sus propias cifras. **A nadie se le paga mal, y esta tanda no emite, borra ni corrige ni una
fila del ledger.** No hay migración, no hay `down.sql`, no se toca `db/`.

Lo que faltaba es que la pantalla dijera **de quién es cada parte** de un total que ya era correcto
como total. En bodega el defecto es **el peor de los tres**: un cierre de bodega agrega **N
mensajeros × M tiendas** bajo un único rótulo «Pago a tienda».

## Alcance de ESTA bitácora

Sólo la **mitad de servidor del cierre de BODEGA**: tandas **D1** y **D4** de
`specs/396-desglose-por-tienda-en-cierres/tasks.md`.

**NO se hizo la pantalla** (D2/D3): `CierresBodegaAdminModule.tsx` está **intacto**, y así lo pide
el spec (D2 depende de D1). Tampoco se tocó `cierre-labels.ts`, ni `cierre-factura.tsx`, ni
`CascadasCierreMensajero.tsx`, ni `CierreDiaModule.tsx`, ni ningún archivo `*descarga-columnas*`,
ni `db/`, ni `feature_list.json`, ni `progress/current.md`.

---

## ⚠️ DOS COSAS DEL SPEC QUE NO SON EXACTAS, Y HAY QUE DECIRLAS

Ninguna invalida el diseño; las dos cambian el diff previsto.

### 1. El DTO del nivel-mensajero NO vive donde dice `tasks.md § D1`

`design.md §5.2` y `tasks.md § D1` señalan **`ICierresBodegaAdminService.ts:77-92`** como «el DTO de
bodega». Eso es cierto **sólo para el nivel AGREGADO**. El del **nivel por mensajero** —
`CierreBodegaDetalleCierre`, el que trae `pagoTienda`, `cobradoSobreRecaudado` y `netoOrdenex` de
cada `cierre_dia` — vive en **`lib/interfaces/services/ICierreBodegaService.ts:72-111`**, un archivo
que **no aparece en la lista de «Archivos previstos»** de `tasks.md`.

Consecuencia real: esta tanda toca **un archivo de interfaz que el leader no tenía censado** para su
validación de conflicto. Es mecánico (dos campos y sus docstrings), pero conviene que conste.

### 2. E2 no se puede cumplir al pie de la letra: `DineroIdentidadesEnPantalla.test.tsx` HAY que tocarlo

`tasks.md § E2` exige que ese archivo **pase sin modificarse**. No es posible, y el motivo es el
propio diseño: el DTO agregado gana **dos campos REQUERIDOS** (`ganaLaTienda`, `partesPorTienda`) y
ese archivo construye el resultado completo en un `mockResolvedValue`. El compilador lo caza —que es
exactamente para lo que se declararon requeridos.

**Lo que se hizo, y lo que NO:** son **+6 líneas** en un fixture (los dos campos y su comentario).
**Ni una aserción cambia, ni se relaja, ni se borra**; sus 30 casos siguen siendo los mismos y pasan.
El espíritu de E2 —«no toques las identidades ya pintadas para que tu cambio pase»— se respeta; su
letra —«sin modificarse»— no se puede.

Lo mismo aplica a `tests/components/CierreBodegaDetalleCascadas.test.tsx` (+12 líneas en tres
fixtures), que el spec sí anticipaba como arrastre mecánico.

### Lo que el spec afirma del código de bodega y SÍ es cierto (verificado en disco, 2026-09-08)

| punto de `requirements.md § Lo confirmado` | veredicto |
| --- | --- |
| 5 · `verCierreBodegaDetalle` (`:266-387`), dos niveles, `pagoTienda` en `:312-316` y `:352-356` | **CIERTO**, línea por línea |
| 7 · `CierresBodegaAdminRepository` usa `DETALLE_ADMIN_SELECT` + `toPendienteRowDesdeSnapshot` | **CIERTO** (`:353-356`). **El `tiendaId` llega gratis: ese archivo NO se tocó** |
| «la llamada tiene ya la forma exacta» (`design.md §5.2`): `totalesIngresoOrdenex(cd.gestiones)` en `:298` y sobre el `flatMap` en `:346-348` | **CIERTO**. El desglose entró con el mismo argumento y en el mismo sitio |
| «al DTO de bodega le falta `ganaLaTienda` agregado» | **CIERTO, y en los DOS niveles**, no sólo en el agregado |
| 6 · el módulo monta `CascadaDinero` dos veces por nivel | **CIERTO** (:666, :678 agregado; :728, :739 por mensajero). `lineasCascadaDueno` está hoy en **:239-256**, no en `:244-256`: se corrió 5 líneas con los merges de la 395/396. Dato para la tanda de pantalla |

---

## Archivos tocados

### Producción (4, y una de ellas sólo comentario)

| archivo | qué |
| --- | --- |
| `lib/interfaces/services/ICierreBodegaService.ts` | **NIVEL MENSAJERO**: `CierreBodegaDetalleCierre` gana `ganaLaTienda: string` y `partesPorTienda: ParteDeTienda[]`, los dos **requeridos**, con sus invariantes y el aviso del umbral escritos |
| `lib/interfaces/services/ICierresBodegaAdminService.ts` | **NIVEL AGREGADO**: los mismos dos campos, con la **asimetría honesta** de R21 escrita entera en el docstring |
| `lib/services/CierresBodegaAdminService.ts` | D1: los dos niveles emiten `ganaLaTienda` y `partesPorTienda`. El `flatMap` del agregado se nombra **una vez** y lo comparten lo facturado y el desglose |
| `lib/utils/ingreso-ordenex.ts` | **SÓLO COMENTARIO** (verificado: el diff no tiene ni una línea de código). El docstring de `partesPorTienda` decía «*cuando entre su tanda*, los DOS niveles de BODEGA»; con la tanda dentro eso ya era falso en un archivo de dinero |

**Ni una fórmula de dinero nueva.** Los cuatro importes nuevos salen de funciones que ya existían
(`ganaLaTienda`, `partesPorTienda` → `computeTotales`, `totalesIngresoOrdenex`, `pagoTiendaOrdenex`).

**Sin migración (R25).** El diff no toca `db/`. **`CierresBodegaAdminRepository.ts` NO se tocó**: el
`tiendaId` ya le llegaba por compartir `select` y mapper con el detalle del mensajero.

### Tests nuevos (2)

- `tests/integration/db/cierre-bodega-desglose-por-tienda-sql-real.test.ts` — **4 casos contra
  Postgres real**, con control positivo. **No se salta**: corrió y reportó `4 passed`.
- `tests/unit/services/cierre-desglose-tres-superficies.test.ts` — **5 casos** de **D4**.

### Tests ampliados (1)

- `tests/unit/services/cierres-bodega-admin-service.test.ts` — **10 casos** nuevos en su propio
  `describe` al final (34 → **44**).

### Arrastre mecánico, forzado por el compilador (2)

- `tests/components/CierreBodegaDetalleCascadas.test.tsx` (+12 líneas en `DIA_ANA`, `DIA_BETO` y
  `DETALLE_OK`).
- `tests/components/DineroIdentidadesEnPantalla.test.tsx` (+6 líneas en un `mockResolvedValue`).

**Sin un solo `as`, `any` ni `@ts-expect-error` nuevo** en los dos: los campos se declararon
**requeridos** justo para que el compilador cazara los tres fixtures, y los cazó.

---

## Lo que se emite, y en qué nivel

**Los DOS niveles ganan los MISMOS dos campos.** El agregado que faltaba primero, porque sin él el
desglose sumaría hacia un total que no está en pantalla:

```
CierreBodegaDetalleCierre           (nivel POR MENSAJERO, uno por `cierre_dia`)
  + ganaLaTienda:    string             ganaLaTienda(cd.totales.general, totalesIngreso.total)
  + partesPorTienda: ParteDeTienda[]    partesPorTienda(cd.gestiones)

CierreBodegaDetalleServiceResult    (nivel AGREGADO de toda la bodega)
  + ganaLaTienda:    string             ganaLaTienda(resumen.totales.general, totalesIngreso.total)
  + partesPorTienda: ParteDeTienda[]    partesPorTienda(found.cierresDia.flatMap(cd => cd.gestiones))
```

`ParteDeTienda` **no cambia**: sigue teniendo **cinco claves** (`tiendaId`, `tiendaNombre`,
`recaudado`, `pagoTienda`, `ganaLaTienda`) y **la cuarta cifra sigue prohibida** (R5). Aquí no se
ensancha nada: se **reusa** lo que dejó la tanda del mensajero.

**Emitidos SIEMPRE**, también con una sola tienda. El umbral de Q5 es de **presentación**.

### ⚠️ Los TRES umbrales, y por qué el del mensajero no es el de la bodega

El del **nivel-mensajero se evalúa sobre las tiendas DE ESE MENSAJERO**, y eso queda cierto **por
construcción, sin un `if` que lo diga**: a ese nivel sólo le llegan `cd.gestiones`. Un cierre de
bodega con dos mensajeros que llevaron **una tienda cada uno** no enseña desglose en ningún nivel de
mensajero **y sí** en el agregado.

Está atado por test **en las dos capas**: en el servicio (Ana lleva UNA tienda mientras la bodega
tiene DOS) y **contra Postgres real** en `…-sql-real.test.ts`, con el mismo corpus.

### R20/Q8 — una fila por tienda, cierto por construcción

Agrupar por `tiendaId` sobre el `flatMap` **es** una fila por tienda. Una tienda que aparece en dos
mensajeros sale **una sola vez** en el agregado, con sus cifras sumadas. No hay cruce tienda ×
mensajero: ese detalle ya existe un nivel más abajo.

---

## ⚠️ La identidad del nivel agregado depende de una CONDICIÓN MEDIDA, y así se dejó

Los agregados (`pagoTienda`, `ganaLaTienda`) salen del **snapshot AGREGADO**
`cierre.totales.general`; el desglose **sólo puede salir de las gestiones**. Que las dos vías
coincidan se midió contra producción el 2026-09-08 (**14 cierres, 14 cuadran**), igual que midió la
393. **Es una MEDICIÓN, no una regla.**

**No se tocó el agregado para forzar que cuadre**, y hay test de que el descuadre **se ve**: con un
snapshot agregado 35.000,00 mayor que la suma de sus días, el agregado sigue saliendo del snapshot,
el desglose sigue saliendo de las gestiones, **la diferencia queda a la vista** y los niveles por
mensajero **no se contagian**. Forzarlo violaría R18 y contradiría la decisión explícita de la 393
escrita en `CierresBodegaAdminService.ts` seis líneas más arriba.

**La mutación M-D4 mata exactamente eso.**

---

## Mapa `R<n>` → test

De los 27 requisitos, **esta tanda cubre 15** (todos los de servidor que tocan bodega). Los de
pantalla quedan para D2/D3 y están marcados como tales, **no como cubiertos**.

Abreviaturas: **SVC** = `cierres-bodega-admin-service.test.ts` · **SQL** =
`cierre-bodega-desglose-por-tienda-sql-real.test.ts` · **3SUP** =
`cierre-desglose-tres-superficies.test.ts`.

| R | Test que lo cubre |
| --- | --- |
| **R4** | SVC › «R19: el nivel de CADA MENSAJERO…» y «R20/Q8: el agregado trae UNA fila por tienda…» (las tres cifras, literales) · SQL › «R19 vs R20…» |
| **R5** | SVC › «R5/R16: cinco claves por parte…» (sobre los DOS niveles) |
| **R6** | **SQL** › «R6: cada `cierre_dia` sube el `tienda_id` CONGELADO, no el de la orden viva» (Postgres real, con las órdenes re-apuntadas cruzadas después de congelar) |
| **R7** | SQL › las dos tiendas se llaman IGUAL y **no se funden**; el corpus entero lo depende |
| **R8** | SVC › Beto: 36.384,00 antes que 21.892,50 · SQL › ídem sobre datos de Postgres |
| **R9** | **cubierto por el derivador compartido**, en `tests/unit/utils/partes-por-tienda.test.ts` (tanda B). Aquí no se re-testea: `partesPorTienda` es la MISMA función. Dicho como es, no contado dos veces |
| **R10** | SVC › «R10/R11/R12: en los TRES niveles…» · SQL › «las identidades de los TRES niveles…» |
| **R11** | ídem · **y D1**, que es el agregado que faltaba: SVC › «D1: los DOS niveles emiten el `ganaLaTienda` AGREGADO…» |
| **R12** | ídem (Σ recaudado = `totales.general` de ESE nivel) |
| **R13** | cubierto por el derivador compartido (mismo criterio que `computeTotales`), tanda B |
| **R14** | criterio de hecho: toda la aritmética en el servidor con `Prisma.Decimal`; el diff no añade ni un `Number(` |
| **R15** | SVC/SQL + las mutaciones **M-D2** y **M-D3**: derivar con el subconjunto equivocado pone en rojo la cuarta identidad |
| **R16** | SVC › «R5/R16: … ni el pago al mensajero ni el ingreso de bodega se reparten» |
| **R18** | SVC › «R18: ni un importe ya visible cambia de valor por añadir el desglose» (los 6 derivados del agregado **y** los 6 de cada mensajero) |
| **R19** | SVC › «⚠️ R19: el nivel de CADA MENSAJERO se desglosa con SUS gestiones…» · SQL › «⚠️ R19 vs R20…» · mutación **M-D1** |
| **R20** | SVC › «R20/Q8: el agregado trae UNA fila por tienda…» · SQL › ídem · mutación **M-D6** |
| **R21** | SVC › «⚠️ R21: si el snapshot AGREGADO no es la suma de sus días, el descuadre SE VE» · mutaciones **M-D4** y **M-D6** |
| **R22** | **3SUP** › los cinco casos, en especial «con las MISMAS gestiones, las tres superficies dicen EXACTAMENTE lo mismo» |
| **R23** | por ausencia de código: ninguna ruta, endpoint ni Server Action nueva. El diff no toca `app/api/` ni `lib/actions/` |
| **R24** | SVC › «R24: el desglose no se cuela por la puerta de alcance…» (`forbidden` sin tocar el repo) |
| **R25** | el diff no toca `db/` (comprobado) y el gate rápido **se negó solo** |
| **R27** | el diff no contiene ningún archivo `*descarga-columnas*` (comprobado) |

**Pendientes de la tanda de PANTALLA (D2/D3):** R1, R2, R3, R17, R26.

---

## D4 — el composition root que sí inyecta

`tests/unit/services/cierre-desglose-tres-superficies.test.ts` alimenta **las tres superficies con
el mismo conjunto de gestiones** y afirma que emiten **el mismo desglose**, contra un literal escrito
a mano. Es a la vez la comprobación de D4 y la de R22.

Existe porque en este repo ya hubo **2 de 7 notificadores muertos con la suite verde**: el módulo los
importaba y nadie los pasaba. Un `import { partesPorTienda }` que nadie llama tiene esa misma forma —
no rompe el typecheck ni ninguna guardia de imports, sólo deja la lista **vacía**—. Por eso hay un
caso dedicado a que **ninguna de las tres devuelva `[]`**.

---

## Mutaciones — 6 aplicadas, **6 muertas**, más un CONTROL NEGATIVO que SOBREVIVE

Arnés en el scratchpad de la sesión (un solo uso, no va al repo). **Autocomprueba cuatro cosas**
antes de dar un veredicto, porque en este repo ya hubo uno que reportó «9/9 supervivientes» dos veces
sin haber ejecutado un test:

1. cada texto a sustituir **existe y aparece exactamente una vez** (si no, aborta);
2. el archivo **cambió en disco** después de escribir (se relee y se compara);
3. vitest **ejecutó tests de verdad** (se lee el contador `Tests  N passed/failed`); sin contador el
   resultado se marca **INVÁLIDO**, nunca «muerta»;
4. el archivo **se restauró**, y si no volvió a su contenido original el arnés **para**.

Cada corrida ejecuta **los mismos 5 archivos · 167 tests** (los tres de esta tanda, el del derivador
y el del detalle del mensajero). Línea base medida antes de empezar: `Test Files 5 passed (5) ·
Tests 167 passed (167)`.

### Salida real

```
[M-D1] el umbral del nivel-mensajero se evalua sobre las tiendas de TODA LA BODEGA
       MUERTA  exit=1  Test Files 1 failed | 4 passed (5)  Tests 4 failed | 163 passed (167)
       rojos: «⚠️ R19: el nivel de CADA MENSAJERO se desglosa con SUS gestiones — Ana tiene UNA
               tienda y la bodega DOS»
              «R10/R11/R12: en los TRES niveles la suma de las partes ES el agregado de ESE nivel»
              «la CUARTA identidad, por tienda: lo que se le paga − lo que gana = SU flete por rechazo»
              «⚠️ R21: si el snapshot AGREGADO no es la suma de sus días, el descuadre SE VE»

[M-D2] el `ganaLaTienda` del nivel-mensajero se deriva con el ingreso AGREGADO (subconjunto equivocado)
       MUERTA  exit=1  Test Files 1 failed | 4 passed (5)  Tests 2 failed | 165 passed (167)
       rojos: «D1: los DOS niveles emiten el `ganaLaTienda` AGREGADO que a este contrato le faltaba»
              «R10/R11/R12: en los TRES niveles la suma de las partes ES el agregado de ESE nivel»

[M-D3] la suma de las partes deja de dar el total (un céntimo de más en cada parte)
       MUERTA  exit=1  Test Files 5 failed (5)  Tests 25 failed | 142 passed (167)
       rojos: «R10/R11/R12…» (bodega y mensajero) · «R20/Q8: el agregado trae UNA fila por tienda…»
              «Norte, que SÍ tuvo un rechazo, difiere en exactamente 1.695,00»
              «1 · el detalle del cierre del MENSAJERO lo emite» · «2 · … nivel POR MENSAJERO …»
              «3 · … nivel AGREGADO …»

[M-D4] se TOCA EL AGREGADO para forzar que cuadre con las gestiones (suma de los días en vez del snapshot)
       MUERTA  exit=1  Test Files 1 failed | 4 passed (5)  Tests 1 failed | 166 passed (167)
       rojo:  «⚠️ R21: si el snapshot AGREGADO no es la suma de sus días, el descuadre SE VE»

[M-D5] agrupa por `tiendaNombre` en vez de por `tiendaId`
       MUERTA  exit=1  Test Files 5 failed (5)  Tests 22 failed | 145 passed (167)
       rojos: «R7: la CLAVE es el id y el nombre sólo se muestra — dos tiendas HOMÓNIMAS no se funden»
              «R20/Q8: el agregado trae UNA fila por tienda…» · «R4/R7/R8: una fila por tienda…»
              (y los tres casos de las tres superficies)

[M-D6] el desglose AGREGADO de bodega se deriva SUMANDO el de sus mensajeros (R21)
       MUERTA  exit=1  Test Files 1 failed | 4 passed (5)  Tests 2 failed | 165 passed (167)
       rojos: «R20/Q8: el agregado trae UNA fila por tienda — Norte está en los DOS mensajeros y
               sale una vez»
              «⚠️ R19: el nivel de CADA MENSAJERO se desglosa con SUS gestiones…»

[CONTROL] cambia un COMENTARIO (no debe romper nada)
       SOBREVIVIÓ  exit=0  Test Files 5 passed (5)  Tests 167 passed (167)   ← lo correcto
```

**Las cuatro que el encargo pedía nombradas están todas**: M-D1 (el umbral del nivel-mensajero sobre
las tiendas de la bodega), M-D2 (una de las dos cifras con el subconjunto equivocado), M-D3 (la suma
de las partes deja de dar el total) y **M-D4 (se toca el agregado para forzar que cuadre)**.

**Por qué el control importa:** sin él, «6/6 muertas» podría ser un arnés que dice siempre lo mismo.
El control cambia una línea de comentario, corre **los mismos 167 tests** y sale **verde** — o sea
que el rojo de las otras seis lo produjo el cambio de comportamiento, no el guion.

Tras la última mutación se comprobó que **`lib/utils/ingreso-ordenex.ts` volvió intacto**
(`git diff` sin cambios de código) y que el árbol quedó con exactamente los archivos de esta tanda.

---

## Verificación

```
pnpm run typecheck   → verde, sin salida (tsc --noEmit)
pnpm run lint        → 0 errores, 175 warnings — el MISMO número que las dos tandas anteriores.
                       Ninguno en archivos de esta tanda (el de `DineroIdentidadesEnPantalla`
                       —directiva eslint-disable sobrante, línea 508— es PREEXISTENTE y está
                       lejos de mi edición, en la 765).

pnpm exec vitest run tests/integration/db/cierre-bodega-desglose-por-tienda-sql-real.test.ts
  → Test Files 1 passed (1) · Tests 4 passed (4)      ← NO «skipped»: corrió contra Postgres

pnpm exec vitest run tests/unit/services/cierres-bodega-admin-service.test.ts
  → Test Files 1 passed (1) · Tests 44 passed (44)

pnpm exec vitest run tests/unit/services/cierre-desglose-tres-superficies.test.ts
  → Test Files 1 passed (1) · Tests 5 passed (5)

pnpm exec vitest related --run lib/services/CierresBodegaAdminService.ts \
      lib/interfaces/services/ICierresBodegaAdminService.ts \
      lib/interfaces/services/ICierreBodegaService.ts
  → Test Files 20 passed (20) · Tests 264 passed (264)

pnpm exec vitest run tests/components/CierreBodegaDetalleCascadas.test.tsx \
                     tests/components/DineroIdentidadesEnPantalla.test.tsx
  → Test Files 2 passed (2) · Tests 47 passed (47)    ← los dos del arrastre, sin tocar aserciones
```

### El gate

**`./init.sh --rapido` se negó solo**, como estaba previsto: el diff toca contratos compartidos y
archivos con nombre de dinero. El log va commiteado entero en `progress/gate_396_bodega_rapido.log`:

```
✓ feature_list.json: sin ids duplicados (394 fichas), cupo por zona respetado (in_progress=1)…
Tu cambio toca cimientos, y para eso el modo rapido no alcanza:
    lib/interfaces/services/ICierreBodegaService.ts
    lib/interfaces/services/ICierresBodegaAdminService.ts
    lib/services/CierresBodegaAdminService.ts
✗ esto exige el gate completo. Corre: ./init.sh
INIT_EXIT=1
```

**`./init.sh` completo — VERDE.** El `INIT_EXIT` está escrito **dentro** del log (no es el exit code
que reporta el shell, que un `echo` puede tapar) y el log se leyó **sin `tail`**:

```
 Test Files  1827 passed (1827)
      Tests  26256 passed | 26 skipped (26282)
   Duration  634.65s

✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1827 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado
                            20260814140000_ruta_parada_tramo
                            20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**Los `skipped` son 26, que es el número conocido**, y se miraron uno a uno en vez de dar por bueno
el `INIT_EXIT`: `AnaliticaPage.test.tsx` (17, línea 8821) y `AnaliticaShell.test.tsx` (9, línea
10009). **Ni uno solo de `integration/db`** — el `.env` estaba puesto y los tests contra Postgres
corrieron de verdad. Comprobado en el log, línea a línea:

```
línea  8984:  ✓ tests/integration/db/cierre-bodega-desglose-por-tienda-sql-real.test.ts (4 tests) 1056ms
línea  8959:  ✓ tests/integration/db/cierre-desglose-por-tienda-sql-real.test.ts (4 tests) 791ms   ← la tanda anterior
línea 10484:  ✓ tests/unit/services/cierres-bodega-admin-service.test.ts (44 tests) 66ms
línea 11273:  ✓ tests/unit/services/cierre-desglose-tres-superficies.test.ts (5 tests) 23ms
línea  5707:  ✓ tests/components/CierreBodegaDetalleCascadas.test.tsx (17 tests) 4392ms
línea  7997:  ✓ tests/components/DineroIdentidadesEnPantalla.test.tsx (30 tests) 1712ms
línea  1983:  ✓ tests/integration/recuperar-contrasena-form.test.tsx (11 tests) 7705ms   ← el frágil, VERDE
```

El aviso de las **tres migraciones sin `down.sql`** es **preexistente y ajeno**: son de las rutas
optimizadas (agosto), y esta tanda **no añade ninguna migración**.

⚠️ **El log del gate completo NO va commiteado: pesa ~1 MB** (12.027 líneas), frente a los 17 KB de
los precedentes del repo. La evidencia es lo pegado arriba, con el número de línea de donde sale cada
cosa.

### ⚠️ Un rojo intermedio, MEDIDO y descartado: `wallet-tienda-cobro.test.ts`

Hubo **tres** corridas del gate completo, y la de en medio salió **roja**. Se documenta porque el
veredicto no puede ser «lo corrí hasta que salió verde».

| corrida | árbol | veredicto |
| --- | --- | --- |
| 1 | el final **menos un comentario** de `ingreso-ordenex.ts` | **VERDE** · `wallet-tienda-cobro` pasó |
| 2 | **el final** | **ROJO** · 1 test de `tests/integration/db/wallet-tienda-cobro.test.ts` |
| 3 | **el final, byte a byte idéntico al de la 2** | **VERDE** · `wallet-tienda-cobro` pasó (13 tests) |

El fallo de la 2 fue `expect(await tx.walletMovimiento.count()).toBe(cajaAntes)` → **esperaba 22,
recibió 24**: un conteo de filas de `wallet_movimiento` leído dentro de su propia transacción
revertida, que vio **dos filas comiteadas por otro worker** entre sus dos conteos.

**No es mío, y está medido, no razonado:**

- **aislado, 3 de 3 corridas en verde** (13 tests);
- **junto a mis dos tests de `integration/db`, 3 de 3 en verde** (21 tests);
- corriendo **toda la carpeta `tests/integration/db`** (223 archivos), `wallet-tienda-cobro` **pasó**
  y falló **otro archivo distinto** (`liquidacion-reparto-migration.test.ts`, en un hook, sin ningún
  caso rojo) — que a su vez pasó en las corridas 1 y 3. **El rojo se mueve de sitio**, que es la
  firma del flake de saturación que el propio `tests/baseline-rojos.json` describe;
- **mi diff no escribe en `wallet_movimiento`**: mi test de Postgres crea `usuario`, `tarifa`,
  `cierre_bodega`, `cierre_dia`, `orden`, `gestion_orden`, `pago` y `cierre_detail`, **todo dentro de
  una transacción que siempre se revierte** y tomando el lock de aviso
  (`serializarEscriturasReales`) como primera sentencia.

**NO se metió en `tests/baseline-rojos.json`.** La lista se añade sólo cuando la deuda es de otro,
está medida y con su motivo escrito; un flake que pasa 6 de 6 veces aislado no es deuda de nadie, y
meterlo ahí taparía un rojo real el día que lo hubiera.

**El aviso del encargo sobre `tests/integration/recuperar-contrasena-form.test.tsx` sigue vigente**, y
en las tres corridas salió **verde**. Tampoco se metió en el baseline.

---

## Notas para quien siga (la tanda de PANTALLA, D2/D3)

1. **Lo que ya está listo para ella.** Los dos niveles traen `partesPorTienda` **ya derivado y ya
   ordenado**, y `ganaLaTienda` agregado en los dos. La pantalla **no tiene que hacer ni una
   operación aritmética**: sólo contar elementos.
2. ⚠️ **LOS UMBRALES SON TRES Y DISTINTOS.** El del nivel por mensajero es
   `cierres[i].partesPorTienda.length >= 2` — **las tiendas de ESE mensajero**—, y el del agregado es
   `partesPorTienda.length >= 2`. **No son el mismo número**, y el caso que los separa (dos
   mensajeros con una tienda cada uno) ya está atado por test en el servidor; en pantalla toca **D3**.
3. **`ariaLabel` único en el modal**, que ya monta las mismas cascadas una vez por mensajero: el
   nombre de la tienda **no basta** como discriminante (dos tiendas pueden llamarse igual, y el
   servidor lo permite a propósito).
4. **`DesglosePorTienda` hoy es una función local de `CascadasCierreMensajero.tsx`** (lo dejó dicho
   `progress/impl_396_frontend.md`). Para R22 habrá que **exportarla** o sacarla a archivo propio — y
   si se saca, se toca el censo de `DineroIdentidadesEnPantalla`. **Esa decisión es de D2, no de
   aquí.**
5. **La descarga no se tocó (R27, Q3)** y **`CierreDiaModule.tsx` tampoco** (R26).
6. El arnés de mutaciones vive en el scratchpad de la sesión, **no en el repo**: es de un solo uso y
   su evidencia es la salida pegada arriba.

---

## Veredicto

**Hecha la mitad de servidor del cierre de BODEGA (D1 + D4): los dos niveles emiten el
`ganaLaTienda` agregado que faltaba y el desglose por tienda de SUS propias gestiones, con el umbral
del mensajero cierto por construcción, el descuadre del agregado enseñado en vez de maquillado, 6
mutaciones muertas y un control negativo que sobrevive — y sin que ni una cifra de dinero ya visible
cambie de valor.**
