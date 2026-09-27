# Ficha 457 — Una tienda le paga a Ordenex

**Zona:** fullstack (backend + la UI mínima: el concepto en el diálogo actual y la acción en el
desglose de `/wallet/tiendas`; la pantalla nueva de la maqueta es de la 458). **SDD:** sí.
**Complejidad:** media. **Depende de:** 459 (en `dev`), 461 (en `origin/feature/461-final`, aprobada
para merge; esta ficha nace DESPUÉS de que la 461 esté en `dev`). **La consume:** 458 (458-3 y 458-4).

> **Reescrito el 2026-09-25** sobre el código real de `origin/dev` (459, 460, 462) y de
> `origin/feature/461-final` (461). El spec anterior (2026-09-24) se escribió antes de las tres y
> quedó rancio en los catálogos, los CHECK, los conteos del historial, los textos, la fecha de los
> asientos y la idempotencia. Lo que sigue valiendo se conserva; lo que cambia lleva la marca
> **[2026-09-25]** y el motivo. El humano ya aprobó el alcance: las dudas van al final como
> «decisión + alternativa», no como preguntas.

## El encargo, en palabras del humano (2026-09-24)

> Caso real: Nuform tiene en producción un saldo de **-6.170.666,55** y quiere pagarle a Ordenex.
> «Debe ser muy fácil comprender que fue un pago de esa tienda y por qué motivo.»

## Decisiones FIRMADAS por el humano (no se reabren)

- **DH1 — Entra a la caja como dinero de TERCEROS, no como ganancia.** Los fletes que la tienda
  debe ya se contaron como ganancia de Ordenex al aprobar cada cierre; contarlos otra vez al
  cobrarlos duplicaría la ganancia. **[2026-09-25]** Con la derivación de la 459/461 esto se dice
  así: el pago es un ingreso de **liquidez efectivo** y **dueño terceros**: sube «Entró», la cifra
  principal y «De las tiendas»; no toca la ganancia ni el capital. Las invariantes R7 y R8 de la
  459 (sin la excepción que la 461 retiró) valen al céntimo, sin ninguna excepción nueva.
- **DH2 — Queda ASOCIADO:** la tienda, el motivo (obligatorio), el método, la referencia, la fecha
  real y un comprobante OPCIONAL.
- **DH3 — La tienda SÍ ve el comprobante** (y, por tanto, el motivo que se escribió).
  **[2026-09-25]** El servidor lo autoriza en esta ficha (la tienda dueña obtiene el enlace); el
  botón para abrirlo desde `/mi-wallet` es de la 458-4 (ver «Acoples», `design.md` §15).
- **DH4 — Ningún identificador interno se muestra, se pide ni se descarga.**
- **DH5 — Molde:** `LiquidacionService.registrarPagoTienda` y su anulación, y —desde la 459/461— el
  pago de un gasto de una tienda (`PagoPorCuentaTiendaService`): documento con clave de idempotencia
  UNIQUE, candado de la fila de la tienda antes de leer el saldo, anulación entera con motivo y
  contra-asientos, historial en la misma transacción, comprobante en el bucket compartido.
- **DH6 — La UI nueva es de la 458.** **[2026-09-25]** El humano acotó la UI de esta ficha: el
  concepto en el diálogo «Registrar movimiento» que ya existe y la acción en el desglose de
  `/wallet/tiendas` cuando la tienda debe. Nada más se pinta.
- **DH7 — El nombre aprobado (2026-09-25, reservado en la 461 §7.8):** «Una tienda le paga a
  Ordenex». Desde la tienda (`/mi-wallet`): «Le pagaste a Ordenex». Entra en el catálogo del
  diálogo único de la 461, en el grupo «Llega dinero a la caja», con su frase de efecto de una línea.

## Qué cambia respecto del spec del 2026-09-24 (marcado, con motivo)

