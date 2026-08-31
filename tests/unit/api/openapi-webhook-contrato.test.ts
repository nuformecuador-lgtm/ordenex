import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { openApiSpec } from "@/lib/api/openapi-spec";
import { EVENTOS_PUBLICOS } from "@/lib/types/webhook-eventos";

// Feature 268 (R28/R29/R30) — el CUERPO del evento saliente esta publicado y sigue enganchado a la
// politica.
//
// Que custodia este archivo y que NO. La 256 ya creo la seccion `webhooks:` y su guardia
// (`openapi-webhook-estado-actualizado.test.ts`) afirma que existe, donde vive y que el .yaml la
// refleja. Aqui se afirma lo que la 268 añade y que es facil de romper sin darse cuenta:
//
//   1. el `enum` de `data.estado` se DERIVA de `EVENTOS_PUBLICOS` y no es una copia literal;
//   2. `evidenciasUrl` es la unica clave OPCIONAL de `data` y las otras cuatro siguen requeridas;
//   3. el .yaml publica exactamente lo mismo;
//   4. documentar el cuerpo NO añadio un 5.º catalogo de estados: el guard hermano sigue en 4;
//   5. el `enum` de `motivo` lleva los seis values + `null` y las causas de incidente NO estan
//      traducidas al ingles (la asimetria de idioma es una decision firmada, no un descuido).

const YAML_PATH = path.join(__dirname, "..", "..", "..", "docs", "api", "api-key-openapi.yaml");
const yaml = fs.readFileSync(YAML_PATH, "utf8");

const EVENTO = "orden.estado_actualizado";

// ---------------------------------------------------------------------------------------------
// Helpers duplicados a proposito (aserto 4).
//
// `esEnumDeEstado` y `enumsDeEstado` viven en `openapi-contrato-en-reparto.test.ts` y NO se
// exportan: un archivo de test no es un modulo de utilidades y exportarlos lo convertiria en una
// dependencia de produccion encubierta. Se copian aqui, con esta nota, porque la propiedad que se
// afirma es precisamente que ESE predicado —el del guard hermano, no uno parecido— sigue contando
// CUATRO bloques despues de que la 268 metiera un `enum` de estados en la seccion `webhooks:`.
// Si el predicado del guard cambia y esta copia no, los dos archivos dejan de hablar de lo mismo:
// es el coste conocido de la duplicacion y se acepta a cambio de no exportar desde un test.
// ---------------------------------------------------------------------------------------------

function esEnumDeEstado(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((v) => typeof v === "string") &&
    (value as string[]).includes("entregada") &&
    (value as string[]).includes("por_recoger")
  );
}

