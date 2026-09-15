---
titulo: Configuración · Vehículos
modulo: configuracion
pantalla: /configuracion/vehiculos
roles: [maestro, admin]
actualizado: 2026-09-15
fuentes:
  - app/(app)/configuracion/vehiculos/page.tsx
  - app/(app)/configuracion/vehiculos/_components/
---

# Configuración · Vehículos

El **catálogo de tipos de vehículo** con los que se reparte: moto, carro, camión y los que hagan falta.

Es una pantalla corta pero conectada: el tipo de vehículo entra en el cálculo del cobro.

## Qué podés hacer

**Crear, editar y eliminar** tipos de vehículo. Cada uno lleva su nombre y no admite quedarse vacío.

## Antes de eliminar uno

Si hay mensajeros con ese tipo asignado o tarifas que lo usan, eliminarlo deja esas referencias
huérfanas. Conviene revisar primero quién lo usa: es un catálogo pequeño y el repaso cuesta poco.

## Cosas que te pueden pasar

**«El vehículo no existe».** Alguien lo eliminó mientras lo tenías abierto. Recargá.

**«Este campo es obligatorio».** Falta el nombre.

**«No se pudo completar la acción».** Falló el guardado; volvé a intentarlo. Si insiste, puede que el
vehículo esté en uso.

## Dónde se nota

En **Configuración · Tarifas**, en el **cobro por vehículo** — lo que se cobra puede variar según con
qué se entregue. Un tipo mal definido acá se traduce en un cobro mal calculado allá.

## Lo que esta pantalla NO hace

- **No asigna vehículos a mensajeros.** Acá se definen los tipos; asignarlos es la gestión de usuarios.
- **No define cuánto cuesta cada uno.** El precio es **Configuración · Tarifas**.
