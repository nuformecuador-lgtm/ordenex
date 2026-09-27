# Ficha 459 — La caja muestra el dinero real

**Zona:** fullstack. **SDD:** sí. **Complejidad:** alta. **Depende de:** nada. **Prioritaria:** la
pantalla de caja de producción enseña hoy cifras equivocadas.
**Va antes de** la 457 (la tienda le paga a Ordenex), que reutiliza piezas de esta (`design.md` §14).
**Absorbe** de la 458 la antigua hija 458-1b (sus R93–R97) y cierra sus preguntas P10, P15 y P16.

## El encargo (2026-09-24)

Dos fallos confirmados por verificación adversaria (`progress/verificacion_caja.md`) y medidos en
producción (`progress/medicion_457.md`):

- **F1 — faltan salidas.** Los 203 «cobros de un costo» de Nuform (₡25.769.034,50, del 2026-09-08
  al 2026-09-23) son pagos que Ordenex hizo **por cuenta** de Nuform con dinero de Ordenex. Se
  registraron como cobro porque no existía otro tipo, y el cobro no escribe en la caja.
- **F2 — ingresos contados dos veces.** La caja suma como entrada el contra-entrega completo **y
  además** el flete, la comisión y sus impuestos, que salen de ese mismo contra-entrega (o, si no
  hubo contra-entrega, quedan como deuda de la tienda). Sobrante medido: ₡8.070.773,47.

**Cambio de alcance del mismo día, decidido con el humano:** no existe la cifra real del dinero de
Ordenex en banco y efectivo, ni la habrá. La corrección se demuestra **por dentro y al céntimo**
contra el libro de las tiendas, y la tarjeta dice con honestidad lo que la app sabe: el flujo
registrado desde que empezó a usarse, salvo que algún día se registre un saldo inicial.

## Decisiones firmadas por el humano (no se reabren)

- **HF1** — Los 203 cobros de Nuform son pagos por cuenta de Nuform hechos con dinero de Ordenex.
- **HF2** — El saldo de cada tienda, la ganancia de Ordenex y lo de los mensajeros **están bien** y
  no cambian.
- **HF3** — «Ordenex hace cobros que va descontando del saldo a favor de las tiendas»; el saldo de
  una tienda **puede ser negativo**.
- **HF4** — No hay cifra real de arranque. **Nunca** se inventa ni se estima: el saldo inicial es
  opcional y solo lo teclea una persona.
- **HF5** — La lista de los 203 se revisa **fila a fila** antes de aplicar nada en producción
  (atención a «COMPRA 40 LEMME BURN», «ABONO TARJETA NUFORM CARLOS CASTILLO» y «FACEBOOK IVA»).
- **HF6** — «Cobrar un costo a una tienda» sigue sin mover la caja.
- Heredadas de la 458: comprobante **opcional** (H1); beneficiarios con **nombre libre** (H2);
  anular = motivo obligatorio + contra-asiento visible, nada se borra (H5); ningún identificador
  interno se muestra, se pide ni se descarga (H6).

## Glosario

- **Entrada de efectivo:** un ingreso de la caja que es dinero que entró de verdad (contra-entrega
  cobrado, reverso de un pago, ajuste que suma, saldo inicial o aporte).
- **Cargo a una tienda:** el flete, el flete por rechazo, la comisión de contra-entrega y el
  impuesto de cada uno. Es la parte de Ordenex que se **descuenta del saldo** de la tienda; no es
  dinero que entre aparte.
- **Flujo registrado:** entradas de efectivo menos salidas, desde el primer movimiento de la caja.
- **Saldo inicial:** el dinero que Ordenex tenía al empezar a usar la app, tecleado por una persona.
- **Aporte de capital:** dinero de Ordenex que entra a la caja y no es ganancia.
- **Capital de Ordenex:** saldos iniciales y aportes vigentes, menos sus anulaciones.
- **Dinero en caja:** saldo inicial más flujo registrado. Solo existe si hay un saldo inicial
  vigente.
- **Cifra principal de la caja:** la cifra grande de la tarjeta; es el flujo registrado o el dinero
  en caja según el estado de la caja.
- **Estado de la caja:** «saldo» si hay un saldo inicial vigente; «flujo» en cualquier otro caso.
- **De las tiendas:** lo que Ordenex les debe, en conjunto, a las tiendas. Puede ser negativo: en
  ese caso son las tiendas las que le deben a Ordenex.
- **De Ordenex:** ganancia de Ordenex más capital de Ordenex.
- **Pago por cuenta de una tienda:** dinero que Ordenex **saca de la caja** para pagarle a un
  tercero en nombre de la tienda (su proveedor, su publicidad, su personal). Baja la caja y baja el
  saldo de la tienda.
- **Cobrar un costo a una tienda:** un cargo de Ordenex a la tienda. Baja el saldo de la tienda y
  **no** mueve la caja.
