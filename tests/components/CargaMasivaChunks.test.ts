import { describe, it, expect, vi } from "vitest";

import type { FilaParseada } from "@/app/(app)/ordenes/_components/carga-masiva-parser";
import type { BulkSummary } from "@/lib/types/carga-masiva";
import {
  chunk,
  dedupPorRemision,
  procesarEnChunks,
  combinarResultados,
  ChunkRequestError,
} from "@/app/(app)/ordenes/_components/carga-masiva-chunks";

function fila(numRemision: string, linea: number, extra: Record<string, string> = {}): FilaParseada {
  return { row: { num_remision: numRemision, ...extra }, linea };
}

/** Respuesta fake del endpoint: clasifica cada fila como "creada" en orden. */
function okResponse(rows: Array<Record<string, string>>): Response {
  const summary: BulkSummary = {
    total: rows.length,
    creadas: rows.length,
    duplicadas: 0,
    conError: 0,
    filas: rows.map((r, i) => ({
      fila: i + 1, // relativo al lote (será remapeado por el cliente)
      numRemision: r.num_remision ?? "",
      resultado: "creada",
      estatus: "en_preparacion",
    })),
    cargaId: null, // feature 141/R27
  };
  return new Response(JSON.stringify(summary), { status: 200 });
}

describe("carga-masiva-chunks — chunk", () => {
  it("trocea en lotes del tamaño dado", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("lanza si size <= 0", () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe("carga-masiva-chunks — dedupPorRemision", () => {
  it("primera ocurrencia gana; repetidas -> duplicada con su línea", () => {
    const { unicas, duplicadas } = dedupPorRemision([
      fila("REM-A", 1),
      fila("REM-B", 2),
      fila("REM-A", 3),
    ]);
    expect(unicas.map((f) => f.linea)).toEqual([1, 2]);
    expect(duplicadas).toEqual([
      { fila: 3, numRemision: "REM-A", resultado: "duplicada" },
    ]);
  });

  it("no deduplica filas con num_remision vacío (serán error de fila)", () => {
    const { unicas, duplicadas } = dedupPorRemision([fila("", 1), fila("", 2)]);
    expect(unicas).toHaveLength(2);
    expect(duplicadas).toHaveLength(0);
  });
});

describe("carga-masiva-chunks — procesarEnChunks", () => {
  it("envía en lotes, remapea la fila a la línea original y reporta progreso", async () => {
    const filas = [fila("A", 10), fila("B", 20), fila("C", 30)];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      return okResponse(body.rows);
    }) as unknown as typeof fetch;
    const progreso: Array<[number, number]> = [];

    const results = await procesarEnChunks(filas, {
      dryRun: true,
      mensajeroSugeridoId: "",
      chunkSize: 2,
      fetchImpl,
      onProgress: (h, t) => progreso.push([h, t]),
    });

    // 3 filas / lote 2 -> 2 requests.
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    // La fila reportada es la LÍNEA ORIGINAL, no el índice del lote.
    expect(results.map((r) => r.fila)).toEqual([10, 20, 30]);
    // dryRun viaja en el cuerpo.
    const primerBody = JSON.parse(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(primerBody.dryRun).toBe(true);
    // progreso incremental hasta el total.
    expect(progreso).toEqual([[2, 3], [3, 3]]);
  });

  it("inyecta el mensajero sugerido del lote en filas sin uno propio", async () => {
    const filas = [fila("A", 1), fila("B", 2, { mensajero_sugerido_id: "propio" })];
    let enviados: Array<Record<string, string>> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      enviados = body.rows;
      return okResponse(body.rows);
    }) as unknown as typeof fetch;

    await procesarEnChunks(filas, {
      dryRun: false,
      mensajeroSugeridoId: "global",
      chunkSize: 10,
      fetchImpl,
    });

    expect(enviados[0].mensajero_sugerido_id).toBe("global"); // sin propio -> global
    expect(enviados[1].mensajero_sugerido_id).toBe("propio"); // conserva el propio
  });

  it("lanza ChunkRequestError si un lote responde no-ok", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await expect(
      procesarEnChunks([fila("A", 1)], {
        dryRun: true,
        mensajeroSugeridoId: "",
        chunkSize: 10,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(ChunkRequestError);
  });
});

describe("carga-masiva-chunks — combinarResultados", () => {
  it("concatena resultados de lotes con duplicados intra-archivo", () => {
    const combinado = combinarResultados(
      [{ fila: 1, numRemision: "A", resultado: "creada" }],
      [{ fila: 2, numRemision: "A", resultado: "duplicada" }],
    );
    expect(combinado.filas).toHaveLength(2);
    expect(combinado.filas[1].resultado).toBe("duplicada");
  });
});

// --- Feature 141: el cliente propaga UN lote por sesion (R12/R13/R14/R18) ---

/** Captura los cuerpos JSON enviados por `procesarEnChunks`. */
function fetchCaptor(): { fetchImpl: typeof fetch; bodies: Array<Record<string, unknown>> } {
  const bodies: Array<Record<string, unknown>> = [];
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? "{}");
    bodies.push(body);
    return okResponse(body.rows);
  }) as unknown as typeof fetch;
  return { fetchImpl, bodies };
}

