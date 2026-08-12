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
import { conPagos } from "@/tests/fixtures/cierre-pagos";

// Feature 41/C3 (R6/R7/R9/R10/P2 + R4) — logica del corte diario con dobles (sin DB).
// Crea un `vencido` por mensajero que "debia cerrar", omite el sin zona (P2), no duplica
// (R9), y congela el snapshot al crear (R4: no recalcula).

const TARIFA: PagoTarifa = { cobroEntregado: "5.00", cobroRechazado: "3.00" };
const ZONA_CENTRAL = "z-central";

function gestion(overrides: Partial<CierreGestionPendienteRow> = {}): CierreGestionPendienteRow {
  // Feature 208/T9: el desglose es OBLIGATORIO en la fila. Por defecto se deriva del par
  // escalar (UNA linea, igual que el backfill), asi que los casos previos no cambian; un
  // caso que quiera un cobro MIXTO pasa sus propias lineas en `overrides.pagos`.
  const { pagos, ...resto } = overrides;
  const fila: Omit<CierreGestionPendienteRow, "pagos"> = {
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
    esRechazoSla: false, // feature 102
    // Feature 158/R9/R19: campos POR RAMA del incidente. `null` por defecto en el resto
    // de resultados; los casos del incidente los sobreescriben.
    causaIncidente: null,
    indemnizacion: null,
    ...resto,
  };
  return conPagos(fila, pagos);
}

// Feature 109 (T1.3): ids del catalogo que el service resuelve UNA vez por corrida para la
// transicion `en_reparto -> sin_gestionar`. Por defecto ambos presentes; `null` simula seed pendiente.
const ESTATUS_IDS: Record<string, string | null> = {
  en_reparto: "s-reparto",
  sin_gestionar: "s-sin-gestionar",
};

