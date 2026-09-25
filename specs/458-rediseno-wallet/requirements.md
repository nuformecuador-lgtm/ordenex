# 458 — Rediseño de la wallet: cada movimiento dice qué, quién, por qué y cómo quedó

**Zona:** fullstack. **SDD:** sí. **Complejidad:** alta. **Depende de:** 461 y 457 en `dev` (orden
decidido por el humano el 2026-09-25: 461 → 457 → 458 hijas). **Sale con:** la release completa.
**Se parte en cinco fichas hijas** (`design.md` §9): este documento es el QUÉ de todas ellas; cada
hija implementa un subconjunto de requisitos y lo declara en su `progress/impl_458-<hija>.md`.

> **Reescrito el 2026-09-25** sobre el árbol real de `dev` (con la 459 y la 462 dentro) y sobre los
> specs aprobados de la 461 y la 457. La versión anterior (2026-09-24) se escribió antes de esas
> fichas: lo que ellas resolvieron se retira aquí (§0) y lo que queda se precisa con sus nombres.
> **Límite declarado:** el código de la 461 vive en `origin/feature/461-final` y no está en el árbol
> de trabajo (`CobroTiendaService.ts` de `dev` no tiene `anular` ni puerto de caja); lo de la 461 se
> toma de su spec aprobado, de `progress/contraste_461.md` y de la `status_note` de la ficha, y cada
> hija lo confirma en el archivo real al abrirse (`design.md` §0.2).

## El encargo, en palabras del humano (2026-09-24)

> «Esa falencia la tenemos en gran parte de la wallet.»

Pedido con **«muchísima atención»**: (1) el filtro de cierre por ID escrito a mano, (2) el origen
crudo (`gestion_orden`) y (3) los conceptos sin movimientos en los filtros. Barrer **toda** la
wallet, no solo los casos del primer inventario. El 2026-09-25 el humano decidió que el rediseño
**entra en la release completa** y que la auditoría de la wallet (`progress/auditoria_wallet.md`)
le añade D3, P2 y P4–P7.

**Fuente del diseño:** la maqueta aprobada (`https://claude.ai/artifact/XwjyYvp2Bw6GT7aUhgF86Z`),
cinco pantallas: (1) estado de cuenta de una tienda, (2) «Registrar un movimiento», (3) libro de caja
con panel de detalle, (4) «Mi wallet» de la tienda, (5) detalles (selector de cierre, origen con
nombre y enlace, conceptos con cuenta). Su contenido llegó transcrito por el leader; **los nombres de
la maqueta se leen con los NOMBRES NUEVOS de la 461** (`specs/461-…/design.md` §7): donde la maqueta
decía «Cobrar un costo» se lee «Ordenex le cobra a la tienda», donde decía «Pago por cuenta» se lee
«Ordenex paga un gasto de una tienda», donde decía «Ajuste» se lee «Corrección de caja», etc.

## Decisiones FIRMADAS por el humano (no se reabren)

- **H1** — El comprobante es **OPCIONAL**.
- **H2** — Sueldos y proveedores se identifican con **NOMBRE LIBRE** (no hay catálogo de personas ni
  de proveedores).
- **H3** — La tienda **SÍ ve** el comprobante que subió Ordenex.
- **H4** — Mensajeros y bodegas satélite reciben **el mismo estado de cuenta** que la tienda.
- **H5** — **Anular es uniforme** para todo movimiento manual o decidido por una persona: motivo
  obligatorio + contra-asiento visible. Nada se borra.
- **H6 (regla dura)** — Ningún identificador interno (uuid de cierre, tienda, pago o movimiento) se
  **muestra**, se **pide** ni se **descarga** en ningún lugar de la wallet.
- **Heredadas de la 461 (HD1–HD5):** el cobro a una tienda es un **cargo** (ganancia +, «De las
  tiendas» −, «Entró» sin cambio); la invariante R8 no tiene excepción; los conceptos se nombran
  **desde Ordenex diciendo quién le paga a quién**; la ayuda y el asistente se actualizan dentro de
  cada ficha; es dinero → fase 0, R7/R8 al céntimo, contraste en producción, tabla R→test, recorrido.
- **Heredadas de la 459:** la cifra principal de la caja se llama «Flujo de dinero registrado» o
  «Dinero en caja» según haya saldo inicial (estado que decide el servidor), y «Movimiento neto del
  periodo» con filtros; el capital de Ordenex es la tercera cifra; «De las tiendas» ES la suma de los
  saldos de las tiendas.
- **Auditoría del 2026-09-25 (decisión del humano):** entran en la 458 la anulación del cobro por
  rechazo aprobado (35 en producción por ₡95.824) y de la indemnización por incidente (D3), el uuid
  del cierre en `/wallet/mensajeros` (P2), la pista de cargos (P4), el nombre de tienda inconsistente
  (P5), el pago a mensajero no anulable desde la wallet (P6) y los textos (P7).

## Vocabulario

- **Superficies de la wallet:** `/wallet`, `/wallet/tiendas` (y el estado de cuenta de cada tienda),
  `/wallet/mensajeros` (y el de cada mensajero), `/wallet/satelites` (y el de cada bodega),
  `/mi-wallet`; sus tablas, paneles, diálogos, filtros y descargas.
- **Identificador interno:** cualquier uuid (o fragmento reconocible) de una fila de la base. La
  **guía** de una orden NO es identificador interno: es un dato del negocio.
- **Cuenta:** una tienda, un mensajero o una bodega satélite, con su libro y su saldo.
- **Abono / cargo (en el estado de cuenta):** abono es todo movimiento que mueve el saldo a favor
  del titular de la cuenta; cargo, todo lo que lo mueve en su contra. (No confundir con «cargo a una
  tienda» de la 459/461, que es una clase de liquidez de la caja.)
- **Nombre desde Ordenex / lectura desde la tienda:** los dos diccionarios de la 461 (§7.2–§7.5).
- **Movimiento anulable:** el que registra o decide una persona: sueldo, gasto de Ordenex, gasto
  fijo cobrado, corrección de caja (suma/resta), cobro de Ordenex a una tienda, cobro por rechazo
  aprobado, indemnización por incidente, pago de un gasto de una tienda, aporte de dinero a la caja,
  pago de Ordenex a una tienda, pago de Ordenex a un mensajero, pago de una tienda a Ordenex (457) y
  premio del ranking. Lo que produce la aprobación de un cierre NO es anulable desde la wallet.
- **Contra-asiento:** el movimiento de igual monto y sentido contrario que anula a otro en el mismo
  libro; fechado el día de la anulación (CR), como la 172, la 459, la 461 y la 457.
- **Origen:** la entidad que produjo el movimiento (cierre, gestión de orden, pago, cobro, premio,
  plantilla, incidente, registro a mano).
- **Estado de anulación derivado:** «vigente» o «anulado» de una fila, decidido por el **servidor**
  a partir de su documento o de su contra-asiento, nunca por lo que haya en la página que se mira.

## 0. Requisitos RETIRADOS: lo que ya resolvieron otras fichas

Cada requisito de la versión anterior que ya está hecho se lista con la ficha que lo resolvió. Al
abrir cada hija se **confirma en el archivo real** (el índice del grafo está rancio para la 459 y la
461, y el código de la 461 no está en el árbol de trabajo).

