import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { openApiSpec } from "@/lib/api/openapi-spec";
import { MSG_CARGA_SIN_TARIFA, MSG_FILA_SIN_TARIFA } from "@/lib/services/mensajes-tarifa";

// Feature 274 (R31, y la mitad de contrato de R38) — el hueco de tarifa, PUBLICADO.
//
// Lo que esta suite vigila no es prosa bonita: es que el documento que un integrador lee deje
// de afirmar algo que el codigo ya no hace. Hasta hoy `/carga` prometia por escrito
// `costoEnvio: "0.00"` cuando la tienda no tenia tarifa vigente, y `/cotizacion` describia esa
// tolerancia como una asimetria deliberada entre las dos APIs. Las dos afirmaciones murieron
// con el criterio de lote de design §3.6: una fila sin tarifa NO se crea (ni se cotiza), y un
// lote donde NINGUNA fila que llego a resolver resolvio devuelve 409 en las DOS APIs.
//
// Por eso los asertos de ausencia (`not.toContain("0.00")`) valen tanto como los de presencia:
// una descripcion que se quede a medias —anade el 409 pero conserva el cero— es peor que no
// tocarla, porque el integrador lee dos reglas contradictorias y elige la equivocada.
//
// Y por eso el ejemplo del 409 se compara contra LA CONSTANTE importada, no contra un literal
// re-escrito aqui: un literal en el test convierte esta guardia en una copia mas de la cadena,
// que es exactamente el fallo que `lib/services/mensajes-tarifa.ts` existe para evitar. Si
// alguien corrige una errata en la constante, el contrato tiene que seguirla o ponerse rojo.

const YAML_PATH = path.join(__dirname, "..", "..", "..", "docs", "api", "api-key-openapi.yaml");
const yaml = fs.readFileSync(YAML_PATH, "utf8");
const lineasYaml = yaml.split(/\r?\n/);

const PATH_CARGA = "/api/ordenes/api-key/carga";
const PATH_COTIZACION = "/api/ordenes/api-key/cotizacion";

/** Sangria (nº de espacios) de una linea; `null` si esta en blanco. */
function indent(linea: string): number | null {
  if (linea.trim() === "") return null;
  return linea.length - linea.trimStart().length;
}

/** Lineas del bloque `  "<path>":` del yaml, sin su cabecera. */
function bloqueDePath(nombre: string): string[] {
  const inicio = lineasYaml.findIndex((l) => l === `  "${nombre}":`);
  if (inicio === -1) throw new Error(`El yaml no declara el path ${nombre}`);
  const out: string[] = [];
  for (let i = inicio + 1; i < lineasYaml.length; i++) {
    const ind = indent(lineasYaml[i]);
    if (ind !== null && ind <= 2) break;
    out.push(lineasYaml[i]);
  }
  return out;
}

/**
 * La prosa del endpoint TAL COMO SE PUBLICA en el yaml (bloque `description: |-` a sangria 6).
 *
 * Se aisla a proposito del resto del path: el `requestBody` de `/carga` trae un ejemplo con
 * `monto_cobrar: "40.00"`, asi que un `not.toContain("0.00")` sobre el path entero seria un
 * falso rojo permanente. Lo que el contrato no puede volver a decir es el CERO POR FALTA DE
 * TARIFA, y ese vive en la descripcion.
 */
function descripcionYamlDePath(nombre: string): string {
  const bloque = bloqueDePath(nombre);
  const inicio = bloque.findIndex((l) => l === "      description: |-");
  if (inicio === -1) throw new Error(`El path ${nombre} no tiene bloque description en el yaml`);
  const out: string[] = [];
  for (let i = inicio + 1; i < bloque.length; i++) {
    const ind = indent(bloque[i]);
    if (ind !== null && ind <= 6) break;
    out.push(bloque[i]);
  }
  return out.join("\n");
}

const cargaTs = openApiSpec.paths[PATH_CARGA].post as {
  description: string;
  responses: Record<string, unknown>;
};
const descripcionCargaTs = cargaTs.description;
const descripcionCargaYaml = descripcionYamlDePath(PATH_CARGA);

const descripcionCotizacionTs: string = openApiSpec.paths[PATH_COTIZACION].post.description;
const descripcionCotizacionYaml = descripcionYamlDePath(PATH_COTIZACION);

