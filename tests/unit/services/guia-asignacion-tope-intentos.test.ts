import { describe, it, expect, vi, afterEach } from "vitest";

import { GuiaAsignacionService } from "@/lib/services/GuiaAsignacionService";
import { MSG_ORDEN_REPROGRAMADA_BLOQUEADA, MSG_TOPE_INTENTOS_ASIGNACION } from "@/lib/services/mensajes-bloqueo";
import { reintentosConfig } from "@/lib/config/reintentos";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type {
  EstadoAsignabilidad,
  IAsignabilidadCoordenadasService,
  OrdenAsignabilidadRow,
} from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

/**
 * FEATURE 276 (T7) — LA PUERTA DEL TOPE EN LA ASIGNACION DESDE LA BODEGA CENTRAL.
 * R18, R19, R20, R7.
 *
 * 💰 Es la QUINTA via hacia la circulacion del design §1, y hasta esta ficha estaba abierta:
 * `GuiaAsignacionService` no consultaba el contador en NINGUN punto.
 *
 * ⚠️ Y NO ES SUFICIENTE POR SI SOLA. Cerrar solo esta puerta seria poner un guardia que mira un
 * reloj parado: la orden llega a bodega ANTES de que su intento se cuente y en ese instante el
 * contador dice el valor viejo. La raiz la cierra `LiberacionReprogramadaService` (T6).
 */

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const GAM = "z-gam";
const UMBRAL = reintentosConfig.MIN_INTENTOS_ENTREGA;

const ESTATUS: Record<string, string> = {
  por_recoger: "os-espera",
  en_bodega_central: "os-bodega",
};

function ordenRow(over: Record<string, unknown> = {}) {
  return {
    id: "o1",
    estatusValue: "en_bodega_central",
    numGuia: 10,
    deletedAt: null,
    zonaId: GAM,
    zonaEsGam: true,
    tiendaId: "t1",
    ...over,
  };
}

function fakeRepo(over: Record<string, unknown> = {}): IOrdenRepository {
  return {
    findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS[v] ?? null),
    findByIdsForTransicion: vi.fn(async () => [
      ordenRow({ id: "o1" }),
      ordenRow({ id: "o2" }),
      ordenRow({ id: "o3" }),
    ]),
    findMensajeroIdsValidosByZona: vi.fn(async (ids: string[]) => new Set(ids)),
    findMensajerosBloqueadosPorCierres: vi.fn(async () => new Set<string>()),
    findMensajerosConOrdenesEn: vi.fn(async () => new Set<string>()),
    findMensajerosByZona: vi.fn(async () => []),
    findParaAsignabilidad: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({
        id,
        direccion: "x",
        latitud: 9.9,
        longitud: -84.1,
        geocodeStatus: "ok",
      })),
    ),
    generarGuiaLote: vi.fn(async (ds: { ordenId: string }[]) =>
      ds.map((d, i) => ({ ordenId: d.ordenId, numGuia: i + 1 })),
    ),
    asignarBodegaLote: vi.fn(async (ids: string[]) => ids.length),
    recogerLote: vi.fn(async (ids: string[]) => ids.length),
    ...over,
  } as unknown as IOrdenRepository;
}

function fakeZonaRepo(): IZonaRepository {
  return { findCentralZonaId: vi.fn(async () => GAM) } as unknown as IZonaRepository;
}

/** Gate de coordenadas: todo asignable, para que no interfiera con lo que se mide aqui. */
function gateOk(): IAsignabilidadCoordenadasService {
  return {
    evaluar: vi.fn(
      async (ordenes: OrdenAsignabilidadRow[]) =>
        new Map<string, EstadoAsignabilidad>(ordenes.map((o) => [o.id, "asignable"])),
    ),
  };
}

/** Doble del derivador de intentos que registra las llamadas (R18: una sola, sin N+1). */
function historialCon(
  porOrden: Record<string, number>,
): Pick<IOrdenHistorialService, "contarIntentosEnLote"> {
  return {
    contarIntentosEnLote: vi.fn(async () => new Map(Object.entries(porOrden))),
  };
}

