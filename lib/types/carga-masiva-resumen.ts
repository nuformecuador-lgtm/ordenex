// Feature 16 — Tipos y schemas del resumen del lote recien cargado por la carga
// masiva. DTO propio (no amplia OrdenDTO) para no alterar el contrato del CRUD de
// ordenes (feature 6/7).
//
// Feature 159: el archivo se llamaba `lib/types/asignacion-mensajero.ts` y tambien
// tipaba la sugerencia de mensajero (select del resumen + asignacion por lote). Esa
// capacidad se retiro entera; lo que queda —y lo que da nombre al archivo— es el
// resumen en SOLO LECTURA de las ordenes creadas (requirements 159/R12).
import { z } from "zod";
import { cargaMasivaConfig } from "@/lib/config/carga-masiva";

// R6: fila del resumen de una orden del lote recien cargado. Campos disponibles
// ya en la orden; NO incluye deletedAt/passwordHash/ids de sesion (R9).
// Feature 17/R30: `numGuia` es `number | null` (la guia se asigna despues, en
// "Generar guia"; el resumen de carga masiva siempre la muestra pendiente).
export interface ResumenCargaOrdenDTO {
  id: string;
  numGuia: number | null;
  numRemision: string;
  destinatario: string;
  telefonoDest: string;
  producto: string;
  montoCobrar: number | null;
  direccion: string | null;
  estatusValue?: string;
  // Feature 30: zona de la orden (NOT NULL, derivada del distrito). Se muestra
  // como columna del resumen; ya no filtra ningun selector (159/R13).
  zonaId: string;
  zonaNombre: string;
}

// R6/R7: input del resumen. numRemisiones = las que el frontend obtuvo del
// BulkSummary con resultado === "creada" (feature 15). Acota al maximo de filas
// de una carga masiva (misma constante que valida el archivo de carga).
export const resumenCargaSchema = z.object({
  numRemisiones: z.array(z.string().min(1)).min(1).max(cargaMasivaConfig.MAX_ROWS),
});
export type ResumenCargaInput = z.infer<typeof resumenCargaSchema>;
