# 458 — Rediseño de la wallet: cada movimiento dice qué, quién, por qué y cómo quedó

**Zona:** fullstack. **SDD:** sí. **Complejidad:** alta. **Depende de:** 457 (backend del pago
recibido de una tienda, `specs/457-la-tienda-paga-a-ordenex/`). **Se parte en fichas hijas**
(ver `design.md` §9): este documento es el QUÉ de todas ellas; cada hija implementa un subconjunto
de requisitos y lo declara.

## El encargo, en palabras del humano (2026-09-24)

> «Esa falencia la tenemos en gran parte de la wallet.»

Pedido con **«muchísima atención»**: (1) el filtro de cierre por ID escrito a mano, (2) el origen
crudo (`gestion_orden`) y (3) los conceptos sin movimientos en los filtros. Barrer **toda** la
wallet, no solo los casos del primer inventario.

**Fuente del diseño:** la maqueta aprobada
(`https://claude.ai/artifact/XwjyYvp2Bw6GT7aUhgF86Z`), cinco pantallas: (1) estado de cuenta de
una tienda, (2) «Registrar un movimiento», (3) libro de caja, (4) «Mi wallet» de la tienda,
(5) detalles (selector de cierre, origen con nombre y enlace, conceptos con cuenta). No se leyó el
artifact directamente: su contenido llegó transcrito por el leader y es el que se usa aquí.

## Decisiones FIRMADAS por el humano (no se reabren)

- **H1** — El comprobante es **OPCIONAL**.
- **H2** — Sueldos y proveedores se identifican con **NOMBRE LIBRE** (no hay catálogo de personas
  ni de proveedores).
- **H3** — La tienda **SÍ ve** el comprobante que subió Ordenex.
- **H4** — Mensajeros y bodegas satélite reciben **el mismo estado de cuenta** que la tienda.
- **H5** — **Anular es uniforme** para todo movimiento manual: motivo obligatorio + contra-asiento
  visible. Nada se borra.
- **H6 (regla dura)** — Ningún identificador interno (uuid de cierre, tienda, pago o movimiento)
  se **muestra**, se **pide** ni se **descarga** en ningún lugar de la wallet.

## Vocabulario

- **Superficies de la wallet:** `/wallet`, `/wallet/tiendas` (y el estado de cuenta de cada
  tienda), `/wallet/mensajeros` (y el de cada mensajero), `/wallet/satelites` (y el de cada
  bodega), `/mi-wallet`; sus tablas, desgloses, paneles de detalle, diálogos, filtros y
  descargas.
- **Identificador interno:** cualquier uuid (o fragmento reconocible de uno) de una fila de la
  base: cierre, tienda, mensajero, bodega, pago, cobro, gestión, orden, movimiento, plantilla.
  La **guía** de una orden NO es identificador interno: es un dato del negocio.
- **Cuenta:** una tienda, un mensajero o una bodega satélite, con su libro y su saldo.
- **Abono / cargo:** abono es todo movimiento que mueve el saldo de la cuenta a favor de su
  titular; cargo, todo lo que lo mueve en su contra.
- **Movimiento manual:** el que registra una persona: sueldo, gasto variable, ajuste que suma,
  ajuste que resta, cobro de un costo a una tienda, pago por cuenta de una tienda, pago a una
  tienda, pago a un mensajero, pago recibido de una tienda, premio del ranking, y el gasto fijo
  cobrado (lo emite una plantilla que alguien creó y, desde la 333, alguien aprueba).
- **Pago por cuenta de una tienda:** dinero de la tienda que Ordenex SACA de la caja para pagarle a
  un tercero en nombre de ella (su proveedor, su publicidad, su personal). Sale dinero de la caja y
  baja el saldo de la tienda.
- **Cobrar un costo a una tienda:** un cargo que Ordenex le hace a la tienda por un servicio o un
  gasto propio. Baja el saldo de la tienda y NO mueve la caja.
- **Contra-asiento:** el movimiento de igual monto y sentido contrario que anula a otro en el
  mismo libro.
- **Origen:** la entidad que produjo el movimiento (cierre, orden, pago, cobro, premio, plantilla,
  registro manual).

## Requisitos

### A. Regla dura: ningún identificador interno (H6)

**R1** — El sistema NO DEBE mostrar ningún identificador interno, completo o recortado, en el
texto visible ni en el nombre accesible de ningún elemento de las superficies de la wallet.

**R2** — El sistema NO DEBE pedir al usuario que escriba, pegue o copie un identificador interno
en ningún control ni texto de ayuda de las superficies de la wallet.

**R3** — El sistema NO DEBE incluir ningún identificador interno en las celdas, encabezados ni
nombre de archivo de ninguna descarga de la wallet.

**R4** — SI un texto de la wallet se compone con un dato que puede faltar (descripción, nombre,
referencia), ENTONCES el sistema DEBE sustituir la ausencia por un texto legible y NO DEBE
sustituirla por un identificador interno.

