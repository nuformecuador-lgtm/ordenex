import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 69/R10 — test ESTRUCTURAL: `cierre_detail` es un SNAPSHOT INMUTABLE. Ninguna
// operacion posterior a la creacion del cierre puede modificar ni borrar sus filas.
//
// Por que un test estructural y no de comportamiento: la inmutabilidad no es una funcion que
// se pueda invocar, es la AUSENCIA de escrituras. La DB no la impone (no hay trigger ni GRANT
// que lo prohiba: la tabla solo tiene RLS sin policies, y el service role la salta), y el
// modelo Prisma expone `update`/`delete` como cualquier otro. Esta red es lo unico que impide
// que una feature futura convierta el snapshot en dato vivo y reabra, en silencio, justo el
// bug money-critical que la 69 vino a cerrar.
//
// La tabla no lleva `updated_at` ni `deleted_at` (design §2.1) precisamente porque no hay
// camino de escritura despues del INSERT.

const LIB_DIR = path.join(__dirname, "..", "..", "..", "lib");

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(full));
    else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const archivos = tsFiles(LIB_DIR);

// Las 5 escrituras que romperian el snapshot. `createMany`/`create` NO estan: crear la fila
// es justo lo que `crearCierre` debe hacer (R3).
const MUTACIONES = ["update", "updateMany", "delete", "deleteMany", "upsert"] as const;

describe("Feature 69/R10 — cierre_detail es INMUTABLE", () => {
  it("ningun modulo de lib/ emite update/updateMany/delete/deleteMany/upsert sobre cierreDetail", () => {
    const infracciones: string[] = [];
    for (const file of archivos) {
      const src = fs.readFileSync(file, "utf8");
      for (const op of MUTACIONES) {
        // Cubre `prisma.cierreDetail.update(`, `tx.cierreDetail.delete(`, etc.
        const re = new RegExp(`cierreDetail\\s*\\.\\s*${op}\\s*\\(`, "g");
        if (re.test(src)) {
          infracciones.push(`${path.relative(LIB_DIR, file)}: cierreDetail.${op}()`);
        }
      }
    }
    expect(infracciones).toEqual([]);
  });

  it("el unico camino de escritura del snapshot es el createMany de crearCierre", () => {
    const conEscritura = archivos.filter((f) =>
      /cierreDetail\s*\.\s*create(Many)?\s*\(/.test(fs.readFileSync(f, "utf8")),
    );
    // Un segundo punto de escritura significaria que el snapshot se puede poblar fuera de la
    // tx de `crearCierre`, sin la resolucion de tarifa ni el grano (R2/R3/R8).
    expect(conEscritura.map((f) => path.relative(LIB_DIR, f).replace(/\\/g, "/"))).toEqual([
      "repositories/CierreDiaRepository.ts",
    ]);
  });

  it("el modelo no expone updated_at ni deleted_at (fila inmutable, design §2.1)", () => {
    const schema = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
      "utf8",
    );
    const modelo = schema.slice(
      schema.indexOf("model CierreDetail {"),
      schema.indexOf('@@map("cierre_detail")'),
    );
    expect(modelo).not.toBe("");
    // Sin los comentarios: el propio modelo DOCUMENTA que no lleva updated_at/deleted_at, y
    // buscar el nombre en la prosa daria un falso positivo. Se afirma sobre los CAMPOS.
    const campos = modelo
      .split("\n")
      .map((l) => l.split("//")[0])
      .join("\n");
    expect(campos).not.toMatch(/updatedAt|updated_at/);
    expect(campos).not.toMatch(/deletedAt|deleted_at/);
  });
});
