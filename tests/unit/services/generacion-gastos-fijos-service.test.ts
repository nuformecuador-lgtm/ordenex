import { describe, it, expect, vi } from "vitest";
import { GeneracionGastosFijosService } from "@/lib/services/GeneracionGastosFijosService";
import type { IGastoFijoPlantillaRepository } from "@/lib/interfaces/repositories/IGastoFijoPlantillaRepository";
import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { WalletTxClient } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";

// Feature 45 + 84 (R27/R28/R30/R31) — logica del cron DIARIO. De las plantillas ACTIVAS genera UN
// egreso egreso_gasto_fijo por cada una que APLICA HOY (origen_id "<plantillaId>:<periodo>",
// monto=plantilla STRING, autor NULL); las inactivas nunca entran; un unico createMany (atomico).
// Dobles de repo (sin DB/HTTP). Reloj inyectado: mediodia CR = 18:00 UTC (UTC-6).

const NOW = new Date("2026-07-15T18:00:00.000Z"); // 12:00 CR del 15 jul

function plantilla(overrides: Partial<GastoFijoPlantillaDTO> = {}): GastoFijoPlantillaDTO {
  return {
    id: "p-alquiler",
    concepto: "Alquiler",
    monto: "80000.00",
    activa: true,
    periodicidadUnidad: "meses",
    periodicidadCantidad: 1,
    fechaCobro: "2026-07-15", // ancla el 15 -> aplica el 15 jul (NOW)
    requiereAprobacion: true, // ficha 333/R1
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
    // Feature 170 (T I.1): listado paginado; el cron no lo usa.
    listarPaginado: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    obtenerPorId: vi.fn(),
    // Ficha 332: el borrado entra en el contrato del repositorio; el cron NO lo usa (ni debe).
    eliminar: vi.fn(),
  };
}

function buildMovimientoRepo(count: number): IWalletMovimientoRepository {
  return {
    crearMovimientos: vi.fn().mockResolvedValue(count),
    listar: vi.fn(),
    agregarPorCategoriaYTipo: vi.fn(),
    obtenerPorId: vi.fn(),
    agregarPorCategoria: vi.fn(),
    obtenerPorOrigen: vi.fn(), // ficha 333: lectura por la clave del libro; este camino no la usa
  };
}

const writeClient = {} as WalletTxClient;

function movsDe(movRepo: IWalletMovimientoRepository) {
  return (movRepo.crearMovimientos as ReturnType<typeof vi.fn>).mock.calls[0][1];
}

describe("GeneracionGastosFijosService — solo cobra lo que aplica hoy (feature 84)", () => {
  it("genera un egreso por plantilla que aplica hoy; forma correcta de cada fila", async () => {
    const activas = [
      plantilla(), // mensual dia 15 -> aplica el 15
      plantilla({ id: "p-internet", concepto: "Internet", monto: "25000.00", fechaCobro: "2026-07-15" }),
    ];
    const movRepo = buildMovimientoRepo(2);
    const svc = new GeneracionGastosFijosService(buildPlantillaRepo(activas), movRepo, writeClient);

    const r = await svc.ejecutarGeneracion(NOW);

    expect(r).toEqual({
      fecha: "2026-07-15",
      plantillasActivas: 2,
      plantillasQueAplicanHoy: 2,
      egresosGenerados: 2,
    });
    const movs = movsDe(movRepo);
    expect(movs).toHaveLength(2);
    expect(movs[0]).toEqual({
      tipo: "egreso",
      categoria: "egreso_gasto_fijo",
      monto: "80000.00", // money-safe: STRING
      origenTipo: "gasto",
      origenId: "p-alquiler:2026-07", // meses -> clave :YYYY-MM
      descripcion: "Alquiler — 2026-07",
      registradoPor: null, // generacion automatica
    });
  });

  it("una plantilla que NO aplica hoy queda fuera del createMany", async () => {
    const activas = [
      plantilla({ id: "aplica", fechaCobro: "2026-07-15" }), // aplica el 15
      plantilla({ id: "no-aplica", fechaCobro: "2026-07-20" }), // mensual dia 20 -> NO el 15
    ];
    const movRepo = buildMovimientoRepo(1);
    const svc = new GeneracionGastosFijosService(buildPlantillaRepo(activas), movRepo, writeClient);

    const r = await svc.ejecutarGeneracion(NOW);

    expect(r).toMatchObject({ plantillasActivas: 2, plantillasQueAplicanHoy: 1, egresosGenerados: 1 });
    const movs = movsDe(movRepo);
    expect(movs).toHaveLength(1);
    expect(movs[0].origenId).toBe("aplica:2026-07");
  });

  it("R31: un UNICO createMany para toda la corrida (atomico)", async () => {
    const movRepo = buildMovimientoRepo(1);
    const svc = new GeneracionGastosFijosService(buildPlantillaRepo([plantilla()]), movRepo, writeClient);
    await svc.ejecutarGeneracion(NOW);
    expect(movRepo.crearMovimientos).toHaveBeenCalledTimes(1);
  });

  it("R27: las plantillas INACTIVAS no entran (el service consume listarActivas, no listar)", async () => {
    const plantillaRepo = buildPlantillaRepo([]); // el repo de activas no las devuelve
    const movRepo = buildMovimientoRepo(0);
    const svc = new GeneracionGastosFijosService(plantillaRepo, movRepo, writeClient);

    const r = await svc.ejecutarGeneracion(NOW);

    expect(plantillaRepo.listarActivas).toHaveBeenCalledTimes(1);
    expect(plantillaRepo.listar).not.toHaveBeenCalled();
    expect(r).toEqual({
      fecha: "2026-07-15",
      plantillasActivas: 0,
      plantillasQueAplicanHoy: 0,
      egresosGenerados: 0,
    });
    expect(movsDe(movRepo)).toHaveLength(0);
  });
});

