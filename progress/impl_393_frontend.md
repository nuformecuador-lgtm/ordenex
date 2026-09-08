# Ficha 393 — bitácora de implementación (LA PANTALLA)

> Rama `feat/393-cierre-bodega-dos-cascadas-frontend`, base `d2ada2ef` (la mitad de servidor ya
> mergeada en `dev`, PR #737).
> Agente: **frontend_dev**. Alcance entregado: **F1–F7 · G1–G3 · la re-exportación pendiente de C1**.
> No se tocó ni un servicio, ni un repositorio, ni el mapper, ni un contrato, ni la base.

---

## Lo que había que hacer, y qué encontré hecho

La mitad de servidor dejó el contrato publicado y medido (`progress/impl_393.md`). Lo que faltaba
—y es lo único que el humano ve— era la pantalla. Dos avisos del backend, los dos ciertos:

1. **Las trece constantes no estaban re-exportadas** desde `cierre-detalle-shared.tsx`. Hecho: una
   línea en el bloque de importación y otra en el `export {}` que ese archivo ya tenía desde la
   tanda E de la 170. Ninguna constante cambia de valor.
2. **F7 no tenía trabajo.** Lo verifiqué yo mismo antes de darlo por bueno: `grep` de los cinco
   `aria-label` retirados (`"Ingreso bruto del cierre de bodega"`, `"Pago a mensajeros del cierre
   de bodega"`, `"Ganancia del cierre de bodega"`, `"Ingreso de bodega por rechazos del cierre de
   bodega"`, `"Pago a tienda del cierre de bodega"`) y de sus gemelos `· <mensajero>` en todo
   `tests/` → **cero apariciones**; y de `INGRESO_BRUTO_LABEL`, `GANANCIA_LABEL`,
   `PAGO_TIENDA_LABEL`, `INGRESO_BODEGA_RECHAZOS_LABEL` en `tests/` → **cero**. **F7 se cierra sin
   trabajo, con el motivo medido y no heredado.**

---

## MCP `codebase-memory`

Disponible en esta sesión y usado: `search_graph` localizó `HojaResumen` (`cierre-factura.tsx:596`),
`CierreBodegaFacturaResumen` (`:800`) y los dos listados de bodega. **Los cinco símbolos se
confirmaron después EN EL ARCHIVO REAL** antes de tocarlos, como manda la regla 7: el índice
devuelve de más.

---

## Archivos

### Nuevos

| Archivo | Qué es |
| --- | --- |
| `app/(app)/cierres-admin/_components/CascadaDinero.tsx` | **F1** — el componente de una cascada. Sin aritmética. |
| `tests/components/CascadaDinero.test.tsx` | **F2** — 9 casos. |
| `tests/components/CierreBodegaTarjetaCascada.test.tsx` | **F4** — 12 casos (9 de la tarjeta + 3 de las otras tres superficies). |
| `tests/components/CierreBodegaDetalleCascadas.test.tsx` | **F6** — 16 casos. |
| `tests/unit/guards/cierre-bodega-vocabulario.guardia.test.ts` | **G2** — guardia perenne del vocabulario, 8 casos (4 de autocomprobación). |
| `tests/unit/guards/cascada-central-en-las-dos-pantallas.guardia.test.ts` | **G3** — la red perenne de R38, 11 casos (3 de autocomprobación). |

### Modificados

| Archivo | Qué cambia |
| --- | --- |
| `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx` | **C1** (la mitad que faltaba): re-exporta las trece constantes. Y promueve el rótulo «Total general» de valor por defecto a constante `TOTAL_GENERAL_LABEL` (D5). **Ni un texto pintado cambia.** |
| `app/(app)/cierres-admin/_components/cierre-factura.tsx` | **F3**: prop opcional `cascadaCentral` en `HojaResumen`, columna del medio condicionada, `LineaMonto` gana `resta`/`destacado` (opcionales, sin efecto por defecto) y `CierreBodegaFacturaResumen` pasa la prop. |
| `app/(app)/cierres-admin/_components/CierresBodegaAdminModule.tsx` | **F5**: las dos cascadas —B primero— en el agregado y en cada `cierre_dia`; se dejan de montar las cinco tarjetas sueltas. |
| `tests/components/DineroIdentidadesEnPantalla.test.tsx` | **G1**: dos casos nuevos en la Parte B (B4 tarjeta, B5 detalle) con las cuatro identidades leídas del DOM, y el censo de la Parte D pasa de 13 a 15. |

**Lo que NO se tocó:** ni `lib/`, ni `db/`, ni un contrato, ni las otras tres superficies del
comprobante, ni `ConsolidacionBodegaModule.tsx`, ni `CierresAdminModule.tsx`.

> ### ⛔ CORRECCIÓN (2026-09-08) — esta frase era falsa DOS VECES
>
> Lo que decía aquí, y se deja escrito para que se vea qué pasó:
>
> > «`MontoDerivadoCard`, `PagoMensajeroTotal` e `IngresoBodegaRechazosTotal` **siguen exportados
> > y siguen montados por el detalle del cierre de mensajero** (R30).»
>
> Lo medido, `git grep` en `app`, `lib`, `components` y `tests`:
>
> 1. **`MontoDerivadoCard` no lo monta NADIE.** `git grep` devuelve **sólo su declaración**
>    (`cierre-detalle-shared.tsx:626`) y la regex de la guardia G2. Antes de la ficha tenía
>    exactamente un consumidor —`CierresBodegaAdminModule.tsx`, 6 usos— y las cinco tarjetas
>    sueltas que esta ficha retira eran esos seis usos. **Queda muerto**, y se declara aquí abajo
>    junto a `GANANCIA_NOTA_BODEGA` para que dentro de un año no parezca un misterio.
> 2. **A los otros dos no los monta el detalle del cierre de mensajero, sino
>    `ConsolidacionBodegaModule.tsx` (`:342` y `:349`)** — la pantalla de consolidación de la
>    satélite. El detalle del cierre de mensajero usa `TarjetaTotal`/`Renglon`, que viven en
>    `cierre-factura.tsx`. Lo que sí es cierto, y es lo que R30 protege: **los tres siguen
>    exportados y no se borra ninguno**.
>
> Lo encontró el reviewer. Lo que la frase escondía no era un defecto del código —R30 no se rompe,
> el detalle del mensajero está intacto y sus tests lo prueban— sino un **criterio de HECHO de F5
> escrito contra una premisa falsa**, que ya está corregido en `tasks.md`.

---

## Cómo se ve el negativo en pantalla

Es la pregunta que el informe del backend no pudo contestar, porque no había pantalla. Contestada
y **medida con dos mutaciones** (M13F y M13T):

- **El rótulo NO cambia.** Sigue diciendo **«Para la central»**, con signo, en las dos superficies
  (D6: una cifra, un nombre).
- **El importe se pinta `-₡1.000,05`**: el signo delante del símbolo, que es como lo emite el
  formateador compartido para cualquier importe negativo de la app. Ni `₡0`, ni `₡1.000,05`, ni
  ausente.
- **Va en `text-danger-strong`** —el rojo del tema, ya censado por `factura-contraste.guardia`
  (par P11)— y **sólo el resultado**: un sustraendo grande no se tiñe, para no gastar la señal.
- **Debajo, su nota**: *«Los descuentos superan lo recaudado en este cierre: la satélite no
  entrega nada y la central pone la diferencia.»* Sin ella, un `−₡1.000` en una pantalla de dinero
  es peor que no tener el número.
- **Y no se trata como un fallo**: no hay `try`, ni aviso de error, ni se oculta la fila. Es el
  camino normal, porque el caso es normal: medido contra producción el 2026-09-08, **1 de 14
  cierres** ya lo tenía negativo.

Lo mismo vale para **«Neto de Ordenex»** negativo en el detalle (R11).

---

## Decisiones que tomé YO (no el humano, no el diseño)

| # | Decisión | Por qué | Vuelta atrás |
| --- | --- | --- | --- |
| **FE1** | El operador (`-`/`+`) va **pegado al importe**: `-₡14.000,55`, `+₡0`. | La cadena queda con la forma exacta de un importe con signo, así que la guardia de identidades de la 359 puede leer las cuatro líneas del DOM y comprobar que **la resta da** (R6-R9). Con el signo en otro nodo, eso no se puede comprobar. | Sacar el operador a su propio `<span>` y adaptar los parseadores. |
| **FE2** | Restar un importe que **ya viene negativo** invierte el operador y pinta el importe sin su signo (`+₡250,25` en vez de `--₡250,25`). | Restar un negativo suma. Con los datos de hoy no pasa —los tres sustraendos son snapshots de pagos—, pero `--₡1.000` sería ilegible y `-₡1.000` bajo un rótulo de resta diría lo contrario de lo que ocurre. Es una regla sobre el **texto**, no aritmética. | Quitar la inversión y aceptar el doble signo. |
| **FE3** | El tono de atención (`text-danger-strong`) es **sólo de las líneas destacadas** (los resultados). | Un sustraendo no es un resultado. Teñir de rojo cada descuento gastaría la señal justo donde hace falta. | Aplicarlo a cualquier línea negativa. |
| **FE4** | `TOTAL_GENERAL_LABEL`: el rótulo del total del detalle pasa de valor por defecto a constante compartida. | D5 dice que la primera línea de las dos cascadas **reusa** ese rótulo. Escribirlo dos veces —una en `TotalesPanel` y otra en el módulo de bodega— dejaba abierta la puerta a que se separaran, que es justo lo que R24 prohíbe. **Ni un carácter de lo pintado cambia.** | Volver al literal en la firma. |
| **FE5** | Las notas de una línea son **un array**, no una cadena unida. | Un resultado negativo lleva su nota **además** de la fija, y el caso del efectivo puede sumar una tercera. Fundidas en un párrafo, ni quien lee ni un test pueden distinguir cuál está puesta. Lo descubrí porque F6 se puso rojo al buscarlas por separado. | Volver a `nota?: string`. |
| **FE6** | `ConsolidacionBodegaModule.tsx` **NO** es «una superficie del cierre de bodega» para la guardia G2. | Esa pantalla enseña los agregados de los `cierre_dia` que **todavía no están consolidados**: ahí no hay cierre de bodega, y sus tarjetas de pago al mensajero, ingreso de bodega y «Central debe» hablan de otra cosa. Incluirla pondría roja la guardia por un motivo legítimo, que es la forma más rápida de que una guardia se acabe ignorando. El listado que esa pantalla monta —el de los solicitados— **sí** está censado, en su propio archivo. | Incluirla y acotar el censo por bloques dentro del archivo. |
| **FE7** | El nombre accesible de cada cascada lleva su ámbito (`… · cierre de bodega`, `… · Ana Mensajera`); el **rótulo visible** es el mismo en todas. | El modal monta las mismas dos cascadas una vez por `cierre_dia`, y sin ámbito todas las regiones se llamarían igual. Es el patrón que este módulo ya usaba (`Totales · <mensajero>`). R23 habla del **rótulo**, y el rótulo no cambia. | Un nombre accesible único global. |

---

## Una corrección de lectura, dicha en voz alta

`tasks.md § F6` pide un caso 2 que diga «**ninguna línea aparece en las dos regiones** (R2)».
**Tomado al pie de la letra, ese caso contradice el propio diseño**: `design.md §3` y `§4` ponen
«Pago al mensajero» y «Gana la bodega satélite» como sustraendos de **las dos** cascadas a
propósito —el mismo dinero contestando dos preguntas distintas—.

Lo que R2 dice es otra cosa: *«NO DEBE mezclar líneas de las dos cascadas **en una misma
región**»*. Así que el caso afirma lo que R2 pide de verdad: las dos regiones son **subárboles
disjuntos** del DOM y **ninguna contiene el resultado de la otra** (ni «Para la tienda», ni «Neto
de Ordenex», ni la línea puente dentro de la cascada B; ni «Para la central» dentro de la A).
Escrito así en el propio test, con el porqué.

---

## Trazabilidad `R<n> → test` — la mitad de pantalla

| R | Test |
| --- | --- |
| R1 | `CierreBodegaDetalleCascadas` › «son DOS regiones distintas, con nombres accesibles distintos» |
| R2 | `CierreBodegaDetalleCascadas` › «ninguna región mezcla el resultado de la otra: son subárboles disjuntos» |
| R3 | `CierreBodegaDetalleCascadas` › «"Para la tienda" y "Neto de Ordenex" están, y están DESTACADOS» |
| R4 | `CierreBodegaDetalleCascadas` › «"Para la central" está, DESTACADO…» · `CierreBodegaTarjetaCascada` › «las CUATRO líneas están…» |
| R5 | `CascadaDinero` › «cada línea sustraendo se pinta con su signo» · `CierreBodegaTarjetaCascada` › caso de las cuatro líneas |
| R6 | `DineroIdentidadesEnPantalla` › **B5 · R6** (DOM) · `CierreBodegaDetalleCascadas` › «las TRES restas dan» |
| R7 | `DineroIdentidadesEnPantalla` › **B5 · R7** (DOM) · `CierreBodegaDetalleCascadas` › «la LÍNEA PUENTE explica la diferencia exacta» |
| R8 | `DineroIdentidadesEnPantalla` › **B5 · R8** (DOM) · `CierreBodegaDetalleCascadas` › «las TRES restas dan» |
| R9 | `DineroIdentidadesEnPantalla` › **B4** y **B5 · R9** (DOM) · `CierreBodegaTarjetaCascada` › «la resta CIERRA leyendo el DOM» |
| R10 | `CierreBodegaDetalleCascadas` › «la línea puente sale TAMBIÉN con el flete por rechazo en cero» |
| R11 | `CierreBodegaDetalleCascadas` › «un "Neto de Ordenex" NEGATIVO se pinta con signo y marcado como deuda» · `CascadaDinero` › «un resultado NEGATIVO…» |
| R13 | `CascadaDinero` › «NO altera el importe que recibe» · `CierreBodegaTarjetaCascada` › «el resultado LLEGA en la prop» |
| R14 (pantalla) | `cierre-bodega-vocabulario.guardia` › «money-safe: el navegador no hace aritmética de dinero» |
| R18 | `CierreBodegaTarjetaCascada` › «las CUATRO líneas están, y la resta CIERRA leyendo el DOM» |
| R19 | `CierreBodegaTarjetaCascada` › «la columna del medio deja de llamarse "Ajustes"» · `cierre-bodega-vocabulario.guardia` › «ninguna superficie … dice "Ajustes"» |
| R20 | `CierreBodegaTarjetaCascada` › «el resultado LLEGA en la prop: la tarjeta no lo calcula» (canario `77777.77`) |
| R21 | `CierreBodegaTarjetaCascada` › los tres casos de «las OTRAS TRES superficies, intactas» · `cascada-central-en-las-dos-pantallas.guardia` › «no recibe `cascadaCentral`» |
| R23 | `CierreBodegaDetalleCascadas` › «"Para la central" … con la misma cifra que la tarjeta» y «cada `cierre_dia` trae SUS dos cascadas, con los MISMOS rótulos» |
| R24 | `CierreBodegaDetalleCascadas` › «NO queda ninguna tarjeta suelta…» · `cierre-bodega-vocabulario.guardia` › «ninguna cifra que ya es LÍNEA de una cascada vuelve como tarjeta suelta» |
| R25 | `CierreBodegaDetalleCascadas` › «la nota de "Gana la bodega satélite"…» (el rótulo es `GANA_BODEGA_SATELITE_LABEL` en las dos cascadas) |
| R26 | `CierreBodegaTarjetaCascada` › «la nota dice de qué resta sale, bajo el resultado» |
| R27 | `CierreBodegaDetalleCascadas` › «la nota de "Gana la bodega satélite" dice que NO es un movimiento de caja» |
| R29 | `CierreBodegaDetalleCascadas` › «el panel de totales por método sigue EXACTAMENTE igual» |
| R30 | `CierresAdminModule.tsx` y `CierreFacturaPapel.test.tsx` sin editar (V3) · **M9** |
| R32 | `CascadaDinero` › «es una región con nombre accesible PROPIO» · `CierreBodegaDetalleCascadas` › caso 1 |
| R33 | `cierre-bodega-vocabulario.guardia` › «el MISMO extractor encuentra los rótulos NUEVOS» (todo el texto sale de constantes del módulo puro) |
| R34 | `CierreBodegaDetalleCascadas` › «NO queda ninguna tarjeta suelta…» · `cierre-bodega-vocabulario.guardia` |
| R35 | `cierre-bodega-vocabulario.guardia` › «ninguna superficie del cierre de bodega dice "Ajustes"» + su autocomprobación |
| R36 (pantalla) | `CierreBodegaTarjetaCascada` › «un "Para la central" NEGATIVO se pinta con su signo, en rojo y con su nota» · `CierreBodegaDetalleCascadas` › «…lleva su signo, su tono y SU NOTA» · `CascadaDinero` › «un resultado NEGATIVO…» |
| R37 (pantalla) | `CierreBodegaTarjetaCascada` › «el aviso del EFECTIVO sale con un resultado POSITIVO» y «con el efectivo cubriendo…, el aviso NO aparece» · `CierreBodegaDetalleCascadas` › «la nota del EFECTIVO aparece sólo cuando…» |
| R38 | `CierreBodegaTarjetaCascada` › «la satélite y el maestro ven el MISMO rótulo y el MISMO valor» · `cascada-central-en-las-dos-pantallas.guardia` (las tres rutas) |
| R39 | `CierreBodegaTarjetaCascada` › «la tarjeta NO enseña el margen de Ordenex» · `CierreBodegaDetalleCascadas` › caso de las regiones disjuntas |

**R12, R15, R16, R17, R22, R28, R31** son de servidor y están cubiertos por la mitad de
`progress/impl_393.md`. R15/R16 tienen además media red aquí:
`CierreBodegaDetalleCascadas` › «cada `cierre_dia` trae SUS dos cascadas» y «la suma de los días da
el agregado, AL CÉNTIMO, sin que nadie corrija nada».

---

## Mutaciones — medidas, con la línea de fallo copiada del log

Aplicadas al **árbol real**; abortan si el texto a mutar no aparece **exactamente una vez**;
restauradas **desde copia** (nunca `git checkout`) y **releídas** para comprobar que el archivo
volvió byte a byte. El arnés **exige evidencia de ejecución**: si la salida de vitest no trae una
línea `Tests …`, el resultado se marca SIN-EJECUTAR y no cuenta como superviviente — este árbol ya
se comió un arnés que reportó 9/9 supervivientes sin haber corrido un test.

| # | Mutación | Rojo medido |
| --- | --- | --- |
| **M4** | quitar la línea puente cuando el flete por rechazo vale `"0.00"` | **1 rojo.** F6 › «la línea puente sale TAMBIÉN con el flete por rechazo en cero (R10)» — `Unable to find an element with the text: Cobrado sobre lo recaudado`. |
| **M7** | `CascadaDinero` compone el monto con `Number(monto).toFixed(2)` | **1 rojo.** G2 › «money-safe…» — `expected [ …(2) ] to deeply equal []`. ⚠️ **F2 NO cae, y lo medí:** dentro del dominio real (`DECIMAL(12,2)`) el viaje por `double` es EXACTO —lo comprobé con 200.000 importes aleatorios de hasta 12 dígitos: **cero pérdidas**—, así que la mutación es un no-op en lo pintado. Lo que la mata es la guardia que lee el código, que es exactamente para lo que existe R14. |
| **M8** | pintar «Ajustes» también cuando `cascadaCentral` está presente | **9 rojos.** F4 (8) + G2 — `Unable to find an accessible element with the role "region" and name "Lo que va a la central"`. |
| **M9** | pasar `cascadaCentral` también desde `CierreFacturaResumen` (mensajero) | **2 rojos.** F4 › «cierre de mensajero del admin sigue pintando "Ajustes"» y G3 › «sólo la tarjeta de bodega pasa la prop». |
| **M10** | la lista del satélite deja de pasar el campo derivado (lo pone en `"0.00"`) | **2 rojos.** F4 › «la satélite y el maestro ven el MISMO rótulo y el MISMO valor (R38)» y G3 › «…le pasa a la tarjeta el `cierre` del servidor, no un literal». |
| **M11** | volver a montar la tarjeta suelta «Pago a tienda» junto a la cascada A | **2 rojos.** F6 › «NO queda ninguna tarjeta suelta…» y G2 › «ninguna cifra que ya es LÍNEA de una cascada vuelve como tarjeta suelta». |
| **M12** | fundir las dos cascadas en una sola región | **16 rojos** (F6 entero) — `Found multiple elements with the role "region" and name "Lo que va a la central · cierre de bodega"`. |
| **M13F** | **la PANTALLA esconde el negativo bajo un valor absoluto** (la mitad de A7 que me toca) | **3 rojos.** F2 › «un resultado NEGATIVO…», F6 › «un "Para la central" NEGATIVO…» y F6 › «un "Neto de Ordenex" NEGATIVO…» — `Unable to find an element with the text: -₡1.000,05`. |
| **M13T** | la TARJETA esconde el negativo bajo un valor absoluto | **1 rojo.** F4 › «un "Para la central" NEGATIVO se pinta con su signo, en rojo y con su nota» — `expected '₡1.000,05' to be '-₡1.000,05'`. |
| **M16** | montar una línea de la cascada A («Para la tienda») también en la tarjeta | **1 rojo.** F4 › «la tarjeta NO enseña el margen de Ordenex (R39)» — `expected 'OrdenexCierre de bodega#B1B1B1B1…' not to contain 'Para la tienda'`. |
| **M17** | cuadrar los importes al colón antes de pintarlos (la regla de la 230) | **13 rojos**, incluidos **los cuatro casos de identidad de G1** (B5 · R6, R7, R8 y B5 · R9) y los de F6. |

**Lo que M7 me encontró, y es el motivo de correr mutaciones.** Yo había escrito en F2 el caso «NO
altera el importe que recibe (R13/R14)» dando por hecho que mataba un `Number(...)`. **No lo mata**,
y no por un descuido del test: dentro del dominio real de esta app —`DECIMAL(12,2)`— el viaje por
`double` y vuelta es **exacto**. Lo medí en vez de suponerlo: 200.000 importes aleatorios de hasta
12 dígitos con dos decimales, **cero pérdidas**; el primer contraejemplo aparece en 14 dígitos
(`99999999999999.99 → 99999999999999.98`), que el esquema no puede almacenar. Conclusión honesta:
**R14 en el navegador lo sostiene la guardia que lee el código (G2), no una aserción sobre un
número pintado** — y eso es exactamente por lo que este repo tiene guardias que recorren el árbol.
El caso de F2 se queda porque sí mata otras cosas (un redondeo al colón, un formateador propio),
pero **no se le atribuye una cobertura que no tiene**.

> ### ⛔ CORRECCIÓN (2026-09-08) — esa conclusión era cierta A MEDIAS, y la mitad falsa era la que importaba
>
> La frase de arriba **se queda escrita**, porque el razonamiento es correcto y la medición de los
> 200.000 importes también. Lo que estaba mal es el alcance: **la guardia no leía el archivo donde
> la TARJETA pinta el dinero.**
>
> `cierre-bodega-vocabulario.guardia` recortaba dos trozos de `cierre-factura.tsx` (la `<section>`
> de la cascada y el cuerpo de `CierreBodegaFacturaResumen`). **`LineaMonto` y `conOperador`
> —líneas 441-495, la función que formatea CADA línea de dinero de la cascada B en la tarjeta—
> quedaban FUERA de los dos trozos**, y por tanto fuera del barrido money-safe.
>
> La mutación que lo demostró (**MR1b**, del reviewer): `money(String(Number(monto)))` en el
> importe de «Para la central» dejaba **197 archivos de guardias y 2914 tests en verde**. La única
> red que llegaba ahí era la guardia de la ficha 359, que sólo persigue `.toFixed(`.
>
> Así que la conclusión honesta, corregida: era cierta para `CascadaDinero.tsx` —censado entero— y
> **falsa para la tarjeta**, que es justo la superficie que la satélite ve y la única que R38 exige
> en dos pantallas.
>
> **Arreglado el 2026-09-08:** el barrido money-safe de G2 lee ahora `cierre-factura.tsx` **entero**
> (`SUPERFICIES_MONEY_SAFE`), con un caso de autocomprobación que afirma las dos mitades —que los
> trozos NO alcanzan a `LineaMonto`/`conOperador` y que el barrido SÍ—. El censo del vocabulario
> sigue leyendo los dos trozos, y esa asimetría está razonada en el docstring: las otras tres
> superficies del comprobante dicen «Ajustes» a propósito (R21), pero la prohibición de hacer
> aritmética de dinero no tiene excepción por superficie. **MR1b re-medida contra el árbol real:
> `Tests 1 failed | 23 passed (24)` — MUERE.**

**Lo que la escritura de F6 me encontró.** Las tres notas del resultado salían en un solo nodo de
texto, así que `getByText` de cada una fallaba. No era un problema del test: era un problema de la
pantalla —quien la lee no puede distinguir cuál nota está puesta—. De ahí sale FE5.

---

## Verificación

- **V1 · `./init.sh` COMPLETO** (no `--rapido`: se niega solo, el diff toca `cierre` y `factura`,
  nombres de dinero). Log propio, sin `tail` en la tubería, con `INIT_EXIT=$?` escrito **dentro**
  del log y en su propia línea. **`.env` copiado de la raíz antes de correrlo** y **borrado antes
  de commitear**: sin él, ~134 archivos de `tests/integration/db` se SALTAN y el gate diría «OK»
  sin haber tocado la capa de datos.

  - `✓ feature_list.json: sin ids duplicados (388 fichas), cupo por zona respetado (in_progress=2)
    y specs en su sitio`
  - `✓ typecheck paso` · `✓ lint paso` (**0 errores**, 161 warnings, **todos preexistentes**: el
    mismo número que midió la mitad de servidor).
    ⛔ **CORRECCIÓN (2026-09-08):** aquí decía además «**y ni uno en un archivo de este diff**
    (comprobado por nombre de archivo)», y eso **no es exacto**.
    `tests/components/DineroIdentidadesEnPantalla.test.tsx` **está** en el diff y **tiene uno**
    (`Unused eslint-disable directive`). Lo midió el reviewer restaurando el archivo base y
    pasándole eslint: el warning **ya estaba** (en la línea 476 de la versión previa), así que
    **no se introdujo ninguno** y el total sigue en 161. Lo que estaba mal era la frase, no el
    código: lo cierto es «**ni un warning NUEVO**», que es una afirmación distinta y más débil.
  - **`✓ DATABASE_URL resuelta: los 134 archivos de tests contra Postgres SI se ejecutan`** — la
    línea que hay que citar: sin ella el gate termina verde sin haber tocado la capa de datos.
  - `Test Files  1786 passed (1786)`
  - `Tests  25558 passed | 26 skipped (25584)` · `Duration  674.02s`
  - `✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1786 ejecutado(s), todos en el baseline
    conocido)`
  - `! migraciones sin down.sql: 20260814120000_… 20260814140000_… 20260814160000_…` → **aviso
    preexistente**, de tres migraciones de ruta de agosto; esta mitad no añade ninguna migración
    (ni toca `db/`).
  - `✓ .env presente` · `== init OK ==` · **`INIT_EXIT=0`** (leído de DENTRO del log, en su
    propia línea).
  - **Los 26 `skipped`, contados y explicados:** 17 en `tests/components/AnaliticaPage.test.tsx` y
    9 en `tests/components/AnaliticaShell.test.tsx`, escritos con `describe.skip`/`it.skip` en el
    propio archivo, de Analítica y anteriores a esta ficha. **Ninguno se salta por falta de
    `DATABASE_URL`** — eso lo descarta la línea de arriba. **Cero `skipped` míos.**

- **V3 · de los nueve archivos de T0.6 se editó UNO**: `DineroIdentidadesEnPantalla.test.tsx`, que
  es exactamente la ampliación declarada de **G1**. Los otros ocho, intactos y verdes —incluidas
  `factura-contraste.guardia` (**G4**) y `cierre-detalle-superficies.guardia` (**G5**), verdes
  **sin editarlas**. Medido: los nueve daban **140 passed** antes de mi trabajo y **145 passed**
  después (+5 son los casos nuevos de G1, en el único archivo de la lista que se editó).

  Que `factura-contraste` siga verde **sin tocarla** no es suerte: esa guardia congela el
  **conjunto** de utilidades no cromáticas de `cierre-factura.tsx` y cierra el inventario de pares
  (tinta, fondo). La cascada de la tarjeta **no estrena ni una clase**: reusa `LineaMonto`,
  `TituloColumna`, `border-t`, `pt-2`, `text-xs`, `font-semibold`, `text-muted-foreground`,
  `text-foreground` y `text-danger-strong` (par **P11**), todas ya censadas.

- **V4 · sin migración**: `git diff --name-only -- db/` → **vacío**. Esta mitad no toca ni `lib/`.

- **V2 · verificación en la app real: HECHA el 2026-09-08.** Ver la sección siguiente. Lo que
  había aquí antes —«PENDIENTE, falta que una persona lo mire»— se cierra con la app levantada y
  conducida, no con jsdom.

---

## V2 — la pantalla, mirada (2026-09-08)

**Cómo, para que se pueda repetir.** Servidor propio en el **puerto 3021** y `.next` propio (el
worktree es su propio directorio, así que no comparte `.next` con nadie: dos `pnpm dev` sobre la
misma carpeta se tumban). Base local **sembrada** con dos usuarios propios —`admin.393` y
`satelite.393`, para **no rotar las cuentas QA de nadie**— y dos cierres de bodega en la zona GAM;
**todo restaurado al terminar** (`cierre_bodega` vuelve a 0, los `cierre_dia` vuelven a estar sin
consolidar, los usuarios y su rastro de sesión borrados). El OTP se lee del log del servidor
(`asunto="Tu codigo de verificacion: NNNNNN"`), que es la vía que este repo ya tiene medida.

### 1 · La tarjeta de la SATÉLITE (`adminSatelite`, pestaña Bodega → Solicitados)

Texto copiado de la pantalla, no parafraseado:

```
LO QUE VA A LA CENTRAL
Total                      ₡1.234,50
Pago al mensajero         -₡2.000
Gana la bodega satélite   -₡234,55
Para la central           -₡1.000,05
  Lo recaudado menos el pago a los mensajeros y menos lo que gana la bodega satélite por los rechazos.
  Los descuentos superan lo recaudado en este cierre: la satélite no entrega nada y la central pone la diferencia.
  El efectivo recaudado no cubre los descuentos: parte de lo recaudado entró por SINPE o transferencia.
```

- La columna del medio **dice «Lo que va a la central»**, no «Ajustes» (R19). ✔
- **La resta da sumando a mano**: 1.234,50 − 2.000,00 − 234,55 = **−1.000,05**. ✔
- **NO aparece** «Para la tienda» ni «Neto de Ordenex» en la tarjeta (R39). ✔
- El HTML del resultado, leído del DOM (el tono se comprueba por la clase, no por el píxel):
  `<span class="tabular-nums font-semibold text-danger-strong">-₡1.000,05</span>`. **Sólo el
  resultado va en rojo**; los sustraendos, no.

### 2 · El caso NEGATIVO, que era la pregunta

Sale **`-₡1.000,05`**, con el signo delante del símbolo, en `text-danger-strong`, **con sus tres
notas debajo** y **sin tratarse como un fallo**: no hay aviso de error, no se oculta la fila, y los
botones **Aprobar / Rechazar** del detalle siguen ahí como en cualquier otro cierre. El rótulo
**no cambia** por ser negativo: sigue diciendo «Para la central».

### 3 · El maestro ve el MISMO número (R38)

En `/cierres-admin` → Bodega, la misma tarjeta `#ADB5F3AF` pinta **`-₡1.000,05`**, carácter por
carácter lo mismo que la satélite. Y la otra, `#023D5E37`: `140.400 − 13.600 − 0 = **₡126.800**`. ✔

### 4 · El detalle: las dos cascadas, separadas

```
Lo que va a la central          De quién es el dinero
Total general   ₡1.234,50       Total general        ₡1.234,50
Pago al mensajero  -₡2.000      Flete + IVA               -₡0
Gana la bodega sat. -₡234,55    Comisión + IVA            -₡0
Para la central -₡1.000,05      Para la tienda      ₡1.234,50
                                Cobrado sobre lo recaudado ₡0
                                Flete por rechazo + IVA   +₡0
                                Lo que Ordenex facturó     ₡0
                                Pago al mensajero     -₡2.000
                                Gana la bodega sat.   -₡234,55
                                Neto de Ordenex     -₡2.234,55
```

Las tres restas **dan**: 1.234,50 − 0 − 0 = 1.234,50 · 0 − 2.000 − 234,55 = −2.234,55 ·
1.234,50 − 2.000 − 234,55 = −1.000,05. Y el «Neto de Ordenex» negativo (R11) se pinta con su signo.
El agregado y cada `cierre_dia` traen **sus** dos cascadas con los mismos rótulos.

### 5 · «Central debe» y «Para la central» — LO QUE EL REVIEWER SUPUSO NO ES LO QUE PASA

El informe de revisión dice que los dos rótulos «conviven ahora en la MISMA página de la satélite …
a un palmo el uno del otro». **Medido en el navegador: nunca se ven a la vez.** Viven en dos
pestañas **mutuamente excluyentes** de `ConsolidacionBodegaModule`, y `PanelConmutado` esconde la
que no se mira con el atributo `hidden` —que la saca de la vista **y del árbol de accesibilidad**—:

| Pestaña activa | «Para la central» | «Central debe» | «Total a pagar a mensajeros» |
| --- | --- | --- | --- |
| **Solicitados** | 1 en el DOM, **1 visible** | 1 en el DOM, **0 visibles** | 1 en el DOM, **0 visibles** |
| **A consolidar** | 1 en el DOM, **0 visibles** | 1 en el DOM, **1 visible** | 1 en el DOM, **1 visible** |

(La medición se hizo con «Central debe» **presente y con valor** —₡5.000, sembrado a propósito—,
para que el cero no la regalara. Y hay un segundo filtro: `CentralDebeTotal` sólo se monta cuando
la deuda **no** es `"0.00"`.)

**¿Son el mismo número con dos nombres? No.** Son dos cosas distintas y cada una lleva su nota:

- **«Central debe» (₡5.000)** — *«El efectivo no alcanzó para pagarle a todos los mensajeros (el
  pago no puede ser parcial)»*. Se calcula sobre los `cierre_dia` **a consolidar**, repartiendo el
  EFECTIVO de menor a mayor pago (`CierreBodegaService.repartirEfectivo`), **antes** de solicitar.
- **«Para la central» (−₡1.000,05)** — *«Lo recaudado menos el pago a los mensajeros y menos lo que
  gana la bodega satélite por los rechazos»*. Se deriva sobre un cierre de bodega **ya solicitado**.

Distinta población, distinta fórmula, distinto momento del flujo. **No es un cambio de alcance ni
hay nada que arreglar**; se deja medido para que la decisión sea del humano y no de una suposición.

### 6 · Lo que NO se pudo mirar, dicho como falta y no como aprobado

El caso «un cierre con al menos una `rechazada` y la línea puente explicando la diferencia»
**quedó a cero**: los `cierre_dia` de la base local no tienen ninguna gestión `entregada` y sus
`cierre_detail` no traen tarifa congelada, así que `totalesIngreso` es todo `0.00` y la línea
puente sale **₡0**. Lo que sí se vio en pantalla es el **caso cero de R10** —«Cobrado sobre lo
recaudado ₡0» y «Flete por rechazo + IVA +₡0» **están las dos, no se omiten**—, que es precisamente
lo que R10 exige. El caso con flete por rechazo distinto de cero **sólo está cubierto por tests**
(F6 › «la LÍNEA PUENTE explica la diferencia exacta», que mide el hueco en vez de afirmarlo).

### 7 · Una observación de la pantalla, para el humano

Una línea de resta con importe cero se pinta **`-₡0`** («Gana la bodega satélite -₡0»), y la de
suma, `+₡0`. Es **deliberado** —el operador va pegado al importe para que la guardia de identidades
pueda leer la resta del DOM (FE1), y un cero explícito dice «aquí no hubo rechazos» donde un hueco
obligaría a deducirlo—, y hay un test que lo fija (`+${money("0.00")}`). Se anota porque es dinero
en pantalla y se lee raro; **no se cambia por cuenta propia**: cambiarlo es decisión de quien manda
en el vocabulario, no del que implementa.

---

## Lo que queda vivo
2. **DOS SÍMBOLOS MUERTOS, declarados y NO borrados.**
   - **`GANANCIA_NOTA_BODEGA`** (`cierre-detalle-shared.tsx:337`). Era la nota de la tarjeta
     «Ganancia» del detalle de bodega, que esta ficha absorbe.
   - **`MontoDerivadoCard`** (`cierre-detalle-shared.tsx:626`). Su único consumidor eran los seis
     usos de `CierresBodegaAdminModule` que esta ficha retira; `git grep` en `app`, `lib`,
     `components` y `tests` devuelve hoy **sólo su declaración**. Lo encontró el reviewer; la
     bitácora decía lo contrario y está corregido arriba.

   **Ninguno de los dos se borra, y el motivo no es pereza:** borrar un componente exportado borra
   su test, y con él cobertura de fichas ajenas — en este árbol eso ya costó una regresión en
   producción. Se declaran aquí para que dentro de un año no parezcan un misterio, y el borrado,
   si se quiere, va en ficha aparte con su propio censo.
3. **Q4 sigue abierta y ES UNA DECISIÓN DEL LEADER, no del humano** (`INGRESO_BODEGA_RECHAZOS_LABEL`
   no se renombró en toda la app): conviven «Gana la bodega satélite» en el cierre de bodega e
   «Ingreso de bodega por rechazos» en el del mensajero. El `status_note` de la ficha registra
   «DECIDIDO POR EL LEADER: Q4 = sí, el rename va en su fuente al estilo de la 338».
   El reviewer lo marcó como **riesgo**, no como fallo, y el riesgo concreto ya está cerrado: desde
   el 2026-09-08 el VALOR de `GANA_BODEGA_SATELITE_LABEL` está anclado contra un literal escrito a
   mano en G2, **y también la regla de R25** (no repetir el vocabulario de la columna), así que un
   buscar-y-reemplazar del rename se pondría rojo en vez de pasar callando.
3b. **Q6 también la decidió el LEADER, no el humano.** La misma cifra (`total_general`) se llama
   **«Total»** en la tarjeta (`RESUMEN_TOTAL_LABEL`) y **«Total general»** en el detalle
   (`TOTAL_GENERAL_LABEL`) — verificado en pantalla el 2026-09-08, las dos superficies dicen eso—,
   mientras que el `status_note` registra «DECIDIDO POR EL LEADER: … Q6 = se unifican “Total” y
   “Total general”». **La contradicción entre el spec y lo implementado sigue abierta y se deja
   anotada**: es vocabulario de pantalla y lo decide quien manda en el vocabulario, no este rol.
4. **Q7 y Q8**, como las dejó el spec. La nota del efectivo (R37) va **en las dos** tarjetas, como
   R38 pide; si el maestro la encuentra ruidosa, se recorta por `audiencia`, que es un mecanismo
   que ya existe.
5. **El riesgo declarado de D7** (el archivo de descarga cambia de encabezados) es de la mitad de
   servidor y sigue sin medir: no hay forma de medirlo desde el repo.

---

# Segunda tanda (2026-09-08) — cerrar los bloqueantes de la revisión

> `progress/review_393.md` **rechazó** la ficha: el código de producción estaba bien y el reviewer
> lo recorrió punto por punto, pero **la red que lo sujeta tenía cuatro agujeros medidos con
> mutaciones que sobrevivieron**. Esta tanda no toca ni una línea de producción: **los cuatro
> arreglos son tests**, más las correcciones de las dos bitácoras y las 35 casillas de `tasks.md`.

## Archivos de esta tanda

| Archivo | Qué cambia |
| --- | --- |
| `tests/unit/guards/cierre-bodega-vocabulario.guardia.test.ts` | **B1** — el barrido money-safe lee `cierre-factura.tsx` ENTERO (`SUPERFICIES_MONEY_SAFE`), con su autocomprobación. **B2** — bloque nuevo que ancla el VALOR de los **8 rótulos** y las **5 notas** contra literales escritos a mano, más la REGLA de R25 (no repetir el vocabulario de la columna). De 8 casos a **24**. |
| `tests/unit/descarga/cierres-bodega-descarga-columnas.test.ts` | **m1** — el caso del negativo recorre **las tres** proyecciones, no sólo la de solicitados. |
| `tests/components/CierreBodegaDetalleCascadas.test.tsx` | **m2** — la nota fija de «Para la central» (R26) se afirma también en el DETALLE: en el agregado y en cada `cierre_dia`. |
| `tests/unit/guards/cascada-central-en-las-dos-pantallas.guardia.test.ts` | **m8** — el mensaje de fallo estaba roto (restos de una concatenación dentro de un template literal: imprimía `" +` y comillas justo cuando la guardia cae, que es cuando importa leerlo). |
| `specs/393-cierre-bodega-dos-cascadas/tasks.md` | **B4** — las 35 casillas marcadas contra el árbol, con una tabla de «cómo se comprobó» y ⚠️ en las **cinco** que terminaron con un resultado distinto del previsto (T0.4, C3, F5, F7, G4/G5). El criterio de HECHO de **F5**, reescrito: estaba apoyado en una premisa falsa. |
| `progress/impl_393_frontend.md` | esta bitácora: las tres correcciones de lo que decía y no era, V2 hecha, y Q4/Q6 anotadas como **decisiones del leader**. |

## Las cuatro mutaciones supervivientes, re-medidas — LAS CUATRO MUEREN

Arnés propio con **autocomprobación**: aborta si el texto a mutar no aparece **exactamente una
vez**; exige ver una línea `Tests …` en la salida de vitest (sin ella el resultado se marca
SIN-EJECUTAR y no cuenta); restaura desde la copia en memoria y **relee el archivo** para
comprobar que volvió byte a byte. Tras las cuatro, `git status --short` sólo lista los archivos
de test de esta tanda: **ni un archivo de producción quedó tocado**.

| # | Mutación | Antes | Ahora |
| --- | --- | --- | --- |
| **MR1b** | `cierre-factura.tsx:493` → `money(String(Number(monto)))` | ⛔ sobrevivía (2914/2914 guardias verdes) | ✅ **MUERE.** `Tests 1 failed \| 23 passed (24)` · G2 › «money-safe …» — `expected [ Array(1) ] to deeply equal []` |
| **MR3** | `lineasCascadaCentral` deja de emitir `PARA_LA_CENTRAL_NOTA` | ⛔ sobrevivía (58/58) | ✅ **MUERE.** `Tests 1 failed \| 37 passed (38)` · F6 › ««Para la central» lleva su NOTA FIJA también aquí, y en cada día (R26)» — `Unable to find an element with the text: Lo recaudado menos el pago a los mensajeros…` |
| **MR4** | `GANA_BODEGA_SATELITE_LABEL` → «Ingreso bodega rechazos» | ⛔ sobrevivía (68/68 + 2914/2914) | ✅ **MUERE, con DOS rojos.** `Tests 2 failed \| 22 passed (24)` · «GANA_BODEGA_SATELITE_LABEL dice exactamente lo aprobado» — `expected 'Ingreso bodega rechazos' to be 'Gana la bodega satélite'` · y «… NO repite el vocabulario de la columna (R25)» |
| **MR6** | `filaDescargaBodegaPendiente` recorta el negativo a `"0.00"` | ⛔ sobrevivía (487/487) | ✅ **MUERE, con DOS rojos.** `Tests 2 failed \| 8 passed (10)` · «los TRES listados … sin recalcularlo (R22)» — `expected '0.00' to be '77777.77'` · y «un «Para la central» NEGATIVO llega al archivo con su signo en LAS TRES (R36)» |

## El gate de esta tanda

`./init.sh` **completo** (el rápido se niega: el diff toca archivos con nombre de dinero), con el
`.env` copiado de la raíz **antes** y **borrado antes de commitear**, log propio
(`gate-393-a8fa1c.log`, fuera del árbol al terminar), **sin `tail` en la tubería** y con
`INIT_EXIT=$?` escrito **DENTRO** del log y en su propia línea. Antes, `pnpm run db:generate`.

```
✓ feature_list.json: sin ids duplicados (389 fichas), cupo por zona respetado (in_progress=2)
✓ typecheck paso
✓ lint paso            → 161 problems (0 errors, 161 warnings)  ← el MISMO número de antes
✓ DATABASE_URL resuelta: los 134 archivos de tests contra Postgres SI se ejecutan
 Test Files  1787 passed (1787)
      Tests  25598 passed | 26 skipped (25624)      Duration  898.63s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1787 ejecutado(s), todos en el baseline)
! migraciones sin down.sql: 20260814120000_… 20260814140000_… 20260814160000_…   (preexistente)
✓ .env presente
== init OK ==
INIT_EXIT=0
```

- **Los 26 `skipped` son EXACTAMENTE los conocidos**, contados en el log: 17 en
  `AnaliticaPage.test.tsx` y 9 en `AnaliticaShell.test.tsx`, los dos `describe.skip`/`it.skip` de
  Analítica. **Ni uno más**: ningún archivo se cayó a mitad y no hubo contención con la otra
  sesión (cero rojos raros en `integration/db`, cero deadlocks `40P01`).
- **+17 tests míos, contados uno a uno en el log**: `cierre-bodega-vocabulario.guardia` de 8 a
  **24** y `CierreBodegaDetalleCascadas` de 16 a **17**. (El +18 que sale contra la corrida del
  reviewer incluye **uno que no es mío**: su base era `dev@88ce9977` con 388 fichas y aquí hay
  389 — la 394 arrancó por medio y `feature_list` tiene un caso por ficha.)
- **Los 161 warnings son los mismos que antes**, incluido el de
  `DineroIdentidadesEnPantalla.test.tsx:508` que el reviewer señaló: preexistente, no introducido.

## Lo del informe de revisión que NO es cierto

Una sola cosa, y es la de B3.1: **«Central debe» y «Para la central» NO conviven en la misma
pantalla.** El informe lo da por hecho («a un palmo el uno del otro») y de ahí sale la duda de si
confunden. Medido en el navegador con las dos etiquetas presentes y con valor: **0 visibles a la
vez, en las dos direcciones**. Viven en pestañas mutuamente excluyentes que `PanelConmutado`
esconde con `hidden`. La tabla y los números están arriba, en «V2 · 5». Todo lo demás del informe
—los tres agujeros de red, las dos frases falsas de esta bitácora y las 35 casillas— **era cierto y
está arreglado**.
