import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openApiSpec } from "@/lib/api/openapi-spec";

// ⏳ 2026-09-09 — Feature 404 (T7, R24/R25): el CONTRATO PUBLICADO declara `mensajero`.
//
// Se afirma sobre los DOS artefactos, porque son dos y pueden divergir:
//   · `lib/api/openapi-spec.ts`, que es el que se sirve;
//   · `docs/api/api-key-openapi.yaml`, su espejo TEXTUAL (no hay comparador automatico entre los
//     dos: la equivalencia palabra por palabra es verificacion humana del reviewer, y esta escrito
//     asi en `tasks.md`). Lo que SI se puede medir aqui, y se mide, es que el espejo declara la
//     propiedad, la mete en `required` y lleva los dos ejemplos.
//
// R25 se afirma por AUSENCIA sobre TODAS las descripciones publicadas, no solo sobre la que
// tocamos: si mañana alguien copia la frase vieja en otro schema, este archivo lo caza.

const YAML_PATH = path.join(__dirname, "..", "..", "..", "docs", "api", "api-key-openapi.yaml");
const yamlTexto = fs.readFileSync(YAML_PATH, "utf8");

type Nodo = Record<string, unknown>;
const schemas = openApiSpec.components.schemas as unknown as Record<string, Nodo>;

const dataWebhook = (schemas.WebhookOrdenEstadoActualizado.properties as Nodo).data as Nodo;
const mensajeroWebhook = (dataWebhook.properties as Nodo).mensajero as Nodo;
const listItem = schemas.OrdenListItem;
const mensajeroItem = (listItem.properties as Nodo).mensajero as Nodo;

/** La forma EXACTA que R1/R2 exigen, escrita a mano una sola vez y comparada contra los dos. */
function afirmaLaForma(nodo: Nodo, donde: string) {
  expect(nodo.type, donde).toEqual(["object", "null"]); // R2: el objeto O `null`, nunca ausente
  expect(nodo.required, donde).toEqual(["id", "nombre"]); // R1
  expect(nodo.additionalProperties, donde).toBe(false); // R6: ninguna clave mas
  const props = nodo.properties as Nodo;
  expect(Object.keys(props), donde).toEqual(["id", "nombre"]);
  expect((props.id as Nodo).type, donde).toBe("string");
  expect((props.nombre as Nodo).type, donde).toBe("string");
}

describe("404/R24 — los schemas publicados declaran `mensajero` con la forma `{id, nombre} | null`", () => {
  it("`WebhookOrdenEstadoActualizado.data.mensajero` tiene la forma exacta", () => {
    afirmaLaForma(mensajeroWebhook, "webhook");
  });

  it("`OrdenListItem.mensajero` tiene la MISMA forma exacta (R5)", () => {
    afirmaLaForma(mensajeroItem, "listado");
    // R5: y no es «parecida», es la misma. Se comparan los dos nodos entre si en lo estructural.
    expect(mensajeroItem.type).toEqual(mensajeroWebhook.type);
    expect(mensajeroItem.required).toEqual(mensajeroWebhook.required);
    expect(Object.keys(mensajeroItem.properties as Nodo)).toEqual(
      Object.keys(mensajeroWebhook.properties as Nodo),
    );
  });

  it("`OrdenDetalle` lo hereda por `allOf` y NO declara un `mensajero` propio", () => {
    const detalle = schemas.OrdenDetalle;
    const partes = detalle.allOf as Nodo[];
    // La primera parte es la referencia al item: de ahi sale el campo.
    expect(partes[0]).toEqual({ $ref: "#/components/schemas/OrdenListItem" });
    // ⏳ 2026-09-10 (feature 405) — AQUI LA SEGUNDA PARTE TENIA UNA SOLA PROPIEDAD, `evidencias`,
    // y ahora tiene DOS: la 405 le suma `gestiones`. El literal se ENMIENDA y sigue siendo una
    // igualdad exacta, en el mismo orden, porque lo que este caso protege NO ha cambiado: que el
    // detalle no vuelva a declarar un `mensajero` propio —una segunda declaracion podria
    // divergir, que es justo lo que 404/R5 prohibe—.
    const propias = partes[1].properties as Nodo;
    expect(Object.keys(propias)).toEqual(["evidencias", "gestiones"]);
    expect(partes[1].required).toEqual(["evidencias", "gestiones"]);
    // La afirmacion de fondo, dicha por su nombre y no por conteo: `mensajero` no esta aqui.
    expect(Object.keys(propias)).not.toContain("mensajero");
  });
});

