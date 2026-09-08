# impl_395 — las líneas que le faltaban al detalle del cierre de MENSAJERO (mitad de servidor)

Sin spec (`sdd: false`). Sin migración. Sin tocar componentes: la pantalla la monta
`frontend_dev` justo después.

## El fallo, y qué se hizo

La ficha 393 montó las dos cascadas del dinero **solo en los cierres de BODEGA**
(`CierresBodegaAdminModule` y `cierre-factura`). El detalle del cierre de **MENSAJERO**
—`CierresAdminModule`, el que se mira todos los días— se quedó con tarjetas sueltas: total
general, total Ordenex, pago al mensajero, pago a tienda. Sin la resta que las une, no se sabe
qué plata es para quién. Es un fallo de alcance, no del implementador de la 393.

El servidor ahora emite **cuatro campos nuevos** en `CierreDetalleAdminServiceResult`, todos
derivados con las funciones que ya viven en `lib/utils/ingreso-ordenex.ts` — nunca una copia ni
una suma en otro sitio.

## Los campos nuevos del DTO (nombres exactos, para la pantalla)

| campo | tipo | qué es |
| --- | --- | --- |
| `cobradoSobreRecaudado` | `string` | la LÍNEA PUENTE: `fleteConIva + comisionConIva`. Se emite **siempre**, también con el flete por rechazo en `"0.00"` |
| `netoOrdenex` | `string` | `totalesIngreso.total − totalPagoMensajero − totalIngresoBodegaRechazos`. **NO es `ganancia`** |
| `ganaLaTienda` | `string` | `totales.general − totalesIngreso.total`. **NO es `pagoTienda`** |
| `fleteRechazoYaCobradoATienda` | `boolean` | ¿el cargo del flete por rechazo YA está en la wallet de la tienda? |

Los tres importes viajan **como STRING con su signo**. Los tres pueden ser negativos y **ninguno
se recorta a cero**: un cero diría algo falso. `ganancia` y `pagoTienda` **siguen intactos** y
siguen viajando en el mismo DTO — nadie los absorbió.

## Las dos restas, y por qué el orden importa (esto es para quien monte la pantalla)

Hoy la pantalla enseña el `225.176,33` y el `70.946,67` sueltos y deja que el usuario haga una
resta que **no da**. El humano se confundió con ella y lo dijo así: «si yo me confundo, no
quiero imaginar los operarios».

**PRIMERO la partición de lo recaudado.** Es la que hace la cuenta obvia, y es la que el humano
dedujo solo:

```
Total recaudado                    285.275,00     ← cierre.totales.general
− Ordenex factura                   70.946,67     ← totalesIngreso.total
= La tienda gana                   214.328,33     ← ganaLaTienda        (CAMPO NUEVO)
```

La identidad `ganaLaTienda + totalesIngreso.total === totales.general` cierra **siempre**, y es
lo único que hay que leer para entender de quién es el dinero.

**DESPUÉS el desglose de ese `70.946,67`**, que es lo que explica por qué hoy se le paga otra
cifra:

```
Cobrado sobre lo recaudado          60.098,67     ← cobradoSobreRecaudado (CAMPO NUEVO)
Flete por rechazo + IVA             10.848,00     ← totalesIngreso.fleteDevolucionConIva
                                    ─────────
Lo que Ordenex facturó              70.946,67

Total recaudado                    285.275,00
− Cobrado sobre lo recaudado        60.098,67
= Se le paga hoy                   225.176,33     ← pagoTienda (YA EXISTÍA)
```

La diferencia entre `pagoTienda` (225.176,33) y `ganaLaTienda` (214.328,33) es **exactamente**
`fleteDevolucionConIva` (10.848,00), y no es un descuadre: son dos preguntas distintas.

- `pagoTienda` = lo que se le paga **de este dinero**. No resta el flete por rechazo porque ese
  flete **nunca entró en lo recaudado** (un rechazo no cobra COD).
- `ganaLaTienda` = lo que le queda **después** de que también le cobren aquel flete.

Sin la línea puente la cascada enseñaría «recaudado − facturado = para la tienda», que **no da
en cuanto hay un rechazo**. Por eso la puente se emite **siempre**, incluso cuando vale lo mismo
que el total: no es una línea condicional.

### El tiempo verbal del cargo a la wallet — `fleteRechazoYaCobradoATienda`

**Medido en el código:** el cargo lo emite `WalletTiendaFeedService.construirMovimientosPorTienda`
**dentro de la transacción de aprobación**, en `CierresAdminRepository.resolverCierre`, detrás de
`res.count === 1 && nuevoEstado === "aprobado"`. **Medido contra producción (2026-09-08):** de
los 37 cierres aprobados con rechazos, los 37 tienen su cargo (₡288.400); los 5 `solicitado` y el
1 `vencido`, ninguno.

