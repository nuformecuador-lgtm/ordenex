# Feature 172 — Liquidación: pagar cuentas por pagar de mensajeros y saldos de tiendas · requirements

> Notación EARS estricta. Cada `R<n>` termina mapeado a un test concreto (ver
> `tasks.md § Trazabilidad`). Sin detalles de implementación: el CÓMO vive en `design.md`.
>
> **El problema, medido:** el sistema sabe cuánto debe y a quién, pero **no tiene cómo decir
> «ya pagué»**, así que los montos solo crecen. En la base de PRODUCCIÓN el 2026-07-31: **35
> movimientos de caja y 6 cierres, con CERO pagos registrados**. Las categorías existen desde
> la feature 43 (`pago_tienda`) y la 44 (`liquidacion`) y **ningún código las emite**.
>
> **Las cinco decisiones del humano** (ficha 172 de `feature_list.json` y
> `progress/current.md § Decisiones del humano (2026-07-31) para la liquidación`) están
> propagadas a los requisitos y **no se reabren aquí**: pagos parciales (R21), pago al
> mensajero preguntado al aprobar y atado al cierre (R14/R19), aprobar y pagar como **dos
> pasos** (R15/R16/R17), pago a la tienda contra saldo acumulado (R27), y los datos de
> trazabilidad de cada pago (R5–R12).

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
| La aprobación ya tiene el precedente exacto de «pedir un dato extra antes de confirmar»: la captura de indemnizaciones de la 158 (sub-modal + cobertura validada en el servicio + montos STRING). | `CierresAdminService.aprobarCierre` (`lib/services/CierresAdminService.ts:299-377`), `app/(app)/cierres-admin/_components/CierresAdminModule.tsx:404-423` y `:769+` |
| El detalle de un cierre se abre **también en el histórico** (botón «Ver»); las acciones de decisión solo se pintan si es resoluble. | `CierresAdminModule.tsx:606-719` |
| La 171 dejó el sitio del pago a la tienda montado: prop `acciones?: ReactNode` en la cabecera del desglose, `claveDesgloseTienda(...)` exportada para refrescar **una** tienda, e importe «Pagado a la tienda» que ya lee la categoría real. | `app/(app)/wallet/tiendas/_components/DesgloseMovimientosTienda.tsx:79-102`, `:253-266`, `:365-366`; hoy `SaldosTiendasTable.tsx:176-178` **no** pasa `acciones`. |
| Los dos libros se insertan con `createMany({ skipDuplicates: true })` sobre un índice único **parcial** `(origen_tipo, origen_id, <beneficiario>, categoria) WHERE origen_id IS NOT NULL`. | `db/migrations/20260712170000_wallet_tienda_movimiento/migration.sql:69-71`, `.../20260712180000_pago_mensajero_movimiento/migration.sql:64-66` |
| **Los contratos de escritura de los dos libros NO aceptan fecha de movimiento**: la columna existe con `DEFAULT CURRENT_TIMESTAMP` pero el input no la expone. | `lib/interfaces/repositories/IPagoMensajeroMovimientoRepository.ts:19-28`, `IWalletTiendaMovimientoRepository.ts:19-28` |
| **La base NO impide una fila con `categoria` y `tipo` incoherentes** en ninguno de los dos libros. Con un solo escritor se toleró; el review de la 171 puso como condición que el CHECK entre en la migración de esta feature. | `progress/review_171-desglose-por-tienda.md:249-275`; migraciones citadas arriba (sin `CHECK`) |
| Los métodos de pago **ya existen** como enum nativo con exactamente los tres valores pedidos. | `db/schema.prisma:628-634` (`MetodoPagoValue { efectivo, SINPE, transferencia }`), `lib/types/metodo-pago.ts:14` |
| «Acceso total» = `maestro` + `admin`. Es el gate de todos los escritores de dinero existentes. | `lib/auth/acceso-total.ts:5-9`, `lib/services/WalletEgresoService.ts:43` |
| Las categorías de ajuste (`ajuste_credito/debito`, `ajuste_devengo/pago`) están declaradas y **tampoco las emite nadie**: hoy no hay forma de corregir un movimiento de estos dos libros. | Solo aparecen en `lib/types/*`, `lib/utils/desglose-tienda.ts`, `lib/analytics/metrics.ts` y módulos de etiquetas. |
| Los tests de migración del repo son **estáticos** (regex sobre el SQL); el round-trip contra Postgres es verificación manual del implementer. | `tests/integration/db/wallet-tienda-migration.test.ts:1-27` |
| Toda instancia de `<DataTable>` del árbol debe estar en el censo con su estado real, con totales duros. | `tests/unit/descarga/censo-tablas.ts`, `tests/unit/descarga/cobertura-tablas.guardia.test.ts` |