### B. Todo origen tiene nombre y enlace

**R5** — El sistema DEBE mostrar el origen de cada movimiento de cualquier libro de la wallet con
un nombre legible en español, en pantalla y en descarga, y NO DEBE mostrar en ningún caso el
valor técnico del origen (p. ej. `gestion_orden`, `cierre_dia`, `pago_tienda`).

**R6** — El sistema DEBE nombrar en el origen la entidad concreta que lo produjo: el cierre (día
y mensajero), la orden (guía), el pago (fecha y método), el cobro por rechazo (guía), el premio
(día del podio), el cobro de gasto fijo (concepto y periodo) o el registro manual (concepto).

**R7** — DONDE la entidad de origen tenga una pantalla a la que el rol que mira tiene acceso, el
sistema DEBE ofrecer desde el origen un enlace a esa pantalla.

**R8** — SI el rol que mira no tiene acceso a la pantalla de la entidad de origen, ENTONCES el
sistema DEBE mostrar el nombre del origen sin enlace.

**R9** — CUANDO el modelo gane un tipo de origen nuevo, el sistema DEBE impedir que el gate pase
mientras ese origen no tenga nombre legible en todas las superficies de la wallet.

### C. Filtros: cierre por selector, conceptos con movimientos, fechas de Costa Rica

**R10** — CUANDO el usuario filtre por cierre en cualquier superficie de la wallet, el sistema DEBE
ofrecer un selector con búsqueda por texto, con cada cierre rotulado por su día y, en las
superficies de acceso total, por el nombre del mensajero.

**R11** — El sistema DEBE ofrecer en el selector de cierre solo los cierres que tienen al menos un
movimiento en la cuenta que se está mirando.

**R12** — SI el servidor recibe como filtro de cierre un valor que no es un cierre de la cuenta
consultada, ENTONCES el sistema NO DEBE devolver movimientos de ninguna otra cuenta ni de ningún
otro cierre.

**R13** — El sistema DEBE ofrecer en el filtro de concepto de cada superficie únicamente los
conceptos que tienen al menos un movimiento en el periodo y la cuenta que se están mirando, cada
uno con su número de movimientos.

**R14** — MIENTRAS un concepto reservado sin productor (hoy `egreso_gasto` en la caja y
`ajuste_debito` en el libro de la tienda) no tenga movimientos en el periodo, el sistema NO DEBE
ofrecerlo en ningún filtro.

**R15** — CUANDO cambien el periodo o la cuenta y el concepto elegido se quede sin movimientos, el
sistema DEBE seguir mostrándolo elegido con cuenta 0 hasta que el usuario lo quite, en vez de
quitarlo en silencio.

**R16** — El sistema DEBE interpretar toda fecha de la wallet (columnas, filtros de periodo,
rótulos de cierre, saldo inicial y descargas) en el calendario de Costa Rica.

### D. Estado de cuenta de tienda, mensajero y bodega (H4)

**R17** — El sistema DEBE ofrecer un estado de cuenta por cada tienda, cada mensajero y cada
bodega satélite, accesible desde la fila de esa cuenta en su listado de la wallet.

**R18** — El estado de cuenta DEBE mostrar tarjetas con el saldo actual con su signo y una frase
que diga en palabras quién le debe a quién y cuánto, el total de abonos del periodo y el total de
cargos del periodo.

**R19** — El estado de cuenta DEBE listar los movimientos como un extracto con: fecha, movimiento
y motivo (con referencia, indicación de comprobante y quién lo registró), cargo, abono, saldo
corrido y la acción «Ver».

**R20** — El estado de cuenta DEBE mostrar como primera fila el saldo inicial del periodo, igual
al saldo de la cuenta al terminar el día (Costa Rica) anterior al inicio del periodo.

**R21** — El saldo corrido de cada fila DEBE ser el saldo de la cuenta completa inmediatamente
después de ese movimiento, sea cual sea el chip de filtro elegido.

**R22** — El sistema DEBE cumplir `saldo inicial + abonos del periodo − cargos del periodo = saldo
final del periodo`, y DONDE el periodo termine hoy, ese saldo final DEBE ser igual al saldo de la
tarjeta y al de la fila de la cuenta en su listado.

**R23** — El sistema DEBE ordenar los movimientos de un mismo instante con un criterio fijo, de
modo que dos lecturas seguidas del mismo periodo den el mismo orden y el mismo saldo corrido.

**R24** — El estado de cuenta DEBE ofrecer los chips Todo / Cierres / Pagos / Cobros / Ajustes y
un selector de periodo, y cada movimiento DEBE pertenecer exactamente a un chip.

**R25** — MIENTRAS un movimiento esté anulado, el sistema DEBE seguir mostrándolo en el estado de
cuenta, tachado, con el motivo, quién lo anuló y cuándo, y su contra-asiento DEBE verse como fila
propia.

