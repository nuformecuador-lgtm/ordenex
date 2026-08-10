import { describe, it, expect, vi } from "vitest";
import { recogerAsignaciones, gestionar } from "@/lib/actions/mis-asignaciones";
import type {
  GestionarInput,
  IMisAsignacionesService,
  RecogerInput,
} from "@/lib/interfaces/services/IMisAsignacionesService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 92 (R22/R23) — `ubicacion` OPCIONAL en las acciones del mensajero que disparan
// reoptimizacion.
//
// EL TEST MAS IMPORTANTE DE ESTE ARCHIVO es el de retro-compatibilidad: una llamada SIN el
// campo debe seguir funcionando exactamente igual. R25 lo exige — denegar el permiso de
// geolocalizacion no puede romper el trabajo del mensajero — y ademas es la unica forma de
// que los clientes ya desplegados no se rompan.

const MENSAJERO: Actor = { usuarioId: "m-1", rol: "mensajero" };
const actorMensajero = async () => MENSAJERO;

function buildService() {
  const recoger = vi.fn<
    (input: RecogerInput, actor: Actor) => Promise<{ status: "ok"; recogidas: string[] }>
  >(async () => ({ status: "ok", recogidas: ["o1"] }));
  const gestion = vi.fn<
    (
      input: GestionarInput,
      actor: Actor,
    ) => Promise<{ status: "ok"; ordenId: string; estado: string }>
  >(async () => ({ status: "ok", ordenId: "o1", estado: "reprogramada" }));
  const service = {
    listarMisAsignaciones: vi.fn(),
    recogerAsignaciones: recoger,
    escogerParaGestion: vi.fn(),
    gestionar: gestion,
    liberarGestion: vi.fn(),
  } as unknown as IMisAsignacionesService;
  return { service, recoger, gestion };
}

