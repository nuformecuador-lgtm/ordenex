import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { SORT_FIELDS } from "@/lib/types/orden";
import { lineasSinComentarios } from "../../fixtures/sin-comentarios";

/**
 * FICHA 423 (T5.3, R15 + R18) — EL ALCANCE NO SE DESBORDA.
 *
 * La feature ordena UNA superficie: `/ordenes` y su descarga. Todo lo demas —los listados planos
 * por rol (mensajero, adminSatelite, adminTienda), la recepcion de bodega satelite, el historico
 * y la API por clave— tiene que seguir presentando las ordenes EXACTAMENTE como hoy.
 *
 * POR QUE HACE FALTA UNA GUARDIA Y NO BASTAN LOS TESTS FUNCIONALES. Reordenar una superficie
 * ajena NO rompe nada: ninguna asercion de las suites de esas pantallas mira el orden de las
 * filas, asi que el cambio pasaria verde y lo descubriria un usuario. Es la familia de fallo mas
 * cara de este repo, y aqui se cierra por construccion: para ordenar por la clave nueva hay que
 * NOMBRARLA, y el censo de abajo cuenta cuantas veces se nombra en todo `lib/`.
 *
 * La otra mitad es R18: el contrato publico NO se amplia. `sortBy` sigue admitiendo exactamente
 * `created_at`, `num_guia` y `num_remision`. La clave publica no cambio — cambio la COLUMNA a la
 * que se traduce, que es justo lo que el mapa de `SORT_COLUMN` existe para permitir.
 */

const ROOT = path.join(__dirname, "..", "..", "..");
const LIB = path.join(ROOT, "lib");
const REPO_ORDEN = path.join(LIB, "repositories", "OrdenRepository.ts");

/** Todos los `.ts` de `lib/`, con su fuente ya SIN comentarios (feature 209). */
function fuentesDeLib(): { archivo: string; texto: string }[] {
  const salida: { archivo: string; texto: string }[] = [];
  const recorrer = (dir: string) => {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entrada.name.startsWith(".")) continue;
      const completo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) recorrer(completo);
      else if (entrada.name.endsWith(".ts")) {
        salida.push({
          archivo: path.relative(ROOT, completo).split(path.sep).join("/"),
          texto: lineasSinComentarios(fs.readFileSync(completo, "utf8")).join("\n"),
        });
      }
    }
  };
  recorrer(LIB);
  return salida;
}

const FUENTES = fuentesDeLib();
const CODIGO_REPO_ORDEN = lineasSinComentarios(fs.readFileSync(REPO_ORDEN, "utf8")).join("\n");

