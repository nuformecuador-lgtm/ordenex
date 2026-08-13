# 213 — Pago múltiple por entrega (captura y presentación) — Bitácora de implementación

> Zona `frontend` · rama `feature/213-pago-multiple-captura` (de `origin/dev`, `bb4c3185`) ·
> worktree `C:/w213b` · spec aprobado en la puerta F1.4 el 2026-08-13.
> **18/18 tasks cerradas** salvo T16 y T18, que son del leader (ver §7).
> Trazabilidad `R → test`: **35/35**.

## 1. Qué se cerró

La 212 dejó el backend capaz de guardar 0..N líneas `metodo`+`monto` por gestión, pero el
mensajero **seguía sin poder usarlo**: el panel pintaba un `<Select>` único y mandaba la forma
escalar. Esta ficha abre esa ventana por los dos lados —captura y presentación— y no toca ni una
línea de backend.

Lo que un mensajero puede hacer hoy y ayer no: entregar una orden de 8.000 cobrada 5.000 en
efectivo y 3.000 por transferencia, ver el descuadre **antes** de pulsar, y que el cierre del día
reparta esos 5.000 al `total_efectivo` en vez de mentir con los 8.000 en un solo método.

## 2. Archivos creados y modificados

`git diff --name-only origin/dev`, revisado archivo por archivo (T15):

**Producción — nuevos (2)**

| Archivo | Qué es |
| --- | --- |
| `app/(app)/mis-asignaciones/_components/desglose-captura.ts` | módulo PURO de la captura: `LineaEnEdicion`, `lineaNueva`, `lineasIniciales`, `opcionesPara`, `puedeAnadirLinea`, `pendiente`, `lineasParaEnviar`, `erroresDeLinea`, `totalCapturado`, `capturaCuadra`, `ERRORES_LINEA`. Sin React, sin runtime de servidor |
| `app/(app)/cierres-admin/_components/desglose-pago.ts` | módulo PURO del formateo: `desglosePantalla` (con `money()`), `desgloseDescarga` (money-safe) y `SEPARADOR_DESGLOSE` |

**Producción — modificados (5)**

| Archivo | Cambio |
| --- | --- |
| `app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx` | estado `metodoPago` → `lineas`; `DesglosePagoField` nuevo; `buildRaw`/`buildFormData`/`elegirResultado` adaptados; `metodoPagoEfectivo` borrado |
| `app/(app)/cierre-dia/_components/CierreDiaModule.tsx` | celda «Método» → `desglosePantalla(g.pagos) ?? "—"` |
| `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx` | `DesglosePagoCelda` nuevo; `METODO_LABEL` sale del import y de la re-exportación |
| `app/(app)/cierres-admin/_components/cierre-factura.tsx` | la fila «Recibido · método» itera el desglose |
| `app/(app)/mis-asignaciones/_components/causa-devolucion-options.ts` | solo el comentario de cabecera: citaba un archivo que esta ficha borra |

**Producción — modificados de una línea (2)**

`app/(app)/cierre-dia/_components/cierre-dia-descarga-columnas.ts` y
`app/(app)/cierres-admin/_components/cierre-gestiones-descarga-columnas.ts`:
`metodo: desgloseDescarga(gestion.pagos)`. Las declaraciones de columnas **no se tocan**.

**Producción — borrado (1)**

`app/(app)/mis-asignaciones/_components/metodo-pago-options.ts` — ver §8, hallazgo 1.

**Tests — nuevos (4)**

`tests/unit/utils/desglose-captura.test.ts` (19) · `tests/components/GestionarOrdenPanelPagos.test.tsx`
(17) · `tests/components/CierreDetallePagos.test.tsx` (10) · `tests/unit/guards/pagos-captura.guardia.test.ts` (25).

**Tests — ampliados (9)**

`CierreDiaModule.test.tsx`, `CierresAdminModule.test.tsx`, `CierreDiaModuleIncidente.test.tsx`,
`descarga/CierresDescarga.test.tsx` (los 4 fixtures del censo: **solo altas de `pagos`, cero
`expect` tocados**), `RepartoModule.test.tsx` (4 casos adaptados, ver §8 hallazgo 2),
`tests/unit/descarga/cierre-dia-descarga-columnas.test.ts` y su gemelo del admin (solo altas),
`tests/unit/descarga/columnas-sensibles.guardia.test.ts` (§4), `e2e/mis-asignaciones.spec.ts`.

**R33 verificado:** el diff no contiene **ni un archivo** de `db/`, `prisma/`,
`lib/repositories/`, `lib/services/` ni `lib/interfaces/`. Cero migraciones, cero RLS.
**R34 verificado:** `tests/unit/guards/pagos-frontera.guardia.test.ts` y los tests de la 212
siguen verdes **sin editarlos**.
**R32 verificado:** el barrido de `metodoPago` en `app/` solo lo encuentra como **nombre del campo
de error** (`firstError(fieldErrors, "metodoPago")`, que es donde la regla 3 del borde cuelga su
issue, R14) y en comentarios. Ningún sitio de presentación lo lee.

