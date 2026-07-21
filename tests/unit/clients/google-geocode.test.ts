import { describe, it, expect, vi } from "vitest";
import {
  GoogleGeocodeClient,
  GeocodeRespuestaInvalidaError,
} from "@/lib/clients/google-geocode";

// Feature 91 (R19, habilita R18/R20-R24) — el cliente TRADUCE los estados del proveedor a
// vocabulario de dominio y NO decide politica. Todos los casos se ejercitan con `fetch`
// INYECTADO: estos tests NO tocan la red y NO necesitan credencial real.

const API_KEY = "clave-secreta-de-prueba";
const DIRECCION = "Av. Central 100, Carmen, San José, Costa Rica";

function clienteCon(fetchImpl: typeof fetch): GoogleGeocodeClient {
  return new GoogleGeocodeClient({ apiKey: API_KEY, fetchImpl });
}

/** `fetch` falso que responde el JSON dado con el status HTTP dado. */
function fetchJson(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  ) as unknown as typeof fetch;
}

const RESPUESTA_OK = {
  status: "OK",
  results: [
    {
      geometry: {
        location: { lat: 9.9333, lng: -84.0833 },
        location_type: "ROOFTOP",
      },
    },
  ],
};

describe("traduccion de los estados del proveedor", () => {
  it("OK -> ok con latitud, longitud y precision", async () => {
    const outcome = await clienteCon(fetchJson(RESPUESTA_OK)).geocodificar(DIRECCION);
    expect(outcome).toMatchObject({
      status: "ok",
      latitud: 9.9333,
      longitud: -84.0833,
      precision: "ROOFTOP",
    });
  });

  it("ZERO_RESULTS -> sin_resultados", async () => {
    const outcome = await clienteCon(fetchJson({ status: "ZERO_RESULTS", results: [] })).geocodificar(
      DIRECCION,
    );
    expect(outcome.status).toBe("sin_resultados");
  });

  it("INVALID_REQUEST -> consulta_invalida", async () => {
    const outcome = await clienteCon(fetchJson({ status: "INVALID_REQUEST" })).geocodificar(
      DIRECCION,
    );
    expect(outcome.status).toBe("consulta_invalida");
  });

  it("REQUEST_DENIED -> config_invalida", async () => {
    const outcome = await clienteCon(fetchJson({ status: "REQUEST_DENIED" })).geocodificar(
      DIRECCION,
    );
    expect(outcome.status).toBe("config_invalida");
  });

  it.each(["OVER_QUERY_LIMIT", "UNKNOWN_ERROR"])("%s -> transitorio", async (status) => {
    const outcome = await clienteCon(fetchJson({ status })).geocodificar(DIRECCION);
    expect(outcome.status).toBe("transitorio");
  });

  it("HTTP 5xx -> transitorio sin intentar parsear el cuerpo", async () => {
    const outcome = await clienteCon(fetchJson({ status: "OK" }, 503)).geocodificar(DIRECCION);
    expect(outcome.status).toBe("transitorio");
  });

  it("fallo de red o timeout -> transitorio (no lanza)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const outcome = await clienteCon(fetchImpl).geocodificar(DIRECCION);
    expect(outcome.status).toBe("transitorio");
  });

  it("un estado DESCONOCIDO del proveedor se trata como transitorio, no se completa en silencio", async () => {
    const outcome = await clienteCon(fetchJson({ status: "ESTADO_FUTURO" })).geocodificar(
      DIRECCION,
    );
    expect(outcome.status).toBe("transitorio");
  });
});

describe("R19 — validacion de la respuesta en el borde", () => {
  it("una respuesta con forma inesperada produce error de integracion sin credencial ni direccion", async () => {
    // `lat` como string: la forma no cumple el contrato.
    const body = {
      status: "OK",
      results: [{ geometry: { location: { lat: "9.9", lng: -84 }, location_type: "ROOFTOP" } }],
    };
    const promesa = clienteCon(fetchJson(body)).geocodificar(DIRECCION);
    await expect(promesa).rejects.toBeInstanceOf(GeocodeRespuestaInvalidaError);

    const error = (await promesa.catch((e: unknown) => e)) as Error;
    expect(error.message).toContain("geocodificar direccion");
    // Nunca la credencial, la URL ni la direccion (dato personal).
    expect(error.message).not.toContain(API_KEY);
    expect(error.message).not.toContain(DIRECCION);
    expect(error.message).not.toContain("maps.googleapis.com");
    expect(error.message).not.toContain("key=");
  });

  it("status OK sin results incumple el contrato y lanza", async () => {
    await expect(
      clienteCon(fetchJson({ status: "OK", results: [] })).geocodificar(DIRECCION),
    ).rejects.toBeInstanceOf(GeocodeRespuestaInvalidaError);
  });

  it("cuerpo que no es JSON lanza error de integracion", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>500</html>", { status: 200 })) as
      unknown as typeof fetch;
    await expect(clienteCon(fetchImpl).geocodificar(DIRECCION)).rejects.toBeInstanceOf(
      GeocodeRespuestaInvalidaError,
    );
  });

  it("ningun detalle de outcome transitorio filtra credencial, URL ni direccion", async () => {
    const casos = [
      await clienteCon(fetchJson({ status: "OVER_QUERY_LIMIT" })).geocodificar(DIRECCION),
      await clienteCon(fetchJson({ status: "REQUEST_DENIED" })).geocodificar(DIRECCION),
      await clienteCon(fetchJson({ status: "OK" }, 500)).geocodificar(DIRECCION),
    ];
    for (const caso of casos) {
      const detalle = "detalle" in caso ? caso.detalle : "";
      expect(detalle).not.toContain(API_KEY);
      expect(detalle).not.toContain(DIRECCION);
      expect(detalle).not.toContain("maps.googleapis.com");
    }
  });
});

describe("credencial y consulta", () => {
  it("la credencial viaja como query param `key` (la API no acepta cabecera)", async () => {
    const spy = vi.fn(async () =>
      new Response(JSON.stringify(RESPUESTA_OK), { status: 200 }),
    ) as unknown as typeof fetch;
    await clienteCon(spy).geocodificar(DIRECCION);
    const url = String((spy as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]);
    expect(url).toContain(`key=${encodeURIComponent(API_KEY)}`);
    expect(url).toContain("address=");
  });
});
