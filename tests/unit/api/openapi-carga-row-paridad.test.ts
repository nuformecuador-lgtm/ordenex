import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { openApiSpec } from "@/lib/api/openapi-spec";

// Feature 159 (R10, R11) — paridad del schema `CargaRow` entre la FUENTE DE VERDAD
// (`lib/api/openapi-spec.ts`) y su ESPEJO publicado (`docs/api/api-key-openapi.yaml`).
//
// El .yaml es un archivo de texto: nada mas lo mantiene sincronizado con el objeto TS.
// El test hermano `openapi-contrato-en-reparto.test.ts` cubre esa paridad SOLO para los
// enums de estado; este cubre las PROPIEDADES de `CargaRow`, que es donde vivia
// `mensajero_sugerido_id`.
//
// R10 quedo INCUMPLIDO en su forma original ("declararla `deprecated`"): la propiedad se
// borro de los dos artefactos sin pasar por la marca previa. Ya no tiene arreglo
// retroactivo (ver `progress/impl_159_cierre.md`). Lo que este test SI blinda es el
// sustituto que `design.md §4` fija para la opcion (a): la propiedad no esta en ninguno
// de los dos, y ambos siguen diciendo exactamente lo mismo.

const YAML_PATH = path.join(__dirname, "..", "..", "..", "docs", "api", "api-key-openapi.yaml");
const yaml = fs.readFileSync(YAML_PATH, "utf8");

const CARGA_ROW = openApiSpec.components.schemas.CargaRow;

/** Sangria (nº de espacios) de una linea; `null` si esta en blanco. */
function indent(linea: string): number | null {
  if (linea.trim() === "") return null;
  return linea.length - linea.trimStart().length;
}

/** Lineas del bloque `    <nombre>:` de `components.schemas`, sin su cabecera. */
function bloqueDeSchema(nombre: string): string[] {
  const lineas = yaml.split(/\r?\n/);
  const inicio = lineas.findIndex((l) => l === `    ${nombre}:`);
  if (inicio === -1) throw new Error(`El yaml no declara el schema ${nombre}`);
  const out: string[] = [];
  for (let i = inicio + 1; i < lineas.length; i++) {
    const ind = indent(lineas[i]);
    if (ind !== null && ind <= 4) break;
    out.push(lineas[i]);
  }
  return out;
}

/** Lineas de una clave anidada del bloque (p. ej. `properties:` a sangria 6). */
function subBloque(bloque: string[], clave: string, sangria: number): string[] {
  const inicio = bloque.findIndex((l) => l === `${" ".repeat(sangria)}${clave}:`);
  if (inicio === -1) throw new Error(`El bloque no declara ${clave}`);
  const out: string[] = [];
  for (let i = inicio + 1; i < bloque.length; i++) {
    const ind = indent(bloque[i]);
    if (ind !== null && ind <= sangria) break;
    out.push(bloque[i]);
  }
  return out;
}

const bloqueCargaRow = bloqueDeSchema("CargaRow");
const bloqueProps = subBloque(bloqueCargaRow, "properties", 6);

/** Nombres de propiedad del yaml, en orden de declaracion. */
const propsYaml = bloqueProps
  .filter((l) => indent(l) === 8)
  .map((l) => l.trim().replace(/:$/, ""));

/** Lineas de UNA propiedad concreta del yaml. */
function lineasDePropiedad(nombre: string): string[] {
  return subBloque(bloqueProps, nombre, 8);
}

/** `required` del yaml, en orden. */
const requiredYaml = subBloque(bloqueCargaRow, "required", 6)
  .filter((l) => /^\s*-\s+/.test(l))
  .map((l) => l.replace(/^\s*-\s+/, "").trim());

describe("159/R11 — CargaRow: el yaml publicado es espejo EXACTO del objeto TS", () => {
  it("declara las MISMAS propiedades, en el mismo orden", () => {
    expect(propsYaml).toEqual(Object.keys(CARGA_ROW.properties));
  });

  it("declara el mismo `required`, en el mismo orden", () => {
    expect(requiredYaml).toEqual([...CARGA_ROW.required]);
  });

  it("cada propiedad tiene el mismo `type` en ambos artefactos", () => {
    for (const [nombre, definicion] of Object.entries(CARGA_ROW.properties)) {
      const lineas = lineasDePropiedad(nombre).map((l) => l.trim());
      expect(lineas).toContain(`type: ${(definicion as { type: string }).type}`);
    }
  });

  it("ninguna propiedad esta marcada `deprecated` en uno y no en el otro", () => {
    for (const nombre of Object.keys(CARGA_ROW.properties)) {
      const definicion = CARGA_ROW.properties[nombre as keyof typeof CARGA_ROW.properties] as {
        deprecated?: boolean;
      };
      const enYaml = lineasDePropiedad(nombre).some((l) => /^\s*deprecated:\s*true\s*$/.test(l));
      expect(enYaml).toBe(definicion.deprecated === true);
    }
  });

  it("ambos conservan `additionalProperties: { type: string }`", () => {
    expect(CARGA_ROW.additionalProperties).toEqual({ type: "string" });
    const adicionales = subBloque(bloqueCargaRow, "additionalProperties", 6).map((l) => l.trim());
    expect(adicionales).toContain("type: string");
  });
});

describe("159/R10 (sustituido, design §4 opcion a) — la propiedad retirada no esta en ninguno", () => {
  const RETIRADA = "mensajero_sugerido_id";

  it("el objeto TS no la declara en `CargaRow`", () => {
    expect(Object.keys(CARGA_ROW.properties)).not.toContain(RETIRADA);
    expect([...CARGA_ROW.required]).not.toContain(RETIRADA);
  });

  it("el yaml no la declara en `CargaRow`", () => {
    expect(propsYaml).not.toContain(RETIRADA);
    expect(requiredYaml).not.toContain(RETIRADA);
  });

  it("`additionalProperties` sigue permitiendola: enviarla NO es un breaking change", () => {
    // El ancla de la 143 (`filaCargaSchema` no es `.strict()`) mas este
    // `additionalProperties` son lo que hace que un integrador que aun mande la
    // clave siga recibiendo 2xx. Quitarlo SI seria romper el contrato.
    expect(CARGA_ROW.additionalProperties).toEqual({ type: "string" });
  });
});