---

## Glosario

- **Acceso total**: roles `maestro` y `admin` (`esAccesoTotal`).
- **Cuenta por pagar de un mensajero**: Σ movimientos de tipo `devengo` − Σ de tipo `pago` de
  su libro. Derivada, nunca almacenada.
- **Pendiente de un cierre**: lo que de ESE cierre sigue sin entregarse al mensajero =
  `pago devengado − tomado del efectivo − pagos ya registrados contra ese cierre`.
- **Saldo a favor de una tienda**: Σ créditos − Σ débitos de su ledger. Derivado.
- **Pago registrado** (o **liquidación**): el acto de declarar que se entregó dinero, con su
  monto, método, referencia, nota, fecha real, actor e instante de registro.
- **Fecha real del pago**: el día en que el dinero cambió de manos.
- **Instante de registro**: el momento en que se tecleó en el sistema. Puede ser distinto.
- **Movimiento del pago**: la fila que el pago añade al libro del beneficiario
  (`liquidacion` en el del mensajero, `pago_tienda` en el de la tienda).
- **Caja principal**: `wallet_movimiento`, la caja de Ordenex de la feature 42.

---

## A. Quién puede pagar

**R1** — MIENTRAS el actor no tenga acceso total, el sistema NO DEBE permitirle registrar un
pago, ni a un mensajero ni a una tienda. `[P3]`

**R2** — SI un actor con rol `adminTienda` pide registrar un pago a **su propia** tienda,
ENTONCES el sistema DEBE rechazarlo igual que a cualquier otro rol sin acceso total.

**R3** — SI la petición llega sin sesión, ENTONCES el sistema DEBE rechazarla antes de evaluar
ningún otro dato de la petición.

**R4** — El sistema NO DEBE ofrecer en pantalla ningún control para registrar un pago a quien
no puede registrarlo.

**R5** — El sistema DEBE resolver quién es el beneficiario del pago a partir de la petición
**solo después** de comprobar el rol, y NO DEBE permitir que un dato de la petición amplíe el
alcance del actor.

## B. Qué se guarda de cada pago

**R6** — CUANDO se registra un pago, el sistema DEBE persistir, en una sola pieza de
información: monto, método, referencia, nota, fecha real del pago, beneficiario, el actor que
lo registra y el instante de registro.

**R7** — El sistema DEBE aceptar como método de pago exactamente el mismo catálogo que ya usa
el recaudo de una entrega (efectivo, SINPE, transferencia), sin declarar un catálogo propio.

**R8** — El sistema DEBE guardar la fecha real del pago y el instante de registro como dos
datos distintos, y DEBE conservar los dos aunque coincidan.

**R9** — SI la fecha real del pago es posterior al día en curso de Costa Rica, ENTONCES el
sistema DEBE rechazar el registro con un mensaje accionable y sin escribir nada.

**R10** — El sistema DEBE rechazar un monto que no sea un número mayor que cero con hasta dos
decimales, y DEBE rechazar un monto que la columna de dinero no pueda representar.

**R11** — SI el método de pago es SINPE o transferencia, ENTONCES el sistema DEBE exigir la
referencia; SI es efectivo, la referencia DEBE ser opcional. `[P6]`