**R26** — DONDE la cuenta sea una tienda con saldo en contra, el estado de cuenta DEBE ofrecer la
acción «Registrar pago recibido».

**R27** — DONDE la cuenta sea una tienda, el estado de cuenta DEBE ofrecer la acción «Cobrar un
costo».

**R28** — SI la tienda no tiene saldo a favor, ENTONCES el estado de cuenta DEBE mostrar «Pagar a
la tienda» deshabilitado y decir el motivo en texto visible.

**R29** — CUANDO se registre o se anule un movimiento desde un estado de cuenta, el sistema DEBE
actualizar sin recargar la página las tarjetas, las filas y la fila de esa cuenta en su listado, y
NO DEBE volver a leer las cuentas de otras entidades.

**R30** — DONDE la cuenta sea una bodega satélite, el estado de cuenta DEBE conservar las acciones
de conciliación que hoy existen (marcar y desmarcar lo recibido) con su mismo efecto.

**R31** — El estado de cuenta DEBE permitir descargar el periodo filtrado con las mismas columnas
que se ven, incluido el saldo corrido.

### E. «Mi wallet» de la tienda

**R32** — CUANDO un usuario `adminTienda` abra `/mi-wallet`, el sistema DEBE mostrarle el estado de
cuenta de su propia tienda con la misma estructura que R18–R25, redactado desde su lado (p. ej.
«Pago que hiciste a Ordenex», «Pago que Ordenex te hizo», «Cobro de Ordenex»).

**R33** — El sistema NO DEBE ofrecer en `/mi-wallet` ninguna acción de registrar, cobrar, pagar,
anular ni adjuntar, ni mostrar movimientos o comprobantes de otra tienda.

**R34** — El sistema DEBE acotar `/mi-wallet` a la tienda de la sesión, resuelta en el servidor, y
NO DEBE aceptar la tienda como dato del cliente.

### F. Registro único de movimientos

**R35** — El sistema DEBE ofrecer un único diálogo «Registrar un movimiento» en `/wallet` y en cada
estado de cuenta de tienda y de mensajero, con un catálogo agrupado en «Entra dinero» (pago
recibido de una tienda, ajuste que suma), «Sale dinero» (pago a una tienda, pago por cuenta de una
tienda, pago a un mensajero, sueldo, gasto variable, ajuste que resta) y «Cargo sin mover la caja»
(cobrar un costo a una tienda), más un enlace a las plantillas de gasto fijo.

**R36** — El catálogo NO DEBE ofrecer registrar a mano un gasto fijo.

**R37** — CUANDO el usuario elija un tipo, el diálogo DEBE pedir solo los campos de ese tipo y NO
DEBE enviar al servidor claves que no pertenezcan a ese tipo.

**R38** — CUANDO el diálogo se abra desde una acción de un estado de cuenta, el sistema DEBE traer
ya elegidos la cuenta y el tipo de esa acción.

**R39** — DONDE el tipo afecte a una tienda o a un mensajero, el diálogo DEBE pedir la cuenta con
un buscador por nombre.

**R40** — DONDE el tipo sea sueldo, gasto variable o pago por cuenta de una tienda, el diálogo
DEBE pedir a quién se le paga (la persona, el proveedor o el beneficiario) como texto libre.

**R41** — El diálogo DEBE pedir en todo tipo el monto, la fecha y el motivo; el comprobante DEBE
ser opcional en todo tipo; y la referencia DEBE ser obligatoria solo donde hoy lo es (pago con
método distinto de efectivo).

**R42** — MIENTRAS el formulario tenga un monto válido y la cuenta requerida elegida, el diálogo
DEBE mostrar un recuadro «Así queda» con el antes y el después del saldo de la cuenta afectada,
del dinero en caja y de la ganancia de Ordenex, calculados por el servidor.

**R43** — SI el tipo elegido no mueve la caja o la ganancia, ENTONCES «Así queda» DEBE decirlo en
palabras (p. ej. «La caja no cambia») en lugar de omitir la línea.

**R44** — SI al pedir «Así queda» el servidor no responde, ENTONCES el diálogo DEBE decir que no
pudo calcular el efecto y NO DEBE mostrar cifras calculadas en el navegador.

**R45** — CUANDO el registro tenga éxito, el sistema DEBE cerrar el diálogo, avisar con el saldo
resultante que devuelve el servidor y actualizar las vistas abiertas según R29 y R56.

**R46** — SI el registro falla por validación, ENTONCES el diálogo DEBE conservar lo escrito y
mostrar el motivo bajo el campo que lo produce.

**R47** — El efecto de cada tipo en los libros DEBE ser idéntico al que produce hoy su camino de
registro (tabla de `design.md` §4.1); el del pago recibido de una tienda DEBE ser el que defina la
457.

