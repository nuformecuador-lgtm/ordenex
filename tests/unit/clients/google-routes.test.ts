import { describe, it, expect, vi } from "vitest";
import { GoogleRoutesClient } from "@/lib/clients/google-routes";
import { RutaNoConfiguradoError } from "@/lib/auth/google-token-shared";

// Feature 92 (seguimiento) — cliente de Google Routes (`computeRoutes`). Se ejercitan TODOS
// los desenlaces sin red: `fetch` y el proveedor de token son inyectables.
//
// LO QUE MAS IMPORTA AQUI: que el ORDEN de las paradas se respete tal cual. Routes sabe
// reordenar waypoints y si lo hiciera, el mapa dibujaria una ruta distinta de la lista de
// paradas que el mensajero tiene delante.

const ORIGEN = { lat: 9.93, lng: -84.09 };
const PARADAS = [
  { ordenId: "o-1", lat: 9.94, lng: -84.08 },
  { ordenId: "o-2", lat: 9.95, lng: -84.07 },
  { ordenId: "o-3", lat: 9.96, lng: -84.06 },
];

const POLILINEA = "gfo}EtohhUxD@bAxJmGF";

function respuestaOk(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function clienteCon(fetchImpl: typeof fetch, getToken = async () => "tok") {
  return new GoogleRoutesClient({ getToken, fetchImpl });
}

describe("trazado ok", () => {
  it("devuelve polilinea, distancia y duracion", async () => {
    const fetchImpl = vi.fn(async () =>
      respuestaOk({
        routes: [
          {
            distanceMeters: 5400,
            duration: "930s",
            polyline: { encodedPolyline: POLILINEA },
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const outcome = await clienteCon(fetchImpl).trazar({
      origen: ORIGEN,
      paradasEnOrden: PARADAS,
    });

    expect(outcome).toEqual({
      status: "ok",
      encodedPolyline: POLILINEA,
      distanciaM: 5400,
      duracionS: 930,
    });
  });

  it("respeta el ORDEN recibido y NO deja que Routes reordene", async () => {
    let cuerpo: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      cuerpo = JSON.parse(init.body as string) as Record<string, unknown>;
      return respuestaOk({ routes: [{ polyline: { encodedPolyline: POLILINEA } }] });
    }) as unknown as typeof fetch;

    await clienteCon(fetchImpl).trazar({ origen: ORIGEN, paradasEnOrden: PARADAS });

    // El ultimo es el destino; los anteriores, intermedios EN SU ORDEN.
    expect(cuerpo.optimizeWaypointOrder).toBe(false);
    expect(cuerpo.origin).toEqual({ location: { latLng: { latitude: 9.93, longitude: -84.09 } } });
    expect(cuerpo.destination).toEqual({
      location: { latLng: { latitude: 9.96, longitude: -84.06 } },
    });
    expect(cuerpo.intermediates).toEqual([
      { location: { latLng: { latitude: 9.94, longitude: -84.08 } } },
      { location: { latLng: { latitude: 9.95, longitude: -84.07 } } },
    ]);
  });

  it("manda el FieldMask (sin el, Routes responde 400)", async () => {
    let cabeceras: Record<string, string> = {};
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      cabeceras = init.headers as Record<string, string>;
      return respuestaOk({ routes: [{ polyline: { encodedPolyline: POLILINEA } }] });
    }) as unknown as typeof fetch;

    await clienteCon(fetchImpl).trazar({ origen: ORIGEN, paradasEnOrden: PARADAS });

    expect(cabeceras["x-goog-fieldmask"]).toBe(
      "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
    );
    expect(cabeceras.authorization).toBe("Bearer tok");
  });

  it("distancia y duracion ausentes -> null, nunca NaN", async () => {
    const fetchImpl = vi.fn(async () =>
      respuestaOk({ routes: [{ polyline: { encodedPolyline: POLILINEA } }] }),
    ) as unknown as typeof fetch;

    const outcome = await clienteCon(fetchImpl).trazar({
      origen: ORIGEN,
      paradasEnOrden: PARADAS,
    });

    expect(outcome).toMatchObject({ status: "ok", distanciaM: null, duracionS: null });
  });

  it("una duracion con forma inesperada NO produce NaN", async () => {
    const fetchImpl = vi.fn(async () =>
      respuestaOk({
        routes: [{ duration: "PT15M", polyline: { encodedPolyline: POLILINEA } }],
      }),
    ) as unknown as typeof fetch;

    const outcome = await clienteCon(fetchImpl).trazar({
      origen: ORIGEN,
      paradasEnOrden: PARADAS,
    });
    expect(outcome).toMatchObject({ status: "ok", duracionS: null });
  });
});

describe("desenlaces que NO son ok", () => {
  it("sin paradas -> omitida, sin llamar al proveedor", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const outcome = await clienteCon(fetchImpl).trazar({ origen: ORIGEN, paradasEnOrden: [] });
    expect(outcome).toEqual({ status: "omitida", razon: "sin_paradas" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("mas intermedios de los que admite Routes -> omitida, sin llamar", async () => {
    // 27 paradas = 26 intermedios + 1 destino. El tope del proveedor son 25 intermedios.
    // Dibujar solo las 25 primeras contradiria la lista de paradas del mensajero.
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const muchas = Array.from({ length: 27 }, (_, i) => ({
      ordenId: `o-${i}`,
      lat: 9.9 + i / 1000,
      lng: -84.1 + i / 1000,
    }));
    const outcome = await clienteCon(fetchImpl).trazar({
      origen: ORIGEN,
      paradasEnOrden: muchas,
    });
    expect(outcome).toEqual({ status: "omitida", razon: "demasiadas_paradas" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("exactamente 26 paradas (25 intermedios + destino) SI se traza", async () => {
    const fetchImpl = vi.fn(async () =>
      respuestaOk({ routes: [{ polyline: { encodedPolyline: POLILINEA } }] }),
    ) as unknown as typeof fetch;
    const justas = Array.from({ length: 26 }, (_, i) => ({
      ordenId: `o-${i}`,
      lat: 9.9 + i / 1000,
      lng: -84.1 + i / 1000,
    }));
    const outcome = await clienteCon(fetchImpl).trazar({
      origen: ORIGEN,
      paradasEnOrden: justas,
    });
    expect(outcome).toMatchObject({ status: "ok" });
  });

  it.each([
    [401, "config_invalida"],
    [403, "config_invalida"],
    [400, "config_invalida"],
    [429, "transitorio"],
    [500, "transitorio"],
    [503, "transitorio"],
  ] as const)("HTTP %i -> %s", async (status, esperado) => {
    const fetchImpl = vi.fn(async () => respuestaOk({}, status)) as unknown as typeof fetch;
    const outcome = await clienteCon(fetchImpl).trazar({
      origen: ORIGEN,
      paradasEnOrden: PARADAS,
    });
    expect(outcome.status).toBe(esperado);
  });

  it("red caida -> transitorio, no lanza", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const outcome = await clienteCon(fetchImpl).trazar({
      origen: ORIGEN,
      paradasEnOrden: PARADAS,
    });
    expect(outcome.status).toBe("transitorio");
  });

  it("2xx sin polilinea -> omitida (no un ok con cadena vacia)", async () => {
    // Un `ok` con polilinea vacia haria que el consumidor pintara una ruta invisible y
    // creyera que el trazado funciono.
    const fetchImpl = vi.fn(async () =>
      respuestaOk({ routes: [{ distanceMeters: 100 }] }),
    ) as unknown as typeof fetch;
    const outcome = await clienteCon(fetchImpl).trazar({
      origen: ORIGEN,
      paradasEnOrden: PARADAS,
    });
    expect(outcome).toEqual({ status: "omitida", razon: "sin_polilinea" });
  });

  it("respuesta con forma invalida -> transitorio, citando campos y no valores", async () => {
    const fetchImpl = vi.fn(async () =>
      respuestaOk({ routes: [{ distanceMeters: "muchos" }] }),
    ) as unknown as typeof fetch;
    const outcome = await clienteCon(fetchImpl).trazar({
      origen: ORIGEN,
      paradasEnOrden: PARADAS,
    });
    expect(outcome.status).toBe("transitorio");
    if (outcome.status === "transitorio") {
      expect(outcome.detalle).toContain("distanceMeters");
      expect(outcome.detalle).not.toContain("muchos");
    }
  });
});

describe("credencial y saneo de mensajes", () => {
  it("el fallo del proveedor de token se PROPAGA tal cual (no se traga)", async () => {
    // `RutaNoConfiguradoError` debe llegar reconocible: quien llama decide si eso es un
    // fallo o un "sin credencial configurada".
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const cliente = new GoogleRoutesClient({
      fetchImpl,
      getToken: async () => {
        throw new RutaNoConfiguradoError("GOOGLE_WIF_POOL_ID");
      },
    });
    await expect(
      cliente.trazar({ origen: ORIGEN, paradasEnOrden: PARADAS }),
    ).rejects.toBeInstanceOf(RutaNoConfiguradoError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ningun detalle de error cita el token ni una coordenada", async () => {
    const fetchImpl = vi.fn(async () => respuestaOk({}, 403)) as unknown as typeof fetch;
    const outcome = await clienteCon(fetchImpl, async () => "token-secretisimo").trazar({
      origen: ORIGEN,
      paradasEnOrden: PARADAS,
    });
    const detalle = "detalle" in outcome ? outcome.detalle : "";
    expect(detalle).not.toContain("token-secretisimo");
    expect(detalle).not.toContain("9.93");
    expect(detalle).not.toContain("-84.09");
  });
});
