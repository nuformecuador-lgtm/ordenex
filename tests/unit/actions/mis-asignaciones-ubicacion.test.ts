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

describe("R22 — gestionar acepta `ubicacion` opcional via FormData", () => {
  it("RETRO-COMPATIBILIDAD: un FormData sin los campos de ubicacion funciona igual", async () => {
    const { service, gestion } = buildService();

    const r = await gestionar(fdReprogramada(), { service, getActor: actorMensajero });

    expect(r.status).toBe("ok");
    expect(gestion.mock.calls[0][0].ubicacion).toBeUndefined();
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

  it("MEDIA coordenada se IGNORA en vez de tumbar la gestion", async () => {
    // Media coordenada no es una ubicacion. Dejarla pasar a zod haria fallar toda la
    // gestion por un dato AUXILIAR, que es exactamente lo que R25 prohibe.
    const { service, gestion } = buildService();

    const r = await gestionar(fdReprogramada({ ubicacionLat: "9.9281" }), {
      service,
      getActor: actorMensajero,
    });

    expect(r.status).toBe("ok");
    expect(gestion.mock.calls[0][0].ubicacion).toBeUndefined();
  });

  it("cadenas vacias tambien se ignoran", async () => {
    const { service, gestion } = buildService();
    const r = await gestionar(fdReprogramada({ ubicacionLat: "", ubicacionLng: "" }), {
      service,
      getActor: actorMensajero,
    });
    expect(r.status).toBe("ok");
    expect(gestion.mock.calls[0][0].ubicacion).toBeUndefined();
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
