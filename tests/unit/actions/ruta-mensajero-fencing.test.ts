import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { sincronizarRuta } from "@/lib/actions/ruta-mensajero";
import {
  simulacionRutaHabilitada,
  sincronizarRutaSimulado,
  decorarMisAsignacionesSimulado,
  resetSimulacionRuta,
  RUTA_SYNC_MIN_INTERVALO_S,
} from "@/lib/actions/_ruta-mensajero-simulado";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

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

// =============================================================================
// Decorador de lectura — el reordenado vive en el SEAM DEL SERVIDOR.
// =============================================================================
// R28/§6.1 exige que el orden llegue ya resuelto desde el servidor, y prohíbe
// que el MÓDULO ordene. El decorador se aplica en `page.tsx` (Server Component),
// que es justo donde la 92 pondrá el reordenado real. El test que impide el sort
// en cliente (`MisAsignacionesModule.test.tsx`) debe seguir verde: son sitios
// distintos y solo uno de los dos es legítimo.

function dto(id: string, numRemision: string): MiAsignacionDTO {
  return {
    id,
    numGuia: 1,
    numRemision,
    estatusValue: "en_reparto",
    destinatario: "Ana",
    telefonoDest: "88880000",
    direccion: "Calle 1",
    producto: "Caja",
    peso: 1,
    montoCobrar: 100,
    notas: null,
    tiendaNombre: "Tienda X",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: null,
  };
}

const RESULT_BASE = {
  status: "ok" as const,
  porGestionar: [dto("a", "REM-A"), dto("b", "REM-B"), dto("c", "REM-C")],
};

describe("decorador de `listarMisAsignaciones` (seam server-side)", () => {
  it("CANDADO: sin el flag NO decora — devuelve el resultado INTACTO", () => {
    delete process.env.RUTA_SIMULADA;
    // Aunque haya una sincronización previa "persistida" en memoria.
    sincronizarRutaSimulado({
      rol: "mensajero",
      ordenIds: ["a", "b", "c"],
      ahoraMs: 0,
    });

    const salida = decorarMisAsignacionesSimulado(RESULT_BASE);

    expect(salida).toBe(RESULT_BASE); // misma referencia: ni copia
    expect(salida.porGestionar.map((o) => o.id)).toEqual(["a", "b", "c"]);
    expect(salida.ruta).toBeUndefined();
  });

  it("CANDADO: en production NO decora ni con el flag puesto", () => {
    process.env.RUTA_SIMULADA = "1";
    vi.stubEnv("NODE_ENV", "production");
    sincronizarRutaSimulado({
      rol: "mensajero",
      ordenIds: ["a", "b", "c"],
      ahoraMs: 0,
    });

    expect(decorarMisAsignacionesSimulado(RESULT_BASE)).toBe(RESULT_BASE);
  });

  it("con el flag pero SIN sincronización previa, devuelve el resultado intacto", () => {
    process.env.RUTA_SIMULADA = "1";
    expect(decorarMisAsignacionesSimulado(RESULT_BASE)).toBe(RESULT_BASE);
  });

  it("R28: tras sincronizar, `porGestionar` llega YA REORDENADO desde el servidor", () => {
    process.env.RUTA_SIMULADA = "1";
    // El simulador rota la lista una posición: [a,b,c] -> [b,c,a].
    const sync = sincronizarRutaSimulado({
      rol: "mensajero",
      ordenIds: ["a", "b", "c"],
      ahoraMs: 0,
    });
    expect(sync.status === "ok" && sync.secuencia).toEqual(["b", "c", "a"]);

    const salida = decorarMisAsignacionesSimulado(RESULT_BASE);

    expect(salida.porGestionar.map((o) => o.id)).toEqual(["b", "c", "a"]);
    // El input NO se muta: el reordenado produce un array nuevo.
    expect(RESULT_BASE.porGestionar.map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  it("R28: `secuenciaRuta` se puebla 1..n en el orden de la secuencia", () => {
    process.env.RUTA_SIMULADA = "1";
    sincronizarRutaSimulado({
      rol: "mensajero",
      ordenIds: ["a", "b", "c"],
      ahoraMs: 0,
    });

    const salida = decorarMisAsignacionesSimulado(RESULT_BASE);

    expect(salida.porGestionar.map((o) => o.secuenciaRuta)).toEqual([1, 2, 3]);
  });

  it("R28: las órdenes que entraron DESPUÉS de la optimización van al final, con `secuenciaRuta` null", () => {
    process.env.RUTA_SIMULADA = "1";
    // Se optimizó con a/b/c; luego apareció `d` (recién asignada).
    sincronizarRutaSimulado({
      rol: "mensajero",
      ordenIds: ["a", "b", "c"],
      ahoraMs: 0,
    });

    const salida = decorarMisAsignacionesSimulado({
      status: "ok" as const,
      porGestionar: [
        dto("d", "REM-D"),
        dto("a", "REM-A"),
        dto("b", "REM-B"),
        dto("c", "REM-C"),
      ],
    });

    expect(salida.porGestionar.map((o) => o.id)).toEqual(["b", "c", "a", "d"]);
    expect(salida.porGestionar.at(-1)?.secuenciaRuta).toBeNull();
  });

  it("R30: el decorador adjunta el `ruta` que dispara (o no) el aviso", () => {
    process.env.RUTA_SIMULADA = "1";
    sincronizarRutaSimulado({
      rol: "mensajero",
      ordenIds: ["a", "b", "c"],
      ahoraMs: 0,
    });

    const vigente = decorarMisAsignacionesSimulado(RESULT_BASE);
    expect(vigente.ruta?.estado).toBe("vigente");
    expect(vigente.ruta?.paradasSinOptimizar).toBe(0);

    // Segunda sincronización: el simulador alterna a `desactualizada`.
    sincronizarRutaSimulado({
      rol: "mensajero",
      ordenIds: ["a", "b", "c"],
      ahoraMs: 60_000,
    });
    expect(decorarMisAsignacionesSimulado(RESULT_BASE).ruta?.estado).toBe(
      "desactualizada",
    );
  });

  it("R30: una parada sin posición marca la ruta como desactualizada", () => {
    process.env.RUTA_SIMULADA = "1";
    sincronizarRutaSimulado({
      rol: "mensajero",
      ordenIds: ["a", "b", "c"],
      ahoraMs: 0,
    });

    const salida = decorarMisAsignacionesSimulado({
      status: "ok" as const,
      porGestionar: [...RESULT_BASE.porGestionar, dto("d", "REM-D")],
    });

    expect(salida.ruta?.paradasSinOptimizar).toBe(1);
    expect(salida.ruta?.estado).toBe("desactualizada");
  });
});
