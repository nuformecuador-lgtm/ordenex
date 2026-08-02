# Feature 172 — Liquidación: pagar cuentas por pagar de mensajeros y saldos de tiendas · requirements

> Notación EARS estricta. Cada `R<n>` termina mapeado a un test concreto (ver
> `tasks.md § Trazabilidad`). Sin detalles de implementación: el CÓMO vive en `design.md`.
>
> **PUERTA CERRADA el 2026-08-01.** Las ocho preguntas abiertas están **respondidas** (ver
> `§ Preguntas de la puerta (RESUELTAS)`). Las marcas `[P1]`…`[P8]` junto a un requisito ya no
> significan «condicional»: apuntan a **la respuesta que lo fija**, para que se pueda rastrear
> de dónde sale. **85 requisitos.**
>
> **El problema, medido:** el sistema sabe cuánto debe y a quién, pero **no tiene cómo decir
> «ya pagué»**, así que los montos solo crecen. En la base de PRODUCCIÓN el 2026-07-31: **35
> movimientos de caja y 6 cierres, con CERO pagos registrados**. Las categorías existen desde
> la feature 43 (`pago_tienda`) y la 44 (`liquidacion`) y **ningún código las emite**.
>
> **Las cinco decisiones previas del humano** (ficha 172 de `feature_list.json` y
> `progress/current.md § Decisiones del humano (2026-07-31) para la liquidación`) están
> propagadas y **no se reabren**: pagos parciales (R23), pago al mensajero preguntado al aprobar
> y atado al cierre (R16/R21), aprobar y pagar como **dos pasos** (R17/R18/R19), pago a la
> tienda contra saldo acumulado (R29), y los datos de trazabilidad de cada pago (R7–R14).

---

## Estado del arte (verificado contra el código, no asumido)

