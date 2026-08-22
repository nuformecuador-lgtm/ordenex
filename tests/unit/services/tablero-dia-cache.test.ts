import { describe, expect, it } from "vitest";

import { TableroDiaCacheMemoria } from "@/lib/cache/tablero-dia-cache-memoria";
import { TABLERO_DIA_CACHE_TTL_SEGUNDOS } from "@/lib/config/tablero-dia-cache";
import { claveDeTablero } from "@/lib/services/TableroDiaService";

import { RepositorioDoble, fila, servicioDelTablero } from "./_doble-tablero-dia";

// Feature 192 (B9.6) — R34, R66, R68, R70, R72.
//
// La cache se ejercita con RELOJ INYECTADO y una implementacion en memoria: acierto dentro
// del TTL, produccion nueva al expirar y clave distinta al cruzar la medianoche de Costa
// Rica, sin dormir el test ni un milisegundo. Un test que esperase 15 s de verdad no seria un
// test, seria una sala de espera.
//
// El aislamiento entre alcances —que es el requisito de SEGURIDAD— vive en
// `tablero-dia-cache-aislamiento.guardia.test.ts`, no aqui.

const ZONA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MAESTRO = { usuarioId: "u-maestro", rol: "maestro", zonaId: null };
const OTRO_MAESTRO = { usuarioId: "u-otro", rol: "maestro", zonaId: null };
const ADMIN = { usuarioId: "u-admin", rol: "admin", zonaId: null };

/** Reloj mutable: los tests avanzan el tiempo a mano (R72). */
function reloj(inicio: string) {
  let ahora = new Date(inicio);
  return {
    now: (): Date => ahora,
    avanzarSegundos: (s: number): void => {
      ahora = new Date(ahora.getTime() + s * 1000);
    },
  };
}

function montar(inicio: string) {
  const t = reloj(inicio);
  const repo = new RepositorioDoble(() => [fila("m1", "Ana Aguilar", { entregadas: 1 })]);
  const cache = new TableroDiaCacheMemoria({ ahora: () => t.now().getTime() });
  return { t, repo, cache, service: servicioDelTablero(repo, cache) };
}

describe("TableroDiaService — la cache de servidor", () => {
  it("la segunda peticion DENTRO del TTL no vuelve a consultar el repositorio (R66)", async () => {
    const { t, repo, service } = montar("2026-08-08T19:00:00.000Z");

    await service.obtener(MAESTRO, t.now());
    t.avanzarSegundos(TABLERO_DIA_CACHE_TTL_SEGUNDOS - 1);
    await service.obtener(MAESTRO, t.now());

    expect(repo.conteos).toHaveLength(1);
  });

  it("pasado el TTL se produce de nuevo (R66/R72)", async () => {
    const { t, repo, service } = montar("2026-08-08T19:00:00.000Z");

    await service.obtener(MAESTRO, t.now());
    t.avanzarSegundos(TABLERO_DIA_CACHE_TTL_SEGUNDOS + 1);
    await service.obtener(MAESTRO, t.now());

    expect(repo.conteos).toHaveLength(2);
  });

  it("dos usuarios DISTINTOS con el mismo alcance comparten entrada: una sola produccion (R68)", async () => {
    const { t, repo, service } = montar("2026-08-08T19:00:00.000Z");

    await service.obtener(MAESTRO, t.now());
    await service.obtener(OTRO_MAESTRO, t.now());
    // `admin` y `maestro` resuelven ambos a alcance global: tampoco parten la entrada.
    await service.obtener(ADMIN, t.now());

    expect(repo.conteos).toHaveLength(1);
  });

  it("la clave no contiene el usuarioId ni el rol, y si el alcance y la fecha (R68/R70)", () => {
    const global = claveDeTablero({ tipo: "global" }, "2026-08-08");
    const zona = claveDeTablero({ tipo: "zona", zonaId: ZONA_A }, "2026-08-08");

    expect(global).toContain("tablero-dia");
    expect(global).toContain("2026-08-08");
    expect(global).not.toContain("u-maestro");
    expect(global).not.toContain("maestro");
    expect(zona).toContain(ZONA_A);
    expect(zona).not.toBe(global);
  });

  it("al cruzar la medianoche CR la clave cambia y no se sirve el dia anterior (R70)", async () => {
    // 23:59:55 hora de Costa Rica del 8 de agosto = 05:59:55Z del 9.
    const { t, repo, service } = montar("2026-08-09T05:59:55.000Z");

    const antes = await service.obtener(MAESTRO, t.now());
    t.avanzarSegundos(10); // 00:00:05 CR del dia siguiente, DENTRO del TTL de 15 s
    const despues = await service.obtener(MAESTRO, t.now());

    expect(repo.conteos).toHaveLength(2);
    if (antes.estado !== "ok" || despues.estado !== "ok") throw new Error("se esperaba ok");
    expect(antes.tablero.fecha).toBe("2026-08-08");
    expect(despues.tablero.fecha).toBe("2026-08-09");
  });

  it("un acierto de cache CONSERVA el generadoAt original: la pantalla no miente sobre su frescura (R34)", async () => {
    const { t, service } = montar("2026-08-08T19:00:00.000Z");

    const primera = await service.obtener(MAESTRO, t.now());
    t.avanzarSegundos(10);
    const segunda = await service.obtener(MAESTRO, t.now());

    if (primera.estado !== "ok" || segunda.estado !== "ok") throw new Error("se esperaba ok");
    expect(segunda.tablero.generadoAt).toBe(primera.tablero.generadoAt);
    expect(segunda.tablero.generadoAt).toBe("2026-08-08T19:00:00.000Z");
    // Es decir: a los 10 s, el dato que se sirve tiene 10 s y lo declara.
    expect(t.now().getTime() - Date.parse(segunda.tablero.generadoAt)).toBe(10_000);
  });

  it("el DETALLE no pasa por la cache: cada peticion llega al repositorio (R73)", async () => {
    const { t, repo, cache, service } = montar("2026-08-08T19:00:00.000Z");

    await service.detalle(MAESTRO, t.now(), "m1");
    await service.detalle(MAESTRO, t.now(), "m1");

    expect(repo.detalles).toHaveLength(2);
    expect(cache.claves()).toEqual([]);
  });
});