**R48** — SI el mismo registro de cualquier tipo del catálogo llega dos veces (doble clic,
reintento), ENTONCES el sistema DEBE registrarlo una sola vez.

### G. Libro de caja (`/wallet`)

**R49** — El sistema DEBE mostrar en `/wallet` las tarjetas «Dinero en caja», «Ganancia de
Ordenex» y «De terceros», con los mismos importes que hoy produce la derivación de la caja para el
mismo conjunto de movimientos.

**R50** — El libro DEBE ofrecer los filtros Todo / Entra / Sale, «A quién», concepto (según R13) y
periodo, y las tarjetas DEBEN reflejar el conjunto filtrado.

**R51** — Cada fila del libro DEBE mostrar fecha, movimiento y motivo, «A quién», monto con su
dirección (entra/sale) y su dueño (de Ordenex / de terceros), y «Registró».

**R52** — La columna «A quién» DEBE nombrar la tienda, el mensajero, la persona o el proveedor del
movimiento, con enlace al estado de cuenta cuando es una tienda o un mensajero.

**R53** — La columna «Registró» DEBE mostrar el nombre de quien registró el movimiento o, si no lo
registró una persona, «Automático» y la acción que lo produjo (p. ej. «Aprobación del cierre por
Ana»).

**R54** — CUANDO el usuario pulse «Ver» en una fila, el sistema DEBE abrir un panel lateral con
quién, por qué, cómo (método y referencia), comprobante, quién lo registró y cuándo, «Cómo quedó»
(caja, ganancia y saldo de la cuenta afectada tras ese movimiento) y, si aplica, «Anular…».

**R55** — CUANDO el usuario filtre por «A quién», el sistema DEBE ofrecer búsqueda por nombre de
tienda, de mensajero o por el nombre libre registrado.

**R56** — CUANDO se registre o se anule un movimiento desde `/wallet`, el sistema DEBE actualizar el
libro, las tarjetas, la composición de la ganancia y el desglose con los filtros vigentes.

**R57** — El sistema DEBE conservar en `/wallet` la cola de cobros de gasto fijo por aprobar, la
cola de cobros por rechazo, la composición de la ganancia y las plantillas de gasto fijo, con su
comportamiento actual.

### H. Anulación uniforme (H5)

**R58** — El sistema DEBE ofrecer «Anular…» sobre todo movimiento manual no anulado (sueldo, gasto
variable, gasto fijo cobrado, ajuste que suma, ajuste que resta, cobro de un costo a una tienda,
pago por cuenta de una tienda, pago a una tienda, pago a un mensajero, pago recibido de una tienda
y premio del ranking), en el panel de detalle de cualquier superficie de acceso total donde
aparezca.

**R59** — CUANDO el usuario anule, el sistema DEBE exigir un motivo no vacío y registrar un
contra-asiento de igual monto y sentido contrario en el mismo libro, sin modificar ni borrar el
movimiento original.

**R60** — El sistema NO DEBE ofrecer «Anular…» sobre un contra-asiento ni sobre los movimientos
que produce la aprobación de un cierre.

**R61** — SI el movimiento ya está anulado, ENTONCES el sistema NO DEBE registrar un segundo
contra-asiento y DEBE avisar que ya estaba anulado.

**R62** — CUANDO dos anulaciones del mismo movimiento lleguen a la vez, el sistema DEBE registrar un
único contra-asiento.

**R63** — El contra-asiento DEBE producir en el saldo de la cuenta, en el dinero en caja y en la
ganancia exactamente el efecto inverso del original (tabla de `design.md` §4.3).

**R64** — SI una anulación deja el saldo de la cuenta en negativo, ENTONCES el sistema DEBE
registrarla y mostrar el saldo resultante con su signo.

**R65** — El pago a un mensajero DEBE poder anularse desde la wallet, con el mismo efecto que hoy
tiene anularlo desde `/cierres-admin`, que DEBE seguir funcionando.

**R66** — El sistema DEBE mostrar como anulados los movimientos que se revirtieron antes de esta
feature, con la leyenda «motivo no registrado».

### I. Comprobantes (H1, H3)

**R67** — DONDE el tipo sea manual, el diálogo DEBE permitir adjuntar opcionalmente un comprobante
(imagen o PDF) al registrar.

**R68** — SI el archivo no es de un tipo admitido o supera el tamaño máximo configurado, ENTONCES
el sistema DEBE rechazarlo explicando el motivo y NO DEBE registrar el movimiento.

**R69** — SI el comprobante no se puede guardar, ENTONCES el sistema NO DEBE registrar el
movimiento; y SI el movimiento no se puede registrar, ENTONCES el sistema NO DEBE dejar el archivo
accesible.

**R70** — El sistema DEBE entregar el comprobante solo mediante un enlace temporal, generado tras
comprobar en el servidor que quien lo pide puede ver ese movimiento.

