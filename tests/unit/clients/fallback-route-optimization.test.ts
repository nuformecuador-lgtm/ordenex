import { describe, it, expect, vi } from "vitest";
import { FallbackRouteOptimizationClient } from "@/lib/clients/fallback-route-optimization";
import {
  RutaNoConfiguradoError,
  RutaTokenError,
} from "@/lib/auth/google-token-shared";
import { RutaPeticionRechazadaError } from "@/lib/clients/google-route-optimization";
import { HaversineRouteOptimizationClient } from "@/lib/clients/haversine-route-optimization";
import { construirTokenProvider } from "@/lib/auth/google-sa-token";
import { construirTokenProviderWif } from "@/lib/auth/google-wif-token";
import type {
  IRouteOptimizationClient,
  OptimizarInput,
  OptimizarOutcome,
} from "@/lib/interfaces/external/IRouteOptimizationClient";

// Feature 92 (design §9.A) — el compuesto solo cae al fallback ante credencial AUSENTE.

const INPUT: OptimizarInput = {
  origen: { lat: 9.93, lng: -84.09 },
  paradas: [
    { ordenId: "orden-A", lat: 9.9281, lng: -84.0907 },
    { ordenId: "orden-B", lat: 9.9355, lng: -84.0839 },
  ],
};

/** Doble que devuelve un outcome fijo, o lanza un error fijo. */
function stub(
  behaviour: { outcome: OptimizarOutcome } | { throws: unknown },
): IRouteOptimizationClient & { optimizar: ReturnType<typeof vi.fn> } {
  const optimizar = vi.fn(async () => {
    if ("throws" in behaviour) throw behaviour.throws;
    return behaviour.outcome;
  });
  return { optimizar } as IRouteOptimizationClient & { optimizar: ReturnType<typeof vi.fn> };
}

// Feature 265: el desenlace `ok` DICE quien ordeno. El primario es el proveedor; el fallback,
// siempre local. El compuesto propaga lo que reciba, no lo supone.
const OK_PRIMARY: OptimizarOutcome = {
  status: "ok",
  secuencia: ["orden-B", "orden-A"],
  fuente: "proveedor",
};
const OK_FALLBACK: OptimizarOutcome = {
  status: "ok",
  secuencia: ["orden-A", "orden-B"],
  fuente: "local",
};

