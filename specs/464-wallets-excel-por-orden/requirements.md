# Ficha 464 — Requisitos

**El Excel de las wallets: columnas a elegir y el detalle de cada orden.**

## De qué va, en una línea

Hoy la descarga de cada wallet sale con columnas fijas y, para un movimiento que nace de un cierre,
trae UNA fila con el importe del cierre sin decir qué órdenes lo componen. El humano pidió el
2026-10-01 (punto 2): que **todas** las wallets usen el componente de descargas configurable de la app
(con selector de columnas) y que el Excel muestre **cada orden con sus dineros**.

## Decisiones de partida (del leader, revisables al aprobar este spec)

1. El detalle va en una **segunda hoja «Detalle por orden»**, enlazada a la hoja de movimientos por un
   número de movimiento. La hoja de movimientos sigue cuadrando 1:1 con el libro que se ve.
2. Construye **encima de la ficha 463** (todavía sin aprobar): el archivo respeta los filtros de las dos
   zonas, el término de búsqueda y el orden que define aquella. Los puntos de contacto están en
   `design.md §7`.

## Depende de

- **463** — filtros en dos niveles, buscador y orden del libro (esquemas de borde y estado de pantalla).
- Reutiliza sin cambiar su criterio: **344** (detalle de una fila de la caja y de la tienda), **458-D**
  (detalle de una fila del estado de cuenta), **314** (selector de columnas de la descarga), **170/151**
  (descarga común y tope único).

## Vocabulario

- **Superficie con libro:** la caja (`/wallet`), el estado de cuenta de una tienda
  (`/wallet/tiendas/[tiendaId]`), de un mensajero (`/wallet/mensajeros/[mensajeroId]`), de una bodega
  satélite (`/wallet/satelites/[zonaId]`) y el de la propia tienda (`/mi-wallet`).
- **Listado de wallets:** `/wallet/tiendas`, `/wallet/mensajeros` y `/wallet/satelites`.
- **Superficie con detalle:** la caja, el estado de cuenta de una tienda (oficina) y `/mi-wallet`.
- **Hoja de movimientos:** la hoja que hoy produce la descarga del libro.
- **Hoja de detalle:** la hoja nueva «Detalle por orden».
- **Movimiento con reparto:** movimiento cuyo concepto se reparte por orden y que nace de un cierre,
  según el catálogo vigente de la ficha 344 (`FUENTE_CAJA`, `FUENTE_TIENDA`). El resto es un
  **movimiento sin reparto**, que siempre lleva un motivo.
- **Aporte:** lo que una orden aporta al monto de un movimiento, tal como lo muestra hoy el detalle de
  esa fila en pantalla.
- **Tope de descarga:** el tope único vigente de filas por archivo (`descargaConfig.MAX_FILAS`).

## Requisitos

### A. Selector de columnas en todas las wallets

- **R1** (ubicuo) — La descarga de cada superficie con libro y de cada listado de wallets DEBE ofrecer
  el selector de columnas de la descarga de la app.
- **R2** (ubicuo) — La elección de columnas de cada descarga DEBE guardarse con un ámbito propio,
  distinto del de cualquier otra superficie y del de su hoja de detalle.
- **R3** (por evento) — CUANDO el usuario desmarca o reordena columnas de una hoja y descarga, esa hoja
  DEBE contener solo las columnas marcadas, en el orden elegido.
- **R4** (por evento) — CUANDO el usuario descarga sin haber tocado nunca el selector, la hoja de
  movimientos y la de cada listado DEBEN tener las mismas columnas, en el mismo orden y con los mismos
  encabezados que antes de esta ficha.
- **R5** (opcional) — DONDE la superficie sea `/mi-wallet`, ningún catálogo de columnas (movimientos ni
  detalle) DEBE incluir una columna con el nombre de una persona de Ordenex.

### B. Qué se descarga

