import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { openApiSpec } from "@/lib/api/openapi-spec";
import { CAUSA_DEVOLUCION_SEED } from "@/lib/types/causa-devolucion";
import { CAUSA_INCIDENTE_SEED } from "@/lib/types/causa-incidente";

// ⏳ 2026-09-10 — Feature 405 (T14, R16/R20/R21/R22): el CONTRATO PUBLICADO declara `gestiones`.
//
// Se afirma sobre los TRES artefactos, porque son tres y pueden divergir:
//   · `lib/api/openapi-spec.ts`, que es el que se sirve;
//   · `docs/api/api-key-openapi.yaml`, su espejo TEXTUAL (no hay generador: se edita a mano);
//   · `docs/api/CHANGELOG.md`, que es el AVISO que se copia y se manda al integrador.
//
// R21 se comprueba comparando DOS FUENTES INDEPENDIENTES entre si —el enum del detalle, que se
// deriva de los seeds, contra el literal escrito a mano del webhook, que es contrato vigente y
// esta ficha NO toca—. Comparar el enum contra los seeds de los que sale estaria siempre verde:
// es la aserción contra su propia fuente, y aqui se evita a proposito.
//
// Molde: `openapi-contrato-en-reparto.test.ts`.

const YAML_PATH = path.join(__dirname, "..", "..", "..", "docs", "api", "api-key-openapi.yaml");
const CHANGELOG_PATH = path.join(__dirname, "..", "..", "..", "docs", "api", "CHANGELOG.md");
const yamlTexto = fs.readFileSync(YAML_PATH, "utf8");
const changelog = fs.readFileSync(CHANGELOG_PATH, "utf8");

type Nodo = Record<string, unknown>;
const schemas = openApiSpec.components.schemas as unknown as Record<string, Nodo>;

const gestion = schemas.OrdenGestion;
const propsGestion = gestion.properties as Nodo;
const detalle = schemas.OrdenDetalle;
const partesDetalle = detalle.allOf as Nodo[];
const propiasDetalle = partesDetalle[1].properties as Nodo;

/** Extrae los items (`- valor`) del bloque `enum:` que sigue a una clave dada en el `.yaml`. */
function enumDelYamlTras(clave: string): string[] | null {
  const lineas = yamlTexto.split(/\r?\n/);
  const inicio = lineas.findIndex((l) => new RegExp(`^\\s+${clave}:\\s*$`).test(l));
  if (inicio === -1) return null;
  const enumIdx = lineas.findIndex((l, i) => i > inicio && /^\s*enum:\s*$/.test(l));
  if (enumIdx === -1) return null;
  const items: string[] = [];
  for (let j = enumIdx + 1; j < lineas.length; j++) {
    const m = /^\s*-\s+([A-Za-z0-9_]+)\s*$/.exec(lineas[j]);
    if (!m) break;
    items.push(m[1]);
  }
  return items;
}

// ---------------------------------------------------------------------------------------------
// R20 — `OrdenDetalle` declara `gestiones`, y el `.yaml` es espejo
// ---------------------------------------------------------------------------------------------