| R anterior | Qué pedía | Resuelto por | Dónde confirmarlo |
| --- | --- | --- | --- |
| R16 (parte) | Fechas de la wallet en calendario de Costa Rica: columnas y rótulos de cierre | **459** (`fechaDiaMovimientoCR`, `mi-wallet-cierres.ts:45-53`) | `lib/utils/fecha-dia-iso.ts:48`; `WalletLedger.tsx:243` |
| R16 (parte) | Filtros de periodo en día CR con `hasta` inclusivo del día; fecha de caja de los pagos (T1, T2 de la auditoría) | **461** (`status_note`: «T1 … T2 …») | `lib/types/wallet.ts:520-521`, `wallet-tienda.ts:179-180`, `wallet-mensajero.ts:159-160` deben dejar de usar `z.coerce.date()`; `LiquidacionService.ts:672,687` |
| R29 (pantalla actual) | Refresco de la fila de saldos / cuentas por pagar tras pagar o anular desde el desglose (P1) | **461** (`status_note`: «Frontend: P1») | `PagoTiendaAcciones.tsx:136-142` debe invalidar también `["wallet-tiendas:saldos", …]` |
| R35 (parte) | Catálogo agrupado por lo que le pasa a la caja | **459** (grupos) + **461** (siete nombres, tres encabezados, frase de efecto de una línea) | `wallet-conceptos-manuales.ts` (`GRUPO_CONCEPTO_LABEL`, `FRASE_DEL_EFECTO`) |
| R40 (parte) | «A quién se le paga» como texto libre en el pago por cuenta | **459** (`pago_por_cuenta_tienda.beneficiario`) | `db/schema.prisma:2056`; `RegistrarMovimientoCajaDialog.tsx:112` |
| R41 (parte), R67–R70 (parte) | Comprobante opcional, tipos y tamaño, bucket privado, ruta sin ids, enlace temporal | **459** (config, `lib/utils/comprobante.ts`, `BUCKETS.WALLET_COMPROBANTES`, `DocumentoCajaAcciones`) para pago de un gasto y aporte; **457** para el pago de la tienda a Ordenex | `lib/config/wallet-comprobante.ts`; `lib/storage/buckets.ts:22` |
| R48 | Idempotencia de todo registro del catálogo (D2 de la auditoría) | **459** (pago de un gasto, aporte), **172** (pagos), **457** (abono), **461** (cobro, corrección, sueldo, gasto: `status_note` «D2») | claves en cada borde; `wallet_movimiento` con `origen_id` no nulo o columna UNIQUE |
| R49, R78 (lectura) | «Las mismas cifras que hoy produce la derivación» | **459** + **461**: se leen sobre `derivarCaja` de la 461 (cargos fuera de «Entró», tres dueños, reversos de cargos) | `lib/utils/caja-tesoreria.ts:272-294` (+ `reversosDeCargos` de la 461) |
| R58 (parte), R63 (parte) | Anulación con motivo del cobro a una tienda y de la corrección de caja | **461** (`cobro_tienda_anulacion`, `anularCobroTiendaAction`; «D3 parcial: anular la corrección de caja») | `lib/actions/wallet-tienda.ts`; el molde que la 461 dejó para la corrección (ver `design.md` §0.2) |
| R58 (parte) | Anulación del pago por cuenta y del aporte | **459** (documento con anulación propia) | `PagoPorCuentaTiendaService.anular`, `AporteCapitalService.anular` |
| R66 (parte) | «Reversar» no debe ofrecerse sobre un egreso ya reversado (P3) | **461** (`status_note` «P3»), **a medias** según `progress/review_461.md` H5: el reverso en OTRA página no se ve. Lo que queda es R71 de este spec | `WalletLedger.tsx:290-300` |
| R90 | La pista de «Cargos» nombra los cobros de Ordenex en `/wallet/tiendas` (P4) | **461** §7.5 (`cargosHint`: «Fletes, comisión, IVA y los cobros de Ordenex a la tienda») | `desglose-tienda-labels.ts:45` (hoy «Fletes, comisión e IVA») |
| R91 (parte) | El detalle del cobro a una tienda dice si movió la caja y la ganancia | **461** (frase de efecto y pista del cobro) | `FRASE_DEL_EFECTO.cobro_tienda` |
| R92 (parte) | Comentarios desactualizados T7 (`mi-wallet-cierres.ts` «trampa horaria») y T8 (`cargosHint`) | **459** (T7), **461** (T8) | los dos archivos |
| R93, R95, R96 | Pago por cuenta de una tienda: dos libros en una transacción, lectura desde la tienda, anulación | **459** (R29–R53 de su spec) + **461** (nombres «Ordenex paga un gasto de una tienda» / «Ordenex pagó un gasto por ti») | `PagoPorCuentaTiendaService.ts`; `CATEGORIA_MI_WALLET_LABEL` |
| R94 | Distinción visible pago por cuenta / cobro, con frase sobre la caja | **459** (R59/R60) + **461** (R40/R41) | `FRASE_DEL_EFECTO` |
| P8, P10, P14, P15, P16 (preguntas) | Bucket, doble conteo, tope del pago por cuenta, los 203 cobros, adelantar el pago por cuenta | **459** (todas) | `specs/459-…/design.md` §14 |
| Hija 458-1b | Pago por cuenta de una tienda | **Absorbida por la 459.** No existe en la partición nueva | — |
| «Uuid del filtro de cierre en `/mi-wallet`» | Selector en vez de campo de texto | **335** (`MiWalletFiltros.tsx:107-126`, `mi-wallet-cierres.ts`). **En `/wallet/tiendas` NO está resuelto**: `DesgloseMovimientosTienda.tsx:380-386` sigue con `<Input placeholder="ID del cierre">`, y el spec de la 461 no lo toca → sigue en esta ficha (R10) | los dos archivos |

**No retirado aunque parezca hecho:** la «Fuera de alcance» de la versión anterior decía «unificar el
efecto en caja de las dos formas de cobrar a una tienda». La 461 lo hizo (el cobro es un cargo como
el flete por rechazo), así que ya no es una decisión pendiente: es el punto de partida.

## Requisitos

### A. Regla dura: ningún identificador interno (H6)

**R1** — El sistema NO DEBE mostrar ningún identificador interno, completo o recortado, en el texto
visible ni en el nombre accesible de ningún elemento de las superficies de la wallet (hoy vivo:
`CIERRE_ENLACE.identificacion` en un `sr-only`, `wallet-mensajeros-labels.ts:247`).

**R2** — El sistema NO DEBE pedir al usuario que escriba, pegue o copie un identificador interno en
ningún control ni texto de ayuda de las superficies de la wallet (hoy vivo: `/wallet/tiendas` y
`/wallet/mensajeros`, «ID del cierre» y «Pegá el identificador»).

**R3** — El sistema NO DEBE incluir ningún identificador interno en las celdas, encabezados ni nombre
de archivo de ninguna descarga de la wallet, incluidas las nuevas (estado de cuenta con saldo
corrido, libro de caja con «A quién» y «Registró»).

