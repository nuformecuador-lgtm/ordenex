// Feature 15 — Tipos y validacion de fila de la carga masiva (R18, R22, R23, R30).
import { z } from "zod";

export type RowResultado = "creada" | "duplicada" | "error";

/** R30: resultado por fila del archivo. */
export interface RowResult {
  fila: number; // 1-based sobre las filas de datos (sin contar cabecera)
  numRemision: string;
  resultado: RowResultado;
  estatus?: string; // value del estatus (creada/duplicada), R32: nunca ids internos
  errores?: Record<string, string[]>; // solo para "error"
}

/** R30: resumen devuelto por el endpoint. */
export interface BulkSummary {
  total: number;
  creadas: number;
  duplicadas: number;
  conError: number;
  filas: RowResult[];
}

// R16: columnas obligatorias de CABECERA (estructura del archivo). Distinto de
// los campos obligatorios POR FILA (R18), que son un subconjunto.
export const REQUIRED_HEADERS = [
  "num_remision",
  "destinatario",
  "telefono",
  "provincia",
  "canton",
] as const;

/** R16: devuelve las columnas obligatorias ausentes en la cabecera detectada. */
export function findMissingHeaders(headers: string[]): string[] {
  const present = new Set(headers.map((h) => h.trim().toLowerCase()));
  return REQUIRED_HEADERS.filter((h) => !present.has(h));
}

function requiredNonEmpty(label: string) {
  return z
    .string()
    .trim()
    .min(1, `${label} es obligatorio`);
}

// R18/R22/R23: valida y normaliza una fila cruda (todos los valores son texto,
// tal como los emite el parser). provincia/canton/distrito NO se validan aqui
// como obligatorios "no vacios": su resolucion geografica (existencia/ambiguedad,
// R19/R20) vive en el service, que produce su propio fieldError si falla.
export const filaCargaSchema = z.object({
  num_remision: requiredNonEmpty("num_remision"),
  destinatario: requiredNonEmpty("destinatario"),
  telefono: requiredNonEmpty("telefono"),
  producto: requiredNonEmpty("producto"),
  provincia: z.string().trim().optional().default(""),
  canton: z.string().trim().optional().default(""),
  distrito: z.string().trim().optional().default(""),
  direccion: z.string().trim().optional().default(""),
  notas: z.string().trim().optional().default(""),
  // R23: numerico >= 0, o vacio -> null.
  monto_cobrar: z
    .string()
    .trim()
    .optional()
    .default("")
    .transform((value, ctx) => {
      if (value === "") return null;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        ctx.addIssue({ code: "custom", message: "monto_cobrar debe ser numerico y no negativo" });
        return z.NEVER;
      }
      return parsed;
    }),
  // R22: string o vacio -> null. La existencia/rol se valida en el service.
  mensajero_sugerido_id: z
    .string()
    .trim()
    .optional()
    .default("")
    .transform((value) => (value === "" ? null : value)),
});

export type FilaCargaInput = z.infer<typeof filaCargaSchema>;
