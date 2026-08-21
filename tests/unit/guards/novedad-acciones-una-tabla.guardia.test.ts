// GUARDIA DEL ARNÉS — EN `/novedades` HAY UNA SOLA TABLA DE BOTONES, Y EL CORTE ES DEL SERVIDOR.
//
// Cubre **R19** (ningún otro punto de esta pantalla decide si una acción se ofrece comparando el
// estado de la orden) y **R2/R8** (la partición de las dos poblaciones vive en el SERVIDOR; la
// pantalla no la rehace en el cliente).
//
// **El defecto que impide que vuelva, medido y con nombre.** Hasta el 2026-08-19 `NovedadAcciones`
// decidía con condiciones sueltas: `esDevuelta = novedad.estatusValue === "devuelta"`,
// `esAyuda = novedad.estatusValue === "ayuda_tienda"`, `puedeHabilitar = esDevuelta || esAyuda`, y
// tres `...(cond ? [x] : [])` dentro del arreglo de acciones. **Ese diseño ya produjo un defecto**
// —«Habilitar» aparece justo en las cards que vienen de un cierre, al revés de lo que el pedido
// decía (punto 12, dueño: ficha 240)— y lo produjo porque nada obligaba a la sexta condición: se
// añadía una acción y ningún sitio reclamaba la decisión para el otro grupo.
//
// **La regla, dicha en positivo.** En `app/(app)/novedades/`, la ÚNICA forma admitida de leer el
// estado de una orden es preguntándole a la declaración única a qué grupo pertenece:
// `grupoDeEstatus(<orden>.estatusValue)`. Con eso:
//
//   · nadie puede comparar `estatusValue` con un literal (R19) — ni directo ni escondido tras un
//     `const`, porque el literal tendría que aparecer al lado de la lectura;
//   · y el juego de botones sale forzosamente de `ACCIONES_POR_GRUPO`, que es el punto único.
//
// **La segunda regla, la del corte (R2/R8).** Ningún recorrido de esta pantalla (`filter`, `find`,
// `some`, `every`, `reduce`) puede mirar el estatus ni el grupo: eso sería REHACER EN EL CLIENTE la
// partición que el servidor ya hizo. La 235 aprendió a la mala lo que cuesta —el apartado de ayuda
// del portal del mensajero era un `useMemo` de cliente y la orden seguía siendo parada del
// optimizador, del mapa y del panel de gestión: «el corte era MAQUETACIÓN»—, y repetirlo en la
// pantalla de al lado sería no haberlo leído.
//
// ⚠️ **EL CENSO SE ESCRIBE EN UN ARCHIVO DE TEST, NUNCA POR `node -e`.** Ahí `\b` llega como
// backspace y el censo miente en verde. Es la lección literal de `specs/238/tasks.md` T1.2.
//
// ⚠️ **Autocomprobación dentro de este mismo archivo.** Los dos detectores se ejercen contra fuente
// sintético en las dos direcciones —sano y con la infracción plantada— antes de creerles nada sobre
// el árbol real. Una guardia estática rota no falla: calla, y su verde se lee igual que el bueno.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo, sin estar registrada en
// ninguna lista.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import { quitarComentarios } from "../../fixtures/sin-comentarios";

const RAIZ = path.resolve(__dirname, "../../..");
const PANTALLA = "app/(app)/novedades";

/**
 * El catálogo y sus tests quedan FUERA del censo, y sólo ellos:
 *
 *  - `novedad-acciones-catalogo.ts` **es** la tabla — es el punto único, no una copia;
 *  - los archivos de `-descarga-columnas.ts` no deciden botones: proyectan filas de un archivo, y
 *    su relación con el grupo la decide `RECURSOS_POR_GRUPO`, no una comparación de estatus.
 *
 * `NovedadesModule` y `NovedadAcciones` NO están exentos: son justamente los dos que tenían las
 * condiciones sueltas, así que exentarlos dejaría la guardia sin sujeto.
 */
const EXENTOS = new Set([
  `${PANTALLA}/_components/novedad-acciones-catalogo.ts`,
]);

function listarFuentes(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listarFuentes(completo, acc);
    else if (/\.tsx?$/.test(entrada.name)) acc.push(completo);
  }
  return acc;
}

interface Modulo {
  ruta: string;
  codigo: string;
}

const FUENTES: Modulo[] = listarFuentes(path.join(RAIZ, PANTALLA))
  .map((completo) => ({
    ruta: path.relative(RAIZ, completo).split(path.sep).join("/"),
    codigo: quitarComentarios(readFileSync(completo, "utf8")),
  }))
  .filter(({ ruta }) => !EXENTOS.has(ruta));

// ---------------------------------------------------------------------------------------------
// Los dos detectores, como funciones PURAS del texto (así se les puede dar fuente sintético).
// ---------------------------------------------------------------------------------------------

