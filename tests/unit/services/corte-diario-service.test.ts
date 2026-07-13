import { describe, it, expect, vi } from "vitest";
import { CorteDiarioService } from "@/lib/services/CorteDiarioService";
import type {
  ICorteDiarioRepository,
  MensajeroSinCierreRow,
} from "@/lib/interfaces/repositories/ICorteDiarioRepository";
import type {
  CierreGestionPendienteRow,
  ICierreDiaRepository,
} from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type {
  ITarifaZonaMensajeroRepository,
  PagoTarifa,
} from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";

// Feature 41/C3 (R6/R7/R9/R10/P2 + R4) — logica del corte diario con dobles (sin DB).
// Crea un `vencido` por mensajero que "debia cerrar", omite el sin zona (P2), no duplica
// (R9), y congela el snapshot al crear (R4: no recalcula).

const TARIFA: PagoTarifa = { cobroEntregado: "5.00", cobroRechazado: "3.00" };
const ZONA_CENTRAL = "z-central";

function gestion(overrides: Partial<CierreGestionPendienteRow> = {}): CierreGestionPendienteRow {
  return {
    gestionId: "g1",
    ordenId: "o1",
    numGuia: 1,
    numRemision: "R1",
    destinatario: "Ana",
    direccion: null,
    zonaNombre: "Z",
    provinciaNombre: "P",
    cantonNombre: "C",
    distritoNombre: null,
    producto: "X",
    tiendaNombre: "T",
    resultado: "entregada",
    montoRecibido: "10.00",
    metodoPago: "efectivo",
    motivo: null,
    fechaReprogramacion: null,
    evidenciaStoragePath: null,
    pagoMensajero: null,
    ingresoBodegaRechazo: null,
    ...overrides,
  };
}

function build(opts: {
  mensajeros?: MensajeroSinCierreRow[];
  gestionesByMensajero?: Record<string, CierreGestionPendienteRow[]>;
  centralZonaId?: string | null;
  crearCierre?: ReturnType<typeof vi.fn>;
} = {}) {
  const corteRepo: ICorteDiarioRepository = {
    findMensajerosConActividadSinCierre: vi.fn(async () => opts.mensajeros ?? []),
  };
  const crearCierre = opts.crearCierre ?? vi.fn(async () => "cv");
  const cierreRepo = {
    findGestionesPendientes: vi.fn(
      async (m: string) => opts.gestionesByMensajero?.[m] ?? [gestion()],
    ),
    crearCierre,
  } as unknown as Pick<ICierreDiaRepository, "findGestionesPendientes" | "crearCierre">;
  const zonaRepo = {
    findCentralZonaId: vi.fn(async () =>
      opts.centralZonaId === undefined ? ZONA_CENTRAL : opts.centralZonaId,
    ),
  } as unknown as Pick<IZonaRepository, "findCentralZonaId">;
  const ordenRepo = {
    findUsuarioVehiculoId: vi.fn(async () => null),
  } as unknown as Pick<IOrdenRepository, "findUsuarioVehiculoId">;
  const tarifaZonaRepo: ITarifaZonaMensajeroRepository = {
    resolvePagoTarifa: vi.fn(async () => TARIFA),
  };
  const logger = { warn: vi.fn() };
  const service = new CorteDiarioService(
    corteRepo,
    cierreRepo,
    zonaRepo as IZonaRepository,
    ordenRepo as IOrdenRepository,
    tarifaZonaRepo,
    logger,
  );
  return { service, corteRepo, cierreRepo, crearCierre, logger };
}

describe("CorteDiarioService.ejecutarCorte", () => {
  it("R6/R7: crea un 'vencido' por mensajero con actividad; destino derivado por zona", async () => {
    const { service, crearCierre } = build({
      mensajeros: [
        { mensajeroId: "m1", zonaId: "z-cartago" }, // satelite
        { mensajeroId: "m2", zonaId: ZONA_CENTRAL }, // central
      ],
    });

    const res = await service.ejecutarCorte();

    expect(res).toEqual({ mensajerosEvaluados: 2, vencidosCreados: 2, mensajerosSinZona: 0 });
    expect(crearCierre).toHaveBeenCalledTimes(2);
    const primera = crearCierre.mock.calls[0][0];
    expect(primera.estado).toBe("vencido"); // R6
    expect(primera).toMatchObject({
      mensajeroId: "m1",
      destinoTipo: "bodega_satelite",
      destinoZonaId: "z-cartago",
    });
    const segunda = crearCierre.mock.calls[1][0];
    expect(segunda).toMatchObject({ mensajeroId: "m2", destinoTipo: "bodega_central" });
  });

  it("R4: congela el snapshot al crear (totales money-safe calculados en ese instante)", async () => {
    const { service, crearCierre } = build({
      mensajeros: [{ mensajeroId: "m1", zonaId: "z-cartago" }],
      gestionesByMensajero: {
        m1: [
          gestion({ gestionId: "a", montoRecibido: "12.50", metodoPago: "efectivo" }),
          gestion({ gestionId: "b", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
        ],
      },
    });

    await service.ejecutarCorte();

    const arg = crearCierre.mock.calls[0][0];
    expect(arg.totales).toEqual({
      efectivo: "12.50",
      simpe: "0.00",
      transferencia: "0.00",
      general: "12.50",
    });
    // pago snapshot: entregada 5.00, rechazada 0.00; ingreso bodega: rechazada 3.00.
    expect(arg.totalPagoMensajero).toBe("5.00");
    expect(arg.totalIngresoBodegaRechazos).toBe("3.00");
  });

  it("P2: mensajero sin zona -> se omite, no crea vencido, log de aviso agregado", async () => {
    const { service, crearCierre, cierreRepo, logger } = build({
      mensajeros: [{ mensajeroId: "m1", zonaId: null }],
    });

    const res = await service.ejecutarCorte();

    expect(res).toEqual({ mensajerosEvaluados: 1, vencidosCreados: 0, mensajerosSinZona: 1 });
    expect(crearCierre).not.toHaveBeenCalled();
    expect(cierreRepo.findGestionesPendientes).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    // R24: el aviso NO incluye PII (solo el conteo).
    expect((logger.warn as ReturnType<typeof vi.fn>).mock.calls[0][0]).not.toContain("m1");
  });

  it("R9 (idempotencia): si ya no hay gestiones pendientes -> no crea vencido", async () => {
    const { service, crearCierre } = build({
      mensajeros: [{ mensajeroId: "m1", zonaId: "z-cartago" }],
      gestionesByMensajero: { m1: [] }, // una corrida previa ya las vinculo
    });

    const res = await service.ejecutarCorte();

    expect(res.vencidosCreados).toBe(0);
    expect(crearCierre).not.toHaveBeenCalled();
  });

  it("R9/R23: crearCierre null (carrera) NO cuenta como creado", async () => {
    const { service } = build({
      mensajeros: [{ mensajeroId: "m1", zonaId: "z-cartago" }],
      crearCierre: vi.fn(async () => null),
    });

    const res = await service.ejecutarCorte();

    expect(res).toEqual({ mensajerosEvaluados: 1, vencidosCreados: 0, mensajerosSinZona: 0 });
  });

  it("sin mensajeros con actividad -> 0 vencidos, sin log", async () => {
    const { service, logger } = build({ mensajeros: [] });
    const res = await service.ejecutarCorte();
    expect(res).toEqual({ mensajerosEvaluados: 0, vencidosCreados: 0, mensajerosSinZona: 0 });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
