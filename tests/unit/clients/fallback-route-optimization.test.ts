import { describe, it, expect, vi } from "vitest";
import { FallbackRouteOptimizationClient } from "@/lib/clients/fallback-route-optimization";
import {
  RutaNoConfiguradoError,
  RutaTokenError,
} from "@/lib/auth/google-token-shared";
import { RutaPeticionRechazadaError } from "@/lib/clients/google-route-optimization";
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

const OK_PRIMARY: OptimizarOutcome = { status: "ok", secuencia: ["orden-B", "orden-A"] };
const OK_FALLBACK: OptimizarOutcome = { status: "ok", secuencia: ["orden-A", "orden-B"] };

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
