import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { codigoSinComentarios, quitarComentarios } from "../../fixtures/sin-comentarios";

// Feature 248 — GUARDIA DE UNA SOLA DEFINICION DE LA ZONA DEL DISTRITO (T7.3, cubre R35).
//
// INVARIANTE QUE FIJA (design.md, D12): «una definicion, dos lecturas». La regla que decide que
// zona le corresponde a un distrito —la N:M `zona_distrito` de la feature 24: EXACTAMENTE una zona
// resuelve, cero es «sin zona», mas de una es ambigua y NO derivable— vive en UN solo sitio,
// `lib/utils/resolucion-geografica.ts` (`zonaDeDistrito`). La carga de ordenes lee de ahi (solo le
// interesa `unica`) y el cotizador tambien (ramifica por los tres estados). Si la regla se
// reescribiera en un repositorio o en un servicio, habria DOS respuestas posibles para el mismo
// distrito multi-zona: el cotizador podria prometer un flete que la carga de esa misma orden
// rechazaria por ambigua. Eso es exactamente lo que R35 prohibe.
//
// ⛔ LO QUE ESTA GUARDIA NO HACE, Y ES DELIBERADO: no mira `git diff` contra `origin/dev`. Una
// guardia que mide el diff de una rama CADUCA en cuanto la rama se mergea y pasa a juzgar el
// trabajo de cualquier rama posterior (leccion ya pagada: `rastreo-sin-ruta-nueva.guardia.test.ts`
// :22-26). Aqui se mide la PROPIEDAD —donde vive la regla— y ninguna asercion depende de la rama
// en la que se ejecute.

const RAIZ = path.resolve(__dirname, "../../..");

/** EL unico archivo autorizado a contener la regla. */
const MODULO_COMPARTIDO = "lib/utils/resolucion-geografica.ts";

/* -------------------------------------------------------------------------- */
/* El detector                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * La regla, escrita como patron: **la longitud de una coleccion de ZONAS comparada contra 1 o 2**.
 *
 * Se capturan el identificador y el numero por separado para poder filtrar despues:
 *
 *   `zonas.length === 1`   `zonas.length !== 1`   `zonas.length > 1`
 *   `distrito.zonas.length === 1`   `zonaDistrito.length === 1`   `zonasDelDistrito.length >= 2`
 *
 * DOS decisiones de acotacion, para que el detector cace la reaparicion de la regla sin denunciar
 * codigo inocente:
 *
 *  1. **Se exige que el identificador nombre una zona** (`/zona/i`). Sin esto la guardia denunciaria
 *     los ~25 `.length === 1` legitimos de este arbol (`pagos.length === 1`, `palabras.length === 1`,
 *     `puntos.length === 1`, los plurales de la UI…), que no tienen nada que ver con R35.
 *  2. **Solo se comparan 1 y 2**, no 0. La comparacion DISCRIMINANTE de la regla es siempre contra
 *     uno («exactamente una zona resuelve»), y sus equivalentes `> 1` / `>= 2` / `<= 1` / `< 2`.
 *     Contra 0 hay usos preexistentes y ajenos a la regla —`zonas.length > 0` en
 *     `CierreBodegaRepository` (un array de filtros Prisma) y `zonas.length === 0` en
 *     `ZonasTarifasModule` (un estado vacio de la UI)— y denunciarlos seria un falso positivo.
 *     Una reimplementacion de la regla NECESITA distinguir «una» de «varias», asi que no puede
 *     escribirse solo con ceros: cae igual.
 */
const REGLA = /([A-Za-z_$][\w$]*)\.length\s*(?:===|!==|==|!=|>=|<=|>|<)\s*([12])\b/g;

/** Las apariciones de la regla en un fuente ya SIN comentarios. */
function apariciones(codigo: string): string[] {
  return [...codigo.matchAll(REGLA)]
    .filter(([, identificador]) => /zona/i.test(identificador))
    .map(([completa]) => completa.replace(/\s+/g, " "));
}

/* -------------------------------------------------------------------------- */
/* El censo: todo el codigo de PRODUCCION                                       */
/* -------------------------------------------------------------------------- */

const CARPETAS_DE_PRODUCCION = ["lib", "app"];
const IGNORADAS = new Set(["node_modules", ".next", "dist", "coverage", "tests"]);

/** Todos los `.ts`/`.tsx` bajo una carpeta del repo, recursivamente. */
function fuentesDe(carpeta: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(path.join(RAIZ, carpeta))) {
    if (IGNORADAS.has(entrada)) continue;
    const rel = `${carpeta}/${entrada}`;
    if (statSync(path.join(RAIZ, rel)).isDirectory()) salida.push(...fuentesDe(rel));
    else if (entrada.endsWith(".ts") || entrada.endsWith(".tsx")) salida.push(rel);
  }
  return salida;
}

const PRODUCCION = CARPETAS_DE_PRODUCCION.flatMap(fuentesDe);

/** Ruta -> apariciones de la regla, leyendo cada archivo SIN comentarios. */
const CENSO = new Map(
  PRODUCCION.map((ruta) => [ruta, apariciones(codigoSinComentarios(ruta))] as const),
);

