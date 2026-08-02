// Feature 170 — FASE 2 (T I.1, R44) — el CORTE entre la cola de pendientes y el historico.
//
// Tres pantallas parten un mismo conjunto en dos listas y hasta ahora lo hacian con un `if`
// EN MEMORIA, sobre las filas que el repositorio ya habia traido enteras:
//
//   CierresAdminService        `estado === "solicitado" || estado === "vencido"` -> cola
//   CierresBodegaAdminService  `estado === "solicitado"`                          -> cola
//   IncidenteAdminService      `estado === "solicitado"`                          -> cola
//
// Al paginar, ese `if` deja de ser suficiente: la mitad que se pagina necesita el MISMO corte
// escrito como WHERE, y la otra mitad (tanda J) lo necesitara tambien. Dos escrituras del
// mismo criterio en dos capas distintas es exactamente como una fila se cae de un listado sin
// que nadie lo note — y con `vencido`, que es bloqueante y money-critical, «caerse del
// listado» significa que el admin no la ve para resolverla.
//
// De ahi este modulo: el corte se declara UNA vez y las dos capas lo leen. El repositorio
// escribe `notIn` sobre estas mismas constantes, que es el espejo EXACTO del `else` de la
// particion en memoria — no `in: ["aprobado","rechazado"]`, que dejaria fuera cualquier
// estado nuevo del enum en vez de mandarlo al historico como hace hoy la pantalla.
//
// Helper PURO: sin Prisma, sin servicios, sin borde.

import type { CierreEstado } from "@/lib/types/cierre";

/**
 * Feature 38/R4 + feature 41/R20 — la cola de «pendientes de decision» del CIERRE DEL DIA.
 *
 * `vencido` esta aqui y no en el historico porque es RESOLUBLE: lo crea el corte diario para
 * el mensajero que debia cerrar y no solicito, bloquea igual que un `solicitado` y el admin
 * lo resuelve desde la misma cola (con su etiqueta diferenciada).
 */
export const ESTADOS_COLA_CIERRE_DIA = [
  "solicitado",
  "vencido",
] as const satisfies readonly CierreEstado[];

/**
 * Feature 40/R15 + feature 158/R49 — la cola de los CIERRES DE BODEGA y de los INCIDENTES:
 * solo `solicitado`. Los dos reusan el enum `CierreEstado` y los dos parten «solicitado vs.
 * el resto», que es un corte distinto del de arriba y por eso se declara aparte.
 */
export const ESTADOS_COLA_SOLICITADO = ["solicitado"] as const satisfies readonly CierreEstado[];

/** `true` si el cierre del dia esta en la cola de pendientes de decision (feature 38/R4). */
export function esColaCierreDia(estado: CierreEstado): boolean {
  return (ESTADOS_COLA_CIERRE_DIA as readonly CierreEstado[]).includes(estado);
}

/** `true` si el cierre de bodega / incidente esta en su cola de pendientes (feature 40/R15). */
export function esColaSolicitado(estado: CierreEstado): boolean {
  return (ESTADOS_COLA_SOLICITADO as readonly CierreEstado[]).includes(estado);
}
