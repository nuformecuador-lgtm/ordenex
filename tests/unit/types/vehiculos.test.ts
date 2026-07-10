import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { VehiculoValue } from "@prisma/client";
import { VEHICULOS_SEED } from "@/lib/types/vehiculos";

// Cobertura de la fuente unica de verdad de vehiculos (`lib/types/vehiculos.ts`)
// y de la declaracion del enum/modelo en `db/schema.prisma`. Patron
// roles.test.ts. Diferencia clave deliberada: la columna es `name` (NO `value`).

describe("VEHICULOS_SEED (fuente unica de verdad) (R6)", () => {
  it("tiene exactamente los tres valores del enum, sin duplicados (R6)", () => {
    expect(VEHICULOS_SEED).toHaveLength(3);
    expect(new Set(VEHICULOS_SEED).size).toBe(3);
  });

  it("se deriva del enum VehiculoValue de Prisma (R6)", () => {
    // Sin una segunda lista literal: VEHICULOS_SEED === Object.values(VehiculoValue).
    expect([...VEHICULOS_SEED].sort()).toEqual([...Object.values(VehiculoValue)].sort());
    expect([...VEHICULOS_SEED].sort()).toEqual(["camion", "carro", "moto"]);
  });

  it("los nombres de miembro coinciden con el label de la DB (sin @map) (R1)", () => {
    expect(VehiculoValue.moto).toBe("moto");
    expect(VehiculoValue.carro).toBe("carro");
    expect(VehiculoValue.camion).toBe("camion");
  });
});

describe("db/schema.prisma declara el enum VehiculoValue (R1)", () => {
  const schema = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
    "utf8"
  );

  it('declara el enum VehiculoValue con @@map("vehiculo_value") (R1)', () => {
    expect(schema).toMatch(/enum\s+VehiculoValue\s*\{/);
    expect(schema).toMatch(/@@map\("vehiculo_value"\)/);
  });

  it("declara el enum con exactamente 3 miembros moto/carro/camion, sin @map (R1)", () => {
    const match = schema.match(/enum\s+VehiculoValue\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    const body = match ? match[1] : "";
    const miembros = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("@@"))
      .map((l) => l.split(/\s|\/\//)[0]);
    expect(miembros).toEqual(["moto", "carro", "camion"]);
    // Ningun miembro lleva @map (los identificadores == label DB). El @@map del
    // enum NO cuenta: [^@]@map excluye el doble arroba de "@@map".
    expect(body).not.toMatch(/[^@]@map\(/);
  });
});

describe("db/schema.prisma declara el modelo Vehiculo con columna name (R2, R13)", () => {
  const schema = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
    "utf8"
  );

  it('mapea el modelo Vehiculo a la tabla "vehiculos" (R2)', () => {
    expect(schema).toMatch(/model\s+Vehiculo\s*\{/);
    expect(schema).toMatch(/@@map\("vehiculos"\)/);
  });

  it("la columna de valor se llama name VehiculoValue @unique (NO value) (R2)", () => {
    expect(schema).toMatch(/name\s+VehiculoValue\s+@unique/);
    const match = schema.match(/model\s+Vehiculo\s*\{([\s\S]*?)\}/);
    const body = match ? match[1] : "";
    expect(body).not.toMatch(/\bvalue\b/);
  });

  it("id es String @id @default(uuid()) -> PK uuid estable para el FK feature 21 (R13)", () => {
    const match = schema.match(/model\s+Vehiculo\s*\{([\s\S]*?)\}/);
    const body = match ? match[1] : "";
    expect(body).toMatch(/id\s+String\s+@id\s+@default\(uuid\(\)\)/);
  });

  it("el modelo Usuario gana vehiculo_id en la feature 21, no en la 50 (R13)", () => {
    // Feature 50 dejo el id de Vehiculo listo como PK estable pero NO cableo el
    // FK usuario.vehiculo_id (deferido explicitamente). La feature 21
    // (postulacion de mensajero) lo agrega; este guard se actualizo en
    // consecuencia: el FK ahora vive en el schema, aportado por la 21.
    const match = schema.match(/model\s+Usuario\s*\{([\s\S]*?)\n\}/);
    const body = match ? match[1] : "";
    expect(body).toMatch(/vehiculoId\s+String\?\s+@map\("vehiculo_id"\)/);
  });
});