function build(opts: {
  mensajeros?: MensajeroSinCierreRow[];
  gestionesByMensajero?: Record<string, CierreGestionPendienteRow[]>;
  centralZonaId?: string | null;
  crearCierre?: ReturnType<typeof vi.fn>;
  estatusIds?: Record<string, string | null>; // feature 109: override en_reparto/sin_gestionar
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
  const estatusIds = opts.estatusIds ?? ESTATUS_IDS;
  const findEstatusIdByValue = vi.fn(async (v: string) => estatusIds[v] ?? null);
  const ordenRepo = {
    findUsuarioVehiculoId: vi.fn(async () => null),
    // Feature 109/T1.3: resuelve en_reparto/sin_gestionar para la transicion del corte.
    findEstatusIdByValue,
  } as unknown as Pick<IOrdenRepository, "findUsuarioVehiculoId" | "findEstatusIdByValue">;
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
  return { service, corteRepo, cierreRepo, crearCierre, findEstatusIdByValue, logger };
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

  // Feature 109 (R8): 0 gestiones YA NO corta el flujo (antes hacia `continue`). El mensajero
  // puede estar en la lista SOLO por ordenes `en_reparto` -> se llama crearCierre igual (con
  // corteSinGestionar) para el `vencido` money-neutral. El null (verdadero no-op) lo decide el repo.
  it("R8: 0 gestiones NO corta el flujo — llama crearCierre con corteSinGestionar (vencido money-neutral)", async () => {
    const { service, crearCierre } = build({
      mensajeros: [{ mensajeroId: "m1", zonaId: "z-cartago" }],
      gestionesByMensajero: { m1: [] },
    });

    const res = await service.ejecutarCorte();

    expect(crearCierre).toHaveBeenCalledTimes(1);
    const arg = crearCierre.mock.calls[0][0];
    expect(arg.estado).toBe("vencido"); // R7
    // R4/R6: la transicion en_reparto -> sin_gestionar viaja en el input del corte.
    expect(arg.corteSinGestionar).toEqual({
      enRepartoEstatusId: "s-reparto",
      sinGestionarEstatusId: "s-sin-gestionar",
    });
    // El doble por defecto devuelve "cv" -> cuenta 1 (el repo decidiria null si nada paso).
    expect(res.vencidosCreados).toBe(1);
  });

  // Feature 109 (R5): la transicion aplica EXCLUSIVAMENTE a `en_reparto`. El service resuelve y
  // pasa el id de `en_reparto` como `enRepartoEstatusId` (guarda del updateMany en el repo); NUNCA
  // resuelve/pasa `por_recoger` -> una orden en ese estado no puede transicionar.
  it("R5: el corte solo apunta a `en_reparto` (nunca `por_recoger`)", async () => {
    const { service, crearCierre, findEstatusIdByValue } = build({
      mensajeros: [{ mensajeroId: "m1", zonaId: "z-cartago" }],
    });

    await service.ejecutarCorte();

    const pedidos = findEstatusIdByValue.mock.calls.map((c) => c[0]);
    expect(pedidos).toContain("en_reparto");
    expect(pedidos).toContain("sin_gestionar");
    expect(pedidos).not.toContain("por_recoger");
    expect(crearCierre.mock.calls[0][0].corteSinGestionar.enRepartoEstatusId).toBe("s-reparto");
  });

  // Feature 109 (defensivo): catalogo sin `sin_gestionar` (seed pendiente) -> no se pasa
  // corteSinGestionar; el corte se comporta como la 41 (solo `vencido` por gestiones).
  it("catalogo sin `sin_gestionar` -> crearCierre SIN corteSinGestionar (fallback 41)", async () => {
    const { service, crearCierre } = build({
      mensajeros: [{ mensajeroId: "m1", zonaId: "z-cartago" }],
      estatusIds: { en_reparto: "s-reparto", sin_gestionar: null },
    });

    await service.ejecutarCorte();

    expect(crearCierre.mock.calls[0][0].corteSinGestionar).toBeUndefined();
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

// ============================================================================
// Feature 69 / decision (f) — el corte diario queda cubierto POR CONSTRUCCION.
// ============================================================================

describe("Feature 69/(f) — el corte diario congela cierre_detail por el mismo camino", () => {
  // El snapshot (`cierre_detail`) se puebla DENTRO de `CierreDiaRepository.crearCierre`
  // (design §3). Eso cubre los DOS caminos de creacion de cierres — la solicitud del
  // mensajero (37) y el corte diario (41) — sin tocar ningun service, porque ambos llaman al
  // MISMO metodo del MISMO repo. Verificado ademas que `CorteDiarioRepository` solo CONSULTA
  // (`findMensajerosConActividadSinCierre`): no crea cierres.
  //
  // Esta es la red de regresion de esa propiedad: si alguien anadiera un TERCER punto de
  // escritura (p.ej. que el corte insertara `cierre_dia` por su cuenta para "optimizar"), ese
  // camino NO congelaria el detalle y sus cierres quedarian sin filas -> con R14 (sin
  // fallback) su aprobacion abortaria en produccion. El test falla si el `vencido` deja de
  // pasar por `cierreRepo.crearCierre`.
  it("el cierre `vencido` se crea por cierreRepo.crearCierre (unico punto de escritura, (f))", async () => {
    const { service, crearCierre, cierreRepo } = build({
      mensajeros: [{ mensajeroId: "m1", zonaId: "z-cartago" }],
    });

    const res = await service.ejecutarCorte();

    expect(res.vencidosCreados).toBe(1);
    // El corte NO tiene camino propio de INSERT: delega en el repo que congela el snapshot.
    expect(crearCierre).toHaveBeenCalledTimes(1);
    expect(crearCierre.mock.calls[0][0]).toMatchObject({ mensajeroId: "m1", estado: "vencido" });
    // El service del corte no conoce `cierre_detail` ni la tarifa vigente: el snapshot es
    // asunto del repo, dentro de su tx (design §3.2, `CrearCierreInput` NO se extiende).
    expect(Object.keys(crearCierre.mock.calls[0][0])).not.toContain("cierreDetail");
    expect(cierreRepo).not.toHaveProperty("crearCierreDetail");
  });
});
