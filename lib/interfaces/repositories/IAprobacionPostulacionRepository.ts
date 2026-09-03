import type { MensajeroDocumentoTipo } from "@prisma/client";
import type { MensajeroDocumentoDTO } from "@/lib/interfaces/repositories/IMensajeroDocumentoRepository";

// Feature 22 — contrato de acceso a datos de la aprobacion de postulaciones.
// Solo Prisma en la implementacion; el servicio queda puro. Reusa el
// MensajeroDocumentoDTO de la feature 21.

/** Proyeccion de una postulacion pendiente para revision (R7/R8). */
export interface PostulacionRow {
  usuarioId: string;
  nombre: string;
  primerApellido: string | null;
  segundoApellido: string | null;
  email: string;
  telefono: string;
  tipoIdentificacion: string; // value del catalogo
  cedula: string;
  vehiculo: string | null; // value del catalogo
  placa: string | null;
  documentos: MensajeroDocumentoDTO[];
}

/** Estado minimo de un mensajero para decidir not_found/conflict (R13/R14). */
export interface MensajeroEstado {
  id: string;
  estado: string;
}

export interface ListarPendientesInput {
  skip: number;
  take: number;
}

export interface ListarPendientesResult {
  items: PostulacionRow[];
  total: number;
}

export type { MensajeroDocumentoTipo };

export interface IAprobacionPostulacionRepository {
  /**
   * R6/R7/R8/R10/R11: usuarios rol `mensajero` estado `pendiente` paginados, con
   * catalogos (tipoIdentificacion/vehiculo) y sus documentos incluidos, mas el
   * total de pendientes.
   */
  listPendientes(input: ListarPendientesInput): Promise<ListarPendientesResult>;
  /**
   * R13/R17: estado del usuario si existe y es `mensajero`; null en otro caso.
   * Solo se usa para distinguir not_found de conflict cuando el update no aplica.
   */
  findMensajeroById(id: string): Promise<MensajeroEstado | null>;
  /**
   * R12/R14/R16/R18: transicion atomica y anti-carrera. Actualiza `estado` solo
   * si el usuario es `mensajero` y sigue `pendiente`. Devuelve el numero de filas
   * afectadas (1 si aplico, 0 si no).
   */
  /** FICHA 362 (R3/R9): `actorUsuarioId` congela QUIEN decidio la postulacion. */
  actualizarEstadoSiPendiente(
    id: string,
    estadoDestino: "activo" | "inactivo",
    actorUsuarioId: string | null,
  ): Promise<number>;
}