describe("R15 — la clave nueva solo la conoce el listado de /ordenes", () => {
  it("el censo lee de verdad `lib/` (contrapeso: si no, todo lo de abajo pasaria por vacio)", () => {
    expect(FUENTES.length).toBeGreaterThan(100);
    expect(FUENTES.some((f) => f.archivo === "lib/repositories/OrdenRepository.ts")).toBe(true);
  });

  it("en TODO `lib/` la clave se nombra en DOS archivos y en nada mas", () => {
    // `prisma-client.ts` (el `omit`) y `OrdenRepository.ts` (el `SORT_COLUMN`). Un tercer
    // archivo es, por construccion, otra consulta ordenando por ella.
    const archivos = FUENTES.filter((f) => f.texto.includes("claveRemision"))
      .map((f) => f.archivo)
      .sort();
    expect(archivos).toEqual([
      "lib/db/prisma-client.ts",
      "lib/repositories/OrdenRepository.ts",
    ]);
  });

  it("las UNICAS menciones del repositorio son la declaracion de `SORT_COLUMN`", () => {
    // Dos lineas y nada mas: el TIPO del mapa y su entrada. Cualquier tercera linea que nombre
    // la clave dentro de este archivo es otro `orderBy`, otro `select` o una escritura.
    const lineas = CODIGO_REPO_ORDEN.split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes("claveRemision"));
    expect(lineas).toEqual([
      'const SORT_COLUMN: Record<string, "createdAt" | "numGuia" | "claveRemision"> = {',
      'num_remision: "claveRemision",',
    ]);
  });

  it("`SORT_COLUMN` sigue teniendo TRES entradas y ninguna mas", () => {
    // El mapa es la lista blanca efectiva. Una cuarta entrada seria una columna ordenable que el
    // contrato publico no admite (o peor: que si admite sin que nadie lo revisara).
    const bloque = CODIGO_REPO_ORDEN.match(/const SORT_COLUMN[^=]*=\s*\{([\s\S]*?)\};/);
    expect(bloque, "no se encontro `SORT_COLUMN` en OrdenRepository").not.toBeNull();
    const entradas = (bloque as RegExpMatchArray)[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    expect(entradas).toEqual([
      'created_at: "createdAt",',
      'num_guia: "numGuia",',
      'num_remision: "claveRemision",',
    ]);
  });

  it("la recepcion de bodega SATELITE conserva su `orderBy` palabra por palabra", () => {
    // `findRecepcionSateliteByZona` (ficha 349, feature 101/R7). Este literal ES el contrato de
    // esa pantalla: prioridad delante y recencia detras, sin remision por ningun lado.
    expect(CODIGO_REPO_ORDEN).toContain(
      'orderBy: [{ prioridad: "desc" }, { createdAt: "desc" }],',
    );
    const bloque = CODIGO_REPO_ORDEN.match(
      /async findRecepcionSateliteByZona\([\s\S]*?\n {2}\}/,
    );
    expect(bloque, "no se encontro `findRecepcionSateliteByZona`").not.toBeNull();
    expect((bloque as RegExpMatchArray)[0]).toContain(
      'orderBy: [{ prioridad: "desc" }, { createdAt: "desc" }],',
    );
    expect((bloque as RegExpMatchArray)[0]).not.toContain("claveRemision");
    expect((bloque as RegExpMatchArray)[0]).not.toContain("SORT_COLUMN");
  });

  it("la API por clave sigue sin `sortBy` y ordena por fecha", () => {
    // `lib/types/api-key.ts` (D4): el canal por API key NUNCA acepto elegir orden, y esta feature
    // no se lo da. Su listado ordena por `createdAt desc` para que paginar sea estable.
    const apiKey = FUENTES.find((f) => f.archivo === "lib/types/api-key.ts");
    expect(apiKey, "no se encontro lib/types/api-key.ts").toBeDefined();
    expect((apiKey as { texto: string }).texto).not.toContain("sortBy");
    expect(CODIGO_REPO_ORDEN).toContain('orderBy: { createdAt: "desc" },');
  });

  it("ningun otro repositorio de `lib/` ordena por la clave", () => {
    // Dicho de la forma directa, por si el conteo de arriba se relajara algun dia: cualquier
    // `orderBy` que mencione la clave fuera de `OrdenRepository` es R15 roto.
    const culpables = FUENTES.filter(
      (f) =>
        f.archivo !== "lib/repositories/OrdenRepository.ts" &&
        /orderBy[\s\S]{0,200}claveRemision/.test(f.texto),
    ).map((f) => f.archivo);
    expect(culpables).toEqual([]);
  });
});

describe("R18 — el contrato publico no se amplia", () => {
  it("`SORT_FIELDS` sigue siendo exactamente las tres claves de siempre", () => {
    // Literal a proposito, y NO derivado del schema: es EL contrato. Derivarlo lo dejaria
    // comparandose consigo mismo, siempre verde (memoria: «Aserción contra su propia fuente»).
    expect([...SORT_FIELDS]).toEqual(["created_at", "num_guia", "num_remision"]);
  });

  it("`lib/types/orden.ts` no conoce la columna interna", () => {
    const tipos = FUENTES.find((f) => f.archivo === "lib/types/orden.ts");
    expect(tipos).toBeDefined();
    expect((tipos as { texto: string }).texto).not.toContain("claveRemision");
    expect((tipos as { texto: string }).texto).not.toContain("clave_remision");
  });
});