**R71** — La tienda DEBE poder ver en `/mi-wallet` el comprobante de los movimientos de su propio
libro, y NO DEBE poder ver comprobantes de otra tienda ni de la caja.

**R72** — El sistema NO DEBE permitir reemplazar ni borrar un comprobante adjunto; DONDE un
movimiento manual no tenga comprobante, un rol de acceso total DEBE poder adjuntarlo después.

**R73** — El sistema DEBE nombrar el comprobante en pantalla con un rótulo legible (p. ej.
«Comprobante del pago del 12 sep») y NO DEBE mostrar su ruta de almacenamiento.

### J. Permisos

**R74** — El sistema DEBE permitir ver `/wallet` y los estados de cuenta de tienda, mensajero y
bodega solo a los roles de acceso total; a cualquier otro rol o sin sesión DEBE responder «no
encontrado» sin exponer datos.

**R75** — El sistema DEBE permitir registrar, pedir «Así queda», anular y adjuntar comprobantes
solo a los roles de acceso total, comprobándolo en el servidor en cada acción.

**R76** — El sistema DEBE mantener que decidir un cobro de gasto fijo sea solo del maestro, y que
decidir un cobro por rechazo sea de los roles de acceso total.

### K. No-regresión del dinero

**R77** — Para los mismos datos, el saldo de cada tienda, la cuenta por pagar de cada mensajero y
el pendiente de cada bodega DEBEN valer exactamente lo mismo antes y después de desplegar esta
feature.

**R78** — Para los mismos datos, el dinero en caja, la ganancia, «de terceros», la composición de
la ganancia y el desglose de egresos DEBEN valer exactamente lo mismo antes y después de desplegar
esta feature.

**R79** — Registrar, repartir y anular pagos a tiendas y a mensajeros DEBE conservar sus topes, su
idempotencia y sus efectos actuales.

**R80** — La generación, aprobación, rechazo y reversa de los cobros de gasto fijo DEBEN conservar
su comportamiento actual.

**R81** — Los cobros por rechazo (cola, aprobar, rechazar y sus apuntes en los dos libros) DEBEN
conservar su comportamiento actual.

**R82** — Registrar y anular premios del ranking DEBE conservar su efecto actual en el libro del
mensajero y en la caja.

**R83** — La feature NO DEBE modificar ni borrar ninguna fila existente de los libros, y su
despliegue NO DEBE ejecutar ningún backfill sobre ellos. (La corrección de los 203 cobros
históricos de P15, si el humano elige A o B, es una ficha aparte con su propio spec.)

**R84** — El navegador NO DEBE convertir importes a número ni hacer aritmética con ellos: todo
importe, saldo corrido, total del periodo y cifra de «Así queda» DEBE llegar calculado del
servidor como texto.

### L. Guardias contra la reaparición

**R85** — El gate DEBE fallar si en alguna superficie de la wallet reaparece un campo de texto que
pida un identificador de cierre o de otra entidad.

**R86** — El gate DEBE fallar si alguna superficie de la wallet puede pintar o descargar un origen
sin nombre legible (etiqueta incompleta o caída al valor técnico).

**R87** — El gate DEBE fallar si algún filtro de concepto de la wallet se puebla desde el catálogo
completo de conceptos en lugar de los conceptos con movimientos.

**R88** — El gate DEBE fallar si alguna superficie de la wallet, renderizada con datos que llevan
identificadores internos, muestra uno en texto visible, nombre accesible, marcador de posición,
valor de control o descarga.

**R89** — Cada guardia de R85–R88 DEBE ir acompañada de una contraprueba que demuestre que caza el
defecto que vigila.

### M. Deuda del inventario que entra aquí

**R90** — La aclaración del importe «Cargos» DEBE nombrar los cobros de Ordenex en todas las
superficies donde aparece, igual que ya lo hace `/mi-wallet`.

**R91** — El detalle de un cobro por rechazo y el de un cobro de un costo DEBEN decir en palabras
si movieron el dinero en caja y la ganancia.

**R92** — El código de la wallet NO DEBE conservar las afirmaciones desactualizadas del inventario
(`design.md` §1.6).

### N. Pago por cuenta de una tienda (hallazgo medido en producción el 2026-09-24)

Motivo: los 203 «cobros» de Nuform (₡25.769.034,50) eran pagos hechos POR CUENTA de la tienda; se
registraron como cobro porque no existía otro tipo, y por eso ninguno sacó dinero de la caja
(`progress/medicion_457.md`, `design.md` §1.9).

**R93** — CUANDO se registre un pago por cuenta de una tienda, el sistema DEBE registrar en el mismo
acto una salida de dinero de las tiendas en la caja y un cargo en el libro de esa tienda, ambos por
el mismo monto y con la misma fecha, y NO DEBE cambiar la ganancia de Ordenex.

