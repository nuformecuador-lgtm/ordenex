import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { PRISMA_OMIT } from "@/lib/db/prisma-client";
import { lineasSinComentarios } from "../../fixtures/sin-comentarios";

/**
 * FICHA 423 (T5.2, R16 + R17) — LA CLAVE DE ORDEN NI SE ESCRIBE NI VIAJA.
 *
 * `orden.clave_remision` la calcula Postgres (`GENERATED ALWAYS … STORED`). Dos garantias
 * distintas, las dos silenciosas si se rompen:
 *
 *   R17 — NINGUNA escritura de la aplicacion la fija. El motor ya lo impide (lo ejerce
 *   `tests/integration/db/orden-clave-remision-no-lanza.test.ts`: la base responde 428C9). Esta
 *   guardia lo caza ANTES, en el unico momento en que sale barato: al escribir el codigo. El
 *   coste de no cazarlo es concreto — un `claveRemision` colado en un `data:` revienta la
 *   escritura ENTERA, y si cae en la carga masiva se lleva el lote de 500 ordenes.
 *
 *   R16 — NO sale en ninguna respuesta. Aparecer en un DTO, en un `select` o en una lista de
 *   columnas de descarga es tan facil como escribir el nombre. Y hay una tentacion CONCRETA que
 *   esta guardia existe para bloquear: el aviso de agrupacion por serie (R20) necesita la serie
 *   de cada fila, y la clave YA la trae calculada por Postgres — «basta con mandarla al
 *   cliente». No. Esa nota se deriva en el navegador del `numRemision` que el DTO ya trae. Por
 *   eso el caso de `app/` es su propio caso, con su propio mensaje.
 *
 * Molde: `tests/unit/guards/busqueda-texto-solo-lectura.test.ts` (feature 169/209/321) y
 * `tests/unit/db/prisma-omit-busqueda-texto.test.ts`.
 */

const ROOT = path.join(__dirname, "..", "..", "..");
const RAICES = ["lib", "app", "components", "hooks", "scripts"] as const;
const EXTENSIONES = new Set([".ts", ".tsx"]);

/**
 * Los UNICOS lugares donde el nombre puede aparecer EN CODIGO, y por que:
 *   · `lib/db/prisma-client.ts` -> el `omit` global que la esconde de TODA lectura (R16).
 *   · `lib/repositories/OrdenRepository.ts` -> `SORT_COLUMN`, que traduce la clave publica
 *     `num_remision` a esta columna. Es su UNICO uso, y es de ORDEN, no de lectura ni de
 *     escritura: la columna no se selecciona en ningun sitio.
 *
 * Cualquier archivo nuevo en esta lista es una decision que hay que tomar a mano.
 */
const PERMITIDOS = new Set(["lib/db/prisma-client.ts", "lib/repositories/OrdenRepository.ts"]);

function archivosDeCodigo(): string[] {
  const salida: string[] = [];
  const recorrer = (dir: string) => {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entrada.name === "node_modules" || entrada.name.startsWith(".")) continue;
      const completo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) recorrer(completo);
      else if (EXTENSIONES.has(path.extname(entrada.name))) salida.push(completo);
    }
  };
  for (const raiz of RAICES) {
    const dir = path.join(ROOT, raiz);
    if (fs.existsSync(dir)) recorrer(dir);
  }
  return salida;
}

interface Mencion {
  archivo: string;
  linea: number;
  texto: string;
}

/**
 * El censo se hace sobre el CODIGO, no sobre el texto: los comentarios de este arbol NOMBRAN a
 * proposito la columna para explicar por que no se toca, y un barrido crudo denunciaria la
 * explicacion (feature 209). `lineasSinComentarios` devuelve las lineas alineadas una a una con
 * las del original, asi que el numero de linea informado sigue apuntando al sitio de verdad.
 */
const MENCIONES: Mencion[] = (() => {
  const salida: Mencion[] = [];
  for (const completo of archivosDeCodigo()) {
    const relativo = path.relative(ROOT, completo).split(path.sep).join("/");
    const lineas = lineasSinComentarios(fs.readFileSync(completo, "utf8"));
    lineas.forEach((texto, i) => {
      if (texto.includes("claveRemision") || texto.includes("clave_remision")) {
        salida.push({ archivo: relativo, linea: i + 1, texto: texto.trim() });
      }
    });
  }
  return salida;
})();