- **Cobro reclasificado:** un cobro de un costo ya registrado que la lista aprobada declara pago por
  cuenta, y al que se le añade su salida de caja.
- **Lista aprobada:** la lista de cobros que el humano revisó fila a fila y aprobó reclasificar.
- **Vigente:** registrado y no anulado.
- **Acceso total:** los roles maestro y admin.

## Requisitos (EARS)

### A — La derivación de la caja (solo lectura: ninguna fila cambia)

**R1** — El sistema DEBE clasificar cada concepto de la caja, además de por su dueño, como entrada o
salida de efectivo o como cargo a una tienda, y DEBEN ser cargos a una tienda exactamente el flete,
el flete por rechazo, la comisión de contra-entrega y el impuesto de cada uno de esos tres.

**R2** — El sistema DEBE calcular «Entró» como la suma de los ingresos de la caja que no son cargos a
una tienda, y «Salió» como la suma de todos los egresos de la caja.

**R3** — El sistema DEBE calcular la cifra principal de la caja como «Entró» menos «Salió».

**R4** — El sistema DEBE calcular la ganancia de Ordenex como ingresos propios menos egresos
propios, contando los cargos a una tienda como ingresos propios, de modo que para el mismo conjunto
de movimientos valga exactamente lo mismo que antes de esta ficha.

**R5** — El sistema DEBE calcular «De las tiendas» como el dinero de las tiendas que entró en la caja
(contra-entrega cobrado, pagos a tienda anulados, pagos por cuenta anulados) menos el que salió hacia
ellas o por su cuenta (pagos a tienda, pagos por cuenta) menos los cargos a una tienda.

**R6** — El sistema DEBE calcular el capital de Ordenex como la suma de los saldos iniciales y
aportes de capital menos la de sus anulaciones.

**R7** — El sistema DEBE cumplir al céntimo, para cualquier conjunto de movimientos de la caja con o
sin filtros: cifra principal = ganancia de Ordenex + «De las tiendas» + capital de Ordenex.

**R8** — El sistema DEBE cumplir al céntimo, sobre el libro entero: «De las tiendas» = suma de los
saldos de todas las tiendas + suma de los cobros de un costo que no están reclasificados.

**R9** — SI un concepto de la caja o del libro de las tiendas existe sin que se haya declarado su
dueño, si es efectivo o cargo a una tienda, y su contrapartida en el otro libro, ENTONCES el gate
DEBE fallar.

**R10** — El sistema DEBE producir las cifras de R2 a R8 sin crear, modificar ni borrar ninguna fila
de ningún libro.

**R11** — El sistema DEBE repartir la barra de composición entre «De las tiendas» y «De Ordenex», con
las mismas cuatro formas de hoy evaluadas sobre esas dos cifras.

**R12** — La métrica de analítica «dinero en caja» DEBE valer, en su total y en cada tramo de tiempo,
lo mismo que la cifra principal de R3 sobre el mismo conjunto de movimientos, y la métrica «ganancia
de Ordenex» DEBE valer lo mismo que antes de esta ficha.

**R13** — La serie de finanzas por día DEBE informar como ingresos de cada día la suma de sus
entradas de efectivo de R2, y su ganancia, sus egresos, su pago a mensajeros y su pago a tiendas
DEBEN valer lo mismo que antes de esta ficha.

### B — Lo que dice la tarjeta de la caja

**R14** — El sistema DEBE decidir en el servidor el estado de la caja: «saldo» si existe un saldo
inicial vigente y «flujo» en cualquier otro caso.

**R15** — MIENTRAS el estado sea «flujo» y no haya filtros, la tarjeta DEBE rotular la cifra
principal «Flujo de dinero registrado», decir desde qué día cuenta (el día, en Costa Rica, del primer
movimiento de la caja) y decir en texto visible que no es el saldo del banco.

**R16** — MIENTRAS el estado sea «flujo», el sistema NO DEBE usar las palabras «Dinero en caja» en
ningún rótulo, pista, aviso ni nombre accesible de la tarjeta ni de la barra.

**R17** — SI el estado es «flujo», no hay filtros y la cifra principal es negativa, ENTONCES la
tarjeta DEBE mostrar una línea que explique que parte de los pagos se hicieron con dinero que
Ordenex ya tenía antes de usar la app y que ese dinero no está registrado.

**R18** — MIENTRAS el estado sea «saldo» y no haya filtros, la tarjeta DEBE rotular la cifra
principal «Dinero en caja» y explicar que es el saldo inicial registrado más lo que entró menos lo
que salió desde entonces.

**R19** — SI el estado es «saldo», no hay filtros y la cifra principal es negativa, ENTONCES la
tarjeta DEBE avisar que el dinero en caja no puede ser negativo y que hay que revisar el saldo
inicial y los pagos registrados.