**R94** — El diálogo DEBE presentar «Pago por cuenta de una tienda» y «Cobrar un costo a una
tienda» como tipos distintos, cada uno con una frase visible que diga si sale dinero de la caja, y
«Así queda» DEBE mostrar la línea de la caja cambiando en el primero y «La caja no cambia» en el
segundo.

**R95** — La tienda DEBE ver en `/mi-wallet` cada pago por cuenta suya como un pago que Ordenex hizo
por su cuenta a su beneficiario (p. ej. «Pago que Ordenex hizo por tu cuenta a Facebook»), con
motivo, referencia y comprobante si lo hay, y NUNCA como «Cobro de Ordenex».

**R96** — CUANDO se anule un pago por cuenta de una tienda, el sistema DEBE devolver el monto al
saldo de la tienda y a la caja como dinero de las tiendas, sin cambiar la ganancia.

**R97** — SI un pago por cuenta deja el saldo de la tienda en contra, ENTONCES «Así queda» DEBE
avisarlo en palabras antes de confirmar, con el saldo resultante y su signo.

## Fuera de alcance (decidido o a decidir aparte)

- **Corregir el posible doble conteo de «Dinero en caja»** (`design.md` §1.8). Es un hallazgo de
  dinero: se mide en la fase 0 y se decide aparte. R78 exige precisamente que esta feature NO lo
  cambie. **No es lo mismo** que el hallazgo de los 203 cobros (§1.9): son dos efectos que se
  suman.
- **Corregir los 203 cobros históricos de Nuform** (P15): la 458 crea el tipo correcto para lo que
  venga; qué se hace con lo ya registrado lo decide el humano y, si hay que tocar filas, va en una
  ficha propia.
- **Unificar el efecto en caja de las dos formas de cobrar a una tienda** (cobro de un costo frente
  a cobro por rechazo). Es una decisión de dinero; aquí solo se hace visible (R43, R91).
- El backend del pago recibido de una tienda: es la 457.
- Una wallet propia del mensajero o de la bodega (hoy no existe superficie de solo lectura para
  ellos; `/mi-bodega` no se toca).

## Trazabilidad prevista (R → test)

Rutas propuestas; el implementer las fija en `progress/impl_458<hija>.md`.

| Requisitos | Test previsto |
| --- | --- |
| R1, R2, R88, R89 | `tests/unit/guards/wallet-sin-uuid.guardia.test.tsx` (render de cada superficie con fixtures uuid + contraprueba) |
| R3 | `tests/unit/descarga/columnas-sensibles.guardia.test.ts` (existente, ya cubre toda descarga) + casos nuevos por columna nueva |
| R4 | `tests/unit/services/wallet-anulacion-service.test.ts` (reverso sin descripción) |
| R5, R6, R9, R86 | `tests/unit/components/wallet-origen-legible.test.ts` + `tests/unit/guards/wallet-origen-total.guardia.test.ts` |
| R7, R8 | `tests/unit/components/wallet-origen-enlace.test.tsx` |
| R10, R11, R12, R85 | `tests/integration/db/wallet-cierres-selector.test.ts` + `tests/unit/guards/wallet-sin-campo-id.guardia.test.ts` |
| R13, R14, R15, R87 | `tests/integration/db/wallet-conceptos-con-movimientos.test.ts` + `tests/unit/guards/wallet-conceptos-sin-seed.guardia.test.ts` |
| R16 | `tests/unit/utils/wallet-fecha-cr.test.ts` + casos de borde 23:30 CR en los tests de integración |
| R17–R24, R31 | `tests/integration/db/estado-cuenta-saldo-corrido.test.ts` (WHERE y orden contra la base) + `tests/unit/utils/saldos-corridos.test.ts` + `tests/components/EstadoCuenta.test.tsx` |
| R25, R66 | `tests/components/EstadoCuentaAnulados.test.tsx` |
| R26–R28, R38 | `tests/components/EstadoCuentaAcciones.test.tsx` |
| R29, R45, R56 | `tests/components/WalletRefrescoDirigido.test.tsx` (claves SWR invalidadas, incluida la fila del listado) |
| R30 | `tests/components/EstadoCuentaSatelite.test.tsx` + los tests de conciliación existentes |
| R32–R34, R71 | `tests/integration/mi-wallet-page.test.tsx` (ampliado) + `tests/unit/guards/mi-wallet-335.guardia.test.ts` (existente) |
| R35–R41, R46 | `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` (reescrito) + `tests/unit/components/wallet-conceptos-manuales.test.ts` |
| R42–R44 | `tests/unit/utils/efecto-movimiento.test.ts` + `tests/unit/actions/wallet-previsualizar-action.test.ts` |
| R47, R48 | `tests/unit/services/registro-movimiento-enrutado.test.ts` + tests de idempotencia existentes (`liquidacion-idempotencia`, `wallet-tienda-cobro`) |
| R49–R55 | `tests/integration/wallet-page.test.tsx` (ampliado) + `tests/integration/db/libro-caja-a-quien.test.ts` |
| R57 | tests existentes de colas y plantillas (`wallet-page-cobros-pendientes`, `wallet-cobros-rechazo-tienda-panel`, `wallet-gastos-fijos-panel`) sin cambios |
| R58–R65 | `tests/unit/services/wallet-anulacion-service.test.ts` + `tests/integration/db/wallet-anulacion-concurrencia.test.ts` |
| R67–R73 | `tests/unit/services/wallet-comprobante-service.test.ts` + `tests/integration/db/wallet-comprobante-alcance.test.ts` |
| R74–R76 | `tests/unit/actions/wallet-*-actions.test.ts` (roles) + `tests/integration/wallet-*-page.test.tsx` |
| R77–R83 | **Fase 0**: `tests/integration/db/wallet-caracterizacion-458.test.ts` (fotografía de cifras antes/después) + informe de mutaciones |
| R84 | guardias money-safe existentes (`liquidacion-money-safe`, `mi-wallet-335`) ampliadas a las carpetas nuevas |
| R90–R92 | `tests/unit/guards/wallet-textos-458.guardia.test.ts` |
| R93, R96 | `tests/unit/services/pago-por-cuenta-tienda-service.test.ts` + `tests/integration/db/pago-por-cuenta-tienda.test.ts` (los dos libros en una transacción, efecto en `derivarCaja`) |
| R94, R97 | `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` + `tests/unit/utils/efecto-movimiento.test.ts` |
| R95 | `tests/integration/mi-wallet-page.test.tsx` (rótulo desde el lado de la tienda) |