| Área | Antes | Ahora **[2026-09-25]** | Por qué |
| --- | --- | --- | --- |
| Textos | «Pago de la tienda a Ordenex», «Pago recibido de tienda», origen «Pago de tienda» | Los reservados por la 461 (`design.md` §2) | HD3 de la 461: nombres desde Ordenex diciendo quién le paga a quién |
| Catálogos de partida | 17 / 11 / 8 / 52 / 21 | 23 / 14 / 13 / 61 / 23 (medidos en el clon de la 461) | 459 (+4/+2/+3/+4/+2) y 461 (+2/+1/+2/+2) |
| CHECK de partida | los de `caja_tesoreria` y `wallet_tienda_check_cobro_manual` | los de `20260926120100_cobro_tienda_461_anulacion_y_checks` | idem |
| `down.sql` de enums | recrear con lista fija medida | función dinámica que lee `pg_enum` (la de la 459/461, sufijo `_457`) | P12 de la 459; «el down borra los valores posteriores» |
| Migraciones | tres (enums wallet, historial, tablas) | dos (enums —los cinco tipos—, tablas + CHECK) | la 461 ya metió los tipos del historial en la misma migración con el down dinámico |
| Fecha de los asientos | medianoche UTC de la fecha real | inicio del día CR de la fecha real (06:00Z), el mismo instante en los dos libros | 461 T2/R73: a 00:00Z el rollup diario los contaba el día anterior |
| Cifras que toca | «Dinero en caja» y «De las tiendas» | «Entró», cifra principal («Flujo de dinero registrado» / «Dinero en caja») y «De las tiendas»; no «Salió» al registrar | derivación de la 459 (§2.2) y de la 461 |
| Clasificación | `NATURALEZA`, `CUBETA`, `FUENTE` | + `LIQUIDEZ_POR_CATEGORIA` (efectivo) y `CONTRAPARTIDA_EN_CAJA` (las dos parejas) + caso en el test de la invariante | 459 §14 acople 2 |
| Comprobante | config, `BUCKETS`, utilidades y bucket NUEVOS | se REUTILIZAN los de la 459: solo se añade el prefijo `abonos-tienda` | 459 §14 acople 4 |
| Idempotencia | clave UNIQUE en el documento | igual, y alineada con la §J de la 461 (`claveIdempotenciaSchema`, `ya_registrado` como éxito en el diálogo) | 461 R66–R68 |
| Anulación | propia, desde una lista de pagos recibidos | uniforme con la 459/461: «Anular…» y «Ver comprobante» en la fila original del libro de la caja (`documento`) | 461 R20; una sola forma de anular en toda la wallet |
| Listas de pagos recibidos (R38–R42 viejos) | dos actions de lista | **retiradas**: sin pantalla que las pinte serían código muerto; el estado de cuenta es de la 458-4 | «el backend sin pantalla no es entrega», y la 458-4 lee el documento por `estadoDeDocumentos` |
| Historial | 33→35 dinero, 21→22 entidades | 61→63 tipos, 39→41 «mueve dinero», 23→24 entidades | conteos de la 461 |
| R64 (no regresión del cobro) | «el cobro manual conserva su asiento…» | el cobro de Ordenex a una tienda conserva débito, cargo en la caja, anulación, historial y textos de la 461 | la 461 lo cambió a propósito |
| UI | ninguna (Q1) | el concepto en el diálogo y el botón del desglose | decisión del humano (2026-09-25) |

## Qué cambia respecto de la decisión D3 de la ficha 381 (sigue vigente)

D3 (2026-09-07) rechazó un **crédito manual sin dinero detrás**. Esta ficha registra **dinero real
que entra**, con documento, método, referencia, fecha real, tope en la deuda y su asiento en la caja
en la misma transacción. El 2026-09-24 el humano aprobó reabrir D3 para este caso. Lo que D3 protegía
se conserva con el bloque J.

## Glosario

- **Pago de una tienda a Ordenex** (técnico: `abono_tienda`): el dinero que una tienda con saldo en
  contra le entrega a Ordenex. Documento propio; crédito en su libro; ingreso de terceros en la caja.
- **Deuda de la tienda:** el valor absoluto de su saldo derivado cuando es negativo.
- **Efectivo / cargo:** la liquidez de la 459: efectivo entra o sale de verdad; cargo se descuenta
  del saldo de la tienda sin mover dinero. El pago de la tienda es **efectivo**.
- **R7 / R8:** las dos invariantes de la 459, sin excepción desde la 461: cifra principal =
  ganancia + «De las tiendas» + capital; «De las tiendas» = Σ saldos de las tiendas.
- **Acceso total:** maestro y admin. **Vigente:** registrado y no anulado.

## Requisitos (EARS)

### A — Registrar un pago de una tienda a Ordenex: quién puede y con qué datos

**R1** — CUANDO una persona con acceso total registre un pago de una tienda a Ordenex, el sistema DEBE
dejarlo asociado a esa tienda, a un monto, a un método de pago, a la fecha real del pago, a un motivo,
a quién lo registró y a cuándo, y —si se aportan— a una referencia y a un comprobante.

