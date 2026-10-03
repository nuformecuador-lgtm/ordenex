---
titulo: Mi wallet
modulo: mi-wallet
pantalla: /mi-wallet
roles: [adminTienda]
actualizado: 2026-10-02
fuentes:
  - app/(app)/mi-wallet/page.tsx
  - app/(app)/mi-wallet/_components/MiEstadoCuenta.tsx
  - app/(app)/mi-wallet/_components/ResumenMiWallet.tsx
  - app/(app)/mi-wallet/_components/mi-estado-cuenta-labels.ts
  - components/shared/estado-cuenta/EstadoCuenta.tsx
  - components/shared/estado-cuenta/TarjetasEstadoCuenta.tsx
  - components/shared/estado-cuenta/estado-cuenta-labels.ts
  - components/shared/wallet/zonas-filtros-labels.ts
  - components/shared/estado-cuenta/estado-cuenta-descarga-columnas.ts
  - lib/actions/estado-cuenta.ts
  - lib/services/EstadoCuentaService.ts
  - lib/utils/estado-cuenta-chips.ts
  - components/shared/wallet/OrigenMovimiento.tsx
  - lib/services/OrigenLegibleService.ts
  - app/(app)/mi-wallet/_components/mi-wallet-labels.ts
  - app/(app)/mi-wallet/_components/mi-wallet-cierres.ts
  - lib/utils/descripcion-pago-por-cuenta.ts
  - lib/services/CobroTiendaService.ts
  - lib/services/AbonoTiendaService.ts
  - lib/utils/descripcion-abono.ts
  - app/(app)/mi-wallet/_components/VerComprobanteMiMovimiento.tsx
  - lib/actions/wallet-comprobante.ts
  - app/(app)/mi-wallet/_components/DetalleMiMovimientoCierre.tsx
  - app/(app)/mi-wallet/_components/detalle-mi-movimiento-labels.ts
  - lib/auth/menu-visibility.ts
---

# Mi wallet

Acá está **tu plata con Ordenex**, como el extracto de un banco: cuánto se cobró a tus clientes en tus
entregas, cuánto te cobró Ordenex de servicio, lo que te pagó, y cómo queda la cuenta entre los dos.

## El resumen: a tu favor, cargos y ya pagado

Lo primero que ves son tres cifras de **toda tu cuenta** (no cambian con el periodo, el filtro ni el
cierre que elijas):

| Cifra | Qué suma |
| --- | --- |
| **A tu favor** | Lo cobrado a tus clientes, las correcciones a tu favor, lo que le pagaste a Ordenex y lo que Ordenex te devolvió al anular |
| **Cargos de Ordenex** | Fletes, comisión, IVA, lo que Ordenex te cobró y los pagos a Ordenex que se anularon |
| **Ya pagado** | Lo que Ordenex te pagó o pagó por ti |

Debajo está el **Saldo a favor**, que es la resta: a tu favor menos cargos menos ya pagado. Es el
mismo número que el **saldo actual** de la tarjeta de abajo y que el saldo de la última fila del
extracto. Así distinguís lo que Ordenex **te pagó** de lo que **te cobró**, aunque los dos te bajen el
saldo.

Un pago que Ordenex te hizo y después anuló **sigue contando** en «Ya pagado», y su devolución suma en
«A tu favor»: esas dos cifras quedan más altas de lo que se movió de verdad. El «Saldo a favor» ya
tiene todo eso descontado: ese es el número correcto.

## El saldo, arriba

La cifra grande es tu **saldo actual**, con una frase que dice **quién le debe a quién**:

| Dice | Significa |
| --- | --- |
| **Ordenex te debe ₡…** | Tenés saldo a favor. Es plata que se cobró a tus clientes y todavía no te llegó |
| **Le debés ₡… a Ordenex** | Tu saldo está en contra. Los cargos superaron lo cobrado |
| **Ordenex y vos no se deben nada** | Está cuadrado |

Debajo, cuatro cifras del periodo que estás mirando: **Saldo inicial**, **Abonos del periodo** (lo que
suma a tu favor), **Cargos del periodo** (lo que resta) y **Saldo al final del periodo**. Siempre se
cumple: saldo inicial más abonos menos cargos es el saldo final. Un movimiento anulado y su anulación
**no cuentan** en abonos ni cargos: se cancelan entre ellos.