describe("274/R31 — /carga declara el 409 nuevo, en los DOS artefactos", () => {
  it("el objeto TS lista `409` entre las respuestas de la carga", () => {
    expect(Object.keys(cargaTs.responses)).toContain("409");
  });

  it("el ejemplo del 409 es LA CONSTANTE `MSG_CARGA_SIN_TARIFA`, no un literal re-escrito", () => {
    const respuesta409 = cargaTs.responses["409"] as {
      description: string;
      content: { "application/json": { example: { status: string; code: string; message: string } } };
    };
    const ejemplo = respuesta409.content["application/json"].example;
    // Identidad con la constante: si la cadena del service cambia y el contrato no, esto cae.
    expect(ejemplo.message).toBe(MSG_CARGA_SIN_TARIFA);
    expect(ejemplo.code).toBe("CONFLICT");
    expect(ejemplo.status).toBe("error");
    // El 409 se describe por su CAUSA REAL (criterio de lote), no como «la tienda no tiene
    // tarifa»: ese diagnostico es justo el que design §3.6 declara falso.
    expect(respuesta409.description).toMatch(/[Nn]inguna/);
    expect(respuesta409.description).not.toMatch(/La tienda dueña de la key no tiene una tarifa/);
  });

  it("el .yaml publica el MISMO 409 con la MISMA cadena: el espejo no puede quedarse corto", () => {
    const bloque = bloqueDePath(PATH_CARGA);
    expect(bloque).toContain('        "409":');
    expect(bloque.map((l) => l.trim())).toContain(`message: "${MSG_CARGA_SIN_TARIFA}"`);
  });

  it("la descripción de /carga ya NO contiene la cadena `0.00`", () => {
    // El cero por falta de tarifa era una promesa de dinero. Ya no se emite: si vuelve al
    // documento, vuelve la contradiccion entre lo publicado y lo que la API hace.
    expect(descripcionCargaTs).not.toContain("0.00");
    expect(descripcionCargaYaml).not.toContain("0.00");
  });

  it("la descripción de /carga explica el 409 y la distinción con el lote que no llegó a resolver", () => {
    for (const descripcion of [descripcionCargaTs, descripcionCargaYaml]) {
      expect(descripcion).toContain("409");
      // R30: un lote entero sin cobertura geografica NO es un 409. Sin esta linea, el
      // integrador diagnostica «me falta tarifa» cuando lo que le falta es geografia.
      expect(descripcion).toMatch(/validación, duplicidad o cobertura geográfica/);
      expect(descripcion).toMatch(/sigue\s+siendo `200`/);
    }
  });
});

describe("274/R38 (mitad de contrato) — la fila en error se publica con la clave `tarifa`", () => {
  it("las descripciones de las DOS APIs citan la clave y el literal de la constante", () => {
    for (const descripcion of [
      descripcionCargaTs,
      descripcionCargaYaml,
      descripcionCotizacionTs,
      descripcionCotizacionYaml,
    ]) {
      expect(descripcion).toContain('"tarifa"');
      expect(descripcion).toContain(MSG_FILA_SIN_TARIFA);
    }
  });

  it("el ejemplo publicado de /carga muestra una fila degradada con `errores.tarifa`", () => {
    const ejemplo = (
      openApiSpec.paths[PATH_CARGA].post.responses["200"].content["application/json"].examples as {
        filaSinTarifa: {
          value: { filas: ReadonlyArray<{ readonly errores?: Record<string, string[]> }> };
        };
      }
    ).filaSinTarifa.value;
    const enError = ejemplo.filas.find((f) => f.errores);
    expect(enError?.errores).toEqual({ tarifa: [MSG_FILA_SIN_TARIFA] });
    // El espejo publica el mismo literal.
    expect(yaml).toContain(`- "${MSG_FILA_SIN_TARIFA}"`);
  });
});

describe("274/R31 — /cotizacion deja de declarar una asimetría que ya no existe", () => {
  it("su descripción ya NO contiene la cadena `costoEnvio: \"0.00\"`", () => {
    expect(descripcionCotizacionTs).not.toContain('costoEnvio: "0.00"');
    expect(descripcionCotizacionYaml).not.toContain('costoEnvio: "0.00"');
    // Ni el cero suelto: la frase entera se fue, no solo el nombre del campo.
    expect(descripcionCotizacionTs).not.toContain("0.00");
    expect(descripcionCotizacionYaml).not.toContain("0.00");
  });

  it("su descripción ya NO describe el 409 como «la tienda no tiene tarifa vigente»", () => {
    for (const descripcion of [descripcionCotizacionTs, descripcionCotizacionYaml]) {
      expect(descripcion).not.toMatch(
        /Si la tienda dueña de la key no tiene una tarifa vigente, la respuesta es \*\*409\*\*/,
      );
      expect(descripcion).toMatch(/NINGUNA de las filas que llegan a la\s+resolución de tarifa/);
    }
  });

  it("el párrafo de `totales` declara el SEGUNDO motivo de exclusión", () => {
    for (const descripcion of [descripcionCotizacionTs, descripcionCotizacionYaml]) {
      expect(descripcion).toMatch(/DOS motivos distintos/);
      expect(descripcion).toMatch(/no resuelve tarifa vigente/);
      // El coste declarado, escrito donde lo lee quien paga: sumar `totales` sin mirar
      // `filasExcluidas` da un numero que no es el precio del lote.
      expect(descripcion).toMatch(/sin mirar\s+`filasExcluidas`/);
    }
  });
});
