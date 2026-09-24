# Ficha 457 — la tienda le paga a Ordenex

**Zona:** fullstack (esta ficha es el BACKEND; la pantalla nueva es de la 458). **SDD:** sí.
**Complejidad:** media. **Depende de:** nada. **La consume:** 458 (rediseño de la wallet).

## El encargo, en palabras del humano (2026-09-24)

> Caso real: Nuform tiene en producción un saldo de **-6.170.666,55** y quiere pagarle a Ordenex.
> «Debe ser muy fácil comprender que fue un pago de esa tienda y por qué motivo.»

## Decisiones FIRMADAS por el humano (no se reabren)

- **DH1 — Entra a la caja como dinero de TERCEROS, no como ganancia.** Los fletes que la tienda
  debe ya se contaron como ganancia de Ordenex al aprobar cada cierre; contarlos otra vez al
  cobrarlos duplicaría la ganancia.
- **DH2 — Queda ASOCIADO:** la tienda, el motivo (obligatorio), el método, la referencia, la fecha
  real y un comprobante OPCIONAL.
- **DH3 — La tienda SÍ ve el comprobante** (y, por tanto, el motivo que se escribió).
- **DH4 — Ningún identificador interno se muestra, se pide ni se descarga.** Nadie teclea ni lee un
  uuid; los que viajan por detrás para pedir una acción no se pintan ni salen en un archivo.
- **DH5 — Molde:** `LiquidacionService.registrarPagoTienda` y su anulación (documento, clave de
  idempotencia, bloqueo de la tienda antes de leer el saldo, anulación entera con motivo y
  contra-asientos, historial en la misma transacción).
- **DH6 — La UI nueva es de la 458.** Aquí solo el mínimo para que las pantallas y descargas que
  ya existen no enseñen nada crudo.

## Qué cambia respecto de la decisión D3 de la ficha 381

D3 (firmada el 2026-09-07) dijo: «con respecto al abono no lo pongas, pues esto sí es automático».
Lo que D3 rechazó fue un **crédito manual sin dinero detrás**: una persona subiendo el disponible de
una tienda desde «Registrar movimiento», sin que entrara un colón a la caja. Esta ficha registra
algo distinto: **dinero real que entra**, con documento, método, referencia, fecha real y tope en
la deuda, y que se asienta en la caja en la misma transacción. El 2026-09-24 el humano lo pidió
expresamente y aprobó reabrir D3 para este caso. Lo que D3 protegía se conserva con los requisitos
del bloque I (ver `design.md` §10).

## Requisitos (EARS)

### A — Registrar un pago recibido: quién puede y con qué datos

**R1** — CUANDO una persona con acceso total (maestro o admin) registre un pago recibido de una
tienda, el sistema DEBE dejarlo asociado a esa tienda, a un monto, a un método de pago, a la fecha
real del pago, a un motivo, a quién lo registró y a cuándo, y —si se aportan— a una referencia y a
un comprobante.

**R2** — SI quien registra un pago recibido no tiene acceso total (incluida la propia tienda),
ENTONCES el sistema DEBE rechazarlo como prohibido sin leer el saldo de ninguna tienda y sin
escribir nada.

**R3** — SI no hay sesión, ENTONCES el sistema DEBE rechazar el registro como no autenticado sin
escribir nada.

**R4** — SI el monto no es un número mayor que cero con hasta dos decimales, o supera el máximo que
la columna puede representar, ENTONCES el sistema DEBE rechazarlo señalando el campo del monto y
NO DEBE escribir nada.

**R5** — El sistema DEBE tratar el monto como texto decimal desde el borde hasta la base, sin
convertirlo nunca a coma flotante, y el importe persistido en el documento, en el libro de la
tienda y en la caja DEBE ser el mismo, con dos decimales.

**R6** — SI el motivo está vacío una vez recortados los espacios, o supera 200 caracteres,
ENTONCES el sistema DEBE rechazar el registro señalando el campo del motivo y NO DEBE escribir nada.

**R7** — SI el método es SINPE o transferencia y no hay referencia, ENTONCES el sistema DEBE
rechazar el registro señalando el campo de la referencia.

