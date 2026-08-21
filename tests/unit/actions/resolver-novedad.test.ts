import { describe, it, expect, vi, afterEach } from "vitest";
import { reprogramarNovedad, recuperarABodega, rechazarNovedad } from "@/lib/actions/resolver-novedad";
import type { IReprogramacionTiendaService } from "@/lib/interfaces/services/IReprogramacionTiendaService";
import type { IRecuperacionBodegaService } from "@/lib/interfaces/services/IRecuperacionBodegaService";
import type { IRechazoTiendaService } from "@/lib/interfaces/services/IRechazoTiendaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 100 (T1.4/T2.4) — borde (Server Actions) de resolver la novedad. `unauthenticated` (sin
// sesion, R22) y `validation_error` (ordenId no-uuid / fecha no futura, R4/R23) se resuelven en el
// borde ANTES del service; el resto (ok/forbidden/not_found/conflict/config_error) los devuelve el
// service tal cual. R24: las acciones no registran PII (no reciben ni loguean telefono/destinatario).

const TIENDA: Actor = { usuarioId: "store-1", rol: "adminTienda" };
const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ORDEN_UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
// Fechas independientes del reloj real: 2099 siempre es futura, 2020 siempre es pasada.
const FECHA_FUTURA = "2099-12-31";
const FECHA_PASADA = "2020-01-01";

const noActor = async () => null;
const actorTienda = async () => TIENDA;
const actorMaestro = async () => MAESTRO;

function reprogramarService(
  overrides: Partial<IReprogramacionTiendaService> = {},
): IReprogramacionTiendaService {
  return { reprogramar: vi.fn(async () => ({ status: "ok" as const })), ...overrides };
}

function recuperarService(
  overrides: Partial<IRecuperacionBodegaService> = {},
): IRecuperacionBodegaService {
  return { recuperar: vi.fn(async () => ({ status: "ok" as const })), ...overrides };
}

// Feature 240 (T3.2): el borde del RECHAZO MANUAL de la tienda.
function rechazarService(overrides: Partial<IRechazoTiendaService> = {}): IRechazoTiendaService {
  return { rechazar: vi.fn(async () => ({ status: "ok" as const })), ...overrides };
}

const MOTIVO = "el cliente ya compro en otro lado, no reintentar";

afterEach(() => vi.restoreAllMocks());