**R4** — SI un texto de la wallet se compone con un dato que puede faltar (descripción, nombre,
referencia, beneficiario), ENTONCES el sistema DEBE sustituir la ausencia por un texto legible y NO
DEBE sustituirla por un identificador interno (hoy latente: `WalletEgresoService.ts:123`).

### B. Todo origen tiene nombre, entidad y enlace

**R5** — El sistema DEBE rotular el origen de cada movimiento de los tres libros con un nombre
legible desde un diccionario TOTAL sobre el catálogo de orígenes (sin caída al valor técnico), en
pantalla y en descarga, con los textos de la 461 §7.3 y los que la 457 añada.

**R6** — El sistema DEBE nombrar en el origen la entidad concreta que lo produjo: el cierre (día CR y
mensajero), la gestión de orden (guía), el pago (día y método), el cobro por rechazo (guía), el
premio (día del podio), el gasto fijo (concepto y periodo), el incidente (guía), el pago de un gasto
(beneficiario) o el registro a mano (concepto).

**R7** — DONDE la entidad de origen tenga una pantalla a la que el rol que mira tiene acceso, el
sistema DEBE ofrecer desde el origen un enlace a esa pantalla, con el identificador solo en la
dirección y nunca en el texto ni en el nombre accesible (precedente: 462 R33).

**R8** — SI el rol que mira no tiene acceso a la pantalla de la entidad de origen, ENTONCES el
sistema DEBE mostrar el nombre del origen sin enlace.

**R9** — CUANDO el catálogo gane un tipo de origen nuevo, el sistema DEBE impedir que compile
mientras ese origen no tenga nombre en los tres diccionarios (caja, tienda, mensajero) y el gate DEBE
fallar si alguno vuelve a ser `Record<string, string>`.

### C. Filtros: cierre por selector, conceptos con movimientos, periodo en Costa Rica

**R10** — CUANDO el usuario filtre por cierre en el estado de cuenta de una tienda o de un mensajero
(y, mientras existan, en los desgloses actuales de `/wallet/tiendas` y `/wallet/mensajeros`), el
sistema DEBE ofrecer un selector con búsqueda por texto, con cada cierre rotulado por su día CR y el
nombre del mensajero; `/mi-wallet` DEBE conservar su selector actual (día y número de movimientos,
sin el mensajero).

**R11** — El sistema DEBE ofrecer en el selector de cierre solo los cierres que tienen al menos un
movimiento en la cuenta que se está mirando.

**R12** — SI el servidor recibe como filtro de cierre un valor que no es un cierre de la cuenta
consultada, ENTONCES el sistema NO DEBE devolver movimientos de ninguna otra cuenta ni de ningún otro
cierre, y el borde DEBE rechazar todo valor que no tenga forma de identificador.

**R13** — El sistema DEBE ofrecer en el filtro de concepto de cada superficie únicamente los
conceptos que tienen al menos un movimiento en el periodo y la cuenta que se están mirando, cada uno
con su número de movimientos y con su nombre del diccionario de esa superficie.

**R14** — MIENTRAS un concepto reservado sin productor (hoy `egreso_gasto` en la caja y
`ajuste_debito` en el libro de la tienda) no tenga movimientos en el periodo, el sistema NO DEBE
ofrecerlo en ningún filtro.

**R15** — CUANDO cambien el periodo o la cuenta y el concepto elegido se quede sin movimientos, el
sistema DEBE seguir mostrándolo elegido con cuenta 0 hasta que el usuario lo quite.

**R16** — Toda superficie nueva de esta ficha (estados de cuenta, libro de caja rehecho, selectores)
DEBE interpretar periodo, fechas de fila, saldo inicial, rótulos de cierre y descargas en el
calendario de Costa Rica con las MISMAS piezas que ya usan las pantallas actuales (día CR de la 459;
borde de periodo con inicio de día CR y cota exclusiva de la 461), y NO DEBE introducir ningún corte
en UTC.

### D. Estado de cuenta de tienda, mensajero y bodega (H4; maqueta, pantalla 1)

**R17** — El sistema DEBE ofrecer un estado de cuenta por cada tienda, cada mensajero y cada bodega
satélite, como página propia accesible desde la fila de esa cuenta en su listado de la wallet.

**R18** — El estado de cuenta DEBE mostrar tarjetas con: el saldo actual con su signo y una frase que
diga en palabras quién le debe a quién y cuánto («Ordenex le debe ₡X a <tienda>» / «<Tienda> le debe
₡X a Ordenex» / «Ordenex le debe ₡X a <mensajero>» / «<Bodega> tiene ₡X por entregar»), el total de
abonos del periodo y el total de cargos del periodo.

**R19** — El estado de cuenta DEBE listar los movimientos como un extracto con: fecha (día CR),
movimiento y motivo (nombre desde Ordenex del concepto, origen con entidad, referencia, indicación de
comprobante y quién lo registró), cargo, abono, saldo corrido y la acción «Ver»; las filas que nacen
de un cierre DEBEN conservar el despliegue de las órdenes que componen su importe (344/345).

**R20** — El estado de cuenta DEBE mostrar como primera fila el saldo inicial del periodo, igual al
saldo de la cuenta al terminar el día CR anterior al inicio del periodo.

**R21** — El saldo corrido de cada fila DEBE ser el saldo de la cuenta completa inmediatamente
después de ese movimiento, sea cual sea el chip de filtro elegido.

**R22** — El sistema DEBE cumplir `saldo inicial + abonos del periodo − cargos del periodo = saldo
final del periodo` al céntimo, y DONDE el periodo termine hoy, ese saldo final DEBE ser igual al saldo
de la tarjeta, al de la fila de la cuenta en su listado y al que hoy deriva el servicio de esa cuenta
(`derivarSaldoTienda`, la cuenta por pagar del mensajero, `saldoDe` de la bodega).

**R23** — El sistema DEBE ordenar los movimientos de un mismo instante con un criterio fijo (fecha,
instante de creación, identificador) en los tres libros, de modo que dos lecturas seguidas del mismo
periodo den el mismo orden y el mismo saldo corrido, y la paginación no repita ni omita filas (m4 de
la auditoría: hoy `listarPorTienda` y `listarPorMensajero` ordenan solo por fecha).

**R24** — El estado de cuenta DEBE ofrecer chips de filtro y un selector de periodo; cada movimiento
DEBE pertenecer exactamente a un chip, decidido por un diccionario TOTAL sobre (concepto, origen) de
su libro: tienda «Todo · Cierres · Pagos · Cobros · Correcciones», mensajero «Todo · Cierres · Pagos
· Premios · Correcciones», bodega «Todo · Declarado · Recibido».

**R25** — MIENTRAS un movimiento esté anulado, el sistema DEBE seguir mostrándolo en el estado de
cuenta, tachado, con el motivo, quién lo anuló y cuándo, y su contra-asiento DEBE verse como fila
propia rotulada como anulación de aquel.

**R26** — DONDE la cuenta sea una tienda con saldo en contra, el estado de cuenta DEBE ofrecer la
acción «La tienda le paga a Ordenex» (el pago recibido de la 457).

**R27** — DONDE la cuenta sea una tienda, el estado de cuenta DEBE ofrecer la acción «Ordenex le
cobra a la tienda».

