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
  /**
   * Feature 141/R38: identificador del LOTE de carga masiva al que quedaron asociadas las
   * ordenes creadas (creado en esta peticion o reutilizado). Es un TOKEN OPACO emitido por el
   * servidor: el cliente lo reenvia en los chunks siguientes. `null` cuando no hubo lote
   * (dry-run o cero ordenes persistidas).
   */
  cargaId: string | null;
}

// R16: columnas obligatorias de CABECERA (estructura del archivo). Distinto de
// los campos obligatorios POR FILA (R18), que son un subconjunto.
// Feature 276/R7/R9/R10 (corte duro, igual que el de la 142): la geografia vuelve
// a viajar en columnas separadas, pero el canton y el distrito comparten una:
// `canton_distrito` con formato `nombreCanton (Distrito)`. La columna unica de la
// plantilla v2 (`direccion_destinatario`) ya NO existe, asi que un archivo v2 falla
// aqui — que es justo el efecto buscado: no hay modo de compatibilidad.
export const REQUIRED_HEADERS = [
  "num_remision",
  "destinatario",
  "telefono",
  "provincia",
  "canton_distrito",
  "direccion",
] as const;

/**
 * R16: devuelve las columnas obligatorias ausentes en la cabecera detectada.
 *
 * ANCLA feature 143 (R14) — comprueba PRESENCIA, nunca una lista blanca: el
 * export de filas con error se re-sube con una columna extra `motivo_error` y
 * debe seguir pasando. Lo blinda `tests/integration/carga-masiva-errores-roundtrip.test.ts`.
 */
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
// tal como los emite el parser). La geografia NO se valida aqui: su resolucion
// (existencia/ambiguedad, R19/R20) vive en el service.
//
// Feature 142/276 (design.md §5): este schema lo comparten la via sesion
// (`cargarMasiva`, plantilla v3 con `provincia` + `canton_distrito` + `direccion`)
// y la via API key (`cargarViaApi`, feature 88 = contrato publico con
// `provincia`/`canton`/`distrito`/`direccion` separados). Por eso NO valida el
// CONTENIDO de ningun campo geografico: cada via extrae y valida su geografia con
// su propio extractor en `BulkOrdenService` (R26/R30). Los campos geograficos que
// aparecen aqui son paso-a-traves tipado, y `direccion` la usan las DOS vias.
//
// ANCLA feature 143 (R16) — NO convertir este `z.object` en `.strict()`.
// El export de filas con error (`carga-masiva-export-errores.ts`) descarga un
// XLSX con una columna extra `motivo_error` para que el usuario corrija y VUELVA
// A SUBIR ese mismo archivo. El round-trip sobrevive porque zod descarta en
// silencio las claves desconocidas: con `.strict()` toda fila re-subida seria
// rechazada. Igual que `findMissingHeaders` no debe adquirir una lista blanca de
// cabeceras (R14). Lo blinda `tests/integration/carga-masiva-errores-roundtrip.test.ts`.
export const filaCargaSchema = z.object({
  num_remision: requiredNonEmpty("num_remision"),
  destinatario: requiredNonEmpty("destinatario"),
  telefono: requiredNonEmpty("telefono"),
  producto: requiredNonEmpty("producto"),
  provincia: z.string().trim().optional().default(""),
  canton_distrito: z.string().trim().optional().default(""),
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
});

export type FilaCargaInput = z.infer<typeof filaCargaSchema>;
