import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { quitarComentarios } from "../../fixtures/sin-comentarios";

/**
 * Ficha 314 — GUARDIA de los ÁMBITOS de preferencia de columnas. Cubre R10 y R33.
 *
 * ── EL FALLO MUDO QUE ESTA GUARDIA EXISTE PARA CAZAR ──────────────────────────────────────
 * Un `ambitoColumnas` es la mitad de una clave de `localStorage`. Dos tablas distintas que
 * declaren el MISMO identificador comparten preferencia sin saberlo: quien oculte «Zona» en
 * una la pierde en la otra, en otra pantalla, sin ningún error, sin ningún test rojo y sin
 * ninguna forma de relacionar una cosa con la otra. Nada en el compilador lo impide —son dos
 * cadenas iguales— y ninguna prueba de pantalla lo vería, porque cada una monta la suya.
 *
 * Es exactamente la familia de fallo que R10 declara inaceptable: «cambiar la preferencia de un
 * ámbito NO DEBE alterar la de ningún otro». Por construcción se cumple mientras los
 * identificadores sean únicos, así que lo que hay que vigilar es la unicidad.
 *
 * ── NO CENSA UNA LISTA DE TABLAS, Y ES DELIBERADO ─────────────────────────────────────────
 * Encender el selector en la siguiente tabla tiene que seguir costando UNA línea en su módulo.
 * Si esta guardia llevara una lista de tablas con ámbito, costaría dos —y la segunda se
 * olvidaría—. Descubre lo que hay barriendo el árbol; una tabla nueva entra sola.
 *
 * ── POR QUÉ SE AUTOCOMPRUEBA ──────────────────────────────────────────────────────────────
 * Un detector roto pasa VERDE: encuentra cero declaraciones, no encuentra cero duplicados y se
 * queda de adorno para siempre. Este repo ya se lo comió una vez. Por eso el primer caso no
 * mira el árbol: mira el DETECTOR, con un canario real (órdenes declara el suyo, y lo hace a
 * través de una CONSTANTE, así que el detector tiene que resolverla) y dos negativos
 * sintéticos.
 */

const RAIZ = path.resolve(__dirname, "../../..");

/** Los dos árboles de UI. Un ámbito solo puede declararse donde se monta una tabla. */
const ARBOLES_UI = ["app", "components"] as const;

/** Un identificador de ámbito es una etiqueta de máquina: minúsculas, dígitos y guiones. */
const FORMA_AMBITO = /^[a-z0-9-]+$/;

export interface Modulo {
  ruta: string;
  fuente: string;
}

export interface AmbitoDeclarado {
  ruta: string;
  /** Lo escrito a la derecha de `ambitoColumnas:`, tal cual. */
  expresion: string;
  /** El valor resuelto, o `null` si el detector no supo resolverlo. */
  valor: string | null;
}

function listarFuentes(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listarFuentes(completo, acc);
    else if (/\.tsx?$/.test(entrada.name)) acc.push(completo);
  }
  return acc;
}

function rutaRelativa(archivo: string): string {
  return path.relative(RAIZ, archivo).split(path.sep).join("/");
}

/** Los módulos de UI, con los comentarios ya fuera: una FRASE no declara un ámbito. */
function modulosDeUi(): Modulo[] {
  return ARBOLES_UI.flatMap((arbol) => listarFuentes(path.join(RAIZ, arbol)))
    .map((archivo) => ({
      ruta: rutaRelativa(archivo),
      fuente: quitarComentarios(readFileSync(archivo, "utf8")),
    }))
    .sort((a, b) => a.ruta.localeCompare(b.ruta));
}

/**
 * Mapa `IDENTIFICADOR -> literal` de las `export const X = "…"` del árbol.
 *
 * Hace falta porque lo idiomático —y lo que hace órdenes— es declarar el ámbito con una
 * constante exportada junto al catálogo, no con una cadena suelta en el JSX. Un detector que
 * solo entendiera literales daría por vacío el árbol entero: cero declaraciones, cero
 * duplicados, verde de adorno.
 */
