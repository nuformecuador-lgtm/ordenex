# Ficha 381 — cargar un costo a una tienda desde «Registrar movimiento»

**Zona:** fullstack. **SDD:** sí. **Rama:** `feat/381-cargo-manual-a-tienda`.

## El encargo, en palabras del humano (2026-09-07)

> «En la wallet, a la hora de registrar un movimiento de dinero desde el botón de registrar
> movimiento, debe haber la posibilidad de cargarle costos a las tiendas.»

## Estado del árbol (verificado archivo por archivo el 2026-09-07; no se re-investiga)

1. **El modelo YA EXISTE y le falta pantalla.** `WalletTiendaMovimientoCategoria`
   (`db/schema.prisma:1621-1638`) incluye `ajuste_debito`, descrito en el propio esquema como
   «correccion compensatoria inmutable». `lib/utils/desglose-tienda.ts:45` ya lo clasifica en la
   cubeta `cargos`, y `app/(app)/mi-wallet/_components/mi-wallet-labels.ts:86` ya le da la etiqueta
   «Ajuste (débito)» (reutilizada por `/wallet/tiendas` vía `desglose-tienda-labels.ts:21`).
2. **`ajuste_debito` tiene CERO productores.** Su gemela `ajuste_credito` sí se emite, desde
   `LiquidacionService.escribirContraasiento` (`lib/services/LiquidacionService.ts:1234`), que es la
   anulación de un pago a tienda. Ése es el camino trillado que esta ficha imita.
3. **El diálogo de hoy** es `app/(app)/wallet/_components/RegistrarMovimientoCajaDialog.tsx`
   (ficha 334): «el ÚNICO control para mover dinero a mano en la caja principal». Su catálogo vive
   en `app/(app)/wallet/_components/wallet-conceptos-manuales.ts` y tiene **cuatro** conceptos
   (`gasto_variable`, `sueldo`, `ajuste_ingreso`, `ajuste_egreso`). Los cuatro escriben en
   `wallet_movimiento` (la caja) y **ninguno pregunta a qué tienda**.
4. **`DestinoConcepto` es una unión discriminada a propósito** (`wallet-conceptos-manuales.ts:40`):
   el diálogo elige Server Action por la *clase* del destino, no con un `if` sobre el id, «así que
   un concepto nuevo que olvidara declarar su destino no compila». El mismo archivo declara por qué
   NO se unificó el backend: `origen_tipo` decide qué es reversable, y fusionarlo «volvería
   reversables los ajustes — un cambio en dinero que nadie pidió».
5. **`wallet_tienda_movimiento` es un ledger append-only e inmutable**: sin `updatedAt` ni
   `deletedAt`, idempotencia por índice único parcial sobre `(origen_tipo, origen_id, tienda_id,
   categoria) WHERE origen_id IS NOT NULL` (`db/migrations/20260712170000_wallet_tienda_movimiento/
   migration.sql:69-71`), y `registrado_por` para los manuales (`origen_tipo: manual`,
   `origen_id: NULL`). El saldo se DERIVA, no se almacena.
6. **`ajuste_debito` ya existe en el enum de Postgres**, no solo en Prisma
   (`20260712170000_wallet_tienda_movimiento/migration.sql:30`), y el CHECK
   `wallet_tienda_movimiento_tipo_categoria_check` (`20260802120000_liquidacion_pago/
   migration.sql:135`) ya lo admite en la rama `debito`. **El asiento de esta ficha no necesita
   ninguna migración.**
7. **El historial de acciones NO tiene dónde apuntar esto.** `historial_accion_tipo` no tiene un
   tipo para un cargo a tienda y `historial_accion_entidad` **no contiene**
   `wallet_tienda_movimiento` (`lib/types/historial-accion.ts:198-219`). Los dos catálogos son
   exhaustivos por `satisfies` + `Exclude`, y `tests/unit/guards/
   historial-accion-escrituras-cubiertas.guardia.test.ts` exige un productor real por cada tipo.
