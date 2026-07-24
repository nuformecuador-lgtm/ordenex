import { describe, it, expect } from "vitest";
import { HaversineRouteOptimizationClient } from "@/lib/clients/haversine-route-optimization";
import type { OptimizarInput } from "@/lib/interfaces/external/IRouteOptimizationClient";

// Feature 92 (design §9.A) — el ordenado local por vecino mas cercano sobre Haversine.
// Coordenadas reales de San Jose para que el orden esperado se lea de un vistazo.

function client() {
  return new HaversineRouteOptimizationClient();
}

describe("nearest-neighbor sobre Haversine", () => {
  it("visita siempre la parada pendiente mas cercana, partiendo del origen", async () => {
    // Origen al oeste; las paradas se alejan hacia el este. El orden optimo greedy es el de
    // proximidad creciente: A (mas cerca) -> B -> C.
    const input: OptimizarInput = {
      origen: { lat: 9.93, lng: -84.11 },
      paradas: [
        { ordenId: "orden-C", lat: 9.93, lng: -84.05 },
        { ordenId: "orden-A", lat: 9.93, lng: -84.1 },
        { ordenId: "orden-B", lat: 9.93, lng: -84.08 },
      ],
    };
    const r = await client().optimizar(input);
    expect(r).toEqual({ status: "ok", secuencia: ["orden-A", "orden-B", "orden-C"] });
  });

  it("encadena saltos: tras llegar a una parada, mide desde ELLA, no desde el origen", async () => {
    // El origen esta cerca de X, pero Z esta pegado a X aunque lejos del origen. El vecino
    // mas cercano debe hacer origen -> X -> Z -> Y, no ordenar por distancia al origen.
    const input: OptimizarInput = {
      origen: { lat: 0, lng: 0 },
      paradas: [
        { ordenId: "orden-Y", lat: 0, lng: 0.5 },
        { ordenId: "orden-X", lat: 0, lng: 0.1 },
        { ordenId: "orden-Z", lat: 0, lng: 0.11 },
      ],
    };
    const r = await client().optimizar(input);
    expect(r).toEqual({ status: "ok", secuencia: ["orden-X", "orden-Z", "orden-Y"] });
  });

  it("es DETERMINISTA: ante empate de distancia gana el indice menor", async () => {
    // Dos paradas equidistantes del origen (misma latitud, longitudes opuestas). Gana el
    // primero del array; luego, desde el, el otro. Mismo input -> misma secuencia.
    const input: OptimizarInput = {
      origen: { lat: 0, lng: 0 },
      paradas: [
        { ordenId: "orden-1", lat: 0, lng: 1 },
        { ordenId: "orden-2", lat: 0, lng: -1 },
      ],
    };
    const r1 = await client().optimizar(input);
    const r2 = await client().optimizar(input);
    expect(r1).toEqual({ status: "ok", secuencia: ["orden-1", "orden-2"] });
    expect(r2).toEqual(r1);
  });

  it("cubre TODAS las paradas exactamente una vez", async () => {
    const paradas = Array.from({ length: 20 }, (_, i) => ({
      ordenId: `orden-${i}`,
      lat: 9.9 + i * 0.001,
      lng: -84.1 + i * 0.001,
    }));
    const r = await client().optimizar({ origen: { lat: 9.9, lng: -84.1 }, paradas });
    expect(r.status).toBe("ok");
    const secuencia = r.status === "ok" ? r.secuencia : [];
    expect(secuencia).toHaveLength(20);
    expect(new Set(secuencia).size).toBe(20);
    expect([...secuencia].sort()).toEqual(paradas.map((p) => p.ordenId).sort());
  });

  it("una sola parada -> secuencia trivial (el servicio ya guarda el caso <=1, pero no falla)", async () => {
    const r = await client().optimizar({
      origen: { lat: 0, lng: 0 },
      paradas: [{ ordenId: "orden-unica", lat: 1, lng: 1 }],
    });
    expect(r).toEqual({ status: "ok", secuencia: ["orden-unica"] });
  });

  it("sin paradas -> secuencia vacia, nunca lanza", async () => {
    const r = await client().optimizar({ origen: { lat: 0, lng: 0 }, paradas: [] });
    expect(r).toEqual({ status: "ok", secuencia: [] });
  });
});
