---
titulo: Wallet · Caja
modulo: wallet
pantalla: /wallet
roles: [maestro, admin]
actualizado: 2026-09-15
fuentes:
  - app/(app)/wallet/_components/WalletModule.tsx
  - app/(app)/wallet/_components/CajaResumenCard.tsx
  - app/(app)/wallet/_components/ComposicionGananciaCard.tsx
  - app/(app)/wallet/_components/WalletLedger.tsx
  - app/(app)/wallet/_components/RegistrarMovimientoCajaDialog.tsx
  - app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx
---

# Wallet · Caja

**La caja de Ordenex**: todo lo que entra y todo lo que sale. Es la pantalla del dinero de la empresa,
no del de las tiendas ni del de los mensajeros —esos tienen la suya—.

## Qué vas a ver

**El resumen de caja**, arriba: cómo está el saldo y de qué se compone.

**Cómo se compone la ganancia**, desglosada por concepto, para ver de dónde sale de verdad el margen —
fletes, comisiones, IVA— y no solo el total.

**El desglose de egresos**, del otro lado.

**El ledger**: la lista de movimientos, uno por línea, con su concepto, su categoría y de dónde viene.

## De dónde entra la plata sola

La mayoría de los movimientos **no los teclea nadie**: entran cuando se aprueba el cierre de un
mensajero. En ese momento se registra lo recaudado, los fletes, las comisiones y lo que se le paga al
mensajero, todo de una vez.

Por eso la caja va al ritmo de los cierres, no de las entregas: una entrega de hoy aparece cuando su
cierre se apruebe.

## Lo que sí se registra a mano

**Registrar un movimiento de caja** sirve para lo que no nace de una entrega: sueldos, gastos
variables, aportes, ajustes. Elegís el concepto y lo anotás.

**Gastos fijos.** En vez de teclear el mismo gasto cada mes, se define una plantilla con **cada cuánto
se cobra**, y se puede **activar o desactivar** sin borrarla. Los que quedan pendientes de cobrar
aparecen en su propio panel.

**Cobros de rechazos de tienda** tienen también su panel de pendientes.

## Buscar

Filtros por **concepto** y **categoría**, más el buscador. Y se puede **descargar** el ledger para
cuadrar fuera.

## Lo que esta pantalla NO hace

- **No muestra lo que le debés a cada tienda.** Eso es **Wallet · Tiendas**.
- **No muestra lo que le debés a cada mensajero.** Eso es **Wallet · Mensajeros**.
- **No se corrigen cifras de entregas.** Un movimiento que nació de un cierre se arregla en el cierre,
  no acá.