**R8** — SI la referencia supera 60 caracteres una vez recortada, ENTONCES el sistema DEBE
rechazar el registro señalando el campo de la referencia.

**R9** — SI la fecha real del pago no existe en el calendario o es posterior al día de hoy en
Costa Rica, ENTONCES el sistema DEBE rechazar el registro señalando el campo de la fecha.

**R10** — SI la tienda indicada no existe o no es una cuenta de tienda, ENTONCES el sistema DEBE
rechazar el registro señalando el campo de la tienda y NO DEBE escribir nada.

**R11** — El sistema DEBE admitir el pago recibido de una tienda cuya cuenta no esté activa.

**R12** — SI la petición de registro trae un campo no previsto, ENTONCES el sistema DEBE
rechazarla como error de validación sin escribir nada.

### B — Las reglas del dinero

**R13** — MIENTRAS el saldo derivado de la tienda sea mayor o igual que cero, el sistema DEBE
rechazar el registro indicando que la tienda no tiene saldo en contra, y NO DEBE escribir nada.

**R14** — SI el monto supera lo que la tienda debe (el valor absoluto de su saldo en contra),
ENTONCES el sistema DEBE rechazar el registro informando del importe que la tienda debe, y NO DEBE
escribir nada.

**R15** — El sistema DEBE evaluar R13 y R14 contra el saldo leído DESPUÉS de tomar el bloqueo de esa
tienda, y ese bloqueo DEBE ser el mismo que toma el pago de Ordenex a esa tienda, de modo que dos
operaciones simultáneas de cualquiera de los dos tipos sobre la misma tienda no puedan evaluarse
sobre el mismo saldo.

**R16** — CUANDO se registre un pago recibido válido, el sistema DEBE escribir en UNA sola
transacción el documento del pago, un crédito en el libro de esa tienda por el monto, un ingreso
en la caja de Ordenex por el monto y la fila del historial de acciones; SI cualquiera de esas
escrituras falla, ENTONCES NO DEBE quedar ninguna.

**R17** — CUANDO un pago recibido quede registrado, el saldo de esa tienda DEBE subir exactamente en
el monto, y el sistema DEBE devolver el saldo resultante con su signo.

**R18** — El ingreso en la caja de R16 DEBE contarse como dinero de las tiendas (terceros): DEBE
sumar al dinero en caja y a la porción de las tiendas, y NO DEBE cambiar la ganancia de Ordenex ni
su desglose por concepto en ningún periodo **(DH1)**.

**R19** — El crédito en el libro de la tienda y el ingreso en la caja DEBEN fecharse con la fecha
real del pago, no con el instante del registro.

**R20** — El crédito en el libro de la tienda DEBE describirse con el motivo y el método de pago
(y la referencia si la hay), y el ingreso en la caja DEBE describirse además con el nombre de la
tienda; ninguna de las dos descripciones DEBE contener un identificador interno.

**R21** — Un pago recibido NO DEBE escribir en el libro de ninguna otra tienda, ni en el libro de
pagos a mensajeros, ni ninguna categoría de la caja que cuente como ganancia o gasto de Ordenex.

### C — Idempotencia

**R22** — CUANDO llegue un segundo registro con una clave de idempotencia ya usada, el sistema DEBE
responder con el pago original y el saldo actual de la tienda de ESE pago, sin escribir ninguna
fila nueva y sin conservar ningún comprobante adicional.

### D — El comprobante

**R23** — DONDE se aporte un comprobante, el sistema DEBE aceptar solo imágenes JPEG, PNG o WebP y
documentos PDF de hasta 4 MB, y SI no lo es, ENTONCES DEBE rechazar el registro señalando el campo
del comprobante sin escribir nada.

**R24** — DONDE se aporte un comprobante, el sistema DEBE guardarlo en almacenamiento privado, sin
URL pública, con un nombre de objeto que no contenga el identificador de la tienda, del pago ni de
ningún usuario.

