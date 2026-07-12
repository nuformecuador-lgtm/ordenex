import type { CierreDestinoTipo, CierreEstado } from "@/lib/types/cierre";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";

// Feature 38 — contrato del repositorio de "Cierres del dia" del admin. Solo queries
// Prisma; sin logica de negocio (esa vive en CierresAdminService). El ALCANCE
// (rol+zona destino) SIEMPRE va en el WHERE (R2/R13), nunca filtrado en memoria.
// Money-safe: los Decimal se devuelven ya serializados a STRING.

// Alcance de un admin: tipo de bodega destino + (opcional) su zona. El maestro no se
// acota por zona (destinoZonaId = null); el adminSatelite si (su zona).
export interface Alcance {
  destinoTipo: CierreDestinoTipo;
  destinoZonaId: string | null;
}

// Fila cruda de un cierre dentro del alcance (cabecera). Totales ya como STRING
// (money-safe); `resueltoAt`/`motivoRechazo` null mientras `solicitado`.
export interface CierreAdminResumenRow {
  cierreId: string;
  mensajeroId: string;
  mensajeroNombre: string;
  estado: CierreEstado;
  destinoTipo: CierreDestinoTipo;
  destinoZonaId: string;
  destinoZonaNombre: string;
  totales: {
    efectivo: string;
    simpe: string;
    transferencia: string;
    general: string;
  };
  solicitadoAt: string; // ISO
  resueltoAt: string | null; // ISO
  motivoRechazo: string | null;
}

// Datos de la transicion guardada (aprobar/rechazar). `motivoRechazo` = null al
// aprobar; el motivo (ya validado) al rechazar.
export interface ResolverCierreInput {
  cierreId: string;
  alcance: Alcance;
  nuevoEstado: "aprobado" | "rechazado";
  resueltoPor: string;
  motivoRechazo: string | null;
}

// Resultado de la transicion guardada: `updated` (aplicada), `conflict` (existe en
// alcance pero ya no esta `solicitado`, R12), `fuera_de_alcance` (no existe o de otra
// bodega/zona, R13).
export type ResolverCierreResult = "updated" | "conflict" | "fuera_de_alcance";

export interface ICierresAdminRepository {
  /**
   * R2/R4/R5/R8/R9: cierres del alcance (WHERE destino_tipo + destino_zona_id si !=
   * null), join a usuario/zona para nombres, orderBy solicitadoAt desc. Totales
   * snapshot -> STRING. Usa el indice [destinoTipo, destinoZonaId].
   */
  findCierresByAlcance(alcance: Alcance): Promise<CierreAdminResumenRow[]>;
  /**
   * R6/R7/R9/R13: un cierre SOLO si su destino casa el alcance en el WHERE (guardia
   * R13) + sus gestiones (WITH_DETALLE, reuso 37, WHERE cierre_id = X). Fuera de
   * alcance / inexistente -> null (no se distingue).
   */
  findCierreByIdEnAlcance(
    cierreId: string,
    alcance: Alcance,
  ): Promise<{ cierre: CierreAdminResumenRow; gestiones: CierreGestionPendienteRow[] } | null>;
  /**
   * R10-R15: transicion atomica y guardada de `solicitado` -> nuevoEstado, SOLO si
   * el cierre sigue `solicitado` y casa el alcance (updateMany con guardia). NO toca
   * gestion_orden ni otra tabla (R15). Distingue updated/conflict/fuera_de_alcance.
   */
  resolverCierre(input: ResolverCierreInput): Promise<ResolverCierreResult>;
}
