---
titulo: Cierres
modulo: cierres-admin
pantalla: /cierres-admin
roles: [maestro, admin, adminSatelite]
actualizado: 2026-09-25
fuentes:
  - app/(app)/cierres-admin/_components/CierresAdminModule.tsx
  - app/(app)/cierres-admin/_components/CorregirResultadoDialog.tsx
  - app/(app)/cierres-admin/_components/CorregirPagosDialog.tsx
  - app/(app)/cierres-admin/page.tsx
  - lib/services/CierresAdminService.ts
  - lib/repositories/gestion-pendiente.ts
  - components/shared/EstadoInfo.tsx
  - app/(app)/cierres-admin/_components/CierresTabs.tsx
  - app/(app)/cierres-admin/_components/CierresBodegaAdminModule.tsx
  - app/(app)/cierres-admin/_components/ConsolidacionBodegaModule.tsx
  - app/(app)/cierres-admin/_components/CascadaDinero.tsx
  - lib/repositories/CierresAdminRepository.ts
---

# Cierres

Acá se **aprueban los cierres** que piden los mensajeros, y es el momento en que su trabajo del día se
convierte en plata registrada.

> **Aprobar un cierre mueve dinero de verdad y confirma el estado de las órdenes.** En ese instante se
> le acredita a cada tienda lo recaudado de sus entregas, el efectivo entra a la caja de Ordenex y cada
> orden gestionada pasa a su estado real. No es un visto bueno formal.

## Por qué las órdenes siguen «En reparto» hasta que aprobás

Cuando el mensajero gestiona una orden, **la orden no cambia de estado**: sigue **En reparto**, con una
nota que dice el resultado y que falta confirmarlo, por ejemplo **«Entregado · pendiente de
confirmación»**. La tienda, el rastreo del cliente y la oficina ven esa nota al instante.

**El estado real se aplica al aprobar el cierre**, en la misma operación que el dinero: Entregado,
Reprogramado, Novedad, Devolución a origen por rechazo o Incidente. Si aprobar falla, no queda nada a
medias: ni dinero ni estados.

- **Si rechazás un cierre**, ninguna orden cambia de estado. Siguen en reparto con su gestión pendiente
  hasta que el mensajero lo vuelva a solicitar y se apruebe.
- Mientras una orden tiene una gestión pendiente de confirmación, **no se puede traspasar a otro
  mensajero ni cambiarle el día de reparto**.

## Las dos mitades

**Mensajero.** Los cierres que piden los mensajeros, uno por uno. Es la cola de trabajo diaria.

**Bodega.** La consolidación: una satélite junta sus cierres ya aprobados y le manda el efectivo a la
central. Si administrás una satélite, acá es donde consolidás y enviás.

> **Esta mitad ya no se aprueba: se concilia.** Antes la central tenía que aprobar, y mientras tanto la
> bodega no podía asignar trabajo nuevo. Ahora la satélite cierra sola y la central **marca si el
> efectivo llegó**, en **Wallet · Satélites**. Es seguimiento, no permiso.

## Aprobar o rechazar

Abriendo un cierre ves **todo lo que contiene**: cada entrega, qué pasó, el destinatario, cuánto se
cobró y en qué forma, y la evidencia fotográfica.

**Aprobar** cuando cuadra. **Rechazar** cuando no — y el motivo es obligatorio, porque es lo que el
mensajero va a leer para saber qué arreglar. Un cierre rechazado no es el final: el mensajero lo
corrige y lo vuelve a pedir.

Cada resultado del detalle lleva su **botón de información (i)**, que explica qué significa ese
estado.

## Corregir antes de aprobar

Con el cierre todavía abierto, el **maestro** y el **admin** tienen dos correcciones:

- **Corregir el resultado**: una entrega que en realidad fue un rechazo pasa a rechazo. El cobro de esa
  entrega desaparece del cierre, el pago al mensajero por ella pasa a cero y los totales se recalculan.
  El motivo es obligatorio y queda registrado quién corrigió y cuándo. **La orden sigue En reparto**
  hasta que apruebes; al aprobar, pasa a **Devolución a origen por rechazo**.
- **Corregir métodos de pago**: reparte el total recibido entre efectivo, SINPE y transferencia. El
  total no cambia.

La corrección queda en la línea de tiempo de la orden como **Gestión corregida**.

## Cierres vencidos

Un cierre **vencido** es uno que se pasó de su día sin resolverse. Frena al mensajero: mientras lo
tenga, no puede seguir trabajando normalmente.

**Destrabar cierre vencido** es la salida para cuando el mensajero no está disponible para corregirlo
él mismo — se enfermó, ya no trabaja, está fuera de cobertura. Es una **excepción**, no el camino
normal: destrabás y después aprobás.

## La cascada del dinero

En el detalle de un cierre de bodega se ve **cómo se reparte lo recaudado**: qué le toca a la central,
qué queda en la bodega satélite. Son cifras derivadas para entender el reparto, no movimientos nuevos
de caja.

## Buscar

Se filtra por **fecha de solicitud**, **bodega**, **mensajero** y **estado**. Un cierre no se busca
escribiendo — se llega a él por su fecha y su mensajero, así que el campo de texto no aplica acá.

## Lo que esta pantalla NO hace

- **No se paga desde acá.** Aprobar acredita; pagar es **Wallet · Tiendas** y **Wallet · Mensajeros**.
- **No se deshace la gestión de un mensajero.** Si una orden entró mal y el mensajero todavía no pidió
  el cierre, la devuelve a gestión él mismo desde su **Cierre del día**. Desde acá solo se corrige una
  entrega a rechazo, o los métodos de pago.
