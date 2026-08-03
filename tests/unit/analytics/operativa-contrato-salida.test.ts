import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { PENUMBRA, type SerieOperativa } from "@/lib/types/analitica-operativa";
import { listarMetricas } from "@/lib/analytics/metrics";
import { consultaDe, cubo, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 126 / T1.1 + T8.2 — R30 y R34.
//
// R30: toda respuesta `ok` declara la metrica, el rango usado y la fecha de referencia de cada
// punto, y NO lleva `BigInt` ni `Date` sin serializar. `JSON.stringify` de un `BigInt` LANZA:
// el fallo aparece al serializar la respuesta, o sea en produccion.
//
// R34 (T0-Q2 = B): `cobertura` es OBLIGATORIA. Un `cobertura?:` permitiria a la 131/133
// ignorarla por omision y la decision de Q2 no compraria nada: «cero» y «no se sabe»
// volverian a ser el mismo pixel.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

async function serieDeEjemplo(metricaId: string): Promise<SerieOperativa> {
  const cubos = [
    cubo({ fecha: "2026-08-01", entregas: 3, devoluciones: 1, segCicloAcum: BigInt(120), segCicloN: 2 }),
  ];
  return servicioCon(rollupFalso(cubos)).consultar(consultaDe(metricaId));
}

describe("R30 · la respuesta es serializable y se declara a si misma", () => {
  it("la respuesta es JSON-serializable sin excepciones", async () => {
    for (const metrica of listarMetricas({ dominio: "operativa" })) {
      const serie = await serieDeEjemplo(metrica.id);
      expect(() => JSON.stringify(serie), metrica.id).not.toThrow();
    }
  });

  it("declara metricaId, el RangoResuelto usado y la fecha de referencia de cada punto", async () => {
    const serie = await serieDeEjemplo("entregas");
    expect(serie.metricaId).toBe("entregas");
    expect(serie.rango.preset).toBe("dia");
    expect(serie.rango.desdeFecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const punto of serie.puntos) expect(punto.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("ningun valor de la serie es un BigInt", async () => {
    const serie = await serieDeEjemplo("tiempo_ciclo");
    const visto: string[] = [];
    const recorrer = (valor: unknown, ruta: string): void => {
      if (typeof valor === "bigint") visto.push(ruta);
      if (valor && typeof valor === "object") {
        for (const [k, v] of Object.entries(valor)) recorrer(v, `${ruta}.${k}`);
      }
    };
    recorrer(serie.puntos, "puntos");
    expect(visto, "un BigInt se colo en los puntos").toEqual([]);
  });

  it("las Date del rango serializan de forma ESTABLE (ISO), no como objeto opaco", async () => {
    const serie = await serieDeEjemplo("entregas");
    const ida = JSON.parse(JSON.stringify(serie)) as { rango: { desde: string } };
    expect(ida.rango.desde).toBe(serie.rango.desde.toISOString());
  });
});

describe("R34 · cobertura es obligatoria en toda respuesta ok", () => {
  it("cobertura es obligatoria en toda respuesta ok", async () => {
    for (const metrica of listarMetricas({ dominio: "operativa" })) {
      const serie = await serieDeEjemplo(metrica.id);
      expect(serie.cobertura, metrica.id).toBeDefined();
      expect(Array.isArray(serie.cobertura.fechasNoComparables), metrica.id).toBe(true);
      expect(serie.cobertura.penumbra, metrica.id).toBe(PENUMBRA);
    }
  });

  it("el TIPO la declara sin `?`: declararla opcional deja de compilar el fixture", () => {
    // Un caso de runtime no puede distinguir «obligatoria» de «opcional y siempre presente».
    // Lo que si se puede afirmar es el TEXTO del contrato: `cobertura?:` en `SerieOperativa`
    // es la mutacion de R34, y aqui sale roja. El fixture de tipo esta justo debajo.
    const crudo = fs.readFileSync(
      path.join(REPO_ROOT, "lib", "types", "analitica-operativa.ts"),
      "utf8",
    );
    // Se despiojan los comentarios antes de buscar: el propio contrato EXPLICA en prosa por
    // que no puede ser `cobertura?`, y esa mencion no es una declaracion. Mismo criterio que
    // usan los guardias de la 122/124 (`soloCodigo`).
    const contrato = crudo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
    expect(contrato).toMatch(/readonly cobertura: Cobertura;/);
    expect(contrato).not.toMatch(/cobertura\?:/);
    // Y el despiojado DISCRIMINA: si se comiera el codigo, la primera asercion seria vacia.
    expect(contrato).toContain("export interface SerieOperativa");
  });

  it("fixture de tipo: una serie SIN cobertura no es asignable a SerieOperativa", () => {
    const sinCobertura = {
      metricaId: "entregas",
      unidad: "conteo",
      unidadDeConteo: "gestion",
      rango: { preset: "dia", desde: new Date(), hasta: new Date(), desdeFecha: "x", hastaFecha: "x" },
      puntos: [],
    };
    // @ts-expect-error — falta `cobertura`. Si alguien la declara opcional, este
    // `@ts-expect-error` deja de tener error que esperar y el TYPECHECK se pone rojo.
    const forzada: SerieOperativa = sinCobertura;
    expect(forzada.metricaId).toBe("entregas");
  });
});
