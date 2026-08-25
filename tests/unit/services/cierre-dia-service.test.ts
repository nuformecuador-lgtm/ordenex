import { describe, it, expect, vi } from "vitest";
import { CierreDiaService } from "@/lib/services/CierreDiaService";
import type {
  CierreGestionPendienteRow,
  GestionDeshacerRow,
  ICierreDiaRepository,
} from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  ITarifaZonaMensajeroRepository,
  PagoTarifa,
} from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { conPagos } from "@/tests/fixtures/cierre-pagos";
// Feature 240 (T4.2): el predicado REAL, para derivar `desdeAyudaTienda` desde la FAMILIA en vez
// de escribir el booleano a mano. Es lo que ata la guardia del service con la lista de familias.
import { esGestionDeLaTienda } from "@/lib/utils/gestion-de-la-tienda-flag";
import { SIN_BLOQUEO } from "@/lib/utils/bloqueo-cierre";
import { bloqueoConVencido, bloqueoPorAcumular } from "@/tests/fixtures/bloqueo-cierre";

// Feature 37 — tests unit del CierreDiaService (mocks de repos + dobles de
// ISignedUrlProvider/findCentralZonaId, sin DB/red). Cubre R1,R2,R3,R4,R5,R6,R7,R8,
// R9,R10,R11,R12,R15,R16,R17.

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };

/**
 * FEATURE 261 (B6, R19) — el reloj que se INYECTA al deshacer. 04:30Z del 22 de agosto son las
 * 22:30 CR del 21: la hora esta elegida para que el dia UTC y el dia de Costa Rica NO coincidan,
 * que es el unico caso en el que se nota si alguien deriva el dia con el helper equivocado.
 */
const DESHACER_NOW = new Date("2026-08-22T04:30:00.000Z");
const OTRO_ROL: Actor = { usuarioId: "u1", rol: "adminSatelite" };

const ZONA_MENSAJERO = "z-cartago";
const ZONA_CENTRAL = "z-central";

function pendiente(overrides: Partial<CierreGestionPendienteRow> = {}): CierreGestionPendienteRow {
  // Feature 212/T9: el desglose OBLIGATORIO se deriva del par escalar (una linea, como el
  // backfill) salvo que el caso pase el suyo — asi las aserciones previas no cambian.
  const { pagos, ...resto } = overrides;
  const fila: Omit<CierreGestionPendienteRow, "pagos"> = {
    gestionId: "g1",
    ordenId: "o1",
    numGuia: 10,
    numRemision: "REM-1",
    destinatario: "Ana",
    direccion: "Av 1",
    zonaNombre: "Cartago",
    provinciaNombre: "Cartago",
    cantonNombre: "Central",
    distritoNombre: "Oriental",
    producto: "Caja",
    tiendaNombre: "Tienda X",
    resultado: "entregada",
    montoRecibido: "12.50",
    metodoPago: "efectivo",
    motivo: null,
    fechaReprogramacion: null,
    evidenciaStoragePath: null,
    pagoMensajero: null, // feature 39: en vivo el snapshot es null; el service lo DERIVA
    ingresoBodegaRechazo: null, // feature 56: en vivo el snapshot es null; el service lo DERIVA
    esRechazoSla: false, // feature 102/R11: la vista en vivo del mensajero no expone el desglose
    desdeAyudaTienda: false, // feature 237 (D6/R41): la registro el mensajero, no la tienda
    // Feature 158/R9/R19: campos POR RAMA del incidente. `null` por defecto en el resto
    // de resultados; los casos del incidente los sobreescriben.
    causaIncidente: null,
    indemnizacion: null,
    ...resto,
  };
  return conPagos(fila, pagos);
}

type Repo = ICierreDiaRepository;

// Feature 39: tarifa por defecto para los tests (entregada paga cobroEntregado).
const TARIFA_DEFECTO: PagoTarifa = { cobroEntregado: "5.00", cobroRechazado: "3.00" };

function fakeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    findGestionesPendientes: vi.fn(async () => [] as CierreGestionPendienteRow[]),
    contarOrdenesPendientesGestion: vi.fn(async () => 0),
    // FEATURE 271 (R18): por defecto NO hay nada re-solicitable -> `solicitarCierre` toma el flujo
    // de creación (37). La elección es por EDAD y no por estado, así que es UN método, no cuatro.
    findCierreResolicitableMasViejo: vi.fn(async () => null),
    transicionarASolicitado: vi.fn(async () => true),
    // FEATURE 271 (R56, cierra M9): el aviso se compone con el id del cierre que se acaba de tocar.
    findCierreParaAviso: vi.fn(async (cierreId: string) => ({
      id: cierreId,
      destinoZonaId: "z-mensajero",
      mensajeroNombre: "Ana",
    })),
    crearCierre: vi.fn(async () => "c1"),
    findCierresByMensajero: vi.fn(async () => []),
    // Detalle de un cierre pasado: por defecto NINGUNO es del actor (-> no_encontrada);
    // los casos que lo ejercen lo sobreescriben.
    findCierrePropioConGestiones: vi.fn(async () => null),
    // Feature 170 (T I.1): el listado paginado vive en su propia suite (*-paginado).
    findCierresByMensajeroPaginado: vi.fn(async () => ({ items: [], total: 0 })),
    // Feature 67: por defecto, una gestion `entregada` vigente del propio mensajero, sin
    // cierre, que ES la mas reciente y cuya orden sigue en `entregada` -> deshacible (R1).
    findGestionParaDeshacer: vi.fn(async () => gestionDeshacer()),
    findUltimaGestionNoAnuladaId: vi.fn(async () => "g1"),
    anularGestionYDevolverAGestion: vi.fn(async () => true),
    ...overrides,
  };
}

// Feature 67 — fila de la gestion candidata a deshacerse (default: caso feliz).
function gestionDeshacer(overrides: Partial<GestionDeshacerRow> = {}): GestionDeshacerRow {
  return {
    gestionId: "g1",
    ordenId: "o1",
    mensajeroId: "m1", // el propio MENSAJERO actor
    resultado: "entregada",
    cierreId: null, // R1: dentro de la ventana
    anuladaAt: null, // R1: vigente
    orden: { deletedAt: null, estatusId: "s-entregada", estatusValue: "entregada" },
    // Feature 237 (T5.5, D3): el default es «la registro el mensajero», que es el caso feliz del
    // deshacer. Los casos de la 237 lo ponen en `true`.
    desdeAyudaTienda: false,
    ...overrides,
  };
}

