import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openApiSpec } from "@/lib/api/openapi-spec";

// ⏳ 2026-09-10 — Feature 406 (T7/T8, R14/R15/R16): EL CONTRATO PUBLICADO DICE LA VERDAD sobre el
// identificador con el que se construye `data.evidenciasUrl`.
//
// EL CRUCE QUE HACE QUE ESTO NO SEA TAUTOLOGICO: el ultimo segmento del enlace del ejemplo se
// compara contra `numGuia` DEL MISMO EJEMPLO —dos campos distintos de un objeto escrito a mano—,
// nunca contra la funcion que construye la URL en produccion. Ese cruce se pone rojo con el estado
// anterior (`018f2c31-…-0002` != `100235`), que es exactamente el defecto que la ficha arregla.
//
// Se afirma sobre los DOS artefactos porque son dos y pueden divergir: `lib/api/openapi-spec.ts`
// (lo que se sirve) y `docs/api/api-key-openapi.yaml` (el espejo textual que el integrador lee, y
// que nada regenera).

const DOCS = path.join(__dirname, "..", "..", "..", "docs", "api");
const yamlTexto = fs.readFileSync(path.join(DOCS, "api-key-openapi.yaml"), "utf8");
const changelog = fs.readFileSync(path.join(DOCS, "CHANGELOG.md"), "utf8");

type Nodo = Record<string, unknown>;
const schemas = openApiSpec.components.schemas as unknown as Record<string, Nodo>;
const webhook = schemas.WebhookOrdenEstadoActualizado;
const ejemplos = webhook.examples as Nodo[];
const evidenciasUrlTs = ((webhook.properties as Nodo).data as Nodo).properties as Nodo;
const descripcionTs = (evidenciasUrlTs.evidenciasUrl as Nodo).description as string;

/** Forma de un uuid: lo que NO puede volver a aparecer como ultimo segmento del enlace. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El ultimo segmento de ruta de una URL, ya decodificado: lo que recibe el `{id}` del endpoint. */
function ultimoSegmento(url: string): string {
  const segmentos = new URL(url).pathname.split("/");
  return decodeURIComponent(segmentos[segmentos.length - 1]);
}