| Hecho | Dónde se comprobó |
| --- | --- |
| La categoría `liquidacion` del libro del mensajero está declarada y **nadie la emite**. | `db/schema.prisma:1169-1181` (enum `PagoMensajeroMovimientoCategoria`), `db/migrations/20260712180000_pago_mensajero_movimiento/migration.sql:21-27`. Cero apariciones fuera de tipos, etiquetas y catálogo de analítica. |
| La categoría `pago_tienda` y el egreso de caja `egreso_pago_tienda` están declarados y **nadie los emite**. | `db/schema.prisma:1103-1120` y `1025-1043`; las únicas apariciones vivas son `lib/types/wallet.ts:36`, `lib/analytics/metrics.ts:470` y `app/(app)/wallet/_components/wallet-labels.ts:39`. |
| **No existe ninguna acción de pago.** `lib/actions/` tiene 51 archivos; ninguno registra un pago a un mensajero ni a una tienda. | `lib/actions/*.ts` |
| Al **aprobar** un cierre, la misma transacción ya escribe: caja (42), ledger por tienda (43), libro del mensajero (44) y el egreso de indemnización (158). | `lib/repositories/CierresAdminRepository.ts:510-580` |
| El libro del mensajero recibe al aprobar `pago_devengado = P` (`total_pago_mensajero`) y `pago_efectivo = min(P, E)` (`total_efectivo`). **La cuenta por pagar de ese cierre es justo el resto.** | `lib/services/WalletMensajeroFeedService.ts:26-92`, `lib/utils/cuenta-por-pagar.ts:22-37` |
| La caja principal **ya carga el costo total del pago al mensajero** al aprobar: `egreso_pago_mensajero = P`. El código declara literalmente que «la liquidación posterior (Qf) **NO** vuelve a emitir egreso (evita doble conteo)». | `lib/services/WalletMensajeroFeedService.ts:19-21` y `75-89`; inserción en `CierresAdminRepository.ts:562-567` |
| La caja principal **no registra el COD**: modela RESULTADO (flete, comisión, IVAs), no tesorería. El COD vive como crédito `cod_recaudado` en el ledger de la tienda. | `db/schema.prisma:1021-1043` y `1099-1120`; ficha 173 de `feature_list.json` |
| Un cierre sin resolver **bloquea al mensajero**: bloquean `solicitado`, `vencido` y `rechazado`; **solo `aprobado` no bloquea**. | `lib/repositories/OrdenRepository.ts:136-140` (`ESTADOS_CIERRE_BLOQUEANTES`), usado en `:2563` y `:2614` |
| La aprobación ya tiene el precedente exacto de «pedir un dato extra antes de confirmar»: la captura de indemnizaciones de la 158. | `lib/services/CierresAdminService.ts:299-377`, `app/(app)/cierres-admin/_components/CierresAdminModule.tsx:404-423` y `:769+` |
| El detalle de un cierre se abre **también en el histórico** (botón «Ver»); las acciones de decisión solo se pintan si es resoluble. | `CierresAdminModule.tsx:606-719` |
| La 171 dejó el sitio del pago a la tienda montado: prop `acciones?: ReactNode`, `claveDesgloseTienda(...)` exportada e importe «Pagado a la tienda» que ya lee la categoría real. | `app/(app)/wallet/tiendas/_components/DesgloseMovimientosTienda.tsx:79-102`, `:253-266`, `:365-366`; hoy `SaldosTiendasTable.tsx:176-178` **no** pasa `acciones`. |
| Los dos libros se insertan con `createMany({ skipDuplicates: true })` sobre un índice único **parcial** `(origen_tipo, origen_id, <beneficiario>, categoria) WHERE origen_id IS NOT NULL`. | `db/migrations/20260712170000_wallet_tienda_movimiento/migration.sql:69-71`, `.../20260712180000_pago_mensajero_movimiento/migration.sql:64-66` |
| **Los contratos de escritura de los dos libros NO aceptan fecha de movimiento**: la columna existe con `DEFAULT CURRENT_TIMESTAMP` pero el input no la expone. | `lib/interfaces/repositories/IPagoMensajeroMovimientoRepository.ts:19-28`, `IWalletTiendaMovimientoRepository.ts:19-28` |
| **La base NO impide una fila con `categoria` y `tipo` incoherentes** en ninguno de los dos libros. El review de la 171 puso como condición que el CHECK entre en la migración de ESTA feature. | `progress/review_171-desglose-por-tienda.md:249-275` |
| Los métodos de pago **ya existen** como enum nativo con exactamente los tres valores pedidos. | `db/schema.prisma:628-634` (`MetodoPagoValue { efectivo, SINPE, transferencia }`), `lib/types/metodo-pago.ts:14` |
| «Acceso total» = `maestro` + `admin`. Es el gate de todos los escritores de dinero existentes. | `lib/auth/acceso-total.ts:5-9`, `lib/services/WalletEgresoService.ts:43` |
| **Ya existe el patrón de corrección compensatoria** para la caja: `reversarEgreso` inserta un movimiento inverso con `origen_id = <movimiento original>`, lee el monto **server-side** y es idempotente por el índice único parcial (2.º intento → `already_reversed`). | `lib/services/WalletEgresoService.ts:75-106` |
| Las categorías de ajuste de los dos libros (`ajuste_credito/debito`, `ajuste_devengo/pago`) están declaradas y **no las emite nadie**. La 172 estrena `ajuste_credito` y `ajuste_devengo` como contraasiento de una anulación. | Solo aparecen en `lib/types/*`, `lib/utils/desglose-tienda.ts`, `lib/analytics/metrics.ts` y módulos de etiquetas |
| Los tests de migración del repo son **estáticos** (regex sobre el SQL); el round-trip contra Postgres es verificación manual del implementer. | `tests/integration/db/wallet-tienda-migration.test.ts:1-27` |
| Toda instancia de `<DataTable>` del árbol debe estar en el censo con su estado real, con totales duros. | `tests/unit/descarga/censo-tablas.ts`, `tests/unit/descarga/cobertura-tablas.guardia.test.ts` |

