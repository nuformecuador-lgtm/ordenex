---
titulo: Órdenes
modulo: ordenes
pantalla: /ordenes
roles: [maestro, admin]
actualizado: 2026-09-15
fuentes:
  - app/(app)/ordenes/page.tsx
  - app/(app)/ordenes/_components/OrdenesListado.tsx
  - app/(app)/ordenes/_components/ordenes-filtros-def.ts
  - app/(app)/ordenes/exclude-por-rol.ts
  - lib/services/alcance-borrado-orden.ts
---

# Órdenes

**Todas las órdenes del sistema**, de todas las tiendas y todas las zonas. Es la pantalla de despacho:
desde acá se asigna, se rutea y se resuelve lo que se traba.

La tienda ve esta misma pantalla acotada a lo suyo. Vos la ves entera.

## Buscar y filtrar

El buscador cubre **cinco datos a la vez**: guía, remisión, teléfono, destinatario o producto.

Con **Filtros** agregás lo que necesités. Los más útiles para despachar:

- **Reasignables** — las que están en bodega central esperando mensajero. Es la cola de despacho.
- **Salida a reparto** — separa las que ya salieron alguna vez con alguien de las que solo tienen la
  guía generada. Sirve para distinguir «nunca salió» de «volvió».
- **Mensajero**, encadenado a la zona: elegida una zona, solo ofrece sus mensajeros.
- **Estado**, **zona**, **provincia**, **cantón**, **distrito**, **tienda**, **fecha de creación**.

Los filtros se combinan y se quedan puestos mientras trabajás. **Limpiar todo** los quita junto con la
búsqueda.

## Acciones por lote

Seleccionando varias órdenes se pueden **asignar a un mensajero** o **rutear a una bodega satélite** de
una vez. Al asignar se elige el día de reparto — hoy o mañana.

> **Si elegís mañana, el mensajero no va a poder recogerla ni gestionarla hasta ese día.** La va a ver
> marcada en su lista, pero el sistema no lo deja adelantarse. Es a propósito: se puso después de que
> un paquete reservado se entregara antes de tiempo.

## Acciones por orden

**Ver el historial completo**, **reportar un incidente**, **corregir los datos del cliente**, **generar
la guía y la etiqueta**, **cambiar el día de reparto**, **devolver a tienda** y **deshacer una
asignación**.

## Eliminar y recuperar

**Eliminar** retira la orden de los listados de la tienda dueña y del mensajero asignado.

**Ver las eliminadas y recuperarlas es solo del maestro.** El interruptor «Eliminadas» no acota el
listado: lo **sustituye** — pasás a ver exclusivamente las borradas. Por eso está al final de la lista
de filtros, lejos de un clic distraído.

## Lo que esta pantalla NO hace

- **No se aprueban cierres.** Eso es **Cierres**.
- **No se ve el estado del día por mensajero.** Eso es **Monitoreo**.