describe("FallbackRouteOptimizationClient", () => {
  it("con credencial: devuelve el resultado del primario y NO toca el fallback", async () => {
    const primary = stub({ outcome: OK_PRIMARY });
    const fallback = stub({ outcome: OK_FALLBACK });
    const r = await new FallbackRouteOptimizationClient(primary, fallback).optimizar(INPUT);

    expect(r).toEqual(OK_PRIMARY);
    expect(primary.optimizar).toHaveBeenCalledOnce();
    expect(fallback.optimizar).not.toHaveBeenCalled();
  });

  it("SIN credencial (RutaNoConfiguradoError): delega en el fallback local", async () => {
    const primary = stub({ throws: new RutaNoConfiguradoError("GOOGLE_ROUTE_OPT_SA_EMAIL") });
    const fallback = stub({ outcome: OK_FALLBACK });
    const r = await new FallbackRouteOptimizationClient(primary, fallback).optimizar(INPUT);

    expect(r).toEqual(OK_FALLBACK);
    expect(fallback.optimizar).toHaveBeenCalledWith(INPUT);
  });

  it("avisa (sin PII) cuando cae al fallback", async () => {
    const warn = vi.fn();
    const primary = stub({ throws: new RutaNoConfiguradoError("GOOGLE_WIF_POOL_ID") });
    const fallback = stub({ outcome: OK_FALLBACK });
    await new FallbackRouteOptimizationClient(primary, fallback, { warn }).optimizar(INPUT);

    expect(warn).toHaveBeenCalledOnce();
    const mensaje = warn.mock.calls[0][0] as string;
    expect(mensaje).toContain("Haversine");
    // Nunca cita ids ni coordenadas (R14).
    expect(mensaje).not.toContain("orden-A");
    expect(mensaje).not.toContain("84.0");
  });

  it("token rechazado (RutaTokenError) NO es credencial ausente: se RE-LANZA", async () => {
    const primary = stub({ throws: new RutaTokenError("HTTP 401") });
    const fallback = stub({ outcome: OK_FALLBACK });
    await expect(
      new FallbackRouteOptimizationClient(primary, fallback).optimizar(INPUT),
    ).rejects.toBeInstanceOf(RutaTokenError);
    expect(fallback.optimizar).not.toHaveBeenCalled();
  });

  it("peticion rechazada por el proveedor (400) se RE-LANZA: no se tapa con un orden local", async () => {
    const primary = stub({ throws: new RutaPeticionRechazadaError(400) });
    const fallback = stub({ outcome: OK_FALLBACK });
    await expect(
      new FallbackRouteOptimizationClient(primary, fallback).optimizar(INPUT),
    ).rejects.toBeInstanceOf(RutaPeticionRechazadaError);
    expect(fallback.optimizar).not.toHaveBeenCalled();
  });

  // ⚠️ REGRESION REAL (no hipotetica): `google-sa-token.ts` llego a REDECLARAR su propia
  // `RutaNoConfiguradoError`, asi que la que lanzaba `construirTokenProvider` NO era la que
  // este compuesto compara con `instanceof`. Todos los tests de arriba pasaban —construyen el
  // error a mano desde `google-token-shared`— mientras en produccion el error escapaba y un
  // despliegue sin credencial reventaba con INTERNAL en vez de ordenar en local. Estos dos
  // casos usan el error REAL de cada fabrica de token, que es lo unico que detecta el fallo.
  it.each([
    [
      "SA (construirTokenProvider)",
      () =>
        construirTokenProvider({
          GOOGLE_ROUTE_OPT_PROJECT_ID: null,
          GOOGLE_ROUTE_OPT_SA_EMAIL: null,
          GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY: null,
        }),
    ],
    [
      "WIF (construirTokenProviderWif)",
      () =>
        construirTokenProviderWif({
          GOOGLE_WIF_PROJECT_NUMBER: null,
          GOOGLE_WIF_POOL_ID: null,
          GOOGLE_WIF_PROVIDER_ID: null,
          GOOGLE_ROUTE_OPT_SA_EMAIL: null,
        }),
    ],
  ])("el error REAL de %s cae al fallback local (identidad de clase)", async (_n, construir) => {
    let real: unknown;
    try {
      construir();
    } catch (e) {
      real = e;
    }
    expect(real).toBeInstanceOf(RutaNoConfiguradoError);

    const primary = stub({ throws: real });
    const fallback = stub({ outcome: OK_FALLBACK });
    const r = await new FallbackRouteOptimizationClient(primary, fallback).optimizar(INPUT);

    expect(r).toEqual(OK_FALLBACK);
    expect(fallback.optimizar).toHaveBeenCalledWith(INPUT);
  });

  it("un outcome transitorio/config_invalida del primario se PROPAGA tal cual (no es excepcion)", async () => {
    // El fallback solo intercepta EXCEPCIONES de credencial; un outcome de fallo del
    // proveedor no es asunto suyo y llega intacto al servicio, que aplica su politica (R27).
    const primary = stub({ outcome: { status: "transitorio", detalle: "x" } });
    const fallback = stub({ outcome: OK_FALLBACK });
    const r = await new FallbackRouteOptimizationClient(primary, fallback).optimizar(INPUT);

    expect(r).toEqual({ status: "transitorio", detalle: "x" });
    expect(fallback.optimizar).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Feature 265 (R9-R14, R30, R44) — LA SEGUNDA REGLA DE DEGRADACION
// ═══════════════════════════════════════════════════════════════════════════════════════════

/** El desenlace que el proveedor produce cuando contesta bien y no las sirve todas. */
function sinSolucion(servidas: number, enviadas: number): OptimizarOutcome {
  return {
    status: "sin_solucion",
    detalle: `optimizar ruta: paradas saltadas por el proveedor (servidas ${servidas} de ${enviadas})`,
    servidas,
    enviadas,
  };
}

describe("265/R9-R11 — `sin_solucion` se ordena en local, cubra lo que cubra la respuesta", () => {
  it.each([
    ["NINGUNA parada servida (el caso medido en produccion)", 0, 6],
    ["ALGUNAS servidas: 4 de 6", 4, 6],
    ["todas menos una", 5, 6],
  ])("%s -> se delega en el calculo local", async (_caso, servidas, enviadas) => {
    // R11: el criterio es «la secuencia no las cubre todas», NO «no cubre ninguna». Degradar
    // solo cuando `servidas === 0` dejaria el caso intermedio persistiendo una parcial.
    const primary = stub({ outcome: sinSolucion(servidas, enviadas) });
    const fallback = stub({ outcome: OK_FALLBACK });

    const r = await new FallbackRouteOptimizationClient(primary, fallback).optimizar(INPUT);

    expect(r).toEqual(OK_FALLBACK);
    expect(fallback.optimizar).toHaveBeenCalledWith(INPUT);
  });

  it("R10: la secuencia devuelta cubre TODAS las paradas de entrada, ni una menos", async () => {
    // ⚠️ ESTA ES LA RED DE REPUESTO de la asercion que se movio en
    // `google-route-optimization.test.ts` («no cubre todas -> lanza»). La invariante que aquel
    // nombre prometia —nunca una secuencia parcial— se protege ahora AQUI, con el calculador
    // local REAL (no un doble): si el compuesto devolviera lo del proveedor, faltarian paradas.
    const primary = stub({ outcome: sinSolucion(0, 2) });
    const local = new HaversineRouteOptimizationClient();

    const r = await new FallbackRouteOptimizationClient(primary, local).optimizar(INPUT);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect([...r.secuencia].sort()).toEqual(INPUT.paradas.map((p) => p.ordenId).sort());
    expect(r.secuencia).toHaveLength(INPUT.paradas.length);
  });

  it("R12: avisa con CONTEOS y sin PII de que se esta ordenando en local", async () => {
    const warn = vi.fn();
    const primary = stub({ outcome: sinSolucion(2, 6) });
    const fallback = stub({ outcome: OK_FALLBACK });

    await new FallbackRouteOptimizationClient(primary, fallback, { warn }).optimizar(INPUT);

    expect(warn).toHaveBeenCalledOnce();
    const mensaje = warn.mock.calls[0][0] as string;
    expect(mensaje).toContain("2 de 6");
    expect(mensaje).not.toContain("orden-A");
    expect(mensaje).not.toContain("84.0");
  });

  it("R14 (mitad negativa): `transitorio` y `config_invalida` NO degradan", async () => {
    // Sin esta mitad, un `catch`/`if` demasiado ancho pasaria desapercibido: taparia una
    // credencial rota o una cuota agotada con un orden aproximado, que es justo lo que el
    // dead-letter debe hacer VISIBLE.
    for (const status of ["transitorio", "config_invalida"] as const) {
      const primary = stub({ outcome: { status, detalle: "d" } });
      const fallback = stub({ outcome: OK_FALLBACK });
      const r = await new FallbackRouteOptimizationClient(primary, fallback).optimizar(INPUT);
      expect(r).toEqual({ status, detalle: "d" });
      expect(fallback.optimizar).not.toHaveBeenCalled();
    }
  });
});

describe("265/R35, R44 — la procedencia la pone quien ordena, y el compuesto la PROPAGA", () => {
  it("con credencial y respuesta completa, la fuente es `proveedor`", async () => {
    const primary = stub({ outcome: OK_PRIMARY });
    const r = await new FallbackRouteOptimizationClient(
      primary,
      new HaversineRouteOptimizationClient(),
    ).optimizar(INPUT);
    expect(r).toMatchObject({ status: "ok", fuente: "proveedor" });
  });

  it.each([
    [
      "por credencial AUSENTE (R44: hoy se degrada en silencio)",
      { throws: new RutaNoConfiguradoError("GOOGLE_ROUTE_OPT_SA_EMAIL") } as const,
    ],
    ["por `sin_solucion`", { outcome: sinSolucion(0, 2) } as const],
  ])("los DOS caminos de degradacion marcan `local`: %s", async (_caso, comportamiento) => {
    // Es la misma marca por las dos causas, y es deliberado: al mensajero no se le nombra la
    // causa (R44), solo se le dice que el orden es aproximado.
    const primary = stub(comportamiento);
    const r = await new FallbackRouteOptimizationClient(
      primary,
      new HaversineRouteOptimizationClient(),
    ).optimizar(INPUT);
    expect(r).toMatchObject({ status: "ok", fuente: "local" });
  });
});
