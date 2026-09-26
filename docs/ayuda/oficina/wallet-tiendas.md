---
titulo: Wallet · Tiendas
modulo: wallet
pantalla: /wallet/tiendas
roles: [maestro, admin]
actualizado: 2026-09-26
fuentes:
  - app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx
  - app/(app)/wallet/tiendas/[tiendaId]/page.tsx
  - app/(app)/wallet/tiendas/_components/EstadoCuentaTienda.tsx
  - app/(app)/wallet/tiendas/_components/EstadoCuentaAcciones.tsx
  - app/(app)/wallet/tiendas/_components/estado-cuenta-tienda-labels.ts
  - app/(app)/wallet/tiendas/_components/PagosTiendaEstadoCuenta.tsx
  - components/shared/estado-cuenta/EstadoCuenta.tsx
  - components/shared/estado-cuenta/estado-cuenta-labels.ts
  - components/shared/estado-cuenta/estado-cuenta-descarga-columnas.ts
  - components/shared/wallet/DetalleMovimientoPanel.tsx
  - components/shared/wallet/RegistrarMovimientoDialog.tsx
  - lib/services/EstadoCuentaService.ts
  - lib/utils/estado-cuenta-chips.ts
  - app/(app)/wallet/tiendas/_components/desglose-tienda-labels.ts
  - app/(app)/mi-wallet/_components/mi-wallet-labels.ts
  - lib/utils/descripcion-pago-por-cuenta.ts
  - lib/utils/descripcion-cobro-tienda.ts
  - lib/services/PagoPorCuentaTiendaService.ts
  - lib/services/CobroTiendaService.ts
  - lib/services/AbonoTiendaService.ts
  - lib/utils/descripcion-abono.ts
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

Cada fila lleva **Ver estado de cuenta**, que abre la cuenta de esa tienda en su propia página. Al
volver, la fila ya dice el saldo nuevo si registraste o anulaste algo allá.

## El estado de cuenta de una tienda

Es el extracto de la tienda con Ordenex, como el de un banco.

Arriba, la cifra grande es el **saldo actual** con una frase que dice **quién le debe a quién**:
«Ordenex le debe ₡12.000 a Tania Tienda» o «Tania Tienda le debe ₡3.000 a Ordenex». Debajo, cuatro
cifras del periodo: **Saldo inicial**, **Abonos del periodo** (lo que suma a favor de la tienda),
**Cargos del periodo** (lo que resta) y **Saldo al final del periodo**. Siempre se cumple: saldo inicial
más abonos menos cargos es el saldo final. Los movimientos anulados y su anulación **no cuentan** en
abonos ni cargos: se cancelan entre ellos.

La tabla es el **extracto**, del más antiguo al más reciente:

- La primera fila es el **saldo inicial** del periodo: lo que la tienda tenía al terminar el día anterior.
- Cada movimiento dice su fecha, su concepto (desde Ordenex), el motivo, de dónde viene, si tiene
  comprobante y **quién lo registró** («Registró: Ana Admin», o «Automático · Aprobación del cierre por
  Ana Admin»), el **cargo** o el **abono**, y el **saldo** de la tienda justo después de ese movimiento.
- El saldo de la última fila es el de la tarjeta y el de la fila de la tabla de saldos.

### Filtrar el estado de cuenta

- Los **chips** de arriba: **Todo · Cierres · Pagos · Cobros · Correcciones**. Cada movimiento cae en
  uno solo. El saldo de cada fila **sigue siendo el de la cuenta entera**, aunque filtres: por eso no
  baja de a poco como si los otros movimientos no existieran.
- **Desde** y **Hasta**: días completos de Costa Rica. Con un periodo, la primera fila es el saldo
  con el que la tienda empezó ese periodo.
- Por **cierre** todavía no se puede filtrar el estado de cuenta: los movimientos que vienen de un
  cierre están en el chip **Cierres**, con su día.

### Anulados