describe("404/R9+R24 — `required` y la unica clave opcional", () => {
  it("`mensajero` esta en `required` de `data`, y `evidenciasUrl` sigue siendo la UNICA fuera", () => {
    const required = dataWebhook.required as string[];
    expect(required).toEqual(["numGuia", "numRemision", "estado", "motivo", "mensajero"]);
    const noRequeridas = Object.keys(dataWebhook.properties as Nodo).filter(
      (k) => !required.includes(k),
    );
    expect(noRequeridas).toEqual(["evidenciasUrl"]);
  });

  it("`mensajero` esta en `required` de `OrdenListItem`, junto a los nueve de siempre", () => {
    // ⏳ 2026-09-10 (feature 415, R37) — ENMENDADO con su motivo, no relajado. La 415 anade TRES
    // campos ADITIVOS al item (`zona`, `costoEstimado`, `costoReal`) y los TRES entran en
    // `required`, porque las tres claves viajan SIEMPRE. Lo que este caso mide sigue siendo lo
    // mismo —que `mensajero` esta en `required` y que NINGUNA propiedad del item es opcional— y
    // sigue siendo una igualdad de la lista entera, en orden.
    expect(listItem.required).toEqual([
      "numGuia",
      "numRemision",
      "estado",
      "destinatario",
      "telefonoDest",
      "producto",
      "direccion",
      "montoCobrar",
      "createdAt",
      "mensajero",
      "zona",
      "costoEstimado",
      "costoReal",
    ]);
    // Y no hay ninguna propiedad opcional en el item: todas las declaradas son requeridas.
    expect(Object.keys(listItem.properties as Nodo).sort()).toEqual(
      [...(listItem.required as string[])].sort(),
    );
  });

  it("404/R10: `mensajero` va TRAS `motivo` y ANTES de `evidenciasUrl` en el orden de propiedades", () => {
    // El orden del contrato refleja el orden REAL de las claves del cuerpo, y la firma se calcula
    // sobre el string serializado: no es cosmetico.
    expect(Object.keys(dataWebhook.properties as Nodo)).toEqual([
      "numGuia",
      "numRemision",
      "estado",
      "motivo",
      "mensajero",
      "evidenciasUrl",
    ]);
  });
});

describe("404/R2+R24 — los dos ejemplos publicados llevan la clave", () => {
  const ejemplos = schemas.WebhookOrdenEstadoActualizado.examples as Nodo[];

  it("los dos ejemplos la llevan: uno con objeto y otro con `null`", () => {
    expect(ejemplos).toHaveLength(2);
    for (const ej of ejemplos) {
      expect(Object.keys(ej.data as Nodo)).toContain("mensajero");
    }
    const valores = ejemplos.map((ej) => (ej.data as Nodo).mensajero);
    expect(valores[0]).toBeNull();
    expect(valores[1]).toEqual({
      id: "018f2c31-0000-4000-8000-0000000000aa",
      nombre: "Carlos Jiménez Mora",
    });
  });

  it("en el ejemplo de `incidente` la clave va en su POSICION real, antes de `evidenciasUrl`", () => {
    expect(Object.keys(ejemplos[1].data as Nodo)).toEqual([
      "numGuia",
      "numRemision",
      "estado",
      "motivo",
      "mensajero",
      "evidenciasUrl",
    ]);
  });
});

