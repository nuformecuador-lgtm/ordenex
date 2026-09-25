---
titulo: Wallet · Tiendas
modulo: wallet
pantalla: /wallet/tiendas
roles: [maestro, admin]
actualizado: 2026-09-25
fuentes:
  - app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx
  - app/(app)/wallet/tiendas/_components/desglose-tienda-labels.ts
  - app/(app)/mi-wallet/_components/mi-wallet-labels.ts
  - lib/utils/descripcion-pago-por-cuenta.ts
  - lib/services/PagoPorCuentaTiendaService.ts
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

Arriba del desglose, cuatro cifras: **A favor de la tienda**, **Cargos de Ordenex**, **Pagado a la
tienda** (lo ya entregado a la tienda **o pagado por su cuenta**) y **Saldo a favor**.

## Dos conceptos que bajan el saldo y no son lo mismo

| En el desglose dice | Qué es | ¿Salió dinero de la caja? |
| --- | --- | --- |
| **Pago por cuenta de la tienda** | Ordenex le pagó a un tercero en nombre de la tienda (su proveedor, su publicidad, su personal). La descripción dice a quién, el motivo, el método y la referencia | **Sí** |
| **Cobro de Ordenex** | Un cargo de Ordenex a la tienda: no se le pagó nada a nadie | **No** |
| **Pago por cuenta anulado** | La devolución de un pago por cuenta que se anuló: el saldo vuelve a subir | Vuelve a entrar |

Los dos se registran desde **Wallet · Caja**, con **Registrar movimiento**: «Pago por cuenta de una
tienda» y «Cobrar un costo a una tienda». Ahí está explicado cuál elegir, con un ejemplo. **Un pago por
cuenta no cuenta como un pago a la tienda**: no aparece en su lista de pagos. Y un pago por cuenta puede
dejar el saldo **en contra**: entonces la tienda le debe ese dinero a Ordenex.

Algunos **Cobros de Ordenex** antiguos eran en realidad pagos por cuenta de la tienda. Se corrigieron en
la caja, pero **acá se siguen viendo como Cobro de Ordenex**: el saldo de la tienda ya era correcto.

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
- **No se registran ni se anulan pagos por cuenta ni cobros de un costo.** Eso es en **Wallet · Caja**.
- **No se corrige una entrega desde acá.** Un cargo mal calculado nace de la orden; se arregla allá.
