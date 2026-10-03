# Ficha 468 — Requisitos

**El Excel del libro de la wallet: un kardex fácil de leer y un detalle por guía que cuadra con él.**

## De qué va, en una línea

El humano descargó el libro el 2026-10-02 y lo encontró confuso. La hoja 1 lleva columnas técnicas y los
montos salen como texto. La hoja 2 está agrupada por un «N.º» que nadie entiende y repite la misma guía en
filas sueltas. Pide (literal): *«que sea algo fácil de entender… debería estar agrupado por el número de la
guía, y cada columna podría contar mejor su historia»* y *«el cliente quiere ver todos sus movimientos…
que las dos hojas cuadren»*.

## Decisiones ya tomadas por el humano (2026-10-02)

1. **Hoja 1 «Movimientos» = kardex.** Columnas: Fecha | Concepto | Detalle | A quién | Entra | Sale | Saldo
   | Registró. La primera fila es el saldo al inicio del periodo, la última los totales y el saldo final,
   con el saldo corrido fila a fila. Los montos van como números de Excel. Fuera: «N.º», los párrafos
   técnicos y «Dueño». Si hace falta distinguir de quién es el dinero, la columna se llama «Es dinero de».
2. **Hoja 2 «Detalle por guía», agrupada.** Cada guía lleva una fila de cabecera, una fila por concepto y
   una fila «Total de la guía». Después va la sección «Movimientos sin guía» y al final un TOTAL GENERAL
   **igual** al de la hoja 1. Si un movimiento no cuadra con sus guías, sale una fila visible «Diferencia
   sin repartir». El humano eligió esta forma, no una fila ancha por guía.
3. **Sin fórmulas de dinero nuevas.** Los montos por guía salen de valores ya guardados o de la derivación
   que ya se usa.

## Depende de / sustituye

