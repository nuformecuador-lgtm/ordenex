import { describe, it, expect, vi } from "vitest";
import {
  GoogleRouteOptimizationClient,
  RutaPeticionRechazadaError,
  RutaRespuestaInvalidaError,
} from "@/lib/clients/google-route-optimization";
import type { OptimizarInput } from "@/lib/interfaces/external/IRouteOptimizationClient";

// Feature 92 (R13/R14/R15) — el cliente se ejercita SIN red y SIN credencial: `fetch` es
// inyectable. Coordenadas reales de San Jose para que un fallo de mapeo se lea de un
// vistazo.

const TOKEN = "ya29.token-super-secreto";
const PROJECT = "ordenex-prod-123";

const PARADAS: OptimizarInput["paradas"] = [
  { ordenId: "orden-A", lat: 9.9281, lng: -84.0907 },
  { ordenId: "orden-B", lat: 9.9355, lng: -84.0839 },
  { ordenId: "orden-C", lat: 9.9412, lng: -84.1012 },
];
const INPUT: OptimizarInput = { origen: { lat: 9.93, lng: -84.09 }, paradas: PARADAS };

function client(fetchImpl: unknown, getToken: () => Promise<string> = async () => TOKEN) {
  return new GoogleRouteOptimizationClient({
    projectId: PROJECT,
    getToken,
    fetchImpl: fetchImpl as typeof fetch,
  });
}

function respuesta(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("R13 — request y respuesta valida", () => {
  it("envia un shipment por parada, un vehiculo con el origen, y el Bearer del token", async () => {
    const fetchImpl = vi.fn(async () =>
      respuesta(200, { routes: [{ visits: [{ shipmentIndex: 2 }, { shipmentIndex: 0 }, { shipmentIndex: 1 }] }] }),
    );
    await client(fetchImpl).optimizar(INPUT);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `https://routeoptimization.googleapis.com/v1/projects/${PROJECT}:optimizeTours`,
    );
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);

    const body = JSON.parse(init.body as string);
    expect(body.model.shipments).toHaveLength(3);
    expect(body.model.vehicles).toHaveLength(1);
    expect(body.model.vehicles[0].startWaypoint.location.latLng).toEqual({
      latitude: 9.93,
      longitude: -84.09,
    });
    expect(body.model.shipments[0].deliveries[0].arrivalWaypoint.location.latLng).toEqual({
      latitude: 9.9281,
      longitude: -84.0907,
    });
    // El `ordenId` NO viaja al proveedor: el indice del array ES la traduccion.
    expect(JSON.stringify(body)).not.toContain("orden-A");
  });

  it("traduce shipmentIndex -> ordenId respetando el ORDEN de las visitas", async () => {
    const fetchImpl = vi.fn(async () =>
      respuesta(200, { routes: [{ visits: [{ shipmentIndex: 2 }, { shipmentIndex: 0 }, { shipmentIndex: 1 }] }] }),
    );
    const r = await client(fetchImpl).optimizar(INPUT);
    expect(r).toEqual({ status: "ok", secuencia: ["orden-C", "orden-A", "orden-B"] });
  });

  it("TRAMPA PROTO3-JSON: `shipmentIndex` AUSENTE significa 0, no 'campo faltante'", async () => {
    // Las APIs protobuf de Google omiten los valores por defecto al serializar a JSON. Si
    // el schema exigiera `shipmentIndex`, TODA ruta que empiece por la primera parada
    // —es decir, casi todas— fallaria el parseo en produccion.
    const fetchImpl = vi.fn(async () =>
      respuesta(200, { routes: [{ visits: [{}, { shipmentIndex: 1 }, { shipmentIndex: 2 }] }] }),
    );
    const r = await client(fetchImpl).optimizar(INPUT);
    expect(r).toEqual({ status: "ok", secuencia: ["orden-A", "orden-B", "orden-C"] });
  });
});