## 3. Mapa `R<n> → test` — 35/35, con resultado real

Todos los `it` de abajo están **verdes** en la corrida de §6.

| R | Test | Resultado |
| --- | --- | --- |
| R1 | `GestionarOrdenPanelPagos.test.tsx` :: «R1: con cobro, la rama entregada monta el editor de líneas y ya no el selector único» | verde |
| R2 | idem :: «R2: arranca con UNA línea, sin método y con el monto a cobrar pre-cargado» + `desglose-captura.test.ts` :: «arranca con exactamente una linea…» | verde |
| R3 | `desglose-captura.test.ts` :: «puedeAnadirLinea es falso con 3 lineas» + «…es cierto mientras queden metodos sin usar» **+ (añadido tras la revisión, §9.4)** `GestionarOrdenPanelPagos.test.tsx` :: «R3: se pueden añadir líneas mientras queden métodos; con 3 el control desaparece» | verde |
| R4 | `desglose-captura.test.ts` :: «el monto de la linea nueva es la diferencia pendiente, nunca negativa», «pendiente es 0 cuando la captura ya cuadra», «pendiente es 0 —y nunca negativo— cuando la suma se pasa del total», «la linea nueva nace con el monto pendiente pre-cargado y un id propio» | verde |
| R5 | `desglose-captura.test.ts` :: «opcionesPara(i) deshabilita los metodos usados en OTRAS lineas, no el de la propia linea» + «nunca oculta una opcion: siempre devuelve el catalogo completo» | verde |
| R6 | `GestionarOrdenPanelPagos.test.tsx` :: «R6: quitar una línea libera su método en las demás y con una sola no se ofrece quitar» | verde |
| R7 | idem :: «R7 [D3]: la línea no ofrece referencia ni ningún otro campo» | verde |
| R8 | idem :: «R8: muestra monto a cobrar, suma capturada y diferencia, y se actualizan al teclear» | verde |
| R9 | idem :: `it.each` «R9: una suma que NO cuadra (de menos / de más / por un céntimo) pinta el error y NO llama a la action» — 3 casos: 5000, 9000, 8000.01 | verde (3/3) |
| R10 | idem :: «R10: volver atrás y elegir otro resultado descarta las líneas capturadas» | verde |
| R11 | `desglose-captura.test.ts` :: «0.1 + 0.2 contra 0.30 cuadra: la aritmetica es en centimos, no en floats», «una diferencia real de un centimo NO cuadra…», «una linea sin monto o con texto no numerico cuenta como 0…» + `pagos-captura.guardia.test.ts` bloque 3 | verde |
| R12 | `desglose-captura.test.ts` :: «lineasParaEnviar descarta las lineas completamente vacias» + «conserva el orden de captura…» | verde |
| R13 | `desglose-captura.test.ts` :: «lineasParaEnviar NO descarta la linea a medias…», «marca metodo-sin-monto en la linea que lo provoca…», «marca monto-sin-metodo…», «un monto no estrictamente positivo con metodo elegido es error, no un cobro de cero», «la linea completamente vacia NO da error» + componente :: «R13: método sin monto → error EN ESA LÍNEA y no se envía» / «R13: monto sin método → …» | verde |
| R14 | `GestionarOrdenPanelPagos.test.tsx` :: «R14: con cobro y todas las líneas vacías, error de método requerido y no se envía» | verde |
| R15 | idem :: «R15: el envío mixto manda dos pares `pagoMetodo`/`pagoMonto` emparejados y NINGÚN `metodoPago`» + `RepartoModule.test.tsx` (caso de una sola línea) | verde |
| R16 | idem :: «R16: orden SIN cobro: no hay editor, cero pares de pago y sin `metodoPago` escalar» + «R16 (contraprueba): con `montoCobrar > 0` el editor SÍ se monta» + `RepartoModule.test.tsx` :: «ENTREGAR sin cobro» | verde |
| R17 | idem :: «R17: el panel valida con `gestionarSchema` antes de enviar (sin fotos → no envía)» | verde |
| R18 | idem :: «R18: un `validation_error` del servidor en `pagos` se pinta en el editor» | verde |
| R19 | `pagos-captura.guardia.test.ts` bloque 1 (árbol de imports del panel, 87 archivos, 0 especificadores sin resolver) | verde |
| R20 | `CierreDetallePagos.test.tsx` (×2 sitios) + `CierreDiaModule.test.tsx` :: «R20: una sola línea se ve EXACTAMENTE igual que antes: la etiqueta a secas, sin monto» | verde (×3) |
| R21 | mismos :: «R21: dos líneas se ven las DOS, cada una con su monto en la moneda de configuración» | verde (×3) |
| R22 | mismos :: «R22/R23: sin líneas la celda sigue siendo «—», aunque la gestión traiga el escalar» | verde (×3) |
| R23 | mismos casos R22/R23 (el fixture declara `metodoPago: "SINPE"` con `pagos: []`: si algún sitio leyera el escalar, pintaría «SINPE») + `pagos-captura.guardia.test.ts` bloque 2 | verde |
| R24 | mismos :: «R24: se pinta el ORDEN del DTO, no el alfabético» (DTO `transferencia, SINPE, efectivo`) | verde (×3) |
| R25 | mismos :: «R25: la etiqueta sale de METODO_LABEL (mutarla cambia lo pintado)» | verde (×3) |
| R26 | `tests/unit/descarga/cierre-dia-descarga-columnas.test.ts` y su gemelo: los 6 + 5 casos de censo y orden **YA existentes, sin editar** (`git diff` de esos archivos: cero líneas borradas) | verde |
| R27 | ambos :: «una gestión con pago MIXTO produce UNA sola fila, no un array (R27)» | verde |
| R28 | ambos :: «dos líneas se concatenan en la celda `metodo` con un ÚNICO separador (R28)» → `"Efectivo 5000.00 + Transferencia 3000.00"` + «respeta el ORDEN del DTO aunque difiera del alfabético (R28)» | verde |
| R29 | ambos :: «una sola línea da SOLO la etiqueta, exactamente igual que hoy (R29)» | verde |
| R30 | ambos :: «sin líneas de pago la celda `metodo` queda VACÍA: `null`, ni «—» ni «» (R30)» | verde |
| R31 | ambos :: «los montos son el STRING money-safe del servidor/snapshot TAL CUAL (R31)» + `pagos-captura.guardia.test.ts` bloque 3 + `columnas-sensibles.guardia.test.ts` | verde |
| R32 | `pagos-captura.guardia.test.ts` bloque 4 + `tests/unit/types/gestion-orden-pagos-schema.test.ts` (212, **sin tocar**) | verde |
| R33 | `git diff --name-only origin/dev` revisado (§2): cero archivos de `db/`, `lib/repositories/`, `lib/services/`, `lib/interfaces/` | verde |
| R34 | `tests/unit/guards/pagos-frontera.guardia.test.ts` (212), verde **sin editarla** | verde |
| R35 | `tests/unit/utils/cierre-totales-pagos.test.ts` y `cierre-dia-service-totales-mixtos.test.ts` (212, sin tocar) + `e2e/mis-asignaciones.spec.ts` bloque (d) **escrito, NO ejecutado** (§8 hallazgo 3) | verde en unit; e2e no ejecutado |