8. **Ya existe el catálogo de tiendas para un selector:** `listarAdminTiendas`
   (`lib/actions/usuarios-por-rol.ts:43`) → `UserRepository.listByRol("adminTienda")`, que proyecta
   `id`/`nombre` de las cuentas con `estado: "activo"`, ordenadas por nombre. Lo consume ya
   `GenerarApiKeyForm`.

## Decisiones de partida

> ⚠️ Las cuatro son **asunciones del leader, NO firmadas por el humano**. Están aquí para que el
> humano las confirme o las tumbe en la puerta de aprobación.

1. **Un cargo NO es reversable.** Se corrige con un `ajuste_credito` compensatorio, que ya existe y
   ya se emite. Motivo: el ledger es inmutable por diseño y `origen_tipo` es lo que decide qué es
   reversable (ver §4 del estado del árbol).
2. **Mismo permiso que el resto del diálogo.** No se inventa un permiso nuevo.
3. **Sin línea de IVA separada.** Los conceptos automáticos llevan el IVA como movimiento aparte
   porque nacen de una tarifa; un cargo manual es un importe que alguien decide.
4. **La superficie es la que pidió el humano**: el botón «Registrar movimiento» de `/wallet`. La
   alternativa natural —un botón «cobrar» junto al de pagar en `/wallet/tiendas`, donde ya vive
   `PagoTiendaAcciones`— queda **descartada por no ser lo que se pidió** (`design.md` §9-A).

## Requisitos (EARS)

### A — La superficie: el diálogo «Registrar movimiento»

**R1** — El sistema DEBE ofrecer, en el catálogo de conceptos del diálogo «Registrar movimiento» de
`/wallet`, un concepto que carga un costo a una tienda, además de los cuatro que ya existen.

**R2** — MIENTRAS el concepto elegido sea el cargo a una tienda, el diálogo DEBE pedir la tienda
destinataria además del monto, la fecha y la descripción.

**R3** — MIENTRAS el concepto elegido NO sea el cargo a una tienda, el diálogo NO DEBE pedir ninguna
tienda ni enviar ninguna al servidor.

**R4** — El diálogo DEBE indicar, para el concepto elegido, en qué libro o libros queda registrado el
movimiento y con qué nombre aparecerá en cada uno.

**R5** — CUANDO el diálogo se abre, el sistema DEBE poder ofrecer como destinatarias las cuentas de
tienda activas, en un orden determinista.

**R6** — SI el catálogo de tiendas no se puede leer, ENTONCES el diálogo DEBE decirlo y DEBE impedir
registrar un cargo, sin impedir registrar ninguno de los otros cuatro conceptos.

**R7** — SI se confirma un cargo sin haber elegido tienda, ENTONCES el sistema DEBE señalar el fallo
bajo el campo de la tienda y NO DEBE registrar nada.

**R8** — MIENTRAS una confirmación esté en curso, el diálogo NO DEBE admitir una segunda.

**R9** — CUANDO el registro de un cargo termine bien, el diálogo DEBE confirmarlo, cerrarse y
provocar que la pantalla vuelva a leer sus datos.

**R10** — CUANDO el servidor rechace un cargo, el diálogo DEBE conservar lo tecleado y mostrar el
motivo bajo el campo que lo produce.

**R11** — El sistema DEBE conservar sin cambios el comportamiento de los cuatro conceptos que ya
existen: su destino, la categoría que escriben, el libro al que van y los textos que muestran.

### B — El borde: qué se acepta y qué se rechaza

**R12** — SI quien registra un cargo no tiene el mismo permiso que el resto del diálogo, ENTONCES el
sistema DEBE rechazarlo sin leer ni escribir ningún dato de dinero.

**R13** — SI no hay sesión, ENTONCES el sistema DEBE rechazar el cargo como no autenticado.

**R14** — SI el monto de un cargo no es un número mayor que cero con hasta dos decimales, ENTONCES el
sistema DEBE rechazarlo y NO DEBE escribir nada.

**R15** — SI la descripción de un cargo está vacía una vez recortados los espacios, ENTONCES el
sistema DEBE rechazarlo y NO DEBE escribir nada.

