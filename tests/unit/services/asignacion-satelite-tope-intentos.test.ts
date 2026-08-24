import { describe, it, expect, vi, afterEach } from "vitest";

import { AsignacionSateliteService } from "@/lib/services/AsignacionSateliteService";
import { MSG_TOPE_INTENTOS_ASIGNACION } from "@/lib/services/mensajes-bloqueo";
import { reintentosConfig } from "@/lib/config/reintentos";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  EstadoAsignabilidad,
  IAsignabilidadCoordenadasService,
  OrdenAsignabilidadRow,
} from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

/**
 * FEATURE 276 (T8) — LA MISMA PUERTA EN LA BODEGA SATELITE. R18, R19, R20, R7.
 *
 * 💰 ESPEJO EXACTO de T7. Y no es duplicacion por gusto: la 246/D4 ya tuvo que corregir en ESTE
 * MISMO PAR de servicios una regla que valia distinto segun desde que bodega te asignaran. Aqui lo
 * que impide esa divergencia es que las dos superficies emiten EL MISMO SIMBOLO —comprobado en el
 * caso de R20, comparando los dos contra la constante compartida—.
 */

const ADMIN_SATELITE: Actor = { usuarioId: "u-sat", rol: "adminSatelite" };
const ZONA = "z-limon";
const UMBRAL = reintentosConfig.MIN_INTENTOS_ENTREGA;

function ordenRow(over: Record<string, unknown> = {}) {
  return {
    id: "o1",
    estatusValue: "en_bodega_satelite",
    numGuia: 10,
    deletedAt: null,
    zonaId: ZONA,
    zonaEsGam: false,
    tiendaId: "t1",
    ...over,
  };
}

function fakeRepo(over: Record<string, unknown> = {}) {
  return {
    findUsuarioZonaId: vi.fn(async () => ZONA),
    findMensajeroIdsValidosByZona: vi.fn(async (ids: string[]) => new Set(ids)),
    findByIdsForTransicion: vi.fn(async () => [
      ordenRow({ id: "o1" }),
      ordenRow({ id: "o2" }),
      ordenRow({ id: "o3" }),
    ]),
    findEstatusIdByValue: vi.fn(async (v: string) =>
      v === "en_bodega_satelite" ? "os-sat" : "os-espera",
    ),
    asignarSateliteLote: vi.fn(async (ids: string[]) => ids.length),
    existeBodegaSateliteBloqueada: vi.fn(async () => ({
      bloqueada: false,
      porMensajeros: false,
      porCierreBodega: false,
    })),
    findMensajerosBloqueadosPorCierres: vi.fn(async () => new Set<string>()),
    findParaAsignabilidad: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({
        id,
        direccion: "x",
        latitud: 9.9,
        longitud: -84.1,
        geocodeStatus: "ok",
      })),
    ),
    ...over,
  };
}

function gateOk(): IAsignabilidadCoordenadasService {
  return {
    evaluar: vi.fn(
      async (ordenes: OrdenAsignabilidadRow[]) =>
        new Map<string, EstadoAsignabilidad>(ordenes.map((o) => [o.id, "asignable"])),
    ),
  };
}

function historialCon(
  porOrden: Record<string, number>,
): Pick<IOrdenHistorialService, "contarIntentosEnLote"> {
  return { contarIntentosEnLote: vi.fn(async () => new Map(Object.entries(porOrden))) };
}

function montar(porOrden: Record<string, number>, repoOver: Record<string, unknown> = {}) {
  const repo = fakeRepo(repoOver);
  const gate = gateOk();
  const historial = historialCon(porOrden);
  const service = new AsignacionSateliteService(
    repo as unknown as IOrdenRepository,
    gate,
    historial,
  );
  return { service, repo, gate, historial };
}