## 4. [Q3] La sonda de `columnas-sensibles.guardia` — totales antes y después

La puerta autorizó tocar la guardia **midiendo**. Los cinco números, con una instrumentación
equivalente a la de la propia guardia:

```
BASELINE (punta de dev, antes de tocar nada)
  modulos=23  declaraciones=38  columnas=303  filas=37  celdas=295  proyeccionesQueRevientan=0

INTERMEDIO (T10 hecho, sonda SIN ampliar)
  modulos=23  declaraciones=38  columnas=303  filas=35  celdas=271  proyeccionesQueRevientan=2

DESPUÉS (T10 + sonda ampliada)
  modulos=23  declaraciones=38  columnas=303  filas=37  celdas=295  proyeccionesQueRevientan=0
```

**Los cinco idénticos al baseline. Las columnas vigiladas no bajan: 303 → 303.** El intermedio es
exactamente lo que el diseño §5 anticipaba (`pagos.map is not a function` en las dos proyecciones
de entregadas, −2 filas y −24 celdas): la guardia se ponía roja **por su propia mecánica**, no por
un hallazgo. La ampliación lo recupera al valor original.

**Qué se amplió, y por qué así:** un campo leído como LISTA devuelve ahora un array de UNA sonda
cuya ruta es `campo[]`, de modo que **el rastro sobrevive**: si mañana alguien emitiera
`pagos[].urlFirmada`, el marcador seguiría delatándolo y la lista negra seguiría mordiendo. Los
cuatro `it` originales de la guardia quedan **byte a byte iguales**; los únicos borrados del
archivo son 2 líneas de comentario dentro de `sonda()`.

**Contraprueba nueva (exigida por la puerta):** una proyección de juguete que hace
`gestion.pagos.map(p => …p.urlFirmada…)` deja el origen `pagos[].urlFirmada`, que la lista negra
muerde; su gemela inocente deja exactamente `["pagos[].metodo","pagos[].monto"]` y no muerde
(control de no-vacuidad). **Al quitar el arreglo, la contraprueba se pone en rojo** con el
`TypeError` esperado. Revertido.

**Se rechazó** poner `Array.isArray(gestion.pagos) ? … : null` en producción, como manda el diseño:
es escribir código con forma de test en un camino de dinero y, peor, dejaría la celda vacía **en
silencio** si el DTO llegara malformado, en vez de reventar.