describe("404/R7 — la prosa publicada dice que es «quien la lleva», no «quien la gestiono»", () => {
  it("las dos descripciones lo advierten, y avisan del `null` sobrevenido", () => {
    for (const [donde, nodo] of [
      ["webhook", mensajeroWebhook],
      ["listado", mensajeroItem],
    ] as const) {
      // Las descripciones son bloques de varias lineas: se normalizan los saltos para que una
      // frase pueda afirmarse entera aunque el bloque la parta en dos renglones.
      const d = (nodo.description as string).replace(/\s+/g, " ");
      expect(d, donde).toContain("ASIGNADO");
      expect(d, donde).toContain("no quién la gestionó");
      expect(d, donde).toContain("cierre diario");
      expect(d, donde).toContain("historial de gestiones");
      // R2: y que la clave viaja siempre.
      expect(d, donde).toMatch(/SIEMPRE/);
    }
  });

  it("Q1: el contrato avisa de que el `id` es un UUID en TEXTO, no un entero", () => {
    for (const nodo of [mensajeroWebhook, mensajeroItem]) {
      const idDesc = ((nodo.properties as Nodo).id as Nodo).description as string;
      expect(idDesc).toContain("UUID en TEXTO");
      expect(idDesc).toContain("no un entero");
      expect(idDesc).toContain("ESTABLE");
    }
  });

  it("R17: el listado avisa de que no se puede filtrar ni ordenar por este campo", () => {
    const d = mensajeroItem.description as string;
    expect(d).toContain("No se puede filtrar ni ordenar");
    expect(d).toContain("se ignora");
  });
});

// -----------------------------------------------------------------------------------------------
// R25 — ninguna description publicada afirma ya la exclusion SIN acotarla
// -----------------------------------------------------------------------------------------------

/** Todas las `description` del contrato, con el camino donde viven. */
function descripciones(nodo: unknown, camino = "$"): Array<{ camino: string; texto: string }> {
  if (Array.isArray(nodo)) {
    return nodo.flatMap((hijo, i) => descripciones(hijo, `${camino}[${i}]`));
  }
  if (nodo === null || typeof nodo !== "object") return [];
  const salida: Array<{ camino: string; texto: string }> = [];
  for (const [clave, valor] of Object.entries(nodo as Record<string, unknown>)) {
    if (clave === "description" && typeof valor === "string") {
      salida.push({ camino: `${camino}.description`, texto: valor });
    } else {
      salida.push(...descripciones(valor, `${camino}.${clave}`));
    }
  }
  return salida;
}

describe("404/R25 — la exclusion de la 106 queda ACOTADA por escrito, no en pie", () => {
  const todas = descripciones(openApiSpec);

  it("el detector no esta ciego: encuentra descripciones de verdad", () => {
    // Contraprueba del propio recolector: si devolviera [], los dos asertos de abajo pasarian
    // vacios. Se ancla a una description conocida que esta ficha NO toca.
    expect(todas.length).toBeGreaterThan(50);
    expect(todas.some((d) => d.texto.includes("URL firmada"))).toBe(true);
  });

  it("ninguna description publicada dice ya «sin ids internos ni PII de terceros» a secas", () => {
    const infractoras = todas.filter((d) => d.texto.includes("sin ids internos ni PII de terceros"));
    expect(infractoras.map((d) => d.camino)).toEqual([]);
  });

  it("ninguna description dice que el canal excluye al mensajero sin acotarlo", () => {
    // La frase problematica de la 106 y sus variantes literales. Una description puede NOMBRAR al
    // mensajero cuanto quiera —de hecho la nueva lo hace—; lo que no puede es afirmar que no se
    // publica nada de el.
    const prohibidas = [
      "sin datos del mensajero",
      "sin PII del mensajero",
      "sin datos personales de terceros (p. ej. el mensajero)",
    ];
    for (const frase of prohibidas) {
      const infractoras = todas.filter((d) => d.texto.includes(frase));
      expect(infractoras.map((d) => d.camino), frase).toEqual([]);
    }
  });

  it("la description de `OrdenListItem` declara la excepcion CON su alcance", () => {
    const d = listItem.description as string;
    expect(d).toContain("excepción");
    expect(d).toContain("NOMBRE del mensajero ASIGNADO");
    expect(d).toContain("dueño de la orden");
    // Y dice explicitamente que lo demas sigue excluido: la excepcion es acotada, no una puerta.
    expect(d).toContain("sigue excluido");
    expect(d).toContain("GESTIONÓ");
    expect(d).toContain("texto libre");
  });
});