**R12** — El sistema DEBE aceptar una nota libre opcional y DEBE rechazarla si supera la
longitud máxima declarada.

**R13** — El sistema DEBE tratar todo monto como texto en la frontera y en la pantalla, sin
convertirlo a número ni operar con él en el navegador.

## C. Pago a un mensajero: atado al cierre, en dos pasos

**R14** — CUANDO un actor con acceso total aprueba un cierre que queda con pendiente mayor que
cero, el sistema DEBE ofrecerle registrar el pago de ese pendiente.

**R15** — El sistema DEBE dejar el cierre aprobado aunque el pago no se registre: omitirlo,
cancelarlo o que falle NO DEBE revertir la aprobación.

**R16** — El sistema NO DEBE exigir el registro del pago como condición para aprobar un
cierre, y NO DEBE introducir ningún estado que mantenga al mensajero bloqueado por un pago
pendiente.

**R17** — El sistema DEBE permitir registrar el pago de un cierre ya aprobado en cualquier
momento posterior, desde el detalle de ese cierre.

**R18** — SI el cierre contra el que se registra un pago no está aprobado, ENTONCES el sistema
DEBE rechazar el registro sin escribir nada.

**R19** — El sistema DEBE atar todo pago a un mensajero a un cierre aprobado concreto, y NO
DEBE permitir registrar un pago a un mensajero sin cierre.

**R20** — El sistema DEBE derivar el pendiente de un cierre como el pago devengado de ese
cierre menos lo tomado de su efectivo menos los pagos ya registrados contra él, y DEBE
calcularlo en el servidor.

**R21** — El sistema DEBE proponer como monto por defecto el pendiente del cierre y DEBE
permitir registrar un monto menor (**pago parcial**).

**R22** — CUANDO se registra un pago parcial, el pendiente del cierre y la cuenta por pagar del
mensajero DEBEN bajar exactamente en el monto registrado, y el resto DEBE seguir pendiente.

**R23** — SI el monto supera el pendiente del cierre, ENTONCES el sistema DEBE rechazar el
registro sin escribir nada. `[P1]`

**R24** — MIENTRAS un cierre aprobado tenga pendiente mayor que cero, el sistema DEBE mostrarlo
como pendiente de liquidar en el listado de cierres y en el detalle de ese cierre.

**R25** — CUANDO el pendiente de un cierre llega a cero, el sistema DEBE dejar de señalarlo
como pendiente y NO DEBE ofrecer registrar más pagos contra él.

**R26** — El sistema DEBE mostrar el pendiente de un cierre solo en cierres aprobados; en un
cierre no aprobado NO DEBE mostrar ni ofrecer nada relativo al pago.

## D. Pago a una tienda: contra el saldo acumulado

**R27** — El sistema DEBE permitir registrar un pago a una tienda desde el desglose de esa
tienda, contra su **saldo acumulado**, sin exigir ni admitir un cierre.

**R28** — El sistema DEBE proponer como monto por defecto el saldo a favor vigente de la tienda
y DEBE permitir registrar un monto menor (**pago parcial**).

**R29** — SI el monto supera el saldo a favor vigente de la tienda, ENTONCES el sistema DEBE
rechazar el registro sin escribir nada. `[P1]`

**R30** — SI la tienda no tiene saldo a favor (cero o en contra), ENTONCES el sistema NO DEBE
permitir registrar un pago y DEBE explicarlo. `[P1]`

**R31** — CUANDO se registra un pago a una tienda, el saldo y el importe «pagado a la tienda»
de esa tienda DEBEN reflejarlo sin recargar la página y sin refrescar los desgloses de las
demás tiendas.

**R32** — El sistema DEBE conservar la tabla de saldos por tienda y el desglose de la 171 con
el mismo contenido, alcance, filtros y descarga que tienen hoy.

## E. Efecto en los libros y en la caja principal

