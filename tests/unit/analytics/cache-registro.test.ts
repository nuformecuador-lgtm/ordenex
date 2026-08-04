import { describe, it, expect } from "vitest";
import { conRegistroDeInvalidacion } from "@/lib/cache/registro-invalidacion";
import type { RegistroInvalidacion } from "@/lib/cache/registro-invalidacion";
import { TAGS_OPERATIVA } from "@/lib/analytics/cache-tags";
import { cacheFalsa, cacheQueFallaAlInvalidar } from "./_cache-falsa";

// Feature 128 / T5.2 — R23. EL RASTRO DE LA INVALIDACION.
//
// Es la UNICA senal que distingue «la cifra no cambio porque no hubo movimiento» de «la cifra
// no cambio porque la invalidacion no llego». Sin ella, el modo de fallo de esta feature es
// mudo: nada se rompe y el numero se queda quieto.
//
// Y es tambien un requisito de lo que NO se registra: sin PII y sin ids de dominio. El payload
// del job lleva `{ desde, hasta }` para el diagnostico, pero no entra en el registro.

function sumideroEspia() {
  const registros: RegistroInvalidacion[] = [];
  return { registros, registrar: (r: RegistroInvalidacion) => registros.push(r) };
}

describe("R23 · la invalidacion registra origen y tags, y nada mas", () => {
  it("un registro por invalidacion, con el origen que la disparo", async () => {
    const sumidero = sumideroEspia();
    const cache = conRegistroDeInvalidacion(cacheFalsa(), sumidero);

    await cache.invalidar("job_rollup_diario", TAGS_OPERATIVA);
    await cache.invalidar("backfill", TAGS_OPERATIVA);

    expect(sumidero.registros.map((r) => r.origen)).toEqual(["job_rollup_diario", "backfill"]);
    expect(sumidero.registros[0].tags).toEqual([...TAGS_OPERATIVA]);
  });

  it("el registro tiene EXACTAMENTE dos campos: origen y tags", async () => {
    const sumidero = sumideroEspia();
    await conRegistroDeInvalidacion(cacheFalsa(), sumidero).invalidar("manual", TAGS_OPERATIVA);

    // Ni ids de zona, ni de tienda, ni de mensajero, ni la clave de la entrada, ni el actor.
    expect(Object.keys(sumidero.registros[0]).sort()).toEqual(["origen", "tags"]);
    expect(JSON.stringify(sumidero.registros[0])).not.toMatch(/usuario|mensajero|telefono|email/i);
  });

  it("no se registra un exito que no ocurrio: si la invalidacion lanza, no hay rastro", async () => {
    const sumidero = sumideroEspia();
    const cache = conRegistroDeInvalidacion(cacheQueFallaAlInvalidar(), sumidero);

    await expect(cache.invalidar("backfill", TAGS_OPERATIVA)).rejects.toThrow();
    expect(sumidero.registros).toEqual([]);
  });

  it("el decorador de registro no cambia el comportamiento de la cache", async () => {
    const interna = cacheFalsa();
    const cache = conRegistroDeInvalidacion(interna, sumideroEspia());

    let producciones = 0;
    const producir = async () => {
      producciones += 1;
      return { n: 1 };
    };
    await cache.envolver("k", TAGS_OPERATIVA, producir);
    await cache.envolver("k", TAGS_OPERATIVA, producir);
    expect(producciones).toBe(1);

    await cache.invalidar("manual", TAGS_OPERATIVA);
    await cache.envolver("k", TAGS_OPERATIVA, producir);
    expect(producciones).toBe(2);
  });
});