**R20** — MIENTRAS haya filtros puestos, la tarjeta DEBE rotular la cifra principal «Movimiento neto
del periodo», en cualquiera de los dos estados.

**R21** — CUANDO se registre un saldo inicial, la tarjeta DEBE mostrarse en estado «saldo» en la
siguiente lectura; y CUANDO se anule el saldo inicial vigente, DEBE volver al estado «flujo».

**R22** — MIENTRAS el estado sea «flujo», la tarjeta NO DEBE pintar la barra de reparto ni sus
mensajes; MIENTRAS sea «saldo», DEBE pintarlos.

**R23** — La tarjeta DEBE rotular «De las tiendas» como lo que Ordenex les debe a las tiendas,
explicar en texto visible que es la suma de sus saldos ya descontados el flete, la comisión y el
impuesto, y SI la cifra es negativa, ENTONCES DEBE decir en palabras que son las tiendas las que le
deben a Ordenex y cuánto.

**R24** — El sistema NO DEBE mostrar en ninguna superficie que «De las tiendas» es mayor que lo que
se les debe a las tiendas, ni que la cifra principal cuenta el flete, la comisión o el impuesto
aparte del contra-entrega.

**R25** — La tarjeta DEBE mostrar el capital de Ordenex como cifra propia junto a la ganancia, y la
ganancia con el mismo rótulo y el mismo valor que antes de esta ficha.

**R26** — Cada mensaje de las formas de la barra DEBE describir la situación con el significado de
R5 y R11 (textos de `design.md` §3.4).

**R27** — El sistema NO DEBE proponer, precalcular, sugerir ni rellenar ningún importe de saldo
inicial ni de aporte de capital en ninguna pantalla, texto, aviso o acción.

**R28** — Todo importe de la tarjeta, del libro y del diálogo DEBE llegar del servidor como texto, y
el navegador NO DEBE convertirlo a número ni hacer aritmética con él.

### C — Pago por cuenta de una tienda (base: R93–R97 de la 458)

**R29** — CUANDO una persona con acceso total registre un pago por cuenta de una tienda, el sistema
DEBE escribir en una sola transacción el documento del pago, una salida de dinero de las tiendas en
la caja, un cargo en el libro de esa tienda y la fila del historial de acciones, con el mismo monto y
la misma fecha; SI cualquiera de esas escrituras falla, ENTONCES NO DEBE quedar ninguna.

**R30** — El documento del pago por cuenta DEBE quedar asociado a la tienda, al beneficiario (nombre
libre), al monto, al método de pago, a la fecha del pago, al motivo, a quién lo registró y a cuándo,
y —si se aportan— a una referencia y a un comprobante.

**R31** — SI el beneficiario está vacío una vez recortados los espacios o supera 120 caracteres,
ENTONCES el sistema DEBE rechazar el registro señalando el campo del beneficiario y NO DEBE escribir
nada.

**R32** — SI el monto no es un número mayor que cero con hasta dos decimales, o supera el máximo que
la columna puede representar, ENTONCES el sistema DEBE rechazar el registro señalando el campo del
monto y NO DEBE escribir nada.

**R33** — SI el motivo está vacío una vez recortados los espacios o supera 200 caracteres, ENTONCES el
sistema DEBE rechazar el registro señalando el campo del motivo y NO DEBE escribir nada.

**R34** — SI el método es SINPE o transferencia y no hay referencia, o la referencia supera 60
caracteres una vez recortada, ENTONCES el sistema DEBE rechazar el registro señalando el campo de la
referencia y NO DEBE escribir nada.

**R35** — SI la fecha no existe en el calendario, es posterior al día de hoy en Costa Rica o es
anterior a la ventana admitida para los movimientos manuales, ENTONCES el sistema DEBE rechazar el
registro señalando el campo de la fecha y NO DEBE escribir nada.

**R36** — SI la tienda indicada no existe, no es una cuenta de tienda o no está activa, ENTONCES el
sistema DEBE rechazar el registro señalando el campo de la tienda y NO DEBE escribir nada.

**R37** — SI la petición de registro o de anulación trae un campo no previsto (incluido un monto en
la anulación), ENTONCES el sistema DEBE rechazarla como error de validación sin escribir nada.

**R38** — SI quien registra o anula un pago por cuenta no tiene acceso total, ENTONCES el sistema DEBE
rechazarlo como prohibido antes de leer ningún saldo ni documento; y SI no hay sesión, ENTONCES DEBE
rechazarlo como no autenticado sin escribir nada.

**R39** — CUANDO un pago por cuenta quede registrado, la cifra principal de la caja y «De las
tiendas» DEBEN bajar exactamente en el monto, el saldo de la tienda DEBE bajar exactamente en el
monto, y NO DEBEN cambiar la ganancia de Ordenex, el capital, el libro de ninguna otra tienda ni el
de ningún mensajero.