## 5. Evidencia de mutación — descuadre, no humo

Cada mutación se aplicó al código real, se corrió, se anotó y se **revirtió**.

| Mutación | Rojos | Casos que cayeron |
| --- | --- | --- |
| invertir el `disabled` de `opcionesPara` | 1/19 | «opcionesPara(i) deshabilita los metodos usados en OTRAS lineas…» |
| `lineasParaEnviar` descarta también la línea a medias | 1/19 | «lineasParaEnviar NO descarta la linea a medias…» |
| sumar con floats en vez de céntimos | 2/19 | «0.1 + 0.2 contra 0.30 cuadra…» y «una diferencia real de un centimo NO cuadra…» |
| no filtrar las líneas vacías en el envío | 1/17 | «R14: con cobro y todas las líneas vacías, error de método requerido y no se envía» |
| enviar el escalar `metodoPago` ADEMÁS del desglose | 2/17 | «R15: el envío mixto…» y «R16: orden SIN cobro…» |
| ordenar la lista en `desglosePantalla` | 3 | R24 en los tres sitios |
| sustituir `METODO_LABEL` por un literal | 3 | R25 en los tres sitios |
| `import { Prisma } from "@prisma/client"` + `lineas-pago` en el panel | 3 | bloque R19 de la guardia |
| `g.metodoPago ?? …` inyectado en `CierreDiaModule.tsx` | 2 | bloque R23 |
| `parseFloat` fuera de `montoDeTexto` + `Number(...).toFixed(2)` en la descarga | 5 | bloque R11/R31 |
| borrar `metodoPago: z.enum(...)` de `gestion-orden.ts` | 2 | bloque R32 |
| quitar el arreglo de listas de la sonda | contraprueba en rojo | §4 |

Todas revertidas; la corrida de §6 es posterior a la reversión.

**Dos más, tras la revisión** (detalle en §9): la del **reviewer** —intercambiar los baldes de
método entre las dos primeras líneas de `lineasParaEnviar`, que deja el total idéntico y cambia el
reparto— dio **3 rojos**; y la del caso de UI de R3 —`(true || puedeAnadirLinea(lineas))` en el
panel— dio **1 rojo, y solo ese**.

## 6. Verificación ejecutada

```
pnpm run typecheck   -> tsc --noEmit, sin salida, exit 0
pnpm run lint        -> 61 problems (0 errors, 61 warnings)
                        Los 61 son no-unused-vars PREEXISTENTES en archivos ajenos
                        (Sidebar.tsx, TiendasModule.tsx, mocks de tests). Cero en
                        los archivos de esta feature. Mismo total que antes de empezar.

pnpm exec vitest run tests/unit/guards tests/unit/descarga
                     tests/unit/utils/desglose-captura.test.ts
                     tests/components/{GestionarOrdenPanelPagos,CierreDetallePagos,
                       CierreDiaModule,CierresAdminModule,CierreDiaModuleIncidente,
                       RepartoModule}.test.tsx
                     tests/components/descarga/CierresDescarga.test.tsx
                     tests/unit/types/gestion-orden-pagos-schema.test.ts
                     tests/unit/utils/cierre-totales-pagos.test.ts
  -> Test Files  72 passed (72)
     Tests      870 passed (870)
     Duration    57.39s

pnpm exec vitest related --run <los 23 .ts/.tsx del diff, sin e2e/>
  -> Test Files  34 passed (34)
     Tests      591 passed (591)
     Duration    95.25s

pnpm exec vitest run tests/unit/descarga  -> 29 archivos / 186 tests, verde
pnpm exec vitest run tests/unit/guards    -> 33 archivos / 398 tests, verde
```

Cero `unhandled errors` en todas las corridas. **La suite completa (`./init.sh`) NO la corrió el
implementer**: por la regla del gate de `AGENTS.md`, la corre el leader (T16, §7).

## 7. Lo que queda fuera de esta bitácora, a propósito

- **T16 — `./init.sh` completo.** Es del leader. Recordatorio de `docs/verification.md`: redirigir
  a fichero y **no** pipear (`./init.sh | tail` devuelve el exit de `tail`), y comparar el TOTAL de
  archivos con el de `dev` antes de creerse el conteo: una corrida degradada omite archivos enteros
  y parece casi verde. La 212 midió 1081 archivos / 13579 tests.
- **T18 — bookkeeping y PR.** `feature_list.json` (213 → `done`) y `progress/current.md` los cierra
  el leader **después** de T16 y del reviewer. El merge de `dev` y el PR también.

## 8. Hallazgos y desvíos del spec