## Preguntas abiertas — PUNTO DE APROBACIÓN

Cada una trae la **decisión propuesta** (la que este spec asume) y la **alternativa**. Si el
humano no dice nada, vale la decisión.

**P1 — ¿El uuid en la DIRECCIÓN (URL o `href`) viola H6?** La ruta del estado de cuenta
(`/wallet/tiendas/<tienda>`) y los enlaces «Ver el cierre» (`/cierres-admin?cierre=<uuid>`)
necesitan una clave. *Decisión:* la dirección es navegación, no contenido: se permite el uuid en
la URL y en el `href`, y H6 se aplica a lo que la página muestra, pide o descarga. *Alternativa:*
una clave pública legible por cuenta (columna nueva con migración en `usuario`, unicidad y manejo
de renombres), que toca los cimientos y obliga al gate completo.

**P2 — ¿El selector de cierre de `/mi-wallet` nombra al mensajero?** La 335 decidió no revelarle a
la tienda qué mensajero movió su dinero. *Decisión:* en `/mi-wallet` se conserva día + número de
movimientos (con búsqueda por día); el mensajero solo en superficies de acceso total.
*Alternativa:* mostrarlo también a la tienda.

**P3 — Totales del periodo: ¿netos de anulaciones o brutos?** Hoy «Ya pagado» y «A favor» cuentan
el pago anulado y su devolución, y una nota lo explica. *Decisión:* los totales de abonos y cargos
del periodo excluyen los pares anulados (original + contra-asiento), la nota desaparece y R22 se
cumple igual; el saldo no cambia. *Alternativa:* totales brutos con la nota actual.

**P4 — Orden del extracto.** *Decisión:* cronológico ascendente, con el saldo inicial arriba (como
un extracto de banco). *Alternativa:* más reciente primero, con el saldo inicial abajo.

**P5 — ¿El nombre de la persona o proveedor es obligatorio en el gasto variable?** *Decisión:*
obligatorio en sueldo y en gasto variable, porque es lo que llena «A quién». *Alternativa:*
opcional en gasto variable («Sin proveedor»).

**P6 — ¿Se puede adjuntar el comprobante después de registrar?** *Decisión:* sí, solo si aún no
tiene, y nunca reemplazarlo ni borrarlo (R72). *Alternativa:* solo al registrar.

**P7 — Tipos y tamaño del comprobante.** *Decisión:* JPG, PNG, WEBP y PDF, tope de 5 MB por
configuración. *Alternativa:* solo imágenes, con el mismo tope que las evidencias de gestión.

**P8 — ¿Dónde se guardan los comprobantes?** *Decisión:* un bucket privado nuevo
`wallet-comprobantes`, configurable por entorno; hay que crearlo en local, preview y producción
antes del despliegue. *Alternativa:* reutilizar un bucket privado existente con un prefijo, que
evita el paso de despliegue pero mezcla dominios en un mismo bucket.

**P9 — ¿Se puede anular un cobro por rechazo ya aprobado?** *Decisión:* no entra como «movimiento
manual» de H5 (lo produce una decisión sobre una cola, con sus propias reglas); en 458 queda sin
anulación, y su detalle lo dice. *Alternativa:* incluirlo en la anulación uniforme.