describe("reprogramarNovedad (Server Action)", () => {
  it("sin sesion -> unauthenticated, sin tocar el service (R22)", async () => {
    const service = reprogramarService();
    const r = await reprogramarNovedad(
      { ordenId: ORDEN_UUID, fechaReprogramacion: FECHA_FUTURA },
      { service, getActor: noActor },
    );
    expect(r.status).toBe("unauthenticated");
    expect(service.reprogramar).not.toHaveBeenCalled();
  });

  it("ordenId no-uuid -> validation_error, sin tocar el service (R23)", async () => {
    const service = reprogramarService();
    const r = await reprogramarNovedad(
      { ordenId: "no-es-uuid", fechaReprogramacion: FECHA_FUTURA },
      { service, getActor: actorTienda },
    );
    expect(r.status).toBe("validation_error");
    expect(service.reprogramar).not.toHaveBeenCalled();
  });

  it("fecha en el pasado -> validation_error, sin tocar el service (R4)", async () => {
    const service = reprogramarService();
    const r = await reprogramarNovedad(
      { ordenId: ORDEN_UUID, fechaReprogramacion: FECHA_PASADA },
      { service, getActor: actorTienda },
    );
    expect(r.status).toBe("validation_error");
    expect(service.reprogramar).not.toHaveBeenCalled();
  });

  it("fecha con formato invalido / inexistente -> validation_error (R4/R23)", async () => {
    const service = reprogramarService();
    for (const fecha of ["31-12-2099", "2099-13-40", "manana"]) {
      const r = await reprogramarNovedad(
        { ordenId: ORDEN_UUID, fechaReprogramacion: fecha },
        { service, getActor: actorTienda },
      );
      expect(r.status).toBe("validation_error");
    }
    expect(service.reprogramar).not.toHaveBeenCalled();
  });

  it("input valido delega en el service con actor; motivo opcional ausente -> null", async () => {
    const service = reprogramarService();
    const r = await reprogramarNovedad(
      { ordenId: ORDEN_UUID, fechaReprogramacion: FECHA_FUTURA },
      { service, getActor: actorTienda },
    );
    expect(r.status).toBe("ok");
    expect(service.reprogramar).toHaveBeenCalledWith(ORDEN_UUID, FECHA_FUTURA, null, TIENDA);
  });

  it("motivo en blanco (solo espacios) se normaliza a null (Q1: opcional)", async () => {
    const service = reprogramarService();
    await reprogramarNovedad(
      { ordenId: ORDEN_UUID, fechaReprogramacion: FECHA_FUTURA, motivo: "   " },
      { service, getActor: actorTienda },
    );
    expect(service.reprogramar).toHaveBeenCalledWith(ORDEN_UUID, FECHA_FUTURA, null, TIENDA);
  });

  it("motivo presente se pasa (trim) al service", async () => {
    const service = reprogramarService();
    await reprogramarNovedad(
      { ordenId: ORDEN_UUID, fechaReprogramacion: FECHA_FUTURA, motivo: "  cliente pidio  " },
      { service, getActor: actorTienda },
    );
    expect(service.reprogramar).toHaveBeenCalledWith(ORDEN_UUID, FECHA_FUTURA, "cliente pidio", TIENDA);
  });

  it("forbidden/conflict del service pasan tal cual como resultado de dominio", async () => {
    const forbidden = reprogramarService({
      reprogramar: vi.fn(async () => ({ status: "forbidden" as const })),
    });
    const rF = await reprogramarNovedad(
      { ordenId: ORDEN_UUID, fechaReprogramacion: FECHA_FUTURA },
      { service: forbidden, getActor: actorTienda },
    );
    expect(rF.status).toBe("forbidden");

    const conflict = reprogramarService({
      reprogramar: vi.fn(async () => ({ status: "conflict" as const, motivo: "ya no esta en devuelta" })),
    });
    const rC = await reprogramarNovedad(
      { ordenId: ORDEN_UUID, fechaReprogramacion: FECHA_FUTURA },
      { service: conflict, getActor: actorTienda },
    );
    expect(rC.status).toBe("conflict");
  });

  it("R24: no registra PII ni nada en consola en el camino ok", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await reprogramarNovedad(
      { ordenId: ORDEN_UUID, fechaReprogramacion: FECHA_FUTURA, motivo: "x" },
      { service: reprogramarService(), getActor: actorTienda },
    );
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});

describe("recuperarABodega (Server Action)", () => {
  it("sin sesion -> unauthenticated, sin tocar el service (R22)", async () => {
    const service = recuperarService();
    const r = await recuperarABodega({ ordenId: ORDEN_UUID }, { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.recuperar).not.toHaveBeenCalled();
  });

  it("ordenId no-uuid -> validation_error, sin tocar el service (R23)", async () => {
    const service = recuperarService();
    const r = await recuperarABodega({ ordenId: "no-es-uuid" }, { service, getActor: actorMaestro });
    expect(r.status).toBe("validation_error");
    expect(service.recuperar).not.toHaveBeenCalled();
  });

  it("input sin ordenId (forma invalida) -> validation_error, sin service", async () => {
    const service = recuperarService();
    const r = await recuperarABodega({}, { service, getActor: actorMaestro });
    expect(r.status).toBe("validation_error");
    expect(service.recuperar).not.toHaveBeenCalled();
  });

  it("uuid valido delega en el service con el actor y devuelve ok", async () => {
    const service = recuperarService();
    const r = await recuperarABodega({ ordenId: ORDEN_UUID }, { service, getActor: actorMaestro });
    expect(r.status).toBe("ok");
    expect(service.recuperar).toHaveBeenCalledWith(ORDEN_UUID, MAESTRO);
  });

  it("forbidden del service (no responsable) pasa tal cual (R15)", async () => {
    const service = recuperarService({
      recuperar: vi.fn(async () => ({ status: "forbidden" as const })),
    });
    const r = await recuperarABodega({ ordenId: ORDEN_UUID }, { service, getActor: actorMaestro });
    expect(r.status).toBe("forbidden");
  });

  it("un error EXCEPCIONAL del service NO se propaga crudo (withErrorHandler)", async () => {
    const service = recuperarService({
      recuperar: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    await expect(
      recuperarABodega({ ordenId: ORDEN_UUID }, { service, getActor: actorMaestro }),
    ).rejects.toThrow(/AppErrorCode inesperado/);
  });
});

// ---------------------------------------------------------------------------------------------
// 💰 FEATURE 240 (T3.2, D5/R1/R2/R12/R13/R31) — el borde del RECHAZO MANUAL DE LA TIENDA.
//
// Es la tercera accion de este archivo y comparte con sus dos hermanas el `withErrorHandler`, el
// `toResolverNovedadActionError` y el `BorderError`. Lo que NO comparte es la obligatoriedad del
// motivo: `reprogramarSchema` lo tiene opcional (gate F1.4-Q1) y aqui es obligatorio (D5), porque
// esta via cobra y no se puede deshacer.
// ---------------------------------------------------------------------------------------------

describe("rechazarNovedad (Server Action)", () => {
  it("sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = rechazarService();
    const r = await rechazarNovedad(
      { ordenId: ORDEN_UUID, motivo: MOTIVO },
      { service, getActor: noActor },
    );
    expect(r.status).toBe("unauthenticated");
    expect(service.rechazar).not.toHaveBeenCalled();
  });

  it("ordenId no-uuid -> validation_error, sin tocar el service", async () => {
    const service = rechazarService();
    const r = await rechazarNovedad(
      { ordenId: "no-es-uuid", motivo: MOTIVO },
      { service, getActor: actorTienda },
    );
    expect(r.status).toBe("validation_error");
    expect(service.rechazar).not.toHaveBeenCalled();
  });

  it.each([
    ["ausente", {}],
    ["cadena vacia", { motivo: "" }],
    ["solo espacios", { motivo: "   " }],
    ["no es texto", { motivo: 42 }],
  ])("💰 R12: motivo %s -> validation_error, SIN tocar el service", async (_caso, parcial) => {
    // ⭑ El caso que sostiene D5. Sin el, se podria cobrar un rechazo irreversible sin una sola
    // linea que explique por que — y esa linea es el dato que alguien pedira el dia de la primera
    // disputa. La obligatoriedad vive AQUI y no solo en la ventana: un cliente que no sea la
    // ventana llega igual a esta accion.
    const service = rechazarService();
    const r = await rechazarNovedad(
      { ordenId: ORDEN_UUID, ...parcial },
      { service, getActor: actorTienda },
    );
    expect(r.status).toBe("validation_error");
    expect(service.rechazar).not.toHaveBeenCalled();
  });

  it("R13/D5: el borde acepta `{ordenId, motivo}` y NO admite evidencias en imagen", async () => {
    // La ausencia del selector de fotos no es solo de la ventana: el schema del borde tampoco tiene
    // donde ponerlas. El paquete ya volvio y ya se escaneo al aprobar el cierre (238), asi que
    // pedir una foto seria pedir la foto de algo que la tienda no tiene delante.
    const service = rechazarService();
    const r = await rechazarNovedad(
      { ordenId: ORDEN_UUID, motivo: MOTIVO, evidencias: [{ storagePath: "x", contentType: "image/jpeg", indice: 0 }] },
      { service, getActor: actorTienda },
    );
    // zod ignora las claves de mas (no es `.strict()`), asi que lo que se afirma es que el service
    // recibe EXACTAMENTE dos datos y ninguna evidencia llega a viajar.
    expect(r.status).toBe("ok");
    expect(service.rechazar).toHaveBeenCalledWith(ORDEN_UUID, MOTIVO, TIENDA);
  });

  it("R1: delega en el service con el actor DE LA SESION y el motivo, y devuelve ok", async () => {
    const service = rechazarService();
    const r = await rechazarNovedad(
      { ordenId: ORDEN_UUID, motivo: MOTIVO },
      { service, getActor: actorTienda },
    );
    expect(r.status).toBe("ok");
    // ⚠️ El actor NO viaja en el input: lo fija la sesion. Si viajara, cualquiera podria rechazar
    // ordenes ajenas diciendo ser su tienda — y esto cuesta dinero y no se deshace (D6).
    expect(service.rechazar).toHaveBeenCalledWith(ORDEN_UUID, MOTIVO, TIENDA);
  });

  it("el motivo se recorta pero NO se altera su contenido", async () => {
    const service = rechazarService();
    await rechazarNovedad(
      { ordenId: ORDEN_UUID, motivo: `  ${MOTIVO}  ` },
      { service, getActor: actorTienda },
    );
    expect(service.rechazar).toHaveBeenCalledWith(ORDEN_UUID, MOTIVO, TIENDA);
  });

  it.each([
    ["forbidden", { status: "forbidden" as const }],
    ["not_found", { status: "not_found" as const }],
    ["config_error", { status: "config_error" as const }],
    // R10 (2026-08-20): el desenlace que antes NO existia y salia como `INTERNAL`, haciendo que
    // este mismo borde LANZARA («AppErrorCode inesperado INTERNAL») y la pantalla no viera nada.
    // Ahora es un estado de dominio y cruza el borde como cualquier otro.
    ["sin_gestion_origen", { status: "sin_gestion_origen" as const }],
  ])("R2: `%s` del service pasa TAL CUAL, sin traducirse", async (esperado, resultado) => {
    const service = rechazarService({ rechazar: vi.fn(async () => resultado) });
    const r = await rechazarNovedad(
      { ordenId: ORDEN_UUID, motivo: MOTIVO },
      { service, getActor: actorTienda },
    );
    expect(r.status).toBe(esperado);
  });

  it("R31: `conflict` llega con su motivo, para que la pantalla pueda decir QUE paso", async () => {
    // La ventana no puede afirmar que rechazo cuando la carrera se perdio. El borde no come el
    // motivo ni lo convierte en un `ok` optimista.
    const service = rechazarService({
      rechazar: vi.fn(async () => ({
        status: "conflict" as const,
        motivo: "la orden ya no esta en devuelta",
      })),
    });
    const r = await rechazarNovedad(
      { ordenId: ORDEN_UUID, motivo: MOTIVO },
      { service, getActor: actorTienda },
    );
    expect(r).toEqual({ status: "conflict", motivo: "la orden ya no esta en devuelta" });
  });

  it("un error EXCEPCIONAL del service NO se propaga crudo (withErrorHandler)", async () => {
    const service = rechazarService({
      rechazar: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    await expect(
      rechazarNovedad({ ordenId: ORDEN_UUID, motivo: MOTIVO }, { service, getActor: actorTienda }),
    ).rejects.toThrow(/AppErrorCode inesperado/);
  });
});