**R33** — CUANDO se registra un pago a un mensajero, el sistema DEBE añadir a su libro un
movimiento de tipo `pago` con concepto `liquidacion` por el monto registrado.

**R34** — CUANDO se registra un pago a una tienda, el sistema DEBE añadir a su ledger un
movimiento de tipo `debito` con concepto `pago_tienda` por el monto registrado.

**R35** — El sistema DEBE fechar el movimiento del pago con la **fecha real del pago**, no con
la de registro.

**R36** — El sistema DEBE dejar el movimiento enlazado al pago del que nace, de modo que desde
el movimiento se pueda llegar a su método, referencia, nota, actor e instante de registro.

**R37** — El sistema DEBE escribir el pago y su movimiento en una sola operación atómica: o
quedan los dos o no queda ninguno.

**R38** — El sistema NO DEBE emitir ningún movimiento en la caja principal al registrar un
pago, ni a un mensajero ni a una tienda. `[P2]`

**R39** — El sistema NO DEBE modificar ni borrar filas existentes de ningún libro: registrar un
pago solo añade filas.

**R40** — El sistema NO DEBE alterar los snapshots del cierre ni el cálculo del pago devengado,
del efectivo o de la cuenta por pagar.

## F. Idempotencia y doble pago

**R41** — CUANDO la misma solicitud de pago se recibe más de una vez, el sistema DEBE registrar
el pago UNA sola vez y responder lo mismo las dos veces, sin saldar dos veces.

**R42** — El sistema DEBE impedir el pago duplicado con una **restricción de la base de
datos**, no con una comprobación previa en memoria ni con un control de la interfaz.

**R43** — El sistema DEBE tratar dos pagos legítimamente distintos con el mismo beneficiario,
monto, método y fecha como **dos** pagos, y DEBE registrarlos los dos.

**R44** — SI dos registros de pago del mismo beneficiario se procesan a la vez, ENTONCES el
sistema NO DEBE permitir que entre los dos se salde más de lo que se debía. `[P1]`

**R45** — CUANDO la interfaz reintenta una solicitud que ya se había registrado, el sistema
DEBE informar de que ya estaba registrada y NO DEBE crear un segundo pago.

**R46** — El sistema DEBE mantener sin cambios la idempotencia de la alimentación de los libros
al aprobar un cierre: reintentar una aprobación NO DEBE duplicar movimientos.

## G. Trazabilidad visible

**R47** — El sistema DEBE listar los pagos registrados de un cierre con su fecha real, monto,
método, referencia, nota, quién lo registró e instante de registro.

**R48** — El sistema DEBE listar los pagos registrados de una tienda con los mismos datos, en
el desglose de esa tienda.

**R49** — El sistema DEBE mostrar el movimiento del pago en el desglose del beneficiario con su
concepto propio, distinguible de cualquier otro concepto de ese libro.

**R50** — MIENTRAS el desglose de un mensajero esté filtrado por un cierre, el sistema DEBE
incluir en él los pagos registrados contra ese cierre.

**R51** — CUANDO hay un pago a una tienda registrado, el importe «pagado a la tienda» de la
cabecera de su desglose DEBE reflejarlo, y el saldo DEBE bajar en ese mismo monto.

**R52** — El mensajero DEBE poder ver el pago recibido en su propia pantalla de pagos, sin
cambios de permisos.

**R53** — La tienda DEBE poder ver el pago recibido en su propia wallet **distinguido de los
cargos de Ordenex**. `[P5]`

**R54** — Ninguna de estas superficies DEBE mostrar identificadores internos ni datos
sensibles, y las descargas que ofrezcan DEBEN cumplir las guardias vigentes.

**R55** — Toda tabla nueva de la interfaz DEBE quedar registrada en el censo de tablas, con su
estado real, y las guardias de cobertura DEBEN quedar en verde con los totales actualizados.

## H. Integridad de los libros (condición heredada del review de la 171)

