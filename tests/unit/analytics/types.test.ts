import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  DIMENSIONES,
  MENSAJERO_SIN_ASIGNAR,
  RANGO_PRESETS,
  RANGO_TOPE_DIAS,
  ROLES_ANALITICA,
} from "@/lib/analytics/types";
import type { RolAnalitica } from "@/lib/analytics/types";
import { quitarComentarios } from "../../fixtures/sin-comentarios";

// Feature 135 / T1.2 — consistencia entre `RolAnalitica` (lib/analytics/types.ts) y
// el enum `RolValue` del esquema. `types.ts` declara los roles como union literal
// propia para NO arrastrar `@prisma/client` en runtime (R1), asi que el vinculo con
// el esquema no lo garantiza el compilador: lo garantiza este test, que lee
// `db/schema.prisma` en crudo. Si alguien renombra un rol ahi, esto cae.
// Se lee el .prisma (no el cliente generado) a proposito: el cliente puede estar
// desactualizado o sin generar, y la fuente de verdad es el esquema versionado.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const SCHEMA_PATH = path.join(REPO_ROOT, "db", "schema.prisma");

function leerEnumDelEsquema(nombre: string): string[] {
  const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
  const bloque = new RegExp(`enum ${nombre} \\{([\\s\\S]*?)\\n\\}`).exec(schema);
  if (!bloque) throw new Error(`No se encontro el enum ${nombre} en db/schema.prisma`);
  return quitarComentarios(bloque[1])
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => linea.length > 0 && !linea.startsWith("@@"))
    .map((linea) => linea.split(/\s+/)[0]);
}

describe("lib/analytics/types · roles de analitica (R7)", () => {
  it("los cinco roles de analitica existen en RolValue del esquema", () => {
    const rolValue = leerEnumDelEsquema("RolValue");
    for (const rol of ROLES_ANALITICA) {
      expect(rolValue, `RolValue del esquema no declara "${rol}"`).toContain(rol);
    }
  });

  it("declara exactamente cinco roles lectores, sin duplicados", () => {
    expect(ROLES_ANALITICA).toHaveLength(5);
    expect(new Set(ROLES_ANALITICA).size).toBe(5);
    expect([...ROLES_ANALITICA].sort()).toEqual(
      ["admin", "adminSatelite", "adminTienda", "maestro", "mensajero"].sort(),
    );
  });

  it("no incluye apiKey, que es una cuenta de integracion y no un lector de tableros", () => {
    const apiKey = ["api", "Key"].join("");
    expect(leerEnumDelEsquema("RolValue")).toContain(apiKey);
    expect(ROLES_ANALITICA as readonly string[]).not.toContain(apiKey);
  });

  it("deja fuera de RolAnalitica exactamente un valor de RolValue: el de integracion", () => {
    const rolValue = leerEnumDelEsquema("RolValue");
    const fuera = rolValue.filter((v) => !(ROLES_ANALITICA as readonly string[]).includes(v));
    expect(fuera).toEqual([["api", "Key"].join("")]);
  });

  it("cada literal de RolAnalitica es un valor del esquema tambien en tipos", () => {
    // Si alguien anade un rol a ROLES_ANALITICA sin tocar el esquema, el test de
    // arriba cae; esta asercion cubre el sentido inverso a nivel de tipo.
    const porRol: Record<RolAnalitica, true> = {
      maestro: true,
      admin: true,
      adminSatelite: true,
      adminTienda: true,
      mensajero: true,
    };
    expect(Object.keys(porRol).sort()).toEqual([...ROLES_ANALITICA].sort());
  });
});

describe("lib/analytics/types · dominios cerrados del contrato", () => {
  it("declara los siete granos legales de agregacion", () => {
    expect([...DIMENSIONES]).toEqual([
      "fecha",
      "zona",
      "tienda",
      "mensajero",
      "estatus",
      "metodo_pago",
      "causa_devolucion",
    ]);
  });

  it("declara los cuatro rangos incluido el personalizado", () => {
    expect([...RANGO_PRESETS]).toEqual(["dia", "semana", "mes", "personalizado"]);
  });

  it("expone el cubo sin_asignar y el tope de dias como constantes unicas", () => {
    expect(MENSAJERO_SIN_ASIGNAR).toBe("sin_asignar");
    expect(RANGO_TOPE_DIAS).toBe(366);
  });
});