**1. `metodo-pago-options.ts` quedó huérfano y hubo que borrarlo.** El spec no lo anticipaba.
Al sustituir el `<Select>` único por el editor, nadie importaba ya `METODO_PAGO_OPTIONS` /
`METODO_PAGO_LABEL`, y `tests/unit/guards/superficie-de-uso.guardia.test.ts:734` lo denunció en
rojo. **Es deuda de esta feature, no ajena**, así que se cerró: se borra el módulo y se arregla la
referencia muerta del comentario de `causa-devolucion-options.ts:6`. Era además una **duplicación
de etiquetas**: la fuente única viva es `METODO_LABEL` de `cierre-labels.ts`, que es lo que R25
exige. `tests/unit/guards` quedó en 33/33 archivos verdes.

*Referencia muerta que NO se tocó:* `lib/utils/descripcion-pago.ts:12` conserva un comentario que
cita la ruta ya inexistente. **R34 prohíbe expresamente modificar `descripcion-pago.ts`**, así que
se deja como está y se anota aquí para que el leader decida.

**2. `RepartoModule.test.tsx`: 4 casos adaptados, uno con cambio de VALOR esperado.** Montan el
panel y elegían en el selector único. Tres son puro renombrado del nombre accesible
(`"Método de pago"` -> `"Método de pago línea 1"`) con sus `expect` intactos, y uno de ellos incluso
se **refuerza** (pasa a afirmar los pares `pagoMetodo`/`pagoMonto` y `metodoPago === null`).
**El único `expect` que cambia de valor es el de la orden SIN cobro**: donde esperaba
`metodoPago === "efectivo"` ahora exige `metodoPago === null` y cero pares. Eso es **mandato
explícito de R16**: el `"efectivo"` forzado de `GestionarOrdenPanel.tsx:331` era precisamente la
mentira cómoda que esta ficha borra. No es relajar una aserción; es cambiarla porque el requisito
lo ordena.

**3. El e2e NO se ejecutó, y [Q5] sigue vivo como deuda aparte.** `e2e/mis-asignaciones.spec.ts`
se amplió con el helper `capturarLineaDePago` y el bloque **(d)** del camino mixto (8.000 = 5.000
efectivo + 3.000 transferencia -> el cierre muestra `total_efectivo` 5.000 **y no** 8.000, R35),
pero **no se corrió**: necesita `.env` con credenciales, base con migraciones, bucket privado
`gestion-evidencias`, el fixture `e2e/fixtures/evidencia.jpg`, seed del mensajero con la primera
orden en `por_recoger` de 8.000, y `pnpm dev` levantado.

**Y aun con todo eso fallaría, por deuda ANTERIOR a esta ficha.** Como cerró [Q5] en la puerta, se
arregló **solo** lo que este cambio rompe (la línea `:128` del recaudo). Lo que sigue obsoleto y
**NO se tocó** —para que el leader dé de alta la ficha—: `recogerPrimeraOrden` asume el botón
«Recoger» por fila y el modal «Recoger órdenes» que retiró la **96**; `abrirGestionPrimeraOrden`
(`:98`) espera un `dialog` «Gestionar orden» que la **113** convirtió en panel INLINE (con lo que
todo `expect(modal).toBeHidden()` cae); y `elegirEnSelect(page, "Resultado de la gestión", …)` está
muerto porque el resultado hoy se elige con botones.

**4. `import type` de `@prisma/client`: se tolera, la importación de VALOR se prohíbe.** El spec
decía «el panel no importa `@prisma/client`» a secas y eso, medido, **es falso**: el árbol del
panel (87 archivos) tiene **14 `import type`** de `@prisma/client`, entre ellos `cierre-labels.ts`,
por donde pasa `METODO_LABEL`. Un `import type` se borra al compilar: no emite `require`, no entra
en el grafo del bundler y no viaja al navegador. Prohibirlo obligaría a duplicar los enums en el
cliente, que es la forma segura de que un día dejen de coincidir con la base. La guardia afirma en
su lugar que **todas** son de tipo, con control de no-vacuidad (>5), y la decisión está comentada
en el propio test. Por el mismo motivo, `lineas-pago.ts` se prohíbe **por su rol** (serializador de
proyecciones Prisma) y no «porque arrastre Prisma al bundle»: medido, sus imports de Prisma también
son de tipo. El motivo escrito en el spec no era exacto y quedó corregido en el comentario.

**5. La guardia de R19 se detiene en los módulos `"use server"`.** No viajan al bundle; seguirlos
convertiría la guardia en «el panel alcanza Prisma», que es cierto y no dice nada. Se mide además
que **todo** corte esté bajo `lib/actions/` y empiece por esa directiva, para que el corte no se
pueda usar como puerta trasera.

**6. La excepción de R11 se acota por POSICIÓN, no por nombre de archivo.** El `Number(texto)` del
input vive dentro del cuerpo de `montoDeTexto` y la guardia lo delimita por emparejamiento de
llaves: un `parseFloat` en cualquier otra línea del mismo módulo **sigue siendo infracción**. Se
comprueba además que `montoDeTexto` **no se exporta**, para que la excepción no se pueda propagar.
En los dos módulos de descarga no hay excepción ninguna.