function montar(porOrden: Record<string, number>, repoOver: Record<string, unknown> = {}) {
  const repo = fakeRepo(repoOver);
  const gate = gateOk();
  const historial = historialCon(porOrden);
  const service = new GuiaAsignacionService(repo, fakeZonaRepo(), gate, historial);
  return { service, repo, gate, historial };
}

const LOTE = { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" };

/* -------------------------------------------------------------------------- */
/* 1 · R18/R19/R20 — una sola en el umbral aborta el lote entero               */
/* -------------------------------------------------------------------------- */

describe("276/T7 · R18/R19 — todo-o-nada con detalle por orden", () => {
  it("1. lote de 3 con UNA en el umbral -> conflict, detalle de las TRES, y cero escrituras", async () => {
    const { service, repo } = montar({ o1: 0, o2: UMBRAL, o3: 1 });

    const r = await service.asignarDesdeBodega(LOTE, MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") return;
    // R19: el lote COMPLETO se rechaza, y el detalle lleva una entrada POR ORDEN —tambien por las
    // dos que si podian asignarse—, igual que las guardas vecinas de este metodo.
    expect(r.detalle).toEqual([
      { ordenId: "o1", motivo: MSG_TOPE_INTENTOS_ASIGNACION },
      { ordenId: "o2", motivo: MSG_TOPE_INTENTOS_ASIGNACION },
      { ordenId: "o3", motivo: MSG_TOPE_INTENTOS_ASIGNACION },
    ]);
    expect(repo.asignarBodegaLote).not.toHaveBeenCalled();
  });

  it("1.bis — POR ENCIMA del umbral tambien bloquea (`>=`, no `===`)", async () => {
    const { service, repo } = montar({ o1: 0, o2: UMBRAL + 3, o3: 0 });

    const r = await service.asignarDesdeBodega(LOTE, MAESTRO);

    expect(r.status).toBe("conflict");
    expect(repo.asignarBodegaLote).not.toHaveBeenCalled();
  });

  it("1.ter — la orden que NO aparece en el Map cuenta 0 y no bloquea (`?? 0`)", async () => {
    // `contarIntentosVigentesEnLote` no emite grupos vacios: las ordenes sin intentos NO vienen en
    // el Map. Leerlas como `undefined >= umbral` seria `false` por casualidad; el `?? 0` lo hace
    // explicito. Este caso lo fija.
    const { service, repo } = montar({});

    const r = await service.asignarDesdeBodega(LOTE, MAESTRO);

    expect(r.status).toBe("ok");
    expect(repo.asignarBodegaLote).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 2 · R18 sin N+1                                                             */
/* -------------------------------------------------------------------------- */

describe("276/T7 · R18 — por debajo del umbral se asigna, con UNA sola consulta", () => {
  it("2. las tres por debajo -> ok, y `contarIntentosEnLote` se llama UNA vez con las tres", async () => {
    const { service, repo, historial } = montar({ o1: UMBRAL - 1, o2: 0, o3: 1 });

    const r = await service.asignarDesdeBodega(LOTE, MAESTRO);

    expect(r.status).toBe("ok");
    expect(repo.asignarBodegaLote).toHaveBeenCalledTimes(1);
    // Una consulta por LOTE, no una por orden: es el metodo que la 215 creo para esto.
    expect(historial.contarIntentosEnLote).toHaveBeenCalledTimes(1);
    expect(
      (historial.contarIntentosEnLote as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toEqual(["o1", "o2", "o3"]);
  });
});

/* -------------------------------------------------------------------------- */
/* 3 · El orden de guardas no se invierte                                      */
/* -------------------------------------------------------------------------- */

describe("276/T7 · el orden de guardas se conserva", () => {
  it("3. una orden `reprogramada` sigue rechazandose con SU motivo, no con el del tope", async () => {
    // La validacion por orden (existencia/estado/zona) va ANTES: es mas especifica y mas
    // informativa. Si el tope se colara delante, quien asigna leeria un motivo que no es el suyo.
    const { service, historial } = montar(
      { o1: UMBRAL, o2: UMBRAL, o3: UMBRAL },
      {
        findByIdsForTransicion: vi.fn(async () => [
          ordenRow({ id: "o1", estatusValue: "reprogramada" }),
          ordenRow({ id: "o2" }),
          ordenRow({ id: "o3" }),
        ]),
      },
    );

    const r = await service.asignarDesdeBodega(LOTE, MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") return;
    expect(r.detalle).toEqual([{ ordenId: "o1", motivo: MSG_ORDEN_REPROGRAMADA_BLOQUEADA }]);
    // Y ni siquiera se pregunto por el contador: la guarda anterior corto antes.
    expect(historial.contarIntentosEnLote).not.toHaveBeenCalled();
  });

  it("3.bis — el gate de coordenadas va DESPUES: el tope se ensena primero", async () => {
    // El rechazo por tope es DEFINITIVO; el de coordenadas es CORREGIBLE. Ensenar primero el que
    // no tiene arreglo evita que alguien salga a capturar coordenadas para nada.
    const { service, gate } = montar({ o2: UMBRAL });

    const r = await service.asignarDesdeBodega(LOTE, MAESTRO);

    expect(r.status).toBe("conflict");
    expect(gate.evaluar).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* 4 · R7 — el umbral sale de la configuracion                                 */
/* -------------------------------------------------------------------------- */

describe("276/T7 · R7 — con `REINTENTOS_MIN_INTENTOS = 5` la puerta se mueve", () => {
  const ANTES = process.env.REINTENTOS_MIN_INTENTOS;

  afterEach(() => {
    if (ANTES === undefined) delete process.env.REINTENTOS_MIN_INTENTOS;
    else process.env.REINTENTOS_MIN_INTENTOS = ANTES;
    vi.resetModules();
  });

  async function conUmbral5(intentos: number) {
    process.env.REINTENTOS_MIN_INTENTOS = "5";
    vi.resetModules();
    const { GuiaAsignacionService: Fresco } = await import(
      "@/lib/services/GuiaAsignacionService"
    );
    const repo = fakeRepo();
    const service = new Fresco(
      repo,
      fakeZonaRepo(),
      gateOk(),
      historialCon({ o1: intentos, o2: intentos, o3: intentos }),
    );
    return { service, repo };
  }

  it("4a. con 4 intentos deja asignar (4 < 5)", async () => {
    // Con el umbral por defecto (3) esto estaria bloqueado. Que pase demuestra que el numero sale
    // de la configuracion y no de un `3` escrito a mano.
    const { service, repo } = await conUmbral5(4);

    const r = await service.asignarDesdeBodega(LOTE, MAESTRO);

    expect(r.status).toBe("ok");
    expect(repo.asignarBodegaLote).toHaveBeenCalledTimes(1);
  });

  it("4b. con 5 intentos NO deja asignar", async () => {
    const { service, repo } = await conUmbral5(5);

    const r = await service.asignarDesdeBodega(LOTE, MAESTRO);

    expect(r.status).toBe("conflict");
    expect(repo.asignarBodegaLote).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* 5 · `asignarRecoleccion` queda FUERA, y se mide                             */
/* -------------------------------------------------------------------------- */

describe("276/T7 · la recoleccion en tienda NO consulta el contador", () => {
  it("5. `asignarRecoleccion` no llama a `contarIntentosEnLote` ni una vez", async () => {
    // Recolectar en tienda NO es un intento de entrega, y una orden en
    // `por_recolectar_en_tienda` tiene CERO intentos por construccion. Meterle la puerta seria
    // bloquear un viaje a la tienda por un contador que no habla de el.
    const { service, historial } = montar(
      { o1: UMBRAL + 10 },
      {
        findByIdsForTransicion: vi.fn(async () => [
          ordenRow({ id: "o1", estatusValue: "por_recolectar_en_tienda" }),
        ]),
        findEstatusIdByValue: vi.fn(async (v: string) =>
          v === "recolectando" ? "os-recolectando" : (ESTATUS[v] ?? "os-x"),
        ),
        findMensajeroIdsValidos: vi.fn(async (ids: string[]) => new Set(ids)),
        asignarRecoleccionLote: vi.fn(async () => 1),
      },
    );

    await service.asignarRecoleccion({ ordenIds: ["o1"], mensajeroId: "m1" }, MAESTRO);

    expect(historial.contarIntentosEnLote).not.toHaveBeenCalled();
  });
});
