---
titulo: Wallet · Tiendas
modulo: wallet
pantalla: /wallet/tiendas
roles: [maestro, admin]
actualizado: 2026-09-26
fuentes:
  - app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx
  - components/shared/SelectorBuscable.tsx
  - components/shared/wallet/cierres-selector.ts
  - components/shared/wallet/conceptos-filtro.ts
  - components/shared/wallet/OrigenMovimiento.tsx
  - lib/services/OrigenLegibleService.ts
  - app/(app)/wallet/tiendas/_components/desglose-tienda-labels.ts
  - app/(app)/mi-wallet/_components/mi-wallet-labels.ts
  - lib/utils/descripcion-pago-por-cuenta.ts
  - lib/utils/descripcion-cobro-tienda.ts
  - lib/services/PagoPorCuentaTiendaService.ts
  - lib/services/CobroTiendaService.ts
  - lib/services/AbonoTiendaService.ts
  - lib/utils/descripcion-abono.ts
  - app/(app)/wallet/tiendas/_components/DesgloseMovimientosTienda.tsx
  - app/(app)/wallet/tiendas/_components/PagoTiendaAcciones.tsx
  - app/(app)/wallet/tiendas/_components/saldo-tienda-signo-label.ts
---

# Wallet · Tiendas

**Cuánto le debés a cada tienda**, o cuánto te debe ella. Es la pantalla desde la que se liquida con
los clientes.

Es la misma cuenta que la tienda ve en su **Mi wallet**, mirada desde este lado: acá cada concepto se
lee **desde Ordenex** («Ordenex le cobra a la tienda») y allá la tienda lo lee desde el suyo («Ordenex
te cobró»).

## La tabla de saldos

Una fila por tienda, con su saldo y su signo:

| Signo | Significa |
| --- | --- |
| **A favor** | Le debés a la tienda. Es lo recaudado de sus clientes que todavía no le pagaste |
| **En contra** | Ella te debe. Los cargos superaron lo recaudado |
| **En cero** | Cuadrado |

Al pagar o anular desde el desglose de una tienda, su fila se actualiza sola, sin recargar.

## El desglose

Abriendo una tienda ves **todos sus movimientos**: lo recaudado, las comisiones, los cargos, los cobros
y las correcciones, cada uno con la orden y el cierre de los que viene.

Ahí se resuelven las discusiones de *«este número no me cuadra»*: se baja hasta la entrega concreta.

Arriba del desglose, cuatro cifras: **A favor de la tienda** (contra-entrega cobrado, correcciones a
favor, pagos de la tienda a Ordenex y devoluciones por anulaciones), **Cargos de Ordenex** (fletes,
comisión, IVA, los cobros de Ordenex a la tienda y sus pagos a Ordenex anulados), **Pagado a la tienda** (lo que Ordenex le pagó a la tienda o pagó por ella) y
**Saldo a favor**.

## De dónde viene cada movimiento

La columna **Origen** dice qué produjo cada movimiento, con nombre: «Cierre del día · 2026-09-12 ·
Juan Pérez Mora», «Gestión de orden · cobro por rechazo · guía 4321», «Pago de Ordenex a una tienda ·
Tania Tienda · 2026-09-12 · SINPE». Cuando ese origen tiene pantalla propia, al lado aparece **Ver**,
que te lleva al cierre, a la orden o al ranking de ese día. La descarga lleva el mismo texto.

## Filtrar el desglose

- **Cierre**: se elige de la lista de cierres **de esta tienda** que tienen movimientos, cada uno con
  su día, el mensajero y cuántos movimientos trajo. Podés buscar **por día (2026-09-12) o por el nombre
  del mensajero**. Si la lista dice «Mostramos los cierres más recientes», buscá para ver los demás.
  No hace falta copiar ni pegar nada.
- **Concepto**: solo aparecen los conceptos que **tienen movimientos** de esta tienda en el periodo
  (y el cierre) que elegiste, cada uno con su número entre paréntesis, por ejemplo «Flete cobrado a la
  tienda (12)». Si cambiás el periodo y el concepto elegido se queda sin movimientos, sigue elegido
  con **(0)** hasta que lo quites.
- **Desde** y **Hasta**: días completos de Costa Rica.

## Cómo se llama cada movimiento

