---
titulo: Histórico · Acciones
modulo: historico
pantalla: /historico/acciones
roles: [maestro]
actualizado: 2026-09-15
fuentes:
  - app/(app)/historico/acciones/_components/HistorialAccionesModule.tsx
  - app/(app)/historico/acciones/_components/historial-acciones-filtros-def.ts
  - lib/auth/menu-visibility.ts
---

# Histórico · Acciones

El **registro de todo lo que se hizo en el sistema**: quién hizo qué, sobre qué, y cuándo. Es la
pantalla a la que se viene cuando hay que reconstruir qué pasó.

**Solo la ve el maestro.** Es deliberado: es el registro que permite auditar a todos los demás,
incluidos los administradores.

## Qué hay dentro

Cada línea es una acción: la **acción** concreta, **quién** la hizo, **sobre qué** (la entidad), su
**categoría** y **cuándo**.

## Encontrar lo que buscás

El buscador recorre el registro. Y con **Filtros** acotás por:

- **Categoría** — el tipo general de acción. Es el filtro más rápido para reducir el ruido.
- **Acción** — la acción concreta, de una lista larga; el desplegable tiene su propio buscador.
- **Persona** — quién la hizo.
- **Tipo** — sobre qué clase de cosa se actuó.
- **Fecha** — con atajos de últimos 7, 15, 30 o 90 días.

Los filtros se combinan: acotan a la vez, no uno u otro.

## Cómo se usa de verdad

Casi siempre se llega acá con una pregunta concreta — *«¿quién borró esta orden?»*, *«¿cuándo se cambió
esto?»*. La vía más corta suele ser **empezar por la persona o por la fecha**, y afinar desde ahí con
la categoría. Filtrar primero por acción, cuando hay decenas, suele costar más.

## Lo que esta pantalla NO hace

- **No se deshace nada desde acá.** Es un registro de lectura: cuenta lo que pasó, no lo revierte.
- **No incluye las conversaciones.** Los mensajes con clientes están en **Histórico · Conversaciones**.