**7. Zona ciega de la sonda — ERA una regresión, y quedó ARREGLADA (ver §9.1).** Lo que este
hallazgo decía era: *«no es una regresión: antes de esta ficha la celda hacía
`METODO_LABEL[gestion.metodoPago]`, con exactamente la misma zona ciega»*. **Era falso, y el
reviewer lo midió** (§5.2 de `progress/review_213.md`): la línea de `dev` llevaba
`?? gestion.metodoPago`, y ese respaldo **sí** devolvía la sonda, con lo que la celda quedaba
rastreada. Los orígenes rastreados caían de **320 a 318** y las celdas sin origen subían de **12 a
14**. Los cinco totales de §4 no lo detectaban porque no miden eso.

Se deja escrito el error en vez de reescribirlo: el fallo no fue la zona ciega —esa se declaró—,
fue **declarar «no es regresión» comparando de memoria en lugar de medir las dos puntas**. Arreglado
en §9.1, con la cobertura ahora **por encima** de la de `dev`.

**8. La barrera preventiva corre ANTES de pedir la geolocalización.** Detalle de implementación del
panel: pedir el permiso de ubicación para una gestión que ya se sabe que no va a salir gastaría el
único gesto que el mensajero concede de buena gana. El `safeParse` con `gestionarSchema` sigue
intacto como segunda barrera (R17), y las dos llaman al **mismo** `sumaCuadra`: dos barreras, una
regla.

**9. [Q7] respetada al pie de la letra.** No se añadió input de monto recibido. El panel sigue
fijando `montoRecibido = orden.montoCobrar ?? 0` y el cuadre es **exacto**. El mensajero elige
**cómo** le pagaron, nunca **cuánto**. R22(h) de `MisAsignacionesService.ts:349-363` no se tocó.

---

## 9. Cierre tras la revisión (2026-08-13)

El reviewer **APROBÓ** la ficha: 0 bloqueantes, 35/35 verificados uno a uno, y una mutación propia
que ninguna de las 12 mías cubría —**intercambiar los baldes de método entre las dos primeras
líneas de `lineasParaEnviar`**: el total general no cambia ni un céntimo, cambia a qué método va
cada monto, que es exactamente lo que mueve `cierre_dia.total_efectivo`— con **3 rojos**. La suite
detecta un descuadre POR MÉTODO aunque el total cuadre, que era lo que había que demostrar.

Se cerraron cuatro de sus seis menores. Los dos que quedan (3 y 6) son de otro dueño, ver §9.5.

### 9.1 [menor 2] La sonda vuelve a rastrear la celda `metodo`, y por encima de `dev`

`comoLista()` materializa ahora **DOS** sondas en vez de una (`ELEMENTOS_DE_LISTA = 2`), las dos con
la **misma** ruta `campo[]` —no `campo[0]`/`campo[1]`—, para que el marcador siga siendo idéntico y
la lista negra vigile el CAMPO y no la posición. Con dos elementos, `desgloseDescarga` entra por la
rama de **2+ líneas** —la que esta feature añade, y que hasta ahora no se ejecutaba nunca bajo la
sonda— y la celda vuelve a estar rastreada.

Medido con archivo temporal creado, ejecutado y **borrado**:

| | ANTES (1 sonda) | DESPUÉS (2 sondas) | referencia `dev` |
| --- | --- | --- | --- |
| modulos | 23 | 23 | 23 |
| declaraciones | 38 | 38 | 38 |
| **columnas vigiladas** | **303** | **303** | **303** |
| filas | 37 | 37 | 37 |
| celdas | 295 | 295 | 295 |
| proyeccionesQueRevientan | 0 | 0 | 0 |
| **orígenes rastreados** | **318** | **322** | **320** |
| celdas sin origen | 14 | **12** | 12 |
| `filaDescargaDiaEntregada.metodo` | `[]` | `["pagos[].monto","pagos[].monto"]` | `["metodoPago"]` |
| `filaDescargaGestionEntregada.metodo` | `[]` | `["pagos[].monto","pagos[].monto"]` | `["metodoPago"]` |

**Los cinco totales de la puerta [Q3] no se mueven** (303 = 303: el criterio bloqueante sigue
cumpliéndose) y los orígenes rastreados suben a **322, por encima de los 320 de `dev`**. Ninguna
condición de parada se disparó.

**Matiz que el reviewer no midió y conviene no perder:** la celda rastrea `pagos[].monto` (dos
veces) pero **no** `pagos[].metodo`. Motivo: `METODO_LABEL[p.metodo]` usa la sonda como **clave** de
un `Record`, la coacción da `undefined` y el rastro del método se pierde ahí. Es una limitación de
leer un campo **a través de un mapa de etiquetas**, no del arreglo, y afecta igual a
`ESTADO_LABEL` y compañía en el resto del árbol. Lo que importa se cumple: la celda deja de ser un
literal opaco, la rama de 2+ se ejecuta bajo la sonda, y un futuro `pagos[].referenciaFirmada` o
`pagos[].urlFirmada` **sí** se delata —lo demuestra la contraprueba, donde el campo se lee con
`String(...)` y no como clave—.

