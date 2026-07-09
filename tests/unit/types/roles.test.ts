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

describe("ROLES_SEED (fuente unica de verdad) (R7, R11)", () => {
  it("tiene exactamente los cuatro valores del enum, sin duplicados (R7)", () => {
    expect(ROLES_SEED).toHaveLength(4);
    expect(new Set(ROLES_SEED).size).toBe(4);
  });

  it("se deriva del enum RolValue de Prisma (R7)", () => {
    // Sin una segunda lista literal: ROLES_SEED === Object.values(RolValue).
    expect([...ROLES_SEED].sort()).toEqual([...Object.values(RolValue)].sort());
    expect([...ROLES_SEED].sort()).toEqual(
      ["maestro", "admin", "mensajero", "adminTienda"].sort()
    );
  });

  it("el miembro adminTienda mapea al label de la DB 'Admin Tienda' via schema (R7)", () => {
    // El cliente Prisma expone el nombre del miembro; el label real de la DB se
    // declara con @map en el schema. Aqui verificamos la relacion de mapeo.
    expect(ROLES_SEED).toContain(RolValue.adminTienda);
    expect(RolValue.adminTienda).toBe("adminTienda");
  });

  it("NO incluye 'usuario' (R11)", () => {
    expect(ROLES_SEED).not.toContain("usuario");
  });
});

describe("db/schema.prisma declara el enum RolValue (R2, R3)", () => {
  const schema = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
    "utf8"
  );

  it("declara el enum RolValue con @@map(\"rol_value\") (R2)", () => {
    expect(schema).toMatch(/enum\s+RolValue\s*\{/);
    expect(schema).toMatch(/@@map\("rol_value"\)/);
  });

  it("incluye los cuatro miembros, con @map(\"Admin Tienda\") para el label con espacio (R2)", () => {
    expect(schema).toMatch(/\bmaestro\b/);
    expect(schema).toMatch(/\badmin\b/);
    expect(schema).toMatch(/\bmensajero\b/);
    expect(schema).toMatch(/adminTienda\s+@map\("Admin Tienda"\)/);
  });

  it("tipa Rol.value como RolValue @unique (R3)", () => {
    expect(schema).toMatch(/value\s+RolValue\s+@unique/);
  });
});