En un cierre que todavía no se aprueba, **«se le cargó a su wallet» es falso**. El cierre de la
captura del humano está **Vencido**.

El booleano viaja **ya resuelto** para que la pantalla no lo infiera. `true` exige **las dos**
condiciones: cierre `aprobado` **y** flete por rechazo mayor que cero. `estado === "aprobado"` a
secas no vale: en un cierre aprobado **sin ningún rechazo** no hay cargo del que hablar, y la
frase saldría igual de falsa. `cierre.estado` sigue viajando aparte, por si la pantalla quiere
matizar entre «todavía no» y «ya no» (`rechazado`).

## La tercera línea del encargo original: SE QUITÓ, y por qué

El encargo pedía una tercera línea, «lo que el mensajero entrega» =
`recaudado − pago al mensajero − ingreso de bodega por rechazos`. **Es falsa, y no se
implementó.** Tres motivos, los tres con el código delante:

1. **La resta no ocurre en el cierre del mensajero.** `CierreBodegaService.repartirEfectivo`
   (`lib/services/CierreBodegaService.ts:96-119`) paga a los mensajeros **con el efectivo de la
   consolidación de la BODEGA**, de forma atómica y de menor a mayor; lo que no cabe **no se
   paga** y queda como `centralDebe`. Y `netoDe(general, pagado)` resta **lo efectivamente
   pagado, no lo que se debe**. Al cerrar su día, el mensajero entrega **lo que recaudó**; la
   resta ocurre después y en otro sitio.
2. **Donde ese número SÍ significa algo, ya existe y ya se ve.** `CierresBodegaAdminService`
   deriva `paraLaCentral` **por cada `cierre_dia`** con exactamente esos tres argumentos, y
   `CierresBodegaAdminModule` lo monta en la cascada del detalle. La contribución de un cierre a
   lo que la satélite entrega a la central **ya está en pantalla**, con su rótulo, su nota y su
   aviso de negativo. Repetirla en la pantalla del mensajero con otro nombre es **el segundo
   nombre para el mismo número** — justo lo que la 393 se prohibió con `CENTRAL_DEBE_LABEL`
   (D6/A8).
3. **Y en la mitad de los casos no significaría nada.** `CIERRE_DESTINO_TIPO_SEED` es
   `bodega_central | bodega_satelite`: un cierre de mensajero con destino `bodega_central` **no
   tiene satélite** que cuadre con nadie. El propio `cierre-labels.ts` ya escribió ese límite
   («en un cierre de MENSAJERO la bodega puede ser la central»). Un rótulo cuya verdad depende de
   `destinoTipo` es un rótulo condicional en una pantalla de dinero.

Dos líneas verdaderas antes que tres con una ambigua. **Y con la cuarta línea añadida después
(`ganaLaTienda`), la pregunta «qué plata es para quién» queda contestada entera sin ella.**

`lib/utils/ingreso-ordenex.ts` **no ganó ninguna función hermana** por este motivo: la única que
se añadió es `ganaLaTienda`, para la cuarta línea. Ninguna función existente se tocó.

## Archivos

**Modificados**

- `lib/utils/ingreso-ordenex.ts` — **solo** se AÑADE `ganaLaTienda(totalGeneral, ingresoTotal)`,
  al lado de sus hermanas y con su docstring diciendo qué la distingue de `pagoTiendaOrdenex`.
  Ninguna función existente se modificó.
- `lib/interfaces/services/ICierresAdminService.ts` — los cuatro campos nuevos en
  `CierreDetalleAdminServiceResult`, con su contrato escrito.
- `lib/services/CierresAdminService.ts` — `verCierreDetalle` los deriva. Reusa
  `cobradoSobreRecaudado`, `netoOrdenex` y `ganaLaTienda`; los snapshots salen del `resumen` del
  propio cierre (leídos, no recomputados).
- `tests/unit/services/cierres-admin-service.test.ts` — la suite nueva (11 casos).
- 7 archivos de `tests/components/**` — sus fixturas del detalle ganan los cuatro campos. **No se
  relajó ni una aserción**: solo se amplió el objeto que el DTO exige. La única fixtura con
  importes reales (`pagoTienda: "21327.50"`) lleva su `cobradoSobreRecaudado: "3672.50"`
  calculado, no un cero inventado.

**Creados**: `progress/impl_395.md` (este archivo).

**No tocados**: `feature_list.json`, `progress/current.md`, componentes, páginas, layouts,
migraciones.

## Mapa requisito → test

No hay spec, así que el mapa va contra los puntos del encargo. Todos en
`tests/unit/services/cierres-admin-service.test.ts`, describe
`395 — el detalle del cierre de MENSAJERO emite la linea puente y el neto`.