**R28** — SI la tienda no tiene saldo a favor, ENTONCES el estado de cuenta DEBE mostrar «Ordenex le
paga a la tienda» deshabilitado y decir el motivo en texto visible; con saldo a favor DEBE abrir el
registro con el tope que hoy aplica el pago de la 172.

**R29** — DONDE la cuenta sea un mensajero, el estado de cuenta DEBE ofrecer la acción «Ordenex le
paga al mensajero» (el reparto de la 205) con su previsualización actual.

**R30** — CUANDO se registre o se anule un movimiento desde un estado de cuenta, el sistema DEBE
actualizar sin recargar la página las tarjetas y las filas de ESA cuenta, NO DEBE volver a leer las
cuentas de otras entidades, y al volver al listado la fila de esa cuenta DEBE mostrar el saldo nuevo.

**R31** — DONDE la cuenta sea una bodega satélite, el estado de cuenta DEBE conservar las acciones
de conciliación que hoy existen (marcar y desmarcar lo recibido) con su mismo efecto y sus mismos
textos.

**R32** — El estado de cuenta DEBE permitir descargar el periodo filtrado con las mismas columnas que
se ven, incluido el saldo corrido y la fila del saldo inicial, sin identificadores.

**R33** — El sistema DEBE nombrar a cada tienda, mensajero y bodega con UNA sola función de etiqueta
en toda la wallet (tablas, tarjetas, avisos, historial, origen, «A quién»), de modo que la misma
cuenta no se lea «Tania» en una superficie y «Tania Tienda» en otra (P5).

### E. «Mi wallet» de la tienda (maqueta, pantalla 4)

**R34** — CUANDO un usuario `adminTienda` abra `/mi-wallet`, el sistema DEBE mostrarle el estado de
cuenta de su propia tienda con la misma estructura que R18–R25, con las lecturas desde la tienda de
la 461 §7.5 y las que la 457 reserva («Le pagaste a Ordenex»), y con su selector de cierre actual.

**R35** — El sistema NO DEBE ofrecer en `/mi-wallet` ninguna acción de registrar, cobrar, pagar,
anular ni adjuntar, ni mostrar movimientos o comprobantes de otra tienda ni de la caja.

**R36** — El sistema DEBE acotar `/mi-wallet` a la tienda de la sesión, resuelta en el servidor, y SI
la petición del listado (paginado o completo) trae una clave que nombre una tienda, ENTONCES DEBE
rechazarla como error de validación sin leer nada (m1 de la auditoría: el paginado no es `.strict()`).

### F. Registro único de movimientos (maqueta, pantalla 2)

**R37** — El sistema DEBE ofrecer un único diálogo «Registrar un movimiento» en `/wallet` y en cada
estado de cuenta de tienda y de mensajero, cuyo catálogo son los siete conceptos de la 461 §7.1 más
«Ordenex le paga a una tienda», «Ordenex le paga a un mensajero» y «Una tienda le paga a Ordenex»
(457), repartidos en los tres grupos de la 461 («Sale dinero de Ordenex»: gasto, sueldo, pago de un
gasto de una tienda, corrección que resta, pago a una tienda, pago a un mensajero; «Llega dinero a la
caja»: aporte, corrección que suma, pago de una tienda a Ordenex; «Se descuenta del saldo de una
tienda»: el cobro), más un enlace a las plantillas de gasto fijo.

**R38** — El catálogo NO DEBE ofrecer registrar a mano un gasto fijo.

**R39** — CUANDO el usuario elija un concepto, el diálogo DEBE pedir solo los campos de ese concepto,
DEBE mostrar su frase de efecto de una línea (las siete de la 461 §7.6 conservadas byte a byte; las
tres nuevas con la suya) y NO DEBE enviar al servidor claves que no pertenezcan a ese camino.

**R40** — CUANDO el diálogo se abra desde una acción de un estado de cuenta, el sistema DEBE traer ya
elegidos la cuenta y el concepto de esa acción.

**R41** — DONDE el concepto afecte a una tienda o a un mensajero, el diálogo DEBE pedir la cuenta con
un buscador por nombre, y NO DEBE ofrecer tiendas inactivas donde el camino actual no las admite.

**R42** — DONDE el concepto sea sueldo o gasto de Ordenex, el diálogo DEBE pedir a quién se le paga
(la persona o el proveedor) como texto libre obligatorio; DONDE sea corrección de caja, como texto
libre opcional; el pago de un gasto de una tienda conserva su beneficiario de la 459.

**R43** — El diálogo DEBE pedir en todo concepto el monto, la fecha y el motivo; el comprobante DEBE
ser opcional en todo concepto; y la referencia DEBE ser obligatoria solo donde hoy lo es (método
distinto de efectivo).

**R44** — MIENTRAS el formulario tenga un monto válido y la cuenta requerida elegida, el diálogo DEBE
mostrar un recuadro «Así queda» con el antes y el después, calculados por el servidor con la
derivación de la 461, de: el saldo de la cuenta afectada (si la hay), la cifra principal de la caja
(con el rótulo que le corresponde por su estado), la ganancia de Ordenex, «De las tiendas» y el
capital de Ordenex.

**R45** — SI el concepto elegido no mueve una de esas líneas, ENTONCES «Así queda» DEBE decirlo en
palabras («no cambia») en lugar de omitir la línea.

**R46** — SI al pedir «Así queda» el servidor no responde, ENTONCES el diálogo DEBE decir que no pudo
calcular el efecto y NO DEBE mostrar cifras calculadas en el navegador.

**R47** — SI un pago de un gasto de una tienda o un cobro de Ordenex a una tienda deja el saldo de la
tienda en contra, ENTONCES «Así queda» DEBE avisarlo en palabras antes de confirmar, con el saldo
resultante y su signo (ex R97).

**R48** — CUANDO el registro tenga éxito, el sistema DEBE cerrar el diálogo, avisar con el saldo o la
cifra resultante que devuelve el servidor (con la frase «le debe» de la 461 R54 cuando el saldo queda
en contra) y actualizar las vistas abiertas según R30 y R60.

**R49** — SI el registro falla por validación, ENTONCES el diálogo DEBE conservar lo escrito y
mostrar el motivo bajo el campo que lo produce.

**R50** — El efecto de cada concepto en los libros DEBE ser idéntico al que produce hoy su camino de
registro (tabla de `design.md` §4.1); el del pago de la tienda a Ordenex DEBE ser el que define la
457.

**R51** — Toda entrada del catálogo DEBE enviar la clave de idempotencia de su camino (la genera el
diálogo al abrirse) y NINGUNA entrada DEBE poder registrarse sin ella.

**R52** — El diálogo DEBE decir, para el concepto elegido, en qué libro cae y con qué nombre desde
Ordenex saldrá en cada uno, tomando los nombres de los mismos diccionarios que pintan los libros
(461 R46, extendido a los tres conceptos nuevos).

### G. Libro de caja (`/wallet`; maqueta, pantalla 3)

