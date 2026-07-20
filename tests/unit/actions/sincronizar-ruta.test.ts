import { describe, it, expect, vi } from "vitest";
import { sincronizarRuta } from "@/lib/actions/ruta-mensajero";
import { RutaIntentoFallidoError } from "@/lib/services/OptimizacionRutaService";
import type {
  EjecutarOptimizacionOpts,
  EjecutarOptimizacionResult,
  IOptimizacionRutaService,
} from "@/lib/interfaces/services/IOptimizacionRutaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 92 (R22/R31/R32/R33/R34) — la Server Action de sincronizacion manual.
//
// La guarda de rol (R33) NO es decoracion aunque la pagina ya haga `notFound()` para roles
// distintos de `mensajero`: una Server Action es un ENDPOINT, invocable directamente con su
// id sin pasar por la pagina. Sin la guarda, cualquier sesion valida podria disparar una
// llamada FACTURADA contra la ruta de otra persona.

const MENSAJERO: Actor = { usuarioId: "m-1", rol: "mensajero" };

function build(resultado: EjecutarOptimizacionResult | Error = { status: "ok", paradas: 3 }) {
  const ejecutar = vi.fn<
    (mensajeroId: string, opts: EjecutarOptimizacionOpts) => Promise<EjecutarOptimizacionResult>
  >(async () => {
    if (resultado instanceof Error) throw resultado;
    return resultado;
  });
  return { service: { ejecutar } as unknown as IOptimizacionRutaService, ejecutar };
}

const actorDe = (actor: Actor | null) => async () => actor;

describe("R33 — guarda de rol", () => {
  it.each(["maestro", "admin", "adminTienda", "adminSatelite"] as const)(
    "rol %s -> forbidden SIN efectos ni llamada al proveedor",
    async (rol) => {
      const { service, ejecutar } = build();

      const r = await sincronizarRuta(
        {},
        { service, getActor: actorDe({ usuarioId: "u", rol }) },
      );

      expect(r).toEqual({ status: "forbidden" });
      expect(ejecutar).not.toHaveBeenCalled();
    },
  );

  it("sin sesion -> unauthenticated, sin llamar al service", async () => {
    const { service, ejecutar } = build();
    const r = await sincronizarRuta({}, { service, getActor: actorDe(null) });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(ejecutar).not.toHaveBeenCalled();
  });

  it("el rol se comprueba ANTES de parsear (un payload invalido de un rol ajeno da forbidden)", async () => {
    const { service } = build();
    const r = await sincronizarRuta(
      { ubicacion: { lat: 999, lng: 999 } },
      { service, getActor: actorDe({ usuarioId: "u", rol: "maestro" }) },
    );
    expect(r).toEqual({ status: "forbidden" });
  });
});

describe("R32 — la sincronizacion es SINCRONA y usa el motivo `manual`", () => {
  it("mensajero -> ejecuta el service en el acto con motivo manual", async () => {
    const { service, ejecutar } = build();

    const r = await sincronizarRuta({}, { service, getActor: actorDe(MENSAJERO) });

    expect(r).toEqual({ status: "ok", omitida: false });
    expect(ejecutar).toHaveBeenCalledTimes(1);
    expect(ejecutar.mock.calls[0]).toEqual(["m-1", { motivo: "manual", ubicacion: undefined }]);
  });

  it("una guarda de coste que omite la optimizacion sigue siendo `ok`, con omitida=true", async () => {
    const { service } = build({ status: "omitida", razon: "sin_cambios" });
    const r = await sincronizarRuta({}, { service, getActor: actorDe(MENSAJERO) });
    expect(r).toEqual({ status: "ok", omitida: true });
  });

  it("sin argumentos (input por defecto) funciona igual", async () => {
    const { service, ejecutar } = build();
    const r = await sincronizarRuta(undefined, { service, getActor: actorDe(MENSAJERO) });
    expect(r.status).toBe("ok");
    expect(ejecutar).toHaveBeenCalledTimes(1);
  });
});

describe("R22 — zod de la ubicacion en el borde", () => {
  it("una ubicacion valida se propaga al service", async () => {
    const { service, ejecutar } = build();

    await sincronizarRuta(
      { ubicacion: { lat: 9.9281, lng: -84.0907 } },
      { service, getActor: actorDe(MENSAJERO) },
    );

    expect(ejecutar.mock.calls[0][1]).toEqual({
      motivo: "manual",
      ubicacion: { lat: 9.9281, lng: -84.0907 },
    });
  });

  it.each([
    ["lat > 90", { lat: 91, lng: 0 }],
    ["lat < -90", { lat: -91, lng: 0 }],
    ["lng > 180", { lat: 0, lng: 181 }],
    ["lng < -180", { lat: 0, lng: -181 }],
    ["lat no numerica", { lat: "9.9", lng: 0 }],
    ["lng ausente", { lat: 9.9 }],
  ])("%s -> validation_error SIN llamar al proveedor", async (_caso, ubicacion) => {
    // Una coordenada absurda llegaria hasta `optimizeTours` y produciria una llamada
    // FACTURADA que solo puede fallar, o peor: una ruta calculada desde un punto imposible.
    const { service, ejecutar } = build();

    const r = await sincronizarRuta({ ubicacion }, { service, getActor: actorDe(MENSAJERO) });

    expect(r.status).toBe("validation_error");
    expect(ejecutar).not.toHaveBeenCalled();
  });

  it("SIN ubicacion (permiso denegado) ejecuta igual: R25 prohibe bloquear por geolocalizacion", async () => {
    const { service, ejecutar } = build();
    const r = await sincronizarRuta({}, { service, getActor: actorDe(MENSAJERO) });
    expect(r.status).toBe("ok");
    expect(ejecutar).toHaveBeenCalledTimes(1);
    expect(ejecutar.mock.calls[0][1].ubicacion).toBeUndefined();
  });

  it("los limites EXACTOS del sistema de coordenadas se aceptan", async () => {
    const { service } = build();
    for (const ubicacion of [
      { lat: 90, lng: 180 },
      { lat: -90, lng: -180 },
      { lat: 0, lng: 0 },
    ]) {
      const r = await sincronizarRuta({ ubicacion }, { service, getActor: actorDe(MENSAJERO) });
      expect(r.status).toBe("ok");
    }
  });
});

describe("R34 — intervalo minimo -> conflict, no un `ok` mentiroso", () => {
  it("el service omite por intervalo_minimo y la action lo traduce a conflict", async () => {
    const { service } = build({ status: "omitida", razon: "intervalo_minimo" });

    const r = await sincronizarRuta({}, { service, getActor: actorDe(MENSAJERO) });

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.motivo).toMatch(/hace muy poco/);
  });
});

describe("R27 — fallo del proveedor: conflict accionable, sin filtrar el detalle", () => {
  it("un RutaIntentoFallidoError se traduce a conflict citando que se conserva el orden", async () => {
    const { service } = build(new RutaIntentoFallidoError("optimizar ruta: HTTP 503"));

    const r = await sincronizarRuta({}, { service, getActor: actorDe(MENSAJERO) });

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.motivo).toMatch(/se conserva el ultimo orden/);
      // El detalle interno del proveedor NO se reenvia al cliente.
      expect(r.motivo).not.toContain("HTTP 503");
    }
  });

  it("un error DESCONOCIDO no se disfraza de conflict (se propaga como fallo real)", async () => {
    const { service } = build(new Error("caida de DB"));
    await expect(sincronizarRuta({}, { service, getActor: actorDe(MENSAJERO) })).rejects.toThrow();
  });
});
