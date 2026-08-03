import { describe, it, expect } from "vitest";
import { codificarCubos, decodificarCubos } from "@/lib/analytics/cache-clave";
import { CachedAnaliticaOperativaRollupRepository } from "@/lib/repositories/CachedAnaliticaOperativaRollupRepository";
import { cacheFalsa } from "./_cache-falsa";
import { consultaDe, cubo, MAESTRO, rollupFalso } from "./_fake-operativa";
import { DIMENSION_AGREGADA } from "@/lib/interfaces/repositories/IAnaliticaOperativaRollupRepository";

// Feature 128 / T1.3 — R9. EL VIAJE POR JSON.
//
// El codec no es una precaucion: SIN EL, LA ESCRITURA EN CACHE LANZA. `unstable_cache`
// serializa el valor con `JSON.stringify` (`unstable-cache.js:23`) y `CuboRollup.segCicloAcum`
// es `bigint` (`IAnaliticaOperativaRollupRepository.ts:64`). `JSON.stringify` sobre un
// `BigInt` lanza `TypeError` — no devuelve `null`, no lo omite, no degrada. Guardar el cubo
// tal cual rompe la CONSULTA entera, no la cache.

/** El viaje completo, tal y como lo hace Next: `stringify` al escribir, `parse` al leer. */
function viajePorJson<T>(valor: T): T {
  return JSON.parse(JSON.stringify(valor)) as T;
}

describe("R9 · el cubo sobrevive al viaje por JSON", () => {
  it("bigint, null de mensajero y null de causa", () => {
    const original = [
      cubo({
        fecha: "2026-08-01",
        mensajeroId: null, // cubo SIN ASIGNAR (D10/R8 de la 126): no es «falta el dato»
        causaDevolucion: null, // devolucion SIN CAUSA TIPIFICADA (R15 de la 126)
        segCicloAcum: BigInt("9007199254740993"), // > Number.MAX_SAFE_INTEGER a proposito
        segCicloN: 3,
      }),
    ];

    const vuelta = decodificarCubos(viajePorJson(codificarCubos(original)));

    expect(vuelta).toEqual(original);
    // `toEqual` compara valores; estos tres son sobre el TIPO y el significado, que es lo que
    // de verdad se pierde en un JSON.
    expect(typeof vuelta[0].segCicloAcum).toBe("bigint");
    expect(vuelta[0].segCicloAcum).toBe(BigInt("9007199254740993"));
    expect(vuelta[0].mensajeroId).toBeNull();
    expect(vuelta[0].causaDevolucion).toBeNull();
  });

  it("los `null` NO se convierten en `undefined` ni en un centinela", () => {
    const codificado = codificarCubos([cubo({ fecha: "2026-08-01", mensajeroId: null })]);
    // `JSON.stringify` BORRA las claves `undefined`. Si el codec pusiera `undefined`, la clave
    // desapareceria del JSON y el cubo sin asignar se volveria indistinguible del agregado.
    expect(JSON.parse(JSON.stringify(codificado))[0]).toHaveProperty("mensajeroId");
    expect(codificado[0].mensajeroId).toBeNull();
    // Y tampoco un centinela: `"sin_asignar"` etiquetaria dos veces el cubo sin asignar y
    // rompe R8 de la 126.
    expect(codificado[0].mensajeroId).not.toBe("sin_asignar");
    expect(codificado[0].mensajeroId).not.toBe(DIMENSION_AGREGADA);
  });

  it("`DIMENSION_AGREGADA` y `null` siguen siendo cosas distintas al volver", () => {
    const original = [
      cubo({ fecha: "2026-08-01", mensajeroId: null }),
      cubo({ fecha: "2026-08-01", mensajeroId: DIMENSION_AGREGADA }),
    ];
    const vuelta = decodificarCubos(viajePorJson(codificarCubos(original)));
    expect(vuelta[0].mensajeroId).toBeNull();
    expect(vuelta[1].mensajeroId).toBe(DIMENSION_AGREGADA);
  });

  it("round-trip de una lista vacia y de varias filas", () => {
    expect(decodificarCubos(viajePorJson(codificarCubos([])))).toEqual([]);
    const varios = [
      cubo({ fecha: "2026-08-01", entregas: 4, segCicloAcum: BigInt(10) }),
      cubo({ fecha: "2026-08-02", entregas: 7, segCicloAcum: BigInt(0) }),
    ];
    expect(decodificarCubos(viajePorJson(codificarCubos(varios)))).toEqual(varios);
  });
});

describe("R9 · sin codec, `JSON.stringify` del cubo lanza TypeError", () => {
  it("el cubo crudo NO es serializable: es el motivo por el que existe el codec", () => {
    const crudo = [cubo({ fecha: "2026-08-01", segCicloAcum: BigInt(120) })];
    expect(() => JSON.stringify(crudo)).toThrow(TypeError);
    // Y con el codec, si.
    expect(() => JSON.stringify(codificarCubos(crudo))).not.toThrow();
  });

  it("el decorador SI mete el codec: sin el, la consulta entera falla", async () => {
    // Esta es la asercion que muere si alguien quita `codificarCubos` del decorador y pasa el
    // cubo directo al puerto. Sin ella, este archivo probaria que el codec FUNCIONA sin probar
    // que se USA, que es la diferencia entre un requisito cubierto y uno que lo parece.
    const repo = new CachedAnaliticaOperativaRollupRepository(
      rollupFalso([cubo({ fecha: "2026-08-01", segCicloAcum: BigInt(4242), segCicloN: 2 })]),
      cacheFalsa(),
    );
    const consulta = consultaDe("entregas", MAESTRO, { rango: "dia" });

    const primera = await repo.agregarCubos(consulta, []);
    const segunda = await repo.agregarCubos(consulta, []);

    // Con el codec la escritura no lanza y el HIT devuelve un `bigint`.
    expect(primera[0].segCicloAcum).toBe(BigInt(4242));
    expect(typeof segunda[0].segCicloAcum).toBe("bigint");
    expect(segunda[0].segCicloAcum).toBe(BigInt(4242));
  });

  it("codificar pero no rehidratar deja un `string`, con el que `tiempo_ciclo` CONCATENA", () => {
    const codificado = viajePorJson(codificarCubos([cubo({ fecha: "2026-08-01", segCicloAcum: BigInt(30) })]));
    // Esto es exactamente lo que se veria si el decorador se saltara `decodificarCubos`.
    expect(typeof codificado[0].segCicloAcum).toBe("string");
    // `"30" + "30"` = "3030" y no 60: el promedio de ciclo saldria absurdo, no cero.
    expect(codificado[0].segCicloAcum + codificado[0].segCicloAcum).toBe("3030");
    expect(typeof decodificarCubos(codificado)[0].segCicloAcum).toBe("bigint");
  });
});