**R53** — El sistema DEBE conservar en `/wallet` las tarjetas de la 459 (cifra principal con su
rótulo por estado, «Entró», «Salió», «Ganancia de Ordenex», «Lo que Ordenex les debe a las tiendas»,
«Saldo inicial y aportes», «Movimientos») con los mismos importes que produce la derivación de la 461
para el mismo conjunto de movimientos.

**R54** — El libro DEBE ofrecer los filtros Todo / Entra / Sale, «A quién», concepto (según R13) y
periodo, y las tarjetas DEBEN reflejar el conjunto filtrado como hoy.

**R55** — Cada fila del libro DEBE mostrar: fecha (día CR), movimiento y motivo (nombre desde Ordenex
del concepto + motivo/descripción + origen con entidad), «A quién», monto con su dirección
(entra/sale) y su dueño (Ordenex / Tienda / Ordenex (capital)), «Registró» y la acción «Ver».

**R56** — La columna «A quién» DEBE nombrar la tienda, el mensajero, la persona, el proveedor o el
beneficiario del movimiento según la tabla de `design.md` §3.4, con enlace al estado de cuenta cuando
es una tienda o un mensajero, y «—» donde una fila anterior a esta ficha no lo tiene.

**R57** — La columna «Registró» DEBE mostrar el nombre de quien registró el movimiento o, si no lo
registró una persona, «Automático» y la acción que lo produjo («Aprobación del cierre por Ana»,
«Plantilla de gasto fijo», «Cobro por rechazo aprobado por Ana», «Incidente resuelto por Ana»,
«Premio del ranking»).

**R58** — CUANDO el usuario pulse «Ver» en una fila de cualquier superficie de acceso total, el
sistema DEBE abrir un panel lateral con: quién, por qué (motivo), cómo (método y referencia),
comprobante, quién lo registró y cuándo, estado de anulación (motivo, quién, cuándo), «Cómo quedó»
(cifra principal, ganancia, «De las tiendas» y saldo de la cuenta afectada tras ese movimiento) y,
si aplica, «Anular…».

**R59** — CUANDO el usuario filtre por «A quién», el sistema DEBE ofrecer búsqueda por nombre de
tienda, de mensajero o por el nombre libre registrado.

**R60** — CUANDO se registre o se anule un movimiento desde `/wallet`, el sistema DEBE actualizar el
libro, las tarjetas, la composición de la ganancia y el desglose con los filtros vigentes.

**R61** — El sistema DEBE conservar en `/wallet` la cola de cobros de gasto fijo por aprobar, la cola
de cobros por rechazo, la composición de la ganancia y las plantillas de gasto fijo, con su
comportamiento actual.

**R62** — El panel mensual de `/analitica` que muestra la cifra de la caja de un periodo DEBE
rotularla «Movimiento neto del periodo» (con la misma función de rótulo que la tarjeta, pasando que
hay periodo), y NO DEBE decir «Dinero en caja» ni «Flujo de dinero registrado» sobre una cifra
filtrada (menor de la revisión de la 459).

### H. Anulación uniforme (H5)

**R63** — El sistema DEBE ofrecer «Anular…» (motivo obligatorio) sobre todo movimiento anulable
vigente en el panel de detalle de cualquier superficie de acceso total donde aparezca, y DEBE
completar los caminos que hoy no la tienen: sueldo, gasto de Ordenex y gasto fijo cobrado (hoy
«Reversar» sin motivo), indemnización por incidente y cobro por rechazo aprobado (hoy sin ninguna
vía, D3 de la auditoría).

**R64** — CUANDO el usuario anule, el sistema DEBE exigir un motivo no vacío y registrar en una sola
transacción la constancia (motivo, quién, cuándo) y el o los contra-asientos de igual monto y sentido
contrario en cada libro que tocó el original, sin modificar ni borrar el original.

**R65** — El sistema NO DEBE ofrecer «Anular…» sobre un contra-asiento, sobre los movimientos que
produce la aprobación de un cierre, sobre las salidas de los cobros reclasificados (459) ni sobre un
movimiento ya anulado.

**R66** — SI el movimiento ya está anulado, ENTONCES el sistema NO DEBE registrar un segundo
contra-asiento y DEBE avisar que ya estaba anulado.

**R67** — CUANDO dos anulaciones del mismo movimiento lleguen a la vez, el sistema DEBE registrar un
único juego de contra-asientos.

**R68** — El contra-asiento DEBE producir en el saldo de la cuenta, en la cifra principal, en la
ganancia, en «De las tiendas» y en el capital exactamente el efecto inverso del original (tabla de
`design.md` §4.3); en particular, anular un cobro por rechazo DEBE bajar la ganancia y subir «De las
tiendas» en flete + IVA sin tocar «Entró» ni «Salió», y R7/R8 DEBEN seguir dando 0,00.

**R69** — SI una anulación deja el saldo de la cuenta en negativo, ENTONCES el sistema DEBE
registrarla y mostrar el saldo resultante con su signo.

**R70** — El pago a un mensajero DEBE poder anularse desde su estado de cuenta en la wallet con la
misma acción de servidor y el mismo efecto que hoy tiene anularlo desde `/cierres-admin`, que DEBE
seguir funcionando (P6).

**R71** — El estado «vigente / anulado» de cada fila DEBE decidirlo el servidor y viajar en la fila,
de modo que un movimiento anulado se muestre «Anulado» aunque su contra-asiento esté en otra página,
en otro periodo o fuera del filtro; ninguna superficie DEBE deducir el estado de lo que hay en la
página (P3 completo, 461/H5).

**R72** — El sistema DEBE mostrar como anulados los movimientos que se revirtieron antes de esta
ficha sin motivo, con la leyenda «motivo no registrado», sin backfill.

**R73** — CUANDO se anule un cobro por rechazo aprobado, el sistema NO DEBE cambiar el estado del
cobro en su cola, ni el de la gestión ni el de la orden, y NO DEBE volver a ofrecer aprobarlo ni
rechazarlo; el detalle DEBE decir en palabras que el cobro se anuló y que la ganancia bajó.

### I. Comprobantes (H1, H3)

**R74** — DONDE el concepto sea sueldo, gasto de Ordenex, corrección de caja, cobro de Ordenex a una
tienda, pago de Ordenex a una tienda o pago de Ordenex a un mensajero, el diálogo DEBE permitir
adjuntar opcionalmente un comprobante con los mismos tipos y tope que ya aplica la 459 (JPEG, PNG,
WebP, PDF; 4 MB por configuración); los conceptos que ya lo admiten (459, 457) lo conservan.

**R75** — SI el archivo no es de un tipo admitido o supera el tope, ENTONCES el sistema DEBE
rechazarlo explicando el motivo bajo el campo y NO DEBE registrar el movimiento.

**R76** — SI el comprobante no se puede guardar, ENTONCES el sistema NO DEBE registrar el movimiento
y DEBE decirlo; y SI el movimiento no se puede registrar con el comprobante ya guardado, ENTONCES el
sistema DEBE retirar el archivo.

**R77** — El sistema DEBE entregar todo comprobante solo mediante un enlace temporal, generado tras
comprobar en el servidor que quien lo pide puede ver ese movimiento; SI una tienda pide el de un
movimiento ajeno o inexistente, ENTONCES DEBE responder «no encontrado» sin distinguir los dos casos.