**R25** — SI el comprobante aportado no se puede guardar, ENTONCES el sistema NO DEBE registrar el
pago y DEBE decir que el comprobante no se pudo guardar.

**R26** — SI, con un comprobante ya guardado, el registro no se completa —por un rechazo de negocio,
por una clave de idempotencia repetida o por un fallo de escritura—, ENTONCES el sistema DEBE
retirar ese comprobante del almacenamiento.

**R27** — El sistema DEBE permitir registrar un pago recibido sin comprobante.

### E — Anular un pago recibido

**R28** — CUANDO una persona con acceso total anule un pago recibido indicando un motivo, el sistema
DEBE, en UNA sola transacción, dejar constancia de la anulación (motivo, quién y cuándo), añadir al
libro de la tienda un débito compensatorio por el monto íntegro del pago, añadir a la caja un
egreso de dinero de las tiendas por el monto íntegro y escribir la fila del historial; SI cualquiera
falla, ENTONCES NO DEBE quedar ninguna.

**R29** — Los asientos compensatorios de R28 DEBEN fecharse el día de la anulación en Costa Rica.

**R30** — La anulación NO DEBE editar ni borrar el documento del pago, sus asientos originales ni su
comprobante.

**R31** — El monto de la anulación DEBE leerse del documento en el servidor; SI la petición de
anular trae un monto o cualquier otro campo no previsto, ENTONCES el sistema DEBE rechazarla como
error de validación sin escribir nada.

**R32** — SI el motivo de la anulación está vacío una vez recortados los espacios, ENTONCES el
sistema DEBE rechazarla sin escribir nada.

**R33** — CUANDO se intente anular un pago recibido ya anulado, el sistema DEBE responder que ya
estaba anulado, con la anulación original, sin escribir nada.

**R34** — SI quien anula no tiene acceso total, ENTONCES el sistema DEBE rechazarlo como prohibido
antes de leer el pago; y SI el pago no existe, ENTONCES DEBE responder que no se encontró.

**R35** — La anulación DEBE tomar el mismo bloqueo de tienda que R15 y DEBE devolver el saldo
resultante de la tienda, que PUEDE volver a ser negativo.

**R36** — La anulación NO DEBE cambiar la ganancia de Ordenex ni su desglose por concepto.

**R37** — El sistema NO DEBE ofrecer ninguna forma de editar un pago recibido ni de deshacer una
anulación.

### F — Consultar los pagos recibidos y su comprobante

**R38** — El sistema DEBE ofrecer a las personas con acceso total la lista de los pagos recibidos
de una tienda, incluidos los anulados, con monto, método, referencia, motivo, fecha real, nombre de
quien lo registró, instante del registro, si tiene comprobante y, si está anulado, motivo, nombre de
quien anuló e instante de la anulación.

**R39** — El sistema DEBE ofrecer a una tienda la lista de SUS pagos recibidos con los mismos datos
de R38, tomando la tienda de su sesión y nunca de la petición.

**R40** — SI una tienda pide su lista con un parámetro que nombre una tienda, ENTONCES el sistema
DEBE rechazarla como error de validación sin leer nada.

**R41** — SI quien pide cualquiera de las dos listas no es una persona con acceso total ni la tienda
dueña, ENTONCES el sistema DEBE rechazarlo como prohibido sin leer nada.

**R42** — Las listas de R38 y R39 NO DEBEN contener el identificador de la tienda, de ningún
usuario, la clave de idempotencia ni la ubicación del comprobante; el único identificador que viaja
es el del pago, que no se muestra.

**R43** — CUANDO una persona con acceso total, o la tienda dueña del pago, pida ver su comprobante,
el sistema DEBE devolver un enlace temporal de vida acotada.

**R44** — SI una tienda pide el comprobante de un pago que no es suyo o que no existe, ENTONCES el
sistema DEBE responder que no se encontró, sin distinguir entre los dos casos.

**R45** — SI el pago pedido no tiene comprobante, ENTONCES el sistema DEBE responder que no tiene
comprobante, sin generar ningún enlace.

### G — Las pantallas y descargas que ya existen, sin nada crudo