**R2** — SI quien registra no tiene acceso total (incluida la propia tienda), ENTONCES el sistema DEBE
rechazarlo como prohibido sin leer el saldo de ninguna tienda y sin escribir nada.

**R3** — SI no hay sesión, ENTONCES el sistema DEBE rechazar el registro como no autenticado sin
escribir nada.

**R4** — SI el monto no es un número mayor que cero con hasta dos decimales, o supera el máximo que la
columna puede representar, ENTONCES el sistema DEBE rechazarlo señalando el campo del monto y NO DEBE
escribir nada.

**R5** — El sistema DEBE tratar el monto como texto decimal desde el borde hasta la base, sin
convertirlo nunca a coma flotante, y el importe persistido en el documento, en el libro de la tienda y
en la caja DEBE ser el mismo, con dos decimales.

**R6** — SI el motivo está vacío una vez recortados los espacios, o supera 200 caracteres, ENTONCES
el sistema DEBE rechazar el registro señalando el campo del motivo y NO DEBE escribir nada.

**R7** — SI el método es SINPE o transferencia y no hay referencia, ENTONCES el sistema DEBE rechazar el
registro señalando el campo de la referencia.

**R8** — SI la referencia supera 60 caracteres una vez recortada, ENTONCES el sistema DEBE rechazar el
registro señalando el campo de la referencia.

**R9** — SI la fecha real del pago no existe en el calendario o es posterior al día de hoy en Costa
Rica, ENTONCES el sistema DEBE rechazar el registro señalando el campo de la fecha.

**R10** — SI la tienda indicada no existe o no es una cuenta de tienda, ENTONCES el sistema DEBE
rechazar el registro señalando el campo de la tienda y NO DEBE escribir nada.

**R11** — El sistema DEBE admitir el pago de una tienda cuya cuenta no esté activa.

**R12** — SI la petición de registro trae un campo no previsto, ENTONCES el sistema DEBE rechazarla
como error de validación sin escribir nada.

**R13** **[2026-09-25]** — SI la petición no trae una clave de idempotencia con forma de uuid, ENTONCES
el sistema DEBE rechazarla como error de validación sin escribir nada.

### B — Las reglas del dinero

**R14** — MIENTRAS el saldo derivado de la tienda sea mayor o igual que cero, el sistema DEBE rechazar
el registro indicando que la tienda no tiene saldo en contra, y NO DEBE escribir nada.

**R15** — SI el monto supera lo que la tienda debe (el valor absoluto de su saldo en contra), ENTONCES
el sistema DEBE rechazar el registro informando del importe que la tienda debe, y NO DEBE escribir nada.

**R16** — El sistema DEBE evaluar R14 y R15 contra el saldo leído DESPUÉS de tomar el bloqueo de la
fila de esa tienda, y ese bloqueo DEBE ser el mismo que toman el pago de Ordenex a esa tienda y el pago
de un gasto de esa tienda, de modo que dos operaciones simultáneas de cualquiera de los tres tipos
sobre la misma tienda no puedan evaluarse sobre el mismo saldo.

**R17** — CUANDO se registre un pago válido, el sistema DEBE escribir en UNA sola transacción el
documento del pago, un crédito en el libro de esa tienda por el monto, un ingreso en la caja de
Ordenex por el monto y la fila del historial de acciones; SI cualquiera de esas escrituras falla,
ENTONCES NO DEBE quedar ninguna.

**R18** — CUANDO un pago quede registrado, el saldo de esa tienda DEBE subir exactamente en el monto, y
el sistema DEBE devolver el saldo resultante con su signo.

**R19** **[2026-09-25]** — El ingreso en la caja de R17 DEBE contarse como efectivo de terceros
**(DH1)**: DEBE sumar a «Entró», a la cifra principal y a «De las tiendas», y NO DEBE cambiar «Salió»,
la ganancia de Ordenex, su composición por concepto ni el capital, en ningún periodo.

**R20** **[2026-09-25]** — El crédito en el libro de la tienda y el ingreso en la caja DEBEN fecharse con
el MISMO instante: el inicio del día en Costa Rica de la fecha real del pago; el documento DEBE
conservar la fecha real como día calendario.

**R21** — El crédito en el libro de la tienda DEBE describirse con el motivo y el método de pago (y la
referencia si la hay), y el ingreso en la caja DEBE describirse además con el nombre de la tienda;
ninguna de las dos descripciones DEBE contener un identificador interno.

