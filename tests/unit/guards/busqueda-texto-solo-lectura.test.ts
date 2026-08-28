import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { lineasSinComentarios } from "../../fixtures/sin-comentarios";

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
 * Los UNICOS lugares donde el nombre puede aparecer EN CODIGO, y por que:
 *   · `lib/db/prisma-client.ts`  -> el `omit` global que la esconde de toda lectura (R28):
 *     `PRISMA_OMIT = { orden: { busquedaTexto: true } }`.
 *   · `lib/repositories/OrdenRepository.ts` -> el `where` del buscador, que es su unico uso.
 *   · `scripts/bench-busqueda-ordenes.ts` (feature 169 / T4.1) -> el banco de rendimiento.
 *     Es el UNICO sitio que la nombra en DDL, y hacerlo es su trabajo: para medir el
 *     sobrecoste de escritura del indice (E5 del design §6) tiene que dropear la columna y
 *     el indice, medir, y reponerlos con el SQL LITERAL de `migration.sql`. Ademas la
 *     nombra al pedir `pg_relation_size('orden_busqueda_texto_trgm_idx')` — el nombre del
 *     indice CONTIENE el de la columna, asi que ni evitandolo se evitaria. Lo que este
 *     guardia protege sigue intacto: el banco NO la mete en ningun `data:` de Prisma, y los
 *     tres casos de abajo (verbo de escritura, `data:`, `select:`) lo comprueban sobre EL
 *     MISMO archivo, porque solo esta lista de nombres se amplia, no las reglas.
 * Cualquier archivo nuevo en esta lista es una decision que hay que tomar a mano.
 *
 * FEATURE 209 — LA LISTA BAJO DE CINCO A TRES, y no es cosmetica. El censo leia el fuente
 * CRUDO, asi que una mencion en un docstring contaba como uso de la columna y habia que
 * apuntar el archivo aqui para callarla. Dos de las cinco entradas eran exactamente eso:
 *   · `lib/interfaces/repositories/IOrdenRepository.ts` — dos menciones, las dos en JSDoc;
 *   · `lib/utils/busqueda-orden.ts` — una mencion, en la cabecera (modulo puro, sin Prisma).
 * Con el censo leyendo CODIGO, ninguno de los dos nombra ya la columna (medido: 25 menciones
 * en 5 archivos en crudo -> 17 en 3 archivos sin comentarios), asi que su permiso sobraba. Y
 * una lista blanca con entradas de mas MIENTE sobre quien puede tocar el campo, que es
 * justo lo que esta guardia protege: si manana alguien mete un `busquedaTexto` de verdad en
 * cualquiera de esos dos, ahora sale ROJO. Los dos siguen pudiendo DOCUMENTARLA cuanto
 * quieran; lo que ya no pueden es usarla en silencio.
 *
 * FEATURE 318 — entra un CUARTO archivo, `lib/repositories/HistoricoConversacionesRepository.ts`,
 * y entra como LECTOR, JAMAS como escritor. El historico de conversaciones busca por texto libre
 * (R36, design §1.2) sobre los mismos campos que la columna ya indexa —destinatario, num_guia,
 * num_remision, telefono, producto—, que es literalmente para lo que existe: reusarla evita un
 * segundo indice trigram sobre `orden` y una segunda definicion de «que es buscable». La nombra
 * en DOS lineas, las dos dentro de un `Prisma.sql` parametrizado del `WHERE`:
 *   `o.busqueda_texto LIKE ${patronLike(...)}` (termino tal cual y, si aplica, solo digitos).
 * NO la selecciona (sigue fuera del `select` y del DTO, R28: sigue omitida por `PRISMA_OMIT` y
 * es PII duplicada), NO la escribe y la feature NO trae migracion: el esquema no se toca.
 * Lo que sostiene esa promesa no es este parrafo, es el caso «solo aparece como criterio de
 * LECTURA», que desde la 318 se aplica a TODO repositorio de la lista blanca —no solo a
 * `OrdenRepository`—, ademas de los casos globales de `data:`, verbo de escritura y `select:`.
 * Cualquier archivo nuevo en esta lista es una decision que hay que tomar a mano.
 */
const PERMITIDOS = new Set([
  "lib/db/prisma-client.ts",
  "lib/repositories/OrdenRepository.ts",
  "lib/repositories/HistoricoConversacionesRepository.ts",
  "scripts/bench-busqueda-ordenes.ts",
]);