describe("GeneracionGastosFijosService — clave de idempotencia por unidad", () => {
  it("meses -> `:YYYY-MM`", async () => {
    const movRepo = buildMovimientoRepo(1);
    const svc = new GeneracionGastosFijosService(
      buildPlantillaRepo([plantilla({ periodicidadUnidad: "meses", fechaCobro: "2026-07-15" })]),
      movRepo,
      writeClient,
    );
    await svc.ejecutarGeneracion(NOW);
    expect(movsDe(movRepo)[0].origenId).toBe("p-alquiler:2026-07");
  });

  it("dias -> `:YYYY-MM-DD` (fecha CR del disparo)", async () => {
    const movRepo = buildMovimientoRepo(1);
    const svc = new GeneracionGastosFijosService(
      buildPlantillaRepo([plantilla({ periodicidadUnidad: "dias", periodicidadCantidad: 1, fechaCobro: "2026-07-10" })]),
      movRepo,
      writeClient,
    );
    await svc.ejecutarGeneracion(NOW);
    expect(movsDe(movRepo)[0].origenId).toBe("p-alquiler:2026-07-15");
  });

  it("semanas -> `:YYYY-MM-DD`", async () => {
    const movRepo = buildMovimientoRepo(1);
    const svc = new GeneracionGastosFijosService(
      buildPlantillaRepo([plantilla({ periodicidadUnidad: "semanas", periodicidadCantidad: 1, fechaCobro: "2026-07-01" })]),
      movRepo,
      writeClient,
    );
    await svc.ejecutarGeneracion(NOW); // 2026-07-01 + 2 semanas = 2026-07-15 -> aplica
    expect(movsDe(movRepo)[0].origenId).toBe("p-alquiler:2026-07-15");
  });

  it("REGRESION: una plantilla mensual pre-migracion (backfill fecha_cobro=dia 1) conserva la clave `:YYYY-MM` — sin doble cobro tras el deploy", async () => {
    // Backfill: `fecha_cobro = date_trunc('month', created_at)::date` -> dia 1. En el dia 1 del
    // mes aplica y la clave es la MISMA que emitia el cron mensual pre-84 (`:YYYY-MM`), asi que el
    // egreso viejo y el nuevo colisionan en el indice unico y skipDuplicates evita el doble cobro.
    const dia1 = new Date("2026-08-01T18:00:00.000Z"); // 12:00 CR del 1 ago
    const legacy = plantilla({ id: "p-legacy", periodicidadUnidad: "meses", periodicidadCantidad: 1, fechaCobro: "2026-01-01" });
    const movRepo = buildMovimientoRepo(0); // ON CONFLICT DO NOTHING: la clave ya existia
    const svc = new GeneracionGastosFijosService(buildPlantillaRepo([legacy]), movRepo, writeClient);

    const r = await svc.ejecutarGeneracion(dia1);

    expect(movsDe(movRepo)[0].origenId).toBe("p-legacy:2026-08"); // formato legacy intacto
    expect(r.egresosGenerados).toBe(0); // no reinserta -> no duplica plata
  });

  it("reejecucion del mismo dia inserta 0 (createMany devuelve 0)", async () => {
    const movRepo = buildMovimientoRepo(0); // ON CONFLICT DO NOTHING
    const svc = new GeneracionGastosFijosService(buildPlantillaRepo([plantilla()]), movRepo, writeClient);
    const r = await svc.ejecutarGeneracion(NOW);
    expect(r).toMatchObject({ plantillasQueAplicanHoy: 1, egresosGenerados: 0 });
  });
});