**R22** — Un pago de una tienda NO DEBE escribir en el libro de ninguna otra tienda, ni en el libro de
pagos a mensajeros, ni en ninguna categoría de la caja de dueño propio o capital.

**R23** **[2026-09-25]** — Tras registrar y tras anular un pago, sobre el libro entero, el sistema DEBE
cumplir al céntimo R7 (cifra principal = ganancia + «De las tiendas» + capital) y R8 («De las tiendas»
= Σ saldos de las tiendas), sin ninguna excepción.

**R24** **[2026-09-25]** — El sistema DEBE declarar el pago de la tienda como ingreso de liquidez
«efectivo» y dueño «terceros», su reverso como egreso de liquidez «efectivo» y dueño «terceros», y las
dos parejas libro de tienda ↔ caja (crédito ↔ ingreso; débito de anulación ↔ egreso); SI el pago se
clasificara como propio, capital o cargo, o alguna de las dos parejas faltara o moviera «De las
tiendas» en otro sentido que el saldo de la tienda, ENTONCES el gate DEBE fallar.

### C — Idempotencia

**R25** — CUANDO llegue un segundo registro con una clave de idempotencia ya usada, el sistema DEBE
responder con el pago original y el saldo actual de la tienda de ESE pago, sin escribir ninguna fila
nueva y sin conservar ningún comprobante adicional.

### D — El comprobante

**R26** — DONDE se aporte un comprobante, el sistema DEBE aceptar solo los tipos y el tamaño que admite
el comprobante compartido de la wallet (imagen JPEG, PNG o WebP, o PDF, hasta 4 MB), y SI no lo cumple,
ENTONCES DEBE rechazar el registro señalando el campo del comprobante sin escribir nada.

**R27** — DONDE se aporte un comprobante, el sistema DEBE guardarlo en el bucket privado compartido de
la wallet, en una carpeta propia de este documento, sin URL pública y con un nombre de objeto que no
contenga el identificador de la tienda, del pago ni de ningún usuario.

**R28** — SI el comprobante aportado no se puede guardar, ENTONCES el sistema NO DEBE registrar el pago
y DEBE decir que el comprobante no se pudo guardar.

**R29** — SI, con un comprobante ya guardado, el registro no se completa —por un rechazo de negocio,
por una clave repetida o por un fallo de escritura—, ENTONCES el sistema DEBE retirar ese comprobante
del almacenamiento.

**R30** — El sistema DEBE permitir registrar un pago sin comprobante.

### E — Anular un pago de una tienda a Ordenex

**R31** — CUANDO una persona con acceso total anule un pago indicando un motivo, el sistema DEBE, en
UNA sola transacción, dejar constancia de la anulación (motivo, quién y cuándo), añadir al libro de la
tienda un débito compensatorio por el monto íntegro del pago, añadir a la caja un egreso de dinero de
terceros por el monto íntegro y escribir la fila del historial; SI cualquiera falla, ENTONCES NO DEBE
quedar ninguna.

**R32** **[2026-09-25]** — Los dos contra-asientos de R31 DEBEN fecharse con el MISMO instante: el
inicio del día de la anulación en Costa Rica.

**R33** — La anulación NO DEBE editar ni borrar el documento del pago, sus asientos originales ni su
comprobante.

**R34** — El monto de la anulación DEBE leerse del documento en el servidor; SI la petición de anular
trae un monto o cualquier otro campo no previsto, ENTONCES el sistema DEBE rechazarla como error de
validación sin escribir nada.

**R35** — SI el motivo de la anulación está vacío una vez recortados los espacios, ENTONCES el sistema
DEBE rechazarla sin escribir nada.

**R36** — CUANDO se intente anular un pago ya anulado, o lleguen dos anulaciones del mismo pago a la
vez, el sistema DEBE dejar una sola anulación y responder a la otra que ya estaba anulado, sin escribir
nada más.

**R37** — SI quien anula no tiene acceso total, ENTONCES el sistema DEBE rechazarlo como prohibido
antes de leer el pago; y SI el pago no existe, ENTONCES DEBE responder que no se encontró.

**R38** — La anulación DEBE tomar el mismo bloqueo de tienda que R16 y DEBE devolver el saldo
resultante de la tienda, que PUEDE volver a ser negativo.

**R39** **[2026-09-25]** — CUANDO se anule un pago, «Salió» y «De las tiendas» DEBEN moverse
exactamente en el monto (la cifra principal baja en el monto), y NO DEBEN cambiar la ganancia de
Ordenex, su composición ni el capital.

