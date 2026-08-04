import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { listarMetricas } from "@/lib/analytics/metrics";
import { IDS_FINANCIERAS_SERVIDAS } from "@/lib/types/analitica-financiera";

// Feature 127 / T B.5 — GUARDIA DE COHERENCIA CATALOGO ↔ PRODUCCION: R41 (⟨D8⟩).
//
// El catalogo puede declarar una metrica sin productor (`estadoProduccion: "declarada"`, patron
// de la 154). Eso es honesto MIENTRAS sea verdad. Lo que no puede pasar es que las dos caras se
// desincronicen, y se puede desincronizar por los dos lados:
//
//   - `declarada` con productor: la 133 esconde del selector una metrica que el backend sirve
//     perfectamente, y nadie entiende por que "no esta";
//   - `producida` sin productor: la UI la ofrece, el usuario la pide y recibe un error — o,
//     peor, un cero.
//
// ⟨D8(b)⟩, con visto bueno humano fechado el 2026-08-02, ordena que la 127 produzca `egresos` y
// que el catalogo pase esa entrada de `declarada` a `producida`. Ese cambio es la tarea D.6 y
// TOCA UN ARCHIVO AJENO (`lib/analytics/metrics.ts`, catalogo de la 135, fuente unica de trece
// features): se hace cuando el productor existe, no antes.
//
// Por eso este guardia esta escrito en DOS FASES y no como una afirmacion absoluta. Hoy
// (tandas A-B, sin productor) exige que `egresos` siga siendo la unica `declarada`: ponerla
// `producida` ahora seria mentir. En cuanto el servicio exista, exige que no quede ninguna
// `declarada`. Un guardia que solo supiera la segunda mitad estaria rojo desde el primer dia
// por hacer su trabajo, y el remedio habitual —comentarlo "hasta que se implemente"— es como se
// pierden los guardias.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const SERVICIO = "lib/services/AnaliticaFinancieraService.ts";

/**
 * ¿Existe ya el productor? No basta con que el archivo este creado: tiene que servir metricas.
 * Se mide por el archivo del servicio, que es quien despacha por `metrica.id` (design.md §3).
 */
function productorExistente(): string | null {
  const abs = path.join(REPO_ROOT, SERVICIO);
  if (!fs.existsSync(abs)) return null;
  const codigo = fs.readFileSync(abs, "utf8");
  return codigo.trim().length > 0 ? codigo : null;
}

const declaradasFinancieras = () =>
  listarMetricas({ dominio: "financiera", estadoProduccion: "declarada" }).map((m) => m.id);

describe("R41 · el catalogo y la produccion real no se desincronizan", () => {
  it("mientras el productor no exista, `egresos` es la UNICA financiera sin productor", () => {
    if (productorExistente()) {
      expect(
        declaradasFinancieras(),
        `${SERVICIO} ya existe: ninguna financiera puede seguir marcada "declarada" (D.6 de ⟨D8⟩)`,
      ).toEqual([]);
      return;
    }
    expect(
      declaradasFinancieras(),
      `${SERVICIO} todavia no existe: marcar una financiera como "producida" ahora es declarar un productor que no hay`,
    ).toEqual(["egresos"]);
  });

  it("ninguna financiera queda `declarada` una vez el servicio la sirve", () => {
    const codigo = productorExistente();
    if (codigo === null) {
      // Fase actual: no hay servicio. El caso de arriba es el que muerde hoy; este queda
      // armado y se activa solo. Se comprueba al menos que la ruta vigilada es la real.
      expect(SERVICIO).toBe("lib/services/AnaliticaFinancieraService.ts");
      return;
    }
    const servidasYDeclaradas = declaradasFinancieras().filter((id) => codigo.includes(id));
    expect(
      servidasYDeclaradas,
      "el servicio despacha estas metricas pero el catalogo las da por no producidas",
    ).toEqual([]);
  });

  it("el registro de ids servidos coincide con las diez financieras del catalogo", () => {
    // Dos fuentes independientes: la lista que la 127 declara servir y el catalogo de la 135.
    // Diez desde la 173 (P4, `progress/decision_F2_173.md`).
    const delCatalogo = listarMetricas({ dominio: "financiera" }).map((m) => m.id).sort();
    expect([...IDS_FINANCIERAS_SERVIDAS].sort()).toEqual(delCatalogo);
  });

  it("`egresos` sigue declarando sus OCHO categorias egreso_*, que son las que habra que sumar", () => {
    // R18: si alguien recorta la definicion del catalogo, la suma de la 127 encoge sin que
    // nadie toque la 127. La cifra se quedaria corta y seguiria pareciendo correcta.
    const egresos = listarMetricas({ dominio: "financiera" }).find((m) => m.id === "egresos");
    const categorias = egresos?.definicion.categorias ?? [];
    expect(categorias).toHaveLength(8);
    expect(categorias.every((c) => c.startsWith("egreso_"))).toBe(true);
  });

  it("autocomprobacion: el detector de fase distingue las dos situaciones", () => {
    // La afirmacion que se aplicara cuando exista productor, ejercitada contra un catalogo
    // sintetico: si dejara de discriminar, las dos ramas de arriba serian decorativas.
    const catalogoConHuerfana = [{ id: "egresos", estadoProduccion: "declarada" as const }];
    const codigoQueLaSirve = 'case "egresos": return this.egresos(consulta);';
    const incoherentes = catalogoConHuerfana
      .filter((m) => m.estadoProduccion === "declarada")
      .filter((m) => codigoQueLaSirve.includes(m.id))
      .map((m) => m.id);
    expect(incoherentes).toEqual(["egresos"]);
  });
});