describe("R13 — una forma inesperada NUNCA produce una secuencia parcial o vacia", () => {
  it("cuerpo que no es JSON -> RutaRespuestaInvalidaError", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("Unexpected token <");
      },
    }));
    await expect(client(fetchImpl).optimizar(INPUT)).rejects.toThrow(RutaRespuestaInvalidaError);
  });

  it("routes con forma invalida -> RutaRespuestaInvalidaError citando el campo", async () => {
    const fetchImpl = vi.fn(async () => respuesta(200, { routes: "no-es-un-array" }));
    const error = await client(fetchImpl).optimizar(INPUT).catch((e: Error) => e);
    expect(error).toBeInstanceOf(RutaRespuestaInvalidaError);
    expect((error as Error).message).toContain("routes");
  });

  it("sin routes -> lanza en vez de devolver una secuencia vacia", async () => {
    // Devolver `[]` aqui BORRARIA el ultimo orden bueno persistido: peor que no optimizar.
    const fetchImpl = vi.fn(async () => respuesta(200, {}));
    await expect(client(fetchImpl).optimizar(INPUT)).rejects.toThrow(/sin routes/);
  });

  it("una secuencia que no cubre TODAS las paradas -> lanza (nunca se persiste parcial)", async () => {
    const fetchImpl = vi.fn(async () =>
      respuesta(200, { routes: [{ visits: [{ shipmentIndex: 0 }, { shipmentIndex: 1 }] }] }),
    );
    await expect(client(fetchImpl).optimizar(INPUT)).rejects.toThrow(
      /no cubre todas las paradas/,
    );
  });

  it("shipmentIndex fuera de rango -> lanza (no indexa fuera del array)", async () => {
    const fetchImpl = vi.fn(async () =>
      respuesta(200, { routes: [{ visits: [{ shipmentIndex: 99 }] }] }),
    );
    await expect(client(fetchImpl).optimizar(INPUT)).rejects.toThrow(/fuera de rango/);
  });

  it("shipmentIndex repetido -> lanza (el contrato asumido no seria el real)", async () => {
    const fetchImpl = vi.fn(async () =>
      respuesta(200, {
        routes: [{ visits: [{ shipmentIndex: 0 }, { shipmentIndex: 0 }, { shipmentIndex: 1 }] }],
      }),
    );
    await expect(client(fetchImpl).optimizar(INPUT)).rejects.toThrow(/repetido/);
  });
});

describe("R15 — traduccion de desenlaces", () => {
  it("fallo de red o timeout -> transitorio", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("AbortError");
    });
    const r = await client(fetchImpl).optimizar(INPUT);
    expect(r.status).toBe("transitorio");
  });

  it.each([500, 503])("HTTP %i -> transitorio", async (status) => {
    const fetchImpl = vi.fn(async () => respuesta(status, {}));
    const r = await client(fetchImpl).optimizar(INPUT);
    expect(r.status).toBe("transitorio");
  });

  it("HTTP 429 (cuota) -> transitorio", async () => {
    const fetchImpl = vi.fn(async () => respuesta(429, {}));
    const r = await client(fetchImpl).optimizar(INPUT);
    expect(r.status).toBe("transitorio");
  });

  it.each([401, 403])("HTTP %i -> config_invalida", async (status) => {
    const fetchImpl = vi.fn(async () => respuesta(status, {}));
    const r = await client(fetchImpl).optimizar(INPUT);
    expect(r.status).toBe("config_invalida");
  });

  it("HTTP 400 -> RutaPeticionRechazadaError (ruidoso, NO disfrazado de transitorio)", async () => {
    // Un 400 es un fallo NUESTRO (modelo mal formado). Tratarlo como transitorio lo
    // condenaria a reintentarse 5 veces y morir en el dead-letter sin diagnostico.
    const fetchImpl = vi.fn(async () => respuesta(400, {}));
    await expect(client(fetchImpl).optimizar(INPUT)).rejects.toThrow(RutaPeticionRechazadaError);
  });

  it("el error del proveedor de token se propaga TAL CUAL, sin llamar a la API", async () => {
    const fetchImpl = vi.fn();
    const boom = new Error("optimizacion de ruta: credencial incompleta (falta X)");
    await expect(
      client(fetchImpl, async () => {
        throw boom;
      }).optimizar(INPUT),
    ).rejects.toBe(boom);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("R14 — ningun mensaje de error cita token, URL, coordenadas ni ordenId", () => {
  const PROHIBIDO = [TOKEN, PROJECT, "routeoptimization.googleapis.com", "9.9281", "-84.0907", "orden-A"];

  function assertLimpio(texto: string) {
    for (const secreto of PROHIBIDO) {
      expect(texto).not.toContain(secreto);
    }
  }

  it("los detalles de los desenlaces transitorio/config_invalida estan saneados", async () => {
    for (const status of [429, 500, 401, 403]) {
      const r = await client(vi.fn(async () => respuesta(status, {}))).optimizar(INPUT);
      if (r.status !== "ok") assertLimpio(r.detalle);
    }
    const red = await client(
      vi.fn(async () => {
        throw new Error(`ECONNREFUSED routeoptimization.googleapis.com ${TOKEN}`);
      }),
    ).optimizar(INPUT);
    if (red.status !== "ok") assertLimpio(red.detalle);
  });

  it("los errores LANZADOS tampoco filtran nada", async () => {
    const casos: unknown[] = [
      vi.fn(async () => respuesta(400, {})),
      vi.fn(async () => respuesta(200, { routes: "x" })),
      vi.fn(async () => respuesta(200, {})),
      vi.fn(async () => respuesta(200, { routes: [{ visits: [{ shipmentIndex: 99 }] }] })),
    ];
    for (const fetchImpl of casos) {
      const error = await client(fetchImpl).optimizar(INPUT).catch((e: Error) => e);
      assertLimpio((error as Error).message);
    }
  });
});
