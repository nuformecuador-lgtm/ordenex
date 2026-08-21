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
  // Feature 212/T9: el desglose es OBLIGATORIO en la fila. Por defecto se deriva del par
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
    desdeAyudaTienda: false, // feature 237 (D6/R41): la registro el mensajero, no la tienda
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
  // Feature 235 (T4.4, R26): el corte barre TAMBIEN el estatus de la ayuda. Es OBLIGATORIO en
  // `CorteSinGestionarInput`, asi que sin este id el input no se arma y el barrido se omitiria
  // entero — de ahi que el fake lo conozca.
  ayuda_tienda: "s-ayuda",
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

    // Feature 246 (T2.1): reloj FIJO, porque `diaCerrado` entra en la igualdad exacta de abajo y
    // un reloj real la haria depender del dia en que se corra la suite.
    const res = await service.ejecutarCorte(new Date("2026-08-21T06:00:00.000Z"));

    expect(crearCierre).toHaveBeenCalledTimes(1);
    const arg = crearCierre.mock.calls[0][0];
    expect(arg.estado).toBe("vencido"); // R7
    // R4/R6 (+ 235/R26): las transiciones a `sin_gestionar` viajan en el input del corte, con los
    // DOS estados de origen. Igualdad EXACTA: si `ayudaEstatusId` se cayera del cableado, las
    // ordenes en ayuda se quedarian sin barrer cada noche y su mensajero, bloqueado para siempre.
    // Feature 246 (R11/R16): `diaCerrado` entra en la MISMA igualdad exacta y por el MISMO motivo
    // — si se cayera del cableado, el barrido perderia su criterio de dia en silencio.
    expect(arg.corteSinGestionar).toEqual({
      enRepartoEstatusId: "s-reparto",
      ayudaEstatusId: "s-ayuda",
      sinGestionarEstatusId: "s-sin-gestionar",
      diaCerrado: new Date("2026-08-20T00:00:00.000Z"),
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
    // Feature 235 (R26): tambien resuelve el estatus de la ayuda, porque tambien lo barre.
    expect(pedidos).toContain("ayuda_tienda");
    // Y lo que R5 protege sigue igual: `por_recoger` NUNCA se resuelve, asi que una orden que el
    // mensajero ni siquiera recogio no puede transicionar.
    expect(pedidos).not.toContain("por_recoger");
    expect(crearCierre.mock.calls[0][0].corteSinGestionar.enRepartoEstatusId).toBe("s-reparto");
    expect(crearCierre.mock.calls[0][0].corteSinGestionar.ayudaEstatusId).toBe("s-ayuda");
  });

  // Feature 235 (T4.4, R26): el fallback defensivo se extiende al tercer id. Los TRES o ninguno —
  // barrer `en_reparto` sin barrer `ayuda_tienda` dejaria al mensajero con ordenes colgando y su
  // cierre bloqueado, que es peor que no barrer nada y repetir el corte al dia siguiente.
  it("235: catalogo sin `ayuda_tienda` -> crearCierre SIN corteSinGestionar (mismo fallback)", async () => {
    const { service, crearCierre } = build({
      mensajeros: [{ mensajeroId: "m1", zonaId: "z-cartago" }],
      estatusIds: { en_reparto: "s-reparto", ayuda_tienda: null, sin_gestionar: "s-sin-gestionar" },
    });

    await service.ejecutarCorte();

    expect(crearCierre.mock.calls[0][0].corteSinGestionar).toBeUndefined();
  });

  // Feature 109 (defensivo): catalogo sin `sin_gestionar` (seed pendiente) -> no se pasa
  // corteSinGestionar; el corte se comporta como la 41 (solo `vencido` por gestiones).
  it("catalogo sin `sin_gestionar` -> crearCierre SIN corteSinGestionar (fallback 41)", async () => {
    const { service, crearCierre } = build({
      mensajeros: [{ mensajeroId: "m1", zonaId: "z-cartago" }],
      estatusIds: { en_reparto: "s-reparto", ayuda_tienda: "s-ayuda", sin_gestionar: null },
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

// =================================================================================================
// FEATURE 246 (T2.1, R16/R17) — EL ANCLA SE CALCULA UNA VEZ Y LLEGA IGUAL A LAS DOS CAPAS.
//
// Lo que este bloque mide NO es el `where` (eso vive en los tests de repositorio, que es donde
// vive el SQL): mide el CABLEADO. Que la seleccion y la escritura reciban el MISMO valor es la
// mitad de R16 que se puede afirmar desde aqui, y es la que la 235 dejo divergir.
// =================================================================================================
describe("246/R16/R17 — el dia que la corrida CIERRA, calculado una vez", () => {
  // 00:00 hora de pared de Costa Rica del 21 de agosto = 06:00Z. Es la hora a la que el cron
  // arranca de verdad (`0 6 * * *` UTC en `vercel.json`).
  const CORRIDA_21 = new Date("2026-08-21T06:00:00.000Z");
  const DIA_20 = new Date("2026-08-20T00:00:00.000Z");

  it("el MISMO `diaCerrado` llega a la seleccion y a `crearCierre`", async () => {
    const { service, corteRepo, crearCierre } = build({
      mensajeros: [{ mensajeroId: "m1", zonaId: "z1" }],
    });

    await service.ejecutarCorte(CORRIDA_21);

    const seleccion = (
      corteRepo.findMensajerosConActividadSinCierre as ReturnType<typeof vi.fn>
    ).mock.calls[0]![0] as Date;
    const escritura = crearCierre.mock.calls[0]![0].corteSinGestionar!.diaCerrado as Date;
    expect(seleccion.toISOString()).toBe(escritura.toISOString());
  });

  it("EL ANCLA: corriendo a las 00:00 CR del 21, el dia que se cierra es el 20 — no el 21", async () => {
    // Es el punto donde esta ficha se rompe sola si nadie lo lee. Con el ancla ingenua
    // (`startOfDayCR(now)` = el 21), una orden reservada anoche «para mañana» tiene
    // `fecha_reparto = 21`, `21 > 21` es falso y SE BARRE: justo lo que la ficha impide.
    const { service, corteRepo } = build({ mensajeros: [] });

    await service.ejecutarCorte(CORRIDA_21);

    const diaCerrado = (
      corteRepo.findMensajerosConActividadSinCierre as ReturnType<typeof vi.fn>
    ).mock.calls[0]![0] as Date;
    expect(diaCerrado.toISOString()).toBe(DIA_20.toISOString());
  });

  it("R17: el ancla es la convencion `@db.Date` (medianoche UTC), no las 06:00Z", async () => {
    // Si alguien usara `inicioDelDiaCREnUtc` el valor llevaria las 06:00 dentro y la comparacion
    // contra la columna `DATE` se iria un dia — la trampa que cerro la ficha 166.
    const { service, corteRepo } = build({ mensajeros: [] });

    await service.ejecutarCorte(CORRIDA_21);

    const diaCerrado = (
      corteRepo.findMensajerosConActividadSinCierre as ReturnType<typeof vi.fn>
    ).mock.calls[0]![0] as Date;
    expect(diaCerrado.getUTCHours()).toBe(0);
    expect(diaCerrado.getUTCMinutes()).toBe(0);
  });

  it("si el cron se ADELANTA a las 23:5x CR del 20, cierra el 19: retrasa un barrido, no lo pierde", async () => {
    // `2026-08-21T05:50:00Z` = 23:50 CR del 20. `startOfDayCR` da el 20 y el ancla el 19. Lo del
    // 20 sobrevive una corrida mas y la siguiente lo alcanza. Anclar en `now` sin restar el dia
    // tendria el defecto INVERSO, que si pierde la proteccion.
    const { service, corteRepo } = build({ mensajeros: [] });

    await service.ejecutarCorte(new Date("2026-08-21T05:50:00.000Z"));

    const diaCerrado = (
      corteRepo.findMensajerosConActividadSinCierre as ReturnType<typeof vi.fn>
    ).mock.calls[0]![0] as Date;
    expect(diaCerrado.toISOString()).toBe("2026-08-19T00:00:00.000Z");
  });

  it("cada corrida avanza su ancla un dia: la proteccion caduca sola (R13)", async () => {
    const { service, corteRepo } = build({ mensajeros: [] });

    await service.ejecutarCorte(CORRIDA_21);
    await service.ejecutarCorte(new Date("2026-08-22T06:00:00.000Z"));

    const calls = (corteRepo.findMensajerosConActividadSinCierre as ReturnType<typeof vi.fn>).mock
      .calls;
    expect((calls[0]![0] as Date).toISOString()).toBe("2026-08-20T00:00:00.000Z");
    expect((calls[1]![0] as Date).toISOString()).toBe("2026-08-21T00:00:00.000Z");
  });
});
