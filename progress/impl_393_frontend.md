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
`MontoDerivadoCard`, `PagoMensajeroTotal` e `IngresoBodegaRechazosTotal` **siguen exportados y
siguen montados por el detalle del cierre de mensajero** (R30).

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
    mismo número que midió la mitad de servidor, y ni uno en un archivo de este diff)
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

- **V2 · verificación humana en la app real: PENDIENTE.** No hay E2E en este repo y no se inventa
  uno aquí. Lo que sí hay, y no lo sustituye pero se le acerca: F4 y F6 montan las pantallas de
  verdad —las dos listas del comprobante y el modal del detalle— y leen **del DOM**, y G1 vuelve a
  hacerlo con su propio parseador independiente. **Falta que una persona lo mire**, con el guion
  que `tasks.md § V2` deja escrito.

---

## Lo que queda vivo

1. **V2 sin hacer.** Ver arriba. Es lo único de mi alcance que no puedo cerrar yo.
2. **`GANANCIA_NOTA_BODEGA` se queda sin consumidor.** Era la nota de la tarjeta «Ganancia» del
   detalle de bodega, que esta ficha absorbe. No se borra —borrar una constante exportada es tocar
   `cierre-detalle-shared.tsx` por algo que no es de esta ficha— pero **queda muerta**, y lo digo
   aquí para que no se descubra dentro de un año como si fuera un misterio.
3. **Q4 sigue abierta** (`INGRESO_BODEGA_RECHAZOS_LABEL` no se renombró en toda la app): conviven
   «Gana la bodega satélite» en el cierre de bodega e «Ingreso de bodega por rechazos» en el del
   mensajero. La guardia G2 lo **fija**: el segundo nombre está prohibido en las superficies de
   bodega y sigue vivo en las del mensajero.
4. **Q7 y Q8**, como las dejó el spec. La nota del efectivo (R37) va **en las dos** tarjetas, como
   R38 pide; si el maestro la encuentra ruidosa, se recorta por `audiencia`, que es un mecanismo
   que ya existe.
5. **El riesgo declarado de D7** (el archivo de descarga cambia de encabezados) es de la mitad de
   servidor y sigue sin medir: no hay forma de medirlo desde el repo.
