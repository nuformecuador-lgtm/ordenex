import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 179 / T2.3 — GUARDIA DE R3: EL CONTRATO FINANCIERO ES JSON-SAFE, POR LECTURA ESTATICA.
//
// ⚠ ESTE GUARDIA **SOBREVIVE AL MERGE**: censa el CONTENIDO de un archivo de tipos, no el diff
// contra `dev`. Sigue vigente para siempre.
//
// ⚠ POR QUE EXISTE, dicho sin cautela abstracta. La 128 no necesitaba esto porque su fallo era
// RUIDOSO: `CuboRollup.segCicloAcum` es `bigint` y `JSON.stringify` **lanza** `TypeError: Do not
// know how to serialize a BigInt`. Aqui **NADA LANZA**. `ResultadoFinanciero` es JSON-safe hoy —
// todo importe es `string` escala 2 y el unico `number` es el CONTEO de cierres—, y el dia que
// alguien anada un campo `Date` el viaje por JSON lo convertira en `string`, la vista seguira
// pintando y el fallo sera MUDO.
//
// El guardia falla ANTES que el round-trip (que tambien lo caza, en
// `cache-financiera-json.test.ts`): al escribir el tipo, no al ejercitarlo con un fixture que
// quiza no llene ese campo.
//
// Lo que NO puede: juzgar un tipo importado de otro archivo que a su vez esconda un `Date`. Por
// eso la lista de prohibidos incluye tambien el nombre de los constructores, que es como
// aparecerian escritos.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const CONTRATO = "lib/types/analitica-financiera.ts";

/** El codigo sin comentarios: la PROSA que explica una prohibicion no la infringe. */
function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

/**
 * Los tipos que NO sobreviven a `JSON.stringify` → `JSON.parse` sin cambiar de tipo, cada uno
 * con lo que le pasa. El mensaje forma parte del guardia: uno que solo diga «rojo» se desarma a
 * la primera.
 */
const PROHIBIDOS: readonly { readonly patron: RegExp; readonly consecuencia: string }[] = [
  { patron: /\bDate\b/, consecuencia: "`Date` vuelve como `string` y NO lanza: el fallo es mudo" },
  { patron: /\bbigint\b/, consecuencia: "`bigint` hace LANZAR a `JSON.stringify`" },
  { patron: /\bMap\s*</, consecuencia: "un `Map` vuelve como `{}` y la dimension se queda vacia" },
  { patron: /\bSet\s*</, consecuencia: "un `Set` vuelve como `{}`" },
  { patron: /\bDecimal\b/, consecuencia: "un `Prisma.Decimal` vuelve como objeto, no como cifra" },
  {
    patron: /\bReadonlyMap\s*</,
    consecuencia: "un `ReadonlyMap` vuelve como `{}` (es el caso de R4 de la 128)",
  },
];

describe("R3 · ningun campo del contrato `ResultadoFinanciero` es de un tipo que no sobreviva a JSON", () => {
  const codigo = soloCodigo(fs.readFileSync(path.join(REPO_ROOT, CONTRATO), "utf8"));

  it("el archivo del contrato existe y tiene contenido: si no, seria verde por vacio", () => {
    expect(codigo.length).toBeGreaterThan(500);
    expect(codigo).toMatch(/export type ResultadoFinanciero\b/);
  });

  for (const { patron, consecuencia } of PROHIBIDOS) {
    it(`no aparece ${patron.source} en el codigo del contrato`, () => {
      expect(
        patron.test(codigo),
        `${CONTRATO} declara un campo de un tipo que no sobrevive al viaje por JSON: ` +
          `${consecuencia}. La cache financiera guarda el DTO TAL CUAL, sin codec (design §1.3), ` +
          "porque hoy es JSON-safe de punta a punta. Si el contrato necesita ese tipo, esta " +
          "feature necesita un codec — y esa decision se toma aqui, no se descubre en un tablero.",
      ).toBe(false);
    });
  }

  it("tampoco hay campos OPCIONALES: `undefined` no viaja y «ausente» no es un valor", () => {
    // Un `campo?: string` desaparece del JSON. Si ademas significara algo —«no se sabe» frente a
    // «no aplica»—, el DTO servido desde cache y el servido en frio diferirian en la FORMA. El
    // contrato ya evita el opcional por otra razon (R23 de la 132: un ausente significa «no se
    // sabe»), y aqui se ata tambien por este lado.
    const opcionales = codigo.match(/^\s*(readonly\s+)?\w+\?\s*:/gm) ?? [];
    expect(
      opcionales,
      "el contrato financiero declara campos opcionales. Ver `ImporteSoloBruto`: la forma de " +
        "expresar «no aplica» en este contrato es OTRA CLASE de importe (union discriminada), no " +
        "un campo que a veces no esta. Campos: " + opcionales.join(", "),
    ).toEqual([]);
  });

  it("el censo DISCRIMINA: un contrato con `corteAt: Date` se pondria rojo", () => {
    const infractor = soloCodigo(`
      // aqui se habla de Date en prosa y eso no cuenta
      export interface CabeceraFinanciera { readonly corteAt: Date; }
    `);
    expect(PROHIBIDOS.some(({ patron }) => patron.test(infractor))).toBe(true);

    const inocente = soloCodigo(`
      // un comentario que menciona Date, bigint y Map<string, string>
      export interface X { readonly bruto: string; readonly cantidad: number; }
    `);
    expect(PROHIBIDOS.some(({ patron }) => patron.test(inocente))).toBe(false);
  });
});