/**
 * Los repositorios de la lista blanca: los unicos que hablan con Prisma nombrando la columna,
 * y por tanto los unicos donde la distincion lectura/escritura hay que afirmarla archivo a
 * archivo. Se DERIVA de `PERMITIDOS` para que añadir un repositorio ahi arriba no pueda colarse
 * sin pasar por la comprobacion de solo-lectura de mas abajo.
 */
const REPOSITORIOS_PERMITIDOS = [...PERMITIDOS].filter((a) => a.startsWith("lib/repositories/"));

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
 * El censo se hace sobre el CODIGO, no sobre el texto. `lineasSinComentarios` devuelve las
 * lineas alineadas una a una con las del original, asi que el `linea` que se informa aqui
 * sigue apuntando al sitio de verdad (feature 209).
 */
const MENCIONES: Mencion[] = (() => {
  const salida: Mencion[] = [];
  for (const completo of archivosDeCodigo()) {
    const relativo = path.relative(ROOT, completo).split(path.sep).join("/");
    const lineas = lineasSinComentarios(fs.readFileSync(completo, "utf8"));
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

  it("solo la nombran EN CODIGO los archivos de la lista blanca", () => {
    const archivos = [...new Set(MENCIONES.map((m) => m.archivo))].sort();
    const intrusos = archivos.filter((a) => !PERMITIDOS.has(a));
    expect(
      intrusos,
      "estos archivos nombran la columna generada del buscador: si es para escribirla, " +
        "Postgres rechazara la operacion entera",
    ).toEqual([]);
  });

  it("209: los dos archivos que salieron de la lista blanca no la nombran en CODIGO", () => {
    // Su permiso existia para callar a un comentario. Se afirma la mitad que importa —el
    // CODIGO no la nombra— y no la existencia del docstring: borrar la documentacion no debe
    // poner esto rojo; meter un uso real, si.
    for (const rel of [
      "lib/interfaces/repositories/IOrdenRepository.ts",
      "lib/utils/busqueda-orden.ts",
    ]) {
      expect(fs.existsSync(path.join(ROOT, rel)), `falta ${rel}`).toBe(true);
      expect(MENCIONES.filter((m) => m.archivo === rel)).toEqual([]);
      expect(PERMITIDOS.has(rel)).toBe(false);
    }
  });

  it("ninguna mencion esta dentro de un `data:` de create/update/createMany", () => {
    const fuentes = archivosDeCodigo().map((completo) => ({
      archivo: path.relative(ROOT, completo).split(path.sep).join("/"),
      texto: lineasSinComentarios(fs.readFileSync(completo, "utf8")).join("\n"),
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

  it("en los repositorios solo aparece como criterio de LECTURA (`contains` o `LIKE`)", () => {
    // El filtro `!texto.startsWith("//")` que habia aqui se retira: era la mitigacion local de
    // que el censo leyera prosa, y ademas solo cubria el comentario de linea COMPLETA. Ahora
    // MENCIONES ya viene sin comentarios de ningun tipo (feature 209).
    //
    // Pedido humano (2026-08-19): la columna se lee AHORA por dos vias —el `contains` de
    // Prisma en `/ordenes` y un `LIKE` en el SQL crudo de la bodega satelite, que va en
    // `Prisma.sql` parametrizado—. Las dos son LECTURA, que es lo unico que esta guardia
    // vigila: escribirla la rechazaria Postgres entera. Se admiten las dos formas y nada mas;
    // cualquier tercera aparicion sigue poniendo esto rojo.
    //
    // Feature 318: la comprobacion deja de estar clavada a `OrdenRepository` y recorre TODOS
    // los repositorios de la lista blanca (hoy tambien `HistoricoConversacionesRepository`,
    // que la lee con el mismo `LIKE` parametrizado, R36). Se exige ademas que cada uno de
    // ellos la nombre de verdad: un permiso que ya no se usa es una lista blanca que miente.
    expect(REPOSITORIOS_PERMITIDOS.length).toBeGreaterThan(0);
    for (const repo of REPOSITORIOS_PERMITIDOS) {
      const enRepo = MENCIONES.filter((m) => m.archivo === repo);
      expect(enRepo.length, `${repo} esta en la lista blanca y ya no la nombra`).toBeGreaterThan(
        0,
      );
      for (const mencion of enRepo) {
        expect(
          mencion.texto.includes("contains") || / LIKE /.test(mencion.texto),
          `${repo}: ${mencion.texto}`,
        ).toBe(true);
      }
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