**R40** — El sistema NO DEBE ofrecer ninguna forma de editar un pago de una tienda ni de deshacer una
anulación.

**R41** **[2026-09-25]** — El libro de la caja DEBE ofrecer «Anular…» (con motivo obligatorio) y, si lo
tiene, «Ver comprobante» en la fila ORIGINAL de cada pago de una tienda vigente; DEBE mostrar
«Anulado» en las ya anuladas; y NO DEBE ofrecer ninguna acción en el contra-asiento.

### F — El comprobante: quién lo abre

**R42** — CUANDO una persona con acceso total, o la tienda dueña del pago, pida ver su comprobante, el
sistema DEBE devolver un enlace temporal de vida acotada.

**R43** — SI una tienda pide el comprobante de un pago que no es suyo o que no existe, ENTONCES el
sistema DEBE responder que no se encontró, sin distinguir entre los dos casos.

**R44** — SI el pago pedido no tiene comprobante, ENTONCES el sistema DEBE responder que no tiene
comprobante, sin generar ningún enlace.

### G — Los nombres y las pantallas que ya existen

**R45** **[2026-09-25]** — El libro de la caja (tabla, filtro por concepto y descarga) DEBE rotular el
ingreso del pago como «Una tienda le paga a Ordenex», su reverso como «Pago de una tienda a Ordenex
anulado», el dueño de los dos como «Tienda» y su origen como «Pago de una tienda a Ordenex».

**R46** **[2026-09-25]** — El desglose de `/wallet/tiendas` (tabla, filtro por concepto y descarga)
DEBE rotular el crédito como «La tienda le paga a Ordenex» y el débito de su anulación como «Pago de la
tienda a Ordenex anulado», y su origen como «Pago de una tienda a Ordenex».

**R47** **[2026-09-25]** — `/mi-wallet` (tabla, filtro por concepto y descarga) DEBE rotular el crédito
como «Le pagaste a Ordenex» y el débito de su anulación como «Ordenex anuló el pago que le hiciste», y
esas dos lecturas DEBEN ser distintas de los nombres desde Ordenex de R46.

**R48** — Ninguna de las superficies de R45–R47 DEBE mostrar ni descargar el valor técnico de un
concepto o de un origen, un identificador interno, la clave de idempotencia ni la ubicación del
comprobante.

**R49** — La cabecera del desglose de una tienda, en las dos pantallas, DEBE contar el pago dentro de
«a favor» y su anulación dentro de «cargos», y el saldo de la cabecera DEBE seguir siendo igual al saldo
derivado del libro.

**R50** — Las aclaraciones de las cabeceras que enumeran qué hay dentro de «a favor» y de «cargos», en
las dos pantallas, DEBEN nombrar el pago de la tienda a Ordenex y su anulación con la misma palabra con
la que se rotula su fila en esa pantalla.

**R51** — Un movimiento de pago de una tienda o de su anulación NO DEBE ofrecer el despliegue de
órdenes que tienen los movimientos nacidos de un cierre.

**R52** — La métrica «dinero en caja» DEBE incluir los dos conceptos de caja nuevos; «ganancia de
Ordenex» y «egresos» NO DEBEN incluirlos; «cuenta por pagar a tiendas» DEBE incluir los dos conceptos
nuevos del libro de la tienda.

**R53** **[2026-09-25]** — Los nombres que la 461 reservó para esta ficha DEBEN quedar tomados
exactamente por estos conceptos y por ningún otro; los nombres retirados por la 461 NO DEBEN volver en
ninguna superficie que esta ficha toca; y el gate DEBE fallar si alguna de las dos cosas se rompe.

### H — El diálogo «Registrar movimiento» y el desglose de `/wallet/tiendas`

**R54** **[2026-09-25]** — El diálogo «Registrar movimiento» de `/wallet` DEBE ofrecer el concepto «Una
tienda le paga a Ordenex» dentro del grupo «Llega dinero a la caja», y el catálogo DEBE seguir siendo
de tres grupos: ocho conceptos.

**R55** **[2026-09-25]** — CUANDO el usuario elija ese concepto, el diálogo DEBE mostrar su frase de
efecto de una sola línea con el texto exacto de `design.md` §8.2, que diga que llega dinero de la
tienda, que su saldo sube y que la ganancia no cambia; y la frase del libro DEBE nombrar los dos libros
con los nombres de sus diccionarios.