Una afirmación de la contraprueba (la del 213, **no** de los cuatro `it` originales) se adaptó: la
lista de orígenes inocentes pasa por `[...new Set(...)]` contra la misma lista esperada, más una
afirmación NUEVA de que `pagos[].monto` aparece **más de una vez**, que es justamente la propiedad
que hace entrar a `desgloseDescarga` por la rama de 2+. Los cuatro `it` originales siguen intactos
y verdes con los mismos números. Neutralizando `esLecturaDeLista`, el archivo entero se pone rojo
con `TypeError: pagos.map is not a function`; revertido.

### 9.2 [menor 1] R19 ya no contradice al código

`requirements.md` decía «NO DEBEN importar `@prisma/client`» a secas mientras la guardia tolera
`import type`. Un requisito que miente es peor que uno estricto, así que **R19 pasa a afirmar lo que
la guardia verifica de verdad**: prohibida la importación de `@prisma/client` **como VALOR** y
prohibido `lineas-pago.ts` de cualquier forma; `import type` permitido. Lleva debajo la constancia
de la relajación, con los **14 `import type` vivos** que la motivaron y el porqué (duplicar los
enums en el cliente es la forma segura de que un día dejen de coincidir con la base). La fila R19 de
la tabla de trazabilidad se ajustó al mismo texto.

### 9.3 [menor 5] La evidencia de T14 decía «el flujo pasa», y era falso

`tasks.md` T14 afirmaba «**Hecho:** el flujo pasa». Ese e2e se **escribió y nunca se ejecutó**.
La línea se reescribió para decir exactamente lo que ocurrió: escrito y no ejecutado, qué haría
falta para ejecutarlo, que aun así fallaría por deuda anterior, qué quedó sin tocar por [Q5], y la
consecuencia que importa —**hoy el único test que recorre captura → `total_efectivo` de punta a
punta no corre en ninguna parte**—.

### 9.4 [menor 4] R3 SÍ necesitaba caso de UI, y se añadió

Se miró el código real antes de decidir. El render es literalmente
`{puedeAnadirLinea(lineas) ? <Button…/> : null}`, sin condición intermedia, así que la **regla**
estaba bien cubierta por el módulo puro. Lo que el módulo puro no puede afirmar es el **cableado**:
que pulsar el control haga crecer `lineas` de verdad, que `puedeAnadirLinea` reciba el estado
vigente y no una copia estancada, y que el tope de 3 se alcance recorriendo la UI. Eso no lo cubría
nada, y era justo lo que la tabla del spec prometía.

Caso nuevo en `GestionarOrdenPanelPagos.test.tsx`: «R3: se pueden añadir líneas mientras queden
métodos; con 3 el control desaparece» — 1 línea → añadir → 2 y el botón **sigue** ofreciéndose →
añadir → 3 y `queryByRole` da `null`. **No es de humo:** mutando el panel a
`(true || puedeAnadirLinea(lineas))` cae ese caso y **solo** ese (1 de 18, en el `toBeNull`).
Revertido.

### 9.5 Lo que sigue abierto, y de quién es

- **[menor 3] La ficha de deuda del e2e.** La da de alta el leader ([Q5]). Detalle en §8.3.
- **[menor 6] El comentario muerto de `lib/utils/descripcion-pago.ts:12`.** **R34 prohíbe tocar ese
  archivo**, y el reviewer confirma que se hizo bien en dejarlo. Que lo recoja la 214 o un chore.
- **T16 y T18.** El `./init.sh` completo ya lo corrió el leader y salió verde (**1090 archivos /
  13751 tests, 0 rojos, 388 s**); lo vuelve a correr al cerrar, porque este bloque tocó dos tests.
  El bookkeeping y el PR son suyos.

### 9.6 Verificación de este bloque

```
pnpm run typecheck                                          -> verde, sin salida
pnpm run lint                                               -> 61 problems (0 errors, 61 warnings), sin cambio
pnpm exec vitest related --run <los 2 archivos tocados>     -> 2 archivos / 23 tests, verde
pnpm exec vitest run tests/unit/descarga                    -> 29 archivos / 186 tests, verde
pnpm exec vitest run tests/components/GestionarOrdenPanelPagos.test.tsx
                                                            -> 1 archivo / 18 tests, verde (17 + el nuevo de R3)
```

---

## 10. La excepción a R34 y el barrido de atribuciones (2026-08-13)

