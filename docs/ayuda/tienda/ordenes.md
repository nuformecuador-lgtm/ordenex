---
titulo: Órdenes
modulo: ordenes
pantalla: /ordenes
roles: [adminTienda]
actualizado: 2026-09-15
fuentes:
  - app/(app)/ordenes/page.tsx
  - app/(app)/ordenes/exclude-por-rol.ts
  - app/(app)/ordenes/_components/OrdenesListado.tsx
  - app/(app)/ordenes/_components/ordenes-filtros-def.ts
  - lib/services/alcance-borrado-orden.ts
---

# Órdenes

Es tu pantalla principal: acá están **todas tus órdenes**, en qué estado va cada una y desde acá las
creás y las gestionás.

Solo ves las tuyas. No hace falta que filtres por tienda — la pantalla ya viene acotada a tu cuenta.

## Crear órdenes

**Carga masiva.** Subís un archivo con muchas órdenes de una vez en lugar de meterlas una por una. Si
alguna fila viene con un problema, la app te lo dice fila por fila y podés descargar los errores para
corregirlos y volver a subir.

**Escanear el QR de la etiqueta** te lleva directo a esa orden, sin buscarla.

## Buscar y filtrar

El buscador cubre **cinco datos a la vez**: guía, remisión, teléfono, destinatario o producto. No
tenés que elegir cuál — escribís y busca en todos.

Con el botón **Filtros** agregás los que necesités: estado, zona, provincia, cantón, distrito y fecha
de creación. Los que pongas se quedan puestos mientras trabajás, y **Limpiar todo** los quita junto con
la búsqueda.

También podés **ordenar** la tabla por fecha de creación o por número de remisión, y en los dos
sentidos.

## Lo que podés hacer con una orden

- **Ver el historial completo**: todo lo que le pasó, con fecha y quién lo hizo.
- **Generar la guía** y **la etiqueta** para imprimir.
- **Eliminar una orden tuya**, si te equivocaste al crearla.

> **Ojo con eliminar:** al borrarla desaparece también del listado del mensajero asignado. Si ya iba en
> camino, hablalo antes con la oficina. Y una vez borrada **no la podés recuperar vos** — eso solo lo
> hace la oficina.

## Corregir datos de una orden

Las correcciones —destinatario, teléfono, producto, notas— **no se hacen desde acá**: se hacen desde
**Novedades**, sobre las órdenes que lo necesitan. Es a propósito, para que la corrección vaya junto al
problema que la motivó.

## Estados que no vas a ver

Tu listado no muestra los estados internos de bodega —lo que pasa entre bodegas mientras el paquete
viaja— porque no son cosas sobre las que puedas actuar. Ves el recorrido de tu paquete, no la
logística interna.

## Lo que esta pantalla NO hace

- **No se asignan mensajeros acá.** Eso lo hace la oficina.
- **No se ve plata.** Tu saldo y tus movimientos están en **Mi wallet**.
- **No se corrigen datos.** Eso es **Novedades**.