| requisito | test |
| --- | --- |
| La puente se emite SIEMPRE, también con flete por rechazo `"0.00"` | `SIN rechazos: la linea puente se emite IGUAL, no desaparece cuando el flete por rechazo es 0.00` |
| La puente NO es el total facturado, y es la que hace cuadrar el pago a la tienda | `CON un rechazo: la puente NO es el total facturado, y es la que hace cuadrar el pago a la tienda` |
| El neto resta TAMBIÉN la bodega; no es `ganancia` ni se encadena con ella | `CON un rechazo: el neto resta TAMBIEN el ingreso de bodega, y por eso no es la ganancia` |
| Neto y ganancia coinciden con la bodega en `"0.00"` (nadie resta dos veces) | `SIN rechazos: la linea puente se emite IGUAL…` (última aserción) |
| El neto negativo sale con su signo, nunca recortado | `el neto NEGATIVO sale con su signo, nunca recortado a 0.00` |
| `ganaLaTienda` no es `pagoTienda`, y difieren en el flete por rechazo | `CON un rechazo: lo que la tienda GANA no es lo que se le PAGA, y difieren en el flete por rechazo` |
| La identidad `ganaLaTienda + facturado === recaudado` | mismo test (aserción de la identidad) |
| Sin rechazos, `ganaLaTienda === pagoTienda` | `SIN rechazos: lo que gana y lo que se le paga coinciden EXACTAMENTE` |
| `ganaLaTienda` negativo sale con su signo | `puros rechazos: lo que gana la tienda sale NEGATIVO, con su signo` |
| El cargo a la wallet YA ocurrió (aprobado + rechazo) | `aprobado y CON flete por rechazo: el cargo YA ocurrio` |
| El cargo NO ha ocurrido (`solicitado`/`vencido`/`rechazado`) | `%s y CON flete por rechazo: el cargo NO ha ocurrido todavia` (3 casos) |
| Aprobado sin rechazos: no hay cargo del que hablar | `aprobado pero SIN un solo rechazo: no hay cargo del que hablar` |
| `ganancia` y `pagoTienda` no se tocan | los casos previos de `verCierreDetalle — ingreso y ganancia`, intactos |

## Gate — `./init.sh` completo

El rápido se niega solo con este diff (nombres de dinero en `lib/`), así que se corrió el
completo. `INIT_EXIT` escrito **dentro** del log, sin `tail`.

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes
✓ feature_list.json: sin ids duplicados (390 fichas), cupo por zona respetado (in_progress=1) y specs en su sitio
-> pnpm run typecheck
✓ typecheck paso
-> pnpm run lint
✓ lint paso
✓ DATABASE_URL resuelta: los 141 archivos de tests contra Postgres SI se ejecutan

 Test Files  1811 passed (1811)
      Tests  25970 passed | 26 skipped (25996)

✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1811 ejecutado(s), todos en el baseline conocido)
INIT_EXIT=0
```

Los **26 skipped** son los conocidos. Se copió el `.env` de la raíz antes del gate (por eso los
141 archivos contra Postgres SÍ se ejecutaron) y se borró antes de commitear.

## Mutaciones — 6 aplicadas, 6 muertas

Arnés con autocomprobación (`scratchpad`, borrado tras usarlo): corrida de **control** verde
antes de medir; el sustituidor **aborta** si el texto no aparece **exactamente una vez**; se
exige haber **visto** la línea de resultados de vitest (sin ella, «no hubo fallo» puede ser «no
corrió nada»); y se restaura **copiando el original y comparando con `diff`**.

| # | mutación | resultado |
| --- | --- | --- |
| 1 | la línea puente **se omite** cuando el flete por rechazo es cero | **ROJO** — `expected { status: 'ok', …(11) } to have property "cobradoSobreRecaudado"` (2 tests) |
| 2 | el neto se implementa **encadenando la ganancia** (sin restar la bodega) | **ROJO** — `expected '1372.80' to be '922.55'` (2 tests) |
| 3 | el neto se **recorta a cero** en vez de salir con su signo | **ROJO** — `expected '0.00' to be '-1950.60'` |
| 4 | `ganaLaTienda` se confunde con `pagoTiendaOrdenex` | **ROJO** — `expected '16383.91' to be '15027.40'` (2 tests) |
| 5 | el booleano del cargo se implementa como `estado === "aprobado"` **a secas** | **ROJO** — `expected true to be false` |
| 6 | `ganaLaTienda` se **recorta a cero** en vez de salir con su signo | **ROJO** — `expected '0.00' to be '-1356.51'` |

`MUTACIONES_FALLIDAS=0`, y la suite vuelve a verde tras restaurar (85 passed).

## Veredicto

Cuatro campos nuevos en el detalle del cierre de mensajero, derivados con las funciones que ya
existían, gate completo en verde (`INIT_EXIT=0`, 26 skipped conocidos) y 6 de 6 mutaciones
muertas; la tercera línea del encargo original se quitó por falsa, con su motivo medido.