Otra sesión había traspasado esta misma ficha con un segundo spec en `dev`
(`specs/213-pago-multiple-presentacion/`, 23 requisitos, puerta sin pasar, cero código). El humano
decidió que gana este spec y el leader retiró el rival, pero al compararlos requisito a requisito
**el R20 del rival marcaba un hueco real del nuestro**: corregir los comentarios que atribuyen mal
el retiro de la forma escalar. Se adoptó, con **excepción acotada a R34 autorizada el 2026-08-13**
y constancia escrita junto a R34 en `requirements.md`.

### 10.1 Lo que se corrigió

**`lib/utils/descripcion-pago.ts`** (único archivo tocado bajo la excepción, y solo su comentario):
citaba `METODO_PAGO_LABEL` de `app/(app)/mis-asignaciones/_components/metodo-pago-options.ts`,
módulo que **esta misma ficha borró** al quedar huérfano (§8.1). La referencia muerta la creamos
nosotros y R34 nos impedía limpiarla; el reviewer lo marcó como menor 6. El párrafo pasa a apuntar a
`METODO_LABEL` (`cierre-labels.ts`), que es la fuente de pantalla viva, **conservando el argumento
de fondo** —`lib/` no depende de `app/`, coinciden porque describen el mismo catálogo, no porque
una sea fuente de la otra— y deja anotada la excepción en el propio comentario. **Ni una línea de
lógica cambió.**

### 10.2 Lo que NO se tocó: 7 archivos AJENOS con la atribución equivocada

El barrido destapó bastante más de lo esperado, y **todo está fuera del diff de esta feature**, así
que se lista en vez de tocarse. **Todos son de la 212** y dicen, con distintas palabras, que **«la
213 retira / decide el retiro»** del escalar. Hoy eso es **falso**: la 213 es esta ficha y su R32
lo **conserva** explícitamente. Quien retira es la **214**.

| Archivo | Línea(s) | Qué dice hoy |
| --- | --- | --- |
| `lib/interfaces/repositories/ICierreDiaRepository.ts` | 35 | «columna DEPRECADA (la **213** decide su retiro)» |
| `lib/interfaces/services/ICierreDiaService.ts` | 36, 43, 44 | «su retiro lo decide la **213**» y «entre el merge de esta ficha y el de la **213** la pantalla sigue pintando el campo escalar» — lo segundo ya ocurrió y es al revés |
| `lib/repositories/CierreDiaRepository.ts` | 176 | «el par escalar se CONSERVA (la **213** decide su retiro)» |
| `lib/repositories/CierresAdminRepository.ts` | 245 | ídem |
| `tests/unit/guards/pagos-proyeccion.guardia.test.ts` | 118 | «`metodoPago` sobrevive hasta que la **213** decida retirarlo» |
| `tests/unit/services/cierre-dia-service.test.ts` | 1825-1826 | nombre del `it`: «R31: `metodoPago` NO desaparece — **la 213 lo retira**, no esta ficha» |
| `tests/unit/actions/mis-asignaciones-pagos.test.ts` | 9 | «hasta el merge de la 213 **el panel viejo sigue mandando un método escalar**» — el panel ya no lo manda (R15); el test sigue siendo válido y necesario (el borde debe seguir aceptando la forma escalar, R32), pero su motivación está caducada |

**Cuatro de los siete son producción bajo `lib/`.** No es cosmético: son justo los comentarios que
leerá quien implemente la 214 para saber qué puede retirar, y hoy le dicen que el trabajo ya está
hecho. **Se propone recogerlos en la 214**, que es la ficha que de verdad los deja ciertos al
cambiarlos: tocarlos aquí metería cuatro archivos de `lib/` en el diff de una feature `frontend`
—contra R33— por una corrección de comentario.

### 10.3 Falsa alarma comprobada: los `209`/`210` del árbol

El barrido de «ficha 209 / 210» devuelve 22 coincidencias en 12 archivos, **ninguna relacionada con
el recaudo**: son las features 209 (el quitador de comentarios compartido) y 210 (contraste de
tokens semánticos), ajenas y vivas en `dev`, exactamente la colisión de ids que avisaba el encargo.
**Cero cambios por este motivo.** Se deja escrito para que el próximo barrido no las vuelva a
levantar.

### 10.4 Verificación de este bloque

```
pnpm run typecheck                                 -> verde, sin salida
pnpm run lint                                      -> 62 problems (0 errors, 62 warnings)
pnpm exec vitest related --run lib/utils/descripcion-pago.ts
                                                   -> 35 archivos / 758 tests, verde
```

**El lint subió de 61 a 62 warnings y NO es nuestro.** El warning nuevo es «Unused eslint-disable
directive» en `app/(app)/configuracion/tarifas/_components/TiendasModule.tsx:63`, archivo que **no
está en el diff de esta feature**: entró con el merge de `origin/dev` (`ba4f45f3`). Cero errores, y
ninguno de los 62 cae en un archivo de la 213. Se anota y no se toca, según la regla del gate.
