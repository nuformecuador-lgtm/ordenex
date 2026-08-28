import { describe, it, expect, vi } from "vitest";
import { LiberacionReprogramadaService } from "@/lib/services/LiberacionReprogramadaService";
import type {
  ILiberacionReprogramadaRepository,
  LiberarOrdenInput,
  OrdenLiberableRow,
} from "@/lib/interfaces/repositories/ILiberacionReprogramadaRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";

// Feature 46 (R12/R13/R14/R17) — service de la liberacion programada. Dobles de repo
// (sin DB/HTTP). Cubre: destino correcto por zona (central -> en_bodega_central, satelite ->
// en_bodega_satelite); limpia mensajero + marca (via los args a liberarOrden); resumen
// de conteos; una orden que falla -> omitidas++ y continua; segunda corrida no re-libera.

const CENTRAL = "z-central";
const SATELITE = "z-limon";
const HOY = new Date("2026-07-15T00:00:00.000Z");

const ESTATUS_ID_BY_VALUE: Record<string, string> = {
  reprogramada: "os-reprogramada",
  en_bodega_central: "os-en-bodega",
  en_bodega_satelite: "os-en-bodega-satelite",
};

/**
 * FEATURE 276 (T6.2): la fila gana tres hechos, y el DEFAULT es «visita real de un cierre YA
 * APROBADO».
 *
 * La eleccion del default no es neutra y por eso se explica: es el caso REAL de una orden que se
 * libera despues de la 276 —el mensajero la reprogramo en la calle y su cierre ya se aprobo—, asi
 * que los casos preexistentes de este archivo siguen midiendo lo que median (destino por zona,
 * idempotencia, resiliencia) sobre una orden que de verdad puede liberarse. Un default
 * `gestionEsVisitaReal: false` habria sido mas comodo y habria dejado todos esos casos entrando
 * por la rama (a) de `puedeLiberarse`, que no es la que ejercitan.
 */
function liberableRow(overrides: Partial<OrdenLiberableRow> = {}): OrdenLiberableRow {
  return {
    id: "o1",
    zonaId: CENTRAL,
    fechaReprogramacion: new Date("2026-07-14T00:00:00.000Z"),
    gestionCierreId: "c-aprobado",
    gestionCierreEstado: "aprobado",
    gestionEsVisitaReal: true,
    ...overrides,
  };
}

function fakeRepo(
  overrides: Partial<ILiberacionReprogramadaRepository> = {},
): ILiberacionReprogramadaRepository {
  return {
    findOrdenesLiberables: vi.fn(async () => [liberableRow()]),
    // FICHA 315: el disparador por cierre devuelve por defecto LO MISMO que el del reloj, para
    // que los casos que lo ejerciten midan la regla y no el doble.
    findOrdenesLiberablesDeCierre: vi.fn(async () => [liberableRow()]),
    liberarOrden: vi.fn(async () => true),
    findLiberadasHoy: vi.fn(async () => []),
    ...overrides,
  };
}

function fakeZonaRepo(centralId: string | null = CENTRAL): Pick<IZonaRepository, "findCentralZonaId"> {
  return { findCentralZonaId: vi.fn(async () => centralId) };
}

function fakeOrdenRepo(
  map: Record<string, string> = ESTATUS_ID_BY_VALUE,
): Pick<IOrdenRepository, "findEstatusIdByValue"> {
  return { findEstatusIdByValue: vi.fn(async (v: string) => map[v] ?? null) };
}

function newService(
  repo: ILiberacionReprogramadaRepository = fakeRepo(),
  zonaRepo = fakeZonaRepo(),
  ordenRepo = fakeOrdenRepo(),
) {
  return new LiberacionReprogramadaService(
    repo,
    zonaRepo as unknown as IZonaRepository,
    ordenRepo as unknown as IOrdenRepository,
    { warn: vi.fn() },
  );
}

describe("ejecutarLiberacion — destino por zona (R12)", () => {
  it("R12: orden de la zona central -> destino en_bodega_central", async () => {
    const liberar = vi.fn<(input: LiberarOrdenInput) => Promise<boolean>>(async () => true);
    const repo = fakeRepo({
      findOrdenesLiberables: vi.fn(async () => [liberableRow({ id: "o-central", zonaId: CENTRAL })]),
      liberarOrden: liberar,
    });
    await newService(repo).ejecutarLiberacion(HOY);

    const arg = liberar.mock.calls[0][0] as LiberarOrdenInput;
    expect(arg.destinoEstatusId).toBe("os-en-bodega");
    expect(arg.estatusReprogramadaId).toBe("os-reprogramada");
  });

  it("R12: orden de zona satelite -> destino en_bodega_satelite", async () => {
    const liberar = vi.fn<(input: LiberarOrdenInput) => Promise<boolean>>(async () => true);
    const repo = fakeRepo({
      findOrdenesLiberables: vi.fn(async () => [liberableRow({ id: "o-sat", zonaId: SATELITE })]),
      liberarOrden: liberar,
    });
    await newService(repo).ejecutarLiberacion(HOY);

    const arg = liberar.mock.calls[0][0] as LiberarOrdenInput;
    expect(arg.destinoEstatusId).toBe("os-en-bodega-satelite");
  });

  it("R12: sin zona central configurada (null) -> toda orden cae a satelite (fallback seguro)", async () => {
    const liberar = vi.fn<(input: LiberarOrdenInput) => Promise<boolean>>(async () => true);
    const repo = fakeRepo({
      findOrdenesLiberables: vi.fn(async () => [liberableRow({ zonaId: CENTRAL })]),
      liberarOrden: liberar,
    });
    await newService(repo, fakeZonaRepo(null)).ejecutarLiberacion(HOY);

    const arg = liberar.mock.calls[0][0] as LiberarOrdenInput;
    expect(arg.destinoEstatusId).toBe("os-en-bodega-satelite");
  });
});