**R78** — La tienda DEBE poder ver en `/mi-wallet` el comprobante de los movimientos de su propio
libro que lo tengan (pago de un gasto, cobro, pago de Ordenex a la tienda, pago de la tienda a
Ordenex), y NO DEBE poder ver comprobantes de otra tienda ni de la caja.

**R79** — El sistema NO DEBE permitir reemplazar ni borrar un comprobante adjunto; DONDE un
movimiento anulable no tenga comprobante, un rol de acceso total DEBE poder adjuntarlo después, una
sola vez.

**R80** — El sistema DEBE nombrar el comprobante en pantalla con un rótulo legible («Comprobante del
sueldo del 12 sep») y NO DEBE mostrar su ruta de almacenamiento.

### J. Permisos

**R81** — El sistema DEBE permitir ver `/wallet` y los estados de cuenta de tienda, mensajero y
bodega solo a los roles de acceso total (maestro y admin); a cualquier otro rol o sin sesión DEBE
responder «no encontrado» sin exponer datos.

**R82** — El sistema DEBE permitir registrar, pedir «Así queda», anular y adjuntar comprobantes solo
a los roles de acceso total, comprobándolo en el servidor en cada acción antes de leer ningún saldo.

**R83** — El sistema DEBE mantener que decidir un cobro de gasto fijo sea solo del maestro, y que
decidir o anular un cobro por rechazo sea de los roles de acceso total.

### K. No-regresión del dinero

**R84** — Para los mismos datos, el saldo de cada tienda, la cuenta por pagar de cada mensajero y el
pendiente de cada bodega DEBEN valer exactamente lo mismo antes y después de desplegar cada hija.

**R85** — Para conjuntos de movimientos sin los conceptos nuevos de esta ficha (los reversos del
cobro por rechazo), la cifra principal, «Entró», «Salió», la ganancia, «De las tiendas», el capital,
el estado de la caja, la composición de la ganancia y el desglose de egresos DEBEN valer exactamente
lo mismo que con la 461.

**R86** — Registrar, repartir y anular pagos a tiendas y a mensajeros DEBEN conservar sus topes, su
idempotencia, su historial y sus efectos actuales.

**R87** — La generación, aprobación, rechazo y reversa de los cobros de gasto fijo, y la cola,
aprobación y rechazo de los cobros por rechazo, DEBEN conservar su comportamiento actual.

**R88** — Registrar y anular premios del ranking, pagos de un gasto de una tienda, aportes, cobros de
Ordenex a una tienda, correcciones de caja y pagos de la tienda a Ordenex DEBEN conservar el efecto
que definieron la 293, la 459, la 461 y la 457.

**R89** — La feature NO DEBE modificar ni borrar ninguna fila existente de los libros ni de los
documentos, y su despliegue NO DEBE ejecutar ningún backfill sobre ellos; la reclasificación de la
459 y la migración de datos de la 461 NO DEBEN tocarse.

**R90** — El navegador NO DEBE convertir importes a número ni hacer aritmética con ellos: todo
importe, saldo corrido, total del periodo y cifra de «Así queda» o «Cómo quedó» DEBE llegar
calculado del servidor como texto.

**R91** — El sistema DEBE cumplir al céntimo R7 (cifra principal = ganancia + «De las tiendas» +
capital) y R8 («De las tiendas» = Σ saldos de las tiendas, sin excepción) con los conceptos nuevos
dentro, y la guardia de clasificación de la 461 (R26) DEBE seguir en verde con las contrapartidas
nuevas declaradas.

**R92** — Revertir las migraciones de estructura de esta ficha sobre una base sin filas que las usen
DEBE devolver catálogos, restricciones y tablas exactamente a su estado previo; SI existe alguna fila
que las use, ENTONCES la reversión DEBE fallar sin borrar ningún dato; toda tabla nueva DEBE tener la
seguridad por filas activada.

### L. Guardias contra la reaparición

**R93** — El gate DEBE fallar si en alguna superficie de la wallet reaparece un campo de texto que
pida un identificador de cierre o de otra entidad.

**R94** — El gate DEBE fallar si alguna superficie de la wallet puede pintar o descargar un origen
sin nombre legible (diccionario parcial o caída al valor técnico).

**R95** — El gate DEBE fallar si algún filtro de concepto de la wallet se puebla desde el catálogo
completo de conceptos en lugar de los conceptos con movimientos.

**R96** — El gate DEBE fallar si alguna superficie de la wallet, renderizada con datos que llevan
identificadores internos, muestra uno en texto visible, nombre accesible, marcador de posición, valor
de control o descarga.

**R97** — El gate DEBE fallar si alguna superficie nueva de la wallet rotula un concepto, origen,
grupo o acción con un nombre retirado o reservado de la 461 (§7.8, §7.9): la guardia de nombres de
la 461 DEBE barrer también las carpetas nuevas de esta ficha.

**R98** — El gate DEBE fallar si el estado «anulado» de una fila se calcula en un componente a partir
de otras filas de la página (R71), o si un diccionario de chips deja un par (concepto, origen) sin
chip (R24).

**R99** — Cada guardia de R93–R98 DEBE ir acompañada de una contraprueba que demuestre que caza el
defecto que vigila y de un control de no-vacuidad.

### M. Textos, deuda y ayuda

**R100** — El detalle y la fila de un cobro por rechazo DEBEN decir en palabras que es un cargo (la
ganancia sube y el saldo de la tienda baja, sin dinero nuevo), con el mismo criterio que la 461 usa
para el cobro de Ordenex a una tienda.

**R101** — El código de la wallet NO DEBE conservar las afirmaciones desactualizadas que queden del
inventario (`design.md` §1.6), y el subtítulo de `/wallet` (`page.tsx:110`) NO DEBE decir «dinero en
caja» mientras la caja esté en estado «flujo».

**R102** — Los documentos de ayuda de la caja, de las tiendas, de los mensajeros, de las bodegas
satélite y de «Mi wallet» DEBEN describir cada pantalla como queda tras la hija que la toca (estado
de cuenta, registro único, panel «Ver», anulación uniforme, comprobantes), con los nombres de la 461,
y cada documento tocado DEBE actualizar su fecha y sus fuentes.

**R103** — El contexto del asistente DEBE contener, para maestro y admin, las explicaciones nuevas de
la caja y de los estados de cuenta; para adminTienda, la de «Mi wallet»; y NO DEBE llevar las de la
caja a mensajero, adminTienda ni adminSatelite.

**R104** — Antes de dar cada hija por hecha, el recorrido por rol de `design.md` §10 (maestro,
admin, adminTienda, mensajero, adminSatelite) DEBE tener sus capturas y sus números en `progress/`.

## Fuera de alcance (decidido)

- Una wallet propia del mensajero o de la bodega en solo lectura (hoy no existe superficie para
  ellos; `/mi-bodega` no se toca).
- Cambiar la derivación de la caja (459/461), la reclasificación de los 203 (459) o el backfill de
  los cobros (461).
- El modal «Confirmá el SINPE de GAM» al entrar a `/wallet` (ficha 429; P7 de la auditoría lo
  menciona, no es de la wallet).
- Renombrar las métricas de la analítica (461 P7); solo el rótulo del panel mensual (R62).