**R40** — SI el pago por cuenta deja el saldo de la tienda en contra, ENTONCES el sistema DEBE
registrarlo igualmente y devolver el saldo resultante con su signo.

**R41** — CUANDO llegue un segundo registro con una clave de idempotencia ya usada, el sistema DEBE
responder con el pago original y el saldo actual de su tienda, sin escribir ninguna fila nueva y sin
conservar ningún comprobante adicional.

**R42** — El sistema DEBE tomar, al registrar y al anular un pago por cuenta, el mismo bloqueo de
tienda que toma el pago de Ordenex a esa tienda, de modo que las dos operaciones sobre la misma
tienda no puedan evaluarse sobre el mismo saldo.

**R43** — El sistema DEBE describir el cargo en el libro de la tienda con el beneficiario, el motivo
y el método (y la referencia si la hay), y la salida en la caja además con el nombre de la tienda;
ninguna de las dos descripciones DEBE contener un identificador interno.

**R44** — El sistema DEBE mostrar el cargo de un pago por cuenta en `/mi-wallet` y en el desglose de
`/wallet/tiendas` (tabla, filtro y descarga) con un nombre de concepto propio, distinto de «Cobro de
Ordenex» y de cualquier otro, junto con su beneficiario, su motivo y su referencia.

**R45** — El sistema DEBE mostrar la salida de un pago por cuenta en el libro de la caja de `/wallet`
(tabla, filtro y descarga) con un nombre de concepto propio, con su dueño presentado como «Tienda» y
con un origen legible.

**R46** — CUANDO una persona con acceso total anule un pago por cuenta indicando un motivo, el sistema
DEBE, en una sola transacción, dejar constancia de la anulación (motivo, quién y cuándo), añadir al
libro de la tienda un abono compensatorio por el monto del documento, añadir a la caja una entrada de
dinero de las tiendas por el mismo monto y escribir la fila del historial; SI cualquiera falla,
ENTONCES NO DEBE quedar ninguna.

**R47** — Los asientos compensatorios de R46 DEBEN fecharse el día de la anulación en Costa Rica, y la
anulación NO DEBE editar ni borrar el documento, sus asientos originales ni su comprobante.

**R48** — CUANDO se anule un pago por cuenta, la cifra principal, «De las tiendas» y el saldo de la
tienda DEBEN volver a subir exactamente en el monto, y NO DEBEN cambiar la ganancia ni el capital.

**R49** — SI el motivo de la anulación está vacío una vez recortados los espacios, ENTONCES el sistema
DEBE rechazarla sin escribir nada.

**R50** — CUANDO se intente anular un pago por cuenta ya anulado, o lleguen dos anulaciones del mismo
pago a la vez, el sistema DEBE dejar una sola anulación y responder a la otra que ya estaba anulado,
sin escribir nada más.

**R51** — SI el pago por cuenta que se quiere anular no existe, ENTONCES el sistema DEBE responder que
no se encontró sin escribir nada.

**R52** — El sistema NO DEBE ofrecer ninguna forma de editar un pago por cuenta ni de deshacer su
anulación.

**R53** — CUANDO se registre o se anule un pago por cuenta, el sistema DEBE dejar en el historial de
acciones una fila de un tipo propio para cada una de las dos acciones, clasificada como acción que
mueve dinero, con quién, cuándo, el importe y el nombre de la tienda, y sin el motivo, la referencia,
el beneficiario ni ningún otro texto libre.

### D — El comprobante

**R54** — DONDE se aporte un comprobante, el sistema DEBE aceptar solo imágenes JPEG, PNG o WebP y
documentos PDF de hasta 4 MB, y SI no lo es, ENTONCES DEBE rechazar el registro señalando el campo
del comprobante sin escribir nada.

**R55** — DONDE se aporte un comprobante, el sistema DEBE guardarlo en almacenamiento privado, sin URL
pública, con un nombre de objeto que no contenga el identificador de la tienda, del documento ni de
ningún usuario.

**R56** — SI el comprobante no se puede guardar, ENTONCES el sistema NO DEBE registrar el movimiento y
DEBE decir que el comprobante no se pudo guardar; y SI, con el comprobante ya guardado, el registro
no se completa por cualquier motivo, ENTONCES el sistema DEBE retirar ese comprobante.

**R57** — CUANDO una persona con acceso total pida ver el comprobante de un pago por cuenta o de un
saldo inicial o aporte, o la tienda dueña pida el de un pago por cuenta suyo, el sistema DEBE
devolver un enlace temporal de vida acotada; SI quien lo pide es una tienda y el pago no es suyo o no
existe, ENTONCES DEBE responder que no se encontró sin distinguir los dos casos; y SI no hay
comprobante, ENTONCES DEBE responder que no tiene.

**R58** — El sistema NO DEBE incluir la ubicación de ningún comprobante en ninguna descarga ni en
ninguna respuesta, salvo el enlace temporal de R57.

### E — El diálogo «Registrar movimiento»