function enumsDeEstado(node: unknown, out: string[][] = []): string[][] {
  if (Array.isArray(node)) {
    for (const item of node) enumsDeEstado(item, out);
    return out;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "enum" && esEnumDeEstado(value)) out.push(value);
      enumsDeEstado(value, out);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Lectura del .yaml. Igual que el resto de los tests de openapi, el archivo se lee como TEXTO
// (js-yaml no es resoluble desde la raiz del proyecto). Aqui no hace falta parsear el documento
// entero: basta con aislar la seccion `webhooks:` y, dentro, los tres puntos que la 268 toca.
// ---------------------------------------------------------------------------------------------

function sangria(linea: string): number {
  return linea.length - linea.trimStart().length;
}

/** Lineas de la seccion de NIVEL SUPERIOR `webhooks:` (sin su cabecera). */
function lineasWebhooks(): string[] {
  const lineas = yaml.split(/\r?\n/);
  const inicio = lineas.indexOf("webhooks:");
  if (inicio === -1) throw new Error("el .yaml no declara la seccion de NIVEL SUPERIOR webhooks:");
  const out: string[] = [];
  for (let i = inicio + 1; i < lineas.length; i++) {
    if (lineas[i].trim() !== "" && sangria(lineas[i]) === 0) break;
    out.push(lineas[i]);
  }
  return out;
}

const WEBHOOKS_YAML = lineasWebhooks();

/**
 * Lineas del sub-bloque que cuelga de la clave `<nombre>:` con la sangria exacta `ind`,
 * buscando desde `desde`. Lanza si la clave no aparece: un camino que no existe es un fallo del
 * contrato, no un `undefined` silencioso.
 */
function bloqueDe(lineas: string[], nombre: string, ind: number, desde = 0): string[] {
  const cabecera = `${" ".repeat(ind)}${nombre}:`;
  const i = lineas.findIndex((l, idx) => idx >= desde && l === cabecera);
  if (i === -1) throw new Error(`el .yaml no declara \`${nombre}\` con sangria ${ind}`);
  const out: string[] = [];
  for (let j = i + 1; j < lineas.length; j++) {
    const linea = lineas[j];
    if (linea.trim() === "") {
      out.push(linea);
      continue;
    }
    if (sangria(linea) <= ind) break;
    out.push(linea);
  }
  return out;
}

/** Items `- valor` que siguen a la primera clave `enum:` del bloque, en orden. */
function enumDelBloque(bloque: string[]): string[] {
  const i = bloque.findIndex((l) => /^\s*enum:\s*$/.test(l));
  if (i === -1) throw new Error("el bloque del .yaml no declara `enum:`");
  const items: string[] = [];
  for (let j = i + 1; j < bloque.length; j++) {
    const m = /^\s*-\s+([A-Za-z0-9_]+)\s*$/.exec(bloque[j]);
    if (!m) break;
    items.push(m[1]);
  }
  return items;
}

/** Items `- valor` de la primera clave `required:` del bloque, en orden. */
function requiredDelBloque(bloque: string[]): string[] {
  const i = bloque.findIndex((l) => /^\s*required:\s*$/.test(l));
  if (i === -1) throw new Error("el bloque del .yaml no declara `required:`");
  const items: string[] = [];
  for (let j = i + 1; j < bloque.length; j++) {
    const m = /^\s*-\s+([A-Za-z0-9_]+)\s*$/.exec(bloque[j]);
    if (!m) break;
    items.push(m[1]);
  }
  return items;
}

// ---------------------------------------------------------------------------------------------
// Accesos al objeto TS (fuente de verdad) y al .yaml (espejo publicado).
// ---------------------------------------------------------------------------------------------

const dataTs =
  openApiSpec.webhooks[EVENTO].post.requestBody.content["application/json"].schema.properties.data;

// `data:` cuelga de `properties:` del schema del requestBody; en el .yaml queda con sangria 16 y
// sus propias propiedades con sangria 20.
const DATA_YAML = bloqueDe(WEBHOOKS_YAML, "data", 16);
const PROPIEDADES_YAML = bloqueDe(DATA_YAML, "properties", 18);
const ESTADO_YAML = bloqueDe(PROPIEDADES_YAML, "estado", 20);
const MOTIVO_YAML = bloqueDe(PROPIEDADES_YAML, "motivo", 20);

/** Las tres causas de incidente, en español y SIN traducir (73/F1.4-g y 158/Q-B). */
const CAUSAS_INCIDENTE = ["danado", "perdido", "robado"] as const;
/** Las traducciones que NUNCA deben aparecer: si alguien «armoniza» el enum, esto se pone rojo. */
const TRADUCCIONES_PROHIBIDAS = ["damaged", "lost", "stolen"] as const;

describe("268/R29 — el enum de `data.estado` se DERIVA de la politica, no se copia", () => {
  it("es exactamente `[...EVENTOS_PUBLICOS].sort()`", () => {
    // Este es el aserto que detecta la copia literal: si alguien reemplaza la derivacion por una
    // lista escrita a mano y luego la politica cambia (un alta o una baja en `EVENTOS_PUBLICOS`),
    // el contrato publicado se queda mintiendo y este caso se pone rojo. El orden es determinista
    // a proposito, para que el espejo del .yaml se pueda comparar posicionalmente.
    expect(dataTs.properties.estado.enum).toEqual([...EVENTOS_PUBLICOS].sort());
  });

  it("son 13 values y NO incluye los estados internos que el webhook nunca emite", () => {
    const publicados = dataTs.properties.estado.enum;
    expect(publicados).toHaveLength(13);
    // ⏳ 2026-08-31 — `en_preparacion` SALE de esta lista de internos: desde el parche de hoy SI se
    // publica, como evento de NACIMIENTO de la rama de fulfillment. Los tres que quedan son los de
    // ruteo satelite, y esos siguen sin viajar nunca en un evento.
    for (const interno of ["por_recoger", "en_bodega_satelite", "en_ruta_bodega_satelite"]) {
      expect(publicados, `el webhook no emite ${interno}`).not.toContain(interno);
    }
    // Y si lleva los dos que la 268 añade a la politica, mas el del parche del 2026-08-31.
    expect(publicados).toContain("ayuda_tienda");
    expect(publicados).toContain("incidente");
    expect(publicados).toContain("en_preparacion");
  });

  it("la prosa declara que es la POLITICA y un SUBCONJUNTO del catalogo de OrdenListItem", () => {
    const descripcion: string = dataTs.properties.estado.description;
    expect(descripcion).toContain("POLÍTICA de eventos públicos");
    expect(descripcion).toContain("SUBCONJUNTO");
    expect(descripcion).toContain("OrdenListItem.estado");
  });
});

describe("268/R28 — `evidenciasUrl` es OPCIONAL y las otras cuatro siguen REQUERIDAS", () => {
  // Variante CORREGIDA del punto 2 de T6d, y el porque queda escrito aqui: `tasks.md` pedia «la
  // causa y `evidenciasUrl` como OPCIONALES». Eso se escribio ANTES de saber que el PR #434
  // (feature 256) ya habia PUBLICADO `motivo` como REQUERIDO y nullable, con la forma «las cuatro
  // claves estan SIEMPRE presentes». Degradar ahora `motivo` a opcional seria romper un contrato
  // ya vivo —el consumidor que no ramifica porque confia en que la clave existe—, asi que
  // prevalece no romperlo: `motivo` sigue requerido y nullable, y la unica clave opcional que la
  // 268 introduce es `evidenciasUrl`. Nota fechada el 2026-08-22.
  it("`data.required` son EXACTAMENTE numGuia, numRemision, estado y motivo", () => {
    expect([...dataTs.required].sort()).toEqual(
      ["estado", "motivo", "numGuia", "numRemision"].sort(),
    );
    expect(dataTs.required).not.toContain("evidenciasUrl");
  });

  it("`evidenciasUrl` esta declarada como propiedad, con tipo string/uri", () => {
    expect(Object.keys(dataTs.properties)).toContain("evidenciasUrl");
    expect(dataTs.properties.evidenciasUrl.type).toBe("string");
    expect(dataTs.properties.evidenciasUrl.format).toBe("uri");
  });

  it("la prosa dice que se OMITE (no viaja como null), que es ESTABLE y que exige la API key", () => {
    const descripcion: string = dataTs.properties.evidenciasUrl.description;
    expect(descripcion).toContain("OPCIONAL");
    expect(descripcion).toContain("se OMITE");
    expect(descripcion).toContain("ESTABLE");
    expect(descripcion).toContain("no caduca");
    expect(descripcion).toContain("NO es una URL firmada");
    expect(descripcion).toContain("Authorization: Bearer ordx_");
  });

  it("la prosa de `data` ya no promete «cuatro claves» a secas: distingue las 4 fijas de la opcional", () => {
    const descripcion: string = dataTs.description;
    expect(descripcion).toContain("SIEMPRE presentes");
    expect(descripcion).toContain("evidenciasUrl");
    expect(descripcion).toContain("OPCIONAL");
  });
});

describe("268/R20 — el enum de `motivo` lleva los seis values + null, sin traducir", () => {
  it("son los tres de devolucion, los tres de incidente y `null`", () => {
    expect(dataTs.properties.motivo.enum).toEqual([
      "not_found",
      "wrong_number",
      "wrong_address",
      "danado",
      "perdido",
      "robado",
      null,
    ]);
    // Sigue siendo nullable: la clave no se omite nunca (contrato publicado por la 256).
    expect(dataTs.properties.motivo.type).toEqual(["string", "null"]);
  });

  it("NINGUNA causa de incidente esta traducida al ingles (asimetria firmada, 73/F1.4-g y 158/Q-B)", () => {
    const values = dataTs.properties.motivo.enum;
    for (const causa of CAUSAS_INCIDENTE) expect(values).toContain(causa);
    for (const traduccion of TRADUCCIONES_PROHIBIDAS) {
      expect(values, `la causa de incidente se «armonizo» al ingles: ${traduccion}`).not.toContain(
        traduccion,
      );
    }
  });

  it("la prosa explica CUAL enum aplica segun `estado` y que la asimetria es deliberada", () => {
    const descripcion: string = dataTs.properties.motivo.description;
    expect(descripcion).toContain("DOS enums");
    expect(descripcion).toContain("DELIBERADA");
    expect(descripcion).toContain("INGLÉS");
    expect(descripcion).toContain("ESPAÑOL");
  });
});

describe("268/R30 — el .yaml publica el MISMO bloque que el objeto TS", () => {
  it("el enum de `estado` del .yaml es identico, value a value y en el mismo orden", () => {
    expect(enumDelBloque(ESTADO_YAML)).toEqual(dataTs.properties.estado.enum);
  });

  it("el enum de `motivo` del .yaml es identico (incluido el `null` explicito)", () => {
    // El lector de items devuelve `null` como el texto "null": es el mismo value que el objeto TS
    // escribe como literal, y esta ahi a proposito (no es una omision).
    const yamlItems = enumDelBloque(MOTIVO_YAML);
    const tsItems = dataTs.properties.motivo.enum.map((v) => (v === null ? "null" : v));
    expect(yamlItems).toEqual(tsItems);
  });

  it("el .yaml declara `evidenciasUrl` como propiedad y NO la mete en `required`", () => {
    expect(PROPIEDADES_YAML.some((l) => l === `${" ".repeat(20)}evidenciasUrl:`)).toBe(true);
    const requeridas = requiredDelBloque(DATA_YAML);
    expect(requeridas).toEqual(["numGuia", "numRemision", "estado", "motivo"]);
    expect(requeridas).not.toContain("evidenciasUrl");
  });
});

describe("268/R28 — documentar el cuerpo NO añadio un 5.º catalogo de estados", () => {
  it("`enumsDeEstado(openApiSpec)` sigue devolviendo CUATRO bloques", () => {
    // Esta es la razon por la que el enum del webhook se deriva de la POLITICA y no del catalogo:
    // si alguien lo documentara con los 16 values de `OrdenListItem.estado`, ese enum pasaria a
    // contener `entregada` Y `por_recoger`, el predicado lo contaria y `openapi-contrato-en-
    // reparto.test.ts` empezaria a ver CINCO bloques en el TS y cinco en el .yaml: churn gratuito
    // en un guard que protege otra cosa. Este caso lo detecta aqui, donde esta el motivo escrito.
    expect(enumsDeEstado(openApiSpec)).toHaveLength(4);
  });

  it("ningun enum del subarbol `webhooks` es contado como catalogo de estados", () => {
    expect(enumsDeEstado(openApiSpec.webhooks)).toEqual([]);
    // Y la razon concreta: el enum del webhook lleva `entregada` pero no el estado interno de
    // recogida, que es la otra mitad que el predicado exige.
    expect(dataTs.properties.estado.enum).toContain("entregada");
    expect(esEnumDeEstado(dataTs.properties.estado.enum)).toBe(false);
  });
});