**R16** — SI la fecha de un cargo no existe en el calendario, es posterior a hoy o cae fuera de la
ventana admisible, ENTONCES el sistema DEBE rechazarlo con el MISMO motivo que emite para los otros
cuatro conceptos.

**R17** — SI la tienda indicada no existe, no es una cuenta de tienda o no está activa, ENTONCES el
sistema DEBE rechazar el cargo señalando el campo de la tienda y NO DEBE escribir nada.

**R18** — El sistema DEBE tratar el monto de un cargo como texto desde la pantalla hasta la base, sin
convertirlo en ningún punto a coma flotante, y el importe que quede persistido DEBE ser exactamente
el que se tecleó, con dos decimales.

### C — El asiento en el libro de la tienda

**R19** — CUANDO se confirme un cargo válido, el sistema DEBE añadir al libro de ESA tienda un
movimiento de débito de la categoría de ajuste débito, con el monto, la descripción, la fecha y el
autor del registro.

**R20** — El movimiento de R19 DEBE quedar marcado como registro manual y sin documento de origen.

**R21** — SI quien registra no elige un día distinto del de hoy, ENTONCES el movimiento de R19 DEBE
fecharse con el instante del registro, igual que los otros cuatro conceptos.

**R22** — El sistema NO DEBE ofrecer editar, borrar ni reversar un cargo ya registrado.

**R23** — El sistema NO DEBE emitir ningún movimiento adicional de impuesto a partir de un cargo
manual.

**R24** — CUANDO un cargo quede registrado, el desglose de esa tienda DEBE sumarlo a sus cargos y su
saldo DEBE bajar exactamente en el importe del cargo.

**R25** — Un cargo DEBE aparecer en el libro de la tienda a la que se cargó y en el de ninguna otra.

**R26** — El sistema DEBE escribir en UNA SOLA transacción todo lo que un cargo produce; SI alguna de
esas escrituras falla, ENTONCES NO DEBE quedar ninguna de las demás.

### D — El rastro

**R27** — CUANDO se registre un cargo, el sistema DEBE dejar en el historial de acciones una fila que
identifique quién lo hizo, cuándo, por qué importe y sobre qué tienda.

**R28** — El sistema DEBE clasificar el registro de R27 como una acción que MUEVE DINERO.

**R29** — SI el asiento de R19 no llega a escribirse, ENTONCES NO DEBE quedar ninguna fila de R27.

**R30** — La fila de R27 NO DEBE contener texto libre tecleado por una persona ni datos del
destinatario de ninguna orden.

### E — La caja de Ordenex — **BLOQUE PENDIENTE DE Q1**

> Los cinco requisitos de esta sección **existen solo si la respuesta a Q1 es «sí»**. Si es «no», se
> borran enteros y el resto de la especificación NO cambia ni una palabra (ver `design.md` §6).

**R31** — CUANDO se confirme un cargo válido, el sistema DEBE añadir además a la caja principal de
Ordenex un ingreso por el mismo importe y con la misma fecha que el asiento de R19.

**R32** — El ingreso de R31 DEBE contar como ganancia propia de Ordenex.

**R33** — El ingreso de R31 DEBE quedar enlazado con el asiento de R19, de forma que se pueda ir de
uno al otro sin adivinar.

**R34** — El ingreso de R31 DEBE aparecer en el libro de la caja de `/wallet`.

**R35** — SI se registran dos cargos idénticos a la misma tienda, ENTONCES DEBEN quedar dos asientos
en el libro de la tienda y dos ingresos en la caja, uno por cada cargo: el enlace de R33 NO DEBE
hacer que el segundo se descarte en silencio.

## Limitaciones declaradas

**N1 — Un cargo no se deduplica en la base.** Al llevar `origen_id` nulo (R20) queda FUERA del índice
único parcial del ledger, exactamente igual que el ajuste manual de caja de hoy. Dos envíos idénticos
producirían dos cargos. Lo único que hay entre medias es el bloqueo anti-doble-envío del `Modal`
(R8), que es de pantalla, no de base. Se declara en vez de esconderse; cerrarlo pedía una clave de
idempotencia que hoy ningún concepto manual tiene y que nadie ha pedido.