## Tu estado de cuenta

La tabla es el **extracto**. Se abre en **Más recientes**: tu último movimiento arriba.

- La línea del **saldo inicial** —lo que tenías al terminar el día anterior al periodo— va donde cae en
  el tiempo: con **Más recientes**, es la última línea de la última página; con **Más antiguas**, la
  primera de la primera página.
- Cada movimiento dice su fecha, qué fue, el motivo, de dónde viene, cómo se pagó (si es un pago), el
  **cargo** o el **abono**, y tu **saldo** justo después de ese movimiento.
- El saldo de tu movimiento más reciente es el mismo de la cifra grande de arriba. Cambiar el orden
  no cambia el saldo de ninguna fila.

Cada movimiento se lee desde tu lado: dice qué hizo Ordenex contigo.

**Lo que suma a tu favor**
- **Cobrado a tus clientes en contra-entrega** — la plata que el mensajero cobró al cliente en tu
  nombre. Es el grueso.
- **Corrección a tu favor** — una corrección a tu favor.
- **Ordenex anuló un pago hecho por ti** — la devolución de un pago que Ordenex hizo por vos y se anuló.
- **Ordenex anuló un cobro y te lo devolvió** — la devolución de un cobro que Ordenex te hizo y se anuló.
- **Le pagaste a Ordenex** — lo que le pagaste a Ordenex cuando tu saldo estaba en contra.

**Lo que resta**
- **Ordenex te cobró el flete**, **Ordenex te cobró el flete por devolución a origen**, **Ordenex te cobró la
  comisión de contra-entrega** y su **IVA** — el servicio de Ordenex.
- **Ordenex te cobró** — un cobro que la oficina te hace a mano, por ejemplo material de despacho. Se
  descuenta de tu saldo a favor.
- **Corrección en tu contra** — una corrección en tu contra.
- **Ordenex te pagó** — lo que Ordenex ya te pagó de tu saldo.
- **Ordenex pagó un gasto por ti** — lo que Ordenex **le pagó a otro en tu nombre**.
- **Ordenex anuló el pago que le hiciste** — la anulación de un pago tuyo registrado por error: tu saldo vuelve a bajar.

Cada línea dice **de dónde viene**: el cierre, el pago, la guía… El **origen** lo dice con nombre, por
ejemplo «Cierre del día · 2026-09-12» o «Gestión de orden · cobro por devolución a origen · guía 4321». Las órdenes
de un cierre se ven desplegando su fila; los pagos, cobros y correcciones no vienen de una orden.

Un movimiento anulado **no desaparece**: sigue en su lugar, tachado, con la leyenda **Anulado por
Ordenex**, el día y la hora (de Costa Rica) en que se anuló y el motivo. Su anulación aparece como otra
fila, con la marca **Anulación**.

## Un cobro que Ordenex te hizo

A veces la oficina te cobra algo a mano —material de despacho entregado en la bodega, por ejemplo—.
Lo ves como **Ordenex te cobró**, con el motivo que escribió la oficina.

- **Baja tu saldo** en el monto: es un **cargo** de tu estado de cuenta, en el tipo de movimiento **Cobros**.
- Si no tenías saldo a favor, **tu saldo queda en contra**: le debés ese dinero a Ordenex, y se cobra
  cuando tus entregas vuelvan a generarte plata a favor.
- Si la oficina lo anula, aparece una línea **Ordenex anuló un cobro y te lo devolvió** que te devuelve
  el monto. El cobro original no se borra.
- No es lo mismo que **Ordenex pagó un gasto por ti**: en el cobro no le pagó nada a nadie.

## Un pago que Ordenex hizo por ti

A veces Ordenex paga algo **por vos**: tu proveedor, tu publicidad, alguien de tu personal. Lo ves como
**Ordenex pagó un gasto por ti**, y la descripción dice **a quién se le pagó, el motivo, el método** y,
si la hay, **la referencia** (por ejemplo, «A Facebook · Pauta de publicidad · SINPE · 12345»).

- **Baja tu saldo** en el monto: es dinero que Ordenex ya puso por vos, en el tipo de movimiento **Pagos**.
- Si no tenías saldo suficiente, **tu saldo queda en contra**: le debés ese dinero a Ordenex.
- Si la oficina lo anula, aparece una línea **Ordenex anuló un pago hecho por ti** que te devuelve el
  monto. El pago original no se borra.

