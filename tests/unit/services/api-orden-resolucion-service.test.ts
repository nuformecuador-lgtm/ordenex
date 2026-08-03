// Feature 177 / T10 — ApiOrdenResolucionService con repositorio FAKE (sin DB, sin Prisma).
// Cubre R6, R8, R9, R14 (test discriminante) y R15.
import { describe, it, expect, vi } from "vitest";
import { ApiOrdenResolucionService } from "@/lib/services/ApiOrdenResolucionService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

const ACTOR: Actor = { usuarioId: "store-1", rol: "apiKey" };

type Fila = { id: string; numGuia: number | null; numRemision: string };

/**
 * Fake del repositorio: reproduce la semantica REAL de
 * `findByGuiaORemisionForOwner` (igualdad exacta, `take: 2`, sin desempatar) sobre un fixture
 * en memoria, para que el service no pueda "acertar" por un mock que devuelve siempre lo mismo.
 */
function fakeRepo(filas: Fila[] = []) {
  const findByGuiaORemisionForOwner = vi.fn(
    async (identificador: { numGuia: number | null; numRemision: string }, ownerId: string) => {
      void ownerId;
      return filas
        .filter(
          (f) =>
            (identificador.numGuia !== null && f.numGuia === identificador.numGuia) ||
            f.numRemision === identificador.numRemision,
        )
        .slice(0, 2);
    },
  );
  return { findByGuiaORemisionForOwner };
}

/** Fixture del choque de R14: la GUIA de A y la REMISION de B valen las dos "100234". */
const ORDEN_A: Fila = { id: "A", numGuia: 100234, numRemision: "REM-A" };
const ORDEN_B: Fila = { id: "B", numGuia: null, numRemision: "100234" };

