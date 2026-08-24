# 263 · tasks

Un solo archivo de producción (`app/(app)/cierres-admin/_components/cierre-factura.tsx`) y un solo
archivo de test (`tests/components/CierreFacturaPapel.test.tsx`). Los bloques **A** (cabecera) y
**B** (rejilla) son independientes entre sí: pueden hacerse en paralelo dentro de la misma rama.

> **Sin bloqueos:** las cuatro decisiones se cerraron el 2026-08-21 (rótulos «Comprobante»/«Solicitud»,
> la tarjeta compacta dentro del alcance, piso dimensionado a 9 dígitos). No hay nada que preguntar.

---

## Bloque A — la cabecera y la tarjeta compacta

### [x] T1 · Mapa `estado → rótulo` y condición de la fecha de resolución `[P con B]`

Añadir junto a `FACTURA_FOLIO_LABEL` (`:139-150`) un `Record<CierreEstado, string>` con los cuatro
rótulos de la tabla de `design.md` §2 (`aprobado`/`rechazado` → «Comprobante»; `solicitado`/`vencido`
→ «Solicitud»), y reescribir `:1313-1321` para que (a) el sustantivo salga del `Record` por
`cierre.estado` y (b) la pieza «Resuelto» —rótulo, fecha y separador `·`— sólo se renderice si
`cierre.resueltoAt` no es nulo.
**Hecho cuando:** `pnpm exec tsc --noEmit` pasa; en los cuatro estados la cabecera no puede producir
la cadena «Resuelto —»; ningún `aria-label` del archivo cambió (R6, verificable con `git diff`).
**Depende de:** nada.

### [x] T1b · El mismo guion en la tarjeta compacta (R13) `[P con T4]`

En `:691-699`, no renderizar la `LineaFecha` de «Resuelto» cuando `resueltoAt` es nulo; «Solicitado»
pasa a ser la `ultima`. El sustantivo de esa tarjeta (`FACTURA_TITULO`, «Cierre del día») **no se
toca**.
**Hecho cuando:** typecheck verde y la columna «Fechas» nunca muestra un guion; la columna entera
sigue desapareciendo cuando `solicitadoAt` es `undefined` (comportamiento de `:685-688`, intacto).
**Depende de:** nada.

### [x] T2 · Tests de la cabecera y de la tarjeta (R1–R5, R13) `[P con T4]`

En `CierreFacturaPapel.test.tsx`: cuatro casos sobre `CierreFacturaDetalle`, uno por estado —
`aprobado`/`rechazado` → «Comprobante #\<folio\>» + las dos fechas; `solicitado`/`vencido` →
«Solicitud #\<folio\>», `queryByText(/Comprobante/)` nulo dentro de la cabecera, **ningún** nodo con
«Resuelto», y el folio y «Solicitado \<fecha\>» presentes. Más dos casos sobre
`CierreFacturaResumen` desplegado: con `resueltoAt` sale la línea «Resuelto», sin él no existe ni la
línea ni el guion. Literales escritos en el test, **nunca** importados del `Record` del componente.
**Hecho cuando:** los seis pasan **y** T3 los ha matado.
**Depende de:** T1, T1b.

### [x] T3 · Matar los tests de T2 con dos mutaciones

(a) Revertir a mano `:1313-1321` al comportamiento viejo (las tres piezas siempre, `fecha(resueltoAt)`
con su guion, «Comprobante» fijo). (b) Revertir `:691-699` a la `LineaFecha` incondicional. Correr
**sólo** ese `describe` con cada una.
**Hecho cuando:** con (a) fallan **al menos** el caso de `vencido` y el de `solicitado`, y el mensaje
de fallo nombra el texto viejo; con (b) falla el caso de la tarjeta sin fecha; se revierten las dos y
vuelve todo a verde. Los rojos, pegados en `progress/impl_263.md`. **Si algún caso sigue verde con su
mutación, ese caso no vale y se reescribe.**
**Depende de:** T2.

---

## Bloque B — la rejilla

### [x] T4 · Una sola constante para la plantilla, y la guía deja de ser una caja de 40 px `[P con A]`

1. Extraer la plantilla a una constante del módulo y consumirla en `:1105` **y** `:1490` (los dos
   únicos sitios; verificado con `rg "grid-cols-\["` sobre el archivo antes y después).
2. Guía: track `auto` + piso en px **dimensionado a 9 dígitos** (partida: 80 px) en la celda de fila
   y de cabecera (misma constante), `whitespace-nowrap` + `tabular-nums`, sin
   `truncate`/`overflow-hidden`/`break-*`.
3. Destinatario: track `minmax(0,1.4fr)`, celda `min-w-0`, `truncate` en sus dos líneas. Dinero:
   `minmax(0,1fr)`.
**Hecho cuando:** `rg` confirma **cero** literales `grid-cols-[` sueltos en el archivo; typecheck y
lint verdes; la celda vacía sigue pintando «—» (R11).
**Depende de:** nada.

### [x] T5 · Medición en el navegador con guías de 8 y de 9 dígitos (R7–R10, R14)