---

## Glosario

- **Acceso total**: roles `maestro` y `admin` (`esAccesoTotal`). Es **el único** conjunto que
  puede mover dinero en esta feature `[P3]`.
- **Cuenta por pagar de un mensajero**: Σ movimientos de tipo `devengo` − Σ de tipo `pago` de
  su libro. Derivada, nunca almacenada.
- **Pendiente de un cierre**: lo que de ESE cierre sigue sin entregarse al mensajero =
  `pago devengado − tomado del efectivo − pagos vigentes registrados contra ese cierre`.
- **Saldo a favor de una tienda**: Σ créditos − Σ débitos de su ledger. Derivado.
- **Pago registrado** (o **liquidación**): el acto de declarar que se entregó dinero, con su
  monto, método, referencia, nota, fecha real, actor e instante de registro.
- **Pago vigente**: un pago registrado que **no** está anulado.
- **Anular un pago**: dejarlo sin efecto **añadiendo** un movimiento compensatorio de signo
  opuesto por el mismo monto. Nunca es borrar ni editar.
- **Contraasiento**: ese movimiento compensatorio.
- **Fecha real del pago**: el día en que el dinero cambió de manos.
- **Instante de registro**: el momento en que se tecleó en el sistema. Puede ser distinto.
- **Caja principal**: `wallet_movimiento`, la caja de Ordenex de la feature 42.

---

## A. Quién puede pagar

**R1** — MIENTRAS el actor no sea `maestro` o `admin`, el sistema NO DEBE permitirle registrar
un pago, ni a un mensajero ni a una tienda. `[P3]`

**R2** — SI un actor con rol `adminTienda` pide registrar un pago a **su propia** tienda,
ENTONCES el sistema DEBE rechazarlo igual que a cualquier otro rol sin acceso total.

**R3** — SI la petición llega sin sesión, ENTONCES el sistema DEBE rechazarla antes de evaluar
ningún otro dato de la petición.

**R4** — El sistema NO DEBE ofrecer en pantalla ningún control para registrar un pago a quien
no puede registrarlo.

**R5** — El sistema DEBE resolver quién es el beneficiario del pago a partir de la petición
**solo después** de comprobar el rol, y NO DEBE permitir que un dato de la petición amplíe el
alcance del actor.

**R6** — MIENTRAS el actor sea `adminSatelite`, el sistema DEBE permitirle aprobar los cierres
de su zona exactamente como hoy y NO DEBE permitirle registrar ni anular ningún pago, ni
ofrecérselo en pantalla. `[P3]`

## B. Qué se guarda de cada pago

**R7** — CUANDO se registra un pago, el sistema DEBE persistir, en una sola pieza de
información: monto, método, referencia, nota, fecha real del pago, beneficiario, el actor que
lo registra y el instante de registro.

**R8** — El sistema DEBE aceptar como método de pago exactamente el mismo catálogo que ya usa
el recaudo de una entrega (efectivo, SINPE, transferencia), sin declarar un catálogo propio.

**R9** — El sistema DEBE guardar la fecha real del pago y el instante de registro como dos
datos distintos, y DEBE conservar los dos aunque coincidan.

**R10** — SI la fecha real del pago es posterior al día en curso de Costa Rica, ENTONCES el
sistema DEBE rechazar el registro con un mensaje accionable y sin escribir nada.

**R11** — El sistema DEBE rechazar un monto que no sea un número mayor que cero con hasta dos
decimales, y DEBE rechazar un monto que la columna de dinero no pueda representar.

**R12** — SI el método de pago es SINPE o transferencia, ENTONCES el sistema DEBE exigir la
referencia; SI es efectivo, la referencia DEBE ser opcional. `[P6]`

**R13** — El sistema DEBE aceptar una nota libre opcional y DEBE rechazarla si supera la
longitud máxima declarada.

