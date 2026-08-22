# 263 · requirements — el comprobante del cierre no puede contradecirse, y la guía no puede pisar al destinatario

**Zona:** frontend · **Complejidad:** baja · **`sdd: false`** (presentación pura: sin cambio de
contrato, de datos ni de consultas). Este spec existe porque la ficha trae contexto medido y dos
trampas conocidas, no porque la feature necesite el proceso completo.

**Superficie:** `app/(app)/cierres-admin/_components/cierre-factura.tsx` — `CierreFacturaDetalle`
(cabecera del documento y rejilla de órdenes) y la **tarjeta compacta** del resumen, que tiene el
mismo guion nueve líneas más arriba. Se pinta en `/cierres-admin` (audiencia `admin`) y en
`/cierre-dia` (audiencia `mensajero`).

Las cuatro dudas del primer borrador quedaron **cerradas por el humano el 2026-08-21** y están
escritas abajo como requisitos; el porqué de cada una vive en `design.md`. No hay preguntas abiertas.

---

## A. La cabecera dice la verdad sobre el estado del cierre

Hoy las tres piezas (`cierre-factura.tsx:1315-1319`) se pintan **siempre**, sin mirar
`cierre.estado`: en un cierre `vencido` sale «Comprobante #A1B2C3D4» y debajo «Solicitado
2026-08-20 · Resuelto —». El texto llama *comprobante* a un cierre sin resolver y a continuación
admite con un guion que no hay resolución.

- **R1.** MIENTRAS el cierre esté **sin resolver** (`solicitado` o `vencido`), la cabecera del
  comprobante detallado DEBE rotular el documento «Solicitud #\<folio\>», y NO DEBE contener la
  palabra «Comprobante».
- **R2.** MIENTRAS el cierre esté **resuelto** (`aprobado` o `rechazado`), la cabecera DEBE rotular
  el documento «Comprobante #\<folio\>».
- **R3.** SI el cierre no tiene fecha de resolución, ENTONCES la cabecera NO DEBE pintar la pieza
  «Resuelto»: ni su rótulo, ni un guion en su lugar, ni el separador `·` que la unía a «Solicitado».
- **R4.** SI el cierre tiene fecha de resolución, ENTONCES la cabecera DEBE pintar la fecha de
  solicitud y la de resolución con los mismos rótulos y el mismo formato que hoy.
- **R5.** El sistema DEBE mostrar el folio del cierre y su fecha de solicitud en los cuatro estados;
  lo único que cambia entre estados es el sustantivo que precede al folio y la presencia de la pieza
  «Resuelto».
- **R13.** SI el cierre no tiene fecha de resolución, ENTONCES la columna «Fechas» de la **tarjeta
  compacta** del resumen (`cierre-factura.tsx:691-699`) TAMPOCO DEBE pintar la línea «Resuelto» ni un
  guion en su lugar: es el mismo defecto, en la misma pantalla, a nueve líneas del otro.
- **R6.** El sistema DEBE conservar sin cambios los nombres accesibles de las hojas
  («Comprobante detallado del cierre de …», «Comprobante detallado de tu cierre», «Comprobante del
  cierre de …»): son el localizador de los tests y del E2E, y no son texto en pantalla.

## B. El número de guía no se recorta ni pisa a nadie

Hoy la rejilla es `grid-cols-[40px_1.4fr_1fr_1fr_24px]` en **dos sitios idénticos** — la fila
(`:1105`) y la cabecera de columnas (`:1490`), verificado: no hay más ocurrencias en el repo—. La
columna de guía mide 40 px fijos; una guía de 8 dígitos (`35424629`) pide ~60 px, no puede encoger
ni recortarse, y se pinta encima de la celda del destinatario.

- **R7.** El sistema DEBE mostrar el número de guía completo: sin recorte, sin elipsis y sin partirlo
  dentro del propio número.
- **R8.** SI el ancho disponible no alcanza para el número de guía y el texto del destinatario,
  ENTONCES el que DEBE ceder es el texto del destinatario, con elipsis; nunca la guía.
- **R9.** El sistema DEBE mantener cada celda de la fila dentro de su columna —ninguna se pinta sobre
  la vecina— en los anchos de referencia (1440, 1280, 1024, 768 y 390 px) y en las dos audiencias
  (`admin` y `mensajero`).
- **R14.** El sistema DEBE cumplir R7, R8 y R9 con guías de **9 dígitos**, un dígito por encima del
  máximo medido en producción el 2026-08-21 (163 órdenes con guía, todas de 8 dígitos). La longitud
  de la guía no está declarada en ninguna parte del repo: el ancho se dimensiona con un dígito de
  holgura, que cuesta cero, en vez de quedarse justo, que cuesta este mismo defecto otra vez.
- **R10.** El sistema DEBE mantener alineadas entre sí las columnas de la cabecera y las de todas las
  filas de una misma pestaña, incluso cuando conviven guías de distinta longitud.
- **R11.** SI una orden no tiene número de guía, ENTONCES su celda DEBE seguir mostrando «—», igual
  que hoy.
- **R12.** El sistema DEBE conservar el texto completo del destinatario y de la línea
  «remisión · producto» en el DOM y en el nombre accesible de la fila, aunque se recorte visualmente.

---

## Preguntas abiertas

Ninguna. Las cuatro del primer borrador se cerraron el 2026-08-21: R1/R2 fijan los dos rótulos, R13
mete la tarjeta compacta en el alcance y R14 fija el dimensionado a 9 dígitos con el dato medido.
