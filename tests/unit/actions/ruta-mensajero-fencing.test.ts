import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { sincronizarRuta } from "@/lib/actions/ruta-mensajero";
import {
  simulacionRutaHabilitada,
  sincronizarRutaSimulado,
  resetSimulacionRuta,
  RUTA_SYNC_MIN_INTERVALO_S,
} from "@/lib/actions/_ruta-mensajero-simulado";

// Feature 93 — FENCING del simulador de `sincronizarRuta`.
//
// El cuerpo real de la action lo entrega la feature 92. Mientras tanto hay un
// simulador en memoria para poder recorrer el flujo a mano. Este archivo existe
// para que sea IMPOSIBLE que ese simulador llegue a producción sin que la suite
// se ponga roja: si alguien borra el flag o la guarda de `NODE_ENV`, aquí revienta.

const ACTOR_MENSAJERO = { usuarioId: "u1", rol: "mensajero" as const };

const envOriginal = { ...process.env };

beforeEach(() => {
  resetSimulacionRuta();
});

afterEach(() => {
  process.env = { ...envOriginal };
  vi.restoreAllMocks();
});

describe("fencing del simulador (TODO(92))", () => {
  it("sin el flag RUTA_SIMULADA el simulador está APAGADO", () => {
    expect(simulacionRutaHabilitada({ NODE_ENV: "development" })).toBe(false);
    expect(
      simulacionRutaHabilitada({ NODE_ENV: "development", RUTA_SIMULADA: "" }),
    ).toBe(false);
    expect(
      simulacionRutaHabilitada({ NODE_ENV: "development", RUTA_SIMULADA: "0" }),
    ).toBe(false);
    // Solo el opt-in exacto lo enciende.
    expect(
      simulacionRutaHabilitada({ NODE_ENV: "development", RUTA_SIMULADA: "1" }),
    ).toBe(true);
  });

  it("en production el simulador NO se activa NI con el flag puesto", () => {
    expect(
      simulacionRutaHabilitada({ NODE_ENV: "production", RUTA_SIMULADA: "1" }),
    ).toBe(false);
  });

  it("sin flag, la action devuelve `no_implementado` (no finge que funciona)", async () => {
    delete process.env.RUTA_SIMULADA;
    const result = await sincronizarRuta(
      {},
      { getActor: async () => ACTOR_MENSAJERO },
    );
    expect(result).toEqual({ status: "no_implementado" });
  });

  it("con flag pero NODE_ENV=production, la action devuelve `no_implementado`", async () => {
    process.env.RUTA_SIMULADA = "1";
    vi.stubEnv("NODE_ENV", "production");
    const result = await sincronizarRuta(
      { ubicacion: { lat: 9.9, lng: -84.1 } },
      { getActor: async () => ACTOR_MENSAJERO },
    );
    expect(result).toEqual({ status: "no_implementado" });
  });

  // Contraprueba: sin esto, los dos tests de arriba pasarían aunque la action
  // devolviera SIEMPRE `no_implementado` y la guarda no existiera.
  it("con flag y fuera de production, la action SÍ entra al simulador", async () => {
    process.env.RUTA_SIMULADA = "1";
    const result = await sincronizarRuta(
      { ordenIds: ["a", "b"] },
      { getActor: async () => ACTOR_MENSAJERO },
    );
    expect(result.status).toBe("ok");
  });
});

describe("desenlaces del simulador (solo para recorrer el flujo a mano)", () => {
  it("R33: rol distinto de mensajero → forbidden", () => {
    expect(
      sincronizarRutaSimulado({ rol: "adminTienda", ordenIds: ["a"] }),
    ).toEqual({ status: "forbidden" });
  });

  it("R32: la primera sincronización devuelve ok con una secuencia", () => {
    const r = sincronizarRutaSimulado({
      rol: "mensajero",
      ordenIds: ["a", "b", "c"],
      ahoraMs: 1_000,
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.secuencia).toHaveLength(3);
    expect(r.ruta.estado).toBe("vigente");
  });

  it("R34: segunda pulsación dentro de la ventana → conflict", () => {
    sincronizarRutaSimulado({ rol: "mensajero", ordenIds: ["a"], ahoraMs: 0 });
    const r = sincronizarRutaSimulado({
      rol: "mensajero",
      ordenIds: ["a"],
      ahoraMs: (RUTA_SYNC_MIN_INTERVALO_S - 1) * 1000,
    });
    expect(r.status).toBe("conflict");
  });

  it("R30: alterna a `desactualizada` con paradas sin optimizar (para ver el aviso)", () => {
    sincronizarRutaSimulado({ rol: "mensajero", ordenIds: ["a"], ahoraMs: 0 });
    const r = sincronizarRutaSimulado({
      rol: "mensajero",
      ordenIds: ["a"],
      ahoraMs: 60_000,
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.ruta.estado).toBe("desactualizada");
    expect(r.ruta.paradasSinOptimizar).toBeGreaterThan(0);
  });

  it("R24/R25: con ubicación el origen es `gps`; sin ubicación NO es `gps`", () => {
    const conGps = sincronizarRutaSimulado({
      rol: "mensajero",
      ordenIds: ["a"],
      ubicacion: { lat: 9.9, lng: -84.1 },
      ahoraMs: 0,
    });
    expect(conGps.status === "ok" && conGps.ruta.origenFuente).toBe("gps");

    const sinGps = sincronizarRutaSimulado({
      rol: "mensajero",
      ordenIds: ["a"],
      ahoraMs: 60_000,
    });
    expect(sinGps.status).toBe("ok");
    if (sinGps.status !== "ok") return;
    expect(sinGps.ruta.origenFuente).not.toBe("gps");
    expect(["ultima_conocida", "centroide"]).toContain(sinGps.ruta.origenFuente);
  });
});
