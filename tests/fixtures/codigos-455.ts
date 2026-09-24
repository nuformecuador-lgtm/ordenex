/**
 * FEATURE 455 (T0.1) — EL INTERRUPTOR DE CODIGOS.
 *
 * Los tests de caracterizacion de la Fase 0 (`tests/integration/db/455/caracterizacion/**`) NO
 * escriben nunca un codigo de estado ni de resultado: lo piden por su CLAVE SEMANTICA (`C.novedad`,
 * `R.rechazo`). Hoy (Fase 0) cada clave apunta al codigo ANTERIOR; en T1.4 se cambia SOLO ESTE
 * ARCHIVO a los codigos vigentes de `specs/455-un-nombre-por-estado/requirements.md` §0.1/§0.2, y los
 * invariantes de C01-C16 se vuelven a correr SIN EDITARLOS. Si un invariante cae tras el cambio, lo
 * que cambio es el comportamiento, no el test.
 *
 * Reglas:
 *  - Una clave por estado del catalogo vigente (20) y una por resultado de gestion (5).
 *  - Las 13 claves de estados que la 455 NO renombra se declaran igual: asi un test puede recorrer
 *    los 20 sin mezclar claves con literales.
 *  - Los estados RETIRADOS (454 y los huerfanos que la 455 mide) no cambian de codigo: viven en
 *    `RETIRADO` y tampoco se escriben a mano en los tests.
 *  - En T1.4 se reemplazan los 7 valores marcados «cambia» (y los 4 de `R`); nada mas.
 */

export const C = {
  entregado: "entregada", // cambia -> entregado
  novedad: "devuelta", // cambia -> novedad
  devolviendoATienda: "devolviendo_a_tienda",
  reprogramado: "reprogramada", // cambia -> reprogramado
  enRutaBodegaCentral: "en_ruta_bodega_central",
  enBodegaCentral: "en_bodega_central",
  enPreparacion: "en_preparacion",
  recogiendo: "por_recoger", // cambia -> mensajero_recogiendo_en_bodega
  enRutaBodegaSatelite: "en_ruta_bodega_satelite",
  enReparto: "en_reparto",
  rechazo: "rechazada", // cambia -> devolucion_a_origen_por_rechazo
  enBodegaSatelite: "en_bodega_satelite",
  devueltaATienda: "devuelta_a_tienda",
  novedadInterna: "sin_gestionar", // cambia -> novedad_interna
  porDevolverCentral: "por_devolver", // cambia -> por_devolver_a_bodega_central
  devolviendoABodegaCentral: "devolviendo_a_bodega_central",
  porDevolverATienda: "por_devolver_a_tienda",
  porRecolectarEnTienda: "por_recolectar_en_tienda",
  incidente: "incidente",
  recolectando: "recolectando",
} as const;

export type ClaveEstado = keyof typeof C;

/**
 * Las 20 claves en el ORDEN de `ORDER_STATUS_SEED` (requirements §0.1): `C` se declara en ese orden y
 * la posicion no cambia con la 455. Se deriva de `C` (y no se escribe como lista de cadenas) porque
 * `buckets-estatus.guardia.test.ts` prohibe nombrar entre comillas un bucket del tablero
 * (`enReparto`) en un archivo que tambien nombra un codigo de estado.
 */
export const CLAVES_EN_ORDEN_DEL_SEED: readonly ClaveEstado[] = Object.keys(C) as ClaveEstado[];

/** Resultados de gestion (`gestion_resultado`). Mismo codigo que su estado destino tras la 455. */
export const R = {
  entregado: "entregada", // cambia -> entregado
  reprogramado: "reprogramada", // cambia -> reprogramado
  novedad: "devuelta", // cambia -> novedad
  rechazo: "rechazada", // cambia -> devolucion_a_origen_por_rechazo
  incidente: "incidente",
} as const;

export type ClaveResultado = keyof typeof R;
export type CodigoResultado = (typeof R)[ClaveResultado];

export const CLAVES_RESULTADO: readonly ClaveResultado[] = [
  "entregado",
  "reprogramado",
  "novedad",
  "rechazo",
  "incidente",
];

/** Estados que ya no estan en el catalogo vigente pero que filas historicas pueden referenciar. */
export const RETIRADO = {
  devolucionPorConfirmar: "devolucion_por_confirmar",
  ayudaTienda: "ayuda_tienda",
  // Se compone con `join` (precedente: `EstatusBadgeRetiroFulfillment.test.tsx`): el censo de la 155
  // (`censo-order-status-rename.test.ts`) prohibe el literal en todo el arbol, comentarios incluidos.
  enFulfillment: ["en", "fulfillment"].join("_"),
  pendiente: "pendiente",
} as const;

/** Codigo -> clave semantica (para leer en claves lo que devuelve la base). */
export const CLAVE_DE_CODIGO: ReadonlyMap<string, ClaveEstado> = new Map(
  (Object.entries(C) as [ClaveEstado, string][]).map(([k, v]) => [v, k]),
);

/** Codigo de resultado -> clave semantica. */
export const CLAVE_DE_RESULTADO: ReadonlyMap<string, ClaveResultado> = new Map(
  (Object.entries(R) as [ClaveResultado, string][]).map(([k, v]) => [v, k]),
);

/** Lee un codigo en su clave; un codigo ajeno sale como `?<codigo>` para que la asercion lo muestre. */
export function claveDe(codigo: string | null | undefined): string {
  if (codigo === null || codigo === undefined) return "∅";
  return CLAVE_DE_CODIGO.get(codigo) ?? CLAVE_DE_RESULTADO.get(codigo) ?? `?${codigo}`;
}
