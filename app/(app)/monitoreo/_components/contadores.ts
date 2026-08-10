// Feature 192 (F5.1/F5.2) — ETIQUETAS VISIBLES de los ocho contadores del tablero del dia.
//
// Viven JUNTO al componente que las pinta (`MensajeroCard`) y no en `lib/`: son texto de
// presentacion, no dominio. El dominio (los buckets y su clasificacion) sigue estando en
// `lib/types/tablero-dia.ts`, que es de donde se DERIVAN las claves de aqui.
//
// R48 — aqui NO hay ningun mapa de estatus -> etiqueta ni ningun color de estatus: el
// vocabulario visual del estatus se importa de `EstatusBadge`/`estatusLabel` del listado de
// ordenes. Lo unico que se declara son las etiquetas de los CONTADORES, que no existen en
// ninguna otra parte del arbol.

import type { GestionResultado } from "@prisma/client";

import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";
import {
  estatusDelBucket,
  type BucketSinResultado,
  type FilaTableroDia,
} from "@/lib/types/tablero-dia";

/**
 * Clave del contador de cada resultado del dia. Se DERIVA del enum `GestionResultado`
 * (`entregada` -> `entregadas`), asi que un sexto valor del enum deja de compilar aqui en
 * vez de quedarse sin etiqueta en silencio (R24/R27).
 */
export type ClaveResultado = `${GestionResultado}s`;

/**
 * Comprobacion tipada de que cada clave derivada del enum ES un contador de la fila: si el
 * contrato de `FilaTableroDia` renombrara uno, esto deja de compilar.
 */
type _ClavesSonContadores = ClaveResultado extends keyof FilaTableroDia ? true : never;
const _clavesSonContadores: _ClavesSonContadores = true;
void _clavesSonContadores;

/** R24 — los cinco resultados del dia. `Record` EXHAUSTIVO: falta una y no compila. */
export const ETIQUETA_RESULTADO = {
  entregadas: "Entregadas",
  reprogramadas: "Reprogramadas",
  devueltas: "Devueltas",
  rechazadas: "Rechazadas",
  incidentes: "Incidentes",
} as const satisfies Record<ClaveResultado, string>;

/** Orden de pintado de los cinco resultados (el del enum, de mejor a peor desenlace). */
export const CLAVES_RESULTADO = [
  "entregadas",
  "reprogramadas",
  "devueltas",
  "rechazadas",
  "incidentes",
] as const satisfies readonly ClaveResultado[];

/**
 * F5.1 — etiquetas de los tres buckets de "sin resultado", derivadas del tipo
 * `BucketSinResultado` con un `Record` EXHAUSTIVO: un bucket nuevo no compila sin etiqueta.
 */
export const ETIQUETA_BUCKET = {
  sinRecoger: "Sin recoger",
  enReparto: "En reparto",
  otros: "Otros",
} as const satisfies Record<BucketSinResultado, string>;

/** Orden de pintado de los tres buckets: del que no arranco al cajon de sastre. */
export const CLAVES_BUCKET = [
  "sinRecoger",
  "enReparto",
  "otros",
] as const satisfies readonly BucketSinResultado[];

/** Que significa cada bucket, en una linea. Se muestra como ayuda del contador. */
const SIGNIFICADO_BUCKET = {
  sinRecoger: "Sin gestión de hoy: el mensajero todavía no arrancó con ellas",
  enReparto: "Sin gestión de hoy: ya las recogió y está en la calle",
  // R45 — `otros` se pinta SIEMPRE, aunque valga 0, y con ayuda: es el bucket que delata
  // que el mapa se quedo corto. Esconderlo haria que un cambio de flujo pasara desapercibido.
  otros: "Sin gestión de hoy y en cualquier otro estatus",
} as const satisfies Record<BucketSinResultado, string>;

/**
 * R45 — ayuda de un bucket: su significado MAS la lista de estatus que contiene, derivada
 * de `estatusDelBucket` (nunca escrita a mano: una lista paralela es justo lo que R46
 * persigue) y traducida con el `estatusLabel` del listado de ordenes (R48).
 */
export function ayudaBucket(bucket: BucketSinResultado): string {
  const estatus = estatusDelBucket(bucket).map(estatusLabel).join(", ");
  return `${SIGNIFICADO_BUCKET[bucket]}. Estatus: ${estatus}.`;
}
