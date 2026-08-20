import { afterEach, describe, expect, it, vi } from "vitest";

import { handleCotizarApi } from "@/app/api/ordenes/api-key/cotizar/route";
import type {
  ITarifaVigentePorTiendaRepository,
  TarifaVigente,
} from "@/lib/interfaces/repositories/ITarifaVigentePorTiendaRepository";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type { ICoberturaService } from "@/lib/interfaces/services/ICoberturaService";
import { CotizadorService } from "@/lib/services/CotizadorService";
import type { ResultadoCobertura } from "@/lib/types/cotizador";

// Feature 248 (T5.4, bloque B — R12/R13/R14/R16/R17/R27) — el BORDE del cotizador por API key,
// `POST /api/ordenes/api-key/cotizar`, con dobles inyectados por `deps`: sin DB y sin cookies.
//
// El service que se inyecta es el REAL (`CotizadorService`) sobre dobles de cobertura y tarifa.
// Es deliberado: los requisitos de este archivo hablan de lo que el borde hace ANTES de cotizar
// —autenticar, validar, y NO tocar `tarifas`—, y eso solo se puede afirmar si los dobles que
// estan detras pueden delatar la llamada que no debia ocurrir.

const SECRETO = "ordx_secretovivo1234567890";
const ACTOR = { usuarioId: "tienda-de-la-key", rol: "apiKey" as const };
const OK: ApiKeyAuthResult = { status: "ok", actor: ACTOR, apiKeyId: "k1" };
const SIN_AUTH: ApiKeyAuthResult = { status: "unauthenticated" };
const PROHIBIDO: ApiKeyAuthResult = { status: "forbidden" };

const TARIFA: TarifaVigente = {
  valorFlete: "2000.00",
  valorFleteGam: "2200.00",
  valorFleteDevuelto: "1400.00",
  valorFleteDevueltoGam: "1500.00",
  comisionCod: "3.50",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
};

const CUBIERTO: ResultadoCobertura = {
  estado: "cubierto",
  distritoId: "d1",
  zonaId: "z1",
  zonaNombre: "GAM",
  esCentral: true,
};

const CUERPO_VALIDO = {
  provincia: "San José",
  canton: "Central",
  distrito: "Carmen",
  monto_cobrar: "25000.00",
};

function dobles(resultado: ResultadoCobertura = CUBIERTO, tarifa: TarifaVigente | null = TARIFA) {
  const cobertura: ICoberturaService = { consultar: vi.fn().mockResolvedValue(resultado) };
  const tarifas: ITarifaVigentePorTiendaRepository = {
    resolveTarifaPorTienda: vi.fn().mockResolvedValue(tarifa),
    resolveTarifasPorTiendas: vi.fn(),
  };
  return { cobertura, tarifas, service: new CotizadorService(cobertura, tarifas) };
}

function req(cuerpo: unknown, conKey = true): Request {
  return new Request("http://localhost/api/ordenes/api-key/cotizar", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(conKey ? { Authorization: `Bearer ${SECRETO}` } : {}),
    },
    body: JSON.stringify(cuerpo),
  });
}