**R46** — CUANDO exista un pago recibido, su crédito DEBE aparecer en el libro de esa tienda en
`/mi-wallet` y en el desglose de `/wallet/tiendas` con un nombre de concepto que diga que es un pago
de la tienda a Ordenex y que sea distinto del de cualquier otro concepto.

**R47** — CUANDO se anule un pago recibido, su débito compensatorio DEBE aparecer en esos dos libros
con un nombre de concepto propio, distinto del de cualquier otro, que diga que es la anulación de un
pago de la tienda.

**R48** — CUANDO exista un pago recibido o su anulación, sus dos movimientos DEBEN aparecer en el
libro de la caja de `/wallet` con un nombre de concepto propio cada uno, con el dueño del dinero
presentado como «Tienda», y con un origen legible.

**R49** — El origen de los movimientos de R46, R47 y R48 DEBE presentarse con un nombre legible en
pantalla y en descarga, nunca con su valor técnico.

**R50** — Los filtros por concepto de `/mi-wallet`, `/wallet/tiendas` y `/wallet` DEBEN ofrecer los
conceptos nuevos con el mismo nombre con el que se ven en la tabla.

**R51** — Cada descarga de esos tres libros DEBE rotular los conceptos nuevos igual que su pantalla,
y NO DEBE incluir identificadores internos ni la ubicación de ningún comprobante.

**R52** — La cabecera del desglose de una tienda, en las dos pantallas, DEBE contar el pago recibido
dentro de «a favor» y su anulación dentro de «cargos», y el saldo de la cabecera DEBE seguir siendo
igual al saldo derivado del libro.

**R53** — Las aclaraciones de la cabecera que enumeran qué hay dentro de «a favor» y de «cargos», en
las dos pantallas, DEBEN nombrar los pagos de la tienda y sus anulaciones, de modo que no enumeren
solo los conceptos anteriores.

**R54** — Un movimiento de pago recibido o de su anulación NO DEBE ofrecer el despliegue de órdenes
que tienen los movimientos nacidos de un cierre.

**R55** — La métrica «Dinero en caja» DEBE incluir los dos movimientos de caja nuevos, la métrica
«Ganancia de Ordenex» NO DEBE incluirlos y la métrica «Cuenta por pagar a tiendas» DEBE incluir los
dos conceptos nuevos del libro de tienda.

### H — El rastro en el historial de acciones

**R56** — CUANDO se registre un pago recibido, el sistema DEBE dejar en el historial una fila de un
tipo propio, clasificado como acción que MUEVE DINERO, que identifique quién, cuándo, por qué
importe y de qué tienda (por su nombre).

**R57** — CUANDO se anule un pago recibido, el sistema DEBE dejar en el historial una fila de un tipo
propio, distinto del de R56 y del de la anulación de un pago a tienda, clasificado como acción que
MUEVE DINERO, con quién, cuándo, el importe y el nombre de la tienda.

**R58** — Las filas de R56 y R57 NO DEBEN contener el motivo, la referencia, ningún otro texto libre
tecleado por una persona ni la ubicación del comprobante.

**R59** — La pantalla del historial DEBE permitir filtrar por los dos tipos nuevos y mostrarlos con
un texto legible.

### I — Lo que D3 de la 381 protegía, conservado

**R60** — El sistema NO DEBE ofrecer ninguna vía por la que se acredite dinero a una tienda sin que,
en la misma transacción, entre en la caja el mismo importe o se trate de un asiento automático de
un cierre o de la anulación de un pago a la tienda.

**R61** — Ningún pago recibido DEBE dejar el saldo de su tienda por encima de cero en el instante
de registrarse.

**R62** — El diálogo «Registrar movimiento» de `/wallet` NO DEBE ofrecer ningún concepto que
acredite dinero a una tienda.

### J — No regresión (lo que funciona no se toca)

**R63** — El registro y la anulación de un pago de Ordenex a una tienda DEBEN conservar sin cambios
su documento, sus asientos en el libro de la tienda y en la caja, su historial, sus respuestas y
sus textos.