- Construye sobre la **464** (descarga con detalle, mergeada, PR #840). Esta ficha **sustituye** de la 464
  los requisitos R4, R13, R15, R16, R17, R19, R20, R23, R25, R26, R27 y R31, y **amplía** R7 (el
  mensajero gana detalle) y el «Fuera de alcance» (pago al mensajero, contra-entrega de la caja e
  indemnización). Los demás requisitos de la 464 siguen vigentes (R1–R3, R5, R6, R8–R12, R14, R18, R21,
  R22, R24, R28–R30, R32–R44), leídos con «Detalle por guía» donde dicen «Detalle por orden».
- Reutiliza sin cambiar su criterio: **344** (detalle de una fila), **458-D** (estado de cuenta y su saldo
  corrido), **459** (las cifras de la caja), **463** (filtros, buscador y orden), **170/151** (descarga
  común y tope).
- Se cruza con la **467** (barra del libro, en paralelo) en los mismos módulos de pantalla: ver
  `design.md §12`.

## Vocabulario

- **Superficie con libro:** la caja (`/wallet`), el estado de cuenta de una tienda, de un mensajero o de
  una bodega satélite (oficina) y `/mi-wallet`.
- **Superficie con detalle:** la caja, el estado de cuenta de una tienda (oficina), el de un mensajero
  (oficina) y `/mi-wallet`. La bodega satélite NO es superficie con detalle.
- **Hoja «Movimientos»:** la primera hoja del archivo, el kardex.
- **Hoja «Detalle por guía»:** la segunda hoja, que solo existe en una superficie con detalle y cuando se
  elige la opción con detalle.
- **Periodo:** el rango de fechas elegido en la pantalla. **Otros filtros:** todo filtro distinto del
  periodo (concepto, a quién, entra/sale, chip, cierre, término de búsqueda).
- **Columna de monto:** «Entra», «Sale» y, solo en la caja, «Cobrado a tiendas».
- **Saldo de la caja:** la cifra principal de la tarjeta de la caja («Flujo de dinero registrado» o
  «Dinero en caja», según la 459). Es lo que entró menos lo que salió de verdad, y los cargos a tiendas no
  la mueven.
- **Cargo a tienda:** un concepto de la caja que no mueve dinero: pasa dinero de la tienda a Ordenex (los
  seis conceptos del cierre y el cobro de Ordenex a una tienda). Su anulación es el **reverso de cargo**.
- **Movimiento repartible:** un movimiento que nace de un cierre y cuyo concepto se reparte por guía según
  el catálogo vigente (la 344 más lo que añade R27).
- **Aporte:** lo que una guía aporta al monto de un movimiento repartible, tal como lo muestra el detalle
  de esa fila en pantalla.
- **Bloque de guía:** en la hoja 2, la fila de cabecera de una guía, sus filas de concepto y su fila
  «Total de la guía».

## Requisitos

### A. La hoja «Movimientos» (kardex)

- **R1** (opcional): DONDE la superficie sea la caja, la hoja «Movimientos» DEBE tener, en este orden, las
  columnas Fecha, Concepto, Detalle, A quién, Es dinero de, Entra, Sale, Cobrado a tiendas, Saldo y
  Registró.
- **R2** (opcional): DONDE la superficie sea el estado de cuenta de una tienda, de un mensajero o de una
  bodega satélite en la oficina, la hoja «Movimientos» DEBE tener, en este orden, las columnas Fecha,
  Concepto, Detalle, Entra, Sale, Saldo y Registró.
- **R3** (opcional): DONDE la superficie sea `/mi-wallet`, la hoja «Movimientos» DEBE tener, en este
  orden, las columnas Fecha, Concepto, Detalle, Entra, Sale y Saldo.
- **R4** (ubicuo): La hoja «Movimientos» NO DEBE tener ninguna de estas columnas: «N.º», «Detalle por
  orden», «Dueño», «Movimiento», «Motivo y origen», «Motivo», «Origen», «Cómo se pagó», «Entra o sale»,
  «Monto», «Cargo», «Abono» y «Estado».
- **R5** (ubicuo): La primera fila de datos de la hoja «Movimientos» DEBE decir «Saldo al inicio del
  periodo» en Concepto, llevar ese saldo en Saldo y dejar vacías las columnas de monto.
- **R6** (ubicuo): Después de la fila del saldo inicial, la hoja «Movimientos» DEBE tener una fila por
  cada movimiento del conjunto que descarga hoy la superficie con los mismos filtros y término, ni una más
  ni una menos.
- **R7** (ubicuo): Las filas de movimiento DEBEN ir en orden cronológico ascendente (fecha del movimiento
  y, a igual fecha, orden de registro), sea cual sea el orden elegido en la pantalla.
- **R8** (ubicuo): La última fila con montos de la hoja «Movimientos» DEBE decir «Total del periodo» en
  Concepto, llevar en cada columna de monto la suma de esa columna en las filas de movimiento, y en Saldo
  el saldo al final del periodo.
- **R9** (opcional): DONDE la superficie sea un estado de cuenta (oficina o `/mi-wallet`), cada fila de
  movimiento DEBE tener su monto en exactamente una columna: en «Entra» si el movimiento sube el saldo de
  esa cuenta y en «Sale» si lo baja.
- **R10** (opcional): DONDE la superficie sea la caja, cada fila de movimiento DEBE tener su monto en
  exactamente una columna. Un ingreso que es dinero que entra de verdad va en «Entra». Un egreso que es
  dinero que sale de verdad va en «Sale». Un cargo a tienda va en «Cobrado a tiendas» en positivo, y un
  reverso de cargo, en «Cobrado a tiendas» en negativo.
- **R11** (opcional): DONDE la superficie sea un estado de cuenta, el Saldo de cada fila de movimiento
  DEBE ser el saldo de la cuenta entera justo después de ese movimiento: el mismo número que pinta la
  pantalla en esa fila.
- **R12** (opcional): DONDE la superficie sea la caja, el Saldo de cada fila de movimiento DEBE ser el
  saldo de la caja entera (sin filtros) justo después de ese movimiento.
- **R13** (opcional): DONDE la superficie sea un estado de cuenta, el saldo al inicio del periodo DEBE ser
  el saldo inicial que muestra la tarjeta del estado de cuenta para ese periodo, y el saldo al final, el
  saldo final de esa tarjeta.
- **R14** (opcional): DONDE la superficie sea la caja, el saldo al inicio del periodo DEBE ser el saldo de
  la caja con todos los movimientos anteriores al inicio del periodo, y el saldo al final, el saldo de la
  caja con todos los movimientos hasta el final del periodo. Sin fecha de inicio, el saldo inicial DEBE
  ser 0,00.
- **R15** (de estado): MIENTRAS el único filtro aplicado sea el periodo, el Saldo de cada fila de
  movimiento DEBE ser igual al Saldo de la fila anterior más su Entra menos su Sale (en la caja, sin
  contar «Cobrado a tiendas»). El saldo final DEBE ser igual al saldo inicial más el total de Entra menos
  el total de Sale.
- **R16** (si/entonces): SI la descarga lleva otros filtros además del periodo, ENTONCES la hoja
  «Movimientos» DEBE añadir, debajo de «Total del periodo», una fila con este aviso: «Con filtros: Entra y
  Sale suman solo los movimientos de esta hoja; el saldo es el de toda la cuenta.» En la caja dice «el de
  toda la caja».
- **R17** (ubicuo): «Concepto» DEBE llevar, en cada fila de movimiento, la misma etiqueta del concepto que
  pinta la pantalla para ese movimiento.
- **R18** (ubicuo): «Detalle» DEBE juntar con « · », en este orden y saltándose las vacías, estas partes:
  el origen legible de la pantalla, la descripción guardada, la forma de pago con su referencia,
  «1 orden» / «N órdenes» si el movimiento es repartible, y el estado de anulación tal como lo dice la
  pantalla.
- **R19** (ubicuo): Ninguna celda de ninguna hoja DEBE contener los textos técnicos de los motivos sin
  reparto, ni las palabras «snapshot», «productor», «ledger» o «feed».
- **R20** (opcional): DONDE la superficie sea la caja, «A quién» y «Registró» DEBEN llevar el mismo texto
  que la tabla de la caja muestra para esa fila.
- **R21** (opcional): DONDE la superficie sea la caja, «Es dinero de» DEBE decir «Ordenex», «Tienda» u
  «Ordenex (capital)» según de quién es el dinero de ese concepto: la misma clasificación y las mismas
  palabras que la tabla de la caja ya usa.
- **R22** (ubicuo): Cada monto de cada hoja DEBE ser una celda numérica de Excel con dos decimales y
  separador de miles, cuyo valor sea exactamente el importe del servidor al céntimo.
- **R23** (ubicuo): Las filas «Saldo al inicio del periodo» y «Total del periodo» DEBEN ir en negrita.

### B. La hoja «Detalle por guía»

- **R24** (opcional): DONDE la superficie sea una superficie con detalle, el selector de la descarga DEBE
  ofrecer las opciones «Solo los movimientos · una hoja» y «Movimientos y detalle por guía · dos hojas».
- **R25** (opcional): DONDE la superficie sea el estado de cuenta de una bodega satélite, la descarga DEBE
  producir solo la hoja «Movimientos», sin ofrecer el detalle por guía.
- **R26** (por evento): CUANDO el usuario descarga con «Movimientos y detalle por guía», el archivo DEBE
  tener exactamente dos hojas: «Movimientos» primero y «Detalle por guía» después.
- **R27** (ubicuo): Además de los conceptos que la 344 ya reparte, DEBEN repartirse por guía estos cuatro:
  el contra-entrega recaudado de la caja, el pago al mensajero de la caja, la indemnización de la caja y
  el pago devengado del libro del mensajero.
- **R28** (ubicuo): Para los cuatro conceptos de R27, el detalle de esa fila en pantalla DEBE listar las
  mismas órdenes con los mismos montos que la hoja «Detalle por guía».
- **R29** (opcional): DONDE la superficie sea la caja, la hoja «Detalle por guía» DEBE tener, en este
  orden, las columnas Guía, Remisión, Destinatario, Tienda, Mensajero, Cierre, Resultado, Concepto,
  Detalle, Entra, Sale y Cobrado a tiendas.
- **R30** (opcional): DONDE la superficie sea el estado de cuenta de una tienda en la oficina, la hoja
  «Detalle por guía» DEBE tener, en este orden, las columnas Guía, Remisión, Destinatario, Mensajero,
  Cierre, Resultado, Concepto, Detalle, Entra y Sale.
- **R31** (opcional): DONDE la superficie sea el estado de cuenta de un mensajero en la oficina, la hoja
  «Detalle por guía» DEBE tener, en este orden, las columnas Guía, Remisión, Destinatario, Tienda, Cierre,
  Resultado, Concepto, Detalle, Entra y Sale.
- **R32** (opcional): DONDE la superficie sea `/mi-wallet`, la hoja «Detalle por guía» DEBE tener, en este
  orden, las columnas Guía, Remisión, Destinatario, Cierre, Resultado, Concepto, Detalle, Entra y Sale.
- **R33** (ubicuo): La hoja «Detalle por guía» DEBE tener un bloque por cada guía que aporta a algún
  movimiento de la hoja «Movimientos», y solo esos bloques.
- **R34** (ubicuo): Cada bloque de guía DEBE empezar con una fila de cabecera que lleve Guía, Remisión,
  Destinatario y, si la hoja tiene esas columnas, Tienda, Mensajero, Cierre y Resultado. En esa fila
  Concepto y las columnas de monto van vacías.
- **R35** (ubicuo): Detrás de su cabecera, cada bloque de guía DEBE tener una fila por cada movimiento al
  que esa guía aporta. Cada fila lleva la Guía, el día del cierre de ese movimiento en Cierre, el concepto
  del movimiento en Concepto (la misma etiqueta que en la hoja «Movimientos») y el aporte en la misma
  columna de monto donde está ese movimiento en la hoja «Movimientos».
- **R36** (ubicuo): Cada bloque de guía DEBE terminar con una fila «Total de la guía» que lleve, en cada
  columna de monto, la suma de esa columna en las filas de concepto del bloque.
- **R37** (ubicuo): Los bloques DEBEN ir ordenados por número de guía ascendente. Las órdenes sin número
  de guía van detrás y dicen «Sin guía · remisión <remisión>» en Guía. Dentro de un bloque, las filas de
  concepto van por día del cierre ascendente y, a igual día, en el orden de sus movimientos en la hoja
  «Movimientos».
- **R38** (si/entonces): SI una guía aporta a movimientos de más de un cierre, ENTONCES su fila de
  cabecera DEBE llevar en Cierre todos sus días de cierre, ascendentes y separados por comas, y en
  Resultado los resultados de sus gestiones en esos cierres.
- **R39** (ubicuo): Guía, remisión, destinatario y tienda DEBEN ser los congelados en el cierre. Si una
  guía tiene valores distintos en dos cierres, la cabecera DEBE llevar los del cierre más reciente.
- **R40** (ubicuo): Detrás del último bloque de guía, la hoja DEBE tener una fila de título «Movimientos sin
  guía» y, debajo, una fila por cada movimiento de la hoja «Movimientos» que no es repartible. Cada fila
  lleva el concepto en Concepto; en Detalle, la fecha del movimiento seguida del Detalle de la hoja
  «Movimientos»; y el monto en la misma columna de monto que en la hoja «Movimientos».
- **R41** (si/entonces): SI la suma de los aportes de un movimiento repartible no es igual a su monto,
  ENTONCES la sección «Movimientos sin guía» DEBE llevar una fila «Diferencia sin repartir». Su monto es el
  del movimiento menos la suma de sus aportes, va en la columna de monto del movimiento, y su Detalle nombra
  el día del cierre, el concepto, el monto del movimiento y la suma de sus guías.
- **R42** (si/entonces): SI un movimiento repartible no tiene ninguna guía que le aporte, ENTONCES su monto
  entero DEBE aparecer como «Diferencia sin repartir» según R41.
- **R43** (opcional): DONDE la superficie sea el estado de cuenta de un mensajero, cada pago tomado del
  efectivo de un cierre DEBE salir en «Movimientos sin guía», con un Detalle que diga que se tomó del
  efectivo que el mensajero entregó en el cierre de ese día.
- **R44** (ubicuo): La última fila de la hoja «Detalle por guía» DEBE decir «TOTAL GENERAL» en Concepto y
  llevar, en cada columna de monto, la suma de esa columna en las filas de concepto de todos los bloques,
  las filas de «Movimientos sin guía» y las filas «Diferencia sin repartir». Las filas «Total de la guía»
  NO entran en esa suma.
- **R45** (ubicuo): En cada columna de monto, el TOTAL GENERAL de la hoja «Detalle por guía» DEBE ser igual
  al «Total del periodo» de la hoja «Movimientos» del mismo archivo.
- **R46** (ubicuo): Cada movimiento de la hoja «Movimientos» DEBE aparecer en la hoja «Detalle por guía».
  Uno repartible aparece por sus filas de concepto, más su «Diferencia sin repartir» si la tiene. Uno no
  repartible aparece exactamente una vez en «Movimientos sin guía».
- **R47** (ubicuo): Las filas de cabecera de guía, «Total de la guía», el título «Movimientos sin guía» y
  «TOTAL GENERAL» DEBEN ir en negrita.
- **R48** (opcional): DONDE la superficie sea el estado de cuenta de una tienda o `/mi-wallet`, la hoja
  «Detalle por guía» DEBE contener solo guías de esa tienda, también cuando el cierre tiene guías de otras.
- **R49** (opcional): DONDE la superficie sea `/mi-wallet`, ninguna hoja DEBE contener el nombre de una
  persona de Ordenex ni de un mensajero.

### C. Selector de columnas

- **R50** (ubicuo): El selector de columnas de la 464 DEBE seguir permitiendo elegir y ordenar las columnas
  de cada hoja, sobre los catálogos de R1–R3 y R29–R32, cada hoja con su propio ámbito guardado.
- **R51** (ubicuo): En la hoja «Movimientos», Concepto, las columnas de monto y Saldo NO DEBEN poder
  desmarcarse. En la hoja «Detalle por guía», Guía, Concepto y las columnas de monto tampoco.
- **R52** (por evento): CUANDO el usuario descarga con una elección de columnas guardada antes de esta
  ficha, la descarga DEBE producir archivo, y toda columna que no existía antes DEBE salir marcada.

### D. Servidor, acceso y tope

- **R53** (ubicuo): Las dos hojas de un archivo DEBEN salir de UNA misma petición al servidor.
- **R54** (ubicuo): Los saldos, los totales, los aportes y las diferencias de las dos hojas DEBEN llegar
  calculados del servidor. El navegador solo los coloca.
- **R55** (si/entonces): SI quien pide el detalle del estado de cuenta de un mensajero no tiene un rol de
  acceso total, ENTONCES el sistema DEBE responder «prohibido» sin leer ningún dato.
- **R56** (si/entonces): SI la hoja «Detalle por guía» del estado de cuenta de un mensajero superara el tope
  de descarga, ENTONCES el sistema DEBE comportarse como la 464 en las demás superficies (R39/R40): sin
  archivo, con el aviso y sin leer ninguna orden.
- **R57** (por evento): CUANDO el usuario descarga con «Solo los movimientos», la hoja «Movimientos» DEBE
  ser idéntica, celda a celda, a la hoja «Movimientos» de la descarga con detalle para los mismos filtros.
- **R58** (opcional): DONDE la superficie ofrezca el formato CSV, el CSV DEBE tener las mismas filas y
  columnas que la hoja «Movimientos», con los montos como texto de dos decimales sin símbolo de moneda.
- **R59** (ubicuo): Toda descarga de la app que no sea un libro de wallet DEBE producir el mismo archivo
  que antes de esta ficha.
- **R60** (ubicuo): Los textos visibles nuevos DEBEN estar en español claro y NO DEBEN usar la sigla «SLA»
  ni jerga técnica.
- **R61** (por evento): CUANDO el usuario descarga con «Solo los movimientos», el sistema NO DEBE leer
  ninguna fila de órdenes. Para el «N órdenes» de R18 solo DEBE leer sus conteos. Sustituye a R13 de la
  464.

## Fuera de alcance

- El saldo corrido en la tabla de la caja en pantalla (solo cambia el archivo).
- Celdas de fecha de Excel: la fecha sigue como texto «AAAA-MM-DD», como hoy.
- El detalle por guía de la bodega satélite: su libro son consolidaciones, sin guías (R25).
- Los listados de wallets (`/wallet/tiendas`, `/wallet/mensajeros`, `/wallet/satelites`) y las demás
  descargas de la zona: no cambian.
- Colgar de su guía la indemnización que nace de un incidente (origen `orden_incidente`, no de un
  cierre). Sale en «Movimientos sin guía», y su Detalle ya nombra la guía a través del origen legible.
  R27 reparte solo la indemnización que nace de un cierre.
- Repartir por guía el pago tomado del efectivo del mensajero (`min(pago, efectivo)` del cierre). Hacerlo
  obligaría a decidir a qué guías se carga el faltante, y eso es una fórmula de dinero nueva (R43).

## Preguntas abiertas (dependen del humano)

1. **Cargos a tiendas en la caja.** El saldo de la caja (la tarjeta) no se mueve con el flete, el IVA, la
   comisión ni el cobro a una tienda, porque es dinero que ya estaba en la caja y solo cambia de dueño. Si
   esas filas fueran a «Entra», el saldo corrido no cuadraría fila a fila. Propuesta (R10): una columna
   más, «Cobrado a tiendas», solo en la caja, que no mueve el saldo, con las anulaciones en negativo.
   ¿Vale ese nombre, o se prefiere otro («Pasa de la tienda a Ordenex»)?
2. **Orden del kardex.** Un saldo corrido solo se lee en orden cronológico, así que la hoja «Movimientos»
   va siempre de la más antigua a la más reciente (R7), aunque la pantalla esté ordenada de otra forma. Esto
   cambia lo que la 463 (R42) prometía para el archivo. ¿De acuerdo?
3. **«1 orden» o «1 guía» en Detalle.** Se usa «1 orden», como en el ejemplo del humano (R18), aunque la
   hoja 2 diga «guía». ¿O se prefiere «1 guía» para que las dos hojas hablen igual?
4. **El detalle en pantalla cambia.** Por R28, al abrir en pantalla una fila de contra-entrega, pago al
   mensajero o indemnización de la caja, o de pago devengado del mensajero, ya no sale el aviso «no se
   reparte por orden»: sale la lista de órdenes con su monto. ¿De acuerdo con que la pantalla gane eso en
   esta misma ficha?
5. **Pago tomado del efectivo (mensajero).** Va en «Movimientos sin guía» (R43), no repartido. ¿Correcto?

## Aprobación

Aprobado por el humano el 2026-10-02 con las propuestas por defecto: (1) columna «Cobrado a tiendas» solo en la caja; (2) kardex siempre cronológico ascendente; (3) «Detalle» dice «N guía(s)», no «orden»; (4) el detalle en pantalla de los cuatro conceptos pasa a listar órdenes en esta ficha; (5) el pago tomado del efectivo del mensajero va en «Movimientos sin guía» sin repartir. T1 medido: 100 % cuadra (`progress/medicion_468.md`).
