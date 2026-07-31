import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 169 / T2.9 (R27/R28) — GUARDIA DE ESCRITURA de la columna generada.
//
// `orden.busqueda_texto` la calcula Postgres. Ninguna ruta de escritura —alta manual,
// carga masiva por sesion, carga por API key, actualizacion— puede tocarla: si alguien la
// mete en un `data`, la escritura entera revienta con SQLSTATE 428C9 y se cae una carga de
// 500 ordenes en produccion.
//
// El motor ya lo impide (lo demuestra `busqueda-sincronizacion-columna.test.ts` contra
// Postgres real). Este archivo lo caza ANTES, en el unico momento en que sale barato: al
// escribir el codigo. Y de paso fija que la columna no se filtre a ninguna respuesta:
// aparecer en un DTO o en un `select` es tan facil como escribir el nombre.

const ROOT = path.join(__dirname, "..", "..", "..");
const RAICES = ["lib", "app", "components", "hooks", "scripts"] as const;
const EXTENSIONES = new Set([".ts", ".tsx"]);

/**
 * Los UNICOS lugares donde el nombre puede aparecer, y por que:
 *   · `lib/db/prisma-client.ts`  -> el `omit` global que la esconde de toda lectura (R28).
 *   · `lib/repositories/OrdenRepository.ts` -> el `where` del buscador, que es su unico uso.
 *   · `lib/interfaces/repositories/IOrdenRepository.ts` -> documentacion del contrato.
 *   · `lib/utils/busqueda-orden.ts` -> la nombra en su cabecera para decir de que columna
 *     es espejo; no la lee ni la escribe (es un modulo puro, sin Prisma).
 * Cualquier archivo nuevo en esta lista es una decision que hay que tomar a mano.
 */
const PERMITIDOS = new Set([
  "lib/db/prisma-client.ts",
  "lib/repositories/OrdenRepository.ts",
  "lib/interfaces/repositories/IOrdenRepository.ts",
  "lib/utils/busqueda-orden.ts",
]);

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

const MENCIONES: Mencion[] = (() => {
  const salida: Mencion[] = [];
  for (const completo of archivosDeCodigo()) {
    const relativo = path.relative(ROOT, completo).split(path.sep).join("/");
    const lineas = fs.readFileSync(completo, "utf8").split("\n");
    lineas.forEach((texto, i) => {
      if (texto.includes("busquedaTexto") || texto.includes("busqueda_texto")) {
        salida.push({ archivo: relativo, linea: i + 1, texto: texto.trim() });
      }
    });
  }
  return salida;
})();

describe("nadie escribe `busquedaTexto` (R27)", () => {
  it("el censo encuentra menciones (si no, el guardia estaria pasando por vacio)", () => {
    // Contrapeso: si el recorrido de archivos se rompiera, todos los casos de abajo
    // pasarian sobre una lista vacia y este archivo no protegeria nada.
    expect(MENCIONES.length).toBeGreaterThan(0);
  });

  it("solo la mencionan los tres archivos que deben", () => {
    const archivos = [...new Set(MENCIONES.map((m) => m.archivo))].sort();
    const intrusos = archivos.filter((a) => !PERMITIDOS.has(a));
    expect(
      intrusos,
      "estos archivos nombran la columna generada del buscador: si es para escribirla, " +
        "Postgres rechazara la operacion entera",
    ).toEqual([]);
  });

  it("ninguna mencion esta dentro de un `data:` de create/update/createMany", () => {
    const fuentes = archivosDeCodigo().map((completo) => ({
      archivo: path.relative(ROOT, completo).split(path.sep).join("/"),
      texto: fs.readFileSync(completo, "utf8"),
    }));
    // Busca `data: { … busquedaTexto … }` y `data: [ … ]` (createMany) con el nombre
    // dentro, sin cruzar el cierre del objeto.
    const enData = /\bdata\s*:\s*[[{][^}\]]*busquedaTexto/;
    const culpables = fuentes.filter((f) => enData.test(f.texto)).map((f) => f.archivo);
    expect(culpables).toEqual([]);
  });

  it("no aparece junto a ningun verbo de escritura de Prisma", () => {
    const verbos = /\.(create|createMany|createManyAndReturn|update|updateMany|upsert)\s*\(/;
    const sospechosas = MENCIONES.filter((m) => verbos.test(m.texto));
    expect(sospechosas).toEqual([]);
  });

  it("en el repositorio solo aparece como criterio de LECTURA (`contains`)", () => {
    const enRepo = MENCIONES.filter(
      (m) => m.archivo === "lib/repositories/OrdenRepository.ts" && !m.texto.startsWith("//"),
    );
    expect(enRepo.length).toBeGreaterThan(0);
    for (const mencion of enRepo) {
      expect(mencion.texto).toContain("contains");
    }
  });
});

describe("no se filtra a ninguna respuesta (R28)", () => {
  it("ningun DTO ni tipo publico la declara", () => {
    // `lib/types/**` es la superficie de datos que sale por las Server Actions y por la
    // API. Que la columna no este ahi es lo que hace que R28 sea estructural.
    const enTipos = MENCIONES.filter((m) => m.archivo.startsWith("lib/types/"));
    expect(enTipos).toEqual([]);
  });

  it("ninguna interfaz de usuario la nombra", () => {
    const enUi = MENCIONES.filter(
      (m) => m.archivo.startsWith("app/") || m.archivo.startsWith("components/"),
    );
    expect(enUi).toEqual([]);
  });

  it("no aparece en ningun `select` de Prisma", () => {
    const enSelect = MENCIONES.filter((m) => /select\s*:/.test(m.texto));
    expect(enSelect).toEqual([]);
  });
});
