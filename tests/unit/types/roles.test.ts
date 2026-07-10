import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { RolValue } from "@prisma/client";
import { ROLES_SEED } from "@/lib/types/roles";

// Cobertura de la fuente unica de verdad de roles (`lib/types/roles.ts`) y de la
// declaracion del enum en `db/schema.prisma`. El label de la DB 'Admin Tienda'
// se verifica sobre el schema (fuente real del enum de Postgres); el cliente
// Prisma expone el NOMBRE del miembro (`adminTienda`), que es el valor que el
// seed pasa a `rol.upsert` y que Prisma traduce al label 'Admin Tienda'.
// Feature 19: 5.o rol `adminSatelite` (sin @map; label DB = slug camelCase).

describe("ROLES_SEED (fuente unica de verdad) (R7, R11, R1, R2, R6)", () => {
  it("tiene exactamente los cinco valores del enum, sin duplicados (R7, R2)", () => {
    expect(ROLES_SEED).toHaveLength(5);
    expect(new Set(ROLES_SEED).size).toBe(5);
  });

  it("se deriva del enum RolValue de Prisma (R7, R6)", () => {
    // Sin una segunda lista literal: ROLES_SEED === Object.values(RolValue).
    expect([...ROLES_SEED].sort()).toEqual([...Object.values(RolValue)].sort());
    expect([...ROLES_SEED].sort()).toEqual(
      ["maestro", "admin", "mensajero", "adminTienda", "adminSatelite"].sort()
    );
  });

  it("el miembro adminTienda mapea al label de la DB 'Admin Tienda' via schema (R7)", () => {
    // El cliente Prisma expone el nombre del miembro; el label real de la DB se
    // declara con @map en el schema. Aqui verificamos la relacion de mapeo.
    expect(ROLES_SEED).toContain(RolValue.adminTienda);
    expect(RolValue.adminTienda).toBe("adminTienda");
  });

  it("incluye el 5.o rol adminSatelite, cuyo nombre de miembro es igual al label DB (R1, R6)", () => {
    expect(ROLES_SEED).toContain(RolValue.adminSatelite);
    expect(RolValue.adminSatelite).toBe("adminSatelite");
  });

  it("NO incluye 'usuario' (R11)", () => {
    expect(ROLES_SEED).not.toContain("usuario");
  });
});

describe("db/schema.prisma declara el enum RolValue (R2, R3, R1)", () => {
  const schema = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
    "utf8"
  );

  it("declara el enum RolValue con @@map(\"rol_value\") (R2)", () => {
    expect(schema).toMatch(/enum\s+RolValue\s*\{/);
    expect(schema).toMatch(/@@map\("rol_value"\)/);
  });

  it("incluye los cuatro miembros previos, con @map(\"Admin Tienda\") para el label con espacio (R2)", () => {
    expect(schema).toMatch(/\bmaestro\b/);
    expect(schema).toMatch(/\badmin\b/);
    expect(schema).toMatch(/\bmensajero\b/);
    expect(schema).toMatch(/adminTienda\s+@map\("Admin Tienda"\)/);
  });

  it("declara el enum RolValue con exactamente 5 miembros (R2)", () => {
    const match = schema.match(/enum\s+RolValue\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    const body = match ? match[1] : "";
    const miembros = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("@@"))
      .map((l) => l.split(/\s|\/\//)[0]);
    expect(miembros).toHaveLength(5);
    expect(miembros).toEqual(
      expect.arrayContaining([
        "maestro",
        "admin",
        "mensajero",
        "adminTienda",
        "adminSatelite",
      ])
    );
  });

  it("declara adminSatelite SIN @map (label DB = slug camelCase) (R1)", () => {
    expect(schema).toMatch(/\badminSatelite\b/);
    // No debe existir "adminSatelite" seguido de "@map" en la misma linea.
    expect(schema).not.toMatch(/adminSatelite\s+@map/);
  });

  it("tipa Rol.value como RolValue @unique (R3)", () => {
    expect(schema).toMatch(/value\s+RolValue\s+@unique/);
  });
});