**R14** — El sistema DEBE tratar todo monto como texto en la frontera y en la pantalla, sin
convertirlo a número ni operar con él en el navegador.

**R15** — El sistema NO DEBE aceptar ningún archivo adjunto como comprobante: el comprobante es
texto (referencia y nota). `[P7]`

## C. Pago a un mensajero: atado al cierre, en dos pasos

**R16** — CUANDO un actor con acceso total aprueba un cierre que queda con pendiente mayor que
cero, el sistema DEBE ofrecerle registrar el pago de ese pendiente.

**R17** — El sistema DEBE dejar el cierre aprobado aunque el pago no se registre: omitirlo,
cancelarlo o que falle NO DEBE revertir la aprobación.

**R18** — El sistema NO DEBE exigir el registro del pago como condición para aprobar un
cierre, y NO DEBE introducir ningún estado que mantenga al mensajero bloqueado por un pago
pendiente.

**R19** — El sistema DEBE permitir registrar el pago de un cierre ya aprobado en cualquier
momento posterior, desde el detalle de ese cierre.

**R20** — SI el cierre contra el que se registra un pago no está aprobado, ENTONCES el sistema
DEBE rechazar el registro sin escribir nada.

**R21** — El sistema DEBE atar todo pago a un mensajero a un cierre aprobado concreto, y NO
DEBE permitir registrar un pago a un mensajero sin cierre.

**R22** — El sistema DEBE derivar el pendiente de un cierre como el pago devengado de ese
cierre menos lo tomado de su efectivo menos los pagos **vigentes** registrados contra él, y
DEBE calcularlo en el servidor.

**R23** — El sistema DEBE proponer como monto por defecto el pendiente del cierre y DEBE
permitir registrar un monto menor (**pago parcial**).

**R24** — CUANDO se registra un pago parcial, el pendiente del cierre y la cuenta por pagar del
mensajero DEBEN bajar exactamente en el monto registrado, y el resto DEBE seguir pendiente.

**R25** — SI el monto supera el pendiente del cierre, ENTONCES el sistema DEBE rechazar el
registro sin escribir nada, e informar de cuánto queda disponible. `[P1]`

**R26** — MIENTRAS un cierre aprobado tenga pendiente mayor que cero, el sistema DEBE mostrarlo
como pendiente de liquidar en el listado de cierres y en el detalle de ese cierre.

**R27** — CUANDO el pendiente de un cierre llega a cero, el sistema DEBE dejar de señalarlo
como pendiente y NO DEBE ofrecer registrar más pagos contra él.

**R28** — El sistema DEBE mostrar el pendiente de un cierre solo en cierres aprobados; en un
cierre no aprobado NO DEBE mostrar ni ofrecer nada relativo al pago.

## D. Pago a una tienda: contra el saldo acumulado

**R29** — El sistema DEBE permitir registrar un pago a una tienda desde el desglose de esa
tienda, contra su **saldo acumulado**, sin exigir ni admitir un cierre.

**R30** — El sistema DEBE proponer como monto por defecto el saldo a favor vigente de la tienda
y DEBE permitir registrar un monto menor (**pago parcial**).

**R31** — SI el monto supera el saldo a favor vigente de la tienda, ENTONCES el sistema DEBE
rechazar el registro sin escribir nada, e informar de cuánto queda disponible. `[P1]`

**R32** — SI la tienda no tiene saldo a favor (cero o en contra), ENTONCES el sistema NO DEBE
permitir registrar un pago y DEBE explicarlo. `[P1]`

**R33** — CUANDO se registra un pago a una tienda, el saldo y el importe «pagado a la tienda»
de esa tienda DEBEN reflejarlo sin recargar la página y sin refrescar los desgloses de las
demás tiendas.

**R34** — El sistema DEBE conservar la tabla de saldos por tienda y el desglose de la 171 con
el mismo contenido, alcance, filtros y descarga que tienen hoy.

## E. Efecto en los libros y en la caja principal