**R56** — El sistema DEBE impedir **en la base de datos** que un movimiento del ledger por
tienda tenga un tipo que no corresponda a su concepto.

**R57** — El sistema DEBE impedir **en la base de datos** que un movimiento del libro del
mensajero tenga un tipo que no corresponda a su concepto.

**R58** — SI el catálogo de conceptos de esos libros gana un valor que la restricción no
clasifica, ENTONCES la base DEBE **rechazar** el movimiento en vez de aceptarlo con cualquier
tipo.

**R59** — La restricción NO DEBE poder añadirse si algún dato existente la incumple, y su
aplicación DEBE verificarse contra cada base antes de desplegar.

**R60** — Toda tabla nueva DEBE tener seguridad a nivel de fila habilitada, sin políticas
públicas, como el resto de tablas de dinero.

**R61** — La migración DEBE ser reversible con su `down.sql`, DEBE ser aditiva y NO DEBE
reescribir ninguna fila existente de los libros.

## I. No objetivos (declarados para que no se cuelen)

**R62** — El sistema NO DEBE ofrecer anular, editar ni corregir un pago ya registrado en esta
feature. `[P4]`

**R63** — El sistema NO DEBE introducir ningún ciclo de corte, cierre o período por tienda.

**R64** — El sistema NO DEBE cambiar qué estados de cierre bloquean al mensajero.

**R65** — El sistema NO DEBE convertir la caja principal en tesorería ni tocar el catálogo de
métricas financieras: eso es la feature 173.

---

## Preguntas abiertas

Ninguna de éstas está resuelta por `docs/`, por `feature_list.json`, por `progress/` ni por el
código. Cada una lleva el **default** que se aplicará si el humano no responde en la puerta, y
en ese caso quedará constancia de que se aplicó (precedente: la 169). Espejadas como bloque
`T0` en `tasks.md`.

**P1 — ¿Qué pasa si el pago EXCEDE lo que se debe?** (R23, R29, R30, R44). Es la única de las
cinco decisiones que el humano no tomó. Hay dos salidas coherentes: (a) **rechazar** el exceso,
o (b) **permitirlo** y dejar el saldo a favor del beneficiario (negativo para Ordenex). La (b)
obligaría a que el signo negativo esté nombrado en las tres pantallas y a revisar
`derivarCuentaPorPagar`, que hoy declara que la cuenta «nunca es negativa en el flujo normal»
(`lib/utils/cuenta-por-pagar.ts:53`).
*Default:* **(a) rechazar**, con mensaje accionable que diga cuánto se debe. Es lo que ya
recomendaba el borrador de la 44 («el monto NO DEBE exceder la cuenta por pagar vigente»,
`specs/44-wallet-pago-mensajeros/requirements.md:209-213`). Consecuencia técnica de elegir (a):
hace falta serializar dos pagos simultáneos del mismo beneficiario (R44); con (b) esa
serialización sobra.

**P2 — ¿Se confirma que la 172 NO toca la caja principal?** (R38). Para el **mensajero** está
resuelto por el código: la caja ya cargó `egreso_pago_mensajero = P` al aprobar y el propio
servicio declara que la liquidación no vuelve a emitir egreso
(`lib/services/WalletMensajeroFeedService.ts:19-21`). Para la **tienda** es una decisión: el
borrador de la 43 pedía emitir `egreso_pago_tienda` (`specs/43-wallet-por-tienda/requirements.md:240-244`),
pero eso se escribió antes de que el humano decidiera que la caja pase a tesorería en la 173.
Emitirlo hoy restaría de la caja un dinero que **nunca entró** en ella (el COD no es ingreso de
Ordenex), y el balance —que hoy se lee como ganancia— se hundiría.
*Default:* **la 172 no escribe ni una fila en la caja principal.** El par «entra el COD / sale
el pago a la tienda» es exactamente el alcance de la 173, y esta feature le deja el ancla lista
(el pago registrado tiene id propio y el índice de idempotencia de la 42 ya lo cubre).

