import { describe, it, expect } from "vitest";
import { CachedAnaliticaOperativaRollupRepository } from "@/lib/repositories/CachedAnaliticaOperativaRollupRepository";
import { cacheFalsa } from "./_cache-falsa";
import { consultaDe, cubo, MAESTRO, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 128 / T3.3 — R1. LA CACHE NO PUEDE CAMBIAR EL RESULTADO.
//
// Esta feature no mueve un solo numero: lo que sale del servicio con la cache delante tiene
// que ser identico —misma serie, mismos puntos, mismos tipos— a lo que sale sin ella.
//
// La comparacion se hace sobre la SERIE del servicio y no sobre los cubos del repositorio a
// proposito: es el punto donde `segCicloAcum` se divide para dar `tiempo_ciclo`, y por tanto
// el punto donde un `bigint` que volviera como `string` produciria una cifra absurda en vez de
// un error. El `toEqual` de dos objetos ya distingue `30n` de `"30"`, pero `tiempo_ciclo` lo
// hace VISIBLE: es el numero que un humano leeria mal.

/**
 * ⚠ DOS CUBOS EN LA MISMA FECHA, Y NO ES DECORACION. Con un cubo por fecha, el acumulador del
 * servicio (`AnaliticaOperativaService.acumular`) no llega a SUMAR nada, y entonces un
 * `segCicloAcum` que volviera como `string` daria exactamente el mismo numero: `BigInt(0) +
 * "7200"` NO lanza en JS —concatena, `"07200"`— y `Number("07200") / 4` vuelve a ser 1800. La
 * mutacion pasaria inadvertida. Con dos cubos en la misma fecha, la concatenacion se hace
 * visible: `"0" + "7200" + "1800"` = `"072001800"`, que es un ciclo medio absurdo.
 */
const CUBOS = [
  cubo({ fecha: "2026-08-01", entregas: 4, segCicloAcum: BigInt(7200), segCicloN: 4 }),
  cubo({ fecha: "2026-08-01", entregas: 1, segCicloAcum: BigInt(1800), segCicloN: 1 }),
  cubo({ fecha: "2026-08-02", entregas: 6, segCicloAcum: BigInt(10800), segCicloN: 6 }),
];

/** Rango de dos dias CERRADOS: sin dia en curso, que es otro requisito (R3). */
const RAW = { rango: "personalizado", desde: "2026-08-01", hasta: "2026-08-02" };

describe("R1 · la serie servida desde cache es igual, campo a campo, a la servida sin cache", () => {
  it("`tiempo_ciclo`: sin cache, primera consulta con cache y HIT de cache coinciden", async () => {
    const consulta = consultaDe("tiempo_ciclo", MAESTRO, RAW);

    const sinCache = await servicioCon(rollupFalso(CUBOS)).consultar(consulta);

    const decorado = new CachedAnaliticaOperativaRollupRepository(
      rollupFalso(CUBOS),
      cacheFalsa(),
    );
    const servicio = servicioCon(decorado);
    const conCachePrimera = await servicio.consultar(consulta);
    const conCacheHit = await servicio.consultar(consulta);

    expect(conCachePrimera).toEqual(sinCache);
    expect(conCacheHit).toEqual(sinCache);

    // Y la cifra, explicita: el 2026-08-01 son (7200 + 1800) s en 5 gestiones = 1800 s de
    // ciclo medio. Si el `bigint` volviera como `string`, la suma CONCATENA y sale 14 400 360.
    expect(conCacheHit.puntos.map((p) => p.valor)).toEqual([1800, 1800]);
    expect(JSON.stringify(conCacheHit)).toBe(JSON.stringify(sinCache));
  });

  it("`entregas` desagregada por zona: misma serie y mismos tipos", async () => {
    const consulta = consultaDe("entregas", MAESTRO, RAW);

    const sinCache = await servicioCon(rollupFalso(CUBOS)).consultar(consulta, "zona");
    const servicio = servicioCon(
      new CachedAnaliticaOperativaRollupRepository(rollupFalso(CUBOS), cacheFalsa()),
    );
    await servicio.consultar(consulta, "zona");
    const desdeCache = await servicio.consultar(consulta, "zona");

    expect(desdeCache).toEqual(sinCache);
  });

  it("un cubo SIN ASIGNAR y sin causa tipificada sobrevive igual por los dos caminos", async () => {
    const conNulos = [
      cubo({ fecha: "2026-08-01", mensajeroId: null, causaDevolucion: null, devoluciones: 3 }),
    ];
    const consulta = consultaDe("motivos_devolucion", MAESTRO, RAW);

    const sinCache = await servicioCon(rollupFalso(conNulos)).consultar(consulta);
    const servicio = servicioCon(
      new CachedAnaliticaOperativaRollupRepository(rollupFalso(conNulos), cacheFalsa()),
    );
    await servicio.consultar(consulta);
    const desdeCache = await servicio.consultar(consulta);

    expect(desdeCache).toEqual(sinCache);
  });
});