**R35** — CUANDO se registra un pago a un mensajero, el sistema DEBE añadir a su libro un
movimiento de tipo `pago` con concepto `liquidacion` por el monto registrado.

**R36** — CUANDO se registra un pago a una tienda, el sistema DEBE añadir a su ledger un
movimiento de tipo `debito` con concepto `pago_tienda` por el monto registrado.

**R37** — El sistema DEBE fechar el movimiento del pago con la **fecha real del pago**, no con
la de registro.

**R38** — El sistema DEBE dejar el movimiento enlazado al pago del que nace, de modo que desde
el movimiento se pueda llegar a su método, referencia, nota, actor e instante de registro.

**R39** — El sistema DEBE escribir el pago y su movimiento en una sola operación atómica: o
quedan los dos o no queda ninguno.

**R40** — El sistema NO DEBE emitir ningún movimiento en la caja principal al registrar ni al
anular un pago, ni a un mensajero ni a una tienda. `[P2]`

**R41** — El sistema NO DEBE modificar ni borrar filas existentes de ningún libro: registrar o
anular un pago solo AÑADE filas.

**R42** — El sistema NO DEBE alterar los snapshots del cierre ni el cálculo del pago devengado,
del efectivo o de la cuenta por pagar.

## F. Idempotencia y doble pago

**R43** — CUANDO la misma solicitud de pago se recibe más de una vez, el sistema DEBE registrar
el pago UNA sola vez y responder lo mismo las dos veces, sin saldar dos veces.

**R44** — El sistema DEBE impedir el pago duplicado con una **restricción de la base de
datos**, no con una comprobación previa en memoria ni con un control de la interfaz.

**R45** — El sistema DEBE tratar dos pagos legítimamente distintos con el mismo beneficiario,
monto, método y fecha como **dos** pagos, y DEBE registrarlos los dos.

**R46** — SI dos operaciones que compiten por el mismo dinero se procesan a la vez, ENTONCES el
sistema NO DEBE permitir que entre las dos se salde más de lo que se debía. `[P1]`

**R47** — CUANDO la interfaz reintenta una solicitud que ya se había registrado, el sistema
DEBE informar de que ya estaba registrada y NO DEBE crear un segundo pago.

**R48** — El sistema DEBE mantener sin cambios la idempotencia de la alimentación de los libros
al aprobar un cierre: reintentar una aprobación NO DEBE duplicar movimientos.

## G. Trazabilidad visible

**R49** — El sistema DEBE listar los pagos registrados de un cierre con su fecha real, monto,
método, referencia, nota, quién lo registró e instante de registro.

**R50** — El sistema DEBE listar los pagos registrados de una tienda con los mismos datos, en
el desglose de esa tienda.

**R51** — El sistema DEBE mostrar el movimiento del pago en el desglose del beneficiario con su
concepto propio, distinguible de cualquier otro concepto de ese libro.

**R52** — MIENTRAS el desglose de un mensajero esté filtrado por un cierre, el sistema DEBE
incluir en él los pagos registrados contra ese cierre y sus anulaciones.

**R53** — CUANDO hay un pago a una tienda vigente, el importe «pagado a la tienda» de la
cabecera de su desglose DEBE reflejarlo, y el saldo DEBE bajar en ese mismo monto.

**R54** — El mensajero DEBE poder ver el pago recibido en su propia pantalla de pagos, sin
cambios de permisos.

**R55** — La tienda DEBE poder ver el pago recibido en su propia wallet **distinguido de los
cargos de Ordenex**. `[P5]`

**R56** — Ninguna de estas superficies DEBE mostrar identificadores internos ni datos
sensibles, y las descargas que ofrezcan DEBEN cumplir las guardias vigentes.

**R57** — Toda tabla nueva de la interfaz DEBE quedar registrada en el censo de tablas, con su
estado real, y las guardias de cobertura DEBEN quedar en verde con los totales actualizados.

## H. Integridad de los libros (condición heredada del review de la 171)