**R59** — El diálogo «Registrar movimiento» de `/wallet` DEBE ofrecer siete conceptos en tres grupos
con encabezado: «Sale dinero de la caja» (gasto variable, sueldo, pago por cuenta de una tienda,
ajuste que resta), «Entra dinero a la caja» (saldo inicial o aporte de capital, ajuste que suma) y
«No mueve la caja» (cobrar un costo a una tienda).

**R60** — CUANDO el usuario elija un concepto, el diálogo DEBE mostrar una frase visible que diga qué
le pasa con ese concepto a la caja, al saldo de la tienda (si la afecta) y a la ganancia de Ordenex,
y las frases de «Pago por cuenta de una tienda» y «Cobrar un costo a una tienda» DEBEN decir, una,
que sale dinero de la caja y, la otra, que no sale.

**R61** — CUANDO el concepto elegido sea «Pago por cuenta de una tienda», el diálogo DEBE pedir la
tienda, a quién se le pagó, el monto, la fecha, el motivo, el método, la referencia cuando el método
la exija y un comprobante opcional, y NO DEBE enviar al servidor claves de ningún otro concepto.

**R62** — MIENTRAS el concepto elegido sea «Pago por cuenta de una tienda», el diálogo DEBE decir en
texto visible, antes de confirmar, que si la tienda no tiene saldo suficiente su saldo quedará en
contra.

**R63** — CUANDO un pago por cuenta se registre con éxito, el diálogo DEBE avisar con el saldo
resultante de la tienda que devolvió el servidor, con su signo, y SI queda en contra, ENTONCES DEBE
decir en palabras que la tienda le debe ese dinero a Ordenex.

**R64** — El concepto «Cobrar un costo a una tienda» DEBE conservar su efecto actual —una fila en el
libro de la tienda, ninguna en la caja, el mismo historial— y sus textos actuales, con la única
adición de la frase de R60.

**R65** — CUANDO se registre o se anule un movimiento desde `/wallet`, el sistema DEBE actualizar sin
recargar la página la tarjeta de la caja, el libro y la composición de la ganancia.

**R66** — El libro de la caja DEBE ofrecer «Anular…» (con motivo obligatorio) en la fila original de
cada pago por cuenta y de cada saldo inicial o aporte vigentes, DEBE mostrar como «Anulado» los ya
anulados, y NO DEBE ofrecerlo en los contra-asientos ni en las salidas de los cobros reclasificados.

**R67** — DONDE una fila del libro de la caja sea un pago por cuenta o un saldo inicial o aporte con
comprobante, el libro DEBE ofrecer «Ver comprobante».

### F — Saldo inicial y aporte de capital (opcional)

**R68** — CUANDO una persona con acceso total registre un saldo inicial o un aporte de capital, el
sistema DEBE escribir en una sola transacción el documento (clase, monto, fecha, motivo, quién,
cuándo y, si se aporta, comprobante), una entrada de capital en la caja y la fila del historial; SI
cualquiera falla, ENTONCES NO DEBE quedar ninguna.

**R69** — SI falta la clase (saldo inicial o aporte de capital), el monto no es válido según R32, el
motivo no es válido según R33, la fecha no existe o es posterior al día de hoy en Costa Rica, o la
petición trae un campo no previsto, ENTONCES el sistema DEBE rechazar el registro señalando el campo
y NO DEBE escribir nada.

**R70** — SI ya existe un saldo inicial vigente y se intenta registrar otro, incluso a la vez,
ENTONCES el sistema DEBE rechazarlo diciendo que ya hay uno y NO DEBE escribir nada.

**R71** — SI la fecha de un saldo inicial es posterior al día, en Costa Rica, del primer movimiento de
la caja que no sea de capital, ENTONCES el sistema DEBE rechazarla indicando el último día admitido.

**R72** — CUANDO se registre un saldo inicial o un aporte, la cifra principal y el capital de Ordenex
DEBEN subir exactamente en el monto, y NO DEBEN cambiar la ganancia de Ordenex, su composición,
«De las tiendas», ningún saldo de tienda, ningún libro de mensajero ni las métricas de ingresos de
Ordenex.

**R73** — CUANDO llegue un segundo registro con una clave de idempotencia ya usada, el sistema DEBE
responder con el documento original sin escribir nada.

**R74** — CUANDO una persona con acceso total anule un saldo inicial o un aporte con un motivo, el
sistema DEBE, en una sola transacción, dejar constancia de la anulación, añadir a la caja una salida
de capital por el monto del documento fechada el día de la anulación en Costa Rica y escribir la fila
del historial; y las reglas de R49, R50 y R51 DEBEN valer también aquí.

**R75** — La anulación de un saldo inicial o aporte NO DEBE cambiar la ganancia de Ordenex, «De las
tiendas» ni ningún saldo de tienda.