function fakeSignedUrls(overrides: Partial<ISignedUrlProvider> = {}): ISignedUrlProvider {
  return {
    createSignedUrl: vi.fn(async (p: string) => `https://signed/${p}`),
    createSignedUrls: vi.fn(async (paths: string[]) =>
      Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`])),
    ),
    ...overrides,
  };
}

function newService(opts: {
  repo?: Repo;
  centralZonaId?: string | null;
  zonaMensajero?: string | null;
  vehiculoMensajero?: string | null;
  tarifa?: PagoTarifa | null; // feature 39: tarifa resuelta (default TARIFA_DEFECTO)
  signedUrls?: ISignedUrlProvider;
  // Feature 67: id de `en_reparto` en el catalogo (null = seed pendiente -> validation_error).
  estatusEnRepartoId?: string | null;
  // FEATURE 271: el detalle del bloqueo que devuelve `findBloqueoDetalle`. Un mensajero en
  // `bloqueados` se modela con el caso 5 de la tabla de verdad (un `vencido`: N=1, V=1).
  bloqueados?: string[];
  /** FEATURE 271 (R15): el caso 4 de la tabla de verdad - dos cierres `solicitado` (N=2, V=0). */
  bloqueadoPorAcumular?: boolean;
} = {}) {
  const repo = opts.repo ?? fakeRepo();
  const zonaRepo = {
    findCentralZonaId: vi.fn(async () => opts.centralZonaId ?? null),
  } as unknown as Pick<IZonaRepository, "findCentralZonaId">;
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async () => (opts.zonaMensajero === undefined ? ZONA_MENSAJERO : opts.zonaMensajero)),
    findUsuarioVehiculoId: vi.fn(async () => opts.vehiculoMensajero ?? null),
    // Feature 67/R18: resuelve el destino `en_reparto`.
    findEstatusIdByValue: vi.fn(async () =>
      opts.estatusEnRepartoId === undefined ? "s-reparto" : opts.estatusEnRepartoId,
    ),
    // FEATURE 271: detalle del bloqueo (default = NO bloqueado). Los tests de bloqueo lo
    // sobreescriben via `bloqueados`.
    findBloqueoDetalle: vi.fn(async () =>
      opts.bloqueadoPorAcumular
        ? bloqueoPorAcumular()
        : opts.bloqueados && opts.bloqueados.length > 0
          ? bloqueoConVencido()
          : SIN_BLOQUEO,
    ),
  } as unknown as Pick<
    IOrdenRepository,
    "findUsuarioZonaId" | "findUsuarioVehiculoId" | "findEstatusIdByValue" | "findBloqueoDetalle"
  >;
  const tarifa = opts.tarifa === undefined ? TARIFA_DEFECTO : opts.tarifa;
  const tarifaZonaRepo: ITarifaZonaMensajeroRepository = {
    resolvePagoTarifa: vi.fn(async () => tarifa),
  };
  const signedUrls = opts.signedUrls ?? fakeSignedUrls();
  const service = new CierreDiaService(
    repo,
    zonaRepo as IZonaRepository,
    ordenRepo as IOrdenRepository,
    signedUrls,
    tarifaZonaRepo,
  );
  return { service, repo, zonaRepo, ordenRepo, tarifaZonaRepo, signedUrls };
}

// --- listarCierreDia (R1-R11, R17, R18) ---

describe("listarCierreDia — autorizacion y alcance (R1/R2)", () => {
  it("R1/R2: rol != mensajero -> forbidden, sin consultar el repo", async () => {
    const { service, repo } = newService();
    const r = await service.listarCierreDia(OTRO_ROL);
    expect(r.status).toBe("forbidden");
    expect(repo.findGestionesPendientes).not.toHaveBeenCalled();
  });

  it("R2: resuelve gestiones/conteo/historico SIEMPRE por el usuarioId del actor", async () => {
    const { service, repo } = newService();
    await service.listarCierreDia(MENSAJERO);
    expect(repo.findGestionesPendientes).toHaveBeenCalledWith("m1");
    // Feature 235 (T4.1, R23): la lista gana `ayuda_tienda` POR SU NOMBRE.
    // Feature 246: y un TERCER argumento, el dia CR con el que se descarta lo reservado para
    // despues. `expect.any(Date)` basta aqui —este test es sobre el ACOTAMIENTO POR ACTOR—; que el
    // dia sea el correcto lo afirma el bloque «Feature 246» de mas abajo, con el reloj inyectado.
    expect(repo.contarOrdenesPendientesGestion).toHaveBeenCalledWith(
      "m1",
      ["por_recoger", "en_reparto", "ayuda_tienda"],
      expect.any(Date),
    );
    expect(repo.findCierresByMensajero).toHaveBeenCalledWith("m1");
  });
});

describe("listarCierreDia — agrupacion y detalle (R3/R4/R6)", () => {
  it("R3: agrupa por resultado con las 4 claves siempre presentes", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada" }),
        pendiente({ gestionId: "b", resultado: "reprogramada", montoRecibido: null, metodoPago: null }),
        pendiente({ gestionId: "c", resultado: "devuelta", montoRecibido: null, metodoPago: null }),
        pendiente({ gestionId: "d", resultado: "entregada" }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.grupos.entregada.map((g) => g.gestionId)).toEqual(["a", "d"]);
    expect(r.grupos.reprogramada.map((g) => g.gestionId)).toEqual(["b"]);
    expect(r.grupos.devuelta.map((g) => g.gestionId)).toEqual(["c"]);
    expect(r.grupos.rechazada).toEqual([]);
  });

  it("R4/R6: entregada expone monto+metodo; reprogramada expone fecha+motivo", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada", montoRecibido: "30.00", metodoPago: "SINPE" }),
        pendiente({
          gestionId: "b",
          resultado: "reprogramada",
          montoRecibido: null,
          metodoPago: null,
          motivo: "ausente",
          fechaReprogramacion: "2026-07-20",
        }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    const entregada = r.grupos.entregada[0];
    expect(entregada.montoRecibido).toBe("30.00"); // R6
    expect(entregada.metodoPago).toBe("SINPE");
    const reprog = r.grupos.reprogramada[0];
    expect(reprog.fechaReprogramacion).toBe("2026-07-20"); // R4
    expect(reprog.motivo).toBe("ausente");
    expect(reprog.montoRecibido).toBeNull();
  });
});

describe("listarCierreDia — evidencia firmada (R5)", () => {
  it("R5: firma las evidencias en lote y expone SOLO la URL firmada, nunca el path crudo", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "rechazada", montoRecibido: null, metodoPago: null, evidenciaStoragePath: "o1/rechazo.jpg" }),
        pendiente({ gestionId: "b", resultado: "reprogramada", montoRecibido: null, metodoPago: null, evidenciaStoragePath: null }),
      ]),
    });
    const signedUrls = fakeSignedUrls();
    const { service } = newService({ repo, signedUrls });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(signedUrls.createSignedUrls).toHaveBeenCalledWith(["o1/rechazo.jpg"], expect.any(Number));
    const rechazada = r.grupos.rechazada[0];
    expect(rechazada.evidenciaUrl).toBe("https://signed/o1/rechazo.jpg");
    // el path crudo NO se filtra en el DTO.
    expect(rechazada).not.toHaveProperty("evidenciaStoragePath");
    // sin evidencia -> null y no rompe.
    expect(r.grupos.reprogramada[0].evidenciaUrl).toBeNull();
  });

  it("R5: sin evidencias no llama al firmador", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [pendiente({ evidenciaStoragePath: null })]),
    });
    const signedUrls = fakeSignedUrls();
    const { service } = newService({ repo, signedUrls });
    await service.listarCierreDia(MENSAJERO);
    expect(signedUrls.createSignedUrls).not.toHaveBeenCalled();
  });
});

// Pedido humano: "ver" el detalle de un cierre YA solicitado desde el histórico.
describe("verCierrePasado — detalle de un cierre propio (solo lectura)", () => {
  const CIERRE_PASADO = {
    cierreId: "c1",
    estado: "aprobado" as const,
    destinoTipo: "bodega_central" as const,
    destinoZonaId: "z-central",
    totales: { efectivo: "10.00", simpe: "0.00", transferencia: "0.00", general: "10.00" },
    totalPagoMensajero: "5.00",
    totalIngresoBodegaRechazos: "0.00",
    solicitadoAt: "2026-07-12T10:00:00.000Z",
    resueltoAt: "2026-07-13T09:00:00.000Z",
    motivoRechazo: null,
  };

  it("rol != mensajero -> forbidden, sin tocar el repo", async () => {
    const repo = fakeRepo();
    const { service } = newService({ repo });
    const r = await service.verCierrePasado("c1", OTRO_ROL);
    expect(r.status).toBe("forbidden");
    expect(repo.findCierrePropioConGestiones).not.toHaveBeenCalled();
  });

  it("cierre ajeno o inexistente -> no_encontrada (el scope va en el WHERE del repo)", async () => {
    const repo = fakeRepo(); // el doble devuelve null por defecto
    const { service } = newService({ repo });
    const r = await service.verCierrePasado("c-ajeno", MENSAJERO);
    expect(r.status).toBe("no_encontrada");
    expect(repo.findCierrePropioConGestiones).toHaveBeenCalledWith("c-ajeno", "m1");
  });

  it("devuelve la cabecera + las gestiones agrupadas, con el pago SNAPSHOT (no re-derivado)", async () => {
    const repo = fakeRepo({
      findCierrePropioConGestiones: vi.fn(async () => ({
        sinGestion: [],
        sinGestionRegistrado: true,
        cierre: CIERRE_PASADO,
        gestiones: [
          // El snapshot congelado dice 4.00 aunque la tarifa de HOY pague 5.00 (TARIFA_DEFECTO):
          // un cierre ya solicitado no cambia de importe porque alguien edite la tarifa.
          pendiente({ gestionId: "g1", pagoMensajero: "4.00" }),
          pendiente({ gestionId: "g2", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
        ],
      })),
    });
    const { service } = newService({ repo });

    const r = await service.verCierrePasado("c1", MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.cierre).toEqual(CIERRE_PASADO);
    expect(r.grupos.entregada).toHaveLength(1);
    expect(r.grupos.rechazada).toHaveLength(1);
    expect(r.grupos.entregada[0].pagoMensajero).toBe("4.00");
    // Design §7.2: la indemnizacion no viaja a la vista del mensajero.
    expect(r.grupos.entregada[0].indemnizacion).toBeNull();
  });

  it("firma las evidencias y, si el storage falla, sirve el detalle SIN ellas", async () => {
    const gestiones = [pendiente({ gestionId: "g1", evidenciaStoragePath: "o1/foto.jpg" })];
    const repo = fakeRepo({
      findCierrePropioConGestiones: vi.fn(async () => ({ sinGestion: [], sinGestionRegistrado: true, cierre: CIERRE_PASADO, gestiones })),
    });

    const okSigner = fakeSignedUrls();
    const conFirma = await newService({ repo, signedUrls: okSigner }).service.verCierrePasado(
      "c1",
      MENSAJERO,
    );
    if (conFirma.status !== "ok") throw new Error("esperaba ok");
    expect(conFirma.grupos.entregada[0].evidenciaUrl).toBe("https://signed/o1/foto.jpg");

    const rotoSigner = fakeSignedUrls({
      createSignedUrls: vi.fn(async () => {
        throw new Error("storage caido");
      }),
    });
    const sinFirma = await newService({ repo, signedUrls: rotoSigner }).service.verCierrePasado(
      "c1",
      MENSAJERO,
    );
    if (sinFirma.status !== "ok") throw new Error("esperaba ok pese al fallo de storage");
    expect(sinFirma.grupos.entregada[0].evidenciaUrl).toBeNull();
  });
});

describe("listarCierreDia — totales money-critical (R7/R8/R9)", () => {
  it("R7: totales por metodo + general cuadran con montos conocidos", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", metodoPago: "efectivo", montoRecibido: "10.00" }),
        pendiente({ gestionId: "b", metodoPago: "efectivo", montoRecibido: "5.25" }),
        pendiente({ gestionId: "c", metodoPago: "SINPE", montoRecibido: "20.00" }),
        pendiente({ gestionId: "d", metodoPago: "transferencia", montoRecibido: "0.75" }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.totales).toEqual({
      efectivo: "15.25",
      simpe: "20.00",
      transferencia: "0.75",
      general: "36.00",
    });
  });

  it("R8: reprogramada/devuelta/rechazada cuentan $0 (set sin entregadas -> 0.00)", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "reprogramada", montoRecibido: null, metodoPago: null }),
        pendiente({ gestionId: "b", resultado: "devuelta", montoRecibido: null, metodoPago: null }),
        pendiente({ gestionId: "c", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.totales).toEqual({
      efectivo: "0.00",
      simpe: "0.00",
      transferencia: "0.00",
      general: "0.00",
    });
  });

  it("R9: suma de 0.10 repetidos exacta (Decimal, sin error de punto flotante)", async () => {
    // 0.1 + 0.2 en float = 0.30000000000000004; con Decimal debe cuadrar exacto.
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () =>
        Array.from({ length: 10 }, (_, i) =>
          pendiente({ gestionId: `g${i}`, metodoPago: "efectivo", montoRecibido: "0.10" }),
        ),
      ),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.totales.efectivo).toBe("1.00");
    expect(r.totales.general).toBe("1.00");
  });
});

describe("listarCierreDia — gate de solicitar (R10/R11) y solo lectura (R17)", () => {
  it("R10: con ordenes pendientes -> puedesSolicitar false + motivo accionable", async () => {
    const repo = fakeRepo({
      contarOrdenesPendientesGestion: vi.fn(async () => 1),
      findGestionesPendientes: vi.fn(async () => [pendiente()]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.puedesSolicitar).toBe(false);
    expect(r.motivoBloqueo).toMatch(/gestion/i);
  });

  it("R11: sin gestiones pendientes -> puedesSolicitar false + motivo", async () => {
    const repo = fakeRepo({ findGestionesPendientes: vi.fn(async () => []) });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.puedesSolicitar).toBe(false);
    expect(r.motivoBloqueo).not.toBeNull();
  });

  it("R10/R11: sin pendientes y con >=1 gestion -> puedesSolicitar true", async () => {
    const repo = fakeRepo({
      contarOrdenesPendientesGestion: vi.fn(async () => 0),
      findGestionesPendientes: vi.fn(async () => [pendiente()]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.puedesSolicitar).toBe(true);
    expect(r.motivoBloqueo).toBeNull();
  });

  it("R17: listar NO muta (nunca invoca crearCierre)", async () => {
    const repo = fakeRepo({ findGestionesPendientes: vi.fn(async () => [pendiente()]) });
    const { service } = newService({ repo });
    await service.listarCierreDia(MENSAJERO);
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });
});

// --- solicitarCierre (R1, R10-R16) ---

describe("solicitarCierre — precondiciones (R1/R10/R11/R12)", () => {
  it("R1: rol != mensajero -> forbidden, sin tocar el repo", async () => {
    const { service, repo } = newService();
    const r = await service.solicitarCierre(OTRO_ROL);
    expect(r.status).toBe("forbidden");
    expect(repo.contarOrdenesPendientesGestion).not.toHaveBeenCalled();
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });

  it("R10: con ordenes pendientes -> conflict, no crea", async () => {
    const repo = fakeRepo({ contarOrdenesPendientesGestion: vi.fn(async () => 2) });
    const { service } = newService({ repo });
    const r = await service.solicitarCierre(MENSAJERO);
    expect(r).toMatchObject({ status: "conflict" });
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });

  // FEATURE 271 (R13) - ESTE CASO SE DIO LA VUELTA, Y ES EL CORAZON DE LA FICHA. Decia «R12: ya
  // existe un cierre solicitado -> conflict, no crea», que es el invariante 109/R30 DEROGADO por
  // R9. Un mensajero LIBRE (N=1, V=0) con gestiones sin vincular DEBE poder crear el segundo
  // cierre: es el caso del cierre 79cb2c0f medido en produccion, donde el dinero cobrado el dia
  // siguiente se quedaba sin cierre al que ir.
  it("271/R13: con un cierre `solicitado` (N=1, V=0) el mensajero SI crea el segundo", async () => {
    const repo = fakeRepo({
      contarOrdenesPendientesGestion: vi.fn(async () => 0),
      findGestionesPendientes: vi.fn(async () => [pendiente()]),
    });
    // LIBRE: `findBloqueoDetalle` devuelve `SIN_BLOQUEO` por defecto, que es lo que produce la
    // regla con N=1 y V=0.
    const { service } = newService({ repo, centralZonaId: ZONA_CENTRAL });
    const r = await service.solicitarCierre(MENSAJERO);
    expect(r).toMatchObject({ status: "ok", via: "creado" });
    expect(repo.crearCierre).toHaveBeenCalledTimes(1);
  });

  it("271/R15: BLOQUEADO por acumular (N=2, V=0) -> conflict con motivo que CUENTA, y no crea", async () => {
    const repo = fakeRepo({
      contarOrdenesPendientesGestion: vi.fn(async () => 0),
      findGestionesPendientes: vi.fn(async () => [pendiente()]),
    });
    const { service } = newService({ repo, bloqueadoPorAcumular: true });
    const r = await service.solicitarCierre(MENSAJERO);
    expect(r).toMatchObject({ status: "conflict" });
    // R15/R43: el motivo dice CUANTOS arrastra y CUAL toca resolver primero, no «ya tienes uno».
    if (r.status === "conflict") {
      expect(r.motivo).toContain("2 cierres esperando aprobación");
      expect(r.motivo).toContain("la bodega apruebe el más antiguo");
    }
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });

  it("R11: sin gestiones pendientes -> conflict, no crea (no se cierra un dia vacio)", async () => {
    const repo = fakeRepo({
      contarOrdenesPendientesGestion: vi.fn(async () => 0),
      findGestionesPendientes: vi.fn(async () => []),
    });
    const { service } = newService({ repo });
    const r = await service.solicitarCierre(MENSAJERO);
    expect(r).toMatchObject({ status: "conflict" });
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });
});

describe("solicitarCierre — ruteo por zona (R15/R16) y snapshot (R13/R14)", () => {
  it("R16: mensajero sin zona -> validation_error, no crea", async () => {
    const repo = fakeRepo({ findGestionesPendientes: vi.fn(async () => [pendiente()]) });
    const { service } = newService({ repo, zonaMensajero: null });
    const r = await service.solicitarCierre(MENSAJERO);
    expect(r).toMatchObject({ status: "validation_error" });
    if (r.status !== "validation_error") throw new Error("esperaba validation_error");
    expect(r.fieldErrors.zona).toBeDefined();
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });

  it("R15: zona del mensajero == central -> destino bodega_central", async () => {
    const repo = fakeRepo({ findGestionesPendientes: vi.fn(async () => [pendiente({ metodoPago: "efectivo", montoRecibido: "10.00" })]) });
    const { service } = newService({ repo, zonaMensajero: ZONA_CENTRAL, centralZonaId: ZONA_CENTRAL });
    const r = await service.solicitarCierre(MENSAJERO);
    expect(r).toMatchObject({ status: "ok", destinoTipo: "bodega_central" });
    const arg = (repo.crearCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ mensajeroId: "m1", destinoTipo: "bodega_central", destinoZonaId: ZONA_CENTRAL });
  });

  it("R15: zona no-central -> destino bodega_satelite con su zona; R14 snapshot totales", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ metodoPago: "efectivo", montoRecibido: "10.00" }),
        pendiente({ gestionId: "g2", metodoPago: "SINPE", montoRecibido: "5.00" }),
      ]),
    });
    const { service } = newService({ repo, zonaMensajero: ZONA_MENSAJERO, centralZonaId: ZONA_CENTRAL });
    const r = await service.solicitarCierre(MENSAJERO);
    expect(r).toMatchObject({ status: "ok", destinoTipo: "bodega_satelite" });
    if (r.status !== "ok") throw new Error("esperaba ok");
    // R14: los totales snapshot que se pasan al repo cuadran con las gestiones.
    const arg = (repo.crearCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.destinoZonaId).toBe(ZONA_MENSAJERO);
    expect(arg.totales).toEqual({ efectivo: "10.00", simpe: "5.00", transferencia: "0.00", general: "15.00" });
    expect(r.totales).toEqual(arg.totales);
  });

  it("R15 + design §6: findCentralZonaId null (feature 55 pendiente) -> fallback seguro a bodega_satelite, no lanza", async () => {
    const repo = fakeRepo({ findGestionesPendientes: vi.fn(async () => [pendiente()]) });
    const { service } = newService({ repo, zonaMensajero: ZONA_MENSAJERO, centralZonaId: null });
    const r = await service.solicitarCierre(MENSAJERO);
    expect(r).toMatchObject({ status: "ok", destinoTipo: "bodega_satelite" });
  });
});

// --- Feature 39: pago al mensajero DERIVADO en vivo (R10/R11/R21) ---

describe("listarCierreDia — pago al mensajero derivado (R10/R11/R21)", () => {
  it("R10: expone pagoMensajero por orden (entregada -> cobroEntregado; resto -> 0.00)", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada", metodoPago: "efectivo", montoRecibido: "12.00" }),
        pendiente({ gestionId: "b", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
        pendiente({ gestionId: "c", resultado: "reprogramada", montoRecibido: null, metodoPago: null }),
        pendiente({ gestionId: "d", resultado: "devuelta", montoRecibido: null, metodoPago: null }),
      ]),
    });
    const { service } = newService({ repo }); // TARIFA_DEFECTO: cobroEntregado 5.00
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.grupos.entregada[0].pagoMensajero).toBe("5.00"); // cobroEntregado
    expect(r.grupos.rechazada[0].pagoMensajero).toBe("0.00"); // NUNCA cobroRechazado
    expect(r.grupos.reprogramada[0].pagoMensajero).toBe("0.00");
    expect(r.grupos.devuelta[0].pagoMensajero).toBe("0.00");
    expect(typeof r.grupos.entregada[0].pagoMensajero).toBe("string"); // R23
  });

  it("R10: sin tarifa (gap de datos) -> pagoMensajero 0.00 en todas, no bloquea", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada" }),
      ]),
    });
    const { service } = newService({ repo, tarifa: null });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.grupos.entregada[0].pagoMensajero).toBe("0.00");
    expect(r.totalPagoMensajero).toBe("0.00");
  });

  it("R11/R21: totalPagoMensajero es la suma de entregadas y NO altera los totales de dinero recibido", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada", metodoPago: "efectivo", montoRecibido: "12.00" }),
        pendiente({ gestionId: "b", resultado: "entregada", metodoPago: "SINPE", montoRecibido: "8.00" }),
        pendiente({ gestionId: "c", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
      ]),
    });
    const { service } = newService({ repo }); // cobroEntregado 5.00 x2 = 10.00
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    // R11: total del pago al mensajero (separado).
    expect(r.totalPagoMensajero).toBe("10.00");
    // R21: dinero recibido intacto (12 efectivo + 8 SINPE), sin mezclar con el pago.
    expect(r.totales).toEqual({
      efectivo: "12.00",
      simpe: "8.00",
      transferencia: "0.00",
      general: "20.00",
    });
  });

  it("R4: resuelve la tarifa por la zona+vehiculo del MENSAJERO (usuarioId del actor)", async () => {
    const repo = fakeRepo({ findGestionesPendientes: vi.fn(async () => [pendiente()]) });
    const { service, ordenRepo, tarifaZonaRepo } = newService({
      repo,
      zonaMensajero: ZONA_MENSAJERO,
      vehiculoMensajero: "veh-1",
    });
    await service.listarCierreDia(MENSAJERO);
    expect(ordenRepo.findUsuarioZonaId).toHaveBeenCalledWith("m1");
    expect(ordenRepo.findUsuarioVehiculoId).toHaveBeenCalledWith("m1");
    expect(tarifaZonaRepo.resolvePagoTarifa).toHaveBeenCalledWith(ZONA_MENSAJERO, "veh-1");
  });
});

// --- Feature 39: snapshot al solicitar (R12/R13/R15) ---

describe("solicitarCierre — snapshot del pago al mensajero (R12/R13)", () => {
  it("R12/R13: pasa a crearCierre el pago por gestion + el total, congelados con la tarifa vigente", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada", metodoPago: "efectivo", montoRecibido: "12.00" }),
        pendiente({ gestionId: "b", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
      ]),
    });
    const { service } = newService({ repo, zonaMensajero: ZONA_MENSAJERO, centralZonaId: ZONA_CENTRAL });
    const r = await service.solicitarCierre(MENSAJERO);
    expect(r.status).toBe("ok");
    const arg = (repo.crearCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // R12: pago snapshoteado por gestion (entregada 5.00, rechazada 0.00).
    expect(arg.pagoByGestionId).toEqual({ a: "5.00", b: "0.00" });
    // R13: total snapshot del cierre.
    expect(arg.totalPagoMensajero).toBe("5.00");
  });

  it("R12: sin tarifa aplicable -> snapshot 0.00 en todas y total 0.00, no bloquea el cierre", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada" }),
      ]),
    });
    const { service } = newService({ repo, zonaMensajero: ZONA_MENSAJERO, tarifa: null });
    const r = await service.solicitarCierre(MENSAJERO);
    expect(r.status).toBe("ok");
    const arg = (repo.crearCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.pagoByGestionId).toEqual({ a: "0.00" });
    expect(arg.totalPagoMensajero).toBe("0.00");
  });
});

describe("listarCierreDia — snapshot congelado del historico (R15)", () => {
  it("R15: el total del cierre pasado sale del snapshot del repo, NO se re-deriva con la tarifa vigente", async () => {
    // Aunque la tarifa vigente sea 5.00, el cierre pasado ya congelo 99.99: no cambia.
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => []),
      findCierresByMensajero: vi.fn(async () => [
        {
          cierreId: "c1",
          estado: "aprobado" as const,
          destinoTipo: "bodega_satelite" as const,
          destinoZonaId: ZONA_MENSAJERO,
          totales: { efectivo: "20.00", simpe: "0.00", transferencia: "0.00", general: "20.00" },
          totalPagoMensajero: "99.99", // snapshot congelado
          totalIngresoBodegaRechazos: "0.00",
          solicitadoAt: "2026-07-10T10:00:00.000Z",
        },
      ]),
    });
    const { service } = newService({ repo, tarifa: TARIFA_DEFECTO });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.cierresPasados[0].totalPagoMensajero).toBe("99.99"); // R15: no re-derivado
  });
});

// --- Feature 56: ingreso de bodega por rechazos DERIVADO en vivo (R2/R7b/R9/R10/R20/R23) ---

describe("listarCierreDia — ingreso de bodega por rechazos derivado (R9/R10)", () => {
  it("R9: expone ingresoBodegaRechazo por gestion (rechazada -> cobroRechazado; resto -> 0.00)", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada", metodoPago: "efectivo", montoRecibido: "12.00" }),
        pendiente({ gestionId: "b", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
        pendiente({ gestionId: "c", resultado: "reprogramada", montoRecibido: null, metodoPago: null }),
        pendiente({ gestionId: "d", resultado: "devuelta", montoRecibido: null, metodoPago: null }),
      ]),
    });
    const { service } = newService({ repo }); // TARIFA_DEFECTO: cobroRechazado 3.00
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.grupos.rechazada[0].ingresoBodegaRechazo).toBe("3.00"); // cobroRechazado
    expect(r.grupos.entregada[0].ingresoBodegaRechazo).toBe("0.00"); // no genera ingreso
    expect(r.grupos.reprogramada[0].ingresoBodegaRechazo).toBe("0.00");
    expect(r.grupos.devuelta[0].ingresoBodegaRechazo).toBe("0.00");
    expect(typeof r.grupos.rechazada[0].ingresoBodegaRechazo).toBe("string"); // R22
  });

  it("R10/R7b/R20: totalIngresoBodegaRechazos separado de totales y de pago mensajero; no los altera", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada", metodoPago: "efectivo", montoRecibido: "12.00" }),
        pendiente({ gestionId: "b", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
        pendiente({ gestionId: "c", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
      ]),
    });
    const { service } = newService({ repo }); // cobroEntregado 5.00, cobroRechazado 3.00
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    // R10: total del ingreso de bodega = 3.00 x2 rechazadas.
    expect(r.totalIngresoBodegaRechazos).toBe("6.00");
    // R7b: el pago al mensajero (1 entregada x 5.00) queda intacto, NO recibe cobroRechazado.
    expect(r.totalPagoMensajero).toBe("5.00");
    // R20: dinero recibido intacto (solo la entregada de 12.00 efectivo).
    expect(r.totales).toEqual({
      efectivo: "12.00",
      simpe: "0.00",
      transferencia: "0.00",
      general: "12.00",
    });
  });

  it("R9: sin tarifa (gap de datos) -> ingreso 0.00 en todas, no bloquea", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [pendiente({ gestionId: "a", resultado: "rechazada", montoRecibido: null, metodoPago: null })]),
    });
    const { service } = newService({ repo, tarifa: null });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.grupos.rechazada[0].ingresoBodegaRechazo).toBe("0.00");
    expect(r.totalIngresoBodegaRechazos).toBe("0.00");
  });

  it("R2: resuelve el ingreso por la zona+vehiculo del MENSAJERO (usuarioId del actor), no de la orden", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [pendiente({ resultado: "rechazada", montoRecibido: null, metodoPago: null })]),
    });
    const { service, ordenRepo, tarifaZonaRepo } = newService({
      repo,
      zonaMensajero: ZONA_MENSAJERO,
      vehiculoMensajero: "veh-1",
    });
    await service.listarCierreDia(MENSAJERO);
    // Feature 56/R2: la tarifa (fuente del cobroRechazado) se resuelve por la zona del mensajero.
    expect(ordenRepo.findUsuarioZonaId).toHaveBeenCalledWith("m1");
    expect(tarifaZonaRepo.resolvePagoTarifa).toHaveBeenCalledWith(ZONA_MENSAJERO, "veh-1");
  });
});

describe("listarCierreDia — feature 102: /cierre-dia NO expone el desglose SLA (R11)", () => {
  it("R11: el resultado del mensajero NO trae `desgloseIngresoBodegaRechazos` (concepto de admin)", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    // El desglose SLA/manual solo existe en el detalle del admin (38/40); la vista del mensajero
    // no lo percibe (mismo criterio que la feature 56: el mensajero no ve el ingreso de bodega).
    expect(r).not.toHaveProperty("desgloseIngresoBodegaRechazos");
  });

  it("R11: cada gestion de la vista en vivo llega con esRechazoSla=false (sin clasificar el origen)", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
      ]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.grupos.rechazada[0].esRechazoSla).toBe(false);
  });
});

describe("listarCierreDia — flag tarifaFaltante server-side (R23)", () => {
  it("R23: tarifaFaltante=true cuando el resolver -> null (zona sin tarifa capturada)", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada" }),
        pendiente({ gestionId: "b", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
      ]),
    });
    const { service } = newService({ repo, tarifa: null });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    // Aplica a entregas Y rechazos (reemplaza la heuristica de frontend de la 39).
    expect(r.grupos.entregada[0].tarifaFaltante).toBe(true);
    expect(r.grupos.rechazada[0].tarifaFaltante).toBe(true);
  });

  it("R23: tarifaFaltante=false cuando existe tarifa AUNQUE sus montos sean 0.00 (sin falso positivo)", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada" }),
        pendiente({ gestionId: "b", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
      ]),
    });
    // Tarifa REAL con montos 0.00: pago 0.00 pero NO es tarifa faltante (arregla la deuda m1 de la 39).
    const { service } = newService({ repo, tarifa: { cobroEntregado: "0.00", cobroRechazado: "0.00" } });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.grupos.entregada[0].pagoMensajero).toBe("0.00");
    expect(r.grupos.entregada[0].tarifaFaltante).toBe(false); // entrega legitima de 0.00, NO badge
    expect(r.grupos.rechazada[0].tarifaFaltante).toBe(false);
  });
});

describe("solicitarCierre — snapshot del ingreso de bodega por rechazos (R8/R11/R12/R14/R20)", () => {
  it("R11/R12: pasa a crearCierre el ingreso por gestion + el total, congelados con la tarifa vigente", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada", metodoPago: "efectivo", montoRecibido: "12.00" }),
        pendiente({ gestionId: "b", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
        pendiente({ gestionId: "c", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
      ]),
    });
    const { service } = newService({ repo, zonaMensajero: ZONA_MENSAJERO, centralZonaId: ZONA_CENTRAL });
    const r = await service.solicitarCierre(MENSAJERO);
    expect(r.status).toBe("ok");
    const arg = (repo.crearCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // R11: ingreso snapshoteado por gestion (rechazadas 3.00; entregada 0.00).
    expect(arg.ingresoByGestionId).toEqual({ a: "0.00", b: "3.00", c: "3.00" });
    // R12: total snapshot del ingreso de bodega.
    expect(arg.totalIngresoBodegaRechazos).toBe("6.00");
  });

  it("R8/R20: el ingreso se snapshotea junto al destino del cierre, sin alterar pago mensajero ni totales", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "a", resultado: "entregada", metodoPago: "efectivo", montoRecibido: "10.00" }),
        pendiente({ gestionId: "b", resultado: "rechazada", montoRecibido: null, metodoPago: null }),
      ]),
    });
    const { service } = newService({ repo, zonaMensajero: ZONA_MENSAJERO, centralZonaId: ZONA_CENTRAL });
    const r = await service.solicitarCierre(MENSAJERO);
    expect(r).toMatchObject({ status: "ok", destinoTipo: "bodega_satelite" });
    const arg = (repo.crearCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // R8: el ingreso viaja en el MISMO crearCierre que fija destinoTipo/destinoZonaId (bodega responsable).
    expect(arg.destinoTipo).toBe("bodega_satelite");
    expect(arg.destinoZonaId).toBe(ZONA_MENSAJERO);
    expect(arg.totalIngresoBodegaRechazos).toBe("3.00");
    // R20: pago al mensajero y totales de dinero recibido INTACTOS (carriles separados).
    expect(arg.totalPagoMensajero).toBe("5.00");
    expect(arg.totales).toEqual({ efectivo: "10.00", simpe: "0.00", transferencia: "0.00", general: "10.00" });
  });

  it("R14: cambiar la tarifa DESPUES del cierre NO altera el snapshot leido del historico", async () => {
    // El cierre pasado ya congelo total_ingreso_bodega_rechazos=7.50; aunque la tarifa vigente
    // cambie, el historico lee el snapshot del repo, NO se re-deriva.
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => []),
      findCierresByMensajero: vi.fn(async () => [
        {
          cierreId: "c1",
          estado: "aprobado" as const,
          destinoTipo: "bodega_satelite" as const,
          destinoZonaId: ZONA_MENSAJERO,
          totales: { efectivo: "0.00", simpe: "0.00", transferencia: "0.00", general: "0.00" },
          totalPagoMensajero: "0.00",
          totalIngresoBodegaRechazos: "7.50", // snapshot congelado
          solicitadoAt: "2026-07-10T10:00:00.000Z",
        },
      ]),
    });
    // Tarifa vigente distinta (cobroRechazado 3.00): NO debe reemplazar el 7.50 congelado.
    const { service } = newService({ repo, tarifa: TARIFA_DEFECTO });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.cierresPasados[0].totalIngresoBodegaRechazos).toBe("7.50"); // R14: no re-derivado
  });
});

// ============================================================================
// Feature 67 — deshacerGestion: la REGLA (8 guardias de design §5.2).
// Cubre R1-R6, R8, R9, R18, R19, R29, R30, R32, R34 con dobles (sin DB/red).
// ============================================================================

describe("Feature 67 · deshacerGestion — ventana y elegibilidad (R1-R6)", () => {
  it("R1: gestion vigente (cierreId null, no anulada), la mas reciente, orden en su sitio -> ok", async () => {
    const { service, repo } = newService();

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r).toEqual({ status: "ok", ordenId: "o1" });
    expect(repo.anularGestionYDevolverAGestion).toHaveBeenCalledTimes(1);
  });

  it("R2: gestion YA vinculada a un cierre -> conflict accionable, SIN escribir", async () => {
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () => gestionDeshacer({ cierreId: "c1" })),
    });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("esperaba conflict");
    expect(r.motivo).toMatch(/cierre/i);
    // La ventana murio: el dinero ya esta snapshoteado y la wallet lo cobrara al aprobar.
    expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
  });

  it("R3: gestion YA anulada -> conflict, sin efectos (un 2.º envio no re-transiciona la orden)", async () => {
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () =>
        gestionDeshacer({ anuladaAt: new Date("2026-07-14T10:00:00.000Z") }),
      ),
    });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("esperaba conflict");
    expect(r.motivo).toMatch(/ya fue deshecha/i);
    expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
  });

  it("R4: existe una gestion posterior NO anulada -> conflict, sin efectos", async () => {
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () => gestionDeshacer({ gestionId: "g1" })),
      findUltimaGestionNoAnuladaId: vi.fn(async () => "g2"), // hay una mas reciente
    });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("esperaba conflict");
    expect(r.motivo).toMatch(/mas reciente/i);
    expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
  });

  it("R6: orden borrada (soft-delete) -> conflict, sin efectos", async () => {
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () =>
        gestionDeshacer({
          orden: {
            deletedAt: new Date("2026-07-14T09:00:00.000Z"),
            estatusId: "s-entregada",
            estatusValue: "entregada",
          },
        }),
      ),
    });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r.status).toBe("conflict");
    expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
  });
});

// R5: la guardia de "la orden no se movio" (F1.4-h), un caso por resultado. La tabla
// ESTADOS_ESPERADOS sale de crearGestionYTransicionar + resolverSeguimientoDevuelta.
describe("Feature 67 · deshacerGestion — guardia de estado de la orden (R5, F1.4-h)", () => {
  const CASOS_OK = [
    { resultado: "entregada" as const, estatusValue: "entregada", nota: "destino = resultado" },
    { resultado: "reprogramada" as const, estatusValue: "reprogramada", nota: "destino = resultado" },
    { resultado: "rechazada" as const, estatusValue: "rechazada", nota: "destino = resultado" },
    { resultado: "devuelta" as const, estatusValue: "en_bodega_central", nota: "47: reintento a central" },
    { resultado: "devuelta" as const, estatusValue: "en_bodega_satelite", nota: "47: reintento a satelite" },
    { resultado: "devuelta" as const, estatusValue: "rechazada", nota: "47: escalado al umbral" },
    // Feature 239 (T1.5, R24) — EL CASO DE LA FEATURE, y es una REGRESION EVITADA, no una
    // asercion nueva de adorno: desde la 239 la gestion `devuelta` deja la orden en el
    // PRE-ESTADO, asi que ese es el sitio donde el mensajero la encuentra el mismo dia. Sin
    // `devolucion_por_confirmar` en `ESTADOS_ESPERADOS.devuelta`, esta guardia no casaria NUNCA
    // y el mensajero perderia la capacidad de deshacer su propia devolucion del dia.
    {
      resultado: "devuelta" as const,
      estatusValue: "devolucion_por_confirmar",
      nota: "239: el mensajero deshace su devolucion del dia desde el pre-estado",
    },
  ];

  for (const c of CASOS_OK) {
    it(`ok: gestion ${c.resultado} con la orden en ${c.estatusValue} (${c.nota})`, async () => {
      const repo = fakeRepo({
        findGestionParaDeshacer: vi.fn(async () =>
          gestionDeshacer({
            resultado: c.resultado,
            orden: { deletedAt: null, estatusId: "s-x", estatusValue: c.estatusValue },
          }),
        ),
      });
      const { service } = newService({ repo });
      const r = await service.deshacerGestion("g1", MENSAJERO);
      expect(r.status).toBe("ok");
    });
  }

  const CASOS_CONFLICT = [
    { resultado: "entregada" as const, estatusValue: "en_bodega_central", nota: "la bodega ya la recibio" },
    { resultado: "reprogramada" as const, estatusValue: "en_bodega_central", nota: "el cron de la 46 ya la libero" },
    { resultado: "rechazada" as const, estatusValue: "devolviendo_a_tienda", nota: "48: ya se devolvio a la tienda" },
    { resultado: "devuelta" as const, estatusValue: "en_reparto", nota: "la bodega la reasigno y ruteo" },
    { resultado: "entregada" as const, estatusValue: "en_preparacion", nota: "ajuste administrativo" },
  ];

  for (const c of CASOS_CONFLICT) {
    it(`conflict: gestion ${c.resultado} pero la orden esta en ${c.estatusValue} (${c.nota})`, async () => {
      const repo = fakeRepo({
        findGestionParaDeshacer: vi.fn(async () =>
          gestionDeshacer({
            resultado: c.resultado,
            orden: { deletedAt: null, estatusId: "s-x", estatusValue: c.estatusValue },
          }),
        ),
      });
      const { service } = newService({ repo });

      const r = await service.deshacerGestion("g1", MENSAJERO);

      expect(r.status).toBe("conflict");
      if (r.status !== "conflict") throw new Error("esperaba conflict");
      expect(r.motivo).toMatch(/bodega|no se puede deshacer/i); // accionable (F1.4-h)
      expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
    });
  }
});

describe("Feature 67 · deshacerGestion — autorizacion (R8/R9)", () => {
  it("R8 (F1.4-f): rol != mensajero -> forbidden, sin tocar el repo", async () => {
    const repo = fakeRepo();
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", OTRO_ROL);

    expect(r).toEqual({ status: "forbidden" });
    // El admin NO tiene ventana para deshacer: ni siquiera se lee la gestion.
    expect(repo.findGestionParaDeshacer).not.toHaveBeenCalled();
    expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
  });

  it("R9: gestion de OTRO mensajero -> forbidden, sin revelar datos ni escribir", async () => {
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () => gestionDeshacer({ mensajeroId: "m2" })),
    });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    // Resultado forbidden PELADO: sin motivo ni ningun dato de la gestion ajena.
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
  });

  it("R9: gestion INEXISTENTE -> forbidden (no se distingue de ajena: no revela existencia)", async () => {
    const repo = fakeRepo({ findGestionParaDeshacer: vi.fn(async () => null) });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("no-existe", MENSAJERO);

    expect(r).toEqual({ status: "forbidden" }); // mismo resultado que la ajena (patron 36/R31)
  });
});

// ---------------------------------------------------------------------------------------------
// 💰 FEATURE 237 (T5.5, D3 firmada por el HUMANO el 2026-08-20, R38/R39) — LA GESTION QUE
// REGISTRO LA TIENDA NO SE DESHACE.
//
// El hallazgo que obligo a escribir esto: la gestion de la tienda nace con `mensajero_id` = el
// mensajero (237/R3, lo que la mete en su cierre) y con `cierre_id = NULL` (R9). Con eso PASA LAS
// OCHO GUARDIAS: es «suya», la ventana esta abierta, es la ultima y el estado esperado casa. Sin la
// guardia nueva, el mensajero revierte la decision de la tienda —la orden vuelve a `en_reparto`
// reasignada a el, desaparecen el intento y el `cobroRechazado`— y LA TIENDA NO SE ENTERA, porque
// la fila ya no esta en ninguna de sus pestañas.
//
// Y los numeros lo convierten de precaucion en necesidad (medido en produccion el 2026-08-20):
// deshacer se usa en 7 de 57 gestiones (12 %) y un rechazo mueve hasta ₡1.000.
//
// El precio de D3-b esta DECLARADO: un rechazo equivocado de la tienda no tiene deshacer. Se acepta
// porque su peor caso es recuperable (el paquete vuelve por el flujo de devolucion) y el contrario
// borra dinero sin consentimiento de quien lo decidio.
// ---------------------------------------------------------------------------------------------
describe("Feature 237 · deshacerGestion — la gestion de LA TIENDA (D3/R38)", () => {
  it.each(["reprogramada", "rechazada"] as const)(
    "R38: una gestion `%s` registrada por la tienda -> `conflict`, SIN escribir nada",
    async (resultado) => {
      const repo = fakeRepo({
        findGestionParaDeshacer: vi.fn(async () =>
          gestionDeshacer({
            resultado,
            desdeAyudaTienda: true,
            orden: { deletedAt: null, estatusId: `s-${resultado}`, estatusValue: resultado },
          }),
        ),
      });
      const { service } = newService({ repo });

      const r = await service.deshacerGestion("g1", MENSAJERO);

      expect(r.status).toBe("conflict");
      // 💰 Lo que de verdad protege: NI UNA escritura. Si esta llamada ocurriera, el intento y el
      // `cobroRechazado` desaparecerian con ella.
      expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
    },
  );

  it("R38: el mensaje es ACCIONABLE — dice quien lo hizo, que solo ella puede corregirlo y por donde", async () => {
    // No es un «no se puede» a secas: el mensajero tiene el paquete en la moto y necesita saber a
    // quien acudir. Se lee el texto tal cual, que es lo que vera en pantalla.
    //
    // ⏳ 2026-08-20 (feature 240, D10/R43) — EL TEXTO PIERDE «desde su pantalla de ayuda», y el
    // literal se actualiza A MANO porque ES el contrato de lo que el mensajero lee. Desde la 240 la
    // tienda tambien resuelve rechazando a mano una devolucion ya anclada, que NO pasa por esa
    // pantalla: sobre esas gestiones la frase vieja seria FALSA. No se parte en dos mensajes por
    // familia — al mensajero le da igual desde donde lo hizo la tienda; lo que necesita saber es
    // que no es suyo y a quien escribirle.
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () =>
        gestionDeshacer({
          resultado: "rechazada",
          desdeAyudaTienda: true,
          orden: { deletedAt: null, estatusId: "s-rechazada", estatusValue: "rechazada" },
        }),
      ),
    });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r).toEqual({
      status: "conflict",
      motivo:
        "Esta orden la resolvió la tienda; solo ella puede corregirlo. Escribile por el chat de la orden.",
    });
    // Y la pantalla que ya no corresponde no vuelve por la puerta de atras.
    expect(r.status === "conflict" && r.motivo).not.toContain("pantalla de ayuda");
  });

  it("R38: la guardia va DESPUES de la de propiedad — una gestion AJENA sigue dando `forbidden` pelado", async () => {
    // Si estuviera antes, el mensaje «la resolvio la tienda» se emitiria sobre una gestion que no
    // es suya y filtraria informacion de una orden ajena. El orden de las guardias es la
    // proteccion, no un detalle de estilo.
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () =>
        gestionDeshacer({ mensajeroId: "m2", desdeAyudaTienda: true }),
      ),
    });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r).toEqual({ status: "forbidden" });
    expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
  });

  it("R38: NO se rompe el deshacer de nadie — la gestion PROPIA del mensajero se sigue deshaciendo", async () => {
    // El contraste obligatorio: la guardia nueva discrimina por la FAMILIA de origen, no por el
    // estado ni por el resultado. Una `rechazada` del propio mensajero sobre una orden en el mismo
    // estado se deshace exactamente como antes.
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () =>
        gestionDeshacer({
          resultado: "rechazada",
          desdeAyudaTienda: false,
          orden: { deletedAt: null, estatusId: "s-rechazada", estatusValue: "rechazada" },
        }),
      ),
    });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r).toEqual({ status: "ok", ordenId: "o1" });
    expect(repo.anularGestionYDevolverAGestion).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------------------------
// 💰 FEATURE 240 (T4.2, D6/R43) — EL RECHAZO MANUAL DE LA TIENDA TAMPOCO SE DESHACE.
//
// `CierreDiaService` NO cambia ni una linea: sigue leyendo `gestion.desdeAyudaTienda`. Lo que cambia
// es DE DONDE SALE ese booleano — `ORIGENES_GESTION_DE_LA_TIENDA` pasa de un valor a una lista—.
// Por eso estos casos derivan la bandera con el PREDICADO REAL a partir de la FAMILIA, en vez de
// escribir `true` a mano: asi el caso ata las dos mitades y se pone rojo si alguien saca
// `rechazo_tienda` de la lista, que es la unica forma de que este agujero se reabra.
//
// POR QUE IMPORTA MAS QUE EN LA 237: la gestion sintetica del rechazo manual nace con
// `mensajero_id` = ese mensajero (es lo que la mete en su cierre) y `cierre_id NULL`, asi que pasa
// las ocho guardias igual. Pero aqui el paquete NO esta en la moto: volvio a la bodega y se escaneo
// al aprobar el cierre anterior (238). Deshacer devolveria a `en_reparto` —reasignada al mensajero—
// una orden cuyo paquete el mensajero no tiene, y borraria el `cobroRechazado` que la tienda
// decidio y pago con un aviso que le dijo que no se podia deshacer.
// ---------------------------------------------------------------------------------------------
describe("Feature 240 · deshacerGestion — el rechazo MANUAL de la tienda (D6/R43)", () => {
  it("💰 R43: una gestion de familia `rechazo_tienda` -> `conflict`, SIN escribir nada", async () => {
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () =>
        gestionDeshacer({
          resultado: "rechazada",
          // ⭑ La bandera se DERIVA de la familia con el predicado de produccion, no se escribe.
          desdeAyudaTienda: esGestionDeLaTienda([{ origenTipo: "rechazo_tienda" }]),
          orden: { deletedAt: null, estatusId: "s-rechazada", estatusValue: "rechazada" },
        }),
      ),
    });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r).toEqual({
      status: "conflict",
      motivo:
        "Esta orden la resolvió la tienda; solo ella puede corregirlo. Escribile por el chat de la orden.",
    });
    // 💰 Lo que de verdad protege: NI UNA escritura.
    expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
  });

  it("CONTROL POSITIVO: la gestion `rechazada` del propio MENSAJERO se sigue deshaciendo", async () => {
    // Sin este contraste, el caso de arriba estaria verde tambien si la guardia bloqueara TODO
    // deshacer de una `rechazada`. La guardia discrimina por la FAMILIA de origen, no por el
    // resultado ni por el estado — y la familia `gestion` (la visita en calle) no es de la tienda.
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () =>
        gestionDeshacer({
          resultado: "rechazada",
          desdeAyudaTienda: esGestionDeLaTienda([{ origenTipo: "gestion" }]),
          orden: { deletedAt: null, estatusId: "s-rechazada", estatusValue: "rechazada" },
        }),
      ),
    });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r).toEqual({ status: "ok", ordenId: "o1" });
    expect(repo.anularGestionYDevolverAGestion).toHaveBeenCalledTimes(1);
  });

  it("💰 D6: la sintetica de la REPROGRAMACION de escritorio (100) SIGUE deshaciendose — agujero hermano DECLARADO", async () => {
    // ⚠️ ESTE CASO AFIRMA UN AGUJERO ABIERTO, a proposito, y no es un descuido: la auditoria de la
    // pila lo dejo como «no se pudo determinar» y la 240 lo determina. `reprogramacion_tienda`
    // tambien es una gestion sintetica de la tienda y tambien pasa las ocho guardias, asi que HOY
    // el mensajero puede revertir esa decision de escritorio.
    //
    // No se cierra aqui porque es dinero NEUTRO (`reprogramada` no emite ningun concepto, a
    // diferencia de `rechazada`) y cambiar la conducta de la feature 100 sin pedirlo es alcance
    // ajeno. Queda propuesto como ficha aparte. El dia que esa ficha lo cierre, ESTE CASO SE PONE
    // ROJO — y ese rojo es la señal de que se cerro, no una regresion: hay que darle la vuelta,
    // como la 237 hizo con el suyo.
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () =>
        gestionDeshacer({
          resultado: "reprogramada",
          desdeAyudaTienda: esGestionDeLaTienda([{ origenTipo: "reprogramacion_tienda" }]),
          orden: { deletedAt: null, estatusId: "s-reprogramada", estatusValue: "reprogramada" },
        }),
      ),
    });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r).toEqual({ status: "ok", ordenId: "o1" });
  });
});

describe("Feature 67 · deshacerGestion — transicion y efectos (R18/R19/R29/R30/R32/R34)", () => {
  it("R18/R19: pide al repo `en_reparto` como destino y el mensajero AUTOR como asignado", async () => {
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () =>
        gestionDeshacer({
          resultado: "devuelta",
          // 47: el seguimiento del reintento habia limpiado `mensajero_asignado_id`.
          orden: { deletedAt: null, estatusId: "s-bodega", estatusValue: "en_bodega_central" },
        }),
      ),
    });
    const { service, ordenRepo } = newService({ repo });

    // FEATURE 261 (B6/B10, R19): el reloj se INYECTA. 22:30 CR del 21 = 04:30Z del 22, a
    // proposito: el dia UTC y el dia CR NO coinciden, asi que el `diaEnCurso` que el servicio
    // calcula solo puede salir «2026-08-21» si usa el helper correcto.
    const r = await service.deshacerGestion("g1", MENSAJERO, DESHACER_NOW);

    expect(r).toEqual({ status: "ok", ordenId: "o1" });
    expect(ordenRepo.findEstatusIdByValue).toHaveBeenCalledWith("en_reparto"); // R18
    expect(repo.anularGestionYDevolverAGestion).toHaveBeenCalledWith({
      gestionId: "g1",
      ordenId: "o1",
      mensajeroId: "m1", // R19: repone la asignacion al autor, aunque el reintento la limpio
      actorUsuarioId: "m1", // R11/R20: rastro de quien deshizo
      estatusEsperadoId: "s-bodega", // R5: id REAL leido (guardia optimista de la escritura)
      estatusEnRepartoId: "s-reparto", // R18
      // 261/R16/R19: los DOS salen del MISMO `now`. Si el instante saliera del reloj de
      // Postgres y el dia del de la aplicacion, podrian caer a distinto lado de la medianoche.
      asignadoAt: DESHACER_NOW,
      diaEnCurso: new Date("2026-08-21T00:00:00.000Z"),
    });
  });

  it("R22: el repo devuelve false (carrera: guardia perdida en la tx) -> conflict", async () => {
    const repo = fakeRepo({ anularGestionYDevolverAGestion: vi.fn(async () => false) });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r.status).toBe("conflict"); // sin efectos parciales: la tx hizo rollback
  });

  it("catalogo sin `en_reparto` (seed pendiente) -> validation_error, sin escribir", async () => {
    const repo = fakeRepo();
    const { service } = newService({ repo, estatusEnRepartoId: null });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r.status).toBe("validation_error");
    expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
  });

  it("R29/R30 (F1.4-c): el mensajero con OTRA orden activa en gestion PUEDE deshacer igual", async () => {
    // El puntero 1-a-1 (`usuario.orden_en_gestion_id`) NO participa del deshacer: el service ni
    // lo lee ni lo escribe (su Pick del ordenRepo no incluye metodos de puntero). Deshacer no
    // se bloquea por tener otra orden activa — justo el caso en el que hay que corregir el error.
    const repo = fakeRepo();
    const { service, ordenRepo } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r.status).toBe("ok");
    const metodos = Object.keys(ordenRepo);
    expect(metodos).not.toContain("getOrdenEnGestion");
    expect(metodos).not.toContain("setOrdenEnGestion");
    expect(metodos).not.toContain("liberarOrdenEnGestion");
  });

  it("R32: NUNCA borra la evidencia del bucket (el service no tiene storage de escritura)", async () => {
    const repo = fakeRepo();
    const { service, signedUrls } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r.status).toBe("ok");
    // El unico colaborador de storage del service es el firmador de URLs (solo lectura): no
    // existe `remove`. `evidencia_storage_path` tampoco viaja en el input del repo (R12).
    expect("remove" in signedUrls).toBe(false);
    const input = (repo.anularGestionYDevolverAGestion as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(input.evidenciaStoragePath).toBeUndefined();
  });

  it("R34: deshacer una `entregada` con monto NO produce movimiento de wallet/tienda/pago", async () => {
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () => gestionDeshacer({ resultado: "entregada" })),
    });
    const { service, tarifaZonaRepo } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r.status).toBe("ok");
    // El dinero solo se asienta al APROBAR el cierre (los feeds leen por `cierreId`), y esta
    // gestion tiene cierre_id = NULL: no hay asiento que compensar (F1.4-g). El deshacer ni
    // siquiera resuelve tarifas.
    expect(tarifaZonaRepo.resolvePagoTarifa).not.toHaveBeenCalled();
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });
});

// T19 (R13/R14/R15): una gestion anulada desaparece de la vista Y de los derivados. La
// exclusion ocurre aguas arriba (el WHERE del repo, T6): aqui se prueba el efecto END-TO-END
// sobre grupos + totales + pago al mensajero (39) + ingreso de bodega (56).
describe("Feature 67 · gestion anulada ausente de la vista y los totales (R13/R14/R15)", () => {
  it("R13/R14/R15: la lista SIN la anulada -> no aparece en los grupos ni suma a ningun total", async () => {
    // El repo (con `anuladaAt: null` en su WHERE) devuelve SOLO la vigente: una anulada de
    // 20.00 en efectivo ni se lista ni suma.
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "g-vigente", montoRecibido: "12.50", metodoPago: "efectivo" }),
      ]),
    });
    const { service } = newService({ repo });

    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");

    // R13: un solo grupo con una sola fila; la anulada no esta en ninguno de los 4.
    expect(r.grupos.entregada).toHaveLength(1);
    expect(r.grupos.entregada[0].gestionId).toBe("g-vigente");
    const todas = [
      ...r.grupos.entregada,
      ...r.grupos.reprogramada,
      ...r.grupos.devuelta,
      ...r.grupos.rechazada,
    ];
    expect(todas.map((g) => g.gestionId)).not.toContain("g-anulada");
    // R14: totales por metodo + general SIN la anulada (12.50, no 32.50).
    expect(r.totales).toEqual({
      efectivo: "12.50",
      simpe: "0.00",
      transferencia: "0.00",
      general: "12.50",
    });
    // R15: los derivados 39/56 tampoco la cuentan (una sola entregada -> 5.00 de pago).
    expect(r.totalPagoMensajero).toBe("5.00");
    expect(r.totalIngresoBodegaRechazos).toBe("0.00");
  });

  it("R13/R14: si TODAS las gestiones del dia estan anuladas, el dia queda vacio (totales en 0)", async () => {
    const repo = fakeRepo({ findGestionesPendientes: vi.fn(async () => []) });
    const { service } = newService({ repo });

    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");

    // Feature 158: los grupos pasan a CINCO claves (`incidente` es un grupo propio, R18).
    expect(r.grupos).toEqual({
      entregada: [],
      reprogramada: [],
      devuelta: [],
      rechazada: [],
      incidente: [],
    });
    expect(r.totales.general).toBe("0.00");
    expect(r.totalPagoMensajero).toBe("0.00");
    expect(r.totalIngresoBodegaRechazos).toBe("0.00");
    expect(r.puedesSolicitar).toBe(false); // R11: no se cierra un dia vacio
  });

  it("R15/R16: `solicitarCierre` snapshotea SOLO las vigentes (la anulada no entra al cierre)", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "g-vigente", montoRecibido: "12.50", metodoPago: "efectivo" }),
      ]),
    });
    const { service } = newService({ repo, centralZonaId: ZONA_CENTRAL });

    const r = await service.solicitarCierre(MENSAJERO);
    expect(r.status).toBe("ok");

    // El snapshot consume la MISMA lista filtrada: la anulada no aparece en `pagoByGestionId`
    // ni en `ingresoByGestionId`, y los totales congelados la excluyen.
    const input = (repo.crearCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(Object.keys(input.pagoByGestionId)).toEqual(["g-vigente"]);
    expect(Object.keys(input.ingresoByGestionId)).toEqual(["g-vigente"]);
    expect(input.totales.general).toBe("12.50");
  });
});

// ============================================================================
// Feature 111 — solicitarCierre: rama del `vencido` (R6/R7/R9/R10/R11) + B2 tieneVencido (R13).
// ============================================================================

describe("Feature 111 · solicitarCierre — transición del vencido (R6/R9/R10)", () => {
  it("R6 + 271/R18: con un vencido -> transiciona ESE cierre (via resolicitado), NO crea uno nuevo", async () => {
    const repo = fakeRepo({
      findCierreResolicitableMasViejo: vi.fn(async () => ({ id: "c-viejo", estado: "vencido" as const })),
      transicionarASolicitado: vi.fn(async () => true),
    });
    const { service } = newService({ repo });

    const r = await service.solicitarCierre(MENSAJERO);

    expect(r).toMatchObject({ status: "ok", via: "resolicitado" });
    // 271/R18/R19: la escritura va guardada por (id, estadoEsperado), no por (mensajero, estado).
    expect(repo.transicionarASolicitado).toHaveBeenCalledWith("c-viejo", "vencido");
    // R6/R10: no se inserta una segunda fila cierre_dia (no pasa por el flujo de creación).
    expect(repo.crearCierre).not.toHaveBeenCalled();
    expect(repo.findGestionesPendientes).not.toHaveBeenCalled(); // R8/R20: sin snapshot nuevo
  });

  it("R9 (anti-deadlock): con un vencido + órdenes pendientes -> transiciona igual, sin conflict por pendientes", async () => {
    // El mensajero está bloqueado para gestionar (R1) — si además la precondición de pendientes
    // aplicara, quedaría atrapado. La rama del vencido NO consulta `contarOrdenesPendientesGestion`.
    const repo = fakeRepo({
      findCierreResolicitableMasViejo: vi.fn(async () => ({ id: "c-viejo", estado: "vencido" as const })),
      transicionarASolicitado: vi.fn(async () => true),
      contarOrdenesPendientesGestion: vi.fn(async () => 3), // hay órdenes en_reparto
    });
    const { service } = newService({ repo });

    const r = await service.solicitarCierre(MENSAJERO);

    expect(r.status).toBe("ok");
    expect(repo.contarOrdenesPendientesGestion).not.toHaveBeenCalled(); // R9
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });

  it("R7: el vencido ya fue transicionado (updateMany 0 filas) -> conflict, sin crear", async () => {
    const repo = fakeRepo({
      findCierreResolicitableMasViejo: vi.fn(async () => ({ id: "c-viejo", estado: "vencido" as const })),
      transicionarASolicitado: vi.fn(async () => false), // carrera
    });
    const { service } = newService({ repo });

    const r = await service.solicitarCierre(MENSAJERO);

    expect(r.status).toBe("conflict");
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });

  it("R11: SIN nada re-solicitable -> flujo de creación de la 37 SIN cambios (crea, via creado)", async () => {
    const repo = fakeRepo({
      findCierreResolicitableMasViejo: vi.fn(async () => null),
      findGestionesPendientes: vi.fn(async () => [pendiente({ metodoPago: "efectivo", montoRecibido: "10.00" })]),
    });
    const { service } = newService({ repo, centralZonaId: ZONA_CENTRAL });

    const r = await service.solicitarCierre(MENSAJERO);

    expect(r).toMatchObject({ status: "ok", via: "creado" });
    expect(repo.transicionarASolicitado).not.toHaveBeenCalled();
    expect(repo.crearCierre).toHaveBeenCalledTimes(1); // flujo 37 intacto
  });
});

describe("Feature 111 · listarCierreDia — tieneVencido derivado (R13-datos)", () => {
  const cierrePasado = (estado: "solicitado" | "aprobado" | "rechazado" | "vencido") => ({
    cierreId: `c-${estado}`,
    estado,
    destinoTipo: "bodega_satelite" as const,
    destinoZonaId: ZONA_MENSAJERO,
    totales: { efectivo: "0.00", simpe: "0.00", transferencia: "0.00", general: "0.00" },
    totalPagoMensajero: "0.00",
    totalIngresoBodegaRechazos: "0.00",
    solicitadoAt: "2026-07-10T10:00:00.000Z",
  });

  it("R13: tieneVencido=true cuando hay un cierre vencido en el histórico", async () => {
    const repo = fakeRepo({
      findCierresByMensajero: vi.fn(async () => [cierrePasado("vencido")]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.tieneVencido).toBe(true);
  });

  it("R13: tieneVencido=false sin ningún vencido (solicitado/aprobado/rechazado no cuentan)", async () => {
    const repo = fakeRepo({
      findCierresByMensajero: vi.fn(async () => [cierrePasado("aprobado"), cierrePasado("rechazado")]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.tieneVencido).toBe(false);
  });
});

// ============================================================================
// Feature 109 — solicitarCierre: rama `rechazado -> solicitado` (R28) + tieneRechazado (R31-datos).
// Modelo GLOBAL: un `rechazado` YA NO es terminal — bloquea y es RE-SOLICITABLE (espejo del vencido).
// ============================================================================

describe("Feature 109 · solicitarCierre — re-solicitar un `rechazado` (R28)", () => {
  it("R28 + 271/R18: con un rechazado -> transiciona ESE cierre (via resolicitado), NO crea uno nuevo", async () => {
    const repo = fakeRepo({
      findCierreResolicitableMasViejo: vi.fn(async () => ({ id: "c-rech", estado: "rechazado" as const })),
      transicionarASolicitado: vi.fn(async () => true),
    });
    const { service } = newService({ repo });

    const r = await service.solicitarCierre(MENSAJERO);

    expect(r).toMatchObject({ status: "ok", via: "resolicitado" });
    expect(repo.transicionarASolicitado).toHaveBeenCalledWith("c-rech", "rechazado");
    // R28: NO pasa por el flujo de creación (no crea un cierre nuevo).
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });

  it("R28: EXENTO de la precondición de pendientes (anti-deadlock): re-solicita aunque haya pendientes", async () => {
    const repo = fakeRepo({
      contarOrdenesPendientesGestion: vi.fn(async () => 3), // pendientes: la re-solicitud los ignora
      findCierreResolicitableMasViejo: vi.fn(async () => ({ id: "c-rech", estado: "rechazado" as const })),
      transicionarASolicitado: vi.fn(async () => true),
    });
    const { service } = newService({ repo });

    const r = await service.solicitarCierre(MENSAJERO);

    expect(r).toMatchObject({ status: "ok", via: "resolicitado" });
  });

  it("R28: carrera (transición afecta 0 filas) -> conflict, sin crear", async () => {
    const repo = fakeRepo({
      findCierreResolicitableMasViejo: vi.fn(async () => ({ id: "c-rech", estado: "rechazado" as const })),
      transicionarASolicitado: vi.fn(async () => false), // ya re-solicitado/resuelto
    });
    const { service } = newService({ repo });

    const r = await service.solicitarCierre(MENSAJERO);

    expect(r.status).toBe("conflict");
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });

  // FEATURE 271 (R18) - ESTE CASO SE DIO LA VUELTA. Decia «el vencido tiene prioridad sobre el
  // rechazado», que era elegir POR ESTADO, y con dos cierres abiertos contradice «del mas viejo al
  // mas nuevo»: con un rechazado VIEJO y un vencido NUEVO resolvia el nuevo primero. Ahora el
  // repositorio devuelve EL MAS VIEJO y el servicio transiciona ese, sea cual sea su estado.
  it("271/R18: se transiciona EL MAS VIEJO, aunque sea el `rechazado` y haya un `vencido` mas nuevo", async () => {
    const repo = fakeRepo({
      findCierreResolicitableMasViejo: vi.fn(async () => ({ id: "c-rech-viejo", estado: "rechazado" as const })),
      transicionarASolicitado: vi.fn(async () => true),
    });
    const { service } = newService({ repo });

    const r = await service.solicitarCierre(MENSAJERO);

    expect(r).toMatchObject({ status: "ok", via: "resolicitado" });
    expect(repo.transicionarASolicitado).toHaveBeenCalledTimes(1);
    expect(repo.transicionarASolicitado).toHaveBeenCalledWith("c-rech-viejo", "rechazado");
  });

  it("R11: sin nada re-solicitable -> flujo de creación normal (regresión 37/111 verde)", async () => {
    const repo = fakeRepo({
      findCierreResolicitableMasViejo: vi.fn(async () => null),
      findGestionesPendientes: vi.fn(async () => [pendiente()]),
    });
    const { service } = newService({ repo, zonaMensajero: ZONA_MENSAJERO, centralZonaId: ZONA_CENTRAL });

    const r = await service.solicitarCierre(MENSAJERO);

    expect(r).toMatchObject({ status: "ok", via: "creado" });
    expect(repo.transicionarASolicitado).not.toHaveBeenCalled();
  });
});

describe("Feature 109 · listarCierreDia — tieneRechazado derivado (R31-datos)", () => {
  const cierrePasado = (estado: "solicitado" | "aprobado" | "rechazado" | "vencido") => ({
    cierreId: `c-${estado}`,
    estado,
    destinoTipo: "bodega_satelite" as const,
    destinoZonaId: ZONA_MENSAJERO,
    totales: { efectivo: "0.00", simpe: "0.00", transferencia: "0.00", general: "0.00" },
    totalPagoMensajero: "0.00",
    totalIngresoBodegaRechazos: "0.00",
    solicitadoAt: "2026-07-10T10:00:00.000Z",
  });

  it("R31: tieneRechazado=true cuando hay un cierre rechazado en el histórico", async () => {
    const repo = fakeRepo({ findCierresByMensajero: vi.fn(async () => [cierrePasado("rechazado")]) });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.tieneRechazado).toBe(true);
  });

  it("R31: tieneRechazado=false sin ningún rechazado (solicitado/aprobado/vencido no cuentan)", async () => {
    const repo = fakeRepo({
      findCierresByMensajero: vi.fn(async () => [cierrePasado("aprobado"), cierrePasado("vencido")]),
    });
    const { service } = newService({ repo });
    const r = await service.listarCierreDia(MENSAJERO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.tieneRechazado).toBe(false);
  });
});

// ============================================================================
// Feature 111 — deshacerGestion: bloqueo total EXPLÍCITO (R5/R20, Q2).
// ============================================================================

describe("Feature 111 · deshacerGestion — bloqueo total del mensajero (R5/R20)", () => {
  it("R5: mensajero BLOQUEADO (vencido/solicitado) -> conflict, sin leer ni anular la gestión", async () => {
    const repo = fakeRepo();
    const { service, ordenRepo } = newService({ repo, bloqueados: ["m1"] });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r.status).toBe("conflict");
    // R5 (Q2, belt-and-suspenders): usa el MISMO predicado derivado, ANTES de cualquier lectura.
    expect(ordenRepo.findBloqueoDetalle).toHaveBeenCalledWith("m1");
    expect(repo.findGestionParaDeshacer).not.toHaveBeenCalled();
    expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled(); // sin devolver a en_reparto
  });

  it("R20: el motivo del bloqueo es texto fijo SIN PII (ni ids de cierre ni del actor)", async () => {
    const repo = fakeRepo();
    const { service } = newService({ repo, bloqueados: ["m1"] });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    if (r.status !== "conflict") throw new Error("esperaba conflict");
    expect(r.motivo).toMatch(/no puedes entregar, cobrar ni recibir trabajo nuevo/i);
    expect(r.motivo).not.toMatch(/m1|g1|c1/); // sin ids del actor/gestión/cierre
  });

  it("R5: mensajero NO bloqueado -> el deshacer procede (regresión 67 verde)", async () => {
    const repo = fakeRepo();
    const { service } = newService({ repo, bloqueados: [] });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r).toEqual({ status: "ok", ordenId: "o1" });
    expect(repo.anularGestionYDevolverAGestion).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Feature 158 (Q-D, 2026-07-30) — deshacerGestion sobre una gestion `incidente`.
//
// Esto REVIERTE PARCIALMENTE la decision de la 154 de dejar `incidente` sin ninguna salida.
// La ventana es la MISMA que la del resto de resultados (`cierre_id IS NULL`) y el destino es
// `en_reparto`, que para una gestion NO es un hardcode aproximado: es el UNICO estado desde el
// que una gestion puede nacer (guardia `cargarOrdenGestionable` de `MisAsignacionesService`),
// asi que destino = origen (design §13.1).
// ============================================================================

describe("Feature 158 · deshacerGestion de un `incidente` (R14/R15, Q-D)", () => {
  it("R14: la gestion `incidente` vigente con la orden en `incidente` SE PUEDE deshacer", async () => {
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () =>
        gestionDeshacer({
          resultado: "incidente",
          cierreId: null, // R14: dentro de la ventana
          orden: { deletedAt: null, estatusId: "s-incidente", estatusValue: "incidente" },
        }),
      ),
    });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r).toEqual({ status: "ok", ordenId: "o1" });
  });

  it("R14: el destino es `en_reparto` (el estado de origen) y REPONE la asignacion al autor", async () => {
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () =>
        gestionDeshacer({
          resultado: "incidente",
          mensajeroId: "m1",
          orden: { deletedAt: null, estatusId: "s-incidente", estatusValue: "incidente" },
        }),
      ),
    });
    const { service, ordenRepo } = newService({ repo });

    await service.deshacerGestion("g1", MENSAJERO, DESHACER_NOW);

    expect(ordenRepo.findEstatusIdByValue).toHaveBeenCalledWith("en_reparto");
    expect(repo.anularGestionYDevolverAGestion).toHaveBeenCalledWith({
      gestionId: "g1",
      ordenId: "o1",
      mensajeroId: "m1", // R14: la asignacion vuelve al mensajero AUTOR
      actorUsuarioId: "m1",
      estatusEsperadoId: "s-incidente", // guardia optimista sobre el estado REAL leido
      estatusEnRepartoId: "s-reparto",
      asignadoAt: DESHACER_NOW, // feature 261 (R19): reloj inyectado
      diaEnCurso: new Date("2026-08-21T00:00:00.000Z"),
    });
  });

  it("R13/R14: si la orden YA NO esta en `incidente`, el deshacer da conflict sin tocarla", async () => {
    // `incidente` es TERMINAL: ninguna via de negocio la mueve. Que la orden este en otro
    // estado significa que alguien la saco por un camino no declarado -> arrancarla de ahi es
    // peligroso. `ESTADOS_ESPERADOS.incidente` es EXACTAMENTE `["incidente"]`, ni uno mas.
    for (const estatusValue of [
      "en_reparto",
      "en_bodega_central",
      "en_bodega_satelite",
      "entregada",
      "rechazada",
      "devuelta",
    ]) {
      const repo = fakeRepo({
        findGestionParaDeshacer: vi.fn(async () =>
          gestionDeshacer({
            resultado: "incidente",
            orden: { deletedAt: null, estatusId: "s-x", estatusValue },
          }),
        ),
      });
      const { service } = newService({ repo });

      const r = await service.deshacerGestion("g1", MENSAJERO);

      expect(r.status, `gestion incidente con la orden en ${estatusValue}`).toBe("conflict");
      expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
    }
  });

  it("R15: gestion `incidente` YA vinculada a un cierre -> conflict accionable, sin tocar la orden", async () => {
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () =>
        gestionDeshacer({
          resultado: "incidente",
          cierreId: "c1", // fuera de la ventana: sus totales ya estan snapshoteados
          orden: { deletedAt: null, estatusId: "s-incidente", estatusValue: "incidente" },
        }),
      ),
    });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("esperaba conflict");
    expect(r.motivo).toMatch(/cierre/i); // accionable: dice POR QUE no se puede
    expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
  });

  it("R15: quien NO es el mensajero autor -> forbidden, sin revelar NADA de la gestion", async () => {
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () =>
        gestionDeshacer({
          resultado: "incidente",
          mensajeroId: "otro-mensajero",
          orden: { deletedAt: null, estatusId: "s-incidente", estatusValue: "incidente" },
        }),
      ),
    });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", { usuarioId: "m1", rol: "mensajero" });

    // `forbidden` no lleva payload: no filtra ni la orden, ni el autor, ni el estado.
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
  });

  it("R15: un rol que no es mensajero tampoco puede deshacer un incidente", async () => {
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () =>
        gestionDeshacer({
          resultado: "incidente",
          orden: { deletedAt: null, estatusId: "s-incidente", estatusValue: "incidente" },
        }),
      ),
    });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", OTRO_ROL);

    expect(r).toEqual({ status: "forbidden" });
    expect(repo.findGestionParaDeshacer).not.toHaveBeenCalled();
  });

  it("R14: el deshacer de un incidente NO mueve dinero (no resuelve tarifa ni crea cierre)", async () => {
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () =>
        gestionDeshacer({
          resultado: "incidente",
          orden: { deletedAt: null, estatusId: "s-incidente", estatusValue: "incidente" },
        }),
      ),
    });
    const { service, tarifaZonaRepo } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r.status).toBe("ok");
    // La indemnizacion se captura al APROBAR el cierre; con `cierre_id = NULL` no hay monto
    // persistido ni movimiento que compensar.
    expect(tarifaZonaRepo.resolvePagoTarifa).not.toHaveBeenCalled();
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Feature 158 (T1.10, R16/R17/R18) — la gestion `incidente` en el detalle y en el cierre.
// ============================================================================

describe("Feature 158 · listarCierreDia con incidentes (R16/R17/R18)", () => {
  it("R18: el `incidente` cae en su grupo PROPIO, no mezclado con los otros cuatro", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "g1", resultado: "entregada", montoRecibido: "10.00" }),
        pendiente({
          gestionId: "g2",
          ordenId: "o2",
          resultado: "incidente",
          montoRecibido: null,
          metodoPago: null,
          motivo: "caja aplastada",
        }),
      ]),
    });
    const { service } = newService({ repo });

    const r = await service.listarCierreDia(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(Object.keys(r.grupos).sort()).toEqual(
      ["devuelta", "entregada", "incidente", "rechazada", "reprogramada"].sort(),
    );
    expect(r.grupos.incidente.map((g) => g.gestionId)).toEqual(["g2"]);
    // Y NO se cuela en ningun otro grupo.
    expect(r.grupos.entregada.map((g) => g.gestionId)).toEqual(["g1"]);
    expect(r.grupos.reprogramada).toEqual([]);
    expect(r.grupos.devuelta).toEqual([]);
    expect(r.grupos.rechazada).toEqual([]);
  });

  it("R17: un `incidente` no aporta pago al mensajero, ni ingreso de bodega, ni totales", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({
          gestionId: "g-inc",
          resultado: "incidente",
          montoRecibido: null,
          metodoPago: null,
          motivo: "robado",
        }),
      ]),
    });
    // Tarifa con montos ALTOS: si el incidente pagara algo, se veria.
    const { service } = newService({
      repo,
      tarifa: { cobroEntregado: "5000.00", cobroRechazado: "2500.00" },
    });

    const r = await service.listarCierreDia(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.totalPagoMensajero).toBe("0.00");
    expect(r.totalIngresoBodegaRechazos).toBe("0.00");
    expect(r.totales.general).toBe("0.00");
    expect(r.grupos.incidente[0].pagoMensajero).toBe("0.00");
    expect(r.grupos.incidente[0].ingresoBodegaRechazo).toBe("0.00");
  });

  it("R16: un dia SOLO con incidentes se puede cerrar (no es un dia vacio)", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "g-inc", resultado: "incidente", montoRecibido: null, metodoPago: null }),
      ]),
    });
    const { service } = newService({ repo });

    const listado = await service.listarCierreDia(MENSAJERO);
    if (listado.status !== "ok") throw new Error("esperaba ok");
    expect(listado.puedesSolicitar).toBe(true);

    const solicitado = await service.solicitarCierre(MENSAJERO);
    expect(solicitado.status).toBe("ok");
    // R16: la gestion viaja al snapshot del cierre con su dinero en 0.00, MISMO grano que el resto.
    const input = (repo.crearCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(input.pagoByGestionId).toEqual({ "g-inc": "0.00" });
    expect(input.ingresoByGestionId).toEqual({ "g-inc": "0.00" });
    expect(input.totalPagoMensajero).toBe("0.00");
    expect(input.totalIngresoBodegaRechazos).toBe("0.00");
  });

  it("R17: mezclado con una entrega, el incidente NO altera el pago de la entrega", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "g1", resultado: "entregada", montoRecibido: "100.00" }),
        pendiente({
          gestionId: "g-inc",
          ordenId: "o2",
          resultado: "incidente",
          montoRecibido: null,
          metodoPago: null,
        }),
      ]),
    });
    const { service } = newService({ repo, tarifa: { cobroEntregado: "7.00", cobroRechazado: "3.00" } });

    const r = await service.listarCierreDia(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    // Solo la entrega paga: 7.00, no 14.00.
    expect(r.totalPagoMensajero).toBe("7.00");
    expect(r.grupos.entregada[0].pagoMensajero).toBe("7.00");
    expect(r.grupos.incidente[0].pagoMensajero).toBe("0.00");
  });
});

describe("Feature 158 · listarCierreDia — la causa sí, el monto NO (R17, design §7.2)", () => {
  it("R9: el detalle del mensajero expone la causa de su propio incidente", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({
          gestionId: "g-inc",
          resultado: "incidente",
          montoRecibido: null,
          metodoPago: null,
          motivo: "me lo robaron en la parada",
          causaIncidente: "robado",
        }),
      ]),
    });
    const { service } = newService({ repo });

    const r = await service.listarCierreDia(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.grupos.incidente[0].causaIncidente).toBe("robado");
  });

  it("R17: el monto de la indemnizacion NO llega a la vista del mensajero (no es plata suya)", async () => {
    // Aunque el repo lo trajera (no lo hace: `WITH_DETALLE` ni lo selecciona), el DTO que ve
    // el mensajero lo lleva en `null`. La indemnizacion la paga Ordenex por el paquete; un
    // numero grande junto a su gestion se leeria como una deuda suya.
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({
          gestionId: "g-inc",
          resultado: "incidente",
          montoRecibido: null,
          metodoPago: null,
          causaIncidente: "danado",
          indemnizacion: null,
        }),
      ]),
    });
    const { service } = newService({ repo });

    const r = await service.listarCierreDia(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.grupos.incidente[0].indemnizacion).toBeNull();
  });

  it("R35: las gestiones de los otros cuatro resultados siguen con los dos campos en `null`", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "g1", resultado: "entregada" }),
        pendiente({ gestionId: "g2", ordenId: "o2", resultado: "rechazada", motivo: "x" }),
      ]),
    });
    const { service } = newService({ repo });

    const r = await service.listarCierreDia(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    for (const g of [...r.grupos.entregada, ...r.grupos.rechazada]) {
      expect(g.causaIncidente).toBeNull();
      expect(g.indemnizacion).toBeNull();
    }
  });
});

// --- Feature 212 (T13, R31): el DTO lleva el desglose y CONSERVA el escalar ---------------

describe("listarCierreDia — el DTO de gestion expone el desglose del recaudo (212/R31)", () => {
  const MIXTA = [
    { metodo: "efectivo" as const, monto: "5000.00" },
    { metodo: "transferencia" as const, monto: "3000.00" },
  ];

  it("una entrega MIXTA llega al DTO con sus dos lineas, en el orden del enum", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "mix", montoRecibido: "8000.00", metodoPago: null, pagos: MIXTA }),
      ]),
    });
    const { service } = newService({ repo });

    const r = await service.listarCierreDia(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.grupos.entregada[0].pagos).toEqual(MIXTA);
  });

  it("R31: `metodoPago` NO desaparece — la 213 lo retira, no esta ficha", async () => {
    // Entre el merge de la 212 y el de la 213 la pantalla sigue pintando el campo escalar.
    // Quitarlo aqui dejaria la app rota en esa ventana, y por eso este caso existe.
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({
          gestionId: "uno",
          montoRecibido: "5000.00",
          metodoPago: "efectivo",
          pagos: [{ metodo: "efectivo", monto: "5000.00" }],
        }),
      ]),
    });
    const { service } = newService({ repo });

    const r = await service.listarCierreDia(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.grupos.entregada[0]).toMatchObject({
      montoRecibido: "5000.00",
      metodoPago: "efectivo",
      pagos: [{ metodo: "efectivo", monto: "5000.00" }],
    });
  });

  it("el mapper NO re-deriva el desglose: pasa EXACTAMENTE lo que trajo el repositorio", async () => {
    // Una fila incoherente a proposito (el escalar dice `SINPE`, las lineas dicen otra cosa):
    // si el DTO «arreglara» el desglose desde `metodoPago`, este caso lo caza.
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({ gestionId: "raro", montoRecibido: "1.00", metodoPago: "SINPE", pagos: [] }),
      ]),
    });
    const { service } = newService({ repo });

    const r = await service.listarCierreDia(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.grupos.entregada[0].pagos).toEqual([]);
    expect(r.grupos.entregada[0].metodoPago).toBe("SINPE");
  });

  it("una gestion que no es entrega llega con el desglose vacio", async () => {
    const repo = fakeRepo({
      findGestionesPendientes: vi.fn(async () => [
        pendiente({
          gestionId: "rep",
          resultado: "reprogramada",
          montoRecibido: null,
          metodoPago: null,
        }),
      ]),
    });
    const { service } = newService({ repo });

    const r = await service.listarCierreDia(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.grupos.reprogramada[0].pagos).toEqual([]);
  });
});

// =================================================================================================
// FEATURE 235 (T4.1/T4.2/T4.3, R22/R23/R24/R25) — EL BLOQUEO DEL CIERRE, EXPLICITO Y NO ACCIDENTAL.
//
// QUE HABIA. Una orden con ayuda pedida bloqueaba el cierre POR ACCIDENTE: la solicitud era una
// BANDERA y la orden seguia en `en_reparto`, que si estaba en `ESTADOS_PENDIENTES`. NADIE habia
// escrito nunca «una orden en ayuda bloquea el cierre», asi que el dia que la orden dejara de estar
// en `en_reparto` —exactamente lo que hace esta ficha— el bloqueo habria desaparecido EN SILENCIO,
// y un mensajero habria podido cerrar el dia con un paquete todavia en la mano.
//
// R23 pide que el bloqueo se derive de una LISTA EXPLICITA en la que el estatus figure POR SU
// NOMBRE. Eso es todo el cambio funcional, y estos casos son lo que lo vuelve auditable.
// =================================================================================================
describe("235 · el bloqueo del cierre (T4.1, R22/R23)", () => {
  it("R23: la lista de estados pendientes NOMBRA `ayuda_tienda`", async () => {
    // Se lee de la llamada real al repo, no de una constante importada: `ESTADOS_PENDIENTES` es
    // privado del modulo y afirmar una copia seria un espejo de si mismo.
    const { service, repo } = newService();

    await service.listarCierreDia(MENSAJERO);

    const estados = (repo.contarOrdenesPendientesGestion as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as string[];
    expect(estados).toContain("ayuda_tienda");
    // Censo CERRADO: uno de mas bloquearia a mensajeros que no tienen nada en la mano.
    expect(estados).toEqual(["por_recoger", "en_reparto", "ayuda_tienda"]);
  });

  it("R22: con una orden en `ayuda_tienda`, `solicitarCierre` devuelve conflict con motivo accionable", async () => {
    // El repo cuenta 1 porque el estatus esta en la lista; si saliera de ella, contaria 0 y el
    // cierre se crearia con el paquete todavia en la moto.
    const repo = fakeRepo({ contarOrdenesPendientesGestion: vi.fn(async () => 1) });
    const { service } = newService({ repo });

    const r = await service.solicitarCierre(MENSAJERO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") return;
    expect(r.motivo).toContain("gestionalas antes de cerrar");
    // Sin PII (R46): el motivo no nombra la orden, ni al mensajero, ni al cierre.
    expect(r.motivo).not.toMatch(/m1|o1|c1/);
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });

  it("R22: el gate de la pantalla dice lo mismo — `puedesSolicitar` en false", async () => {
    const repo = fakeRepo({
      contarOrdenesPendientesGestion: vi.fn(async () => 1),
      findGestionesPendientes: vi.fn(async () => [pendiente()]),
    });
    const { service } = newService({ repo });

    const r = await service.listarCierreDia(MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.puedesSolicitar).toBe(false);
    // Los dos consumidores de la lista dicen lo mismo: el gate y la precondicion. Si divergieran,
    // el boton estaria activo y la accion fallaria al pulsarlo.
    expect(r.motivoBloqueo).toContain("gestionalas antes de cerrar");
  });
});

// =================================================================================================
// FEATURE 235 (T4.2, R24) — LAS DOS RUTAS EXENTAS SIGUEN EXENTAS. Aqui NO se cambia codigo: se
// AFIRMA la exencion para que nadie la «arregle» por simetria.
//
// ⚠️ QUITARLES LA EXENCION REABRE EL DEADLOCK QUE LA 111/R9 CERRO: el mensajero con un cierre
// `vencido` esta BLOQUEADO para gestionar, asi que si ademas no pudiera enviar su vencido a
// aprobacion por tener pendientes, quedaria atrapado sin ninguna salida. Con `ayuda_tienda` en la
// lista, estas dos rutas se comportan EXACTAMENTE igual que con `en_reparto`: una orden en ayuda no
// las bloquea, igual que hoy no las bloquea una orden en reparto.
//
// CONSECUENCIA DECLARADA PARA LA FICHA 237 (design §8): su invariante —«una orden en ayuda BLOQUEA
// la solicitud de cierre, asi que la gestion de la tienda cae antes del snapshot»— es cierta para
// la CREACION de un cierre y FALSA para estas dos rutas de re-solicitud. En ellas el cierre ya
// existe con sus gestiones vinculadas, asi que una gestion posterior nace con `cierre_id = NULL` y
// cae en el cierre SIGUIENTE. No rompe dinero, pero la 237 tiene que probarlo.
// =================================================================================================
describe("235 · la ruta exenta de la precondicion (T4.2, R24)", () => {
  // FEATURE 271 (R16): las DOS rutas exentas se unificaron en UNA (eligen por edad, no por
  // estado), asi que este bloque pasa de dos casos gemelos a uno parametrizado. La exencion NO
  // cambia, y sigue siendo lo que impide el deadlock: un mensajero BLOQUEADO —que desde la 271
  // tampoco recibe trabajo nuevo— quedaria atrapado si ademas no pudiera enviar su cierre.
  it.each([["vencido"], ["rechazado"]] as const)(
    "R24 + 271/R16: con un cierre `%s` y una orden en `ayuda_tienda`, re-solicita igual",
    async (estado) => {
      const repo = fakeRepo({
        findCierreResolicitableMasViejo: vi.fn(async () => ({ id: "c-viejo", estado })),
        transicionarASolicitado: vi.fn(async () => true),
        // Hay una orden en ayuda: el conteo la incluye porque el estatus esta en la lista.
        contarOrdenesPendientesGestion: vi.fn(async () => 1),
      });
      const { service } = newService({ repo });

      const r = await service.solicitarCierre(MENSAJERO);

      expect(r).toMatchObject({ status: "ok", via: "resolicitado" });
      // Y la exencion, dicha como lo que es: esta rama ni siquiera CONSULTA los pendientes.
      expect(repo.contarOrdenesPendientesGestion).not.toHaveBeenCalled();
    },
  );
});

// ==============================================================================================
// FEATURE 264 (B9/Q1, R30) — EL DETALLE PROPIO DEL MENSAJERO TRAE LA MISMA LISTA QUE EL DEL ADMIN.
//
// `CierreFacturaDetalle` lo renderizan DOS modulos: el del admin y el del propio mensajero. Siendo
// el MISMO componente, la seccion aparece en los dos (R30) — que pintara en uno y callara en otro
// es el arreglo a medias que se corrigio en la 263. Aqui se cubre el lado de los DATOS: si el
// servicio del mensajero no emitiera estos dos campos, la pantalla no tendria con que pintarla y
// el arreglo quedaria a medias otra vez, esta vez sin que ningun typecheck lo dijera.
//
// Nada de dinero cruza por aqui: la lista no tiene ni un campo de importe, asi que la regla de
// audiencia de la 38/40 (§7.2, «el mensajero no ve la plata de la empresa») no aplica. Son SUS
// ordenes, las que le bloquearon el cierre.
// ==============================================================================================

describe("264/B9 — verCierrePasado emite `ordenesSinGestion` y `sinGestionRegistrado`", () => {
  const CIERRE_DEL_MENSAJERO = {
    cierreId: "c1",
    estado: "vencido" as const,
    destinoTipo: "bodega_satelite" as const,
    destinoZonaId: "z1",
    totales: { efectivo: "0.00", simpe: "0.00", transferencia: "0.00", general: "0.00" },
    totalPagoMensajero: "0.00",
    totalIngresoBodegaRechazos: "0.00",
    solicitadoAt: "2026-08-20T06:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
  };

  const BARRIDA = {
    ordenId: "o-barrida",
    numGuia: 91,
    numRemision: "REM-91",
    destinatario: "Dora",
    producto: "Caja",
    tiendaNombre: "Tienda W",
    zonaNombre: "Cartago",
    estatusOrigen: "ayuda_tienda" as const,
  };

  function repoCon(sinGestion: (typeof BARRIDA)[], sinGestionRegistrado = true) {
    return fakeRepo({
      findCierrePropioConGestiones: vi.fn(async () => ({
        cierre: CIERRE_DEL_MENSAJERO,
        gestiones: [],
        sinGestion,
        sinGestionRegistrado,
      })),
    });
  }

  it("R30: el detalle propio trae la lista del cierre, con sus ocho campos", async () => {
    const { service } = newService({ repo: repoCon([BARRIDA]) });

    const r = await service.verCierrePasado("c1", MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.ordenesSinGestion).toEqual([BARRIDA]);
    expect(r.sinGestionRegistrado).toBe(true);
  });

  it("R30/R7: pide SOLO el cierre que se abrio, y con el mensajero de la SESION", async () => {
    // El acotamiento no sale de la peticion: el `mensajeroId` lo pone el servicio desde el actor,
    // y la lista cuelga del `cierre_id` que el repo ya cruzo con el en el WHERE.
    const repo = repoCon([BARRIDA]);
    const { service } = newService({ repo });

    await service.verCierrePasado("c1", MENSAJERO);

    expect(repo.findCierrePropioConGestiones).toHaveBeenCalledWith("c1", "m1");
    expect(repo.findCierrePropioConGestiones).toHaveBeenCalledTimes(1);
  });

  it("R30: un cierre AJENO sigue cayendo en `no_encontrada`, sin lista ni marca", async () => {
    const repo = fakeRepo(); // el doble devuelve `null` por defecto
    const { service } = newService({ repo });

    const r = await service.verCierrePasado("c-de-otro", MENSAJERO);

    // Indistinguible de un id inexistente: ni un campo de mas por el que deducir que existe.
    expect(r).toEqual({ status: "no_encontrada" });
    expect(Object.keys(r)).toEqual(["status"]);
  });

  it("R27/R28: la marca viaja tal cual — `[]` con `false` NO es «no hubo ninguna»", async () => {
    const { service } = newService({ repo: repoCon([], false) });

    const r = await service.verCierrePasado("c1", MENSAJERO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.ordenesSinGestion).toEqual([]);
    expect(r.sinGestionRegistrado).toBe(false);
  });

  it("R19/R20: la lista no mueve ni un total ni entra en ningun grupo del mensajero", async () => {
    // Caso EMPAREJADO: mismo cierre, con tres barridas y sin ninguna. Los grupos y los totales
    // salen identicos; lo unico que cambia es la lista.
    const conLista = await newService({
      repo: repoCon([BARRIDA, { ...BARRIDA, ordenId: "b" }, { ...BARRIDA, ordenId: "c" }]),
    }).service.verCierrePasado("c1", MENSAJERO);
    const sinLista = await newService({ repo: repoCon([]) }).service.verCierrePasado(
      "c1",
      MENSAJERO,
    );
    if (conLista.status !== "ok" || sinLista.status !== "ok") throw new Error("esperaba ok");

    expect(conLista.grupos).toEqual(sinLista.grupos);
    expect(conLista.cierre).toEqual(sinLista.cierre);
    // Contrapunto: la lista SI llego (si no, las dos igualdades de arriba serian triviales).
    expect(conLista.ordenesSinGestion).toHaveLength(3);
    expect(sinLista.ordenesSinGestion).toHaveLength(0);
  });
});

// ============================================================================================
// FEATURE 276 (T14, R17) — EL DESHACER SIGUE VIVO SOBRE UNA `reprogramada`.
//
// No hay codigo que escribir para esto, y por eso hay que escribir la PRUEBA DE QUE SIGUE SIENDO
// CIERTO. La ficha 276 difiere la LIBERACION de una orden `reprogramada` (el cron ya no la manda a
// bodega hasta que su cierre se apruebe), asi que la orden pasa MAS TIEMPO en `reprogramada` — y la
// pregunta obvia es si el mensajero conserva su ventana de deshacer durante esa espera.
//
// La respuesta es que si, y la razon es estructural: la ventana depende de `gestion.cierre_id`, NO
// del estado de la orden. Mientras la gestion no entre en un cierre, se deshace; en cuanto entra,
// no — igual que antes de esta ficha. Lo que la 276 alarga es justamente el tramo en que
// `cierre_id` sigue nulo.
//
// ⚠️ Y AQUI ESTA LA REGRESION QUE ESTA FICHA EVITO NO TENIENDO: si se hubiera elegido la opcion A
// del design (§2.2, un pre-estado `reprogramacion_por_confirmar`), `ESTADOS_ESPERADOS.reprogramada`
// habria dejado de casar y el mensajero habria perdido el deshacer EN SILENCIO. Le paso a la 239
// con `devuelta` (ver su T1.5 y el comentario de `ESTADOS_ESPERADOS`). El caso 3 de abajo es el
// centinela de esa decision.
// ============================================================================================

describe("276/R17 — la ventana de deshacer no cambia con la liberacion diferida", () => {
  it("1. `reprogramada` con `cierre_id NULL` sobre una orden en `reprogramada` -> SE DESHACE", async () => {
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () =>
        gestionDeshacer({
          resultado: "reprogramada",
          cierreId: null, // la gestion del dia, aun sin cierre: la ventana esta viva
          orden: { deletedAt: null, estatusId: "s-reprogramada", estatusValue: "reprogramada" },
        }),
      ),
    });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r).toEqual({ status: "ok", ordenId: "o1" });
    // Y la orden vuelve a `en_reparto`, que es el destino unico del deshacer.
    expect(repo.anularGestionYDevolverAGestion).toHaveBeenCalledTimes(1);
    const arg = (repo.anularGestionYDevolverAGestion as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as { estatusEnRepartoId: string };
    expect(arg.estatusEnRepartoId).toBe("s-reparto");
  });

  it("2. la MISMA gestion con `cierre_id` poblado -> conflict, como siempre", async () => {
    // El contrapunto que hace que el caso 1 signifique algo: lo unico que cambia entre los dos es
    // `cierre_id`. Si el deshacer dependiera del ESTADO en vez del cierre, los dos darian igual.
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () =>
        gestionDeshacer({
          resultado: "reprogramada",
          cierreId: "c1",
          orden: { deletedAt: null, estatusId: "s-reprogramada", estatusValue: "reprogramada" },
        }),
      ),
    });
    const { service } = newService({ repo });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("esperaba conflict");
    expect(r.motivo).toMatch(/cierre/i);
    expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
  });

  it("3. la entrada `reprogramada` de la tabla de estados esperados NO cambio", async () => {
    // Se comprueba por CONDUCTA, no leyendo la constante: la orden en `reprogramada` pasa la
    // guarda (caso 1) y una orden que se movio a bodega NO la pasa. Si alguien anadiera un
    // pre-estado a esa entrada —o la sustituyera— este par dejaria de discriminar.
    const enBodega = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () =>
        gestionDeshacer({
          resultado: "reprogramada",
          cierreId: null,
          // La orden ya se libero a bodega: el deshacer NO puede arrancarla de ahi.
          orden: {
            deletedAt: null,
            estatusId: "s-en-bodega",
            estatusValue: "en_bodega_central",
          },
        }),
      ),
    });
    const { service } = newService({ repo: enBodega });

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r.status).toBe("conflict");
    expect(enBodega.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
  });
});

// =================================================================================================
// FEATURE 246 — EL DIA DE REPARTO EN EL GATE DEL CIERRE
//
// La 246 acordo que una orden reservada para un dia que aun no ha llegado esta «en la mano del
// mensajero» y no la toca el corte nocturno. Ese acuerdo se aplico en DOS de los tres sitios que
// deciden sobre esas ordenes (la seleccion del corte y el barrido de `crearCierre`) y NO en el
// tercero: el gate que habilita «Solicitar cierre». Consecuencia medida en produccion el
// 2026-08-25 — un mensajero que habia gestionado todo su dia no podia cerrarlo porque bodega ya le
// habia asignado el trabajo de mañana, y el motivo que leia («gestionalas antes de cerrar») le
// pedia algo IMPOSIBLE: no se puede gestionar una entrega de mañana.
//
// Estos casos afirman las dos mitades del arreglo. La primera —el ancla— es HOY y no `diaCerrado`:
// el corte cierra la jornada ANTERIOR, el mensajero la EN CURSO, y copiar el ancla del corte sin
// mirar habria descartado tambien las ordenes de hoy, que si son deuda suya.
// =================================================================================================
describe("246 · el gate del cierre no cuenta lo reservado para despues", () => {
  // 20:00 CR del 25 = 02:00 UTC del 26. Se elige a proposito una hora en la que UTC ya paso de dia:
  // con `new Date().toISOString().slice(0,10)` o con `inicioDelDiaCREnUtc` el ancla saldria del 26 y
  // las ordenes de MAÑANA (26) empezarian a contar como deuda de HOY. Es el off-by-one de la 166.
  const NOCHE_DEL_25_CR = new Date("2026-08-26T02:00:00.000Z");
  const DIA_CR_ESPERADO = new Date("2026-08-25T00:00:00.000Z");

  it("R11: `listarCierreDia` ancla el conteo en el dia CR de `now`, no en el dia UTC", async () => {
    const { service, repo } = newService();

    await service.listarCierreDia(MENSAJERO, NOCHE_DEL_25_CR);

    const hoyCR = (repo.contarOrdenesPendientesGestion as ReturnType<typeof vi.fn>).mock
      .calls[0][2] as Date;
    expect(hoyCR).toEqual(DIA_CR_ESPERADO);
  });

  it("R11: `solicitarCierre` usa EL MISMO ancla que la lectura", async () => {
    // La asimetria es el fallo que este caso existe para cazar: con anclas distintas el boton se
    // habilita (lectura permisiva) y el submit lo rechaza acto seguido (escritura estricta), o al
    // reves. Las dos llamadas se comparan entre si, no contra una constante.
    const { service, repo } = newService();

    await service.listarCierreDia(MENSAJERO, NOCHE_DEL_25_CR);
    await service.solicitarCierre(MENSAJERO, NOCHE_DEL_25_CR);

    const llamadas = (repo.contarOrdenesPendientesGestion as ReturnType<typeof vi.fn>).mock.calls;
    expect(llamadas).toHaveLength(2);
    expect(llamadas[1][2]).toEqual(llamadas[0][2]);
  });

  it("el reloj es un PARAMETRO con default: sin `now` explicito sigue funcionando", async () => {
    // Doctrina de la 246 (`dia-reparto.ts`): el reloj se inyecta en los tests y jamas se lee dentro
    // del calculo. El default existe para los llamadores de produccion (la Server Action), que no
    // tienen ningun dia que inyectar.
    const { service, repo } = newService();

    const r = await service.listarCierreDia(MENSAJERO);

    expect(r.status).toBe("ok");
    const hoyCR = (repo.contarOrdenesPendientesGestion as ReturnType<typeof vi.fn>).mock
      .calls[0][2] as Date;
    expect(hoyCR).toBeInstanceOf(Date);
    // Medianoche exacta: si alguien sustituyera `startOfDayCR` por `now` a secas, el `lte` del
    // repo dejaria fuera las ordenes de hoy creadas mas tarde en el dia.
    expect(hoyCR.getUTCHours()).toBe(0);
    expect(hoyCR.getUTCMinutes()).toBe(0);
    expect(hoyCR.getUTCSeconds()).toBe(0);
    expect(hoyCR.getUTCMilliseconds()).toBe(0);
  });
});
