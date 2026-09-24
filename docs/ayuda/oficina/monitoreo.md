---
titulo: Monitoreo
modulo: monitoreo
pantalla: /monitoreo
roles: [maestro, admin, adminSatelite]
actualizado: 2026-09-24
fuentes:
  - app/(app)/monitoreo/_components/TableroDiaModule.tsx
  - app/(app)/monitoreo/_components/TableroDiaControles.tsx
  - app/(app)/monitoreo/_components/filtrar-mensajeros.ts
---

# Monitoreo

El **tablero del día en curso**: cómo va cada mensajero ahora mismo. Es la pantalla para mirar de un
vistazo si el día va bien o si alguien se está quedando atrás.

Si sos administrador de una satélite, ves los mensajeros de tu zona.

## Qué muestra

Una tarjeta por mensajero con sus cifras del día: cuántas gestiones terminaron en cada resultado
—**Entregado**, **Reprogramado**, **Novedad**, **Devolución a origen por rechazo**, **Incidente**— y cómo
se reparte lo que todavía no tiene gestión: **Todavía no sale a reparto**, **En reparto** y **Otros
estados**.

Arriba tenés la **composición del día** — el total sumado de todos —, y cuando filtrás, la
**composición de lo filtrado**, para comparar una parte contra el conjunto.

## Buscar y ver el detalle

El campo de búsqueda **filtra por nombre de mensajero**. Es solo para encontrar rápido: no cambia los
datos ni se guarda.

Tocando una tarjeta se abre el **detalle de ese mensajero**, con sus órdenes del día.

## Densidad

El conmutador **Cómoda / Compacta** cambia cuántas tarjetas te entran en pantalla. Con muchos
mensajeros, compacta te deja verlos todos sin desplazarte. **No filtra nada** — solo cambia el tamaño.

## Sobre la antigüedad del dato

Cada tarjeta dice **hace cuánto se actualizó**. Si dice *«Antigüedad del dato desconocida»*, es que no
se pudo determinar cuándo se calculó — mirá la cifra con reserva y recargá.

Es un tablero, no un sistema en vivo: los números son de la última lectura, no del segundo exacto.

## Lo que esta pantalla NO hace

- **No se asigna trabajo acá.** Esto es para mirar. Asignar es en **Órdenes** o en la bodega.
- **No guarda lo que filtrás.** Ni la búsqueda ni la densidad quedan en el enlace: si se lo pasás a
  alguien, lo va a ver sin filtros.
- **No es histórico.** Es el día en curso. Lo pasado está en **Analítica**.