const LOTE = { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" };

/* -------------------------------------------------------------------------- */
/* 1 · R18/R19 — todo-o-nada                                                   */
/* -------------------------------------------------------------------------- */

describe("276/T8 · R18/R19 — el satelite tampoco asigna una orden agotada", () => {
  it("1. lote de 3 con UNA en el umbral -> conflict, detalle de las TRES, cero escrituras", async () => {
    const { service, repo } = montar({ o1: 0, o2: UMBRAL, o3: 1 });

    const r = await service.asignar(LOTE, ADMIN_SATELITE);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") return;
    expect(r.detalle).toEqual([
      { ordenId: "o1", motivo: MSG_TOPE_INTENTOS_ASIGNACION },
      { ordenId: "o2", motivo: MSG_TOPE_INTENTOS_ASIGNACION },
      { ordenId: "o3", motivo: MSG_TOPE_INTENTOS_ASIGNACION },
    ]);
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });

  it("2. las tres por debajo del umbral -> asigna, con UNA sola consulta al contador", async () => {
    const { service, repo, historial } = montar({ o1: UMBRAL - 1, o2: 0, o3: 2 });

    const r = await service.asignar(LOTE, ADMIN_SATELITE);

    expect(r.status).toBe("ok");
    expect(repo.asignarSateliteLote).toHaveBeenCalledTimes(1);
    expect(historial.contarIntentosEnLote).toHaveBeenCalledTimes(1);
    expect(
      (historial.contarIntentosEnLote as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toEqual(["o1", "o2", "o3"]);
  });

  it("2.bis — el gate de coordenadas va DESPUES, igual que en la bodega central", async () => {
    const { service, gate } = montar({ o3: UMBRAL });

    const r = await service.asignar(LOTE, ADMIN_SATELITE);

    expect(r.status).toBe("conflict");
    expect(gate.evaluar).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* 3 · R20 — el motivo es EL MISMO en las dos superficies                      */
/* -------------------------------------------------------------------------- */

describe("276/T8 · R20 — un solo motivo, un solo punto", () => {
  it("3. el motivo que emite el satelite es IDENTICO al de la bodega central", async () => {
    // Los dos servicios se ejercitan de verdad y sus dos motivos se comparan CONTRA LA CONSTANTE
    // COMPARTIDA y ENTRE SI. Si alguien escribiera el texto a mano en uno de los dos —aunque
    // fuera con la misma frase hoy— este caso sigue verde... hasta que uno de los dos cambie. Por
    // eso ademas se afirma la identidad de referencia con el simbolo importado, que es lo que de
    // verdad ata las dos superficies a un unico punto.
    const { service } = montar({ o1: UMBRAL });
    const r = await service.asignar(LOTE, ADMIN_SATELITE);

    const { GuiaAsignacionService } = await import("@/lib/services/GuiaAsignacionService");
    const repoCentral = {
      findEstatusIdByValue: vi.fn(async () => "os-x"),
      findByIdsForTransicion: vi.fn(async () => [
        { ...ordenRow({ id: "o1" }), estatusValue: "en_bodega_central", zonaId: "z-gam", zonaEsGam: true },
      ]),
      findMensajeroIdsValidosByZona: vi.fn(async (ids: string[]) => new Set(ids)),
      findMensajerosBloqueadosPorCierres: vi.fn(async () => new Set<string>()),
      findMensajerosConOrdenesEn: vi.fn(async () => new Set<string>()),
      findParaAsignabilidad: vi.fn(async () => []),
      asignarBodegaLote: vi.fn(async () => 1),
    } as unknown as IOrdenRepository;
    const central = new GuiaAsignacionService(
      repoCentral,
      { findCentralZonaId: vi.fn(async () => "z-gam") } as never,
      gateOk(),
      historialCon({ o1: UMBRAL }),
    );
    const rc = await central.asignarDesdeBodega({ ordenIds: ["o1"], mensajeroId: "m1" }, {
      usuarioId: "u-maestro",
      rol: "maestro",
    });

    expect(r.status).toBe("conflict");
    expect(rc.status).toBe("conflict");
    if (r.status !== "conflict" || rc.status !== "conflict") return;
    expect(r.detalle[0].motivo).toBe(MSG_TOPE_INTENTOS_ASIGNACION);
    expect(rc.detalle[0].motivo).toBe(MSG_TOPE_INTENTOS_ASIGNACION);
    expect(r.detalle[0].motivo).toBe(rc.detalle[0].motivo);
  });
});

/* -------------------------------------------------------------------------- */
/* 4 · R7 — el umbral sale de la configuracion                                 */
/* -------------------------------------------------------------------------- */

describe("276/T8 · R7 — con `REINTENTOS_MIN_INTENTOS = 5` la puerta se mueve", () => {
  const ANTES = process.env.REINTENTOS_MIN_INTENTOS;

  afterEach(() => {
    if (ANTES === undefined) delete process.env.REINTENTOS_MIN_INTENTOS;
    else process.env.REINTENTOS_MIN_INTENTOS = ANTES;
    vi.resetModules();
  });

  async function conUmbral5(intentos: number) {
    process.env.REINTENTOS_MIN_INTENTOS = "5";
    vi.resetModules();
    const { AsignacionSateliteService: Fresco } = await import(
      "@/lib/services/AsignacionSateliteService"
    );
    const repo = fakeRepo();
    const service = new Fresco(
      repo as unknown as IOrdenRepository,
      gateOk(),
      historialCon({ o1: intentos, o2: intentos, o3: intentos }),
    );
    return { service, repo };
  }

  it("4a. con 4 intentos deja asignar (4 < 5)", async () => {
    const { service, repo } = await conUmbral5(4);

    const r = await service.asignar(LOTE, ADMIN_SATELITE);

    expect(r.status).toBe("ok");
    expect(repo.asignarSateliteLote).toHaveBeenCalledTimes(1);
  });

  it("4b. con 5 intentos NO deja asignar", async () => {
    const { service, repo } = await conUmbral5(5);

    const r = await service.asignar(LOTE, ADMIN_SATELITE);

    expect(r.status).toBe("conflict");
    expect(repo.asignarSateliteLote).not.toHaveBeenCalled();
  });
});