**P10 — Posible doble conteo en «Dinero en caja»** (`design.md` §1.8). *Decisión:* se mide en la
fase 0 y se lleva al humano como hallazgo aparte; esta feature no toca la derivación.
*Alternativa:* corregirlo dentro de la 458 (cambiaría cifras de dinero ya vistas: contradice R78).
**No es el hallazgo de los 203 cobros:** aquel es un egreso que falta; este, un ingreso contado
dos veces. Sobre la línea base de producción se suman (`design.md` §1.9).

**P11 — Fechas en calendario de Costa Rica (R16).** Hoy las tablas cortan el día en UTC: un
movimiento de las 19:00 de Costa Rica aparece con fecha del día siguiente y cae en el periodo
siguiente. *Decisión:* toda la wallet pasa a Costa Rica, incluidos los filtros de periodo del libro
de caja (cambia qué movimientos entran en un periodo de borde; los totales del libro completo no
cambian). *Alternativa:* solo las superficies nuevas.

**P12 — ¿Quién puede anular?** *Decisión:* los roles de acceso total (maestro y admin), como hoy
para pagos y egresos. *Alternativa:* solo el maestro.

**P13 — «A quién» en los ingresos de un cierre** (flete, comisión, contra-entrega), que involucran
varias tiendas. *Decisión:* el mensajero del cierre, con enlace a su estado de cuenta, y el origen
enlaza al cierre. *Alternativa:* «Tiendas del cierre (N)» con la lista en el panel de detalle.

**P14 — ¿El pago por cuenta de una tienda tiene tope?** El pago a una tienda no puede superar su
saldo a favor; en producción los pagos por cuenta de Nuform sí lo superaron (por eso debe
₡6.170.666,55). *Decisión:* sin tope, como el cobro de un costo, con el aviso de R97 antes de
confirmar. *Alternativa:* tope en el saldo a favor, que habría bloqueado lo que la operación hizo
de verdad.

**P15 — ¿Qué se hace con los 203 «cobros» históricos de Nuform (₡25.769.034,50, del 8 al 23 de
septiembre)?** **Pregunta previa, sin la cual ninguna opción es segura: ¿esos pagos salieron del
efectivo de la caja o de otra cuenta de Ordenex?** Impacto medido sobre la línea base de producción
(`progress/medicion_457.md`, M6; cifras derivadas por cálculo, detalle en `design.md` §1.9):

| Opción | Dinero en caja | De las tiendas | Ganancia | Saldo de Nuform | Qué toca |
| --- | --- | --- | --- | --- | --- |
| Hoy | 24.653.587,47 | 29.059.224,00 | −4.405.636,53 | −6.170.666,55 | — |
| **A** — reclasificar las 203 al tipo nuevo, con su salida de caja en la fecha original, por una migración revisada fila a fila | −1.115.447,03 | 3.290.189,50 | sin cambio | sin cambio | 203 filas del libro de la tienda cambian de concepto (excepción explícita a la inmutabilidad) + 203 salidas nuevas en la caja, repartidas del 8 al 23 sep |
| **B** — un solo ajuste de caja que cuadre | −1.115.447,03 | 3.290.189,50 | sin cambio (si el ajuste es de las tiendas); −30.174.671,03 si se hiciera como «ajuste que resta» | sin cambio | 1 salida nueva en un solo día; las 203 filas siguen diciendo «Cobro de Ordenex» a Nuform |
| **C** — dejarlas y explicar la diferencia en pantalla | sin cambio | sin cambio | sin cambio | sin cambio | 0 filas; una nota permanente en la caja y en el estado de cuenta de Nuform |

Lectura de la tabla: A y B dejan «Dinero en caja» NEGATIVO (−1.115.447,03), y si además se
descontara el doble conteo de P10 la estimación baja a −9.186.220,50. Una caja no puede haber
pagado más de lo que entró: o parte de esos pagos salió de otra cuenta, o hay entradas que la app
no registra (capital, otra cuenta). Por eso la pregunta previa.
*Recomendación (no decisión):* si el humano confirma que salieron de la caja, **A** —las cifras
por día quedan ciertas, Nuform deja de leer «Cobro de Ordenex» en pagos que no lo son y su saldo no
se mueve ni un céntimo—, ejecutada como ficha propia, con la lista de las 203 filas revisada antes
(las 3 que no empiezan por «pago» —«abono» 453.000, «compra» 400.000, «facebook» 11.233,20— se
miran una a una) y con la suma de control antes y después. Si salieron de otra cuenta, ninguna de
las tres corrige lo que pasa y hay que decidir cómo entra esa otra cuenta en la wallet.

**P16 — ¿Se adelanta el pago por cuenta?** Mientras no exista, la operación seguirá registrando
esos pagos como cobros y la diferencia de la caja seguirá creciendo. *Decisión propuesta:* sacarlo
como ficha hija temprana (458-1b en `design.md` §9), que lo añade al diálogo ACTUAL y lo absorbe
después el registro único. *Alternativa:* esperar a 458-3.