**R58** — El sistema DEBE impedir **en la base de datos** que un movimiento del ledger por
tienda tenga un tipo que no corresponda a su concepto.

**R59** — El sistema DEBE impedir **en la base de datos** que un movimiento del libro del
mensajero tenga un tipo que no corresponda a su concepto.

**R60** — SI el catálogo de conceptos de esos libros gana un valor que la restricción no
clasifica, ENTONCES la base DEBE **rechazar** el movimiento en vez de aceptarlo con cualquier
tipo.

**R61** — La restricción NO DEBE poder añadirse si algún dato existente la incumple, y su
aplicación DEBE verificarse contra cada base antes de desplegar.

**R62** — El sistema NO DEBE añadir esa restricción a la caja principal en esta feature. `[P8]`

**R63** — Toda tabla nueva DEBE tener seguridad a nivel de fila habilitada, sin políticas
públicas, como el resto de tablas de dinero.

**R64** — La migración DEBE ser reversible con su `down.sql`, DEBE ser aditiva y NO DEBE
reescribir ninguna fila existente de los libros.

## I. No objetivos (declarados para que no se cuelen)

**R65** — El sistema NO DEBE permitir **editar** un pago ya registrado: la única corrección
posible es anularlo y registrar uno nuevo. `[P4]`

**R66** — El sistema NO DEBE introducir ningún ciclo de corte, cierre o período por tienda.

**R67** — El sistema NO DEBE cambiar qué estados de cierre bloquean al mensajero.

**R68** — El sistema NO DEBE convertir la caja principal en tesorería ni tocar el catálogo de
métricas financieras: eso es la feature 173.

## J. Anular un pago mal registrado `[P4]`

**R69** — El sistema DEBE permitir anular un pago ya registrado **sin borrarlo ni
modificarlo**: la anulación DEBE consistir en añadir al libro del beneficiario un movimiento
compensatorio de signo opuesto por el mismo monto.

**R70** — El sistema DEBE leer el monto del contraasiento **del pago original, en el servidor**,
y NO DEBE aceptarlo de la petición.

**R71** — CUANDO se anula un pago, el saldo del beneficiario DEBE volver exactamente al valor
que tenía antes de ese pago.

**R72** — El sistema DEBE exigir un motivo de anulación no vacío.

**R73** — El sistema DEBE registrar quién anuló y en qué instante, y DEBE conservarlo junto al
pago anulado.

**R74** — MIENTRAS un pago esté anulado, el sistema DEBE seguir mostrándolo con **todos** sus
datos originales (monto, método, referencia, nota, fecha real, quién lo registró y cuándo),
marcado como anulado y acompañado del motivo, el actor y el instante de la anulación.

**R75** — El sistema NO DEBE permitir anular dos veces el mismo pago, y DEBE impedirlo con una
restricción de la base de datos.

**R76** — El sistema NO DEBE permitir anular parcialmente un pago: se anula entero.

**R77** — El sistema DEBE fechar el movimiento compensatorio con **el día de la anulación**, no
con la fecha real del pago anulado.

**R78** — El sistema DEBE conservar intacta la referencia del pago anulado y DEBE permitir
volver a usar esa misma referencia y esa misma fecha real en un pago nuevo.

**R79** — CUANDO un pago queda anulado, el sistema DEBE volver a considerar su monto como
adeudado y DEBE permitir registrar de nuevo un pago por ese importe.

**R80** — El sistema NO DEBE contar los pagos anulados al derivar lo pendiente de un cierre ni
al proponer el monto por defecto de un pago nuevo.

**R81** — MIENTRAS el actor no sea `maestro` o `admin`, el sistema NO DEBE permitirle anular un
pago ni ofrecerle el control para hacerlo. `[P3]`

**R82** — El sistema NO DEBE permitir anular una anulación ni deshacerla de ninguna otra forma:
si la anulación fue un error, la corrección es registrar el pago de nuevo.

## K. Serialización del dinero (consecuencia directa de `[P1]`)

