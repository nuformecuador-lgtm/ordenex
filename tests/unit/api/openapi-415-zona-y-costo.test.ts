import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { openApiSpec } from "@/lib/api/openapi-spec";

/**
 * ⏳ 2026-09-10 — FEATURE 415 (T10): el CONTRATO PUBLICADO declara `zona`, `costoEstimado` y
 * `costoReal`.
 *
 * Se afirma sobre los DOS artefactos del contrato porque son dos y pueden divergir:
 *   · `lib/api/openapi-spec.ts`, que es el que se sirve;
 *   · `docs/api/api-key-openapi.yaml`, su espejo TEXTUAL (no hay generador: se edita a mano).
 *
 * ⚠️ LO QUE ESTE ARCHIVO NO PUEDE HACER, y hay que decirlo: no existe comparador automatico entre
 * el `.ts` y el `.yaml`. Aqui se comprueba la ESTRUCTURA del espejo (la propiedad, su `required`,
 * su `additionalProperties` y las frases que R15/R23/R38/R39 exigen), no su redaccion entera. La
 * equivalencia palabra por palabra es verificacion HUMANA del reviewer sobre el diff lado a lado.
 *
 * Molde: `openapi-405-gestiones.test.ts` y `openapi-404-mensajero.test.ts`.
 */

const YAML_PATH = path.join(__dirname, "..", "..", "..", "docs", "api", "api-key-openapi.yaml");
const yamlTexto = fs.readFileSync(YAML_PATH, "utf8");

type Nodo = Record<string, unknown>;
const schemas = openApiSpec.components.schemas as unknown as Record<string, Nodo>;

const listItem = schemas.OrdenListItem;
const props = listItem.properties as Nodo;
const zona = schemas.Zona;
const costo = schemas.OrdenCosto;
const mensajero = schemas.Mensajero;

/** Todas las `description` publicadas del spec, aplanadas: para las prohibiciones de R39. */
function todasLasDescriptions(nodo: unknown, salida: string[] = []): string[] {
  if (Array.isArray(nodo)) {
    for (const n of nodo) todasLasDescriptions(n, salida);
    return salida;
  }
  if (nodo !== null && typeof nodo === "object") {
    for (const [clave, valor] of Object.entries(nodo as Nodo)) {
      if (clave === "description" && typeof valor === "string") salida.push(valor);
      else todasLasDescriptions(valor, salida);
    }
  }
  return salida;
}

const DESCRIPTIONS = todasLasDescriptions(openApiSpec);

// ---------------------------------------------------------------------------------------------
// R37 — las tres propiedades, declaradas y REQUERIDAS
// ---------------------------------------------------------------------------------------------