describe("ApiOrdenResolucionService.resolver (feature 177, T10)", () => {
  it("R6/R9: resuelve por num_guia cuando el identificador es la guia de una orden propia", async () => {
    const repo = fakeRepo([{ id: "o-1", numGuia: 100234, numRemision: "REM-1" }]);
    const svc = new ApiOrdenResolucionService(repo);

    const result = await svc.resolver(ACTOR, "100234");

    expect(result).toEqual({
      status: "ok",
      orden: { id: "o-1", numGuia: 100234 },
      via: "num_guia",
    });
    // R9: siendo entero positivo, la guia SI entra en la consulta (ambas columnas se evaluan).
    expect(repo.findByGuiaORemisionForOwner.mock.calls[0][0]).toEqual({
      numGuia: 100234,
      numRemision: "100234",
    });
  });

  it("R6/R15: resuelve por num_remision cuando ninguna guia propia coincide", async () => {
    const repo = fakeRepo([{ id: "o-2", numGuia: 55, numRemision: "REM-XYZ" }]);
    const svc = new ApiOrdenResolucionService(repo);

    const result = await svc.resolver(ACTOR, "REM-XYZ");

    expect(result).toEqual({
      status: "ok",
      orden: { id: "o-2", numGuia: 55 },
      via: "num_remision",
    });
  });

  it("R8: con identificador no numerico el repo recibe numGuia: null (no se consulta la guia)", async () => {
    const repo = fakeRepo([{ id: "o-3", numGuia: null, numRemision: "REM-ABC" }]);
    const svc = new ApiOrdenResolucionService(repo);

    await svc.resolver(ACTOR, "REM-ABC");

    const [identificador] = repo.findByGuiaORemisionForOwner.mock.calls[0];
    expect(identificador).toEqual({ numGuia: null, numRemision: "REM-ABC" });
    expect(identificador.numGuia).toBeNull();
  });

  it("R8: '007', '0', '-3', '1.5', '1e3' y un entero fuera del rango int4 no son candidatos a guia", async () => {
    const noCandidatos = ["007", "0", "-3", "1.5", "1e3", "0x10", "+7", "12abc", "2147483648"];
    for (const id of noCandidatos) {
      const repo = fakeRepo();
      const svc = new ApiOrdenResolucionService(repo);
      await svc.resolver(ACTOR, id);
      expect(repo.findByGuiaORemisionForOwner.mock.calls[0][0]).toEqual({
        numGuia: null,
        numRemision: id,
      });
    }
    // El limite exacto de int4 SI es candidato.
    const repoLimite = fakeRepo();
    await new ApiOrdenResolucionService(repoLimite).resolver(ACTOR, "2147483647");
    expect(repoLimite.findByGuiaORemisionForOwner.mock.calls[0][0]).toEqual({
      numGuia: 2147483647,
      numRemision: "2147483647",
    });
  });

  it("R6: normaliza el identificador con trim antes de consultar y de comparar", async () => {
    const repo = fakeRepo([ORDEN_A]);
    const svc = new ApiOrdenResolucionService(repo);

    const result = await svc.resolver(ACTOR, "  100234  ");

    // Sin trim, "  100234  " no seria entero positivo y ademas no casaria por remision exacta.
    expect(repo.findByGuiaORemisionForOwner.mock.calls[0][0]).toEqual({
      numGuia: 100234,
      numRemision: "100234",
    });
    expect(result).toEqual({
      status: "ok",
      orden: { id: "A", numGuia: 100234 },
      via: "num_guia",
    });
  });

  it("R11/R12: sin filas coincidentes devuelve not_found", async () => {
    const repo = fakeRepo([]);
    const svc = new ApiOrdenResolucionService(repo);

    await expect(svc.resolver(ACTOR, "100234")).resolves.toEqual({ status: "not_found" });
    await expect(svc.resolver(ACTOR, "REM-NO-EXISTE")).resolves.toEqual({ status: "not_found" });
  });

  it("R14 (DISCRIMINANTE): con la guia de A y la remision de B casando a la vez devuelve A y no B", async () => {
    const repo = fakeRepo([ORDEN_A, ORDEN_B]);
    const svc = new ApiOrdenResolucionService(repo);

    const result = await svc.resolver(ACTOR, "100234");

    // El repo devolvio LAS DOS filas sin desempatar: el desempate es del service.
    expect(await repo.findByGuiaORemisionForOwner({ numGuia: 100234, numRemision: "100234" }, "store-1")).toHaveLength(2);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("se esperaba una resolucion ok");
    expect(result.orden.id).toBe("A");
    expect(result.orden.id).not.toBe("B");
    expect(result.via).toBe("num_guia");
    expect(result.orden.numGuia).toBe(100234);
  });

  it("R14: el orden en que el repositorio devuelve las filas no altera el ganador", async () => {
    const repo = fakeRepo([ORDEN_B, ORDEN_A]); // B primero: la precedencia no es "la primera fila"
    const svc = new ApiOrdenResolucionService(repo);

    const result = await svc.resolver(ACTOR, "100234");

    if (result.status !== "ok") throw new Error("se esperaba una resolucion ok");
    expect(result.orden.id).toBe("A");
    expect(result.orden.id).not.toBe("B");
    expect(result.via).toBe("num_guia");
  });

  it("R15: ninguna rama produce 409 ni un estado de conflicto (0, 1 y 2 filas; numerico y no numerico)", async () => {
    const fixtures: Fila[][] = [
      [],
      [{ id: "u-1", numGuia: 100234, numRemision: "REM-1" }],
      [{ id: "u-2", numGuia: null, numRemision: "REM-SOLO" }],
      [ORDEN_A, ORDEN_B],
    ];
    const identificadores = ["100234", "REM-1", "REM-SOLO", "007", "  100234  ", "REM-NO"];

    for (const filas of fixtures) {
      for (const id of identificadores) {
        const svc = new ApiOrdenResolucionService(fakeRepo(filas));
        const result = await svc.resolver(ACTOR, id);
        expect(["ok", "not_found"]).toContain(result.status);
        expect(JSON.stringify(result)).not.toMatch(/409|conflict|ambigu/i);
      }
    }
  });

  it("R4: el owner pasado al repositorio es actor.usuarioId, nunca un valor de la peticion", async () => {
    const repo = fakeRepo([ORDEN_A]);
    const svc = new ApiOrdenResolucionService(repo);
    const otroActor: Actor = { usuarioId: "store-2", rol: "apiKey" };

    await svc.resolver(ACTOR, "100234");
    await svc.resolver(otroActor, "100234");

    expect(repo.findByGuiaORemisionForOwner.mock.calls[0][1]).toBe("store-1");
    expect(repo.findByGuiaORemisionForOwner.mock.calls[1][1]).toBe("store-2");
    // El identificador de la peticion NUNCA se cuela como owner.
    expect(repo.findByGuiaORemisionForOwner.mock.calls[0][1]).not.toBe("100234");
  });
});
