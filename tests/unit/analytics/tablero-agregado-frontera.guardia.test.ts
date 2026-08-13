import { describe, it, expect } from "vitest";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import fs from "fs";
import path from "path";

// Feature 182 (T4.3) — el guardia del CABLEADO del modo agregado. R12, R15 y R16.
//
// Censa EL ARBOL, nunca el diff. La leccion esta escrita en
// `tablero-operativo-frontera.guardia.test.ts:13-25`: un guardia que compara contra
// `origin/dev` caduca en cuanto la rama se mergea y pasa a juzgar ramas ajenas —o a dar
// verdes vacios cuando el diff queda vacio—. Lo que se blinda aqui son PROPIEDADES
// PERMANENTES del subarbol operativo:
//
//   R12 — toda cifra agregada entra por `consultarAgregadoOperativo` y por ninguna otra
//         puerta, y el subarbol no recompone ninguna formula de negocio. La UI no divide
//         (D2): el numerador y el denominador se leen para distinguir «no hubo gestiones»
//         de «no hay dato», no para volver a calcular la razon.
//   R15 — `lunesDeLaSemana` tiene UN solo llamador y es la agregacion de conteos. Lo que
//         se afirma es el ACOTAMIENTO, no la existencia: un caso que solo comprobase que
//         la funcion sigue en el archivo daria verde con una segunda definicion de semana
//         viva y sin vigilar, que es justo lo que se queria evitar.
//   R16 — el modo `rango_excedido` y sus dos textos NO viven en el subarbol. Borrar codigo
//         no lo mata ningun test por si solo: sin este censo, la rama muerta podria
//         reaparecer y nadie se enteraria. Y una rama inalcanzable con su propio texto de
//         UI es exactamente lo que un guardia futuro puede acabar censando creyendo que
//         vigila algo vivo (el patron muerto de `export-csv-frontera.guardia.test.ts`).

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const EXT = new Set([".ts", ".tsx"]);

const DIR_OPERATIVO = "app/(app)/analitica/_components/operativo";
const AGREGACION = `${DIR_OPERATIVO}/agregacion.ts`;

function archivos(dir: string): string[] {
  const abs = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const salida: string[] = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      salida.push(...archivos(rel));
    } else if (EXT.has(path.extname(e.name))) {
      salida.push(rel);
    }
  }
  return salida;
}

/** Quita comentarios: una MENCION EN PROSA no es codigo. */
function soloCodigo(fuente: string): string {
  return quitarComentarios(fuente);
}