**N2 — El cargo no se puede deshacer con un botón.** La corrección es un `ajuste_credito`
compensatorio, y ese movimiento **hoy solo lo emite la anulación de un pago a tienda**: no existe
pantalla para emitirlo a mano. En la práctica, un cargo equivocado se corrige registrando un pago a
la tienda o abriendo una ficha nueva para el crédito manual. Es la consecuencia directa de la
decisión 1 y hay que decirla en voz alta.

## Preguntas abiertas

### Q1 — ¿El cargo a la tienda escribe TAMBIÉN en la caja de Ordenex? **Es de dinero.**

Los seis débitos automáticos de `wallet_tienda_movimiento` son **espejo 1:1** de los seis ingresos de
`wallet_movimiento` —lo dice el comentario del enum en `db/schema.prisma:1617-1618`—: lo que se le
factura a la tienda es ingreso de Ordenex, y las dos filas nacen juntas al aprobar el cierre. Hay
precedente de par también en la anulación: `ajuste_credito` en la tienda ↔ `ingreso_reverso_pago_
tienda` en la caja, las dos en la misma transacción (`LiquidacionService.ts:1230-1256`).

- **Si «sí»:** el cargo escribe además un ingreso de ajuste en la caja y los dos libros siguen
  cuadrando. Entran R31–R35 y el bloque Q1 de `design.md` §6.
- **Si «no»:** la tienda debe más pero la caja nunca reconoce ese ingreso, y los dos libros divergen
  **a propósito**. Caen exactamente **R31, R32, R33, R34 y R35**; no cae ningún otro requisito.

**El leader recomienda que sí. La firma es del humano.**

#### Q1.a — Si la respuesta es «sí»: ¿cómo se enlaza el ingreso de caja con el cargo? (R33)

Va con Q1 porque solo existe si Q1 existe. `design.md` §6.2 propone que el ingreso de caja apunte al
cargo por su identificador, lo que obliga a **añadir un valor al enum `wallet_origen_tipo`** y, con
él, a una migración cuyo `down.sql` recrea el tipo y recastea **tres** tablas (patrón ya escrito y
probado en `20260827120000_premio_ranking_devengo/down.sql`). La alternativa barata es que el ingreso
de caja se registre como manual sin origen —cero migración— a costa de que **nadie pueda distinguir
en la caja un cargo a tienda de un ajuste manual cualquiera**, y de perder la protección de R35.
¿Se paga la migración a cambio del enlace?

### Q2 — ¿Cómo se llama este concepto en pantalla?

`ajuste_debito` ya tiene etiqueta en el libro: **«Ajuste (débito)»**
(`mi-wallet-labels.ts:86`), y es lo que verá la tienda en `/mi-wallet`. Para un cargo que alguien
decide, «Ajuste (débito)» es jerga contable y no dice qué pasó. Renombrar esa etiqueta es seguro
—`ajuste_debito` no tiene ni un productor hoy, así que no hay fila histórica cuyo significado
cambie— pero **es la misma etiqueta que usará cualquier débito compensatorio futuro**, así que la
decisión no es solo de esta ficha. Tres opciones:

1. no tocar nada: en el selector se llama «Cargo a una tienda» y en el libro sigue diciendo «Ajuste
   (débito)» (es lo que R4 obliga a decirle al usuario antes de registrar);
2. renombrar la etiqueta del libro a algo llano («Cargo de Ordenex»);
3. otra redacción que dé el humano.

**El diseño asume la (1) para no decidir esto por su cuenta.** Cambiarlo después es una línea.

### Q3 — ¿La ficha 381 se registra en `feature_list.json`?

Comprobado el 2026-09-07: **no existe ninguna entrada con `"id": 381`** en `feature_list.json`. El
spec_author no escribe ese archivo. Alguien tiene que registrar la ficha antes de implementar, o el
gate y el reviewer trabajarán sobre una feature que el estado no conoce.