Un movimiento anulado **no desaparece**: sigue en su lugar, tachado, y dice **quién lo anuló, cuándo y
por qué** («Anulado el 2026-09-20 por Ana Admin · Se pagó dos veces»). Si se anuló antes de que la
wallet guardara el motivo, dice **«motivo no registrado»**. Su anulación aparece como otra fila, con la
marca **Anulación**.

### Ver un movimiento

**Ver**, en cada fila, abre su detalle a un costado: a quién, por qué, de dónde viene, el comprobante (si
tiene, se abre con **Ver comprobante**), quién lo registró, si está vigente o anulado y **Cómo quedó** la
caja y la tienda después de ese movimiento. Desde ahí se **anula** con **Anular…** y un motivo, cuando el
movimiento lo admite (lo que produce la aprobación de un cierre no se anula desde acá).

### Descargar

La descarga trae **el periodo entero** que estás mirando (no solo la página), con el saldo inicial
arriba y el **saldo** de cada fila, en las mismas columnas que la tabla. No lleva ningún identificador.

## Registrar desde el estado de cuenta

Tres acciones, cada una abre el mismo **Registrar un movimiento** de la caja con el concepto y la tienda
ya elegidos:

- **La tienda le paga a Ordenex** — solo cuando la tienda está **en contra**: registra el pago que ella
  le hizo a Ordenex (hasta lo que debe, con fecha, motivo, método y comprobante opcional). Su saldo sube.
- **Ordenex le cobra a la tienda** — siempre: un cobro de Ordenex. Su saldo baja y es ganancia de Ordenex.
- **Ordenex le paga a la tienda** — lo que se le paga de su saldo a favor, hasta lo que Ordenex le debe.
  Si la tienda no tiene saldo a favor, el botón está apagado y lo dice: «Ordenex no le debe nada a…».

Antes de confirmar, **«Así queda»** enseña cómo quedan el saldo de la tienda y la caja. Al registrar,
las tarjetas y el extracto de esa tienda se actualizan solos, sin recargar.

Debajo del extracto está la lista de **Pagos de Ordenex a la tienda**, cada uno con su método, su
referencia y su comprobante. Un pago registrado por error se **anula** desde ahí (con el motivo) o desde
**Ver** en su fila del extracto. Si te dice **«Este pago ya estaba anulado»**, es que alguien se te
adelantó.

## Cómo se llama cada movimiento

| En el estado de cuenta dice | Qué es | ¿Salió dinero de la caja? |
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

**Un pago de un gasto no cuenta como un pago a la tienda**. Y tanto el cobro como el pago de un gasto
pueden dejar el saldo **en contra**: entonces la tienda le debe ese dinero a Ordenex.

Algunos cobros antiguos eran en realidad pagos de un gasto de la tienda. Se corrigieron en la caja,
pero **acá se siguen viendo como «Ordenex le cobra a la tienda»**: el saldo de la tienda ya era correcto.

## Cosas que te pueden pasar

**«No hay tiendas con saldo registrado».** Ninguna tiene movimientos todavía. En una operación nueva
es lo esperable hasta que se apruebe el primer cierre.

**«No se pudo cargar el estado de cuenta».** Fallo al leer esa página del extracto; las tarjetas siguen
en pie. Recargá.

**«Ya estaba anulado; no se registró nada más».** Alguien lo anuló antes que vos. No se hizo nada dos veces.

**Un saldo que no cuadra con lo que la tienda dice.** Casi siempre es tiempo, no error: los movimientos
entran **al aprobarse el cierre del mensajero**, no al entregarse el paquete. Comparen con la misma
fecha de corte: el estado de cuenta con un periodo dice el saldo de ese día exacto.

## Lo que esta pantalla NO hace

- **No es la caja de Ordenex.** Eso es **Wallet · Caja**.
- **No se corrige una entrega desde acá.** Un cargo mal calculado nace de la orden; se arregla allá.
- **No se abren las órdenes de un cierre desde el estado de cuenta.** Las órdenes que componen un cierre
  se ven en **Cierres** (o desde la fila del cierre en el libro de **Wallet · Caja**).