- **R6** (opcional) — DONDE la superficie sea una superficie con detalle, el selector DEBE ofrecer dos
  opciones excluyentes de qué se descarga: «Solo los movimientos» y «Movimientos y detalle por orden»,
  cada una con un texto que diga cuántas hojas lleva el archivo.
- **R7** (opcional) — DONDE la superficie sea el estado de cuenta de un mensajero, el de una bodega
  satélite o un listado de wallets, el selector NO DEBE ofrecer el detalle por orden.
- **R8** (por evento) — CUANDO el usuario entra a una superficie con detalle, la opción elegida DEBE ser
  «Movimientos y detalle por orden» (ver Pregunta abierta 2). La opción NO DEBE recordarse entre visitas.
- **R9** (por evento) — CUANDO el usuario descarga con «Solo los movimientos», el archivo DEBE tener una
  sola hoja, con el mismo contenido que produce hoy la descarga para los mismos filtros, término y orden.
- **R10** (por evento) — CUANDO el usuario descarga con «Movimientos y detalle por orden», el archivo
  DEBE tener exactamente dos hojas: la de movimientos primero y «Detalle por orden» después.
- **R11** (de estado) — MIENTRAS la opción elegida sea «Movimientos y detalle por orden», el selector
  DEBE permitir elegir y ordenar por separado las columnas de cada una de las dos hojas.
- **R12** (si/entonces) — SI se pide un archivo con hoja de detalle en un formato que no sea Excel
  (.xlsx), ENTONCES el sistema NO DEBE producir archivo alguno.
- **R13** (por evento) — CUANDO el usuario descarga con «Solo los movimientos», el sistema NO DEBE leer
  ningún dato del detalle por orden.

### C. La hoja de movimientos, con detalle

- **R14** (de estado) — MIENTRAS se descarga con detalle, la hoja de movimientos DEBE tener las mismas
  filas, en el mismo orden, que con «Solo los movimientos» para los mismos filtros, término y orden
  (los de la ficha 463), incluida la línea del saldo inicial donde la haya.
- **R15** (de estado) — MIENTRAS se descarga con detalle, cada fila de movimiento DEBE llevar como
  primera columna «N.º», un número correlativo desde 1 en el orden de la hoja; la línea del saldo
  inicial NO DEBE llevar número.
- **R16** (de estado) — MIENTRAS se descarga con detalle, la hoja de movimientos DEBE llevar como última
  columna «Detalle por orden», que diga para cada movimiento con reparto cuántas órdenes lo componen y,
  para cada movimiento sin reparto, el motivo en palabras, con el mismo texto que da hoy el detalle de
  esa fila en pantalla.
- **R17** (de estado) — MIENTRAS se descarga con detalle, las columnas «N.º» de las dos hojas y
  «Detalle por orden» NO DEBEN poder desmarcarse.

### D. La hoja «Detalle por orden»

- **R18** (ubicuo) — La hoja de detalle DEBE tener una fila por cada par (movimiento con reparto de la
  hoja de movimientos, orden que aporta a su monto), y ninguna otra fila.
- **R19** (ubicuo) — Cada fila de la hoja de detalle DEBE llevar en «N.º» el número que su movimiento
  tiene en la hoja de movimientos del MISMO archivo.
- **R20** (ubicuo) — Las filas de la hoja de detalle DEBEN ir ordenadas por «N.º» ascendente y, dentro
  de un mismo movimiento, en el mismo orden en que el detalle de esa fila lista las órdenes en pantalla.
- **R21** (ubicuo) — Para cada movimiento, las órdenes de la hoja de detalle y su monto DEBEN ser
  exactamente los que muestra el detalle de esa fila en pantalla para el mismo usuario.
- **R22** (ubicuo) — Para cada movimiento con reparto, la suma de los montos de sus filas en la hoja de
  detalle DEBE ser igual a su monto en la hoja de movimientos.