function spyConsole() {
  return {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    info: vi.spyOn(console, "info").mockImplementation(() => {}),
    debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("POST /api/ordenes/api-key/cotizar (feature 248)", () => {
  it("R12: devuelve 401 cuando falta el Bearer o la key no existe", async () => {
    const { service, cobertura, tarifas } = dobles();

    const sinHeader = await handleCotizarApi(req(CUERPO_VALIDO, false), {
      autenticar: async (raw) => {
        expect(raw).toBeNull(); // `extraerBearer` no encontro nada que presentar
        return SIN_AUTH;
      },
      cotizadorService: service,
    });
    expect(sinHeader.status).toBe(401);

    const keyDesconocida = await handleCotizarApi(req(CUERPO_VALIDO), {
      autenticar: async () => SIN_AUTH,
      cotizadorService: service,
    });
    expect(keyDesconocida.status).toBe(401);
    expect(await keyDesconocida.json()).toMatchObject({ status: "error", code: "UNAUTHORIZED" });

    // Sin autenticar no se cotiza nada.
    expect(cobertura.consultar).not.toHaveBeenCalled();
    expect(tarifas.resolveTarifaPorTienda).not.toHaveBeenCalled();
  });

  it("R13: devuelve 403 cuando el usuario dedicado de la key no está activo", async () => {
    const { service, cobertura, tarifas } = dobles();
    const res = await handleCotizarApi(req(CUERPO_VALIDO), {
      autenticar: async () => PROHIBIDO,
      cotizadorService: service,
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ status: "error", code: "FORBIDDEN" });
    expect(cobertura.consultar).not.toHaveBeenCalled();
    expect(tarifas.resolveTarifaPorTienda).not.toHaveBeenCalled();
  });

  it("R14: devuelve 422 con fieldErrors antes de consultar cobertura o tarifa", async () => {
    const { service, cobertura, tarifas } = dobles();

    const res = await handleCotizarApi(
      req({ provincia: "", canton: "Central", monto_cobrar: "25.000,00" }),
      { autenticar: async () => OK, cotizadorService: service },
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      code: string;
      details: { fieldErrors: Record<string, string[]> };
    };
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(body.details.fieldErrors).sort()).toEqual([
      "distrito",
      "monto_cobrar",
      "provincia",
    ]);

    // ANTES: los dobles de cobertura y tarifa no se llamaron.
    expect(cobertura.consultar).not.toHaveBeenCalled();
    expect(tarifas.resolveTarifaPorTienda).not.toHaveBeenCalled();
  });

  it("R16: distrito con 0 o >1 zonas responde 200 con cobertura y costos null, sin tocar tarifas", async () => {
    for (const [resultado, esperado] of [
      [{ estado: "sin_cobertura" } as ResultadoCobertura, "sin_cobertura"],
      [{ estado: "no_determinado", cuantas: 2 } as ResultadoCobertura, "no_determinado"],
    ] as const) {
      const { service, tarifas } = dobles(resultado);
      const res = await handleCotizarApi(req(CUERPO_VALIDO), {
        autenticar: async () => OK,
        cotizadorService: service,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ cobertura: { estado: esperado }, costos: null });
      // Sin bloque de costos, sin elegir una zona arbitraria y SIN TOCAR `tarifas`.
      expect(tarifas.resolveTarifaPorTienda).not.toHaveBeenCalled();
    }
  });

  it("R17: ni la key ni su hash aparecen en logs ni en el cuerpo de error", async () => {
    const spies = spyConsole();
    const { service } = dobles();

    // Las dos vias de error que llevan la key en el header: 403 (traducido) y 500 (inesperado).
    const prohibido = await handleCotizarApi(req(CUERPO_VALIDO), {
      autenticar: async () => PROHIBIDO,
      cotizadorService: service,
    });
    expect(await prohibido.text()).not.toContain(SECRETO);

    const revienta = await handleCotizarApi(req(CUERPO_VALIDO), {
      autenticar: async () => OK,
      cotizadorService: {
        cotizar: vi.fn().mockRejectedValue(new Error("fallo interno de base de datos")),
      },
    });
    expect(revienta.status).toBe(500);
    expect(await revienta.text()).not.toContain(SECRETO);

    for (const spy of Object.values(spies)) {
      for (const llamada of spy.mock.calls) {
        expect(JSON.stringify(llamada)).not.toContain(SECRETO);
      }
    }
    // Y la respuesta feliz tampoco lo lleva (ni la key ni un hash de ella).
    const feliz = await handleCotizarApi(req(CUERPO_VALIDO), {
      autenticar: async () => OK,
      cotizadorService: dobles().service,
    });
    expect(await feliz.text()).not.toContain(SECRETO);
  });

  it("R27: acepta 1 y 1000, y devuelve 422 con 0, 1001, negativa o decimal, sin cotizar", async () => {
    for (const cantidad of [1, 1000]) {
      const { service, tarifas } = dobles();
      const res = await handleCotizarApi(req({ ...CUERPO_VALIDO, cantidad }), {
        autenticar: async () => OK,
        cotizadorService: service,
      });
      expect(res.status, `cantidad ${cantidad} debe aceptarse`).toBe(200);
      expect((await res.json()).cantidad).toBe(cantidad);
      expect(tarifas.resolveTarifaPorTienda).toHaveBeenCalledTimes(1);
    }

    for (const cantidad of [0, 1001, -1, 1.5]) {
      const { service, cobertura, tarifas } = dobles();
      const res = await handleCotizarApi(req({ ...CUERPO_VALIDO, cantidad }), {
        autenticar: async () => OK,
        cotizadorService: service,
      });
      expect(res.status, `cantidad ${cantidad} debe rechazarse`).toBe(422);
      const body = (await res.json()) as { details: { fieldErrors: Record<string, string[]> } };
      expect(Object.keys(body.details.fieldErrors)).toEqual(["cantidad"]);
      // Sin cotizar: ni cobertura ni tarifa.
      expect(cobertura.consultar).not.toHaveBeenCalled();
      expect(tarifas.resolveTarifaPorTienda).not.toHaveBeenCalled();
    }
  });

  it("la respuesta 200 con costos tiene la forma EXACTA del contrato (§4.2)", async () => {
    const { service } = dobles();
    const res = await handleCotizarApi(req({ ...CUERPO_VALIDO, cantidad: 3 }), {
      autenticar: async () => OK,
      cotizadorService: service,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      cobertura: { estado: "cubierto", zonaNombre: "GAM" },
      tarifaVigente: true,
      cantidad: 3,
      montoCobrar: "25000.00",
      cobraComision: true,
      supuesto: "las 3 órdenes comparten distrito y monto a cobrar",
      escenarios: {
        entregada: {
          unitario: {
            flete: "2200.00",
            ivaFlete: "286.00",
            comisionCod: "875.00",
            ivaComisionCod: "113.75",
            costoTotal: "3474.75",
            netoTienda: "21525.25",
          },
          total: {
            flete: "6600.00",
            ivaFlete: "858.00",
            comisionCod: "2625.00",
            ivaComisionCod: "341.25",
            costoTotal: "10424.25",
            netoTienda: "64575.75",
          },
        },
        devuelta: {
          unitario: {
            fleteDevolucion: "1500.00",
            ivaFleteDevolucion: "195.00",
            costoTotal: "1695.00",
            netoTienda: "-1695.00",
          },
          total: {
            fleteDevolucion: "4500.00",
            ivaFleteDevolucion: "585.00",
            costoTotal: "5085.00",
            netoTienda: "-5085.00",
          },
        },
      },
    });
  });
});