function codigoDe(rel: string): string {
  return soloCodigo(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
}

function infractores(dir: string, patrones: readonly RegExp[]): string[] {
  return archivos(dir).filter((rel) => patrones.some((p) => p.test(codigoDe(rel))));
}

/**
 * Cuenta INVOCACIONES de una funcion, sin contar su declaracion. Se usa para el censo de
 * R15, asi que se prueba a parte contra codigo sintetico: un contador que no contase nada
 * daria el mismo verde que un arbol limpio.
 */
export function llamadas(codigo: string, nombre: string): number {
  const re = new RegExp(`(?<!function\\s)\\b${nombre}\\s*\\(`, "g");
  return (codigo.match(re) ?? []).length;
}

/** El cuerpo de una funcion exportada, desde su firma hasta el siguiente `export`. */
function cuerpoDe(codigo: string, nombre: string): string {
  const desde = codigo.indexOf(`export function ${nombre}(`);
  if (desde < 0) return "";
  const resto = codigo.slice(desde + 1);
  const hasta = resto.indexOf("\nexport ");
  return hasta < 0 ? resto : resto.slice(0, hasta);
}

/* ========================================================================== */
/* R12 — una sola puerta, y la UI no divide                                    */
/* ========================================================================== */

/**
 * Recomposiciones de negocio: el denominador de las tasas rehecho a mano, los acumuladores
 * de ciclo, o una division de los componentes que el servidor ya dividio una sola vez.
 */
const RECOMPOSICION: readonly RegExp[] = [
  /\bnumerador\b[^\n]*\/[^\n]*\bdenominador\b/,
  /\/\s*[\w.]*\bdenominador\b/,
  /\b(entregas|devoluciones|rechazos|incidentes)\s*\+\s*\w/,
  /\bsegCiclo(Acum|N)\b/,
];

/** Pedir el agregado por otra puerta: el servicio, el repositorio o una ruta de API. */
const OTRA_PUERTA: readonly RegExp[] = [
  /\.consultarAgregado\s*\(/,
  /from\s+["']@\/lib\/services\//,
  /fetch\s*\(\s*["'`][^"'`]*\/api\//,
];

describe("Feature 182 (R12) — el agregado entra por su Server Action y la UI no divide", () => {
  it("el subarbol operativo no recompone ninguna formula de negocio ni pide el agregado por otra puerta", () => {
    const malos = infractores(DIR_OPERATIVO, [...RECOMPOSICION, ...OTRA_PUERTA]);
    expect(
      malos,
      "toda cifra agregada sale de `consultarAgregadoOperativo` (lib/actions/" +
        "analitica-operativa.ts), que resuelve actor, alcance, identidad y auditoria. Y la " +
        "UI NO divide: el `valor` lo calculo el servidor sumando ANTES de dividir, y " +
        "recomponerlo aqui crearia una segunda cifra que puede divergir sin que nada avise. " +
        "Archivos: " +
        malos.join(", "),
    ).toEqual([]);
  });

  it("quien nombra el agregado lo importa de la Server Action, y alguien lo nombra", () => {
    const quienes = archivos(DIR_OPERATIVO).filter((rel) =>
      /consultarAgregadoOperativo/.test(codigoDe(rel)),
    );
    // Si nadie lo nombrase, el caso de arriba seria verde por vacio: la feature no estaria
    // cableada y el guardia diria que todo esta bien.
    expect(quienes.length, "nadie consulta el modo agregado en el subarbol").toBeGreaterThan(0);
    for (const rel of quienes) {
      expect(codigoDe(rel), rel).toMatch(
        /import[\s\S]{0,200}from\s+["']@\/lib\/actions\/analitica-operativa["']/,
      );
    }
  });

  it("el censo mira archivos de verdad (si no, seria verde por vacio)", () => {
    expect(archivos(DIR_OPERATIVO).length).toBeGreaterThan(4);
    expect(fs.existsSync(path.join(REPO_ROOT, AGREGACION))).toBe(true);
  });
});

/* ========================================================================== */
/* R15 — la semana del cliente, con UN solo llamador                           */
/* ========================================================================== */

describe("Feature 182 (R15) — la segunda definicion de semana queda vigilada", () => {
  it("`lunesDeLaSemana` tiene UN solo llamador en el subarbol y es la agregacion de conteos", () => {
    const porArchivo = archivos(DIR_OPERATIVO).map(
      (rel) => [rel, llamadas(codigoDe(rel), "lunesDeLaSemana")] as const,
    );
    const total = porArchivo.reduce((acc, [, n]) => acc + n, 0);

    // EXACTAMENTE UNA. Un segundo llamador —que es como esto se rompe de verdad— pone rojo
    // este caso aunque el primero siga siendo correcto.
    expect(
      total,
      "la semana del cliente se calcula en mas de un sitio: " +
        porArchivo
          .filter(([, n]) => n > 0)
          .map(([rel, n]) => `${rel} (${n})`)
          .join(", "),
    ).toBe(1);

    // Y ese unico llamador es `agregarPorSemana`, dentro de `agregacion.ts`.
    const codigo = codigoDe(AGREGACION);
    expect(llamadas(codigo, "lunesDeLaSemana")).toBe(1);
    expect(llamadas(cuerpoDe(codigo, "agregarPorSemana"), "lunesDeLaSemana")).toBe(1);

    // El ACOTAMIENTO es ejecutable, no un comentario: `agregarPorSemana` exige la unidad y
    // rechaza la que no sea conteo. Un comentario no lo rompe ninguna mutacion.
    const cuerpo = cuerpoDe(codigo, "agregarPorSemana");
    expect(cuerpo).toMatch(/unidad:\s*MetricaUnidad/);
    expect(cuerpo).toMatch(/esAgregableTemporal\(unidad\)/);
    expect(cuerpo).toMatch(/throw new UnidadNoAgregableEnClienteError/);
  });

  it("el contador de llamadas DISCRIMINA: cuenta las de verdad y no las de la prosa", () => {
    // Sin este caso, un contador roto daria el mismo cero tranquilizador que un arbol
    // limpio, y el censo de arriba seria un adorno.
    const infractor = `
      const semana = lunesDeLaSemana(punto.fecha);
      const otra = lunesDeLaSemana(cubo.fecha);
    `;
    expect(llamadas(soloCodigo(infractor), "lunesDeLaSemana")).toBe(2);

    const soloDeclaracion = "export function lunesDeLaSemana(fecha: string): string { return fecha; }";
    expect(llamadas(soloCodigo(soloDeclaracion), "lunesDeLaSemana")).toBe(0);

    const prosa = [
      "// la semana la calcula lunesDeLaSemana(fecha), y solo para conteos",
      "/* nada de lunesDeLaSemana(x) por aqui */",
      "export function Panel() { return null; }",
    ].join("\n");
    expect(llamadas(soloCodigo(prosa), "lunesDeLaSemana")).toBe(0);
  });
});

/* ========================================================================== */
/* R16 — la rama muerta no vuelve                                              */
/* ========================================================================== */

const RANGO_EXCEDIDO: readonly RegExp[] = [
  /\bTEXTO_RANGO_EXCEDIDO\b/,
  /\bTITULO_RANGO_EXCEDIDO\b/,
  /["']rango_excedido["']/,
];

describe("Feature 182 (R16) — el modo `rango_excedido` esta retirado", () => {
  it("el subarbol no conserva el modo `rango_excedido` ni sus dos textos", () => {
    const malos = infractores(DIR_OPERATIVO, RANGO_EXCEDIDO);
    expect(
      malos,
      "el aviso de «rango demasiado largo» declaraba un hueco —no hay forma honesta de " +
        "calcular esta cifra— que dejo de existir cuando el servidor empezo a sumar antes " +
        "de dividir (176). Reponerlo, o dejar sus textos exportados sin uso, es codigo " +
        "muerto con texto de UI propio. Archivos: " +
        malos.join(", "),
    ).toEqual([]);
  });

  it("el censo de R16 DISCRIMINA: pilla el codigo repuesto y no una mencion en prosa", () => {
    const repuesto = [
      'export const TITULO_RANGO_EXCEDIDO = "Rango demasiado largo para esta metrica";',
      'export const TEXTO_RANGO_EXCEDIDO = "Reduce el rango para verla.";',
      'if (excede) return { modo: "rango_excedido", series: [] };',
    ].join("\n");
    for (const patron of RANGO_EXCEDIDO) {
      expect(patron.test(soloCodigo(repuesto)), String(patron)).toBe(true);
    }

    const prosa = [
      "// el modo rango_excedido de la 131 se retiro en la 182 (R16)",
      "/* ya no existen TEXTO_RANGO_EXCEDIDO ni TITULO_RANGO_EXCEDIDO */",
      "export function Panel() { return null; }",
    ].join("\n");
    expect(RANGO_EXCEDIDO.some((p) => p.test(soloCodigo(prosa)))).toBe(false);
  });
});