/** Texto con los espacios colapsados: un bloque YAML y un `join("\n")` se vuelven comparables. */
function plano(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

describe("406/R14 — el ejemplo publicado enlaza a SU PROPIO identificador, no a un uuid", () => {
  it("TS: el ultimo segmento del enlace es EXACTAMENTE el `numGuia` de ese mismo ejemplo", () => {
    const conEnlace = ejemplos.filter((ej) => "evidenciasUrl" in (ej.data as Nodo));
    // Un solo ejemplo lleva el enlace (el de `incidente`): si mañana hay dos, este cruce los mide
    // todos, y el aserto de conteo obliga a pasar por aqui.
    expect(conEnlace).toHaveLength(1);

    for (const ejemplo of conEnlace) {
      const data = ejemplo.data as Nodo;
      const segmento = ultimoSegmento(data.evidenciasUrl as string);
      expect(segmento).toBe(String(data.numGuia));
      expect(segmento).not.toMatch(UUID);
      // Y el `eventoId` SIGUE llevando el uuid: es la clave de deduplicacion, y no cambia.
      expect(ejemplo.eventoId).toContain("018f2c31-0000-4000-8000-000000000002");
    }
  });

  it("TS: el enlace del ejemplo es invocable tal cual — ruta del endpoint + identificador", () => {
    const data = ejemplos[1].data as Nodo;
    // Literal a mano, no derivado del spec ni del service.
    expect(data.evidenciasUrl).toBe("https://app.ordenex.co/api/ordenes/api-key/orden/100235");
    expect(new URL(data.evidenciasUrl as string).search).toBe("");
  });

  it("YAML: el espejo publica el MISMO enlace, y su segmento tambien casa con su `numGuia`", () => {
    const lineas = yamlTexto.split(/\r?\n/);
    const iEnlace = lineas.findIndex((l) => l.trim().startsWith("evidenciasUrl: "));
    expect(iEnlace, "el .yaml no publica ningun ejemplo con `evidenciasUrl`").toBeGreaterThan(-1);
    const enlace = lineas[iEnlace].trim().slice("evidenciasUrl: ".length).replace(/"/g, "");

    // El `numGuia` del MISMO bloque de ejemplo: el mas cercano HACIA ARRIBA. Es posicional a
    // proposito —es la unica relacion que el texto expresa— y por eso el aserto exige
    // encontrarlo, en vez de dar por bueno un `-1`. Su VALOR se lee del archivo: no se compara
    // el enlace contra un literal repetido, sino contra el otro campo del mismo ejemplo.
    const previas = lineas.slice(0, iEnlace).map((l) => l.trim());
    const iGuia = previas.map((l) => l.startsWith("numGuia:")).lastIndexOf(true);
    expect(iGuia, "no se encontro el `numGuia` del ejemplo que lleva el enlace").toBeGreaterThan(-1);
    const guiaDelEjemplo = previas[iGuia].slice("numGuia:".length).trim();

    expect(ultimoSegmento(enlace)).toBe(guiaDelEjemplo);
    expect(ultimoSegmento(enlace)).not.toMatch(UUID);
    // Ni un solo uuid quedo colgando de un `evidenciasUrl` en todo el archivo.
    expect(yamlTexto).not.toContain(
      "evidenciasUrl: \"https://app.ordenex.co/api/ordenes/api-key/orden/018f2c31",
    );
  });
});

describe("406/R15 — el contrato dice CON QUE identificador se construye, y los dos documentos lo dicen igual", () => {
  it("TS: la prosa nombra los dos identificadores, dice que ya viajan en `data` y avisa de la codificacion", () => {
    const d = plano(descripcionTs);
    expect(d).toContain("El último segmento es un identificador que ya venís leyendo en este mismo `data`");
    expect(d).toContain("`numGuia` cuando la orden tiene guía");
    expect(d).toContain("`numRemision` cuando todavía no la tiene");
    expect(d).toContain("Ningún id interno viaja en la URL");
    expect(d).toContain("codificado como componente de ruta");
  });

  it("TS: la promesa de que las dos entregas llevan el MISMO valor queda PRECISADA, no en pie", () => {
    const d = plano(descripcionTs);
    // La frase vieja prometia mas de lo que el arreglo puede sostener (riesgo 1 de la ficha).
    expect(d).not.toContain("llevan exactamente el mismo valor");
    expect(d).toContain("Lo único que puede cambiar entre dos entregas del mismo `eventoId`");
    expect(d).toContain("GENERA su guía");
    expect(d).toContain("apuntan a la MISMA orden");
    // Y lo que sigue siendo cierto sigue dicho: sin credencial y sin caducidad.
    expect(d).toContain("no caduca");
    expect(d).toContain("NO es una URL firmada");
  });

  it("el espejo `.yaml` dice EXACTAMENTE lo mismo, palabra por palabra", () => {
    // Comparacion real entre los dos artefactos: el bloque del YAML re-sangra y parte lineas, asi
    // que se comparan con los espacios colapsados. Si alguien cambia uno solo de los dos, rojo.
    expect(plano(yamlTexto)).toContain(plano(descripcionTs));
  });
});

describe("406/R16 — el CHANGELOG deja la entrada fechada, sin reescribir la historica", () => {
  const FECHA = "2026-09-10";

  /** El bloque de texto de la entrada cuyo titulo casa con `marca`. */
  function entradaPorTitulo(marca: RegExp): string {
    const lineas = changelog.split("\n");
    const i = lineas.findIndex((l) => l.startsWith("## ") && marca.test(l));
    expect(i, `no hay entrada con titulo ${marca}`).toBeGreaterThan(-1);
    const resto = lineas.slice(i + 1);
    const fin = resto.findIndex((l) => l.startsWith("## "));
    return [lineas[i], ...(fin === -1 ? resto : resto.slice(0, fin))].join("\n");
  }

  it(`hay una entrada del ${FECHA} que dice que el enlace NO resolvia`, () => {
    // Ojo: ese dia hay DOS entradas (la 405 publica `gestiones[]`), asi que no basta la fecha.
    const entrada = entradaPorTitulo(new RegExp(`^## ${FECHA} —.*evidenciasUrl`));
    expect(entrada).toContain("respondía 404 siempre");
    expect(entrada).toContain("nunca un id interno");
    expect(entrada).toContain("`numGuia` cuando la orden tiene guía");
    expect(entrada).toContain("`numRemision` cuando todavía no la tiene");
  });

  it("el enlace que muestra esa entrada NO termina en un segmento con forma de uuid", () => {
    const entrada = entradaPorTitulo(new RegExp(`^## ${FECHA} —.*evidenciasUrl`));
    const enlaces = [...entrada.matchAll(/https:\/\/app\.ordenex\.co\/api\/ordenes\/api-key\/orden\/[^"\s]+/g)]
      .map((m) => m[0]);
    expect(enlaces.length).toBeGreaterThan(0); // contraprueba: el recolector no esta ciego
    for (const enlace of enlaces) expect(ultimoSegmento(enlace)).not.toMatch(UUID);
  });

  it("la entrada HISTORICA del 2026-08-22 NO se reescribe: sigue mostrando lo que la 268 entrego", () => {
    // Decision Q2 de la ficha: una entrada publicada es una foto de lo que se entregó ese día,
    // igual que una migración aplicada. Lo que se dice de aquel enlace se dice en la entrada
    // NUEVA, no borrando la vieja.
    const historica = entradaPorTitulo(/^## 2026-08-22 — el webhook avisa del ciclo de AYUDA/);
    expect(historica).toContain(
      "https://app.ordenex.co/api/ordenes/api-key/orden/018f2c31-0000-4000-8000-000000000002",
    );
  });
});
