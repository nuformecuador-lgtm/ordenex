---
titulo: Analítica
modulo: analitica
pantalla: /analitica
roles: [maestro, admin, adminTienda, adminSatelite]
actualizado: 2026-09-25
fuentes:
  - app/(app)/analitica/_components/finanzas/cargar-kpis.ts
  - app/(app)/analitica/_components/entregas/ConteoPorStatusDona.tsx
  - components/shared/EstadoInfo.tsx
  - app/(app)/analitica/page.tsx
  - app/(app)/_components/FiltrosEntregas.tsx
  - app/(app)/analitica/_components/operativo/FiltrosOperativos.tsx
  - lib/analytics/presentacion.ts
  - lib/analytics/metrics.ts
---

# Analítica

Los **números del negocio**: entregas, efectividad, dinero y de dónde sale el margen. Es donde se mira
lo que ya pasó, no lo que está pasando ahora.

## Cada quien ve lo suyo

La pantalla es la misma para todos, pero **el alcance cambia con el rol**:

| Rol | Qué ve |
| --- | --- |
| **Maestro / admin** | Todo, y puede desglosar por zona, tienda y mensajero |
| **Tienda** | Solo sus órdenes. Puede desglosar por zona |
| **Bodega satélite** | Solo su zona, sin desglose por tienda ni mensajero |

Si echás en falta un filtro que alguien más tiene, es por esto: no está escondido, es que ese corte no
aplica a tu alcance.

Arriba hay siempre una nota de **alcance de las cifras** que dice sobre qué está calculado lo que ves.

## Los dos bloques

**Entregas.** Lo operativo: cuántas se cargaron, cuántas se entregaron, el **ciclo de vida promedio**
de una orden cerrada, las **causas de devolución**. Se acota por fecha, geografía y —según tu rol— zona,
tienda y mensajero.

**Operativo.** El panel con su propio rango — hoy, la semana, 30 días o personalizado — y su
comparativa por categoría.

Y el bloque **financiero**: qué cobró Ordenex, cómo se compone la ganancia y la conciliación de los
cierres. Sus cifras de dinero son solo para maestro y admin, y la de la caja se llama igual que en
**Wallet · Caja**: **Flujo de dinero registrado** mientras no haya un saldo inicial registrado, o
**Dinero en caja** cuando lo hay.

**Los estados en las gráficas.** En el conteo por estado, cada estado de la leyenda lleva su botón
**(i)**, que explica qué significa. Las órdenes cuentan en el estado que tienen: una orden ya gestionada
sigue contando **En reparto** hasta que se apruebe el cierre del mensajero.

## Dos avisos que vas a ver, y qué significan

**«Cobrado y todavía sin liquidar: no se reparte».** Plata que ya se cobró al cliente pero cuyo cierre
no se aprobó aún. Está contada como cobrada y todavía no repartida entre las partes. No es un error: es
dinero en tránsito.

**«Cobertura incompleta del rango».** Del período que pediste faltan días sin datos calculados. La
cifra es real pero **no cubre todo el rango** — o achicás el período, o la leés sabiendo que le faltan
días.

## Una advertencia sobre comparar

Los filtros de los dos bloques son **independientes**: el rango del bloque operativo no es el mismo que
el de entregas. Antes de comparar dos cifras de distintos bloques, revisá que estén sobre el mismo
período — es el error más fácil de cometer acá.

## Lo que esta pantalla NO hace

- **No es el estado de ahora.** Para el día en curso, **Monitoreo**.
- **No es la contabilidad.** Los saldos y pagos están en **Wallet**.
