import type { MensajeroDocumentoTipo } from "@prisma/client";

// Feature 21 — contrato de acceso a datos de los documentos del mensajero.

/** Documento a persistir junto al usuario (R16). */
export interface MensajeroDocumentoInput {
  tipo: MensajeroDocumentoTipo;
  storagePath: string;
  contentType: string;
}

/** Documento proyectado para lectura (R17: perfil resuelve foto_rostro). */
export interface MensajeroDocumentoDTO {
  id: string;
  usuarioId: string;
  tipo: MensajeroDocumentoTipo;
  storagePath: string;
  contentType: string;
}

export interface IMensajeroDocumentoRepository {
  /** Documentos de un usuario, ordenados por tipo (R16/R17). */
  findByUsuario(usuarioId: string): Promise<MensajeroDocumentoDTO[]>;
}
