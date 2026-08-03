import { describe, it, expect } from "vitest";
import { CachedAnaliticaOperativaRollupRepository } from "@/lib/repositories/CachedAnaliticaOperativaRollupRepository";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { DimensionAnalitica } from "@/lib/analytics/types";
import type {
  CuboRollup,
  IAnaliticaOperativaRollupRepository,
} from "@/lib/interfaces/repositories/IAnaliticaOperativaRollupRepository";
import { cacheFalsa } from "./_cache-falsa";
import { consultaDe, cubo, MAESTRO, SATELITE } from "./_fake-operativa";

// Feature 128 / T3.2 — R6, la mitad de COMPORTAMIENTO (la estatica esta en
// `cache-clave-alcance.guardia.test.ts`).
//
// Esto es SEGURIDAD, no rendimiento. El repositorio interno de este test devuelve FILAS
// DISTINTAS segun el alcance, que es lo que ocurre de verdad en la base: el `where` real se
// compone de tres piezas con `AND` (`AnaliticaOperativaRollupRepository.whereDeConsulta`) y la
// primera es `whereRollup(consulta.alcance)`. Si la clave ignorara el alcance, el segundo
// actor recibiria las filas del primero: la frontera multi-tenant de la 122 saltada por la
// puerta de la cache.

const SIN_GRANO: readonly DimensionAnalitica[] = [];

/**
 * Repositorio interno cuyo resultado DEPENDE del alcance, como el real. `entregas` codifica el
 * alcance para que la asercion diga a quien pertenecen las filas servidas.
 */
function rollupPorAlcance(): IAnaliticaOperativaRollupRepository & { llamadas: number } {
  const estado = {
    llamadas: 0,
    async agregarCubos(consulta: ConsultaAnalitica): Promise<readonly CuboRollup[]> {
      estado.llamadas += 1;
      const propio = consulta.alcance.tipo === "global" ? 100 : 7;
      return [cubo({ fecha: "2026-08-03", entregas: propio })];
    },
    async etiquetasDeEstatus() {
      return new Map();
    },
  };
  return estado;
}

describe("R6 · dos actores con alcance distinto y filtro identico no comparten entrada", () => {
  it("el segundo actor NO recibe las filas del primero", async () => {
    const interno = rollupPorAlcance();
    const repo = new CachedAnaliticaOperativaRollupRepository(interno, cacheFalsa());

    // El `adminSatelite` de la zona z1: la 122 le RECORTA el filtro a `zona_id: ["z1"]`.
    const deSatelite = consultaDe("entregas", SATELITE, { rango: "dia" });
    // El actor global que pide EXPLICITAMENTE esa misma zona: su filtro queda identico.
    const deMaestro = consultaDe("entregas", MAESTRO, { rango: "dia", zona_id: ["z1"] });

    // La premisa del test, comprobada y no supuesta: los filtros SI coinciden campo a campo.
    expect(deSatelite.filtro).toEqual(deMaestro.filtro);
    expect(deSatelite.alcance).not.toEqual(deMaestro.alcance);

    const servidoSatelite = await repo.agregarCubos(deSatelite, SIN_GRANO);
    const servidoMaestro = await repo.agregarCubos(deMaestro, SIN_GRANO);

    expect(servidoSatelite[0].entregas).toBe(7);
    expect(
      servidoMaestro[0].entregas,
      "FUGA ENTRE ROLES: el actor global recibio la entrada cacheada para el alcance de zona. " +
        "La clave de cache DEBE incluir el alcance resuelto (R6); sin el, un rol ve las filas " +
        "de otro y la frontera multi-tenant de la 122 queda saltada por la puerta de la cache.",
    ).toBe(100);
    // Y la agregacion se ejecuto DOS veces: son dos entradas, no una compartida.
    expect(interno.llamadas).toBe(2);
  });

  it("dos zonas distintas tampoco comparten entrada", async () => {
    const interno = rollupPorAlcance();
    const repo = new CachedAnaliticaOperativaRollupRepository(interno, cacheFalsa());
    const zonaA: typeof SATELITE = { usuarioId: "u-a", rol: "adminSatelite", zonaId: "z-a" };
    const zonaB: typeof SATELITE = { usuarioId: "u-b", rol: "adminSatelite", zonaId: "z-b" };

    await repo.agregarCubos(consultaDe("entregas", zonaA, { rango: "dia" }), SIN_GRANO);
    await repo.agregarCubos(consultaDe("entregas", zonaB, { rango: "dia" }), SIN_GRANO);

    expect(interno.llamadas).toBe(2);
  });

  it("el MISMO actor si comparte entrada consigo mismo (si no, R2 seria falso)", async () => {
    const interno = rollupPorAlcance();
    const repo = new CachedAnaliticaOperativaRollupRepository(interno, cacheFalsa());
    const consulta = consultaDe("entregas", SATELITE, { rango: "dia" });

    await repo.agregarCubos(consulta, SIN_GRANO);
    await repo.agregarCubos(consulta, SIN_GRANO);

    expect(interno.llamadas).toBe(1);
  });
});