**R64** — El cobro manual a una tienda (ficha 381) DEBE conservar sin cambios su asiento, su
historial, su efecto en el saldo y sus textos.

**R65** — Sobre un libro de caja sin pagos recibidos, el dinero en caja, la ganancia, la porción de
las tiendas, el reparto de la barra, el desglose de la ganancia y las finanzas diarias DEBEN dar
exactamente las mismas cifras que antes de esta ficha.

**R66** — Sobre un libro de tienda sin pagos recibidos, el saldo derivado y la cabecera del desglose
de cada tienda DEBEN dar exactamente las mismas cifras que antes de esta ficha.

**R67** — Los asientos que produce aprobar un cierre del día —en el libro de la tienda, en la caja y
en el libro del mensajero— DEBEN conservarse sin cambios.

**R68** — Los pagos recibidos NO DEBEN aparecer en la lista de comprobantes de pagos a una tienda,
ni sumarse a lo pagado a una tienda, ni ser tomados por el registro retroactivo de la caja de la
feature 173.

**R69** — Revertir las migraciones de esta ficha sobre una base SIN pagos recibidos DEBE devolver
los catálogos de valores y las restricciones exactamente a su estado previo, y SI existe algún pago
recibido o alguno de sus asientos, ENTONCES la reversión DEBE fallar sin borrar ningún dato.

**R70** — Toda tabla nueva de esta ficha DEBE tener la seguridad por filas activada.

## Preguntas abiertas (decisión tomada + alternativa; no bloquean)

**Q1 — Pantalla.** *Decisión:* esta ficha no pinta el formulario de registro ni la lista (DH6); se
mergea a `dev` pero **no se despliega a `prod` sin la pantalla de la 458** («el backend sin pantalla
no es entrega»). *Alternativa:* si el pago de Nuform no puede esperar a la 458, un botón mínimo
«Registrar pago recibido» en la fila de la tienda de `/wallet/tiendas` (habilitado solo con saldo en
contra), molde `PagoTiendaAcciones`, como ficha hija con `/design`.

**Q2 — Tienda desactivada (R11).** *Decisión:* se admite: la deuda no desaparece al desactivar la
cuenta y rechazar el pago dejaría dinero real sin registrar. *Alternativa:* exigir cuenta activa,
como el cobro manual de la 381.

**Q3 — Motivo libre y visible para la tienda (R6, DH3).** *Decisión:* texto libre de 1 a 200
caracteres, y lo lee la tienda en su libro; quien registra debe escribirlo sabiendo eso.
*Alternativa:* catálogo cerrado de motivos (lo propone la 458 para toda la wallet); entraría como
columna adicional sin romper esta.

**Q4 — Formatos y tamaño del comprobante (R23).** *Decisión:* JPEG/PNG/WebP/PDF hasta 4 MB (el
límite de las Server Actions del repo es 5 MB con el multipart; no se toca `next.config.ts`).
*Alternativa:* solo imágenes, como las evidencias de gestión.

**Q5 — Bucket.** *Decisión:* bucket privado NUEVO `wallet-comprobantes` (lo reutilizará la 458 para
sueldos y proveedores). Hay que crearlo en producción y en preview antes de desplegar.
*Alternativa:* reutilizar `gestion-evidencias` con un prefijo; evita el paso de operaciones, pero
mezcla dinero con evidencias de entrega y puede que ese bucket restrinja tipos MIME (se mide con la
consulta M5 de `design.md` §14).

**Q6 — Textos.** *Decisión (ver `design.md` §4):* libro de tienda «Pago de la tienda a Ordenex» /
«Pago de la tienda anulado»; caja «Pago recibido de tienda» / «Pago recibido de tienda anulado»;
origen «Pago de tienda»; historial «Registró un pago recibido de una tienda» / «Anuló un pago
recibido de una tienda». *Alternativa:* los que salgan de la maqueta de la 458.

**Q7 — No corrige un cobro manual equivocado.** La consecuencia C1 de la 381 sigue en pie: un pago
recibido exige dinero real y deuda previa; no es una vía para deshacer un cobro mal puesto. Se
escribe aquí para que no se use como tal.
