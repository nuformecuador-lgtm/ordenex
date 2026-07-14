import { describe, it, expect, vi } from "vitest";
import { GeneracionGastosFijosService } from "@/lib/services/GeneracionGastosFijosService";
import type { IGastoFijoPlantillaRepository } from "@/lib/interfaces/repositories/IGastoFijoPlantillaRepository";
import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { WalletTxClient } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";

// Feature 45 (R27/R28/R30/R31) — logica del cron. Genera UN egreso egreso_gasto_fijo por
// plantilla ACTIVA (origen_id derivado "<plantillaId>:<periodo>", monto=plantilla, autor NULL);
// las inactivas NO entran (el service lee listarActivas, no listar); periodo YYYY-MM en hora CR;
// un unico createMany (atomico). Dobles de repo (sin DB/HTTP).

const NOW = new Date("2026-07-15T18:00:00.000Z"); // 12:00 CR del 15 jul -> periodo "2026-07"

function plantilla(overrides: Partial<GastoFijoPlantillaDTO> = {}): GastoFijoPlantillaDTO {
  return {
    id: "p-alquiler",
    concepto: "Alquiler",
    monto: "80000.00",
    activa: true,
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    ...overrides,
  };
}

function buildPlantillaRepo(activas: GastoFijoPlantillaDTO[]): IGastoFijoPlantillaRepository {
  return {
    crear: vi.fn(),
    actualizar: vi.fn(),
    setActiva: vi.fn(),
    listar: vi.fn(),
    listarActivas: vi.fn().mockResolvedValue(activas),
    obtenerPorId: vi.fn(),
  };
}

function buildMovimientoRepo(count: number): IWalletMovimientoRepository {
  return {
    crearMovimientos: vi.fn().mockResolvedValue(count),
    listar: vi.fn(),
    agregarBalance: vi.fn(),
    obtenerPorId: vi.fn(),
    agregarPorCategoria: vi.fn(),
  };
}

const writeClient = {} as WalletTxClient;

describe("GeneracionGastosFijosService.ejecutarGeneracion (R27/R30/R31)", () => {
  it("R27/R30: genera un egreso por plantilla activa; forma correcta de cada fila", async () => {
    const activas = [
      plantilla(),
      plantilla({ id: "p-internet", concepto: "Internet", monto: "25000.00" }),
    ];
    const movRepo = buildMovimientoRepo(2);
    const svc = new GeneracionGastosFijosService(buildPlantillaRepo(activas), movRepo, writeClient);

    const r = await svc.ejecutarGeneracion(NOW);

    expect(r).toEqual({ periodo: "2026-07", plantillasActivas: 2, egresosGenerados: 2 });
    const movs = (movRepo.crearMovimientos as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(movs).toHaveLength(2);
    expect(movs[0]).toEqual({
      tipo: "egreso",
      categoria: "egreso_gasto_fijo",
      monto: "80000.00",
      origenTipo: "gasto",
      origenId: "p-alquiler:2026-07", // R28: clave de idempotencia (plantilla, periodo)
      descripcion: "Alquiler — 2026-07",
      registradoPor: null, // R27: generacion automatica
    });
    expect(movs[1]).toMatchObject({
      categoria: "egreso_gasto_fijo",
      monto: "25000.00",
      origenId: "p-internet:2026-07",
    });
  });

  it("R31: un UNICO createMany para toda la corrida (atomico)", async () => {
    const movRepo = buildMovimientoRepo(1);
    const svc = new GeneracionGastosFijosService(buildPlantillaRepo([plantilla()]), movRepo, writeClient);
    await svc.ejecutarGeneracion(NOW);
    expect(movRepo.crearMovimientos).toHaveBeenCalledTimes(1);
  });

  it("R27: las plantillas INACTIVAS no entran (el service consume listarActivas, no listar)", async () => {
    const plantillaRepo = buildPlantillaRepo([]); // no hay activas
    const movRepo = buildMovimientoRepo(0);
    const svc = new GeneracionGastosFijosService(plantillaRepo, movRepo, writeClient);

    const r = await svc.ejecutarGeneracion(NOW);

    expect(plantillaRepo.listarActivas).toHaveBeenCalledTimes(1);
    expect(plantillaRepo.listar).not.toHaveBeenCalled();
    expect(r).toEqual({ periodo: "2026-07", plantillasActivas: 0, egresosGenerados: 0 });
    // createMany se llama con [] (crearMovimientos hace no-op sobre lista vacia).
    const movs = (movRepo.crearMovimientos as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(movs).toHaveLength(0);
  });

  it("R28: en una reejecucion (createMany devuelve 0) reporta egresosGenerados=0 sin fallar", async () => {
    const movRepo = buildMovimientoRepo(0); // ON CONFLICT DO NOTHING: nada nuevo
    const svc = new GeneracionGastosFijosService(buildPlantillaRepo([plantilla()]), movRepo, writeClient);
    const r = await svc.ejecutarGeneracion(NOW);
    expect(r).toEqual({ periodo: "2026-07", plantillasActivas: 1, egresosGenerados: 0 });
  });
});
