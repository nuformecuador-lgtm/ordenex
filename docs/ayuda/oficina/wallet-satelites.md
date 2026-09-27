---
titulo: Wallet · Satélites
modulo: wallet
pantalla: /wallet/satelites, /wallet/satelites/[zonaId]
roles: [maestro, admin]
actualizado: 2026-09-26
fuentes:
  - app/(app)/wallet/satelites/page.tsx
  - app/(app)/wallet/satelites/_components/SaldosSatelitesTable.tsx
  - app/(app)/wallet/satelites/[zonaId]/page.tsx
  - app/(app)/wallet/satelites/_components/EstadoCuentaSatelite.tsx
  - app/(app)/wallet/satelites/_components/ConciliacionSatelite.tsx
  - components/shared/estado-cuenta/EstadoCuenta.tsx
  - components/shared/estado-cuenta/estado-cuenta-labels.ts
  - lib/services/EstadoCuentaService.ts
  - components/shared/conciliacion/ConciliacionAcciones.tsx
  - components/shared/conciliacion/MarcarRecibidoDialog.tsx
  - lib/utils/conciliacion-satelite.ts
  - lib/repositories/SaldosSatelitesRepository.ts
---

# Wallet · Satélites

**Dónde está el efectivo que las bodegas todavía no te han entregado.** Cada satélite consolida lo que
recaudaron sus mensajeros y te lo manda; esta pantalla lleva la cuenta de qué llegó y qué no.

> **El saldo NO es un movimiento de caja.** Esa plata **ya entró** a la caja de Ordenex cuando se
> aprobó el cierre de cada mensajero. Lo que esta pantalla dice es **dónde está físicamente**: cuánto
> queda en manos de cada bodega esperando llegar a la central.
>
> No lo sumes a la caja. Ya está contado.

## Las tres cifras de arriba

**Pendiente de conciliar** — el efectivo consolidado que todavía no marcaste como recibido, con cuántas
consolidaciones y de cuántas bodegas.

**Recibido este mes** — lo que sí llegó.

**Con diferencia** — cuando alguna bodega declaró una cantidad y llegó otra.

## Por qué la cifra es solo el EFECTIVO

Un consolidado incluye efectivo, SINPE y transferencias. **Solo el efectivo viaja en el bulto**: el
SINPE y las transferencias llegan solas a la cuenta.

No es un detalle menor. Medido en producción: de ₡4.196.897 consolidados, **₡1.105.790 eran SINPE** —
un 26%. Si el saldo contara el total, esta pantalla te enseñaría más de un millón de deuda que nadie
te va a entregar en mano.

El total consolidado sigue a la vista como contexto, pero **lo que está pendiente de llegar es el
efectivo**.

## La tabla

Una fila por bodega: **Pendiente**, **Más antigua sin conciliar** (cuánto lleva esperando) y **Última
recibida**. Con el conmutador **Con pendiente / Todas** te quedás solo con las que deben algo. Cada
fila lleva **Ver estado de cuenta**.

## El estado de cuenta de una bodega

Es la cuenta de la bodega con la central, como un extracto. Arriba, lo que **tiene por entregar hoy**
con una frase («FGAM Puntarenas tiene ₡115.000 por entregar»), y las cifras del periodo: **Por entregar
al inicio**, **Declarado en el periodo**, **Recibido en el periodo** y **Por entregar al final del
periodo**.

El extracto, del más antiguo al más reciente, tiene dos clases de filas: **Consolidación declarada**
(lo que la bodega consolidó, en efectivo) y **Recibido en la central** (lo que marcaste que llegó), y
después de cada una **lo que la bodega tiene por entregar** en ese momento. Se filtra con los chips
**Todo · Declarado · Recibido** y con **Desde** / **Hasta**, y se puede **descargar** el periodo entero.

## Marcar que llegó

Debajo del estado de cuenta de la bodega están sus consolidaciones:

| Estado | Qué significa |
| --- | --- |
| **Pendiente de conciliar** | La bodega lo envió; todavía no confirmaste que llegó |
| **Recibido** | Llegó completo |
| **Recibido incompleto** | Llegó, pero por menos de lo declarado |

**Marcar recibido** abre un diálogo con el monto ya puesto —el efectivo que la bodega declaró—.
Si contaste lo mismo, confirmás y listo. **Si contaste otra cosa, cambiás el número**: la diferencia
queda anotada y sigue contando como pendiente de esa bodega. Al marcar, el estado de cuenta de esa
bodega y su fila de la tabla se actualizan solos.

## Desmarcar no mueve dinero

La marca es informativa: dice si el efectivo llegó, **no lo contabiliza**. Por eso se puede deshacer si
alguien marcó por error — y queda registrado **quién marcó y quién deshizo**.

## Qué ve la bodega

La satélite **ve su propia marca y su diferencia** donde ya mira, pero **no puede marcar ni desmarcar**.
Es a propósito: si recibiste menos de lo declarado, la bodega tiene que enterarse ahí mismo y no
semanas después cuando alguien se lo reclame.

## Un cambio que conviene saber

Antes, mientras la central no aprobaba el cierre de una bodega, **esa bodega no podía asignar trabajo
nuevo**. Eso se quitó: ahora la satélite cierra sola y esta pantalla es de **seguimiento**, no de
permiso. Nadie se queda parado esperando una firma.

A cambio, **nada obliga a la bodega a cuadrar** salvo que alguien mire. Por eso la tabla enseña cuánto
lleva esperando la consolidación más antigua: esa columna es el sustituto del freno.

## Lo que esta pantalla NO hace

- **No mueve dinero.** Marcar o desmarcar no crea ningún movimiento de caja.
- **No es la caja de Ordenex.** Eso es **Wallet · Caja**.
- **No aprueba cierres.** Los cierres de mensajero se aprueban en **Cierres**.
