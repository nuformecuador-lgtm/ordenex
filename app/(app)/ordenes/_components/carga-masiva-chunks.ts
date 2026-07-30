// Orquestación de la carga masiva por CHUNKS (cliente). Deduplica por número de
// remisión, trocea las filas y las envía en lotes JSON al endpoint de chunk,
// reusando `BulkOrdenService` en el servidor. Remapea la "fila" (relativa al
// lote) a la línea original del archivo para el reporte de errores.
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

export interface ProcesarChunksOpts {
  dryRun: boolean;
  chunkSize: number;
  endpoint?: string;
  onProgress?: (procesadas: number, total: number) => void;
  fetchImpl?: typeof fetch;
  /**
   * Feature 141 (R8/R20): nombre OPCIONAL del lote, definido por el usuario. Viaja en todos
   * los chunks, pero solo lo persiste el que CREA el lote (R21/R23).
   */
  name?: string;
  /**
   * Feature 141 (R29): total de filas de la SESIÓN. Por defecto, el largo del arreglo
   * completo que se trocea (que ES el total de la sesión), nunca el tamaño de un chunk.
   */
  totalFiles?: number;
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
  // Feature 141 (R15/R16/R17): el identificador del lote lo EMITE EL SERVIDOR. El primer
  // chunk en firme va SIN `cargaId`; la respuesta trae el token, que se guarda aquí y se
  // reenvía tal cual en los chunks siguientes para que todos cuelguen del MISMO lote (R26).
  // El cliente NUNCA lo genera. El dry-run no persiste nada, así que no lleva lote (R27).
  let cargaId: string | null = null;
  // R29: el total de la SESIÓN (el arreglo completo que se trocea), nunca el del chunk; y
  // el nombre opcional del lote (R20), que solo persiste el chunk que lo crea.
  const totalFiles = opts.totalFiles ?? filas.length;

  for (const lote of lotes) {
    const rows = lote.map((f) => f.row);
    const body: Record<string, unknown> = { rows, dryRun: opts.dryRun };
    if (!opts.dryRun) {
      body.totalFiles = totalFiles;
      if (opts.name !== undefined) body.name = opts.name;
      if (cargaId !== null) body.cargaId = cargaId; // solo a partir del 2.º chunk
    }
    const res = await doFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new ChunkRequestError(res.status);

    const summary = (await res.json()) as BulkSummary;
    // Token del lote emitido por el servidor: se conserva el primero que llegue (los chunks
    // se envían EN SERIE, así que el 2.º ya lo conoce). Si un chunk no creó ninguna orden,
    // su `cargaId` es null y se sigue esperando al siguiente.
    if (cargaId === null && summary.cargaId) cargaId = summary.cargaId;
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