describe("R35 — la regla de la zona del distrito solo vive en el util compartido", () => {
  it("CONTROL DE NO-VACUIDAD: el censo barre el codigo de produccion y encuentra el modulo compartido", () => {
    // Sin esto, un censo vacio (una carpeta renombrada, un filtro roto) daria VERDE sin haber
    // medido nada.
    expect(PRODUCCION.length).toBeGreaterThan(200);
    expect(PRODUCCION).toContain(MODULO_COMPARTIDO);
    expect(PRODUCCION).toContain("lib/repositories/OrdenRepository.ts");
    expect(PRODUCCION.some((ruta) => ruta.startsWith("app/"))).toBe(true);
    // Y ningun archivo de `tests/` se cuela: las guardias y los unitarios SI nombran la regla.
    expect(PRODUCCION.filter((ruta) => ruta.includes("/tests/"))).toEqual([]);
  });

  it("CONTROL DE NO-VACUIDAD: el util SIGUE conteniendo la definicion, y decide por longitud", () => {
    // La otra mitad del control: si `zonaDeDistrito` desapareciera —o dejara de decidir por el
    // numero de zonas— la lista de infractores quedaria vacia por la razon equivocada y la
    // guardia pasaria en verde sobre una feature rota. Aqui se exige que la regla EXISTA donde
    // debe existir, y que el detector la reconozca.
    const util = codigoSinComentarios(MODULO_COMPARTIDO);

    expect(util).toContain("export function zonaDeDistrito");
    for (const estado of ['"unica"', '"ninguna"', '"ambigua"']) {
      expect(util, `el util ya no distingue el estado ${estado}`).toContain(estado);
    }
    // La decision por longitud, medida con el MISMO detector que denuncia a los demas.
    expect(CENSO.get(MODULO_COMPARTIDO)).toEqual(["zonas.length > 1"]);
  });

  it("`zonaDeDistrito` se DEFINE una sola vez en todo el codigo de produccion", () => {
    const definidores = PRODUCCION.filter((ruta) =>
      codigoSinComentarios(ruta).includes("function zonaDeDistrito"),
    );
    expect(definidores, "hay una segunda definicion de `zonaDeDistrito`").toEqual([
      MODULO_COMPARTIDO,
    ]);
  });

  it("la regla NO aparece en ningun otro archivo de produccion", () => {
    // El corazon de R35. Un repositorio o un servicio que vuelva a escribir el ternario
    // —`zonas.length === 1 ? ... : null`— aparece aqui por su ruta, hoy y dentro de veinte
    // features. Consumir `zonaDeDistrito(...)` no lo hace aparecer: la llamada no compara nada.
    const infractores = [...CENSO]
      .filter(([ruta, hits]) => ruta !== MODULO_COMPARTIDO && hits.length > 0)
      .map(([ruta, hits]) => `${ruta}: ${hits.join(", ")}`);

    expect(
      infractores,
      "la regla de la zona del distrito se reimplemento fuera de `lib/utils/resolucion-geografica.ts`",
    ).toEqual([]);
  });

  it("CONTRAPRUEBA: el detector caza el ternario reintroducido, y no denuncia codigo inocente", () => {
    // Se fabrica la infraccion EN MEMORIA: asi se veria si un repositorio propio del cotizador
    // volviera a derivar la zona por su cuenta (la alternativa que D12 descarta).
    const reintroducido = `
      const zonas = row.zonaDistrito.map((zd) => zd.zona);
      const zonaId = zonas.length === 1 ? zonas[0].id : null;
      const esCentral = zonas.length !== 1 ? false : zonas[0].esCentral;
    `;
    expect(apariciones(reintroducido)).toEqual([
      "zonas.length === 1",
      "zonas.length !== 1",
    ]);

    // La misma regla escrita sobre la relacion, sin variable intermedia, y con el equivalente
    // `>= 2` en vez de `> 1`.
    expect(apariciones("if (d.zonaDistrito.length >= 2) return null;")).toEqual([
      "zonaDistrito.length >= 2",
    ]);

    // Y el otro lado: lineas REALES de este arbol que comparan longitudes contra 1 sin tener
    // nada que ver con R35. Si alguna de estas se denunciara, la guardia seria ruido.
    for (const inocente of [
      "return pagos.length === 1 ? pagos[0].metodo : null;",
      "if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase();",
      "if (data.tarifas.length > 1) {",
      "...(zonas.length > 0 ? { AND: zonas } : {}),",
      "if (zonas.length === 0) {",
      "const zona = zonaDeDistrito(row.zonaDistrito.map((zd) => zd.zona));",
    ]) {
      expect(apariciones(inocente), `falso positivo sobre: ${inocente}`).toEqual([]);
    }
  });

  it("CONTRAPRUEBA: la regla escondida en un COMENTARIO no cuenta como infraccion", () => {
    // Los comentarios de este arbol nombran a proposito lo que el codigo tiene prohibido. Leer el
    // fuente crudo obligaria a borrar la explicacion para pasar la guardia; por eso el censo pasa
    // por `codigoSinComentarios` (feature 209).
    const soloProsa = "// antes esto era `zonas.length === 1 ? zonas[0].id : null`, ya no.";

    // Sobre el texto CRUDO el detector lo denunciaria: es una mencion, no una implementacion.
    expect(apariciones(soloProsa)).toEqual(["zonas.length === 1"]);
    // Sobre el texto que el censo lee de verdad, no.
    expect(apariciones(quitarComentarios(soloProsa))).toEqual([]);
    // Y la version bloque, que es como estan escritos los docstrings del util.
    expect(apariciones(quitarComentarios("/* zonas.length === 1 */\nconst x = 1;"))).toEqual([]);
  });
});
