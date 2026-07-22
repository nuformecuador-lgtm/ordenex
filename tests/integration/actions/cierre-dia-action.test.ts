import { describe, it, expect, vi } from "vitest";
import { deshacerGestion, listarCierreDia, solicitarCierre } from "@/lib/actions/cierre-dia";
import { CierreDiaService } from "@/lib/services/CierreDiaService";
import type {
  CierreGestionPendienteRow,
  CrearCierreInput,
  GestionDeshacerRow,
  ICierreDiaRepository,
} from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { ICierreDiaService } from "@/lib/interfaces/services/ICierreDiaService";
import type { CierrePasadoDTO } from "@/lib/interfaces/services/ICierreDiaService";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { ITarifaZonaMensajeroRepository } from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 37 — tests de integracion de las Server Actions del cierre (patron
// asignacion-satelite-action.test.ts). Cubre `unauthenticated` sin sesion,
// `forbidden` con rol != mensajero (R1), y el flujo solicitarCierre ok que crea un
// cierre `solicitado` y lo deja visible en el historico (R13/R18), usando un
// CierreDiaService real sobre un repo en memoria.

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const OTRO: Actor = { usuarioId: "u1", rol: "adminSatelite" };

const noActor = async () => null;
const actorMensajero = async () => MENSAJERO;
const actorOtro = async () => OTRO;

function fakeSignedUrls(): ISignedUrlProvider {
  return {
    createSignedUrl: vi.fn(async (p: string) => `https://signed/${p}`),
    createSignedUrls: vi.fn(async (paths: string[]) =>
      Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`])),
    ),
  };
}

// Feature 67 — gestion deshacible por defecto en el repo en memoria (del propio MENSAJERO,
// vigente, sin cierre, con su orden todavia en `entregada`).
const GESTION_DESHACIBLE: GestionDeshacerRow = {
  gestionId: "11111111-1111-4111-8111-111111111111",
  ordenId: "o1",
  mensajeroId: "m1",
  resultado: "entregada",
  cierreId: null,
  anuladaAt: null,
  orden: { deletedAt: null, estatusId: "s-entregada", estatusValue: "entregada" },
};

// Repo en memoria: findGestionesPendientes solo devuelve las NO vinculadas;
// crearCierre las vincula y guarda el cierre; findCierresByMensajero lo lista (R18).
function inMemoryRepo(seed: CierreGestionPendienteRow[]): ICierreDiaRepository {
  let pendientes = [...seed];
  const cierres: CierrePasadoDTO[] = [];
  return {
    findGestionesPendientes: vi.fn(async () => [...pendientes]),
    contarOrdenesPendientesGestion: vi.fn(async () => 0),
    existeCierreSolicitado: vi.fn(async () => false),
    // Feature 111: sin vencido por defecto -> `solicitarCierre` crea (flujo 37).
    existeCierreVencido: vi.fn(async () => false),
    transicionarVencidoASolicitado: vi.fn(async () => true),
    // Feature 67: el deshacer sobre el repo en memoria (caso feliz).
    findGestionParaDeshacer: vi.fn(async () => GESTION_DESHACIBLE),
    findUltimaGestionNoAnuladaId: vi.fn(async () => GESTION_DESHACIBLE.gestionId),
    anularGestionYDevolverAGestion: vi.fn(async () => true),
    crearCierre: vi.fn(async (input: CrearCierreInput) => {
      const id = `c-${cierres.length + 1}`;
      cierres.push({
        cierreId: id,
        estado: "solicitado",
        destinoTipo: input.destinoTipo,
        destinoZonaId: input.destinoZonaId,
        totales: input.totales,
        totalPagoMensajero: input.totalPagoMensajero, // feature 39/R13: snapshot
        totalIngresoBodegaRechazos: input.totalIngresoBodegaRechazos, // feature 56/R12: snapshot
        solicitadoAt: "2026-07-12T10:00:00.000Z",
      });
      pendientes = []; // R13: consume las gestiones pendientes (cierre_id seteado)
      return id;
    }),
    findCierresByMensajero: vi.fn(async () => [...cierres]),
  };
}

function realService(repo: ICierreDiaRepository): ICierreDiaService {
  const zonaRepo = { findCentralZonaId: vi.fn(async () => "z-central") } as unknown as IZonaRepository;
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async () => "z-satelite"),
    findUsuarioVehiculoId: vi.fn(async () => null), // feature 39
    findEstatusIdByValue: vi.fn(async () => "s-reparto"), // feature 67/R18
    findMensajerosBloqueados: vi.fn(async (): Promise<Set<string>> => new Set()), // feature 111/R5
  } as unknown as IOrdenRepository;
  // Feature 39: tarifa por defecto (cobroEntregado 5.00); resuelve el pago en vivo/snapshot.
  const tarifaZonaRepo = {
    resolvePagoTarifa: vi.fn(async () => ({ cobroEntregado: "5.00", cobroRechazado: "3.00" })),
  } as unknown as ITarifaZonaMensajeroRepository;
  return new CierreDiaService(repo, zonaRepo, ordenRepo, fakeSignedUrls(), tarifaZonaRepo);
}

function pendiente(overrides: Partial<CierreGestionPendienteRow> = {}): CierreGestionPendienteRow {
  return {
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
    pagoMensajero: null, // feature 39: snapshot (derivado en vivo por el service)
    ingresoBodegaRechazo: null, // feature 56: snapshot (derivado en vivo por el service)
    esRechazoSla: false, // feature 102
    ...overrides,
  };
}

describe("cierre-dia actions — unauthenticated en el borde", () => {
  it("listarCierreDia sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = { listarCierreDia: vi.fn(), solicitarCierre: vi.fn() } as unknown as ICierreDiaService;
    const r = await listarCierreDia({ service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.listarCierreDia).not.toHaveBeenCalled();
  });

  it("solicitarCierre sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = { listarCierreDia: vi.fn(), solicitarCierre: vi.fn() } as unknown as ICierreDiaService;
    const r = await solicitarCierre({ service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.solicitarCierre).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Feature 67 — Server Action `deshacerGestion`: el BORDE (R7 sesion, R10 zod, R8 rol).
// ============================================================================

const GESTION_ID = "11111111-1111-4111-8111-111111111111"; // uuid v4 valido

function fakeDeshacerService(): ICierreDiaService {
  return {
    listarCierreDia: vi.fn(),
    solicitarCierre: vi.fn(),
    deshacerGestion: vi.fn(async () => ({ status: "ok" as const, ordenId: "o1" })),
  } as unknown as ICierreDiaService;
}

describe("Feature 67 · deshacerGestion action — R7: sesion", () => {
  it("R7: sin sesion -> unauthenticated, SIN ejecutar la logica de negocio ni tocar la DB", async () => {
    const service = fakeDeshacerService();
    const r = await deshacerGestion({ gestionId: GESTION_ID }, { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.deshacerGestion).not.toHaveBeenCalled();
  });

  it("R7: la sesion se resuelve ANTES que zod (sin sesion + id invalido -> unauthenticated)", async () => {
    const service = fakeDeshacerService();
    const r = await deshacerGestion({ gestionId: "no-es-uuid" }, { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.deshacerGestion).not.toHaveBeenCalled();
  });
});

describe("Feature 67 · deshacerGestion action — R10: zod en el borde", () => {
  it("R10: gestionId no-uuid -> validation_error, sin llegar al service", async () => {
    const service = fakeDeshacerService();
    const r = await deshacerGestion({ gestionId: "no-es-uuid" }, { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("esperaba validation_error");
    expect(r.fieldErrors.gestionId).toBeDefined();
    expect(service.deshacerGestion).not.toHaveBeenCalled();
  });

  it("R10: input sin gestionId / de tipo equivocado -> validation_error, sin ejecutar", async () => {
    const service = fakeDeshacerService();
    for (const malo of [{}, { gestionId: 42 }, { gestionId: null }, null, "g1"]) {
      const r = await deshacerGestion(malo, { service, getActor: actorMensajero });
      expect(r.status).toBe("validation_error");
    }
    expect(service.deshacerGestion).not.toHaveBeenCalled();
  });

  it("R10: gestionId uuid valido -> pasa el borde y llega al service", async () => {
    const service = fakeDeshacerService();
    const r = await deshacerGestion({ gestionId: GESTION_ID }, { service, getActor: actorMensajero });
    expect(r).toEqual({ status: "ok", ordenId: "o1" });
    expect(service.deshacerGestion).toHaveBeenCalledWith(GESTION_ID, MENSAJERO);
  });
});

describe("Feature 67 · deshacerGestion action — R8: rol", () => {
  it("R8: rol != mensajero -> forbidden (resultado de dominio del service), sin efectos", async () => {
    const repo = inMemoryRepo([pendiente()]);
    const service = realService(repo);

    const r = await deshacerGestion({ gestionId: GESTION_ID }, { service, getActor: actorOtro });

    expect(r).toEqual({ status: "forbidden" });
    expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
    expect(repo.findGestionParaDeshacer).not.toHaveBeenCalled();
  });

  it("el mensajero dueño deshace su gestion -> ok con el ordenId (service real + repo en memoria)", async () => {
    const repo = inMemoryRepo([pendiente()]);
    const service = realService(repo);

    const r = await deshacerGestion({ gestionId: GESTION_ID }, { service, getActor: actorMensajero });

    expect(r).toEqual({ status: "ok", ordenId: "o1" });
    expect(repo.anularGestionYDevolverAGestion).toHaveBeenCalledTimes(1);
    // R11/R19/R20: el service pasa el rastro (quien deshizo) y repone al mensajero autor.
    expect(repo.anularGestionYDevolverAGestion).toHaveBeenCalledWith(
      expect.objectContaining({ gestionId: GESTION_ID, actorUsuarioId: "m1", mensajeroId: "m1" }),
    );
  });
});

describe("cierre-dia actions — forbidden rol != mensajero (R1)", () => {
  it("listarCierreDia con adminSatelite -> forbidden", async () => {
    const service = realService(inMemoryRepo([pendiente()]));
    const r = await listarCierreDia({ service, getActor: actorOtro });
    expect(r.status).toBe("forbidden");
  });

  it("solicitarCierre con adminSatelite -> forbidden, sin crear", async () => {
    const repo = inMemoryRepo([pendiente()]);
    const service = realService(repo);
    const r = await solicitarCierre({ service, getActor: actorOtro });
    expect(r.status).toBe("forbidden");
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });
});

describe("cierre-dia actions — flujo solicitarCierre ok (R13/R18)", () => {
  it("crea un cierre solicitado y lo deja visible en el historico del mensajero", async () => {
    const repo = inMemoryRepo([
      pendiente({ gestionId: "a", metodoPago: "efectivo", montoRecibido: "12.50" }),
      pendiente({ gestionId: "b", metodoPago: "SIMPE", montoRecibido: "7.50" }),
    ]);
    const service = realService(repo);

    // Antes: hay gestiones pendientes, sin cierres pasados.
    const antes = await listarCierreDia({ service, getActor: actorMensajero });
    if (antes.status !== "ok") throw new Error("esperaba ok");
    expect(antes.puedesSolicitar).toBe(true);
    expect(antes.cierresPasados).toHaveLength(0);

    // R13: solicita -> crea cierre solicitado con totales snapshot.
    const sol = await solicitarCierre({ service, getActor: actorMensajero });
    expect(sol.status).toBe("ok");
    if (sol.status !== "ok") throw new Error("esperaba ok");
    expect(sol.destinoTipo).toBe("bodega_satelite");
    expect(sol.totales).toEqual({ efectivo: "12.50", simpe: "7.50", transferencia: "0.00", general: "20.00" });
    expect(repo.crearCierre).toHaveBeenCalledTimes(1);

    // R18: tras crear, el cierre aparece en el historico; ya no hay pendientes.
    const despues = await listarCierreDia({ service, getActor: actorMensajero });
    if (despues.status !== "ok") throw new Error("esperaba ok");
    expect(despues.cierresPasados).toHaveLength(1);
    expect(despues.cierresPasados[0]).toMatchObject({
      cierreId: sol.cierreId,
      estado: "solicitado",
      destinoTipo: "bodega_satelite",
      totales: { general: "20.00" },
    });
    expect(despues.grupos.entregada).toHaveLength(0); // gestiones ya vinculadas al cierre
    expect(despues.puedesSolicitar).toBe(false); // R11: dia vacio
  });
});
