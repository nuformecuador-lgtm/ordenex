import type { PremioRankingDTO } from "@/lib/types/ranking";

// Feature 76 (design §4.3) — contrato del repositorio de PREMIOS del ranking. SOLO queries
// Prisma; sin logica de negocio. Money-safe (R12): el `monto` sale como STRING|null en el DTO
// y entra como STRING|null en `upsertMonto`. Las 3 filas (posicion 1,2,3) las siembra la
// migracion; este repo nunca las crea/borra, solo lee y actualiza el monto.

/** Campos editables de un premio (monto + descripcion, independientes entre si). */
export interface UpsertPremioInput {
  monto: string | null; // STRING valido -> guardado; null -> "sin premio" (R9)
  descripcion: string | null; // rotulo libre; null -> sin descripcion
}

export interface IPremioRankingRepository {
  /** R8: las 3 posiciones del podio ordenadas por `posicion` asc. Monto/descripcion STRING|null. */
  listar(): Promise<PremioRankingDTO[]>;
  /**
   * R10: fija monto Y descripcion de una posicion (ambos independientes; STRING valido ->
   * guardado; null -> "sin premio"/"sin descripcion"). Devuelve el DTO actualizado.
   */
  upsertPremio(posicion: 1 | 2 | 3, input: UpsertPremioInput): Promise<PremioRankingDTO>;
}