**R56** **[2026-09-25]** — CUANDO el concepto elegido sea el pago de una tienda a Ordenex, el diálogo
DEBE pedir la tienda, el monto, la fecha real, el motivo, el método de pago, la referencia (visible y
obligatoria solo con SINPE o transferencia) y un comprobante opcional; el envío DEBE llevar SOLO esas
claves más la clave de idempotencia generada al abrir el diálogo; y NO DEBE cambiar el envío de ningún
otro concepto.

**R57** **[2026-09-25]** — CUANDO el registro tenga éxito (o el servidor responda que ya estaba
registrado con esa clave), el diálogo DEBE avisar una sola vez con el saldo resultante de la tienda que
devolvió el servidor, con su signo, y SI sigue en contra, ENTONCES DEBE decir en palabras que la tienda
todavía le debe ese dinero a Ordenex.

**R58** **[2026-09-25]** — SI el servidor responde que la tienda no tiene saldo en contra, o que el
monto supera lo que debe, ENTONCES el diálogo DEBE pintar el motivo bajo el campo correspondiente
(tienda o monto) con el importe que devolvió el servidor, sin recalcular ningún importe en el
navegador.

**R59** **[2026-09-25]** — DONDE una tienda de `/wallet/tiendas` tenga saldo en contra, su desglose DEBE
ofrecer a las personas con acceso total la acción «Registrar pago de la tienda a Ordenex», que abre el
mismo formulario con el concepto y la tienda ya fijados; CUANDO el registro tenga éxito, DEBEN releerse
el desglose, sus comprobantes y la tabla de saldos sin recargar la página; y DONDE el saldo sea cero o
a favor, la acción NO DEBE ofrecerse.

**R60** **[2026-09-25]** — CUANDO se registre o se anule un pago de una tienda desde `/wallet`, el
sistema DEBE actualizar sin recargar la página la tarjeta de la caja, el libro y la composición de la
ganancia.

### I — El rastro en el historial de acciones

**R61** — CUANDO se registre un pago de una tienda, el sistema DEBE dejar en el historial una fila de
un tipo propio, clasificado como acción que MUEVE DINERO, que identifique quién, cuándo, por qué
importe y de qué tienda (por su nombre).

**R62** — CUANDO se anule un pago de una tienda, el sistema DEBE dejar en el historial una fila de un
tipo propio, distinto del de R61 y de los tipos de anulación que ya existen, clasificado como acción que
MUEVE DINERO, con quién, cuándo, el importe y el nombre de la tienda.

**R63** — Las filas de R61 y R62 NO DEBEN contener el motivo, la referencia, ningún otro texto libre
tecleado por una persona ni la ubicación del comprobante.

**R64** — La pantalla del historial DEBE permitir filtrar por los dos tipos nuevos y mostrarlos con un
texto legible.

### J — Lo que D3 de la 381 protegía, conservado

**R65** — El sistema NO DEBE ofrecer ninguna vía por la que se acredite dinero a una tienda sin que, en
la misma transacción, la caja registre la contrapartida declarada de ese concepto; SI algún productor
distinto del servicio de esta ficha escribe el crédito del pago de una tienda, o el servicio puede
construirse sin su puerto de caja, ENTONCES el gate DEBE fallar.

**R66** — Ningún pago de una tienda DEBE dejar el saldo de su tienda por encima de cero en el instante
de registrarse bajo el bloqueo.

**R67** **[2026-09-25]** — El único concepto del diálogo «Registrar movimiento» que acredita dinero a
una tienda DEBE ser el pago de la tienda a Ordenex, y ese concepto DEBE exigir saldo en contra, tope en
la deuda y entrada del mismo importe en la caja; el gate DEBE fallar si el catálogo ofrece otro
concepto que acredite a una tienda.

### K — La ayuda y el asistente

**R68** **[2026-09-25]** — Los documentos de ayuda de la caja, de las tiendas y de «Mi wallet» DEBEN
describir el pago de una tienda a Ordenex con su efecto (llega dinero de la tienda, su saldo sube, la
ganancia no cambia; solo con saldo en contra y hasta lo que debe), su anulación y sus nombres en cada
superficie; NO DEBEN usar ningún nombre retirado por la 461 como nombre de concepto; y cada documento
tocado DEBE actualizar su fecha y su lista de fuentes.