- **R23** (si/entonces) — SI para un movimiento con reparto la suma de sus aportes no es igual a su
  monto, ENTONCES el archivo DEBE generarse igual y la celda «Detalle por orden» de ese movimiento DEBE
  decir que la suma de las órdenes no coincide con el monto y cuál es esa suma.
- **R24** (si/entonces) — SI ningún movimiento de la hoja de movimientos tiene reparto, ENTONCES el
  archivo DEBE incluir la hoja de detalle con su fila de encabezados y sin filas de datos.
- **R25** (opcional) — DONDE la superficie sea la caja, el catálogo de la hoja de detalle DEBE ser, en
  este orden: N.º, Fecha, Movimiento, Cierre del, Mensajero, Guía, Remisión, Destinatario, Tienda,
  Resultado, Monto.
- **R26** (opcional) — DONDE la superficie sea el estado de cuenta de una tienda en la oficina, el
  catálogo de la hoja de detalle DEBE ser, en este orden: N.º, Fecha, Movimiento, Cierre del,
  Mensajero, Guía, Remisión, Destinatario, Resultado, Monto.
- **R27** (opcional) — DONDE la superficie sea `/mi-wallet`, el catálogo de la hoja de detalle DEBE ser,
  en este orden: N.º, Fecha, Movimiento, Cierre del, Guía, Remisión, Destinatario, Resultado, Monto.
- **R28** (ubicuo) — En cada fila de detalle, «Fecha» y «Movimiento» DEBEN tener el mismo texto que las
  columnas homónimas de la fila de su movimiento; los nombres de conceptos y de resultados DEBEN salir
  de las fuentes de etiquetas de la app (los mismos textos que pinta la pantalla), y no de literales.
- **R29** (ubicuo) — Guía, remisión, destinatario y tienda de cada orden DEBEN ser los congelados en el
  cierre, no los de la orden actual.
- **R30** (ubicuo) — Ninguna celda de ninguna hoja DEBE contener un identificador interno.
- **R31** (ubicuo) — Cada monto de cada hoja DEBE salir con el mismo texto que entrega el servidor,
  con dos decimales y sin símbolo de moneda.

### E. Acceso y lectura

- **R32** (si/entonces) — SI quien pide el detalle en lote de la caja o del estado de cuenta de una
  tienda no tiene un rol de acceso total, ENTONCES el sistema DEBE responder «prohibido» sin leer
  ningún dato.
- **R33** (si/entonces) — SI quien pide el detalle en lote de `/mi-wallet` no tiene el rol de tienda,
  ENTONCES el sistema DEBE responder «prohibido» sin leer ningún dato.
- **R34** (ubicuo) — En el estado de cuenta de una tienda y en `/mi-wallet`, la hoja de detalle DEBE
  contener solo órdenes de esa tienda, también cuando el cierre del movimiento tiene órdenes de otras.
- **R35** (si/entonces) — SI la entrada de la descarga con detalle de `/mi-wallet` trae un identificador
  de tienda o de cuenta, ENTONCES el sistema DEBE responder `validation_error` sin leer ningún dato.
- **R36** (ubicuo) — La hoja de movimientos y la hoja de detalle de un archivo DEBEN salir de UNA misma
  petición al servidor, de modo que todo movimiento con reparto de la hoja de movimientos tenga sus
  órdenes en la hoja de detalle y ninguna fila de detalle apunte a un movimiento ausente.
- **R37** (ubicuo) — El número de consultas a la base que hace el servidor para producir la hoja de
  detalle NO DEBE crecer con el número de movimientos mientras no crezcan ni el número de conceptos
  distintos ni el número de tramos de cierres distintos del conjunto.

### F. Tope

- **R38** (si/entonces) — SI la hoja de movimientos supera el tope de descarga, ENTONCES el sistema DEBE
  comportarse como hoy: sin archivo y con el aviso existente.
