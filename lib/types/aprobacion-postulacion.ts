import { z } from "zod";
import type { MensajeroDocumentoTipo } from "@prisma/client";
import type { ActionError } from "@/lib/types/orden";
import { aprobacionPostulacionesConfig } from "@/lib/config/aprobacion-postulaciones";

// Feature 22 — DTOs, schemas de borde (zod) y resultados tipados de las Server
// Actions de aprobacion de postulaciones. Reusa ActionError (feature 10/16).

/** Documento de una postulacion con su URL firmada temporal (R8/R9). */
export interface DocumentoFirmadoDTO {
  tipo: MensajeroDocumentoTipo;
  url: string;
  expiresInSeconds: number;
}

/** Postulacion pendiente proyectada para revision (R7/R8). */
export interface PostulacionPendienteDTO {
  usuarioId: string;
  nombre: string;
  primerApellido: string | null;
  segundoApellido: string | null;
  email: string;
  telefono: string;
  tipoIdentificacion: string; // value del catalogo (R7)
  cedula: string;
  vehiculo: string | null; // value del catalogo (R7)
  placa: string | null;
  documentos: DocumentoFirmadoDTO[]; // R8/R9
}

// R10: page/pageSize enteros positivos; pageSize se acota a PAGE_SIZE_MAX via
// clamp. Ambos con default para aceptar entrada vacia.
export const listarPostulacionesSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z
    .number()
    .int()
    .positive()
    .default(aprobacionPostulacionesConfig.PAGE_SIZE_DEFAULT)
    .transform((n) => Math.min(n, aprobacionPostulacionesConfig.PAGE_SIZE_MAX)),
});
export type ListarPostulacionesInput = z.infer<typeof listarPostulacionesSchema>;

/** R21: id de postulacion no vacio en el borde (ZodError -> VALIDATION_ERROR). */
export const idSchema = z.string().min(1);

// Resultados tipados que consume la UI (feature 23). El borde (Server Action)
// traduce los AppErrorShape del handler global a estos status (R20).
export type ListarPostulacionesResult =
  | {
      status: "ok";
      items: PostulacionPendienteDTO[];
      page: number;
      pageSize: number;
      total: number;
    }
  | ActionError;

export type DecisionResult =
  | { status: "ok"; usuarioId: string; estado: "activo" | "inactivo" }
  | ActionError;