describe("405/R20 — `OrdenDetalle` declara `gestiones` y el `.yaml` es espejo exacto", () => {
  it("`gestiones` es una propiedad REQUERIDA del detalle, con items `OrdenGestion`", () => {
    expect(partesDetalle[1].required).toEqual(["evidencias", "gestiones"]);
    expect(propiasDetalle.gestiones).toMatchObject({
      type: "array",
      items: { $ref: "#/components/schemas/OrdenGestion" },
    });
  });

  it("`OrdenGestion` declara EXACTAMENTE las cinco claves de R3, todas requeridas", () => {
    // Escritas a mano y en el orden del contrato: una clave de mas o de menos se ve.
    expect(Object.keys(propsGestion)).toEqual([
      "createdAt",
      "resultado",
      "estadoResultante",
      "motivo",
      "mensajero",
    ]);
    expect(gestion.required).toEqual([
      "createdAt",
      "resultado",
      "estadoResultante",
      "motivo",
      "mensajero",
    ]);
    // Ninguna propiedad opcional, y nada fuera de la lista.
    expect(gestion.additionalProperties).toBe(false);
  });

  it("los tipos son los que el DTO emite: fecha ISO, string, string|null, string|null y objeto", () => {
    expect(propsGestion.createdAt).toMatchObject({ type: "string", format: "date-time" });
    expect((propsGestion.resultado as Nodo).type).toBe("string");
    expect((propsGestion.estadoResultante as Nodo).type).toEqual(["string", "null"]);
    expect((propsGestion.motivo as Nodo).type).toEqual(["string", "null"]);
    expect((propsGestion.mensajero as Nodo).$ref).toBe("#/components/schemas/Mensajero");
  });

  it("Q8: `estadoResultante` se publica SIN `enum`, y la description dice por que", () => {
    expect(propsGestion.estadoResultante).not.toHaveProperty("enum");
    const d = (propsGestion.estadoResultante as Nodo).description as string;
    expect(d.replace(/\s+/g, " ")).toContain("sin lista cerrada a propósito");
  });

  it("R5: el enum de `resultado` son los CINCO values crudos, y NO es el catalogo de estados", () => {
    // Literal a mano: si se comparara contra `ESTATUS_POR_RESULTADO` —de donde se deriva— el
    // aserto estaria siempre verde.
    expect((propsGestion.resultado as Nodo).enum).toEqual([
      "devuelta",
      "entregada",
      "incidente",
      "rechazada",
      "reprogramada",
    ]);
    // No contiene `por_recoger`, asi que `esEnumDeEstado` de `openapi-contrato-en-reparto` NO lo
    // cuenta y los bloques de catalogo siguen siendo CUATRO.
    expect((propsGestion.resultado as Nodo).enum).not.toContain("por_recoger");
  });

  it("R20: hay un EJEMPLO de respuesta del detalle con al menos un elemento de `gestiones`", () => {
    const ejemplos = detalle.examples as Nodo[];
    expect(ejemplos).toHaveLength(1);
    const gestiones = ejemplos[0].gestiones as Nodo[];
    expect(gestiones.length).toBeGreaterThanOrEqual(1);
    // Los dos casos que el design pide ver: uno sin motivo y uno con causa.
    expect(gestiones.map((g) => g.motivo)).toEqual([null, "wrong_address"]);
    // Y cada elemento del ejemplo tiene las CINCO claves: un ejemplo incompleto ensena mal.
    for (const g of gestiones) {
      expect(Object.keys(g)).toEqual([
        "createdAt",
        "resultado",
        "estadoResultante",
        "motivo",
        "mensajero",
      ]);
    }
  });

  it("R9: el schema `Mensajero` tiene la MISMA forma que el `mensajero` que publica la 404", () => {
    // Dos fuentes independientes: el schema con nombre de la 405 contra la declaracion INLINE de
    // `OrdenListItem`, que escribio la 404 y esta ficha no toca.
    const mensajero = schemas.Mensajero;
    const dela404 = (schemas.OrdenListItem.properties as Nodo).mensajero as Nodo;

    expect(mensajero.required).toEqual(dela404.required);
    expect(Object.keys(mensajero.properties as Nodo)).toEqual(
      Object.keys(dela404.properties as Nodo),
    );
    expect(mensajero.additionalProperties).toBe(dela404.additionalProperties);
    for (const clave of ["id", "nombre"]) {
      expect(((mensajero.properties as Nodo)[clave] as Nodo).type).toBe(
        ((dela404.properties as Nodo)[clave] as Nodo).type,
      );
    }
    // La UNICA diferencia declarada: el de la orden admite `null`, el de la gestion no.
    expect(mensajero.type).toBe("object");
    expect(dela404.type).toEqual(["object", "null"]);
  });

  it("el `.yaml` declara `gestiones` en `OrdenDetalle`, en `required` y apuntando a `OrdenGestion`", () => {
    expect(yamlTexto).toContain("    OrdenGestion:");
    expect(yamlTexto).toContain("    Mensajero:");
    expect(yamlTexto).toContain('$ref: "#/components/schemas/OrdenGestion"');
    expect(yamlTexto).toContain('$ref: "#/components/schemas/Mensajero"');
    // `- gestiones` dentro del `required` del segundo bloque del `allOf`.
    expect(yamlTexto.split(/\r?\n/).filter((l) => /^\s+- gestiones\s*$/.test(l))).toHaveLength(1);
  });

  it("el `.yaml` es espejo del `resultado`: MISMOS values, en el MISMO orden", () => {
    const delYaml = enumDelYamlTras("resultado");
    // Ojo: `enumDelYamlTras` toma el PRIMER `resultado:` con enum, que es el de `Evidencia`. Se
    // busca el de `OrdenGestion` recortando el texto desde su schema.
    expect(delYaml).not.toBeNull();
    const desdeGestion = yamlTexto.slice(yamlTexto.indexOf("    OrdenGestion:"));
    const items = /\n {8}resultado:\n {10}type: string\n(?:.*\n)*? {10}enum:\n((?: {12}- \w+\n)+)/
      .exec(desdeGestion)?.[1];
    expect(items, "no se encontro el enum de `OrdenGestion.resultado` en el .yaml").toBeDefined();
    const values = items!
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => l.trim().replace(/^-\s+/, ""));
    expect(values).toEqual((propsGestion.resultado as Nodo).enum);
  });

  it("`Evidencia` sigue apareciendo ANTES que `OrdenGestion` en el `.yaml` (el otro test lo asume)", () => {
    // `openapi-contrato-en-reparto.test.ts` localiza el enum de `Evidencia.resultado` con una
    // regex posicional que toma la PRIMERA coincidencia. Si `OrdenGestion` se moviera por
    // delante, aquel test empezaria a medir el enum equivocado y seguiria verde por casualidad.
    expect(yamlTexto.indexOf("    Evidencia:")).toBeGreaterThan(0);
    expect(yamlTexto.indexOf("    Evidencia:")).toBeLessThan(
      yamlTexto.indexOf("    OrdenGestion:"),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// R21 — el enum de `motivo` coincide VALOR A VALOR con el del webhook
// ---------------------------------------------------------------------------------------------

describe("405/R21 — el enum de `motivo` del detalle coincide valor a valor con el del webhook", () => {
  const dataWebhook = (schemas.WebhookOrdenEstadoActualizado.properties as Nodo).data as Nodo;
  const motivoWebhook = (dataWebhook.properties as Nodo).motivo as Nodo;

  it("las DOS listas son identicas, elemento a elemento y en el mismo orden", () => {
    // Dos fuentes independientes: la del detalle se DERIVA de los seeds; la del webhook es un
    // literal escrito a mano en la 256/268. Si alguien anade una causa a un seed sin tocar el
    // webhook —o al reves—, esto se pone rojo. Comparar la derivada contra sus propios seeds no
    // detectaria nada.
    expect((propsGestion.motivo as Nodo).enum).toEqual(motivoWebhook.enum);
  });

  it("y ese contenido es el esperado, escrito a mano: 3 causas en ingles + 3 en español + null", () => {
    // Sin este caso, las dos listas podrian coincidir en estar las dos MAL.
    expect((propsGestion.motivo as Nodo).enum).toEqual([
      "not_found",
      "wrong_number",
      "wrong_address",
      "danado",
      "perdido",
      "robado",
      null,
    ]);
  });

  it("la lista del detalle sale de los seeds y no de una copia: si un seed crece, crece con el", () => {
    // Esto SI se compara contra la fuente, y a proposito: lo que afirma no es el contenido (eso
    // ya esta arriba, a mano) sino el ENGANCHE. Si alguien sustituyera el derivado por un literal,
    // este caso seguiria verde hoy pero el de arriba se pondria rojo el dia que un seed cambie.
    expect((propsGestion.motivo as Nodo).enum).toEqual([
      ...CAUSA_DEVOLUCION_SEED,
      ...CAUSA_INCIDENTE_SEED,
      null,
    ]);
  });

  it("el `.yaml` publica la misma lista", () => {
    const desdeGestion = yamlTexto.slice(yamlTexto.indexOf("    OrdenGestion:"));
    const bloque = /\n {8}motivo:\n(?:.*\n)*? {10}enum:\n((?: {12}- \w+\n)+)/.exec(desdeGestion);
    expect(bloque, "no se encontro el enum de `OrdenGestion.motivo` en el .yaml").not.toBeNull();
    const values = bloque![1]
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => l.trim().replace(/^-\s+/, ""));
    // En YAML el `null` del enum se escribe como el token `null`.
    expect(values).toEqual([
      "not_found",
      "wrong_number",
      "wrong_address",
      "danado",
      "perdido",
      "robado",
      "null",
    ]);
  });

  it("la description advierte de los DOS `motivo` y de la asimetria de idioma", () => {
    const d = ((propsGestion.motivo as Nodo).description as string).replace(/\s+/g, " ");
    expect(d).toContain("NO es el comentario en texto libre");
    expect(d).toContain("NO sale del sistema por decisión de privacidad");
    expect(d).toContain("asimetría de idioma es DELIBERADA");
    expect(d).toContain("INGLÉS");
    expect(d).toContain("ESPAÑOL");
  });
});

// ---------------------------------------------------------------------------------------------
// R16 — nada mas del canal cambia
// ---------------------------------------------------------------------------------------------

describe("405/R16 — el cuerpo del listado y el del webhook no ganan ninguna clave", () => {
  it("`OrdenListItem` sigue con sus DIEZ propiedades, sin `gestiones`", () => {
    const item = schemas.OrdenListItem;
    expect(Object.keys(item.properties as Nodo)).toEqual([
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
    ]);
    expect(Object.keys(item.properties as Nodo)).not.toContain("gestiones");
    expect(item.required).not.toContain("gestiones");
  });

  it("`Listado` sigue siendo `items` + `pagination`, y sus items son `OrdenListItem`", () => {
    const listado = schemas.Listado;
    expect(Object.keys(listado.properties as Nodo)).toEqual(["items", "pagination"]);
    expect(((listado.properties as Nodo).items as Nodo).items).toEqual({
      $ref: "#/components/schemas/OrdenListItem",
    });
  });

  it("el `data` del webhook sigue con SEIS propiedades y CINCO requeridas", () => {
    const dataWebhook = (schemas.WebhookOrdenEstadoActualizado.properties as Nodo).data as Nodo;
    expect(Object.keys(dataWebhook.properties as Nodo)).toEqual([
      "numGuia",
      "numRemision",
      "estado",
      "motivo",
      "mensajero",
      "evidenciasUrl",
    ]);
    expect(dataWebhook.required).toEqual([
      "numGuia",
      "numRemision",
      "estado",
      "motivo",
      "mensajero",
    ]);
    expect(Object.keys(dataWebhook.properties as Nodo)).not.toContain("gestiones");
  });

  it("`Evidencia` no cambia: los mismos cuatro campos y los mismos tres values", () => {
    const evidencia = schemas.Evidencia;
    expect(evidencia.required).toEqual(["resultado", "contentType", "url", "expiraEnSegundos"]);
    expect(((evidencia.properties as Nodo).resultado as Nodo).enum).toEqual([
      "entregada",
      "rechazada",
      "incidente",
    ]);
  });

  it("`gestiones` aparece en el contrato SOLO dentro de `OrdenDetalle` y de `OrdenGestion`", () => {
    // Barrido del objeto entero: si alguien la colara en el listado o en el webhook, se ve.
    const caminos: string[] = [];
    (function recorrer(nodo: unknown, camino: string) {
      if (Array.isArray(nodo)) {
        nodo.forEach((hijo, i) => recorrer(hijo, `${camino}[${i}]`));
        return;
      }
      if (nodo === null || typeof nodo !== "object") return;
      for (const [clave, valor] of Object.entries(nodo as Record<string, unknown>)) {
        if (clave === "gestiones") caminos.push(`${camino}.gestiones`);
        recorrer(valor, `${camino}.${clave}`);
      }
    })(openApiSpec, "$");

    expect(caminos.sort()).toEqual([
      // la propiedad del schema
      "$.components.schemas.OrdenDetalle.allOf[1].properties.gestiones",
      // y el ejemplo de respuesta
      "$.components.schemas.OrdenDetalle.examples[0].gestiones",
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// R22 — el CHANGELOG del canal, con los TRES avisos
// ---------------------------------------------------------------------------------------------

describe("405/R22 — el CHANGELOG del canal tiene la entrada de la 405 con los tres avisos", () => {
  const entrada = (() => {
    // ⏳ 2026-09-10 (feature 406) — AQUI SE BUSCABA `"## 2026-09-10 —"` A SECAS, y bastó con que
    // OTRA ficha del MISMO DIA añadiera su entrada arriba para que este bloque midiera la entrada
    // equivocada: cinco casos rojos que no tenian nada que ver con la 405. La fecha no identifica
    // una entrada; el TITULO si. Se ancla al titulo propio, con la fecha dentro, y asi el orden de
    // las entradas del dia deja de importar. No se relaja nada: los avisos que se afirman abajo
    // son exactamente los mismos.
    const inicio = changelog.indexOf("## 2026-09-10 — Un campo NUEVO: `gestiones[]`");
    if (inicio === -1) return "";
    const resto = changelog.slice(inicio + 3);
    const fin = resto.indexOf("\n## ");
    return fin === -1 ? resto : resto.slice(0, fin);
  })();

  it("existe una entrada FECHADA para esta ficha", () => {
    expect(entrada.length).toBeGreaterThan(500);
    expect(entrada).toContain("`gestiones[]`");
    expect(entrada).toContain("ADITIVO");
  });

  it("(a) dice que `motivo` es la causa tipificada y NO el texto libre del mensajero", () => {
    const t = entrada.replace(/\s+/g, " ");
    expect(t).toContain("causa TIPIFICADA");
    expect(t).toContain("NO es** el comentario en texto libre");
    expect(t).toContain("no sale del sistema");
    // Y los seis values, por su nombre.
    for (const value of [
      "not_found",
      "wrong_number",
      "wrong_address",
      "danado",
      "perdido",
      "robado",
    ]) {
      expect(t, `falta el value \`${value}\``).toContain(value);
    }
  });

  it("(b) dice que `mensajero` es el ATRIBUIDO y no siempre quien la registro", () => {
    const t = entrada.replace(/\s+/g, " ");
    expect(t).toContain("ATRIBUIDO");
    expect(t).toContain("no siempre es quien la registró");
    // Las familias sinteticas, nombradas para que el integrador las reconozca.
    expect(t).toContain("escalado automático");
    expect(t).toContain("última devolución");
  });

  it("(c) dice que `gestiones.length` NO es el contador interno de Ordenex", () => {
    const t = entrada.replace(/\s+/g, " ");
    expect(t).toContain("`gestiones.length` NO es nuestro contador");
    expect(t).toContain("cierres aprobados distintos");
    expect(t).toContain("valen 1");
  });

  it("ademas avisa del mapeo de nombres, de la asimetria de idioma y de lo que NO entra", () => {
    const t = entrada.replace(/\s+/g, " ");
    expect(t).toContain("`createdAt` y `resultado`");
    expect(t).toContain("asimetría de idioma es DELIBERADA");
    expect(t).toContain("anuladas");
    expect(t).toContain("completo y sin paginar");
    expect(t).toContain("additionalProperties: false");
  });

  it("el recolector de la entrada NO esta ciego: no devuelve el archivo entero ni vacio", () => {
    // Contraprueba del propio troceador. Sin esto, un `indexOf` que fallara devolveria "" y los
    // asertos de arriba caerian —bien—, pero uno que devolviera el archivo ENTERO los pasaria
    // todos leyendo entradas de otras fichas.
    expect(entrada).not.toContain("## 2026-09-09");
    expect(entrada.length).toBeLessThan(changelog.length);
  });
});