## Un pago que le hiciste a Ordenex

Si tu saldo quedó en contra y le pagaste a Ordenex, lo ves como **Le pagaste a Ordenex**, con el motivo, el método y la referencia. **Sube tu saldo** en el monto. Si la oficina lo anula por error, aparece **Ordenex anuló el pago que le hiciste** y tu saldo vuelve a bajar.

## Ver el comprobante

Cuando la oficina guardó un comprobante, lo podés abrir desde la fila con **Ver comprobante**: en los
pagos que Ordenex te hizo, en los pagos que Ordenex hizo por ti, en los cobros de Ordenex y en los pagos
que le hiciste a Ordenex. Se abre en otra pestaña con un enlace que dura poco. Si esa fila no tiene
comprobante, te lo dice: «Este registro no tiene comprobante.». Solo ves los de tu tienda.

## Filtrar tu estado de cuenta

Los filtros están en **una sola barra, encima de la tabla**, en la misma fila que **Descargar**:

- **Más recientes / Más antiguas**: los dos botones con flechas del principio; el orden del extracto,
  por fecha.
- **El buscador**: busca en la descripción de tus movimientos. Escribí **al menos 3 caracteres**.
- **Filtros**: abre una lista de casillas —**Periodo**, **Tipo de movimiento** y **Cierre**—. Marcar una
  casilla pone su control en la barra (marcarla sola no filtra nada); desmarcarla quita ese filtro.

Lo que hace cada casilla:

- **Periodo**: elegís el primer y el último día en el calendario (días de Costa Rica) y se aplica solo,
  sin botón. Es el único que cambia también las cifras del periodo, y la línea del saldo inicial dice el
  saldo con el que empezaste ese periodo.
- **Tipo de movimiento**: **Cierres · Pagos · Cobros · Correcciones** (sin elegir ninguno, dice
  **Todo**). Cada movimiento cae en uno solo. El saldo de cada fila **sigue siendo el de tu cuenta
  entera**, aunque filtres.
- **Cierre** — todos los movimientos que entraron con un cierre determinado. Cada cierre se nombra por
  su día y cuántos movimientos trajo, por ejemplo «Cierre del 2026-09-12 · 7 movimientos». **Todos los
  cierres** quita el filtro.

**Limpiar todo** quita el texto buscado, el periodo, el tipo de movimiento, el cierre y todas las
casillas; no toca el orden. Si una lectura falla, la pantalla te lo dice y se queda con lo que mostraba,
filtros incluidos.

Y podés **descargar tu estado de cuenta**: trae **el periodo entero** que estás mirando (no solo la
página), en el orden elegido y con el saldo inicial donde cae en el tiempo, y el saldo de cada fila,
con los mismos nombres que la tabla. Respeta el texto buscado, el tipo de movimiento y el cierre. Si
el periodo tiene más movimientos de los que entran en una descarga, no se descarga nada y te lo dice:
elegí un periodo más corto, un tipo de movimiento o un cierre.

## El detalle de un cierre

Tocando la flecha de un movimiento de cierre ves **qué entregas lo componen**: destinatario, guía, qué
se cobró y en qué forma. Es el nivel donde se resuelven las dudas del tipo *«¿por qué este cierre me dio
esta cifra?»*.

## Cosas que te pueden pasar

**El saldo no cuadra con lo que esperabas.** Lo más común es que haya entregas cobradas cuyo cierre
todavía no fue aprobado: esa plata aún no entró. Filtrá por cierre y comparás.

**Una entrega no aparece.** Los movimientos entran **cuando se aprueba el cierre del mensajero**, no
cuando se entrega el paquete. Si la entrega es de hoy, es normal que todavía no esté.

## Lo que esta pantalla NO hace

- **No se pagan saldos desde acá.** El pago se coordina con la oficina; esta pantalla lo refleja.
- **No se anula ningún cobro ni ningún pago desde acá.** Si un cobro o un pago no te cuadra, pedíselo
  a la oficina: la anulación la hace ella, y acá la vas a ver como una línea que te devuelve el monto.
- **No se sube ni se cambia ningún comprobante.** Los guarda la oficina; acá solo se ven.
- **No se corrigen cifras.** Un número mal sale de una entrega mal registrada: se arregla en la orden,
  no en el saldo.