Playwright, `/cierres-admin` (sesión admin) y `/cierre-dia` (sesión mensajero), con una guía de
8 dígitos (el caso real), otra de **9** (R14: el techo medido más un dígito de holgura) y otra más
corta en la misma pestaña. Anchos 1440 / 1280 / 1024 / 768 / 390.
Sonda según `design.md` §4: `scrollWidth > clientWidth + 1 || scrollHeight > clientHeight + 1`
**sobre la celda de guía, la del destinatario y el `<button>` de la fila**; más `guía.right <=
destinatario.left`; más que los 8 dígitos se lean en una línea y en orden; más `left` de las celdas
alineado (±1 px) entre cabecera y todas las filas. Filtrar los `position: absolute` (`sr-only`).
**Hecho cuando:** tabla de resultados con **0 solapamientos y 0 desalineados** en las 5×2
combinaciones y con las dos longitudes de guía, pegada en `progress/impl_263.md`, con el ancho medido
de la celda de guía en cada caso —si la de 9 dígitos supera el piso de T4, se sube el piso y se
remide—; y **antes de creerla, la sonda se autocomprueba**: se corre contra el estado ANTERIOR al
arreglo (`git stash` de T4) y debe reportar el solapamiento del caso de 8 dígitos. Una sonda que da
verde en las dos versiones no midió nada — pasó en la 258.
**Depende de:** T4.

### [x] T6 · Tests de anatomía de la rejilla (R7/R8/R11/R12) `[P con T2]`

En `CierreFacturaPapel.test.tsx`: la celda de la guía no lleva `truncate` ni `break-`; la del
destinatario lleva `truncate` y `min-w-0`; son dos nodos distintos; sin `numGuia` sale «—»; el
`aria-label` del botón conserva destinatario y remisión completos. Más un caso que lee el
`className` de la fila **y** el de la cabecera de columnas **desde el DOM** y afirma que su fragmento
`grid-cols-[...]` es idéntico (sin escribirlo a mano en el test).
**Hecho cuando:** pasan **y** se han matado con dos mutaciones: (a) devolver `40px` sólo en la
cabecera de columnas → el caso de los dos sitios debe ponerse rojo; (b) mover `truncate` de la celda
del destinatario a la de la guía → el caso de anatomía debe ponerse rojo. Rojos pegados en
`progress/impl_263.md`.
**Depende de:** T4.

---

## [x] T8 · Regresión de impresión (feature 223)

Con la hoja desplegada, imprimir a PDF `/cierres-admin`: la fila conserva su `break-inside-avoid` y
la rejilla nueva no parte la fila ni desalinea las columnas en papel.
**Hecho cuando:** un PDF de un cierre con ≥15 órdenes, revisado a ojo, sin filas partidas y con las
columnas alineadas. Se anota en `progress/impl_263.md`.
**Depende de:** T4.

## [x] T9 · Gate

`./init.sh --rapido`, escribiendo `INIT_EXIT=$?` **dentro** del log (no confiar en el exit code de la
cadena). El diff no toca migraciones, `db/schema.prisma`, `lib/types/` ni configuración de build, así
que el modo rápido aplica; si el arnés se niega, correr el completo.
**Hecho cuando:** `INIT_EXIT=0` y el log citado en `progress/impl_263.md`.
**Depende de:** T3, T6, T8.

---

## Mapa `R<n> → test` (propuesto; el implementer lo confirma en `progress/impl_263.md`)

| R | Dónde se demuestra |
| --- | --- |
| R1 | `CierreFacturaPapel.test.tsx` › «en un cierre vencido la cabecera no lo llama comprobante» (+ caso `solicitado`) |
| R2 | idem › «en un cierre aprobado/rechazado la cabecera lo llama comprobante» |
| R3 | idem › «sin fecha de resolución no se pinta la pieza Resuelto, ni con guion» |
| R4 | idem › «con fecha de resolución se pintan las dos fechas» |
| R5 | idem › «el folio y la fecha de solicitud salen en los cuatro estados» |
| R6 | idem › los casos ya existentes que localizan por `role="region"` (deben seguir verdes sin tocarlos) |
| R13 | idem › «la tarjeta compacta sin fecha de resolución no pinta la línea Resuelto» (+ el caso con fecha) |
| R7 | anatomía (T6: la guía sin `truncate`/`break-*`) **+** medición T5 (criterio 1 y 2) |
| R8 | anatomía (T6: `truncate` + `min-w-0` en el destinatario, `shrink`/piso en la guía) **+** T5 |
| R9 | **sólo** medición T5 (`guía.right <= destinatario.left`, 5 anchos × 2 audiencias) |
| R10 | T6 (los dos sitios comparten fragmento de plantilla) **+** T5 (`left` alineado ±1 px) |
| R11 | T6 › «sin número de guía la celda muestra —» |
| R12 | T6 › «el destinatario recortado conserva su texto en el DOM y en el nombre accesible» |
| R14 | **sólo** medición T5, fila de la guía de 9 dígitos (el piso de T4 se valida contra ella) |

> R9 y R14 no tienen test de suite y **eso es correcto**: jsdom no hace layout. Su evidencia es la tabla de
> T5 con su autocomprobación. Un test de suite que dijera medirlo estaría mintiendo.