describe("ejecutarLiberacion — marca de corrida (R13)", () => {
  it("R13: pasa una corridaAt unica a liberarOrden (misma para todas las ordenes)", async () => {
    const liberar = vi.fn<(input: LiberarOrdenInput) => Promise<boolean>>(async () => true);
    const repo = fakeRepo({
      findOrdenesLiberables: vi.fn(async () => [
        liberableRow({ id: "o1" }),
        liberableRow({ id: "o2" }),
      ]),
      liberarOrden: liberar,
    });
    await newService(repo).ejecutarLiberacion(HOY);

    const a0 = liberar.mock.calls[0][0] as LiberarOrdenInput;
    const a1 = liberar.mock.calls[1][0] as LiberarOrdenInput;
    expect(a0.corridaAt).toBeInstanceOf(Date);
    expect(a0.corridaAt.getTime()).toBe(a1.corridaAt.getTime());
  });
});

describe("ejecutarLiberacion — resumen de conteos", () => {
  it("R7: evaluadas = candidatas; liberadas = las que devolvieron true", async () => {
    const repo = fakeRepo({
      findOrdenesLiberables: vi.fn(async () => [
        liberableRow({ id: "o1" }),
        liberableRow({ id: "o2" }),
        liberableRow({ id: "o3" }),
      ]),
      liberarOrden: vi.fn(async (input: LiberarOrdenInput) => input.ordenId !== "o2"),
    });
    const res = await newService(repo).ejecutarLiberacion(HOY);

    expect(res).toEqual({ evaluadas: 3, liberadas: 2, omitidas: 1, esperandoCierre: 0 });
  });

  it("nada que liberar -> resumen en cero", async () => {
    const repo = fakeRepo({ findOrdenesLiberables: vi.fn(async () => []) });
    const res = await newService(repo).ejecutarLiberacion(HOY);
    expect(res).toEqual({ evaluadas: 0, liberadas: 0, omitidas: 0, esperandoCierre: 0 });
  });
});

describe("ejecutarLiberacion — resiliencia por orden (R14)", () => {
  it("R14: una orden que lanza -> omitidas++ y continua con el resto", async () => {
    const repo = fakeRepo({
      findOrdenesLiberables: vi.fn(async () => [
        liberableRow({ id: "o1" }),
        liberableRow({ id: "o2-boom" }),
        liberableRow({ id: "o3" }),
      ]),
      liberarOrden: vi.fn(async (input: LiberarOrdenInput) => {
        if (input.ordenId === "o2-boom") throw new Error("db down");
        return true;
      }),
    });
    const res = await newService(repo).ejecutarLiberacion(HOY);

    // o1 y o3 se liberan; o2 se contabiliza como omitida sin abortar.
    expect(res).toEqual({ evaluadas: 3, liberadas: 2, omitidas: 1, esperandoCierre: 0 });
  });
});

describe("ejecutarLiberacion — idempotencia (R17/T8)", () => {
  it("segunda corrida: la orden ya salio de reprogramada -> findOrdenesLiberables vacio -> liberadas=0", async () => {
    // 1a corrida: hay una candidata y se libera.
    const primeraCandidata = [liberableRow({ id: "o1" })];
    const findMany = vi
      .fn()
      .mockResolvedValueOnce(primeraCandidata) // corrida 1
      .mockResolvedValueOnce([]); // corrida 2: ya no esta en reprogramada
    const repo = fakeRepo({ findOrdenesLiberables: findMany, liberarOrden: vi.fn(async () => true) });
    const service = newService(repo);

    const r1 = await service.ejecutarLiberacion(HOY);
    const r2 = await service.ejecutarLiberacion(HOY);

    expect(r1).toEqual({ evaluadas: 1, liberadas: 1, omitidas: 0, esperandoCierre: 0 });
    expect(r2).toEqual({ evaluadas: 0, liberadas: 0, omitidas: 0, esperandoCierre: 0 });
  });

  it("R17: la guarda de estado (liberarOrden -> false) cuenta como omitida, no re-libera", async () => {
    const repo = fakeRepo({ liberarOrden: vi.fn(async () => false) });
    const res = await newService(repo).ejecutarLiberacion(HOY);
    expect(res).toEqual({ evaluadas: 1, liberadas: 0, omitidas: 1, esperandoCierre: 0 });
  });
});

describe("ejecutarLiberacion — seed incompleto", () => {
  it("catalogo de estados incompleto -> no libera, resumen en cero, no consulta candidatas", async () => {
    const repo = fakeRepo();
    const res = await newService(repo, fakeZonaRepo(), fakeOrdenRepo({})).ejecutarLiberacion(HOY);
    expect(res).toEqual({ evaluadas: 0, liberadas: 0, omitidas: 0, esperandoCierre: 0 });
    expect(repo.findOrdenesLiberables).not.toHaveBeenCalled();
    expect(repo.liberarOrden).not.toHaveBeenCalled();
  });
});
