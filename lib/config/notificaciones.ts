// Feature 146 (A2, design §10 F1.4-6/F1.4-8) — constantes de la campana de
// notificaciones. Viven aqui para que NO haya literales magicos ni en el service
// ni en el componente (docs/architecture.md: "Sin hardcode de contexto"), patron de
// lib/config/aprobacion-postulaciones.ts.

export interface NotificacionesConfig {
  /** Maximo de elementos que devuelve el listado (F1.4-8). Sin paginacion en v1. */
  PAGE_SIZE: number;
  /** Intervalo de polling de SWR en milisegundos (D3 / F1.4-8). */
  REFRESH_INTERVAL_MS: number;
  /** Ventana de consulta en dias (F1.4-6). No hay purga: acota la CONSULTA, no la tabla. */
  VENTANA_DIAS: number;
}

export const notificacionesConfig: NotificacionesConfig = {
  PAGE_SIZE: 50,
  REFRESH_INTERVAL_MS: 60_000,
  VENTANA_DIAS: 30,
};