**R76** — SI quien registra o anula un saldo inicial o aporte no tiene acceso total, ENTONCES el
sistema DEBE rechazarlo como prohibido antes de leer nada; y SI no hay sesión, ENTONCES como no
autenticado.

**R77** — El sistema DEBE mostrar la entrada de un saldo inicial o aporte en el libro de la caja
(tabla, filtro y descarga) con un nombre de concepto propio que diga su clase, con su dueño
presentado como «Ordenex (capital)» y con un origen legible.

**R78** — CUANDO se registre o se anule un saldo inicial o aporte, el sistema DEBE dejar en el
historial una fila de un tipo propio para cada una de las dos acciones, clasificada como acción que
mueve dinero, con quién, cuándo y el importe, y sin el motivo ni ningún otro texto libre.

### G — Reclasificación de los cobros que eran pagos por cuenta

**R79** — El sistema DEBE disponer de una consulta de solo lectura que liste todos los cobros de un
costo con su tienda, su día en Costa Rica, su monto, su descripción, quién lo registró y una marca en
los que no empiezan por «pago», más el número de filas y la suma total.

**R80** — La migración de reclasificación DEBE contener exactamente las filas de la lista aprobada
por el humano (identificador, tienda y monto de cada una), y el gate DEBE fallar si difieren en una
sola fila, en el número de filas o en la suma.

**R81** — CUANDO se aplique la migración de reclasificación, el sistema DEBE escribir, por cada cobro
de la lista aprobada, una salida de dinero de las tiendas en la caja por el mismo monto, con el mismo
instante de fecha que el cobro y vinculada a él, y NO DEBE modificar ni borrar la fila del cobro ni
ninguna otra fila.

**R82** — SI algún cobro de la lista aprobada existe en la base pero no es un cobro de un costo, no
es de la tienda aprobada o no tiene el monto aprobado, ENTONCES la migración DEBE fallar sin escribir
nada.

**R83** — SI solo algunos de los cobros de la lista aprobada existen en la base, ENTONCES la migración
DEBE fallar sin escribir nada; y SI no existe ninguno, ENTONCES DEBE terminar sin escribir nada.

**R84** — SI al terminar la migración el número de salidas escritas o su suma no coinciden con los de
la lista aprobada, ENTONCES la migración DEBE fallar sin dejar nada escrito.

**R85** — CUANDO la migración de reclasificación se aplique dos veces, el sistema DEBE dejar una sola
salida por cobro.

**R86** — CUANDO se revierta la migración de reclasificación, el sistema DEBE borrar exactamente las
salidas que ella escribió y ninguna otra fila.

**R87** — El sistema DEBE mostrar las salidas de los cobros reclasificados en el libro de la caja con
el concepto de pago por cuenta, dueño «Tienda» y un origen legible que diga que es un cobro
reclasificado, y NO DEBE cambiar lo que la tienda ve de esos cobros en su libro.

**R88** — El sistema NO DEBE aplicar en producción la migración de reclasificación sin que la lista
aprobada fila a fila por el humano esté registrada en el repositorio.

### H — La comprobación de corrección (sin cifra real)

**R89** — Sobre un escenario que ejerza todos los caminos que escriben en la caja o en el libro de
las tiendas, el sistema DEBE cumplir R7 y R8 al céntimo, y la ganancia y la cuenta por pagar de cada
mensajero DEBEN valer los literales fijados antes de esta ficha.

**R90** — El gate DEBE fallar si algún concepto del libro de las tiendas no declara su contrapartida
en la caja, si una contrapartida no mueve «De las tiendas» en el mismo sentido y por el mismo importe
que el concepto mueve el saldo de la tienda, o si algún concepto de la caja que mueve «De las
tiendas» no es la contrapartida de exactamente un concepto del libro de las tiendas.

**R91** — Antes de desplegar a producción, el contraste de solo lectura (`design.md` §11) DEBE dar
0,00 en la diferencia de R8 y en la de R7, y la ganancia DEBE ser la misma con la fórmula de antes y
con la de ahora; SI alguna diferencia no es 0,00, ENTONCES no se despliega.

### I — No regresión

**R92** — Para los mismos datos, el saldo y el desglose de cada tienda DEBEN valer exactamente lo
mismo antes y después de esta ficha.

**R93** — Para los mismos datos, la ganancia de Ordenex, su composición por concepto y el desglose
de egresos DEBEN valer exactamente lo mismo antes y después de esta ficha.

**R94** — Para los mismos datos, la cuenta por pagar de cada mensajero y su libro DEBEN valer
exactamente lo mismo antes y después de esta ficha.

**R95** — Registrar, repartir y anular pagos a tiendas y a mensajeros DEBE conservar sus asientos,
sus topes, su idempotencia, su historial y sus textos.

**R96** — La generación, aprobación, rechazo y reversa de los cobros de gasto fijo, la cola y la
decisión de los cobros por rechazo, el registro y la anulación de premios del ranking y la
aprobación de cierres DEBEN conservar sus asientos en los tres libros y su comportamiento.

