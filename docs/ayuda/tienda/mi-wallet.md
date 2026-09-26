---
titulo: Mi wallet
modulo: mi-wallet
pantalla: /mi-wallet
roles: [adminTienda]
actualizado: 2026-09-25
fuentes:
  - app/(app)/mi-wallet/_components/MiWalletModule.tsx
  - app/(app)/mi-wallet/_components/mi-wallet-labels.ts
  - lib/utils/descripcion-pago-por-cuenta.ts
  - lib/services/CobroTiendaService.ts
  - lib/services/AbonoTiendaService.ts
  - lib/utils/descripcion-abono.ts
  - app/(app)/mi-wallet/_components/SaldoTiendaCard.tsx
  - app/(app)/mi-wallet/_components/DesgloseTiendaLedger.tsx
  - app/(app)/mi-wallet/_components/MiWalletFiltros.tsx
  - app/(app)/mi-wallet/_components/detalle-mi-movimiento-labels.ts
  - lib/auth/menu-visibility.ts
---

# Mi wallet

Acá está **tu plata con Ordenex**: cuánto se cobró a tus clientes en tus entregas, cuánto te cobró
Ordenex de servicio, y cómo queda la cuenta entre los dos.

## El saldo, arriba

Una sola cifra que resume todo, con tres lecturas posibles:

| Dice | Significa |
| --- | --- |
| **A tu favor** | Ordenex te debe. Es plata que se cobró a tus clientes y todavía no te llegó |
| **En contra** | Vos debés. Los cargos del servicio superaron lo cobrado |
| **En cero** | Está cuadrado |

## De dónde sale cada número

El saldo no es un número suelto: es la suma de todos tus movimientos. Arriba del desglose lo ves
resumido en cuatro cifras: **A tu favor**, **Cargos de Ordenex**, **Ya pagado** y **Saldo a favor**.
Cada movimiento se lee desde tu lado: dice qué hizo Ordenex contigo.

**Lo que suma a tu favor**
- **Cobrado a tus clientes en contra-entrega** — la plata que el mensajero cobró al cliente en tu
  nombre. Es el grueso.
- **Corrección a tu favor** — una corrección a tu favor.
- **Ordenex anuló un pago hecho por ti** — la devolución de un pago que Ordenex hizo por vos y se anuló.
- **Ordenex anuló un cobro y te lo devolvió** — la devolución de un cobro que Ordenex te hizo y se anuló.
- **Le pagaste a Ordenex** — lo que le pagaste a Ordenex cuando tu saldo estaba en contra.

**Lo que resta**
- **Ordenex te cobró el flete**, **Ordenex te cobró el flete por rechazo**, **Ordenex te cobró la
  comisión de contra-entrega** y su **IVA** — el servicio de Ordenex.
- **Ordenex te cobró** — un cobro que la oficina te hace a mano, por ejemplo material de despacho. Se
  descuenta de tu saldo a favor.
- **Corrección en tu contra** — una corrección en tu contra.
- **Ordenex te pagó** — lo que Ordenex ya te pagó de tu saldo.
- **Ordenex pagó un gasto por ti** — lo que Ordenex **le pagó a otro en tu nombre**.
- **Ordenex anuló el pago que le hiciste** — la anulación de un pago tuyo registrado por error: tu saldo vuelve a bajar.

Cada línea dice de qué orden y de qué cierre viene, así que siempre podés rastrear una cifra hasta la
entrega concreta que la produjo.

## Un cobro que Ordenex te hizo

A veces la oficina te cobra algo a mano —material de despacho entregado en la bodega, por ejemplo—.
Lo ves como **Ordenex te cobró**, con el motivo que escribió la oficina.

- **Baja tu saldo** en el monto y se cuenta dentro de **Cargos de Ordenex**.
- Si no tenías saldo a favor, **tu saldo queda en contra**: le debés ese dinero a Ordenex, y se cobra
  cuando tus entregas vuelvan a generarte plata a favor.
- Si la oficina lo anula, aparece una línea **Ordenex anuló un cobro y te lo devolvió** que te devuelve
  el monto. El cobro original no se borra.
- No es lo mismo que **Ordenex pagó un gasto por ti**: en el cobro no le pagó nada a nadie.

## Un pago que Ordenex hizo por ti

A veces Ordenex paga algo **por vos**: tu proveedor, tu publicidad, alguien de tu personal. Lo ves como
**Ordenex pagó un gasto por ti**, y la descripción dice **a quién se le pagó, el motivo, el método** y,
si la hay, **la referencia** (por ejemplo, «A Facebook · Pauta de publicidad · SINPE · 12345»).

- **Baja tu saldo** en el monto, y se cuenta dentro de **Ya pagado**: es dinero que Ordenex ya puso
  por vos.
- Si no tenías saldo suficiente, **tu saldo queda en contra**: le debés ese dinero a Ordenex.
- Si la oficina lo anula, aparece una línea **Ordenex anuló un pago hecho por ti** que te devuelve el
  monto. El pago original no se borra.

## Un pago que le hiciste a Ordenex

Si tu saldo quedó en contra y le pagaste a Ordenex, lo ves como **Le pagaste a Ordenex**, con el motivo, el método y la referencia. **Sube tu saldo** en el monto. Si la oficina lo anula por error, aparece **Ordenex anuló el pago que le hiciste** y tu saldo vuelve a bajar. El comprobante de tu pago lo guarda la oficina.

## Buscar en el desglose

Dos filtros:

- **Por concepto** — para ver solo, por ejemplo, las comisiones o los cobros.
- **Por cierre** — todos los movimientos que entraron con un cierre determinado.

Las fechas **Desde** y **Hasta** son días completos de Costa Rica. Y podés **descargar el desglose**
para cuadrarlo por tu cuenta o pasarlo a tu contabilidad, con los mismos nombres que la tabla.

## El detalle de un cierre

Tocando un movimiento de cierre ves **qué entregas lo componen**: destinatario, guía, qué se cobró y
en qué forma. Es el nivel donde se resuelven las dudas del tipo *«¿por qué este cierre me dio esta
cifra?»*.

## Cosas que te pueden pasar

**El saldo no cuadra con lo que esperabas.** Lo más común es que haya entregas cobradas cuyo cierre
todavía no fue aprobado: esa plata aún no entró. Filtrá por cierre y comparás.

**Una entrega no aparece.** Los movimientos entran **cuando se aprueba el cierre del mensajero**, no
cuando se entrega el paquete. Si la entrega es de hoy, es normal que todavía no esté.

## Lo que esta pantalla NO hace

- **No se pagan saldos desde acá.** El pago se coordina con la oficina; esta pantalla lo refleja.
- **No se anula ningún cobro ni ningún pago desde acá.** Si un cobro o un pago no te cuadra, pedíselo
  a la oficina: la anulación la hace ella, y acá la vas a ver como una línea que te devuelve el monto.
- **No se abre el comprobante de un pago que Ordenex hizo por ti.** Si lo necesitás, pedíselo a la
  oficina.
- **No se corrigen cifras.** Un número mal sale de una entrega mal registrada: se arregla en la orden,
  no en el saldo.
