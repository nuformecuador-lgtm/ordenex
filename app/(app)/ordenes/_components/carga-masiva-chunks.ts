// Orquestación de la carga masiva por CHUNKS (cliente). Deduplica por número de
// remisión, trocea las filas y las envía en lotes JSON al endpoint de chunk,
// reusando `BulkOrdenService` en el servidor. Remapea la "fila" (relativa al
// lote) a la línea original del archivo para el reporte de errores.
import type { RawRow } from "@/lib/parsers/spreadsheet";
import type { BulkSummary, RowResult } from "@/lib/types/carga-masiva";
import type { FilaParseada } from "@/app/(app)/ordenes/_components/carga-masiva-parser";

/** Endpoint que procesa un lote de filas ya parseadas (JSON). */
export const CHUNK_ENDPOINT = "/api/ordenes/carga-masiva/chunk";

/** Trocea un arreglo en lotes de a lo sumo `size` elementos (`size` > 0). */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error("size debe ser > 0");
  const lotes: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    lotes.push(items.slice(i, i + size));
  }
  return lotes;
}

/**
 * Deduplica por `num_remision` (no vacío): la primera ocurrencia gana; las
 * repetidas quedan como `duplicada` (con su línea original). Las filas con
 * `num_remision` vacío NO se deduplican (serán error de fila en el servidor).
 */
export function dedupPorRemision(filas: FilaParseada[]): {
  unicas: FilaParseada[];
  duplicadas: RowResult[];
} {
  const vistos = new Set<string>();
  const unicas: FilaParseada[] = [];
  const duplicadas: RowResult[] = [];
  for (const f of filas) {
    const num = (f.row.num_remision ?? "").trim();
    if (num !== "" && vistos.has(num)) {
      duplicadas.push({ fila: f.linea, numRemision: num, resultado: "duplicada" });
      continue;
    }
    if (num !== "") vistos.add(num);
    unicas.push(f);
  }
  return { unicas, duplicadas };
}

/**
 * Aplica el mensajero sugerido del lote a una fila que no traiga uno propio. El
 * backend valida el id; el select del formulario solo ofrece ids válidos.
 */
function aplicarMensajero(row: RawRow, mensajeroSugeridoId?: string): RawRow {
  if (!mensajeroSugeridoId) return row;
  if ((row.mensajero_sugerido_id ?? "").trim() !== "") return row;
  return { ...row, mensajero_sugerido_id: mensajeroSugeridoId };
}

export interface ProcesarChunksOpts {
  dryRun: boolean;
  mensajeroSugeridoId?: string;
  chunkSize: number;
  endpoint?: string;
  onProgress?: (procesadas: number, total: number) => void;
  fetchImpl?: typeof fetch;
  /**
   * Feature 141 (R12/R13): identificador del LOTE de esta sesión de carga. Si no se pasa, lo
   * genera `procesarEnChunks` UNA vez y lo repite en los N chunks, para que el servidor
   * asocie todas las órdenes de la sesión a una sola fila de `carga`.
   */
  cargaId?: string;
  /**
   * Feature 141 (R18): total de filas de la SESIÓN. Por defecto, el largo del arreglo
   * completo que se trocea (que ES el total de la sesión), nunca el tamaño de un chunk.
   */
  totalFiles?: number;
}

/**
 * Feature 141 — UUID del lote de la sesión. `crypto.randomUUID` existe en todo navegador
 * moderno en contexto seguro y en Node >= 19; el fallback (contexto no seguro) arma un UUID
 * v4 válido con `getRandomValues` o, en último término, con `Math.random`: el id es opaco y
 * su unicidad la respalda además la verificación de propietario del servidor.
 */
function nuevoCargaId(): string {
  const cripto = globalThis.crypto as Crypto | undefined;
  if (cripto && typeof cripto.randomUUID === "function") return cripto.randomUUID();
  const bytes = new Uint8Array(16);
  if (cripto && typeof cripto.getRandomValues === "function") cripto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // versión 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Error de un lote (HTTP no-ok); el llamador lo traduce a alerta/toast. */
export class ChunkRequestError extends Error {
  constructor(readonly status: number) {
    super(`chunk_failed_${status}`);
  }
}

/**
 * Envía las filas en lotes al endpoint de chunk y devuelve los `RowResult`
 * agregados, con la `fila` remapeada a la línea original del archivo. Los lotes
 * se procesan en serie (progreso incremental; sin saturar el backend).
 */
export async function procesarEnChunks(
  filas: FilaParseada[],
  opts: ProcesarChunksOpts,
): Promise<RowResult[]> {
  const endpoint = opts.endpoint ?? CHUNK_ENDPOINT;
  const doFetch = opts.fetchImpl ?? fetch;
  const lotes = chunk(filas, opts.chunkSize);
  const resultados: RowResult[] = [];
  let procesadas = 0;
  // Feature 141 (R12/R13/R14/R18): en firme, UN identificador de lote por SESIÓN de carga,
  // repetido en los N chunks junto al total de la sesión. El dry-run no persiste nada, así
  // que no lleva lote (el servidor no crea fila de `carga`).
  const lote141 = opts.dryRun
    ? null
    : { cargaId: opts.cargaId ?? nuevoCargaId(), totalFiles: opts.totalFiles ?? filas.length };

  for (const lote of lotes) {
    const rows = lote.map((f) => aplicarMensajero(f.row, opts.mensajeroSugeridoId));
    const res = await doFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows, dryRun: opts.dryRun, ...(lote141 ?? {}) }),
    });
    if (!res.ok) throw new ChunkRequestError(res.status);

    const summary = (await res.json()) as BulkSummary;
    // El servidor conserva el orden de entrada: filas[i] ↔ lote[i].
    summary.filas.forEach((rr, i) => {
      resultados.push({ ...rr, fila: lote[i]?.linea ?? rr.fila });
    });
    procesadas += lote.length;
    opts.onProgress?.(procesadas, filas.length);
  }
  return resultados;
}

/** Combina los resultados de los lotes con los duplicados intra-archivo. */
export function combinarResultados(
  chunkResults: RowResult[],
  duplicadasIntraArchivo: RowResult[],
): { filas: RowResult[] } {
  return { filas: [...chunkResults, ...duplicadasIntraArchivo] };
}
