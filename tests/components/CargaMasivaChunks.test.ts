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
function okResponse(rows: Array<Record<string, string>>, cargaId: string | null = null): Response {
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
    cargaId, // feature 141/R38: token del lote emitido por el SERVIDOR
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

  it("envía las filas del archivo TAL CUAL, sin inyectar campos", async () => {
    // Retirado el "mensajero sugerido": `procesarEnChunks` ya no reescribe la
    // fila; lo que se manda es exactamente lo que trae el archivo.
    const filas = [fila("A", 1), fila("B", 2, { notas: "propia" })];
    let enviados: Array<Record<string, string>> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      enviados = body.rows;
      return okResponse(body.rows);
    }) as unknown as typeof fetch;

    await procesarEnChunks(filas, { dryRun: false, chunkSize: 10, fetchImpl });

    expect(enviados).toEqual(filas.map((f) => f.row));
    expect(enviados[1].notas).toBe("propia");
  });

  it("lanza ChunkRequestError si un lote responde no-ok", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await expect(
      procesarEnChunks([fila("A", 1)], {
        dryRun: true,
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

// --- Feature 141: el token del lote lo EMITE EL SERVIDOR (R15/R16/R17/R20/R27/R29) ---

const TOKEN_SERVIDOR = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";

/**
 * Captura los cuerpos JSON enviados por `procesarEnChunks` y responde con el summary del
 * endpoint. `cargaId` es el TOKEN que el servidor emite: por defecto el mismo en todas las
 * respuestas (el primer chunk lo crea, los siguientes lo reutilizan).
 */
function fetchCaptor(cargaIds: Array<string | null> = []): {
  fetchImpl: typeof fetch;
  bodies: Array<Record<string, unknown>>;
} {
  const bodies: Array<Record<string, unknown>> = [];
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? "{}");
    bodies.push(body);
    const cargaId = cargaIds.length > 0 ? (cargaIds[bodies.length - 1] ?? null) : TOKEN_SERVIDOR;
    return okResponse(body.rows, cargaId);
  }) as unknown as typeof fetch;
  return { fetchImpl, bodies };
}

describe("carga-masiva-chunks — lote emitido por el servidor (feature 141)", () => {
  it("R15/R16: el PRIMER chunk NO envia cargaId (el cliente nunca lo genera)", async () => {
    const { fetchImpl, bodies } = fetchCaptor();

    await procesarEnChunks([fila("A", 1), fila("B", 2)], {
      dryRun: false,
      chunkSize: 1,
      fetchImpl,
    });

    expect(bodies[0]).not.toHaveProperty("cargaId");
  });

  it("R17/R26: los chunks 2..N reenvian EXACTAMENTE el token devuelto por el servidor", async () => {
    const { fetchImpl, bodies } = fetchCaptor();
    const filas = [fila("A", 1), fila("B", 2), fila("C", 3), fila("D", 4), fila("E", 5)];

    await procesarEnChunks(filas, { dryRun: false, chunkSize: 2, fetchImpl });

    expect(bodies).toHaveLength(3);
    expect(bodies.map((b) => b.cargaId)).toEqual([undefined, TOKEN_SERVIDOR, TOKEN_SERVIDOR]);
  });

  it("si el primer chunk no crea lote (cargaId null), el siguiente vuelve a ir sin token", async () => {
    // Chunk 1 sin ordenes creadas -> el servidor no emite lote; chunk 2 lo crea y el 3 lo usa.
    const { fetchImpl, bodies } = fetchCaptor([null, TOKEN_SERVIDOR, TOKEN_SERVIDOR]);
    const filas = [fila("A", 1), fila("B", 2), fila("C", 3)];

    await procesarEnChunks(filas, { dryRun: false, chunkSize: 1, fetchImpl });

    expect(bodies.map((b) => b.cargaId)).toEqual([undefined, undefined, TOKEN_SERVIDOR]);
  });

  it("R29: todos los chunks declaran el total de la SESION, no el del chunk", async () => {
    const { fetchImpl, bodies } = fetchCaptor();
    const filas = [fila("A", 1), fila("B", 2), fila("C", 3), fila("D", 4), fila("E", 5)];

    await procesarEnChunks(filas, { dryRun: false, chunkSize: 2, fetchImpl });

    expect(bodies.map((b) => b.totalFiles)).toEqual([5, 5, 5]);
  });

  it("R20: el nombre del lote viaja en todos los chunks cuando el llamador lo pasa", async () => {
    const { fetchImpl, bodies } = fetchCaptor();

    await procesarEnChunks([fila("A", 1), fila("B", 2)], {
      dryRun: false,
      chunkSize: 1,
      fetchImpl,
      name: "carga de enero",
    });

    expect(bodies.map((b) => b.name)).toEqual(["carga de enero", "carga de enero"]);
  });

  it("R22: sin nombre, el cuerpo no lleva `name` (el lote nace con name NULL)", async () => {
    const { fetchImpl, bodies } = fetchCaptor();

    await procesarEnChunks([fila("A", 1)], { dryRun: false, chunkSize: 10, fetchImpl });

    expect(bodies[0]).not.toHaveProperty("name");
  });

  it("R27: el dry-run NO envia cargaId, name ni totalFiles (no crea lote)", async () => {
    const { fetchImpl, bodies } = fetchCaptor();

    await procesarEnChunks([fila("A", 1), fila("B", 2)], {
      dryRun: true,
      chunkSize: 1,
      fetchImpl,
      name: "carga de enero",
    });

    for (const body of bodies) {
      expect(body).not.toHaveProperty("cargaId");
      expect(body).not.toHaveProperty("totalFiles");
      expect(body).not.toHaveProperty("name");
    }
  });

  it("los chunks se envian EN SERIE: el 2.o sale despues de responder el 1.o", async () => {
    // Invariante del cliente del que depende R26: si se paralelizaran, dos chunks sin
    // `cargaId` crearian dos lotes.
    const eventos: string[] = [];
    let n = 0;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const idx = ++n;
      const body = JSON.parse((init?.body as string) ?? "{}");
      eventos.push(`req-${idx}`);
      await new Promise((r) => setTimeout(r, 5));
      eventos.push(`res-${idx}`);
      return okResponse(body.rows, TOKEN_SERVIDOR);
    }) as unknown as typeof fetch;

    await procesarEnChunks([fila("A", 1), fila("B", 2)], {
      dryRun: false,
      chunkSize: 1,
      fetchImpl,
    });

    expect(eventos).toEqual(["req-1", "res-1", "req-2", "res-2"]);
  });
});
