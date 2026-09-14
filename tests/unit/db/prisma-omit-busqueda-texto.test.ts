import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { PRISMA_OMIT } from "@/lib/db/prisma-client";

// Feature 169 / T1.8 (R28) — la columna generada del buscador NO puede llegar a ninguna
// respuesta. La garantia es de EJECUCION y se demuestra contra Postgres real en
// `tests/integration/db/busqueda-sincronizacion-columna.test.ts` ("una lectura normal NO
// trae la columna"); este archivo cubre lo que aquel se salta cuando no hay base: que el
// `omit` siga declarado y siga CABLEADO al cliente real.
//
// Se comprueba tambien por texto porque `PRISMA_OMIT` podria quedar exportado y sin uso:
// un `omit` que existe pero no se pasa al constructor no protege de nada.

const ROOT = path.join(__dirname, "..", "..", "..");
const fuente = fs.readFileSync(path.join(ROOT, "lib", "db", "prisma-client.ts"), "utf8");

// FICHA 423 (T2.4, R16) — el `omit` pasa a tener DOS columnas: entra `orden.clave_remision`,
// la clave GENERADA que ordena el listado por numero de remision. El literal de abajo se
// AMPLIA, no se deriva: es el CONTRATO de que exactamente estas dos columnas —y ninguna
// tercera— no salen nunca de la base. Sustituirlo por `Object.keys(...)` de su propia fuente lo
// dejaria verde para siempre (memoria del repo: «Aserción contra su propia fuente»).
describe("omit global de `orden.busqueda_texto` (R28) y `orden.clave_remision` (423/R16)", () => {
  it("declara las dos columnas generadas como omitidas", () => {
    expect(PRISMA_OMIT).toEqual({ orden: { busquedaTexto: true, claveRemision: true } });
  });

  it("no omite ninguna otra columna de orden (no es un filtro de proyeccion general)", () => {
    expect(Object.keys(PRISMA_OMIT.orden)).toEqual(["busquedaTexto", "claveRemision"]);
  });

  it("no omite nada de ningun otro modelo", () => {
    expect(Object.keys(PRISMA_OMIT)).toEqual(["orden"]);
  });

  it("el cliente singleton se construye CON ese omit", () => {
    // Sin esta linea, `PRISMA_OMIT` seria una constante decorativa y la PII de la columna
    // viajaria en cada `findMany` sin `select`.
    expect(fuente).toMatch(/new PrismaClient\(\{[\s\S]*?omit: PRISMA_OMIT,[\s\S]*?\}\)/);
  });
});
