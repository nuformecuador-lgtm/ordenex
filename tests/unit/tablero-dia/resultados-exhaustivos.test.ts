import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { CONTADOR_POR_RESULTADO } from "@/lib/repositories/TableroDiaRepository";
import { quitarComentarios } from "../../fixtures/sin-comentarios";

// Feature 192 (B3.5) — R24, R27.
//
// `gestion_resultado` tiene HOY cinco valores, y ya gano uno (la 158 añadio `incidente`). Si
// gana un sexto y esta feature no se entera, ese resultado no desaparece de la pantalla: cae
// en el cubo de "sin resultado" y aparece como trabajo NO hecho de un mensajero que si lo
// hizo. R27 exige que eso salga en ROJO, no en silencio.
//
// Dos frentes, porque uno solo no basta:
//   1. `satisfies Record<GestionResultado, ...>` en el mapa: un valor nuevo del enum no
//      COMPILA. Es la defensa fuerte, pero solo actua si alguien regenera el cliente Prisma.
//   2. INVENTARIO CONGELADO del enum leido del `schema.prisma`: un `ALTER TYPE ... ADD VALUE`
//      en una migracion deja este test rojo aunque nadie haya tocado TypeScript.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

/** Los cinco valores tal y como se aprobo esta feature (2026-08-08). Es la foto, no la fuente. */
const RESULTADOS_CONGELADOS = [
  "entregada",
  "reprogramada",
  "devuelta",
  "rechazada",
  "incidente",
] as const;

function valuesDelEnumEnElEsquema(): string[] {
  const schema = fs.readFileSync(path.join(REPO_ROOT, "db", "schema.prisma"), "utf8");
  const bloque = /enum GestionResultado \{([\s\S]*?)\n\}/.exec(schema);
  if (bloque === null) throw new Error("no se encontro `enum GestionResultado` en schema.prisma");
  return quitarComentarios(bloque[1])
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => linea.length > 0 && !linea.startsWith("@@"));
}

describe("los cinco resultados del dia", () => {
  it("hay un contador por CADA valor del enum, y ninguno de mas (R24)", () => {
    expect(Object.keys(CONTADOR_POR_RESULTADO).sort()).toEqual([...RESULTADOS_CONGELADOS].sort());
    expect(Object.values(CONTADOR_POR_RESULTADO)).toEqual([
      "entregadas",
      "reprogramadas",
      "devueltas",
      "rechazadas",
      "incidentes",
    ]);
  });

  it("el enum del esquema no ha ganado, perdido ni renombrado ningun valor (R27)", () => {
    // Si esto se pone rojo NO se actualiza la lista y ya: hay que decidir en que columna del
    // tablero entra el valor nuevo. Absorberlo en "sin resultado" es exactamente lo que R27
    // prohibe.
    expect(valuesDelEnumEnElEsquema()).toEqual([...RESULTADOS_CONGELADOS]);
  });

  it("cada contador es un campo real de la tarjeta, no un nombre suelto", () => {
    const camposDeLaTarjeta = [
      "entregadas",
      "reprogramadas",
      "devueltas",
      "rechazadas",
      "incidentes",
      "sinRecoger",
      "enReparto",
      "otros",
      "asignadas",
    ];
    for (const columna of Object.values(CONTADOR_POR_RESULTADO)) {
      expect(camposDeLaTarjeta).toContain(columna);
    }
  });

  it("los cinco contadores de resultado son DISTINTOS entre si", () => {
    const columnas = Object.values(CONTADOR_POR_RESULTADO);
    expect(new Set(columnas).size).toBe(columnas.length);
  });
});