describe("carga-masiva-chunks — lote de la sesion (feature 141)", () => {
  it("R12/R13: los N chunks de una sesion en firme envian el MISMO cargaId (UUID)", async () => {
    const { fetchImpl, bodies } = fetchCaptor();
    const filas = [fila("A", 1), fila("B", 2), fila("C", 3), fila("D", 4), fila("E", 5)];

    await procesarEnChunks(filas, { dryRun: false, chunkSize: 2, fetchImpl });

    expect(bodies).toHaveLength(3);
    const ids = bodies.map((b) => b.cargaId);
    expect(new Set(ids).size).toBe(1);
    expect(String(ids[0])).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("R18: todos los chunks declaran el total de la SESION, no el del chunk", async () => {
    const { fetchImpl, bodies } = fetchCaptor();
    const filas = [fila("A", 1), fila("B", 2), fila("C", 3), fila("D", 4), fila("E", 5)];

    await procesarEnChunks(filas, { dryRun: false, chunkSize: 2, fetchImpl });

    expect(bodies.map((b) => b.totalFiles)).toEqual([5, 5, 5]);
  });

  it("R14: el dry-run NO envia cargaId ni totalFiles (no crea lote)", async () => {
    const { fetchImpl, bodies } = fetchCaptor();

    await procesarEnChunks([fila("A", 1), fila("B", 2)], {
      dryRun: true,
      chunkSize: 1,
      fetchImpl,
    });

    for (const body of bodies) {
      expect(body).not.toHaveProperty("cargaId");
      expect(body).not.toHaveProperty("totalFiles");
    }
  });

  it("respeta el cargaId/totalFiles que le pase el llamador", async () => {
    const { fetchImpl, bodies } = fetchCaptor();
    const cargaId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

    await procesarEnChunks([fila("A", 1)], {
      dryRun: false,
      chunkSize: 10,
      fetchImpl,
      cargaId,
      totalFiles: 900,
    });

    expect(bodies[0]).toMatchObject({ cargaId, totalFiles: 900 });
  });

  it("dos sesiones distintas obtienen lotes distintos", async () => {
    const primera = fetchCaptor();
    const segunda = fetchCaptor();

    await procesarEnChunks([fila("A", 1)], {
      dryRun: false,
      chunkSize: 10,
      fetchImpl: primera.fetchImpl,
    });
    await procesarEnChunks([fila("B", 2)], {
      dryRun: false,
      chunkSize: 10,
      fetchImpl: segunda.fetchImpl,
    });

    expect(primera.bodies[0].cargaId).not.toBe(segunda.bodies[0].cargaId);
  });
});
