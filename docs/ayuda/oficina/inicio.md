---
titulo: Inicio
modulo: dashboard
pantalla: /dashboard
roles: [maestro, admin]
actualizado: 2026-09-15
fuentes:
  - app/(app)/dashboard/page.tsx
  - app/(app)/_components/AdminMaestroDashboard.tsx
---

# Inicio

La pantalla a la que aterrizás al entrar. Hoy tiene una sola función: **las postulaciones que esperan
respuesta**.

## Los dos paneles

**Postulaciones de mensajeros.** Gente que se postuló para trabajar y espera que alguien la revise.

**Postulaciones de vehículos y bodegas.** Lo mismo, para vehículos y bodegas ofrecidas.

Si los dos están vacíos, no hay nada pendiente — y eso es una buena señal, no una pantalla rota.

## Por qué está tan vacía

Antes esta pantalla tenía la barra de filtros y los indicadores del negocio. **Se mudaron a
Analítica** en agosto de 2026, por pedido expreso: tener dos sitios donde mirar las mismas cifras hacía
que se consultaran distintas y no cuadraran entre sí.

Así que Inicio quedó como bandeja de entrada de lo que necesita una decisión, y los números viven en
un solo lugar.

## Lo que esta pantalla NO hace

- **No tiene los indicadores del negocio.** Están en **Analítica**.
- **No es el estado del día.** Eso es **Monitoreo**.
