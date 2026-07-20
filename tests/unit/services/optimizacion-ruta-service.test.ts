import { describe, it, expect, vi } from "vitest";
import {
  OptimizacionRutaService,
  RutaIntentoFallidoError,
  type ParadasRepo,
} from "@/lib/services/OptimizacionRutaService";
import type {
  IRutaOptimizadaRepository,
  RutaOptimizadaDTO,
} from "@/lib/interfaces/repositories/IRutaOptimizadaRepository";
import type { IRouteOptimizationClient } from "@/lib/interfaces/external/IRouteOptimizationClient";
import type { ParadaRutaRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { RouteOptimizationConfig } from "@/lib/config/route-optimization";
import { construirTokenProvider, RutaNoConfiguradoError } from "@/lib/auth/google-sa-token";

// Feature 92 (R12/R20/R27/R34-R38) — el servicio de optimizacion, con dobles y sin red.
//
// LA ASERCION QUE MAS IMPORTA EN ESTE ARCHIVO ES `expect(client.optimizar).not
// .toHaveBeenCalled()`: cada llamada a `optimizeTours` se FACTURA, asi que cada guarda de
// coste tiene un test que verifica CERO llamadas, no solo que el resultado sea el correcto.

const MENSAJERO = "m-1";
const T0 = new Date("2026-07-20T12:00:00.000Z");

const CONFIG: RouteOptimizationConfig = {
  GOOGLE_ROUTE_OPT_PROJECT_ID: "p",
  GOOGLE_ROUTE_OPT_SA_EMAIL: "sa@x",
  GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY: "pem",
  ROUTE_OPT_TIMEOUT_MS: 20_000,
  RUTA_DEBOUNCE_S: 60,
  RUTA_ORIGEN_TTL_MIN: 120,
  RUTA_SYNC_MIN_INTERVALO_S: 10,
  RUTA_MAX_PARADAS: 100,
};

function parada(id: string, over: Partial<ParadaRutaRow> = {}): ParadaRutaRow {
  return { ordenId: id, latitud: 9.93, longitud: -84.09, createdAt: T0, ...over };
}

function ruta(over: Partial<RutaOptimizadaDTO> = {}): RutaOptimizadaDTO {
  return {
    id: "r1",
    mensajeroId: MENSAJERO,
    estado: "vigente",
    calculadaAt: null,
    origenLat: null,
    origenLng: null,
    origenAt: null,
    origenFuente: null,
    huellaSet: null,
    ultimoError: null,
    secuenciaPorOrden: new Map(),
    ...over,
  };
}

function build(opts: {
  ruta?: RutaOptimizadaDTO | null;
  paradas?: ParadaRutaRow[];
  outcome?: Awaited<ReturnType<IRouteOptimizationClient["optimizar"]>>;
  config?: Partial<RouteOptimizationConfig>;
  now?: Date;
}) {
  const rutas = {
    findByMensajero: vi.fn(async () => opts.ruta ?? null),
    upsertOrigen: vi.fn<(m: string, u: unknown) => Promise<void>>(async () => {}),
    reemplazarSecuencia: vi.fn<(m: string, s: string[], meta: unknown) => Promise<void>>(async () => {}),
    marcarDesactualizada: vi.fn<(m: string, e: string) => Promise<void>>(async () => {}),
  };

  const paradasRepo: ParadasRepo = {
    findParadasEnReparto: vi.fn(async () => opts.paradas ?? []),
  };

  const client = {
    optimizar: vi.fn(async (input: { paradas: { ordenId: string }[] }) =>
      opts.outcome ?? {
        status: "ok" as const,
        secuencia: [...input.paradas].reverse().map((p) => p.ordenId),
      },
    ),
  } as unknown as IRouteOptimizationClient & { optimizar: ReturnType<typeof vi.fn> };

  const service = new OptimizacionRutaService(
    rutas as unknown as IRutaOptimizadaRepository,
    paradasRepo,
    client,
    { ...CONFIG, ...opts.config },
    () => opts.now ?? T0,
  );
  return { service, rutas, paradasRepo, client };
}


/** Meta con la que se persistio la secuencia (tipada, para no perseguir `unknown`). */
interface MetaPersistida {
  calculadaAt: Date;
  origen: { lat: number; lng: number; fuente: string } | null;
  huellaSet: string;
}
function metaDe(rutas: { reemplazarSecuencia: { mock: { calls: unknown[][] } } }): MetaPersistida {
  return rutas.reemplazarSecuencia.mock.calls[0][2] as MetaPersistida;
}

describe("R20 — guarda de OBSOLESCENCIA (job de debounce ya cubierto)", () => {
  it("jobCreatedAt anterior a calculadaAt -> se completa SIN llamar al proveedor", async () => {
    const { service, client, rutas } = build({
      ruta: ruta({ calculadaAt: new Date(T0.getTime() - 10_000) }),
      paradas: [parada("o1"), parada("o2"), parada("o3")],
    });

    const r = await service.ejecutar(MENSAJERO, {
      motivo: "debounce",
      jobCreatedAt: new Date(T0.getTime() - 60_000), // el job es MAS VIEJO que el calculo
    });

    expect(r).toEqual({ status: "omitida", razon: "obsoleta" });
    expect(client.optimizar).not.toHaveBeenCalled();
    expect(rutas.reemplazarSecuencia).not.toHaveBeenCalled();
  });

  it("jobCreatedAt POSTERIOR a calculadaAt -> si se optimiza", async () => {
    const { service, client } = build({
      ruta: ruta({ calculadaAt: new Date(T0.getTime() - 60_000) }),
      paradas: [parada("o1"), parada("o2")],
    });

    const r = await service.ejecutar(MENSAJERO, {
      motivo: "debounce",
      jobCreatedAt: new Date(T0.getTime() - 10_000),
    });

    expect(r.status).toBe("ok");
    expect(client.optimizar).toHaveBeenCalledTimes(1);
  });

  it("sin ruta previa (calculadaAt null) la guarda no aplica", async () => {
    const { service, client } = build({ ruta: null, paradas: [parada("o1"), parada("o2")] });
    await service.ejecutar(MENSAJERO, { motivo: "debounce", jobCreatedAt: T0 });
    expect(client.optimizar).toHaveBeenCalledTimes(1);
  });
});

describe("R34 — intervalo minimo del boton manual", () => {
  it("dos pulsaciones dentro de RUTA_SYNC_MIN_INTERVALO_S -> UNA sola llamada facturada", async () => {
    const { service, client } = build({
      ruta: ruta({ calculadaAt: new Date(T0.getTime() - 3_000) }), // hace 3 s (< 10)
      paradas: [parada("o1"), parada("o2")],
    });

    const r = await service.ejecutar(MENSAJERO, { motivo: "manual" });

    expect(r).toEqual({ status: "omitida", razon: "intervalo_minimo" });
    expect(client.optimizar).not.toHaveBeenCalled();
  });

  it("pasado el intervalo, la pulsacion SI optimiza", async () => {
    const { service, client } = build({
      ruta: ruta({ calculadaAt: new Date(T0.getTime() - 11_000) }),
      paradas: [parada("o1"), parada("o2")],
    });
    const r = await service.ejecutar(MENSAJERO, { motivo: "manual" });
    expect(r.status).toBe("ok");
    expect(client.optimizar).toHaveBeenCalledTimes(1);
  });

  it("la guarda NO aplica a los disparos de la cola (ya los acota el debounce)", async () => {
    const { service, client } = build({
      ruta: ruta({ calculadaAt: new Date(T0.getTime() - 3_000) }),
      paradas: [parada("o1"), parada("o2")],
    });
    await service.ejecutar(MENSAJERO, { motivo: "inmediato" });
    expect(client.optimizar).toHaveBeenCalledTimes(1);
  });
});

describe("R35 — 0 o 1 parada con coordenadas", () => {
  it("UNA parada -> persiste la secuencia trivial SIN llamar al proveedor", async () => {
    const { service, client, rutas } = build({ paradas: [parada("o1")] });

    const r = await service.ejecutar(MENSAJERO, { motivo: "manual" });

    expect(r).toEqual({ status: "omitida", razon: "sin_paradas" });
    expect(client.optimizar).not.toHaveBeenCalled();
    expect(rutas.reemplazarSecuencia).toHaveBeenCalledTimes(1);
    expect(rutas.reemplazarSecuencia.mock.calls[0][1]).toEqual(["o1"]);
  });

  it("CERO paradas -> limpia la secuencia vieja, sin llamar y sin reventar por el centroide", async () => {
    // El centroide de un conjunto vacio seria NaN: la rama de cero paradas debe cortarse
    // antes de intentar calcularlo.
    const { service, client, rutas } = build({ paradas: [] });

    const r = await service.ejecutar(MENSAJERO, { motivo: "manual" });

    expect(r).toEqual({ status: "omitida", razon: "sin_paradas" });
    expect(client.optimizar).not.toHaveBeenCalled();
    expect(rutas.reemplazarSecuencia.mock.calls[0][1]).toEqual([]);
    expect(metaDe(rutas).origen).toBeNull();
  });

  it("una parada CON coordenadas y otras SIN -> sigue siendo el caso trivial", async () => {
    const { service, client } = build({
      paradas: [parada("o1"), parada("o2", { latitud: null, longitud: null })],
    });
    await service.ejecutar(MENSAJERO, { motivo: "manual" });
    expect(client.optimizar).not.toHaveBeenCalled();
  });
});

describe("R36 — huella del conjunto de paradas + origen", () => {
  it("mismo conjunto y mismo origen que la ultima vez -> CERO llamadas", async () => {
    const paradas = [parada("o1"), parada("o2"), parada("o3")];
    // Primera pasada: se calcula y se captura la huella con la que quedo la ruta.
    const primera = build({ paradas, ruta: null });
    await primera.service.ejecutar(MENSAJERO, { motivo: "manual" });
    const huella = metaDe(primera.rutas).huellaSet as string;

    // Segunda pasada: la ruta ya lleva esa huella y sigue vigente.
    const segunda = build({ paradas, ruta: ruta({ huellaSet: huella, estado: "vigente" }) });
    const r = await segunda.service.ejecutar(MENSAJERO, { motivo: "manual" });

    expect(r).toEqual({ status: "omitida", razon: "sin_cambios" });
    expect(segunda.client.optimizar).not.toHaveBeenCalled();
  });

  it("una parada NUEVA cambia la huella -> si se optimiza", async () => {
    const primera = build({ paradas: [parada("o1"), parada("o2")], ruta: null });
    await primera.service.ejecutar(MENSAJERO, { motivo: "manual" });
    const huella = metaDe(primera.rutas).huellaSet as string;

    const segunda = build({
      paradas: [parada("o1"), parada("o2"), parada("o3")],
      ruta: ruta({ huellaSet: huella }),
    });
    const r = await segunda.service.ejecutar(MENSAJERO, { motivo: "manual" });

    expect(r.status).toBe("ok");
    expect(segunda.client.optimizar).toHaveBeenCalledTimes(1);
  });

  it("la huella NO depende del orden de lectura de las paradas (identifica el CONJUNTO)", async () => {
    // Si dependiera del orden, cualquier reordenacion de la consulta dispararia una
    // llamada facturada de mas, sin ningun cambio real.
    const a = build({ paradas: [parada("o1"), parada("o2"), parada("o3")], ruta: null });
    await a.service.ejecutar(MENSAJERO, { motivo: "manual" });
    const b = build({ paradas: [parada("o3"), parada("o1"), parada("o2")], ruta: null });
    await b.service.ejecutar(MENSAJERO, { motivo: "manual" });

    expect(metaDe(a.rutas).huellaSet).toBe(
      metaDe(b.rutas).huellaSet,
    );
  });

  it("una ruta DESACTUALIZADA con la misma huella SI se reintenta", async () => {
    // Si no, un fallo del proveedor congelaria la ruta como desactualizada para siempre:
    // la huella no cambiaria nunca y la guarda de coste bloquearia toda recuperacion.
    const primera = build({ paradas: [parada("o1"), parada("o2")], ruta: null });
    await primera.service.ejecutar(MENSAJERO, { motivo: "manual" });
    const huella = metaDe(primera.rutas).huellaSet as string;

    const segunda = build({
      paradas: [parada("o1"), parada("o2")],
      ruta: ruta({ huellaSet: huella, estado: "desactualizada" }),
    });
    const r = await segunda.service.ejecutar(MENSAJERO, { motivo: "manual" });

    expect(r.status).toBe("ok");
    expect(segunda.client.optimizar).toHaveBeenCalledTimes(1);
  });
});

describe("R37 — las ordenes SIN coordenadas se excluyen, no abortan", () => {
  it("solo las paradas con coordenadas llegan al proveedor; la optimizacion NO se aborta", async () => {
    const { service, client } = build({
      paradas: [
        parada("o1"),
        parada("o-sin", { latitud: null, longitud: null }),
        parada("o2"),
        parada("o-medio", { longitud: null }), // media coordenada tampoco sirve
      ],
    });

    const r = await service.ejecutar(MENSAJERO, { motivo: "manual" });

    expect(r.status).toBe("ok");
    const enviadas = client.optimizar.mock.calls[0][0].paradas.map(
      (p: { ordenId: string }) => p.ordenId,
    );
    expect(enviadas).toEqual(["o1", "o2"]);
  });
});

describe("R38 — tope de paradas", () => {
  it("por encima de RUTA_MAX_PARADAS se optimizan las mas ANTIGUAS (createdAt asc)", async () => {
    const paradas = Array.from({ length: 5 }, (_, i) =>
      parada(`o${i}`, { createdAt: new Date(T0.getTime() + i * 1000) }),
    );
    const { service, client, rutas } = build({ paradas, config: { RUTA_MAX_PARADAS: 3 } });

    const r = await service.ejecutar(MENSAJERO, { motivo: "manual" });

    expect(r).toEqual({ status: "ok", paradas: 3 });
    const enviadas = client.optimizar.mock.calls[0][0].paradas.map(
      (p: { ordenId: string }) => p.ordenId,
    );
    expect(enviadas).toEqual(["o0", "o1", "o2"]);
    // Las dos restantes quedan SIN posicion (R28), no se descartan del sistema.
    expect(rutas.reemplazarSecuencia.mock.calls[0][1]).toHaveLength(3);
  });

  it("por debajo del tope se envian todas", async () => {
    const { service, client } = build({
      paradas: [parada("o1"), parada("o2")],
      config: { RUTA_MAX_PARADAS: 100 },
    });
    await service.ejecutar(MENSAJERO, { motivo: "manual" });
    expect(client.optimizar.mock.calls[0][0].paradas).toHaveLength(2);
  });
});

describe("R27 — ante fallo del proveedor se CONSERVA el ultimo orden valido", () => {
  it.each(["transitorio", "config_invalida"] as const)(
    "%s -> NO se tocan las paradas, se marca desactualizada y se LANZA",
    async (status) => {
      const { service, rutas } = build({
        paradas: [parada("o1"), parada("o2")],
        ruta: ruta({
          calculadaAt: new Date(T0.getTime() - 100_000),
          secuenciaPorOrden: new Map([
            ["o1", 1],
            ["o2", 2],
          ]),
        }),
        outcome: { status, detalle: "optimizar ruta: HTTP 503" },
      });

      await expect(service.ejecutar(MENSAJERO, { motivo: "debounce" })).rejects.toThrow(
        RutaIntentoFallidoError,
      );

      // LA ASERCION CLAVE: la secuencia previa sigue INTACTA. Nunca se borra, y jamas se
      // cae en silencio a `createdAt desc`.
      expect(rutas.reemplazarSecuencia).not.toHaveBeenCalled();
      expect(rutas.marcarDesactualizada).toHaveBeenCalledWith(
        MENSAJERO,
        "optimizar ruta: HTTP 503",
      );
    },
  );

  it("se LANZA para que la cola aplique su backoff (no se completa en silencio)", async () => {
    const { service } = build({
      paradas: [parada("o1"), parada("o2")],
      outcome: { status: "transitorio", detalle: "d" },
    });
    await expect(service.ejecutar(MENSAJERO, { motivo: "debounce" })).rejects.toThrow();
  });

  it("una optimizacion EXITOSA limpia el ultimoError anterior", async () => {
    const { service, rutas } = build({
      paradas: [parada("o1"), parada("o2")],
      ruta: ruta({ estado: "desactualizada", ultimoError: "fallo viejo" }),
    });
    await service.ejecutar(MENSAJERO, { motivo: "manual" });
    // El repo recibe la orden de reemplazar; la limpieza de `ultimo_error` la hace el
    // repositorio en la misma escritura (ver RutaOptimizadaRepository.reemplazarSecuencia).
    expect(rutas.reemplazarSecuencia).toHaveBeenCalledTimes(1);
    expect(rutas.marcarDesactualizada).not.toHaveBeenCalled();
  });
});

describe("R12 — credencial ausente corta ANTES de cualquier red", () => {
  it("`construirTokenProvider` lanza RutaNoConfiguradoError y el fallo NO tumba la cola", async () => {
    // El error viaja como excepcion del handler; `JobQueueService.drenar` la captura job a
    // job, asi que `liberar_reprogramadas` y `geocodificacion` siguen drenando.
    const getToken = async () => {
      construirTokenProvider({
        GOOGLE_ROUTE_OPT_PROJECT_ID: null,
        GOOGLE_ROUTE_OPT_SA_EMAIL: "sa@x",
        GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY: "pem",
      });
      return "";
    };
    await expect(getToken()).rejects.toThrow(RutaNoConfiguradoError);
  });

  it("si el cliente lanza (credencial), la secuencia previa tampoco se toca", async () => {
    const rutas = {
      findByMensajero: vi.fn(async () => null),
      upsertOrigen: vi.fn(async () => {}),
      reemplazarSecuencia: vi.fn(async () => {}),
      marcarDesactualizada: vi.fn(async () => {}),
    };
    const client: IRouteOptimizationClient = {
      optimizar: async () => {
        throw new RutaNoConfiguradoError("GOOGLE_ROUTE_OPT_SA_EMAIL");
      },
    };
    const service = new OptimizacionRutaService(
      rutas as unknown as IRutaOptimizadaRepository,
      { findParadasEnReparto: async () => [parada("o1"), parada("o2")] },
      client,
      CONFIG,
      () => T0,
    );

    await expect(service.ejecutar(MENSAJERO, { motivo: "debounce" })).rejects.toThrow(
      RutaNoConfiguradoError,
    );
    // Ni se reemplaza la secuencia ni se marca desactualizada: una credencial ausente no
    // es un fallo del PROVEEDOR sobre la ruta, es un fallo de configuracion del sistema.
    expect(rutas.reemplazarSecuencia).not.toHaveBeenCalled();
    expect(rutas.marcarDesactualizada).not.toHaveBeenCalled();
  });
});

describe("resultado exitoso", () => {
  it("persiste la secuencia devuelta por el proveedor, en su orden", async () => {
    const { service, rutas } = build({ paradas: [parada("o1"), parada("o2"), parada("o3")] });

    const r = await service.ejecutar(MENSAJERO, { motivo: "manual" });

    expect(r).toEqual({ status: "ok", paradas: 3 });
    // El doble del cliente invierte el orden: se comprueba que se persiste LO QUE EL
    // PROVEEDOR DIJO, no el orden de entrada.
    expect(rutas.reemplazarSecuencia.mock.calls[0][1]).toEqual(["o3", "o2", "o1"]);
    expect(metaDe(rutas).calculadaAt).toEqual(T0);
  });
});