**R97** — Los pagos por cuenta y los saldos iniciales o aportes NO DEBEN aparecer en la lista de
pagos a una tienda, ni sumarse a lo pagado a una tienda, ni ser tomados por el registro retroactivo
de la caja de la feature 173.

**R98** — Revertir las migraciones de estructura de esta ficha sobre una base sin ninguna fila que
use lo que añaden DEBE devolver catálogos, restricciones y tablas exactamente a su estado previo, y
SI existe alguna fila que lo use, ENTONCES la reversión DEBE fallar sin borrar ningún dato.

**R99** — Toda tabla nueva de esta ficha DEBE tener la seguridad por filas activada.

**R100** — El sistema NO DEBE mostrar, pedir ni descargar ningún identificador interno en las
superficies que esta ficha toca.

## Trazabilidad prevista (R → test)

El detalle está en `design.md` §17; el implementer fija las rutas finales en `progress/impl_459.md`.

| Requisitos | Test previsto |
| --- | --- |
| R1–R7, R10, R11 | `tests/unit/utils/caja-derivacion-459.test.ts` |
| R8, R89 | `tests/integration/db/caja-invariante-tiendas.test.ts` |
| R9, R90 | `tests/unit/guards/caja-clasificacion-459.guardia.test.ts` |
| R12 | `tests/unit/analytics/metrics-caja-naturaleza.guardia.test.ts`, `tests/unit/services/analitica-financiera-service.test.ts` |
| R13 | `tests/unit/analytics/finanzas-diario.test.ts` |
| R14, R21 | `tests/unit/services/wallet-service.test.ts` + `tests/integration/db/aporte-capital.test.ts` |
| R15–R20, R22–R26 | `tests/components/CajaResumenCard.test.tsx`, `tests/components/CajaComposicionBarra.test.tsx`, `tests/components/DineroIdentidadesEnPantalla.test.tsx` |
| R16, R24, R27 | `tests/unit/guards/caja-textos-459.guardia.test.ts` |
| R28 | guardias money-safe existentes + `tests/integration/wallet-page.test.tsx` |
| R29–R43, R46–R52 | `tests/unit/services/pago-por-cuenta-tienda-service.test.ts`, `tests/unit/types/pago-por-cuenta-tienda-schema.test.ts`, `tests/integration/db/pago-por-cuenta-tienda.test.ts`, `tests/integration/db/pago-por-cuenta-tienda-concurrencia.test.ts`, `tests/unit/utils/descripcion-pago-por-cuenta.test.ts` |
| R44 | `tests/integration/mi-wallet-page.test.tsx`, `tests/unit/components/mi-wallet-labels.test.ts` |
| R45, R77, R87 | `tests/unit/components/wallet-labels.test.ts`, `tests/components/descarga/WalletDescarga.test.tsx` |
| R53, R78 | `tests/unit/historial-accion/catalogo-y-choke-point.test.ts` + guardias del censo de historial |
| R54–R58 | `tests/unit/services/wallet-comprobante.test.ts` |
| R59–R64 | `tests/unit/components/wallet-conceptos-manuales.test.ts`, `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` |
| R65–R67 | `tests/components/WalletLedgerAcciones459.test.tsx` |
| R68–R76 | `tests/unit/services/aporte-capital-service.test.ts`, `tests/integration/db/aporte-capital.test.ts` |
| R79 | `design.md` §11 C3 (la corre el leader) |
| R80, R88 | `tests/unit/guards/reclasificacion-459-lista.guardia.test.ts` |
| R81–R86 | `tests/integration/db/reclasificacion-459-migration.test.ts` |
| R91 | `progress/contraste_459.md` (C1–C2 de `design.md` §11, antes y después) |
| R92–R96 | `tests/integration/db/caja-caracterizacion-459.test.ts` (FASE 0) + informe de mutaciones |
| R97 | `tests/integration/db/pago-por-cuenta-tienda.test.ts` (listas de pagos y backfill) |
| R98, R99 | `tests/integration/db/caja-459-migration.test.ts` |
| R100 | `tests/unit/descarga/columnas-sensibles.guardia.test.ts` + casos nuevos en los tests de componente |

## Preguntas abiertas — decisión tomada y alternativa (no bloquean)

**P1 — ¿Cómo se clasifica el saldo inicial o aporte para que no infle la ganancia?** *Decisión:* un
tercer dueño, «capital», al lado de «propio» y «terceros»: suma a la cifra principal y a «De
Ordenex», no a la ganancia ni a «De las tiendas». *Alternativa:* `ingreso_ajuste` (propio), que
sube la ganancia en una cifra que no se ganó; o «terceros», que rompería R8.

