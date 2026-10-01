// Ficha 465 (design §3.1) — tipos de dominio del Excel de cobertura por distrito.
//
// Modulo de TIPOS: no importa Prisma, React ni nada de `app/`. Y SIN TEXTOS DE UI: los «Sí»/«No»,
// los motivos legibles, «Sin zona» y «Varias zonas: …» se escriben en UN solo sitio del cliente
// (`cobertura-descarga-columnas.ts`, `filaCobertura`). Aqui viajan los hechos.

/**
 * Por que un distrito NO tiene cobertura, en el orden de precedencia de R9 (el mismo en que
 * `resolveGeo` rechaza: provincia -> canton -> distrito -> zona). Solo se informa la PRIMERA.
 */
export type MotivoSinCobertura =
  | "provincia_retirada"
  | "canton_retirado"
  | "distrito_retirado"
  | "sin_zona"
  | "varias_zonas";

/** La zona del distrito cuando tiene EXACTAMENTE una (R11, R12, R14). */
export interface ZonaUnicaCobertura {
  nombre: string;
  /** La zona es la central (GAM, R12). */
  esCentral: boolean;
  /** Existe una tarifa con esa zona y SIN tienda (nivel 3 de la cascada, R14). */
  tieneTarifaGeneral: boolean;
}

/** Fila de dominio: una por distrito del catalogo, disponible o no (R4). */
export interface CoberturaDistritoDTO {
  provincia: string;
  canton: string;
  distrito: string;
  /** Disponibilidad efectiva: provincia, canton y distrito activos los tres (R7). */
  disponible: boolean;
  /** `disponible` Y zona unica (R8). */
  cobertura: boolean;
  /** `null` si y solo si `cobertura` (R9, R10). */
  motivo: MotivoSinCobertura | null;
  /** Nombres de TODAS las zonas del distrito, en orden alfabetico español (R11). */
  zonas: string[];
  /** `null` con 0 o con mas de una zona (R11, R12, R14). */
  zonaUnica: ZonaUnicaCobertura | null;
  /** Tri-valuado: `null` = nadie lo ha decidido (R13). */
  zonaEspecial: boolean | null;
}
