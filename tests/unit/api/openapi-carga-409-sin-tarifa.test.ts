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

// ⏳ 2026-09-01 — AQUI VIVIA `descripcionYamlDePath`, y con ella la mitad de este archivo: las
// comprobaciones sobre la PROSA de `/carga` y `/cotizacion` (que ya no prometen un `0.00` por
// falta de tarifa, que explican el 409 y sus DOS motivos). Las descripciones de nivel operacion
// se retiraron del contrato por peticion explicita, en los dos artefactos, asi que no queda texto
// publicado que medir. Lo que SI se conserva —y es lo que de verdad consume un integrador— son las
// respuestas, los ejemplos y los literales de las constantes.
const cargaTs = openApiSpec.paths[PATH_CARGA].post as {
  responses: Record<string, unknown>;
};

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

});

describe("274/R38 (mitad de contrato) — la fila en error se publica con la clave `tarifa`", () => {
  // 2026-08-31: la fila degradada ya no vive en `filas`, sino en la lista hermana `errores`.
  // Lo que esta guardia mide no cambia: el ejemplo PUBLICADO tiene que enseñar la clave
  // `tarifa` con el literal de la constante, no con una copia re-escrita.
  it("el ejemplo publicado de /carga muestra una fila degradada con `errores.tarifa`", () => {
    const ejemplo = (
      openApiSpec.paths[PATH_CARGA].post.responses["200"].content["application/json"].examples as {
        filaSinTarifa: {
          value: {
            filas: ReadonlyArray<{ readonly errores?: Readonly<Record<string, readonly string[]>> }>;
            errores: ReadonlyArray<{
              readonly errores?: Readonly<Record<string, readonly string[]>>;
            }>;
          };
        };
      }
    ).filaSinTarifa.value;
    // Y la enseña APARTE: ninguna fila de `filas` trae ya el mapa de errores.
    expect(ejemplo.filas.find((f) => f.errores)).toBeUndefined();
    const enError = ejemplo.errores.find((f) => f.errores);
    expect(enError?.errores).toEqual({ tarifa: [MSG_FILA_SIN_TARIFA] });
    // El espejo publica el mismo literal.
    expect(yaml).toContain(`- "${MSG_FILA_SIN_TARIFA}"`);
  });
});

// ⏳ 2026-09-01 — AQUI VIVIA el describe «274/R31 — /cotizacion deja de declarar una asimetría que
// ya no existe», tres tests sobre la prosa de `/cotizacion`. Se fue con las descripciones de nivel
// operacion (ver la nota de arriba): no queda documento que contradecir.