**R69** **[2026-09-25]** — El contexto del asistente DEBE contener, para maestro y admin, las
explicaciones de la caja y de las tiendas con las frases literales de `design.md` §11; para adminTienda,
la de «Mi wallet»; y NO DEBE llevar la de la caja a mensajero, adminTienda ni adminSatelite.

### L — No regresión, migraciones y verificación

**R70** — El registro y la anulación de un pago de Ordenex a una tienda DEBEN conservar sin cambios su
documento, sus asientos, su historial, sus respuestas y sus textos.

**R71** **[2026-09-25]** — El cobro de Ordenex a una tienda y su anulación (461) DEBEN conservar sin
cambios su débito, su cargo en la caja, su constancia, su historial, sus respuestas y sus textos.

**R72** — Registrar y anular pagos de un gasto de una tienda, aportes de dinero a la caja, pagos a
mensajeros, correcciones de caja, los cobros de gasto fijo, los cobros por rechazo, los premios y la
aprobación de cierres DEBEN conservar sus asientos en los tres libros, sus topes, su idempotencia, su
historial y su comportamiento.

**R73** — Para conjuntos de movimientos sin pagos de una tienda ni sus anulaciones, la cifra principal,
«Entró», «Salió», la ganancia y su composición, «De las tiendas», el capital, el estado de la caja, el
saldo y el desglose de cada tienda y la cuenta por pagar de cada mensajero DEBEN valer exactamente lo
mismo que antes de esta ficha.

**R74** — Los pagos de una tienda NO DEBEN aparecer en la lista de comprobantes de pagos a una tienda,
ni sumarse a lo pagado a una tienda, ni ser tomados por el registro retroactivo de la caja de la 173 ni
por las migraciones de datos de la 459 y la 461.

**R75** — Revertir las migraciones de esta ficha sobre una base SIN pagos de una tienda DEBE devolver
los catálogos, las restricciones y las tablas exactamente a su estado previo; SI existe algún pago o
alguno de sus asientos, ENTONCES la reversión DEBE fallar sin borrar ningún dato; y la reversión de los
valores de enum DEBE leer la lista vigente del catálogo y quitar solo los valores de esta ficha, de modo
que valga igual en `prod` y en `dev`.

**R76** — Toda tabla nueva de esta ficha DEBE tener la seguridad por filas activada.

**R77** **[2026-09-25]** — Antes de tocar código, la fotografía de la caja y el test de la invariante
DEBEN correr verdes sobre el SHA de partida, y las mutaciones de control de `design.md` §13 DEBEN
ponerlos rojos, con el nombre del caso y el número de tests ejecutados anotados.

**R78** **[2026-09-25]** — Antes de desplegar, el contraste de solo lectura de `design.md` §14 DEBE
medir en producción el saldo de la tienda que va a pagar, los cinco catálogos, los dos CHECK, el bucket
y las diferencias de R7 y R8; y después de desplegar, las diferencias DEBEN dar 0,00 y la línea base de
los libros DEBE ser idéntica; SI algo no cuadra, ENTONCES no se sigue.

**R79** **[2026-09-25]** — Antes de darla por hecha, el recorrido por rol de `design.md` §17 (maestro,
admin, adminTienda y mensajero) DEBE tener sus capturas y sus números en `progress/`.

## Trazabilidad prevista (R → test)

El detalle vive en `design.md` §18; el implementer fija las rutas finales en `progress/impl_457.md`.

## Decisiones tomadas y su alternativa (el humano aprobó el alcance; no bloquean)

**D1 — Nombre técnico `abono_tienda`.** *Decisión:* las categorías, el origen, las tablas y los tipos
del historial se llaman `abono_tienda*` (`ingreso_abono_tienda`, `egreso_reverso_abono_tienda`,
`abono_tienda_anulado`, `abono_tienda_registrado`…). `pago_tienda` ya significa «Ordenex le paga a la
tienda» en los dos enums y `ingreso_pago_tienda` se leería como el reverso de `egreso_pago_tienda`. El
nombre técnico no se pinta nunca (R48). *Alternativa:* `pago_de_tienda_a_ordenex`; más largo y con
el mismo riesgo de confusión con `pago_tienda`.

**D2 — Tienda desactivada (R11).** *Decisión:* se admite en el servidor: la deuda no desaparece al
desactivar la cuenta y rechazar el pago dejaría dinero real sin registrar. El catálogo del diálogo
solo lista tiendas activas; una tienda inactiva se paga desde su desglose en `/wallet/tiendas`, que
fija la tienda sin catálogo. *Alternativa:* exigir cuenta activa, como el cobro (461 P10) y el pago
de un gasto (459 P4).

