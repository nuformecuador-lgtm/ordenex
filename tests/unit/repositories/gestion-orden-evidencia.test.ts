import { describe, it, expect, vi, beforeEach } from "vitest";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// Feature 119 (R9/R12) — `crearGestionYTransicionar` con Prisma mockeado (sin DB). Verifica que
// las N filas hijas (`gestion_orden_evidencia`) se insertan en la MISMA transaccion que crea la
// gestion y transiciona la orden (R9), y que la PORTADA (indice 0) se dual-escribe en las columnas
// viejas `evidencia_storage_path/_content_type` para no romper a los consumidores actuales (R12).

function colaFake() {
  return {
    enqueue: vi.fn(async () => null),
    claimBatch: vi.fn(async () => []),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    findByDedupeKeys: vi.fn(async () => []),
  };
}

function buildTxRepo() {
  const gestionCreate = vi.fn(async () => ({ id: "g1" }));
  const evidenciaCreateMany = vi.fn(async () => ({ count: 0 }));
  const ordenUpdate = vi.fn(async () => ({}));
  const ordenFindFirst = vi.fn(async () => ({ estatusId: idEstado("en_reparto") }));
  const usuarioUpdate = vi.fn(async () => ({}));
  const historialCreateMany = vi.fn();
  const tx = {
    gestionOrden: { create: gestionCreate },
    gestionOrdenEvidencia: { createMany: evidenciaCreateMany },
    orden: { update: ordenUpdate, findFirst: ordenFindFirst },
    usuario: { update: usuarioUpdate },
    ordenHistorialEstado: { createMany: historialCreateMany },
  };
  const $transaction = vi.fn(async (cb: (t: typeof tx) => Promise<string>) => cb(tx));
  const repo = new GestionOrdenRepository({ $transaction } as never, colaFake() as never);
  return { repo, gestionCreate, evidenciaCreateMany, ordenUpdate, usuarioUpdate, $transaction };
}

const evidencias3 = [
  { storagePath: "o1/entregada-1-0.jpg", contentType: "image/jpeg", indice: 0 },
  { storagePath: "o1/entregada-1-1.png", contentType: "image/png", indice: 1 },
  { storagePath: "o1/entregada-1-2.webp", contentType: "image/webp", indice: 2 },
];

beforeEach(async () => {
  await sembrarCatalogoEstados(); // feature 140: la guardia del choke point es de fallo CERRADO (catalogo real + pares legales)
});

describe("crearGestionYTransicionar — N filas hijas en la misma tx (R9)", () => {
  it("R9: gestion + createMany de las N evidencias + UPDATE estatus, todo bajo un unico $transaction", async () => {
    const { repo, gestionCreate, evidenciaCreateMany, ordenUpdate, $transaction } = buildTxRepo();

    const id = await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "entregada", montoRecibido: 100, metodoPago: "efectivo", evidencias: evidencias3 },
      nuevoEstatusId: idEstado("entregada"),
    });

    expect(id).toBe("g1");
    // Una sola transaccion envuelve TODO (todo-o-nada).
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(gestionCreate).toHaveBeenCalledTimes(1);
    expect(ordenUpdate).toHaveBeenCalledTimes(1);
    // Las N filas hijas van en un unico createMany, enlazadas a la gestion recien creada.
    expect(evidenciaCreateMany).toHaveBeenCalledTimes(1);
    const arg = (evidenciaCreateMany.mock.calls[0] as unknown[])[0] as { data: unknown[] };
    expect(arg.data).toEqual([
      { gestionId: "g1", storagePath: "o1/entregada-1-0.jpg", contentType: "image/jpeg", indice: 0 },
      { gestionId: "g1", storagePath: "o1/entregada-1-1.png", contentType: "image/png", indice: 1 },
      { gestionId: "g1", storagePath: "o1/entregada-1-2.webp", contentType: "image/webp", indice: 2 },
    ]);
  });

  it("R2: preserva el indice 0..N-1 EXACTO de cada evidencia en las filas hijas", async () => {
    const { repo, evidenciaCreateMany } = buildTxRepo();
    await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "rechazada", motivo: "x", evidencias: evidencias3 },
      nuevoEstatusId: idEstado("rechazada"),
    });
    const arg = (evidenciaCreateMany.mock.calls[0] as unknown[])[0] as { data: { indice: number }[] };
    expect(arg.data.map((e) => e.indice)).toEqual([0, 1, 2]);
  });
});

describe("crearGestionYTransicionar — dual-write de la portada (R12)", () => {
  it("R12: la evidencia indice 0 se copia a evidencia_storage_path/_content_type en el MISMO insert", async () => {
    const { repo, gestionCreate } = buildTxRepo();
    await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "entregada", montoRecibido: 100, metodoPago: "efectivo", evidencias: evidencias3 },
      nuevoEstatusId: idEstado("entregada"),
    });
    const gArg = (gestionCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(gArg.data.evidenciaStoragePath).toBe("o1/entregada-1-0.jpg");
    expect(gArg.data.evidenciaContentType).toBe("image/jpeg");
  });

  it("R12: la portada es la de indice 0 aunque la lista NO venga ordenada por indice", async () => {
    const { repo, gestionCreate } = buildTxRepo();
    const desordenadas = [
      { storagePath: "p1", contentType: "image/png", indice: 1 },
      { storagePath: "p0", contentType: "image/jpeg", indice: 0 },
    ];
    await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "rechazada", motivo: "x", evidencias: desordenadas },
      nuevoEstatusId: idEstado("rechazada"),
    });
    const gArg = (gestionCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(gArg.data.evidenciaStoragePath).toBe("p0");
    expect(gArg.data.evidenciaContentType).toBe("image/jpeg");
  });
});

describe("crearGestionYTransicionar — ramas sin foto (reprogramada)", () => {
  it("sin evidencias: NO llama createMany y la portada queda NULL", async () => {
    const { repo, gestionCreate, evidenciaCreateMany } = buildTxRepo();
    await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "reprogramada", fechaReprogramacion: "2027-01-01", motivo: "x" },
      nuevoEstatusId: idEstado("reprogramada"),
    });
    expect(evidenciaCreateMany).not.toHaveBeenCalled();
    const gArg = (gestionCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(gArg.data.evidenciaStoragePath).toBeNull();
    expect(gArg.data.evidenciaContentType).toBeNull();
  });
});