**P2 — ¿Qué es «De Ordenex» en la barra?** *Decisión:* ganancia + capital: el capital es dinero de
Ordenex. *Alternativa:* solo la ganancia, con el capital como tercer segmento (rediseño de la
barra).

**P3 — Los cobros de un costo quedan fuera de la invariante (R8).** Un cobro de un costo genuino baja
el saldo de la tienda sin pasar por la caja (HF6), así que «De las tiendas» y la suma de saldos
difieren en su importe. *Decisión:* se declara la excepción en R8 y en la tarjeta; tras reclasificar
los 203, la excepción vale 0,00 en producción. *Alternativa (ficha aparte, es dinero):* que el
cobro de un costo escriba un cargo a una tienda en la caja, como ya hace el cobro por rechazo; subiría
la ganancia y cerraría la excepción.

**P4 — ¿La tienda inactiva admite un pago por cuenta?** *Decisión:* no (R36), igual que el cobro de un
costo y porque el diálogo solo lista tiendas activas. *Alternativa:* admitirla, como decidió la 457
para el pago recibido.

**P5 — ¿Qué ve la tienda en los 203 cobros reclasificados?** *Decisión:* lo mismo que hoy (R87): su
fila no se toca y su saldo ya era correcto; la 458 decide cómo rotularlos en el estado de cuenta.
*Alternativa:* re-rotularlos al leer, vía el vínculo con la caja, como «Pago por cuenta»; mezcla un
filtro por concepto (dice «cobro») con un rótulo que dice otra cosa.

**P6 — Fecha de los contra-asientos de una anulación.** *Decisión:* el día de la anulación (R47,
R74), como el pago a tienda (172) y el pago recibido (457). *Alternativa:* la fecha original, que
reescribe periodos ya vistos.

**P7 — Fecha del saldo inicial.** *Decisión:* sin ventana hacia atrás, y como mucho el día del primer
movimiento de la caja (R71), para que «Dinero en caja» = saldo inicial + flujo tenga sentido.
*Alternativa:* la ventana de 30 días de los movimientos manuales, que ya hoy impediría fechar el
saldo inicial en el día en que empezó producción.

**P8 — ¿El saldo inicial o aporte pide método y referencia?** *Decisión:* no; pide clase, monto,
fecha, motivo y comprobante opcional (lo pedido). *Alternativa:* añadir método y referencia como en
los pagos.

**P9 — ¿Quién figura como «registró» en las salidas reclasificadas?** *Decisión:* la persona que
registró el cobro original. *Alternativa:* nadie («Automático»), con la autoría en el informe de la
reclasificación.

**P10 — ¿Puede la tienda abrir el comprobante desde `/mi-wallet`?** *Decisión:* el servidor lo
permite (R57) pero el botón en `/mi-wallet` llega con el estado de cuenta de la 458 (458-4).
*Alternativa:* un enlace mínimo en la fila del libro de la tienda ya en esta ficha.

**P11 — «Así queda» antes de confirmar (R97 de la 458).** *Decisión:* aquí solo la frase fija de R62 y
el aviso con el saldo real tras registrar (R63); el recuadro calculado por el servidor llega con la
458-3. *Alternativa:* adelantar la previsualización del servidor solo para este concepto.

**P12 — Reversión de los valores nuevos del historial.** El catálogo del historial es distinto en
`prod` (sin SF-001) y en `dev`. *Decisión:* el `down.sql` de esa migración recrea el tipo leyendo la
lista vigente de `pg_enum` y quitando solo los valores de esta ficha, de modo que valga en las dos
ramas. *Alternativa:* una lista fija por rama, que obliga a dos versiones del mismo archivo.

**P13 — ¿La métrica «egresos» cuenta los pagos por cuenta?** *Decisión:* sí (es dinero que salió de
la caja, como el pago a tienda) y no cuenta los reversos, como decidió la 457. *Alternativa:*
dejarla como está y documentarlo.

**P14 — ¿Admin puede registrar y anular un saldo inicial?** *Decisión:* sí, maestro y admin, como se
pidió. *Alternativa:* solo maestro.

**P15 — Con el interruptor `TIENDA_DEBITA_FLETE_DEVOLUCION` apagado, R8 no se cumple** (la caja
anota el flete por rechazo y la tienda no lo paga). *Decisión:* en producción está encendido
(medido: débitos = ingresos propios); se declara el límite y el contraste lo vigila.
*Alternativa:* que la derivación lea el interruptor (una función pura dependiendo de configuración).

**P16 — ¿Sale esta ficha sola a producción o con SF-001?** No se decide aquí. `design.md` §15 dice
qué haría falta para sacarla por la vía de §2 bis de `docs/release.md` y propone partirla en tres
entregas; la primera (la derivación y la tarjeta) no lleva migración.

**P17 — Textos.** *Decisión:* los de `design.md` §3.4 y §9. *Alternativa:* los que el humano ajuste al
revisar este spec; cambiarlos cuesta una línea por texto.
