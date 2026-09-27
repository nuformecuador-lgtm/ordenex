---
titulo: Configuración · Geografía
modulo: configuracion
pantalla: /configuracion/geografia
roles: [maestro, admin]
actualizado: 2026-09-15
fuentes:
  - app/(app)/configuracion/geografia/_components/GeografiaAdminModule.tsx
  - app/(app)/configuracion/_shared/filtrar-arbol-geografico.ts
---

# Configuración · Geografía

El **catálogo de provincias, cantones y distritos** del país. Es la base sobre la que se arman las
zonas, se calculan las tarifas y se filtran casi todas las pantallas.

## Cómo está organizado

Un árbol de tres niveles — **provincia → cantón → distrito** — que se despliega y se contrae. El
buscador acepta cualquiera de los tres niveles y te deja el camino a la vista.

## Qué podés hacer

**Añadir un cantón** dentro de una provincia, o **un distrito** dentro de un cantón, cuando falte
alguno.

**Activar y desactivar** nodos. Un nodo desactivado deja de ofrecerse al crear órdenes y al armar
zonas, pero **las órdenes que ya lo usaban siguen intactas** — no se reescribe el pasado.

## Antes de tocar el catálogo

Esto lo lee media aplicación: los filtros de órdenes, las zonas de tarifas, la asignación de
mensajeros. Desactivar un distrito que se está usando no rompe nada, pero **deja de poder elegirse**, y
quien lo necesite va a reportar que «desapareció».

Añadir es seguro. Desactivar conviene avisarlo.

## Cosas que te pueden pasar

**«Ese nodo ya no está en el catálogo».** Alguien lo cambió mientras lo tenías abierto. Recargá.

**«Este campo es obligatorio».** Falta el nombre. No se admiten nodos sin nombre porque después
aparecen vacíos en todos los desplegables.

## Lo que esta pantalla NO hace

- **No define tarifas.** Acá está la geografía; el precio de cada zona es **Configuración · Tarifas**.
- **No asigna mensajeros a zonas.** Eso es la gestión de usuarios.