export function constantesDeTexto(modulos: readonly Modulo[]): Map<string, string> {
  const constantes = new Map<string, string>();
  const declaracion = /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*"([^"]*)"/g;
  for (const modulo of modulos) {
    for (const encontrada of modulo.fuente.matchAll(declaracion)) {
      constantes.set(encontrada[1]!, encontrada[2]!);
    }
  }
  return constantes;
}

/**
 * Toda declaración `ambitoColumnas: <algo>` del árbol, con su valor resuelto.
 *
 * `ambitoColumnas?: string` (la del contrato del `DataTable`) NO casa: el `?` va entre el
 * nombre y los dos puntos. Lo que se busca es quien ASIGNA un ámbito, no quien lo declara.
 */
export function ambitosDeclarados(
  modulos: readonly Modulo[],
  constantes: Map<string, string>,
): AmbitoDeclarado[] {
  const asignacion = /\bambitoColumnas\s*:\s*([^,\n}]+)/g;
  const declarados: AmbitoDeclarado[] = [];
  for (const modulo of modulos) {
    for (const encontrada of modulo.fuente.matchAll(asignacion)) {
      const expresion = encontrada[1]!.trim().replace(/;$/, "");
      const literal = /^"([^"]*)"$|^'([^']*)'$/.exec(expresion);
      const identificador = /^[A-Za-z_$][\w$]*$/.test(expresion);
      const valor = literal
        ? (literal[1] ?? literal[2] ?? "")
        : identificador
          ? (constantes.get(expresion) ?? null)
          : null;
      declarados.push({ ruta: modulo.ruta, expresion, valor });
    }
  }
  return declarados;
}

/** Identificadores declarados en MÁS DE UN módulo: el fallo mudo que esto vigila. */
export function ambitosRepetidos(
  declarados: readonly AmbitoDeclarado[],
): Array<{ valor: string; rutas: string[] }> {
  const porValor = new Map<string, Set<string>>();
  for (const { valor, ruta } of declarados) {
    if (valor === null) continue;
    porValor.set(valor, (porValor.get(valor) ?? new Set()).add(ruta));
  }
  return [...porValor.entries()]
    .filter(([, rutas]) => rutas.size > 1)
    .map(([valor, rutas]) => ({ valor, rutas: [...rutas].sort() }));
}

const MODULOS = modulosDeUi();
const CONSTANTES = constantesDeTexto(MODULOS);
const DECLARADOS = ambitosDeclarados(MODULOS, CONSTANTES);

