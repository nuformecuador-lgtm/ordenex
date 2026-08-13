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
| R3 | `desglose-captura.test.ts` :: «puedeAnadirLinea es falso con 3 lineas» + «…es cierto mientras queden metodos sin usar» | verde |
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

**7. Zona ciega de la sonda en la rama de UNA línea (no bloqueante, no se arregló).** Con la sonda,
`desgloseDescarga` entra por `pagos.length === 1` y devuelve `METODO_LABEL[pagos[0].metodo]`, que
es **`undefined`**: el marcador se lo traga el mapa de etiquetas, porque ahí no hay el `?? campo`
de respaldo que sí usan `ESTADO_LABEL` / `CAUSA_INCIDENTE_LABEL` en el resto del árbol.
**No es una regresión**: antes de esta ficha la celda hacía `METODO_LABEL[gestion.metodoPago]`, con
exactamente la misma zona ciega, y ninguno de los cinco números de §4 se mueve. La sonda **sí**
delata listas donde la proyección las recorre, y la contraprueba lo demuestra. Queda escrito para
que el leader decida si vale una ficha de endurecimiento.

**8. La barrera preventiva corre ANTES de pedir la geolocalización.** Detalle de implementación del
panel: pedir el permiso de ubicación para una gestión que ya se sabe que no va a salir gastaría el
único gesto que el mensajero concede de buena gana. El `safeParse` con `gestionarSchema` sigue
intacto como segunda barrera (R17), y las dos llaman al **mismo** `sumaCuadra`: dos barreras, una
regla.

**9. [Q7] respetada al pie de la letra.** No se añadió input de monto recibido. El panel sigue
fijando `montoRecibido = orden.montoCobrar ?? 0` y el cuadre es **exacto**. El mensajero elige
**cómo** le pagaron, nunca **cuánto**. R22(h) de `MisAsignacionesService.ts:349-363` no se tocó.