| En el desglose dice | Qué es | ¿Salió dinero de la caja? |
| --- | --- | --- |
| **Contra-entrega cobrado a los clientes de la tienda** | Lo que el mensajero cobró a los clientes en nombre de la tienda | No: entró, y es de la tienda |
| **Flete cobrado a la tienda**, **Comisión de contra-entrega cobrada a la tienda**, **IVA del flete cobrado a la tienda**… | El servicio de Ordenex, al aprobarse un cierre | No: se descuenta del saldo y es ganancia de Ordenex |
| **Ordenex le cobra a la tienda** | Un cobro de Ordenex a la tienda hecho a mano: no se le pagó nada a nadie. Se descuenta de su saldo y **es ganancia de Ordenex** | **No**: el dinero pasa del saldo de la tienda a la ganancia |
| **Cobro de Ordenex a la tienda anulado** | La anulación de ese cobro: el saldo vuelve a subir | No |
| **Ordenex paga un gasto de la tienda** | Ordenex le pagó a un tercero en nombre de la tienda (su proveedor, su publicidad, su personal). La descripción dice a quién, el motivo, el método y la referencia | **Sí** |
| **Pago de un gasto de la tienda anulado** | La devolución de un pago de un gasto que se anuló: el saldo vuelve a subir | Vuelve a entrar |
| **Ordenex le paga a la tienda** | Lo que se le pagó a la tienda de su saldo | **Sí** |
| **La tienda le paga a Ordenex** | Lo que la tienda le pagó a Ordenex cuando estaba en contra. Su saldo sube | **Sí**: entró dinero de la tienda |
| **Pago de la tienda a Ordenex anulado** | La anulación de ese pago: el saldo vuelve a bajar | Vuelve a salir |
| **Corrección a favor de la tienda** / **Corrección en contra de la tienda** | Una corrección hecha a mano | — |

El cobro y el pago de un gasto se registran desde **Wallet · Caja**, con **Registrar movimiento**:
«Ordenex le cobra a una tienda» y «Ordenex paga un gasto de una tienda». Ahí está explicado cuál elegir,
con un ejemplo. **Un pago de un gasto no cuenta como un pago a la tienda**: no aparece en su lista de
pagos. Y tanto el cobro como el pago de un gasto pueden dejar el saldo **en contra**: entonces la tienda
le debe ese dinero a Ordenex.

Algunos cobros antiguos eran en realidad pagos de un gasto de la tienda. Se corrigieron en la caja,
pero **acá se siguen viendo como «Ordenex le cobra a la tienda»**: el saldo de la tienda ya era correcto.

## Registrar un pago

Desde las acciones de la tienda registrás lo que le pagaste, y el saldo se mueve.

Un pago se puede **anular** si se registró por error. Si te dice **«Este pago ya estaba anulado»**, es
que alguien se te adelantó — recargá y mirá cómo quedó.

## Registrar un pago de la tienda a Ordenex

Cuando una tienda está **en contra**, desde las acciones de su desglose registrás el pago que ella le hizo a Ordenex: **Registrar pago de la tienda a Ordenex**. Se pide el monto —hasta lo que debe—, la fecha real, el motivo, el método (con referencia en SINPE y transferencia) y un comprobante opcional. Su saldo sube en el monto y la fila se actualiza sola. Se anula desde **Wallet · Caja**, en el libro, con motivo.

Con la tienda en cero o a favor, esa acción no aparece: no hay nada que la tienda deba.

## Cosas que te pueden pasar

**«No hay tiendas con saldo registrado».** Ninguna tiene movimientos todavía. En una operación nueva
es lo esperable hasta que se apruebe el primer cierre.

**«No se pudieron cargar los saldos por tienda».** Fallo al leer; recargá. Si sigue, es para revisar.

**Un saldo que no cuadra con lo que la tienda dice.** Casi siempre es tiempo, no error: los movimientos
entran **al aprobarse el cierre del mensajero**, no al entregarse el paquete. Comparen con la misma
fecha de corte.

## Lo que esta pantalla NO hace

- **No es la caja de Ordenex.** Eso es **Wallet · Caja**.
- **No se registran ni se anulan cobros a una tienda ni pagos de un gasto de una tienda, ni se anulan
  pagos de la tienda a Ordenex.** Eso es en **Wallet · Caja**, desde el libro.
- **No se corrige una entrega desde acá.** Un cargo mal calculado nace de la orden; se arregla allá.
