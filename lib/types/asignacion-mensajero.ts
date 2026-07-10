// Feature 16 — Tipos y schemas del backend de "carga masiva - etapa 2": listado de
// mensajeros para el select, resumen del lote recien cargado y asignacion de
// mensajero_sugerido_id. DTOs propios (no amplian OrdenDTO) para no alterar el
// contrato del CRUD de ordenes (feature 6/7).
import { z } from "zod";
import { cargaMasivaConfig } from "@/lib/config/carga-masiva";

// R1/R2: usuario con rol mensajero, proyectado SOLO a id/nombre (sin PII).
export interface MensajeroDTO {
  id: string;
  nombre: string;
}

// R6: fila del resumen de una orden del lote recien cargado. Campos disponibles
// ya en la orden; NO incluye deletedAt/passwordHash/ids de sesion (R9).
export interface ResumenCargaOrdenDTO {
  id: string;
  numGuia: number;
  numRemision: string;
  destinatario: string;
  telefonoDest: string;
  producto: string;
  montoCobrar: number | null;
  direccion: string | null;
  estatusValue?: string;
  mensajeroSugeridoId: string | null;
  mensajeroSugeridoNombre: string | null;
}

// R6/R7: input del resumen. numRemisiones = las que el frontend obtuvo del
// BulkSummary con resultado === "creada" (feature 15). Acota al maximo de filas
// de una carga masiva (misma constante que valida el archivo de carga).
export const resumenCargaSchema = z.object({
  numRemisiones: z.array(z.string().min(1)).min(1).max(cargaMasivaConfig.MAX_ROWS),
});
export type ResumenCargaInput = z.infer<typeof resumenCargaSchema>;

// R12/R13/R18: input de asignacion; lista vacia PERMITIDA (no-op valido).
export const asignarMensajeroSchema = z.object({
  asignaciones: z.array(
    z.object({
      ordenId: z.string().min(1),
      mensajeroId: z.string().min(1),
    }),
  ),
});
export type AsignarMensajeroInput = z.infer<typeof asignarMensajeroSchema>;