## Trazabilidad prevista (R → test), por ficha hija

Rutas propuestas; cada implementer las fija en `progress/impl_458-<hija>.md`. Un requisito que toca
varias hijas aparece en cada una con su parte.

### 458-A — Detalles y guardias sobre las pantallas actuales

| Requisitos | Test previsto |
| --- | --- |
| R1, R2, R96, R99 | `tests/unit/guards/wallet-sin-uuid.guardia.test.tsx` (render de cada superficie con fixtures uuid + contraprueba con el `EnlaceCierre` de hoy) |
| R3 | `tests/unit/descarga/columnas-sensibles.guardia.test.ts` (existente) |
| R5, R6, R9, R94 | `tests/unit/components/wallet-origen-legible.test.ts` + `tests/unit/guards/wallet-origen-total.guardia.test.ts` |
| R7, R8 | `tests/unit/components/wallet-origen-enlace.test.tsx` |
| R10, R11, R12, R93 | `tests/integration/db/wallet-cierres-selector.test.ts` (un cierre ajeno → cero filas; mutación que quita la cuenta del `WHERE` → rojo) + `tests/unit/guards/wallet-sin-campo-id.guardia.test.ts` |
| R13, R14, R15, R95 | `tests/integration/db/wallet-conceptos-con-movimientos.test.ts` + `tests/unit/guards/wallet-conceptos-sin-seed.guardia.test.ts` |
| R33 | `tests/unit/utils/etiqueta-cuenta.test.ts` + guardia de fuente que prohíbe otra composición del nombre en `app/(app)/wallet/**` |
| R36 | `tests/unit/types/wallet-tienda-schemas.test.ts` (`.strict()` en el paginado) |
| R62 | `tests/unit/analitica/panel-mensual-rotulo.test.ts` |
| R84, R90 | fotografía `caja-caracterizacion-459` verde antes y después; barrido money-safe existente |
| R97, R101 | `tests/unit/guards/nombres-wallet-461.guardia.test.ts` (ampliada a las carpetas nuevas) + `tests/unit/guards/wallet-textos-458.guardia.test.ts` |
| R102, R103 | `tests/unit/asistente/contexto-458.test.ts` (bloque A: filtros y orígenes) |
| R104 | `progress/recorrido_458-A/` |

### 458-B — Cimientos (backend, migración)

| Requisitos | Test previsto |
| --- | --- |
| R16, R20–R23 | `tests/integration/db/estado-cuenta-saldo-corrido.test.ts` (tienda, mensajero, bodega; borde 23:30/00:30 CR; orden estable; R22 con y sin anulaciones) + `tests/unit/utils/saldos-corridos.test.ts` |
| R24, R98 | `tests/unit/guards/estado-cuenta-chips-total.guardia.test.ts` |
| R44–R47, R50 | `tests/unit/utils/efecto-movimiento.test.ts` (un caso por concepto, incluido «no cambia» y la línea de capital) + `tests/unit/actions/wallet-previsualizar-action.test.ts` |
| R51 | tests de idempotencia existentes (172, 459, 461, 457) + `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` (toda entrada manda clave) |
| R56, R57 | `tests/integration/db/libro-caja-a-quien.test.ts` (una fila por origen; nombres, nunca ids) |
| R63–R69, R73 | `tests/unit/services/wallet-anulacion-service.test.ts`, `tests/unit/services/rechazo-tienda-cobro-anulacion.test.ts`, `tests/integration/db/wallet-anulacion-458.test.ts` (pasa por las actions; R68 medido con `derivarCaja` sobre filas reales) + `tests/integration/db/wallet-anulacion-concurrencia.test.ts` |
| R71, R72 | `tests/integration/db/libro-caja-documentos-459.test.ts` (ampliado: `documento` para egresos, indemnización y rechazo; reverso en otra página; «motivo no registrado») |
| R74–R80 | `tests/unit/services/wallet-comprobante-service.test.ts` + `tests/integration/db/wallet-comprobante-alcance.test.ts` |
| R81–R83 | `tests/unit/actions/wallet-*-actions.test.ts` (roles antes de leer) |
| R84, R85, R88, R91 | **Fase 0**: `caja-caracterizacion-459.test.ts` (bloque «lo que la 458 añade a propósito») + `tests/integration/db/wallet-caracterizacion-458.test.ts` (saldos, cuentas por pagar, pendientes, saldo corrido) + `caja-invariante-tiendas.test.ts` (pasos «anulación del cobro por rechazo» e «indemnización anulada») + `progress/fase0_458-B.md` (mutaciones) |
| R86, R87 | tests existentes de 172/205/333/337 sin modificar |
| R89 | `reclasificacion-459-*` y `cobro-tienda-461-completar-migration` sin tocar; ningún `UPDATE`/`DELETE` en las migraciones nuevas (test de migración) |
| R92 | `tests/integration/db/wallet-458-migration.test.ts` (enums valor a valor, CHECK, RLS, `down` con y sin filas) |

### 458-C — Registrar un movimiento y panel «Ver»

| Requisitos | Test previsto |
| --- | --- |
| R37–R43, R48, R49, R52 | `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` (reescrito: diez conceptos, tres grupos, campos por concepto, payload solo con sus claves, preselección) + `tests/unit/components/wallet-conceptos-manuales.test.ts` |
| R44–R47 (pantalla) | ídem («Así queda»: cargando, error sin cifras, «no cambia», aviso de saldo en contra) |
| R58, R63–R66, R71 (pantalla) | `tests/components/DetalleMovimientoPanel.test.tsx` + `tests/components/AnularMovimientoDialog.test.tsx` |
| R74–R76, R79, R80 (pantalla) | `tests/unit/components/wallet-comprobante-campo.test.tsx` |
| R100 | `tests/components/DetalleMovimientoPanel.test.tsx` (caso cobro por rechazo) |
| R102, R103 | `contexto-458.test.ts` (bloque C: registrar y anular) |
| R104 | `progress/recorrido_458-C/` |

### 458-D — Estados de cuenta y «Mi wallet»

| Requisitos | Test previsto |
| --- | --- |
| R17–R25, R32 | `tests/components/EstadoCuenta.test.tsx`, `tests/components/EstadoCuentaAnulados.test.tsx`, `tests/integration/wallet-tiendas-estado-page.test.tsx`, `…-mensajeros-…`, `…-satelites-…` |
| R26–R29, R40 | `tests/components/EstadoCuentaAcciones.test.tsx` |
| R30 | `tests/components/WalletRefrescoDirigido.test.tsx` (claves SWR invalidadas; ninguna otra cuenta releída) |
| R31 | `tests/components/EstadoCuentaSatelite.test.tsx` + tests de la 431 verdes |
| R34–R36, R78 | `tests/integration/mi-wallet-page.test.tsx` (ampliado) + `tests/unit/guards/mi-wallet-335.guardia.test.ts` |
| R70 | `tests/components/EstadoCuentaMensajeroAnular.test.tsx` + test existente de `/cierres-admin` |
| R81 | `notFound` por rol y por cuenta inexistente en los tres tests de página |
| R102, R103 | `contexto-458.test.ts` (bloque D: estados de cuenta y mi wallet) |
| R104 | `progress/recorrido_458-D/` |