- **R39** (si/entonces) — SI la hoja de detalle supera el tope de descarga, ENTONCES el sistema NO DEBE
  producir archivo y DEBE avisar en español con el número de filas del detalle, el tope, y qué hacer
  (acotar el periodo o descargar solo los movimientos).
- **R40** (si/entonces) — SI el detalle supera el tope de descarga, ENTONCES el servidor NO DEBE leer
  ninguna fila de órdenes: solo sus conteos.

### G. La descarga común

- **R41** (ubicuo) — Toda descarga de la app que no declare hoja de detalle DEBE producir el mismo
  archivo que antes de esta ficha: una hoja, con el mismo nombre, las mismas columnas y las mismas
  celdas.
- **R42** (ubicuo) — Los nombres de las hojas de un archivo DEBEN ser válidos para Excel y distintos
  entre sí.

### H. Errores y textos

- **R43** (si/entonces) — SI una lectura de la descarga falla, ENTONCES el sistema NO DEBE producir
  archivo, DEBE avisar en español y NO DEBE cambiar lo que hay en pantalla.
- **R44** (ubicuo) — Los textos visibles y los nombres accesibles nuevos DEBEN estar en español claro y
  NO DEBEN usar la sigla «SLA» ni jerga técnica.

## Fuera de alcance

- El reparto por orden de conceptos que hoy no lo tienen (pago al mensajero, COD recaudado de la caja,
  indemnizaciones): exigiría una fórmula o una invariante nueva (ver Preguntas 3 y 4).
- El detalle por orden de la bodega satélite (su libro son consolidaciones, sin lectura por orden).
- El selector de columnas en las otras descargas de la zona de wallets: gastos fijos, el detalle de una
  fila abierta y la conciliación de la bodega (ver Pregunta 6).
- Convertir los montos del Excel en celdas numéricas (ver Pregunta 5).
- Los filtros, el buscador y el orden del libro: ficha 463.

## Preguntas abiertas

1. **Forma de la hoja de detalle.** Propuesta: «larga», una fila por orden y por movimiento (columna
   «Movimiento» + «Monto»), que cuadra movimiento a movimiento con la hoja principal y respeta el filtro
   de categoría. Alternativa pedida en la conversación: «ancha», una fila por orden y cierre con
   columnas COD recaudado, Flete, Comisión, IVA, Neto. Se descartó (design §8.1) porque con un filtro
   de categoría o de chip mostraría conceptos que no están en la hoja principal y el «Neto» sería una
   suma nueva de dinero. ¿Se confirma la larga?
2. **Opción por defecto.** Propuesta: «Movimientos y detalle por orden», porque es lo pedido. Con
   muchos cierres el detalle puede superar el tope y la descarga fallará con el aviso de R39 hasta
   elegir «Solo los movimientos». ¿O arranca en «Solo los movimientos», como el selector de cierres?
3. **Mensajero sin detalle.** El pago al mensajero es un total del cierre: no hay pago por orden
   guardado, y repartirlo sería una fórmula de dinero nueva. Por eso su estado de cuenta solo gana el
   selector de columnas. ¿Correcto?
4. **COD recaudado e indemnizaciones de la caja.** Siguen «sin reparto» con su motivo actual (344):
   salen en la hoja de movimientos con el motivo y sin filas de detalle. El reparto de la indemnización
   es el siguiente paso barato (fuente por orden existente), pero sería otra ficha. ¿De acuerdo?
5. **Montos como texto.** Toda la app emite los montos del Excel como texto con dos decimales (decisión
   de la 170, para no perder céntimos). Excel no los suma con `SUMA` sin convertirlos. Cuadrar a mano
   el detalle con el movimiento lo exige. ¿Se abre una ficha aparte para emitir celdas numéricas exactas
   en todas las descargas?
6. **Alcance del selector.** Entran las cinco superficies con libro y los tres listados. Quedan fuera
   gastos fijos, el detalle de una fila abierta y la conciliación de la bodega. ¿Se incluyen?