/** Toda lectura de `estatusValue` del fuente. */
const LECTURA_ESTATUS = /\.estatusValue\b/g;
/** La ÚNICA lectura admitida: preguntarle su grupo a la declaración única. */
const LECTURA_POR_EL_MAPA = /\bgrupoDeEstatus\s*\(\s*[A-Za-z_$][\w$]*\.estatusValue\s*\)/g;

/**
 * R19 — lecturas de `estatusValue` que NO pasan por `grupoDeEstatus`. Debe salir cero.
 *
 * Se cuenta en vez de buscar la comparación con un literal, y es a propósito: buscar
 * `=== "devuelta"` deja pasar el `const ESTATUS_AYUDA = "ayuda_tienda"` de al lado, el `includes`,
 * el `switch` y el `startsWith`. Contando, cualquier forma de mirar el estatus que no sea
 * preguntarle su grupo al mapa sale denunciada, incluidas las que nadie ha inventado todavía.
 */
export function lecturasCrudasDeEstatus(codigo: string): number {
  const todas = codigo.match(LECTURA_ESTATUS)?.length ?? 0;
  const porElMapa = codigo.match(LECTURA_POR_EL_MAPA)?.length ?? 0;
  return todas - porElMapa;
}

/** Un literal del catálogo de estatus escrito en el fuente (la forma clásica de la infracción). */
export function literalesDeEstatus(codigo: string): string[] {
  const catalogo = new Set<string>(ORDER_STATUS_SEED as readonly string[]);
  const encontrados = new Set<string>();
  for (const m of codigo.matchAll(/["'`]([^"'`\n]*)["'`]/g)) {
    if (catalogo.has(m[1])) encontrados.add(m[1]);
  }
  return [...encontrados].sort();
}

/** Los recorridos (`filter`/`find`/`some`/`every`/`reduce`) cuyo cuerpo mira el estatus o el grupo. */
const RECORRIDO = /\.(filter|find|some|every|reduce|flatMap)\s*\(/g;

/**
 * R2/R8 — un recorrido de esta pantalla que particiona por estado. Debe salir vacío.
 *
 * La ventana de 220 caracteres tras la apertura del recorrido cubre de sobra un predicado de una
 * línea, que es la forma que tendría la partición; y la contraprueba de abajo comprueba que un
 * `filter` legítimo (el que quita una fila por `id` tras una mutación) NO cae.
 */
export function particionesPorEstado(codigo: string): string[] {
  const hallazgos: string[] = [];
  for (const m of codigo.matchAll(RECORRIDO)) {
    const ventana = codigo.slice(m.index, m.index + 220);
    if (/estatusValue|grupoDeEstatus/.test(ventana)) {
      hallazgos.push(ventana.split("\n")[0].trim());
    }
  }
  return hallazgos;
}

// =============================================================================================
// 0 — Los detectores, probados contra respuestas conocidas (las dos direcciones)
// =============================================================================================

const SANO = `
  function NovedadAcciones({ novedad }) {
    const grupo = grupoDeEstatus(novedad.estatusValue);
    const acciones = grupo ? ACCIONES_POR_GRUPO[grupo] : ACCIONES_SIN_GRUPO;
    setItems((prev) => prev.filter((n) => n.id !== orden.id));
    return acciones;
  }`;

const CON_LITERAL = `
  function NovedadAcciones({ novedad }) {
    const esDevuelta = novedad.estatusValue === "devuelta";
    const esAyuda = novedad.estatusValue === "ayuda_tienda";
    return [...(esDevuelta ? ["reprogramar"] : []), ...(esAyuda ? ["conversacion"] : [])];
  }`;

const CON_CONST = `
  const ESTATUS_AYUDA = "ayuda_tienda";
  function NovedadAcciones({ novedad }) {
    const esAyuda = novedad.estatusValue === ESTATUS_AYUDA;
    return esAyuda;
  }`;

const CON_PARTICION = `
  function NovedadesModule({ items }) {
    const deAyuda = items.filter((n) => grupoDeEstatus(n.estatusValue) === "ayuda");
    return deAyuda;
  }`;

describe("0 — el detector de esta guardia no está roto", () => {
  it("sobre el fuente SANO no denuncia nada", () => {
    expect(lecturasCrudasDeEstatus(SANO)).toBe(0);
    expect(literalesDeEstatus(SANO)).toEqual([]);
    // El `filter` legítimo —quitar una fila por `id` tras una mutación— NO es una partición.
    expect(particionesPorEstado(SANO)).toEqual([]);
  });

  it("AUTOCOMPROBACIÓN: con la comparación plantada, se pone rojo y dice qué vio", () => {
    // Es literalmente el código que este archivo vino a impedir: las dos condiciones sueltas que
    // `NovedadAcciones` tenía hasta el 2026-08-19.
    expect(lecturasCrudasDeEstatus(CON_LITERAL)).toBe(2);
    expect(literalesDeEstatus(CON_LITERAL)).toEqual(["ayuda_tienda", "devuelta"]);
  });

  it("AUTOCOMPROBACIÓN: el literal escondido tras un `const` tampoco se escapa", () => {
    // Un `const` con el estatus dentro es el MISMO segundo literal, sólo que con un nombre delante.
    expect(lecturasCrudasDeEstatus(CON_CONST)).toBe(1);
    expect(literalesDeEstatus(CON_CONST)).toEqual(["ayuda_tienda"]);
  });

  it("AUTOCOMPROBACIÓN: una partición de CLIENTE se ve aunque pase por el mapa", () => {
    // Ésta es la que el detector de literales NO ve: usa `grupoDeEstatus`, que es lo correcto para
    // decidir botones y lo PROHIBIDO para partir la lista. Por eso hay dos detectores y no uno.
    expect(lecturasCrudasDeEstatus(CON_PARTICION)).toBe(0);
    expect(particionesPorEstado(CON_PARTICION)).toHaveLength(1);
    expect(particionesPorEstado(CON_PARTICION)[0]).toContain("filter");
  });

  it("el censo LEYÓ el árbol de verdad: hay archivos, con código, y las dos lecturas conocidas", () => {
    // Anti-vacuidad. Una guardia que no encuentra nada denuncia cero infracciones y su verde es
    // indistinguible del bueno; en esta misma pila ya pasó una vez.
    expect(FUENTES.length).toBeGreaterThanOrEqual(8);
    expect(FUENTES.every((m) => m.codigo.trim().length > 0)).toBe(true);
    // Las dos lecturas REALES que hoy existen, las dos por el mapa. Si alguien borrara
    // `grupoDeEstatus` de la pantalla, esto caería antes de que el censo dijera «cero».
    const porElMapa = FUENTES.reduce(
      (acc, m) => acc + (m.codigo.match(LECTURA_POR_EL_MAPA)?.length ?? 0),
      0,
    );
    expect(porElMapa).toBe(2);
  });
});

// =============================================================================================
// R19 — la decisión de qué botón se ofrece vive en UN solo sitio
// =============================================================================================

describe("236/R19 — ningún archivo de la pantalla decide botones mirando el estatus", () => {
  it("toda lectura de `estatusValue` pasa por `grupoDeEstatus`", () => {
    const infractores = FUENTES.filter((m) => lecturasCrudasDeEstatus(m.codigo) > 0).map(
      (m) => `${m.ruta} (${lecturasCrudasDeEstatus(m.codigo)} lectura/s crudas)`,
    );
    expect(
      infractores,
      "alguien volvió a mirar el estado de la orden a mano en `/novedades`. Ése es el diseño que " +
        "produjo el punto 12 —«Habilitar» justo en las cards donde no debía— porque nada obliga a " +
        "la condición del OTRO grupo. El juego de botones sale de `ACCIONES_POR_GRUPO` y el grupo " +
        "de `grupoDeEstatus`; si hace falta una decisión nueva, va en la tabla.",
    ).toEqual([]);
  });

  it("y ningún archivo de la pantalla escribe un literal de estatus", () => {
    // El corolario legible del caso de arriba: si no se puede comparar, tampoco hace falta el
    // literal. Se dice aparte porque el mensaje que hay que leer es distinto.
    const conLiteral = FUENTES.filter((m) => literalesDeEstatus(m.codigo).length > 0).map(
      (m) => `${m.ruta}: ${literalesDeEstatus(m.codigo).join(", ")}`,
    );
    expect(
      conLiteral,
      "un estatus escrito a mano en esta pantalla es el principio de las dos verdades: el " +
        "servidor listaría una cosa y la pantalla ofrecería los botones de otra. El valor sale de " +
        "`ESTATUS_POR_GRUPO` y de ningún otro sitio.",
    ).toEqual([]);
  });
});

// =============================================================================================
// R2/R8 — el corte es del SERVIDOR: la pantalla no lo rehace
// =============================================================================================

describe("236/R2/R8 — ningún componente de `/novedades` particiona la lista por estado", () => {
  it("ningún recorrido de `items` mira el estatus ni el grupo", () => {
    const infractores = FUENTES.flatMap((m) =>
      particionesPorEstado(m.codigo).map((linea) => `${m.ruta}: ${linea}`),
    );
    expect(
      infractores,
      "la partición de las dos poblaciones la hace el SERVIDOR (un predicado por grupo, una " +
        "Server Action por grupo). Rehacerla aquí es el fallo que la 235 midió y documentó: «el " +
        "corte era MAQUETACIÓN» — la orden se quitaba de una lista y seguía siendo parada del " +
        "optimizador, del mapa y del panel de gestión. Además la paginación mentiría: el servidor " +
        "pagina de diez en diez sobre el universo que le pidas, así que una pestaña podría salir " +
        "vacía teniendo órdenes en la página 2 de la otra.",
    ).toEqual([]);
  });
});
