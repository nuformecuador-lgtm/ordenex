// Nombres de los buckets de Supabase Storage. Todos son PRIVADOS: nunca se
// exponen URLs publicas, la lectura siempre pasa por una URL firmada temporal
// (ver `getFile` en lib/storage/getFile.ts).
//
// Los modulos que ya resuelven su bucket por env (lib/config/postulacion.ts,
// lib/config/gestion.ts, lib/config/etiquetas.ts) siguen siendo la fuente de
// verdad para ese bucket concreto; esta constante es el catalogo tipado para
// los flujos que no necesitan override por entorno.

export const BUCKETS = {
  /** Evidencias de gestion de orden (feature 36). */
  GESTION_EVIDENCIAS: "gestion-evidencias",
  /** Documentos de postulacion de mensajero (features 21/22). */
  MENSAJERO_DOCS: "mensajero-docs",
  /** PDF consolidado de etiquetas por lote de carga API (feature 112). */
  ETIQUETAS_GUIA: "etiquetas-guia",
} as const;

/** Union de los nombres validos de bucket. */
export type TBucket = (typeof BUCKETS)[keyof typeof BUCKETS];