**R83** — El sistema DEBE serializar **en la base de datos** las operaciones que compiten por el
mismo dinero, tomando el bloqueo ANTES de leer cuánto hay disponible y manteniéndolo hasta que
la operación termina.

**R84** — El sistema DEBE tomar ese mismo bloqueo al anular un pago, para que una anulación y un
registro simultáneos no lean el mismo disponible.

**R85** — El sistema NO DEBE tomar más de un bloqueo por operación, de modo que no exista un
orden de adquisición capaz de producir un interbloqueo.

---

## Preguntas de la puerta (RESUELTAS)

> **Cerradas por el humano el 2026-08-01.** Cada una lleva su respuesta y los requisitos que
> fija. **Tres se respondieron explícitamente (P1, P3, P4)**; las otras cinco quedaron
> **resueltas por el default declarado**, que el humano no contradijo. **Ninguna sigue abierta.**

**[x] P1 — ¿Qué pasa si el pago EXCEDE lo que se debe? → RESUELTA: RECHAZAR.**
Respuesta del humano: **rechazar** el pago que excede lo debido. Un error de tecleo no puede
dejar al beneficiario con saldo a favor; el sistema informa de cuánto queda disponible y no
escribe nada. **Fija R25, R31, R32 y R46.**
**Consecuencia asumida, no opcional:** rechazar por tope obliga a **serializar** las operaciones
que compiten por el mismo dinero — dos pagos simultáneos leerían el mismo disponible y los dos
pasarían la comprobación. De ahí la **sección K (R83–R85)** y `design.md §4.2`.

**[x] P2 — ¿La 172 escribe en la caja principal? → RESUELTA por default declarado: NO.**
La 172 **no escribe ni una fila** en `wallet_movimiento`, ni al pagar ni al anular. Para el
mensajero está resuelto por el código: la caja ya cargó `egreso_pago_mensajero = P` al aprobar y
el propio servicio declara que la liquidación no vuelve a emitir egreso
(`WalletMensajeroFeedService.ts:19-21`). Para la tienda es orden de ejecución: emitir
`egreso_pago_tienda` hoy restaría de la caja un dinero que **nunca entró** en ella, y el balance
—que hoy se lee como ganancia— se hundiría. El par «entra el COD / sale el pago a la tienda» es
**la feature 173**. **Fija R40 y R68**; `design.md §8` detalla qué le deja preparado a la 173 sin
tomarle ninguna decisión.

**[x] P3 — ¿Quién puede registrar un pago? → RESUELTA: `maestro` y `admin`. `adminSatelite`
FUERA.**
Respuesta del humano: *maestro y admin; el `adminSatelite` queda fuera **aunque sí apruebe
cierres**, porque aprobar un cierre y mover dinero no son la misma responsabilidad.* **Fija R1,
R6 y R81**, con **contraprueba de rol obligatoria**: un `adminSatelite` aprueba el cierre de su
zona exactamente como hoy, **no** recibe la oferta de pago, y su llamada directa a la acción de
pagar o de anular recibe `forbidden`. Se propaga a la anulación por el mismo criterio (R81):
quien no puede mover el dinero tampoco puede moverlo de vuelta.

**[x] P4 — ¿Anular un pago mal registrado entra en la 172? → RESUELTA: SÍ, DENTRO.**
Respuesta del humano, **contraria al default propuesto**: *anular entra en esta feature.* Amplía
el alcance de verdad —es tocar el libro en sentido inverso, con trazabilidad propia— y por eso
va con **sección J (R69–R82)**, modelo en `design.md §6` y **una tanda nueva (F)** en
`tasks.md`. Lo que queda decidido:
- **Anular = contraasiento**, nunca borrar ni editar (R69, R65). El pago original permanece
  íntegro y visible (R74).