### 458-E — Libro de caja

| Requisitos | Test previsto |
| --- | --- |
| R53–R57, R59 | `tests/integration/wallet-page.test.tsx` (ampliado) + `tests/components/descarga/WalletDescarga.test.tsx` (aserción de columnas reescrita en el MISMO commit) |
| R58, R60 | `tests/components/WalletLedger458.test.tsx` |
| R61, R83, R87 | tests existentes de colas y plantillas sin cambios |
| R101 | `wallet-textos-458.guardia.test.ts` (subtítulo de `/wallet`) |
| R102, R103 | `contexto-458.test.ts` (bloque E: el libro) |
| R104 | recorrido COMPLETO por rol (`progress/recorrido_458-E/`) |

## Decisiones tomadas (decisión + alternativa; el humano aprobó el alcance)

Las preguntas de la versión anterior que otra ficha resolvió aparecen en §0. Estas son las que
siguen siendo de esta ficha; si alguna no le gusta al humano, se cambia la decisión, no el resto.

**D1 — El uuid en la DIRECCIÓN (URL o `href`) no viola H6.** *Decisión:* la ruta del estado de
cuenta (`/wallet/tiendas/<id>`) y los enlaces «Ver el cierre» (`hrefDetalleCierre`) llevan el uuid
solo en la dirección; H6 aplica a lo que la página muestra, pide o descarga. Es el criterio que la
462 ya firmó para su franja (R33). *Alternativa:* clave pública legible por cuenta (columna nueva en
`usuario`): toca los cimientos por una dirección que no es contenido.

**D2 — El selector de cierre de `/mi-wallet` no nombra al mensajero** (335). *Decisión:* se conserva
día + número de movimientos; el mensajero solo en las superficies de acceso total. *Alternativa:*
mostrarlo también a la tienda.

**D3 — Totales del periodo netos de anulaciones.** *Decisión:* abonos y cargos del periodo excluyen
los pares anulados (original + contra-asiento); la nota «incluye los pagos anulados» desaparece; R22
se cumple igual y el saldo no cambia. *Alternativa:* totales brutos con la nota actual.

**D4 — Orden del extracto.** *Decisión:* cronológico ascendente con el saldo inicial arriba, como un
extracto de banco. *Alternativa:* más reciente primero, con el saldo inicial abajo.

**D5 — «A quién» obligatorio en sueldo y gasto de Ordenex, opcional en la corrección de caja.**
*Alternativa:* opcional en el gasto («Sin proveedor»).

**D6 — Adjuntar el comprobante después, solo si no tiene, nunca reemplazar ni borrar.**
*Alternativa:* solo al registrar.

**D7 — El cobro por rechazo aprobado SÍ se anula (revierte la P9 anterior).** El humano lo decidió
con la auditoría (35 en producción por ₡95.824). *Decisión:* anulación con motivo y contra-asientos
en los dos libros: en la caja **dos** reversos de cargo (flete e IVA por separado, para que la
analítica de impuestos siga cuadrando), en la tienda dos créditos espejo; el cobro conserva su estado
«aprobado» en la cola y su anulación se deriva de la constancia. *Alternativa:* un solo par (flete +
IVA juntos): menos catálogo, pero el IVA anulado dejaría de distinguirse del flete anulado.

**D8 — La indemnización se anula con el molde del reverso de un gasto.** *Decisión:* contra-asiento
`ingreso_ajuste` con el origen del incidente (idempotente por el índice único de la caja) más la
constancia con motivo; la pantalla lo rotula «Anulación de: Indemnización…» desde la constancia, no
desde el concepto. *Alternativa:* una categoría propia `ingreso_reverso_indemnizacion`: más limpia
en el libro, pero es un valor de enum y una clasificación más por un camino con una fila en
producción.

**D9 — «Una tienda le paga a Ordenex» vive en el catálogo del registro único**, en «Llega dinero a la
caja», además de la acción del estado de cuenta (R26). Es lo que la maqueta aprobó. Lo que la D3 de
la 381 protegía —acreditar a una tienda sin que entre dinero— lo cubre la 457 R60 (el dinero entra
en la misma transacción). **Acople:** la 457 R62 («el diálogo NO DEBE ofrecer ningún concepto que
acredite dinero a una tienda») se reescribe en su spec como «…sin que entre en la caja el mismo
importe en la misma transacción»; el leader lo pasa al agente que actualiza la 457. *Alternativa:*
solo desde el estado de cuenta de la tienda; la caja perdería la vista completa de «Llega dinero».

**D10 — Chips por tipo de cuenta** (R24): la maqueta decía «Ajustes», que la 461 retiró como palabra
de concepto; y el mensajero tiene premios y no cobros. *Decisión:* tienda «Todo · Cierres · Pagos ·
Cobros · Correcciones»; mensajero «Todo · Cierres · Pagos · Premios · Correcciones»; bodega «Todo ·
Declarado · Recibido». *Alternativa:* los mismos cinco chips para las tres cuentas.

**D11 — «Reversar» desaparece de la pantalla; todo es «Anular…» / «Anulado».** El servicio
`reversarEgreso` se conserva por dentro (gana el motivo). *Alternativa:* mantener «Reversar» para
los gastos; dos palabras para lo mismo es exactamente la falencia que motiva la ficha.

**D12 — El comprobante de los caminos que no tienen documento propio vive en una tabla lateral**
(`wallet_comprobante`, un destino por fila: movimiento de caja, movimiento de tienda o pago de la
172), reutilizando el bucket, la config y las utilidades de la 459. *Alternativa:* columnas
`comprobante_path` en `wallet_movimiento`, `wallet_tienda_movimiento` y `liquidacion_pago`: vuelve
mutables tres tablas inmutables (para «adjuntar después») y `liquidacion_pago` tiene prohibido ganar
restricciones únicas (nota de la 205 en `schema.prisma:1933-1944`).

**D13 — La anulación con motivo de sueldo, gasto, gasto fijo e indemnización usa el molde que la 461
dejó para la corrección de caja SI ese molde es una tabla con FK a `wallet_movimiento(id)`;** si no,
esta ficha crea `wallet_movimiento_anulacion` con esa forma. Se decide en la primera tarea de 458-B
leyendo `origin/feature/461-final`. *Alternativa:* una tabla por camino (cuatro tablas iguales).

**D14 — El estado de cuenta es una página, no la fila desplegable de hoy.** Los desgloses actuales
(`DesgloseMovimientosTienda`, `DesglosePagosMensajero`, `DesgloseConsolidacionesSatelite`) se
retiran en 458-D y sus tests se listan con el requisito que los sustituye (lección «el test que vive
dentro de lo que borras»). *Alternativa:* conservar el desglose en la fila además de la página:
dos lecturas del mismo dinero que pueden divergir (P1 de la auditoría).

**D15 — Orden y paralelismo de las hijas:** 458-A (fullstack) y 458-B (backend) pueden ir a la vez
tras la 461 y la 457; 458-C tras las dos; 458-D y 458-E a la vez tras 458-C (no comparten archivos:
las piezas comunes nacen en 458-C). Detalle en `design.md` §9.
