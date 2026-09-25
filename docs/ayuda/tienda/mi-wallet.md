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
  - app/(app)/mi-wallet/_components/SaldoTiendaCard.tsx
  - app/(app)/mi-wallet/_components/DesgloseTiendaLedger.tsx
  - app/(app)/mi-wallet/_components/MiWalletFiltros.tsx
  - app/(app)/mi-wallet/_components/detalle-mi-movimiento-labels.ts
  - lib/auth/menu-visibility.ts
---

# Mi wallet

Acá está **tu plata con Ordenex**: cuánto se recaudó de tus entregas, cuánto se cobró de servicio, y
cómo queda la cuenta entre los dos.

## El saldo, arriba

Una sola cifra que resume todo, con tres lecturas posibles:

| Dice | Significa |
| --- | --- |
| **A tu favor** | Ordenex te debe. Es plata que se recaudó de tus clientes y todavía no te llegó |
| **En contra** | Vos debés. Los cargos del servicio superaron lo recaudado |
| **En cero** | Está cuadrado |

## De dónde sale cada número

El saldo no es un número suelto: es la suma de todos tus movimientos. Arriba del desglose lo ves
resumido en cuatro cifras: **A tu favor**, **Cargos de Ordenex**, **Ya pagado** y **Saldo a favor**.

**Lo que suma a tu favor**
- **COD recaudado** — la plata que el mensajero cobró al cliente en tu nombre. Es el grueso.
- **Ajuste (crédito)** — correcciones a tu favor.
- **Pago por cuenta anulado** — la devolución de un pago por cuenta que se anuló.

**Lo que resta**
- **Flete**, **Flete por rechazo**, **Comisión COD** y su **IVA** — el servicio de Ordenex.
- **Cobro de Ordenex** — un cargo que la oficina te hace a mano, por ejemplo material de despacho.
- **Ajuste (débito)** — correcciones en contra.
- **Pago a la tienda** — lo que Ordenex ya te pagó.
- **Pago por cuenta de la tienda** — lo que Ordenex **le pagó a otro en tu nombre**.

Cada línea dice de qué orden y de qué cierre viene, así que siempre podés rastrear una cifra hasta la
entrega concreta que la produjo.

## Un pago que Ordenex hizo por tu cuenta

A veces Ordenex paga algo **por vos**: tu proveedor, tu publicidad, alguien de tu personal. Lo ves como
**Pago por cuenta de la tienda**, y la descripción dice **a quién se le pagó, el motivo, el método** y,
si la hay, **la referencia** (por ejemplo, «A Facebook · Pauta de publicidad · SINPE · 12345»).

- **Baja tu saldo** en el monto, y se cuenta dentro de **Ya pagado**: es dinero que Ordenex ya puso
  por vos.
- Si no tenías saldo suficiente, **tu saldo queda en contra**: le debés ese dinero a Ordenex.
- Si la oficina lo anula, aparece una línea **Pago por cuenta anulado** que te devuelve el monto. El
  pago original no se borra.
- Un **Cobro de Ordenex** es otra cosa: un cargo de Ordenex, no un pago a un tercero.

## Buscar en el desglose

Dos filtros:

- **Por concepto** — para ver solo, por ejemplo, las comisiones.
- **Por cierre** — todos los movimientos que entraron con un cierre determinado.

Y podés **descargar el desglose** para cuadrarlo por tu cuenta o pasarlo a tu contabilidad.

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
- **No se abre el comprobante de un pago por cuenta.** Si lo necesitás, pedíselo a la oficina.
- **No se corrigen cifras.** Un número mal sale de una entrega mal registrada: se arregla en la orden,
  no en el saldo.
