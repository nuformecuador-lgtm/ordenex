import { describe, it, expect, vi } from "vitest";
import {
  extraerCodigosDeSalto,
  GoogleRouteOptimizationClient,
  motivoSinSolucion,
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
    // Feature 265: el desenlace `ok` declara quien ordeno. Aqui, el proveedor.
    expect(r).toEqual({
      status: "ok",
      secuencia: ["orden-C", "orden-A", "orden-B"],
      fuente: "proveedor",
    });
  });

  it("TRAMPA PROTO3-JSON: `shipmentIndex` AUSENTE significa 0, no 'campo faltante'", async () => {
    // Las APIs protobuf de Google omiten los valores por defecto al serializar a JSON. Si
    // el schema exigiera `shipmentIndex`, TODA ruta que empiece por la primera parada
    // —es decir, casi todas— fallaria el parseo en produccion.
    const fetchImpl = vi.fn(async () =>
      respuesta(200, { routes: [{ visits: [{}, { shipmentIndex: 1 }, { shipmentIndex: 2 }] }] }),
    );
    const r = await client(fetchImpl).optimizar(INPUT);
    expect(r).toEqual({
      status: "ok",
      secuencia: ["orden-A", "orden-B", "orden-C"],
      fuente: "proveedor",
    });
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

  // ⚠️ ESTE TEST CAMBIO DE SENTIDO EN LA FEATURE 265, y no se borro: se reescribio.
  //
  // Decia «una secuencia que no cubre TODAS las paradas -> lanza (nunca se persiste parcial)».
  // Estaba BIEN escrito y protegia una invariante QUE SIGUE VIVA: una secuencia parcial no se
  // persiste jamas. Lo que cambia es COMO se protege — ya no lanzando «forma inesperada», sino
  // devolviendo un desenlace que nombra la causa para que el compuesto ordene TODAS en local.
  //
  // La invariante que el nombre viejo prometia queda cubierta en el MISMO PR por:
  //   · `fallback-route-optimization.test.ts` → «la secuencia devuelta cubre TODAS las paradas»
  //   · `optimizacion-ruta-service.test.ts`   → «`sin_solucion` sin compuesto NO persiste nada»
  it("una secuencia que no cubre TODAS las paradas -> `sin_solucion` (nunca una parcial)", async () => {
    const fetchImpl = vi.fn(async () =>
      respuesta(200, { routes: [{ visits: [{ shipmentIndex: 0 }, { shipmentIndex: 1 }] }] }),
    );
    const r = await client(fetchImpl).optimizar(INPUT);
    expect(r).toMatchObject({ status: "sin_solucion", servidas: 2, enviadas: 3 });
    // Y NO devuelve una secuencia: no hay ningun campo del que alguien pueda sacar 2 de 3.
    expect(r).not.toHaveProperty("secuencia");
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

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Feature 265 (R1-R8, R49) — EL CLIENTE LEE LO QUE EL PROVEEDOR LE DICE
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * LA RESPUESTA REAL DEL INCIDENTE (produccion, 2026-08-21), tal como la dejo la traza:
 * `routes: [{}]`, seis paradas saltadas y el contador explicito. El proveedor estaba
 * explicando el problema con precision y el codigo lo traducia a «forma inesperada».
 *
 * ⚠️ La forma INTERNA de cada elemento de `skippedShipments` es DESCONOCIDA: el log la trunco
 * a `[Object]` y no se pudo recuperar (P1). Aqui va `{}` a proposito —y no un objeto
 * inventado— para que el fixture no afirme nada que nadie haya medido.
 */
const RESPUESTA_DEL_INCIDENTE = {
  routes: [{}],
  skippedShipments: [{}, {}, {}, {}, {}, {}],
  validationErrors: [{}],
  metrics: { skippedMandatoryShipmentCount: 6 },
};

const SEIS_PARADAS: OptimizarInput["paradas"] = Array.from({ length: 6 }, (_, i) => ({
  ordenId: `orden-${i}`,
  lat: 9.9 + i / 100,
  lng: -84.1 - i / 100,
}));
const INPUT_6: OptimizarInput = { origen: { lat: 6.34, lng: -75.51 }, paradas: SEIS_PARADAS };

describe("265/R1, R4, R5 — la respuesta del incidente produce `sin_solucion`, no un error", () => {
  it("lee los tres campos y devuelve el desenlace con sus conteos", async () => {
    const fetchImpl = vi.fn(async () => respuesta(200, RESPUESTA_DEL_INCIDENTE));

    const r = await client(fetchImpl).optimizar(INPUT_6);

    expect(r.status).toBe("sin_solucion");
    if (r.status !== "sin_solucion") return;
    expect(r.servidas).toBe(0);
    expect(r.enviadas).toBe(6);
    // R4: el motivo NOMBRA la causa. «forma inesperada» describia un fallo que aqui no hubo.
    expect(r.detalle).toMatch(/paradas saltadas por el proveedor/);
    expect(r.detalle).not.toMatch(/forma inesperada/);
    // R5: y lleva los dos conteos.
    expect(r.detalle).toContain("servidas 0 de 6");
  });

  it("R11: servir ALGUNAS (4 de 6) produce el MISMO desenlace que no servir ninguna", async () => {
    const fetchImpl = vi.fn(async () =>
      respuesta(200, {
        routes: [{ visits: [0, 1, 2, 3].map((shipmentIndex) => ({ shipmentIndex })) }],
        skippedShipments: [{}, {}],
        metrics: { skippedMandatoryShipmentCount: 2 },
      }),
    );

    const r = await client(fetchImpl).optimizar(INPUT_6);

    expect(r).toMatchObject({ status: "sin_solucion", servidas: 4, enviadas: 6 });
  });

  it("R3: la decision NO depende de la forma interna de `skippedShipments`", async () => {
    // Se decide por la COBERTURA de la secuencia. Un campo con una forma que el contrato no
    // reconozca no puede dejar al mensajero sin ruta.
    const fetchImpl = vi.fn(async () =>
      respuesta(200, {
        routes: [{}],
        skippedShipments: [{ loQueSea: 1, anidado: { raro: [true] } }],
      }),
    );

    const r = await client(fetchImpl).optimizar(INPUT_6);

    expect(r).toMatchObject({ status: "sin_solucion", servidas: 0, enviadas: 6 });
  });

  it("R3 bis: `skippedShipments` VACIO con la secuencia incompleta degrada igual", async () => {
    // Mirar `skippedShipments.length` en vez de la cobertura dejaria este caso sin degradar.
    const fetchImpl = vi.fn(async () =>
      respuesta(200, { routes: [{ visits: [{ shipmentIndex: 0 }] }], skippedShipments: [] }),
    );
    const r = await client(fetchImpl).optimizar(INPUT_6);
    expect(r).toMatchObject({ status: "sin_solucion", servidas: 1, enviadas: 6 });
  });
});

describe("265/R2 — la AUSENCIA de los tres campos nuevos no rompe nada", () => {
  it("una respuesta SANA sin `skippedShipments`, `validationErrors` ni `metrics` sigue siendo ok", async () => {
    // Es la trampa proto3-json otra vez: Google OMITE los campos con valor por defecto, asi
    // que declararlos obligatorios habria roto el parseo de casi TODAS las respuestas.
    const fetchImpl = vi.fn(async () =>
      respuesta(200, {
        routes: [{ visits: SEIS_PARADAS.map((_, shipmentIndex) => ({ shipmentIndex })) }],
      }),
    );

    const r = await client(fetchImpl).optimizar(INPUT_6);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.secuencia).toHaveLength(6);
    expect(r.fuente).toBe("proveedor");
  });

  it("R1: los TRES campos se leen de verdad (se afirma lo que la traza reporta)", async () => {
    // ⚠️ Este es el unico test que muere si alguien quita `skippedShipments`,
    // `validationErrors` o `metrics` del schema: los demas se apoyan en la COBERTURA de la
    // secuencia (R3), que es independiente de esos campos a proposito. Sin este, borrar uno
    // del contrato pasaria desapercibido y volveriamos a tirar lo que el proveedor explica.
    //
    // Se enciende la traza a proposito para poder leer lo que el cliente extrajo. Es la unica
    // superficie donde esos tres campos son observables: por diseno (R48) NINGUNA decision
    // depende de ellos.
    const previo = process.env.RUTA_DEBUG_LOG;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.RUTA_DEBUG_LOG = "1";
    try {
      await client(vi.fn(async () => respuesta(200, RESPUESTA_DEL_INCIDENTE))).optimizar(INPUT_6);

      const linea = log.mock.calls.find(
        (c) => typeof c[0] === "string" && (c[0] as string).includes("informa saltos"),
      );
      expect(linea, "no se emitio la linea que reporta lo que el proveedor informo").toBeDefined();
      expect(linea?.[1]).toEqual({
        skippedShipments: 6,
        validationErrors: true,
        skippedMandatoryShipmentCount: 6,
      });
    } finally {
      log.mockRestore();
      if (previo === undefined) delete process.env.RUTA_DEBUG_LOG;
      else process.env.RUTA_DEBUG_LOG = previo;
    }
  });

  it("R8: una respuesta UTILIZABLE que ademas trae avisos sigue siendo `ok`", async () => {
    const fetchImpl = vi.fn(async () =>
      respuesta(200, {
        routes: [{ visits: SEIS_PARADAS.map((_, shipmentIndex) => ({ shipmentIndex })) }],
        validationErrors: [{ algo: 1 }],
        skippedShipments: [],
      }),
    );
    const r = await client(fetchImpl).optimizar(INPUT_6);
    expect(r).toMatchObject({ status: "ok", fuente: "proveedor" });
  });
});

describe("265/R7, R49 — codigos de motivo: si los hay se citan; si no, el motivo sigue entero", () => {
  it("R49: SIN ningun codigo, el motivo nombra causa y conteos, sin huecos ni `undefined`", async () => {
    // Es el caso que HOY se espera: nadie ha visto la forma real de `skippedShipments`.
    const r = await client(vi.fn(async () => respuesta(200, RESPUESTA_DEL_INCIDENTE))).optimizar(
      INPUT_6,
    );

    expect(r.status).toBe("sin_solucion");
    if (r.status !== "sin_solucion") return;
    expect(r.detalle).toContain("servidas 0 de 6");
    // Ni un hueco, ni una lista vacia impresa, ni un texto de relleno.
    expect(r.detalle).not.toMatch(/undefined|null|\[\]|sin motivos/i);
  });

  it("R7: con codigos reconocibles, se citan LOS CODIGOS (no sus acompanantes)", async () => {
    const fetchImpl = vi.fn(async () =>
      respuesta(200, {
        routes: [{}],
        skippedShipments: [
          { reasons: [{ code: "DEMAND_EXCEEDS_VEHICLE_CAPACITY", ejemplo: 3 }] },
          { reasons: [{ code: "NO_VEHICLE" }] },
        ],
      }),
    );

    const r = await client(fetchImpl).optimizar(INPUT_6);

    expect(r.status).toBe("sin_solucion");
    if (r.status !== "sin_solucion") return;
    expect(r.detalle).toContain("DEMAND_EXCEEDS_VEHICLE_CAPACITY");
    expect(r.detalle).toContain("NO_VEHICLE");
    // El acompanante del codigo NO viaja.
    expect(r.detalle).not.toContain("ejemplo");
  });

  it("el extractor reconoce claves `code` con forma de CODIGO y descarta todo lo demas", () => {
    // Autocomprobacion del detector: lo que SI marca y lo que NO. Sin esto, un extractor que
    // no encontrara nunca nada se leeria igual de verde que uno que funciona.
    expect(extraerCodigosDeSalto([{ reasons: [{ code: "NO_VEHICLE" }] }])).toEqual(["NO_VEHICLE"]);
    expect(extraerCodigosDeSalto([{ code: "A_B_C" }])).toEqual(["A_B_C"]);
    // Texto libre del proveedor: fuera (R6).
    expect(extraerCodigosDeSalto([{ code: "el punto 9.9029,-83.68 esta lejos" }])).toEqual([]);
    // Un identificador nuestro: fuera.
    expect(extraerCodigosDeSalto([{ code: "orden-A" }])).toEqual([]);
    // Una coordenada: fuera (ni siquiera es una cadena).
    expect(extraerCodigosDeSalto([{ code: 9.9029459 }])).toEqual([]);
    // Una clave que no se llama `code`: fuera.
    expect(extraerCodigosDeSalto([{ mensaje: "NO_VEHICLE" }])).toEqual([]);
    // Sin nada que extraer, lista vacia (y NO `undefined`).
    expect(extraerCodigosDeSalto([{}, {}])).toEqual([]);
  });

  it("el motivo se compone igual con y sin codigos, y nunca deja el hueco a la vista", () => {
    const sin = motivoSinSolucion({
      servidas: 0,
      enviadas: 6,
      codigos: [],
      conValidationErrors: false,
    });
    const con = motivoSinSolucion({
      servidas: 0,
      enviadas: 6,
      codigos: ["NO_VEHICLE"],
      conValidationErrors: true,
    });
    expect(sin).toBe("optimizar ruta: paradas saltadas por el proveedor (servidas 0 de 6)");
    expect(con).toContain("motivos: NO_VEHICLE");
    expect(con).toContain("con validationErrors");
  });
});

describe("265/R6, R32 — el motivo de `sin_solucion` no filtra NADA", () => {
  it("ni coordenadas, ni ordenId, ni indices de parada, ni texto libre del proveedor", async () => {
    const fetchImpl = vi.fn(async () =>
      respuesta(200, {
        routes: [{ visits: [{ shipmentIndex: 3 }] }],
        skippedShipments: [
          {
            index: 4,
            shipmentLabel: "orden-2",
            reason: "el punto 9.9029459,-83.6815776 esta a 1040 km del vehiculo",
          },
        ],
        validationErrors: [{ message: "vehicles[0].startWaypoint 6.3422343,-75.514335" }],
      }),
    );

    const r = await client(fetchImpl).optimizar(INPUT_6);

    expect(r.status).toBe("sin_solucion");
    if (r.status !== "sin_solucion") return;
    for (const prohibido of [
      TOKEN,
      PROJECT,
      "routeoptimization.googleapis.com",
      "9.9029459",
      "-75.514335",
      "orden-2",
      "esta a 1040 km",
      "shipmentLabel",
    ]) {
      expect(r.detalle).not.toContain(prohibido);
    }
    // Y ningun indice suelto: lo unico que se cita son los conteos del propio desenlace.
    expect(r.detalle).toBe(
      "optimizar ruta: paradas saltadas por el proveedor (servidas 1 de 6; con validationErrors)",
    );
  });

  it("R31: tampoco en este camino viaja el `ordenId` al proveedor", async () => {
    const fetchImpl = vi.fn(async () => respuesta(200, RESPUESTA_DEL_INCIDENTE));
    await client(fetchImpl).optimizar(INPUT_6);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body as string).not.toContain("orden-0");
  });
});