/** FormData de una reprogramacion (la rama sin evidencia, la mas simple de armar). */
function fdReprogramada(extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("ordenId", "o1");
  fd.set("resultado", "reprogramada");
  // Una fecha holgadamente futura: la validacion exige >= manana en calendario CR.
  fd.set("fechaReprogramacion", "2099-01-01");
  fd.set("motivo", "cliente ausente");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

describe("R22 — recogerAsignaciones acepta `ubicacion` opcional", () => {
  it("RETRO-COMPATIBILIDAD: sin el campo, la llamada funciona igual que antes", async () => {
    const { service, recoger } = buildService();

    const r = await recogerAsignaciones({ ordenIds: ["o1"] }, { service, getActor: actorMensajero });

    expect(r.status).toBe("ok");
    expect(recoger).toHaveBeenCalledTimes(1);
    expect(recoger.mock.calls[0][0]).toEqual({
      ordenIds: ["o1"],
      ubicacion: undefined,
    });
  });

  it("con ubicacion valida, se propaga al service (R23: se persiste como origen `gps`)", async () => {
    const { service, recoger } = buildService();

    await recogerAsignaciones(
      { ordenIds: ["o1", "o2"], ubicacion: { lat: 9.9281, lng: -84.0907 } },
      { service, getActor: actorMensajero },
    );

    expect(recoger.mock.calls[0][0]).toEqual({
      ordenIds: ["o1", "o2"],
      ubicacion: { lat: 9.9281, lng: -84.0907 },
    });
  });

  it.each([
    ["lat fuera de rango", { lat: 91, lng: 0 }],
    ["lng fuera de rango", { lat: 0, lng: -181 }],
    ["lat no numerica", { lat: "x", lng: 0 }],
  ])("%s -> validation_error SIN tocar el service", async (_caso, ubicacion) => {
    const { service, recoger } = buildService();

    const r = await recogerAsignaciones(
      { ordenIds: ["o1"], ubicacion },
      { service, getActor: actorMensajero },
    );

    expect(r.status).toBe("validation_error");
    expect(recoger).not.toHaveBeenCalled();
  });

  it("la validacion de `ordenIds` NO se afloja por el campo nuevo", async () => {
    const { service, recoger } = buildService();
    const r = await recogerAsignaciones(
      { ordenIds: [], ubicacion: { lat: 9.9, lng: -84.1 } },
      { service, getActor: actorMensajero },
    );
    expect(r.status).toBe("validation_error");
    expect(recoger).not.toHaveBeenCalled();
  });
});

// ⚠️ CAMBIO DE CONTRATO — feature 193 (R10/R6), decision humana del 2026-08-10.
//
// Hasta la 192 este bloque afirmaba lo contrario: que gestionar sin ubicacion «funciona igual»
// y que media coordenada «se IGNORA en vez de tumbar la gestion», por la R25 de la 92. Eso ya
// NO rige PARA LA GESTION: ahora hace falta O la ubicacion O un motivo tecnico tipificado.
//
// El bloque de `recogerAsignaciones` de arriba se deja INTACTO a proposito (R15): alli la R25
// sigue viva y una ausencia no bloquea nada. Que los dos bloques de este mismo archivo digan
// cosas distintas NO es una incoherencia: es la frontera exacta del cambio.
describe("Feature 193 (R8-R13) — gestionar EXIGE ubicacion o motivo de ausencia", () => {
  it("R10: un FormData sin ubicacion NI motivo es validation_error", async () => {
    const { service, gestion } = buildService();

    const r = await gestionar(fdReprogramada(), { service, getActor: actorMensajero });

    expect(r.status).toBe("validation_error");
    expect(gestion).not.toHaveBeenCalled();
  });

  it("R9/R18: sin coordenadas pero CON motivo tecnico, la gestion entra", async () => {
    const { service, gestion } = buildService();

    const r = await gestionar(fdReprogramada({ ubicacionAusencia: "no_disponible" }), {
      service,
      getActor: actorMensajero,
    });

    expect(r.status).toBe("ok");
    expect(gestion.mock.calls[0][0].ubicacion).toBeUndefined();
    expect(gestion.mock.calls[0][0].ubicacionAusencia).toBe("no_disponible");
  });

  it("R12: el permiso DENEGADO no es un motivo aceptable — no existe en el enum", async () => {
    // Esta es la via por la que R19 bloquea en el servidor, y no depende de que el front se
    // porte bien: aunque alguien mande el motivo a mano, no hay valor que lo represente.
    const { service, gestion } = buildService();

    const r = await gestionar(fdReprogramada({ ubicacionAusencia: "denegado" }), {
      service,
      getActor: actorMensajero,
    });

    expect(r.status).toBe("validation_error");
    expect(gestion).not.toHaveBeenCalled();
  });

  it("R11: ubicacion Y motivo a la vez es validation_error", async () => {
    const { service, gestion } = buildService();

    const r = await gestionar(
      fdReprogramada({
        ubicacionLat: "9.9281",
        ubicacionLng: "-84.0907",
        ubicacionAusencia: "timeout",
      }),
      { service, getActor: actorMensajero },
    );

    expect(r.status).toBe("validation_error");
    expect(gestion).not.toHaveBeenCalled();
  });

  it("`ubicacionLat` + `ubicacionLng` se recomponen en un objeto y se propagan", async () => {
    const { service, gestion } = buildService();

    await gestionar(fdReprogramada({ ubicacionLat: "9.9281", ubicacionLng: "-84.0907" }), {
      service,
      getActor: actorMensajero,
    });

    expect(gestion.mock.calls[0][0].ubicacion).toEqual({
      lat: 9.9281,
      lng: -84.0907,
    });
  });

  it("R6: MEDIA coordenada ya no cuela — sin la otra mitad no hay ubicacion, y eso ahora bloquea", async () => {
    // La accion sigue IGNORANDO la media coordenada al recomponer (media coordenada no es una
    // ubicacion), pero el resultado de ignorarla ya no es «sigue igual»: se queda sin
    // ubicacion y sin motivo, y R10 lo rechaza. El comportamiento del recompositor no cambio;
    // cambio lo que significa quedarse sin nada.
    const { service, gestion } = buildService();

    const r = await gestionar(fdReprogramada({ ubicacionLat: "9.9281" }), {
      service,
      getActor: actorMensajero,
    });

    expect(r.status).toBe("validation_error");
    expect(gestion).not.toHaveBeenCalled();
  });

  it("cadenas vacias se siguen ignorando, y por tanto tambien caen en R10", async () => {
    const { service, gestion } = buildService();
    const r = await gestionar(fdReprogramada({ ubicacionLat: "", ubicacionLng: "" }), {
      service,
      getActor: actorMensajero,
    });
    expect(r.status).toBe("validation_error");
    expect(gestion).not.toHaveBeenCalled();
  });

  it("una ubicacion fuera de rango SI es validation_error (el campo existe y es invalido)", async () => {
    const { service, gestion } = buildService();

    const r = await gestionar(fdReprogramada({ ubicacionLat: "999", ubicacionLng: "999" }), {
      service,
      getActor: actorMensajero,
    });

    expect(r.status).toBe("validation_error");
    expect(gestion).not.toHaveBeenCalled();
  });

  it("la validacion de la rama de gestion NO se afloja (motivo vacio sigue fallando)", async () => {
    const { service, gestion } = buildService();
    const r = await gestionar(
      fdReprogramada({ motivo: "", ubicacionLat: "9.9", ubicacionLng: "-84.1" }),
      { service, getActor: actorMensajero },
    );
    expect(r.status).toBe("validation_error");
    expect(gestion).not.toHaveBeenCalled();
  });
});