// -----------------------------------------------------------------------------------------------
// El espejo textual `.yaml`
// -----------------------------------------------------------------------------------------------

describe("404/R24 — el espejo `docs/api/api-key-openapi.yaml` refleja el cambio", () => {
  it("declara `mensajero:` como clave en los DOS schemas afectados (y en el ejemplo)", () => {
    // Tres apariciones como clave con hijos: la propiedad del `data` del webhook (sangria 12), la
    // propiedad de `OrdenListItem` (sangria 8) y el objeto del EJEMPLO de `incidente` (sangria
    // 12). Se cuentan una a una para que quitar cualquiera de las tres se vea.
    //
    // ⏳ 2026-09-10 (feature 405) — ERAN TRES Y AHORA SON SEIS. Las tres de la 404 siguen exactas
    // (12, 12 y 8) y NO se han tocado; las tres nuevas son de la 405: la propiedad de
    // `OrdenGestion` (sangria 8) y los DOS mensajeros del ejemplo de `OrdenDetalle` (sangria 14).
    // El conteo se ENMIENDA y sigue siendo exacto —quitar cualquiera de las seis se ve—, con un
    // orden numerico explicito porque el `sort()` por defecto de JavaScript ordena por texto.
    const comoClave = yamlTexto
      .split("\n")
      .filter((l) => /^\s+mensajero:\s*$/.test(l))
      .map((l) => l.length - l.trimStart().length)
      .sort((a, b) => a - b);
    expect(comoClave).toEqual([8, 8, 12, 12, 14, 14]);
  });

  it("mete `mensajero` en los DOS bloques `required` y no toca `evidenciasUrl`", () => {
    // ⏳ 2026-09-10 (feature 405): eran DOS bloques `required` con `- mensajero` (el `data` del
    // webhook y `OrdenListItem`) y ahora son TRES: `OrdenGestion` tambien lo exige. Lo que este
    // caso protege de verdad —que `evidenciasUrl` siga SIN ser requerida— no cambia.
    const enRequired = yamlTexto.split("\n").filter((l) => /^\s+- mensajero\s*$/.test(l));
    expect(enRequired).toHaveLength(3);
    expect(yamlTexto).not.toContain("- evidenciasUrl");
  });

  it("los dos ejemplos del `.yaml` llevan la clave, uno con `null` y otro con el objeto", () => {
    expect(yamlTexto).toContain("mensajero: null");
    expect(yamlTexto).toContain('id: "018f2c31-0000-4000-8000-0000000000aa"');
    expect(yamlTexto).toContain('nombre: "Carlos Jiménez Mora"');
  });

  it("el `.yaml` tampoco afirma ya la exclusion sin acotarla (R25)", () => {
    expect(yamlTexto).not.toContain("sin ids internos ni PII de terceros");
    expect(yamlTexto).not.toContain("sin datos del mensajero");
    expect(yamlTexto).not.toContain("sin PII del mensajero");
    // Y dice la excepcion con su alcance.
    expect(yamlTexto).toContain("NOMBRE del mensajero ASIGNADO");
    expect(yamlTexto).toContain("sigue excluido");
  });

  it("el `.yaml` dice tambien lo de R7 y lo de Q1", () => {
    expect(yamlTexto).toContain("no quién la gestionó");
    expect(yamlTexto).toContain("UUID en TEXTO, no un entero");
    expect(yamlTexto).toContain("Las cinco claves");
  });
});