describe("nadie ESCRIBE `claveRemision` (R17)", () => {
  it("el censo encuentra menciones (si no, el guardia estaria pasando por vacio)", () => {
    // Contrapeso: si el recorrido de archivos se rompiera, todos los casos de abajo pasarian
    // sobre una lista vacia y este archivo no protegeria nada.
    expect(MENCIONES.length).toBeGreaterThan(0);
  });

  it("solo la nombran EN CODIGO los dos archivos de la lista blanca", () => {
    const archivos = [...new Set(MENCIONES.map((m) => m.archivo))].sort();
    const intrusos = archivos.filter((a) => !PERMITIDOS.has(a));
    expect(
      intrusos,
      "estos archivos nombran la columna generada del orden por remision: si es para " +
        "escribirla, Postgres rechazara la operacion ENTERA (428C9)",
    ).toEqual([]);
  });

  it("los dos permisos se USAN de verdad (una lista blanca con entradas de mas miente)", () => {
    for (const permitido of PERMITIDOS) {
      expect(
        MENCIONES.filter((m) => m.archivo === permitido).length,
        `${permitido} esta en la lista blanca y ya no nombra la columna`,
      ).toBeGreaterThan(0);
    }
  });

  it("ninguna mencion esta dentro de un `data:` de create/update/createMany", () => {
    const fuentes = archivosDeCodigo().map((completo) => ({
      archivo: path.relative(ROOT, completo).split(path.sep).join("/"),
      texto: lineasSinComentarios(fs.readFileSync(completo, "utf8")).join("\n"),
    }));
    const enData = /\bdata\s*:\s*[[{][^}\]]*claveRemision/;
    const culpables = fuentes.filter((f) => enData.test(f.texto)).map((f) => f.archivo);
    expect(culpables).toEqual([]);
  });

  it("no aparece junto a ningun verbo de escritura de Prisma", () => {
    const verbos = /\.(create|createMany|createManyAndReturn|update|updateMany|upsert)\s*\(/;
    expect(MENCIONES.filter((m) => verbos.test(m.texto))).toEqual([]);
  });

  it("no aparece en ningun `SET` ni `RETURNING` de SQL crudo", () => {
    const sqlDeEscritura = /\b(SET|RETURNING|INSERT\s+INTO)\b/i;
    expect(MENCIONES.filter((m) => sqlDeEscritura.test(m.texto))).toEqual([]);
  });
});

describe("no se filtra a ninguna respuesta (R16)", () => {
  it("ningun DTO ni tipo publico la declara", () => {
    // `lib/types/**` es la superficie de datos que sale por las Server Actions y por la API.
    // Que la columna no este ahi es lo que hace que R16 sea estructural y no disciplina.
    expect(MENCIONES.filter((m) => m.archivo.startsWith("lib/types/"))).toEqual([]);
  });

  it("NINGUN archivo de `app/` ni de `components/` la nombra", () => {
    // La tentacion concreta: el aviso de agrupacion por serie (R20) podria «leerse» de la clave,
    // que ya trae la serie calculada. Sacarla al cliente convertiria una decision de
    // presentacion en un contrato de datos nuevo, y dejaria sin sentido el `omit` global el
    // mismo dia. La serie se deriva del `numRemision` que el DTO YA trae.
    const enUi = MENCIONES.filter(
      (m) => m.archivo.startsWith("app/") || m.archivo.startsWith("components/"),
    );
    expect(
      enUi,
      "la clave de orden llego al cliente: el aviso de series se deriva del `numRemision` del DTO",
    ).toEqual([]);
  });

  it("no aparece en ningun `select` de Prisma", () => {
    expect(MENCIONES.filter((m) => /select\s*:/.test(m.texto))).toEqual([]);
  });

  it("no aparece en el manifiesto ni en ninguna lista de columnas de descarga", () => {
    const enSuperficieDeDatos = MENCIONES.filter(
      (m) =>
        m.archivo.startsWith("lib/manifiesto/") ||
        /descarga|export|columnas|xlsx|excel/i.test(m.archivo),
    );
    expect(enSuperficieDeDatos).toEqual([]);
  });
});

describe("el `omit` global la incluye y esta cableado", () => {
  it("`PRISMA_OMIT` esconde `claveRemision` de `orden`", () => {
    // MEDIDO (T2.4) contra Postgres real: el `omit` recorta la PROYECCION y NO impide el
    // `orderBy` por la columna — `tests/integration/db/orden-orden-remision-natural.test.ts`,
    // caso «el `omit` global no impide el `orderBy`». Por eso no hizo falta el plan B del
    // design §2.6.
    expect(PRISMA_OMIT.orden.claveRemision).toBe(true);
  });

  it("el cliente singleton se construye CON ese omit", () => {
    // Sin esta linea, `PRISMA_OMIT` seria una constante decorativa y la columna viajaria en cada
    // `findMany` sin `select`.
    const fuente = fs.readFileSync(path.join(ROOT, "lib", "db", "prisma-client.ts"), "utf8");
    expect(fuente).toMatch(/new PrismaClient\(\{[\s\S]*?omit: PRISMA_OMIT,[\s\S]*?\}\)/);
  });
});