- **Quién:** los mismos que pueden pagar, `maestro` y `admin` (R81).
- **Fecha real y referencia del pago anulado NO se tocan** (R78): el pago ocurrió el día que
  ocurrió; lo que se corrige es su efecto. El **contraasiento se fecha el día de la anulación**
  (R77), siguiendo el precedente de `reversarEgreso`, que no reabre fechas pasadas.
- **Un pago anulado se puede volver a registrar** (R79), con la misma referencia y la misma
  fecha real si es el mismo pago corregido; lo único que no se reutiliza es su clave de
  idempotencia, ya consumida.
- **El saldo vuelve exactamente a donde estaba** (R71) y lo anulado deja de contar como pagado
  (R80).
- **Una sola vez y entera** (R75, R76); **no se anula una anulación** (R82).

**[x] P5 — ¿La cabecera de `/mi-wallet` separa «pagado» de «cargos»? → RESUELTA por default
declarado: SÍ.**
Hoy esa cabecera está en «Créditos / Débitos», así que sin este cambio la tienda vería su pago
**sumado dentro de «Débitos»**, indistinguible de un cargo de Ordenex. Se reutiliza
`derivarDesgloseTienda` + `CUBETA_POR_CATEGORIA` de la 171 **por importación, no por copia**.
**Fija R55.**

**[x] P6 — ¿Referencia obligatoria en SINPE y transferencia? → RESUELTA por default declarado:
SÍ; opcional en efectivo.** Un pago electrónico sin referencia no se puede conciliar. **Fija R12.**

**[x] P7 — ¿Comprobante como archivo adjunto? → RESUELTA por default declarado: NO, solo
texto.** Referencia y nota. Sin almacenamiento, sin firma y sin superficie de permisos nueva.
**Fija R15.**

**[x] P8 — ¿El CHECK `categoria`↔`tipo` va también a `wallet_movimiento`? → RESUELTA por default
declarado: NO.** La condición heredada del review de la 171 cubre los **dos libros que esta
feature escribe** (R58, R59). La caja tiene el mismo hueco y cuatro escritores, pero la 172 no la
escribe: añadirle una restricción sería riesgo importado, y el CHECK **valida las filas
existentes al aplicarse**. Queda anotado para la 173, que sí la reescribe. **Fija R62.**

---

## Preguntas abiertas NUEVAS (surgidas al especificar la anulación)

Ninguna bloquea la implementación: las dos llevan default declarado, que se aplicará dejando
constancia si el humano no responde.

**N1 — El par «pago + anulación» infla los importes BRUTOS; los saldos siguen exactos.**
El contraasiento usa las categorías de ajuste ya reservadas (`ajuste_credito` en la tienda,
`ajuste_devengo` en el mensajero), que es justo lo que evita añadir valores nuevos al enum.
Efecto: si se pagan ₡100 000 y se anulan, el **saldo** vuelve al valor correcto (R71), pero la
cabecera del desglose seguirá diciendo «pagado a la tienda: ₡100 000» y habrá sumado ₡100 000 en
«a favor». Netear los brutos exigiría **dos valores de enum nuevos** —lo que en este repo obliga
a tocar los `down.sql` previos que recrean el enum— **o** reescribir la derivación de la 171
(`CUBETA_POR_CATEGORIA`, que clasifica por categoría y garantiza exhaustividad con el
typecheck). Las dos son decisiones con coste que el spec no toma solo.
*Default:* **no se netea.** El saldo —el número con el que se decide cuánto pagar— es siempre
correcto; la anulación se ve en la línea del libro y en la lista de comprobantes, marcada; y la
limitación se declara en pantalla.

**N2 — ¿Hay ventana temporal para anular?** Se puede anular un pago de ayer y también uno de
hace seis meses, lo que cambia un saldo que quizá ya se comunicó fuera del sistema. El repo no
tiene ningún concepto de período contable cerrado, así que no hay nada contra lo que validar.
*Default:* **sin ventana.** Cualquier pago vigente es anulable, y la trazabilidad (quién, cuándo
y por qué) es lo que hace visible una anulación tardía.