**P3 — ¿Quién puede registrar un pago: solo `maestro`, o también `admin`? ¿Y el
`adminSatelite` que aprueba los cierres de su zona?** (R1). Todos los escritores de dinero
existentes usan «acceso total» = maestro + admin (`lib/services/WalletEgresoService.ts:43`), y
la 44 excluyó expresamente al `adminSatelite` de la superficie de pagos a mensajeros por ser
«un egreso de la caja CENTRAL del maestro». Pero el `adminSatelite` **sí** aprueba cierres de
su zona, y es quien tiene delante al mensajero.
*Default:* **acceso total (maestro + admin); `adminSatelite` NO.** Cuando un `adminSatelite`
aprueba, el flujo queda exactamente como hoy: no se le ofrece registrar el pago y la deuda
queda abierta para que la liquide quien tiene la caja.

**P4 — ¿Se puede ANULAR un pago mal registrado?** (R62). Los dos libros son append-only y sus
categorías de ajuste (`ajuste_pago`, `ajuste_debito`) están declaradas y **no las emite nadie**:
hoy no existe ninguna forma de corregir una fila de estos libros. Si la 172 no trae reverso, un
pago tecleado con el monto equivocado queda para siempre y el saldo del beneficiario queda mal
hasta que alguien toque la base a mano. La 45 ya tiene el patrón resuelto para la caja
(`reversarEgreso`: movimiento compensatorio idempotente, `lib/services/WalletEgresoService.ts:75-106`).
*Default:* **fuera de alcance en la 172**, y se registra ficha propia inmediatamente. Se toma
así porque el reverso multiplica la superficie de una feature ya grande y money-critical; pero
**es la pregunta con más riesgo operativo de las seis**, y si el humano prefiere pagarla ahora,
cabe como una tanda más (una acción, un movimiento de ajuste, la misma idempotencia).

**P5 — ¿La cabecera de `/mi-wallet` separa «pagado» de «cargos»?** (R53). Es la deuda que
`progress/current.md` ya dejó anotada: hoy la tienda ve «Créditos / Débitos», así que el día
que exista un pago lo verá **sumado dentro de «Débitos»**, sin poder distinguir *lo que me
cobraron* de *lo que ya me pagaron*. La 171 dejó hecha la pieza que lo resuelve
(`derivarDesgloseTienda` + `CUBETA_POR_CATEGORIA`, `lib/utils/desglose-tienda.ts`), así que el
arreglo es reutilizar, no diseñar.
*Default:* **sí, dentro de esta feature**, reutilizando esa derivación sin duplicarla. Sin ello
la 172 entrega un pago que la tienda no puede reconocer como pago.

**P6 — ¿La referencia es obligatoria en SINPE y transferencia?** (R11). El humano pidió
«referencia o comprobante» como dato, sin decir si es obligatorio. Un pago electrónico sin
referencia es un pago que no se puede conciliar; uno en efectivo normalmente no tiene ninguna.
*Default:* **obligatoria en SINPE y transferencia, opcional en efectivo.**

**P7 — ¿El comprobante es un ARCHIVO adjunto o solo un texto de referencia?** El repo sabe
subir y firmar evidencias (bucket privado + `SupabaseSignedUrlProvider`), así que es posible;
pero añade almacenamiento, firma, límite de tamaño y una superficie de permisos nueva.
*Default:* **solo texto** (referencia + nota). El adjunto, si se quiere, es ficha propia.

**P8 — ¿El CHECK `categoria` ↔ `tipo` se añade también a la caja principal
(`wallet_movimiento`)?** (R56/R57). La condición heredada del review de la 171 cubre los dos
libros que esta feature escribe. La caja tiene el mismo hueco y **cuatro** escritores (42, 44,
45, 158), pero la 172 no escribe en ella, y añadir una restricción a una tabla con datos de
producción que esta feature no toca es riesgo importado.
*Default:* **no se toca la caja.** Se deja anotado para la 173, que sí la reescribe.