describe("415/R37 — `OrdenListItem` declara los tres campos y los tres son requeridos", () => {
  it("las tres propiedades existen en `properties`", () => {
    for (const clave of ["zona", "costoEstimado", "costoReal"]) {
      expect(props, `falta \`${clave}\``).toHaveProperty(clave);
    }
  });

  it("las tres estan en `required` — la clave viaja SIEMPRE (R9)", () => {
    const requeridas = listItem.required as string[];
    for (const clave of ["zona", "costoEstimado", "costoReal"]) {
      expect(requeridas, `\`${clave}\` no es requerida`).toContain(clave);
    }
    // Y ninguna propiedad del item es opcional: el conjunto coincide con `required`.
    expect(Object.keys(props).sort()).toEqual([...requeridas].sort());
  });

  it("R34: las diez propiedades anteriores conservan nombre, tipo y `required`", () => {
    const antes: Array<[string, unknown]> = [
      ["numGuia", ["integer", "null"]],
      ["numRemision", "string"],
      ["estado", "string"],
      ["destinatario", "string"],
      ["telefonoDest", "string"],
      ["producto", "string"],
      ["direccion", ["string", "null"]],
      ["montoCobrar", ["number", "null"]],
      ["createdAt", "string"],
    ];
    for (const [clave, tipo] of antes) {
      expect((props[clave] as Nodo).type, clave).toEqual(tipo);
      expect(listItem.required as string[], clave).toContain(clave);
    }
    // `mensajero` conserva su forma y su nullabilidad, que es lo que lo distingue de `zona`.
    expect((props.mensajero as Nodo).type).toEqual(["object", "null"]);
    expect(listItem.required as string[]).toContain("mensajero");
  });

  it("el DETALLE los hereda por `allOf`, sin declarar nada propio", () => {
    const partes = schemas.OrdenDetalle.allOf as Nodo[];
    expect(partes[0]).toEqual({ $ref: "#/components/schemas/OrdenListItem" });
    const propias = partes[1].properties as Nodo;
    for (const clave of ["zona", "costoEstimado", "costoReal"]) {
      expect(propias, `el detalle redeclara \`${clave}\``).not.toHaveProperty(clave);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// R38 — `Zona` tiene la MISMA forma que `Mensajero`, y la MISMA regla de agrupacion
// ---------------------------------------------------------------------------------------------

describe("415/R38 — `Zona` y `Mensajero`: misma forma, misma regla", () => {
  it("`Zona` declara exactamente `id` y `nombre`, las dos requeridas, sin claves extra", () => {
    expect(Object.keys(zona.properties as Nodo).sort()).toEqual(["id", "nombre"]);
    expect(zona.required).toEqual(["id", "nombre"]);
    expect(zona.additionalProperties).toBe(false);
    expect(zona.type).toBe("object");
  });

  it("tiene la MISMA forma que `Mensajero`, clave a clave y tipo a tipo", () => {
    // Comparacion estructural de los dos nodos, igual que la 405 hizo con `Mensajero`: si uno
    // ganara un campo o cambiara un tipo, el integrador tendria que aplicar dos reglas distintas
    // a las dos entidades con nombre del MISMO payload.
    expect(Object.keys(zona.properties as Nodo)).toEqual(
      Object.keys(mensajero.properties as Nodo),
    );
    expect(zona.required).toEqual(mensajero.required);
    expect(zona.additionalProperties).toBe(mensajero.additionalProperties);
    for (const clave of ["id", "nombre"]) {
      const a = (zona.properties as Nodo)[clave] as Nodo;
      const b = (mensajero.properties as Nodo)[clave] as Nodo;
      expect(a.type, clave).toBe(b.type);
      expect(a.type, clave).toBe("string");
    }
  });

  it("dice «agrupá por `id`, nunca por `nombre`», con el mismo tono que `mensajero`", () => {
    const idDesc = (zona.properties as Nodo).id as Nodo;
    const nombreDesc = (zona.properties as Nodo).nombre as Nodo;
    expect(idDesc.description as string).toMatch(/agrupá por este valor/i);
    expect(idDesc.description as string).toMatch(/nunca por `nombre`/i);
    expect(nombreDesc.description as string).toMatch(/PUEDE cambiar/);
    expect(nombreDesc.description as string).toMatch(/no lo uses como clave/i);
    // Y el `id` del mensajero sigue diciendo lo mismo: es la MISMA regla para los dos.
    expect((mensajero.properties as Nodo).id as Nodo).toMatchObject({
      description: expect.stringMatching(/agrupá por este valor/i),
    });
  });

  it("R7: dice que no se puede filtrar ni ordenar por la zona", () => {
    const texto = [zona.description, (props.costoEstimado as Nodo).description].join("\n");
    expect(texto).toMatch(/no se puede filtrar|se ignora/i);
  });
});

// ---------------------------------------------------------------------------------------------
// R10/R11 — `OrdenCosto`: cinco claves y NINGUNA suma
// ---------------------------------------------------------------------------------------------

describe("415/R10+R11 — `OrdenCosto` declara cinco conceptos y ningun total", () => {
  it("exactamente cinco propiedades, todas requeridas, `additionalProperties: false`", () => {
    expect(Object.keys(costo.properties as Nodo).sort()).toEqual([
      "comision",
      "flete",
      "fulfillment",
      "iva",
      "ivaComision",
    ]);
    expect([...(costo.required as string[])].sort()).toEqual([
      "comision",
      "flete",
      "fulfillment",
      "iva",
      "ivaComision",
    ]);
    expect(costo.additionalProperties).toBe(false);
  });

  it("las cinco son `string` — el dialecto money-safe, no numeros", () => {
    for (const [clave, nodo] of Object.entries(costo.properties as Nodo)) {
      expect((nodo as Nodo).type, clave).toBe("string");
    }
  });

  it("R11: NO declara `total` ni ninguna clave que suene a suma", () => {
    const claves = Object.keys(costo.properties as Nodo);
    for (const prohibida of ["total", "costoTotal", "suma", "totalCosto", "granTotal"]) {
      expect(claves, prohibida).not.toContain(prohibida);
    }
    // Y lo dice con todas las letras, para que nadie la reintroduzca «por comodidad».
    expect(costo.description as string).toMatch(/NO hay ningún campo que sume los cinco/i);
  });

  it("R12: la description declara el dialecto crudo de escala 2, sin moneda ni miles", () => {
    const d = costo.description as string;
    expect(d).toMatch(/dos decimales/i);
    expect(d).toMatch(/sin símbolo de moneda/i);
    expect(d).toMatch(/sin separador de miles/i);
  });

  it('R13: la description dice que `"0.00"` es un cero AFIRMADO, no un dato faltante', () => {
    expect(costo.description as string).toMatch(/CERO AFIRMADO/);
    expect(costo.description as string).toMatch(/nunca un dato faltante/i);
  });

  it("R15: la description dice que es el escenario de ENTREGA", () => {
    expect(costo.description as string).toMatch(/escenario de ENTREGA/);
  });
});

// ---------------------------------------------------------------------------------------------
// R2/R9 — la nullabilidad, que es la UNICA diferencia entre `zona` y `mensajero`
// ---------------------------------------------------------------------------------------------

describe("415/R2+R9 — `zona` NO admite `null`; los dos costos SI", () => {
  it("`zona` es un `$ref` pelado: sin `null` en ninguna forma", () => {
    expect(props.zona).toEqual({ $ref: "#/components/schemas/Zona" });
    expect(JSON.stringify(props.zona)).not.toContain("null");
  });

  it("`costoEstimado` y `costoReal` son `oneOf` con el schema O `null`", () => {
    for (const clave of ["costoEstimado", "costoReal"]) {
      const nodo = props[clave] as Nodo;
      expect((nodo.oneOf as Nodo[])[0], clave).toEqual({
        $ref: "#/components/schemas/OrdenCosto",
      });
      expect((nodo.oneOf as Nodo[])[1], clave).toEqual({ type: "null" });
    }
  });
});

// ---------------------------------------------------------------------------------------------
// R15/R23 — las dos frases que el humano exigio, con todas las letras
// ---------------------------------------------------------------------------------------------

describe("415/R23 — el contrato AVISA de que el estimado se mueve", () => {
  it("la description de `costoEstimado` dice que PUEDE CAMBIAR mientras `costoReal` sea null", () => {
    const d = (props.costoEstimado as Nodo).description as string;
    expect(d).toMatch(/Mientras `costoReal` sea `null`/i);
    expect(d).toMatch(/PUEDE CAMBIAR/);
    expect(d).toMatch(/se calcula con la tarifa de hoy/i);
  });

  it("y dice que su `null` NO significa envio gratis", () => {
    const d = (props.costoEstimado as Nodo).description as string;
    expect(d).toMatch(/no hay ninguna tarifa configurada/i);
    expect(d).toMatch(/NO significa que el envío sea gratis/i);
  });
});

describe("415/R15 — el contrato dice que `costoReal` NO es la linea de la wallet", () => {
  it("la description lo dice con esas palabras", () => {
    const d = (props.costoReal as Nodo).description as string;
    expect(d).toMatch(/Es lo que se congeló al cerrar/i);
    expect(d).toMatch(/NO «la línea que entró en tu wallet»/i);
  });

  it("y remite al escenario `devuelto` de la cotizacion para el rechazo", () => {
    const d = (props.costoReal as Nodo).description as string;
    expect(d).toMatch(/RECHAZADA/);
    expect(d).toMatch(/flete de DEVOLUCIÓN/i);
    expect(d).toMatch(/escenario `devuelto` de la cotización/i);
  });

  it("D6: declara el UNICO caso en que puede moverse (un segundo cierre aprobado)", () => {
    const d = (props.costoReal as Nodo).description as string;
    expect(d).toMatch(/segundo cierre aprobado/i);
    expect(d).toMatch(/MÁS RECIENTE/);
  });
});

// ---------------------------------------------------------------------------------------------
// R39 — la «zona» excluida es la del MENSAJERO
// ---------------------------------------------------------------------------------------------

describe("415/R39 — ninguna description afirma que el canal no publica ninguna zona", () => {
  it("la de `mensajero` acota la palabra «zona» a la DEL MENSAJERO, sin retirarla", () => {
    const d = (props.mensajero as Nodo).description as string;
    // La exclusion NO se retira: la palabra sigue en la lista de la description del item.
    expect(listItem.description as string).toMatch(/teléfono, email, cédula, foto, zona, vehículo/);
    // Y se acota, con la fecha.
    expect(d).toMatch(/zona DEL MENSAJERO/);
    expect(d).toMatch(/No la confundas con el campo `zona` de la orden/i);
  });

  it("la de `Zona` dice de QUE zona habla", () => {
    expect(zona.description as string).toMatch(/ZONA DE LA ORDEN/);
    expect(zona.description as string).toMatch(/NO es la zona del mensajero/i);
    expect(zona.description as string).toMatch(/NUNCA es `null`/i);
  });

  it("el escaneo de descriptions se ejecuto de verdad y no hay ninguna frase absoluta", () => {
    // Auto-comprobacion: una lista vacia dejaria el aserto de abajo verde por vacio.
    expect(DESCRIPTIONS.length).toBeGreaterThan(20);
    for (const d of DESCRIPTIONS) {
      expect(d).not.toMatch(/no publicamos la zona por ning/i);
      expect(d).not.toMatch(/este canal no publica ninguna zona/i);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// El espejo `.yaml` — estructura, no redaccion (la redaccion la revisa el humano)
// ---------------------------------------------------------------------------------------------

describe("415/R37 — el `.yaml` es espejo del `.ts` en lo estructural", () => {
  it("declara los schemas `Zona` y `OrdenCosto`", () => {
    expect(yamlTexto).toMatch(/\n {4}Zona:\n {6}type: object\n/);
    expect(yamlTexto).toMatch(/\n {4}OrdenCosto:\n {6}type: object\n/);
  });

  it("`OrdenListItem` lista las tres claves en `required` y en `properties`", () => {
    const bloque = /\n {4}OrdenListItem:\n([\s\S]*?)\n {4}Zona:/.exec(yamlTexto);
    expect(bloque, "no se encontro `OrdenListItem` en el .yaml").not.toBeNull();
    const texto = bloque![1];
    for (const clave of ["zona", "costoEstimado", "costoReal"]) {
      expect(texto, `falta \`- ${clave}\` en required`).toContain(`        - ${clave}\n`);
      expect(texto, `falta la propiedad \`${clave}\``).toContain(`        ${clave}:\n`);
    }
    expect(texto).toContain('          $ref: "#/components/schemas/Zona"');
  });

  it("`OrdenCosto` lleva las cinco claves y `additionalProperties: false`", () => {
    const bloque = /\n {4}OrdenCosto:\n([\s\S]*?)\n {4}Pagination:/.exec(yamlTexto);
    expect(bloque, "no se encontro `OrdenCosto` en el .yaml").not.toBeNull();
    const texto = bloque![1];
    for (const clave of ["flete", "iva", "comision", "ivaComision", "fulfillment"]) {
      expect(texto, `falta \`- ${clave}\``).toContain(`        - ${clave}\n`);
      expect(texto, `falta la propiedad \`${clave}\``).toContain(`        ${clave}:\n`);
    }
    expect(texto).toContain("additionalProperties: false");
    expect(texto).not.toContain("- total\n");
  });

  it("el `.yaml` lleva las DOS frases que no pueden faltar (R15/R23)", () => {
    expect(yamlTexto).toContain("Mientras `costoReal` sea `null`, este importe PUEDE CAMBIAR");
    expect(yamlTexto).toContain("NO «la línea que entró en tu wallet»");
  });

  it("el `.yaml` acota la «zona» del mensajero y no la retira (R39)", () => {
    expect(yamlTexto).toContain("teléfono, email, cédula, foto, zona, vehículo");
    expect(yamlTexto).toContain("la zona DEL MENSAJERO");
    expect(yamlTexto).not.toMatch(/no publicamos la zona por ning/i);
  });
});