describe("guardia: los ámbitos de preferencia de columnas son únicos y con forma de etiqueta", () => {
  it("AUTOCOMPROBACIÓN: el detector ve el canario real y rechaza los dos negativos", () => {
    // (a) CANARIO. Órdenes declara su ámbito, y lo hace a través de una constante exportada:
    // si el detector no resolviera identificadores, esto sería `null` y todo lo demás pasaría
    // verde sin mirar nada.
    const canario = DECLARADOS.find((d) =>
      d.ruta.endsWith("app/(app)/ordenes/_components/OrdenesModule.tsx"),
    );
    expect(
      canario,
      "DETECTOR ROTO: no se ve la declaración de ámbito de OrdenesModule, que SÍ existe. Si no ve ésta, no ve ninguna y esta guardia no vigila nada.",
    ).toBeDefined();
    expect(
      canario!.valor,
      `DETECTOR ROTO: no se resolvió la constante \`${canario!.expresion}\` a su literal. Un detector que solo entienda cadenas sueltas da el árbol por vacío.`,
    ).toBe("ordenes");

    // (b) NEGATIVO 1 — dos módulos con el MISMO identificador se denuncian.
    const duplicado: Modulo[] = [
      { ruta: "app/uno/Tabla.tsx", fuente: 'descarga={{ ambitoColumnas: "envios" }}' },
      { ruta: "app/dos/Tabla.tsx", fuente: 'descarga={{ ambitoColumnas: "envios" }}' },
    ];
    const repetidos = ambitosRepetidos(
      ambitosDeclarados(duplicado, new Map()),
    );
    expect(
      repetidos,
      "DETECTOR DEMASIADO LAXO: dos tablas compartiendo el mismo ámbito —y por tanto la misma preferencia— pasaron sin denunciarse.",
    ).toEqual([
      { valor: "envios", rutas: ["app/dos/Tabla.tsx", "app/uno/Tabla.tsx"] },
    ]);

    // (c) NEGATIVO 2 — un identificador con forma inválida se ve como tal.
    const invalido = ambitosDeclarados(
      [{ ruta: "app/tres/Tabla.tsx", fuente: 'ambitoColumnas: "Órdenes Todas",' }],
      new Map(),
    );
    expect(invalido[0]!.valor).toBe("Órdenes Todas");
    expect(FORMA_AMBITO.test(invalido[0]!.valor!)).toBe(false);

    // (d) El `?:` del contrato del `DataTable` NO es una declaración de ámbito.
    expect(
      ambitosDeclarados(
        [{ ruta: "components/shared/DataTable.tsx", fuente: "  ambitoColumnas?: string;" }],
        new Map(),
      ),
      "DETECTOR DEMASIADO ÁVIDO: confundió la declaración del TIPO con la asignación de un ámbito.",
    ).toEqual([]);

    // (e) Y un comentario que lo mencione tampoco declara nada.
    expect(
      ambitosDeclarados(
        [
          {
            ruta: "app/cuatro/Tabla.tsx",
            fuente: quitarComentarios('// mañana: ambitoColumnas: "pendiente"\nconst x = 1;'),
          },
        ],
        new Map(),
      ),
    ).toEqual([]);
  });

  it("todo ámbito declarado en el árbol se resuelve a un identificador con forma de etiqueta", () => {
    const sinResolver = DECLARADOS.filter((d) => d.valor === null).map(
      (d) => `${d.ruta}: ${d.expresion}`,
    );
    expect(
      sinResolver,
      "un ámbito que esta guardia no puede resolver es un ámbito que no puede comprobar. " +
        "Declara el identificador como `export const AMBITO_X = \"…\";` junto a sus columnas, " +
        "o como una cadena literal.",
    ).toEqual([]);

    const malFormados = DECLARADOS.filter(
      (d) => d.valor !== null && !FORMA_AMBITO.test(d.valor),
    ).map((d) => `${d.ruta}: ${d.valor}`);
    expect(
      malFormados,
      "un identificador de ámbito viaja dentro de una clave de `localStorage`: minúsculas, dígitos y guiones.",
    ).toEqual([]);
  });

  it("ningún identificador de ámbito se repite en dos módulos", () => {
    const repetidos = ambitosRepetidos(DECLARADOS).map(
      ({ valor, rutas }) => `${valor} → ${rutas.join(" + ")}`,
    );
    expect(
      repetidos,
      "dos tablas comparten identificador de ámbito y, con él, la MISMA preferencia de columnas " +
        "en el navegador del usuario: ocultar una columna en una la ocultaría en la otra, en otra " +
        "pantalla, sin ningún error. Dale a cada una el suyo (R10).",
    ).toEqual([]);
  });

  it("el barrido mira los DOS árboles de UI y no se queda vacío", () => {
    // Sin esto, un recorrido que dejara de encontrar archivos daría todo por bueno: cero
    // declaraciones, cero duplicados, verde. El suelo es MÍNIMO, no igualdad: encender la
    // siguiente tabla no debe obligar a tocar este número.
    expect(MODULOS.length).toBeGreaterThan(100);
    for (const arbol of ARBOLES_UI) {
      expect(
        MODULOS.filter((m) => m.ruta.startsWith(`${arbol}/`)).length,
        `el árbol \`${arbol}\` no aporta ni un archivo al barrido`,
      ).toBeGreaterThan(0);
    }
    // Y hoy hay al menos una declaración: la de órdenes. Si mañana no hubiera ninguna, el
    // canario de arriba lo diría por su nombre.
    expect(DECLARADOS.length).toBeGreaterThanOrEqual(1);
  });
});
