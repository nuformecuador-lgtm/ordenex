---
titulo: Órdenes
modulo: ordenes
pantalla: /ordenes
roles: [maestro, admin]
actualizado: 2026-09-25
fuentes:
  - app/(app)/ordenes/page.tsx
  - app/(app)/ordenes/_components/OrdenesListado.tsx
  - app/(app)/ordenes/_components/NotaGestionPendiente.tsx
  - app/(app)/ordenes/_components/HistorialOrdenTimeline.tsx
  - components/shared/EstadoInfo.tsx
  - lib/types/order-status.ts
  - app/(app)/ordenes/_components/ordenes-filtros-def.ts
  - app/(app)/ordenes/exclude-por-rol.ts
  - lib/services/alcance-borrado-orden.ts
---

# Órdenes

**Todas las órdenes del sistema**, de todas las tiendas y todas las zonas. Es la pantalla de despacho:
desde acá se asigna, se rutea y se resuelve lo que se traba.

La tienda ve esta misma pantalla acotada a lo suyo. Vos la ves entera.

## El estado de cada orden, y su botón de información

Junto al estado de cada orden hay un botón **(i)** que explica qué significa. Se abre al pasar el
puntero o al tocarlo —en el teléfono, al tocar—, y se cierra al tocar fuera o con Escape. El texto es
el mismo para todos los roles y para el rastreo del cliente. También lo llevan las opciones del filtro
de estado.

**Dos notas que pueden ir al lado de «En reparto».** No son estados: la orden sigue En reparto.

- **«Entregado · pendiente de confirmación»** (o el resultado que sea): el mensajero ya registró la
  gestión y falta que se apruebe su cierre del día. **El estado real se aplica al aprobar el cierre.**
  Mientras tanto, esa orden **no se puede traspasar ni cambiarle el día**: la fila lo avisa con un «!».
- **La nota de ayuda**: el mensajero pidió ayuda a la tienda con esa entrega. La orden sigue en reparto
  hasta que la tienda responda, el mensajero la recupere o se registre su gestión. Sí se puede traspasar.

En la **línea de tiempo** de la orden quedan además los pasos de la gestión: **Gestión registrada**,
**Gestión anulada**, **Gestión corregida**, la solicitud de ayuda y su cierre.

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
