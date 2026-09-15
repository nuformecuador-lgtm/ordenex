---
titulo: Cierres
modulo: cierres-admin
pantalla: /cierres-admin
roles: [maestro, admin, adminSatelite]
actualizado: 2026-09-15
fuentes:
  - app/(app)/cierres-admin/_components/CierresAdminModule.tsx
  - app/(app)/cierres-admin/_components/CierresTabs.tsx
  - app/(app)/cierres-admin/_components/CierresBodegaAdminModule.tsx
  - app/(app)/cierres-admin/_components/ConsolidacionBodegaModule.tsx
  - app/(app)/cierres-admin/_components/CascadaDinero.tsx
  - lib/repositories/CierresAdminRepository.ts
---

# Cierres

Acá se **aprueban los cierres** que piden los mensajeros, y es el momento en que su trabajo del día se
convierte en plata registrada.

> **Aprobar un cierre mueve dinero de verdad.** En ese instante se le acredita a cada tienda lo
> recaudado de sus entregas y el efectivo entra a la caja de Ordenex. No es un visto bueno formal.

## Las dos mitades

**Mensajero.** Los cierres que piden los mensajeros, uno por uno. Es la cola de trabajo diaria.

**Bodega.** La consolidación: una satélite junta sus cierres ya aprobados y le pide el cierre a la
central. Si administrás una satélite, acá es donde consolidás y enviás.

## Aprobar o rechazar

Abriendo un cierre ves **todo lo que contiene**: cada entrega, qué pasó, el destinatario, cuánto se
cobró y en qué forma, y la evidencia fotográfica.

**Aprobar** cuando cuadra. **Rechazar** cuando no — y el motivo es obligatorio, porque es lo que el
mensajero va a leer para saber qué arreglar. Un cierre rechazado no es el final: el mensajero lo
corrige y lo vuelve a pedir.

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
- **No se corrige una entrega.** Si una orden entró mal, el mensajero la devuelve a gestión desde su
  **Cierre del día**.