**D3 — Fecha del pago sin ventana hacia atrás.** *Decisión:* como el pago de Ordenex a una tienda
(molde DH5): día existente y no posterior a hoy en CR (`fechaPagoSchema`), sin límite hacia atrás; los
asientos al inicio de ese día CR (461 T2). *Alternativa:* la ventana de 30 días de los movimientos
manuales (`fechaMovimientoSchema`), que usa el pago de un gasto; una tienda puede pagar hoy una deuda
de hace meses y el pago llevar su fecha real.

**D4 — Motivo libre y visible para la tienda (R6, DH3).** *Decisión:* texto libre de 1 a 200
caracteres, y lo lee la tienda en su libro. *Alternativa:* catálogo cerrado de motivos (458); entraría
como columna adicional sin romper esta.

**D5 — Anulación y comprobante desde el libro de la caja (R41).** *Decisión:* la única forma de anular
es «Anular…» en la fila original de `/wallet`, la misma que el pago de un gasto, el aporte, el cobro y
la corrección; y «Ver comprobante» ahí mismo. *Alternativa:* además una lista de pagos de la tienda en
el desglose de `/wallet/tiendas` con «Anular» (molde `PagosRegistradosTabla`); duplica la acción y es
lo que la 458-4 pinta como estado de cuenta.

**D6 — Sin actions de lista (los R38–R42 del spec anterior).** *Decisión:* se retiran: nadie las
pintaría en esta ficha y el estado de cuenta de la 458-4 lee el documento por `estadoDeDocumentos` y
el comprobante por `obtenerComprobanteAbonoAction`. *Alternativa:* dejarlas escritas y probadas para
la 458; código sin consumidor, la familia que este repo tiene medida.

**D7 — El comprobante para la tienda (DH3).** *Decisión:* `obtenerComprobanteAbonoAction` autoriza a la
tienda dueña (R42) y se prueba; el botón en `/mi-wallet` es de la 458-4 (su «comprobante visible para
la tienda»), porque `WalletTiendaMovimientoDTO` no trae hoy ningún `documento` y añadirlo es rediseñar
la fila que la 458-4 rehace. *Alternativa:* un «Ver comprobante» mínimo en la fila de `/mi-wallet`
para este concepto, con un `documento` nuevo en el DTO de la tienda.

**D8 — Abrir el registro desde el desglose con el mismo diálogo.** *Decisión:* `PagoTiendaAcciones`
monta `RegistrarMovimientoCajaDialog` con el concepto y la tienda fijados (props nuevas); un solo
formulario para los dos caminos y el mismo que la 458-3 sustituirá con preselección. *Alternativa:*
un diálogo propio en `/wallet/tiendas` (molde `RegistrarPagoDialog`): dos formularios del mismo pago.

**D9 — La deuda en la fila del desglose.** *Decisión:* el botón no repite el importe: la cabecera ya
muestra el saldo con su signo, y los avisos de `sin_deuda`/`excede` traen la deuda del servidor. La
frase «<Tienda> le debe ₡… a Ordenex» es de la 458-4 (R26), que ampliará el DTO con el importe
absoluto. *Alternativa:* añadir `deuda` a `SaldoTiendaResumenDTO` ahora; toca la descarga de saldos.

**D10 — Nombres de la anulación.** *Decisión:* caja «Pago de una tienda a Ordenex anulado»
(reservado en la 461); tienda desde Ordenex «Pago de la tienda a Ordenex anulado» (patrón «Pago de un
gasto de la tienda anulado»); `/mi-wallet` «Ordenex anuló el pago que le hiciste» (patrón «Ordenex
anuló un pago hecho por ti»). El reservado «Pago a Ordenex anulado» queda sin uso y sale de la lista de
la guardia. *Alternativa:* usar «Pago a Ordenex anulado» en `/mi-wallet`; no dice quién anuló.

**D11 — El reverso no entra en la métrica «egresos».** *Decisión:* como el reverso del aporte y el del
pago de un gasto (459 P13 / 461 P14): no es un gasto. *Alternativa:* incluirlo como se incluyó el
reverso de un egreso (183); aquel deshacía un gasto.

**D12 — No corrige un cobro equivocado.** La consecuencia C1 de la 381 sigue en pie: el pago exige
dinero real y deuda previa; para deshacer un cobro está su anulación (461).
