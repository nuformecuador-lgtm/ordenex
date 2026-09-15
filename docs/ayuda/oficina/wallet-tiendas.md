---
titulo: Wallet · Tiendas
modulo: wallet
pantalla: /wallet/tiendas
roles: [maestro, admin]
actualizado: 2026-09-15
fuentes:
  - app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx
  - app/(app)/wallet/tiendas/_components/DesgloseMovimientosTienda.tsx
  - app/(app)/wallet/tiendas/_components/PagoTiendaAcciones.tsx
  - app/(app)/wallet/tiendas/_components/saldo-tienda-signo-label.ts
---

# Wallet · Tiendas

**Cuánto le debés a cada tienda**, o cuánto te debe ella. Es la pantalla desde la que se liquida con
los clientes.

Es la misma cuenta que la tienda ve en su **Mi wallet**, mirada desde este lado.

## La tabla de saldos

Una fila por tienda, con su saldo y su signo:

| Signo | Significa |
| --- | --- |
| **A favor** | Le debés a la tienda. Es lo recaudado de sus clientes que todavía no le pagaste |
| **En contra** | Ella te debe. Los cargos superaron lo recaudado |
| **En cero** | Cuadrado |

## El desglose

Abriendo una tienda ves **todos sus movimientos**: lo recaudado, las comisiones, los cargos y los
ajustes, cada uno con la orden y el cierre de los que viene.

Ahí se resuelven las discusiones de *«este número no me cuadra»*: se baja hasta la entrega concreta.

## Registrar un pago

Desde las acciones de la tienda registrás lo que le pagaste, y el saldo se mueve.

Un pago se puede **anular** si se registró por error. Si te dice **«Este pago ya estaba anulado»**, es
que alguien se te adelantó — recargá y mirá cómo quedó.

## Cosas que te pueden pasar

**«No hay tiendas con saldo registrado».** Ninguna tiene movimientos todavía. En una operación nueva
es lo esperable hasta que se apruebe el primer cierre.

**«No se pudieron cargar los saldos por tienda».** Fallo al leer; recargá. Si sigue, es para revisar.

**Un saldo que no cuadra con lo que la tienda dice.** Casi siempre es tiempo, no error: los movimientos
entran **al aprobarse el cierre del mensajero**, no al entregarse el paquete. Comparen con la misma
fecha de corte.

## Lo que esta pantalla NO hace

- **No es la caja de Ordenex.** Eso es **Wallet · Caja**.
- **No se corrige una entrega desde acá.** Un cargo mal calculado nace de la orden; se arregla allá.
