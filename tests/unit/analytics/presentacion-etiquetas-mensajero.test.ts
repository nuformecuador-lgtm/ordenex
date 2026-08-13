import { describe, it, expect } from "vitest";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import fs from "fs";
import path from "path";

import { PANELES_OPERATIVOS } from "@/app/(app)/analitica/_components/operativo/catalogo-paneles";
import type { PanelTablero } from "@/app/(app)/analitica/_components/operativo/catalogo-paneles";
import { ETIQUETA_MENSAJERO } from "@/lib/analytics/identidad";

// Feature 133 (T6.7) — R26: LAS ETIQUETAS `Mensajero 1..N` NO SON ESTABLES, Y NO SE PROMETE
// QUE LO SEAN.
//
// El hecho, con su linea (H17): bajo politica seudonima el ordinal se asigna POR ORDEN DE
// PRIMERA APARICION dentro de la respuesta y el mapa inverso muere con la llamada
// (`lib/analytics/identidad.ts:54-72`, R38/R39 de la 122). Eso es deliberado: un ordinal
// derivado del uuid seria estable ENTRE consultas y permitiria correlacionar y desanonimizar
// por interseccion. El precio asumido, escrito en ese mismo archivo, es que las etiquetas
// pueden bailar entre dos consultas — «y eso la UI no debe prometerlo (aviso a la 130/133)».
//
// Prometer estabilidad no es solo poner un texto que diga «estable»: es OFRECER UN CONTROL
// que solo tiene sentido si lo fuera. Guardar un filtro, fijarlo, marcarlo como favorito o
// compartirlo son exactamente eso — un filtro guardado como «Mensajero 3» apuntaria manana a
// otra persona, en silencio y sin que nada falle.
//
// Este archivo tiene por tanto DOS mitades:
//   (1) el CENSO de que ese control no existe —ni como boton, ni como persistencia, ni como
//       copiado— y de que ninguna etiqueta seudonima entra jamas en el filtro;
//   (2) el TRIPWIRE de la advertencia. Hoy NINGUNA leyenda del tablero usa esas etiquetas
//       (ningun panel pide `desagregacion: "mensajero"`), asi que el «DONDE aparezcan» de
//       R26 no tiene antecedente que cumplir. La cobertura de esa mitad esta VACIA POR
//       AUSENCIA DE SUPERFICIE, y se declara aqui en voz alta en vez de fingirse: lo que se
//       deja montado es el criterio que se pondra rojo el dia que la superficie aparezca sin
//       la advertencia.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

/** Los dos arboles donde podria vivir un control de filtro o una leyenda del tablero. */
const ARBOLES = ["app/(app)/analitica", "components/private/analytics"];

function recorrer(dirRelativo: string): string[] {
  const abs = path.join(REPO_ROOT, dirRelativo);
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = `${dirRelativo}/${e.name}`;
    if (e.isDirectory()) return recorrer(rel);
    return [".ts", ".tsx"].includes(path.extname(e.name)) ? [rel] : [];
  });
}

/**
 * Se censa el CODIGO, no los comentarios: varios archivos del arbol estan obligados a
 * NOMBRAR lo que no hacen para explicar por que no lo hacen (este mismo repo lo exige en
 * `catalogo-paneles.ts`), y censar el texto crudo convertiria el contrato escrito en una
 * violacion.
 */
function soloCodigo(fuente: string): string {
  return quitarComentarios(fuente);
}

const CENSADOS = ARBOLES.flatMap(recorrer).map((rel) => ({
  ruta: rel,
  codigo: soloCodigo(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")),
}));

/* ========================================================================== */
/* (1) CENSO — no existe control que prometa estabilidad a esas etiquetas      */
/* ========================================================================== */

describe("Feature 133 (R26) — no hay forma de guardar, fijar, marcar ni compartir un filtro", () => {
  const PROHIBIDOS: readonly { readonly patron: RegExp; readonly motivo: string }[] = [
    {
      patron: /\b(localStorage|sessionStorage|indexedDB)\b/,
      motivo:
        "PERSISTE algo en el navegador: un filtro guardado sobrevive a la consulta en la " +
        "que sus etiquetas tenian sentido",
    },
    {
      patron: /navigator\s*\.\s*clipboard|document\s*\.\s*execCommand/,
      motivo: "ofrece COPIAR el filtro, que es compartirlo con otro nombre",
    },
    {
      // Texto de UI: tanto el que va en una cadena (`aria-label`, constante de `textos.ts`)
      // como el que va suelto entre etiquetas JSX. El `(?<!=)` deja fuera las flechas `=>`,
      // que no son el comienzo de un nodo de texto.
      patron: /(["'`]|(?<!=)>)[^"'`<>]*\b(Guardar|Fijar|Anclar|Favorit\w*|Compartir)\b/i,
      motivo:
        "declara un texto de UI de guardar/fijar/anclar/favorito/compartir, que es el " +
        "control que R26 prohibe",
    },
  ];

  it("el censo mira archivos de verdad", () => {
    expect(CENSADOS.length).toBeGreaterThan(10);
    for (const nombre of [
      "app/(app)/analitica/_components/operativo/FiltrosOperativos.tsx",
      "app/(app)/analitica/_components/operativo/filtro-tablero.ts",
      "components/private/analytics/SerieTextual.tsx",
    ]) {
      expect(
        CENSADOS.map((c) => c.ruta),
        `el censo no esta mirando ${nombre}`,
      ).toContain(nombre);
    }
    for (const { ruta, codigo } of CENSADOS) {
      expect(codigo.trim().length, `${ruta} quedo vacio al retirar comentarios`).toBeGreaterThan(0);
    }
  });

  for (const { patron, motivo } of PROHIBIDOS) {
    it(`ningun archivo del tablero ${motivo}`, () => {
      expect(CENSADOS.filter(({ codigo }) => patron.test(codigo)).map((c) => c.ruta)).toEqual([]);
    });
  }

  it("el censo DISCRIMINA: casa en codigo y no en una mencion en prosa", () => {
    const infractor = soloCodigo(
      [
        'window.localStorage.setItem("analitica-filtro", JSON.stringify(filtro));',
        "await navigator.clipboard.writeText(url);",
        '<Button onClick={fijar}>Guardar este filtro</Button>',
      ].join("\n"),
    );
    expect(PROHIBIDOS.every(({ patron }) => patron.test(infractor))).toBe(true);

    const prosa = soloCodigo(
      [
        "// no se puede Guardar ni Compartir el filtro, ni se usa localStorage",
        "/* ni navigator.clipboard: las etiquetas no son estables */",
        "export const FILTRO = {};",
      ].join("\n"),
    );
    expect(PROHIBIDOS.some(({ patron }) => patron.test(prosa))).toBe(false);
  });
});

describe("Feature 133 (R26) — una etiqueta seudonima nunca entra en el filtro", () => {
  /**
   * La otra mitad de «no prometer estabilidad»: aunque no haya boton de guardar, la URL del
   * tablero SI es compartible (`filtro-tablero.ts:5-10`). Lo que se comparte, entonces, no
   * puede ser una etiqueta ordinal — porque el receptor la resolveria contra otra respuesta
   * y otro orden de aparicion. Y no lo es: el filtro viaja por ID en las tres dimensiones,
   * y ningun archivo del tablero compone la etiqueta `Mensajero N` para meterla en el.
   */
  it("ningun archivo del tablero compone la etiqueta ordinal", () => {
    const patron = new RegExp(`["'\`]\\s*${ETIQUETA_MENSAJERO}\\s*\\$\\{|${ETIQUETA_MENSAJERO}\\s+\\d`);
    expect(CENSADOS.filter(({ codigo }) => patron.test(codigo)).map((c) => c.ruta)).toEqual([]);
    // Y el patron discrimina: asi se compone la etiqueta en `lib/analytics/identidad.ts`.
    expect(patron.test("const nueva = `Mensajero ${etiquetas.size + 1}`;")).toBe(true);
  });

  it("el parametro del filtro es el ID de la dimension, no su etiqueta de leyenda", () => {
    const filtro = fs.readFileSync(
      path.join(REPO_ROOT, "app/(app)/analitica/_components/operativo/filtro-tablero.ts"),
      "utf8",
    );
    expect(filtro).toContain('mensajero_id?: string[]');
    expect(soloCodigo(filtro)).not.toContain(ETIQUETA_MENSAJERO);
  });
});

/* ========================================================================== */
/* (2) TRIPWIRE — la advertencia, el dia que haya donde ponerla                */
/* ========================================================================== */

describe("Feature 133 (R26) — hoy ninguna leyenda usa las etiquetas seudonimas", () => {
  /**
   * Las etiquetas `Mensajero 1..N` solo existen en una respuesta pedida con
   * `desagregacion: "mensajero"` (`identidad.ts:74-87`, y solo bajo politica seudonima). El
   * tablero no pide ese grano en ningun panel: la unica desagregacion declarada es
   * `estatus`. Por eso NO HAY hoy ninguna leyenda donde esas etiquetas puedan aparecer, y el
   * «DONDE aparezcan … el sistema DEBE advertir» de R26 se queda sin antecedente.
   *
   * Esto NO es cobertura: es la ausencia de la superficie que habria que cubrir, declarada.
   * No se inventa un panel nuevo para tener algo que probar —eso seria escribir produccion
   * para satisfacer un test— y no se da por cubierta la advertencia.
   */
  it("la unica desagregacion que el tablero pide es `estatus`", () => {
    const pedidas = PANELES_OPERATIVOS.map((p) => p.desagregacion).filter(
      (d): d is NonNullable<PanelTablero["desagregacion"]> => d !== undefined,
    );
    // No pasa por vacio: hay al menos una desagregacion declarada, y no es `mensajero`.
    expect(pedidas.length).toBeGreaterThan(0);
    expect([...new Set(pedidas)]).toEqual(["estatus"]);
  });

  /**
   * El criterio que quedara montado. Se expresa como funcion de DOS entradas —los paneles y
   * el texto de advertencia disponible— para poder afirmarlo hoy sobre el tablero real y, a
   * la vez, demostrar que discrimina con un panel sintetico. Sin esa segunda mitad, una
   * implicacion sin antecedentes seria verde para siempre y por vacio.
   */
  function cumpleLaAdvertencia(
    paneles: readonly PanelTablero[],
    advertencia: string | null,
  ): boolean {
    const conEtiquetasSeudonimas = paneles.filter((p) => p.desagregacion === "mensajero");
    if (conEtiquetasSeudonimas.length === 0) return true;
    return advertencia !== null && /no son estables|cambian entre consultas/i.test(advertencia);
  }

  const PANEL_SINTETICO: PanelTablero = {
    id: "carga-por-mensajero",
    titulo: "Carga por mensajero",
    grafica: "barras",
    // `unidad` es OBLIGATORIA desde la 182: es lo que decide si un panel se agrega por
    // semana. Aqui es relleno del panel sintetico —lo que este caso mide es la
    // desagregacion por mensajero, no la unidad— y por eso lleva la mas inocua.
    metricas: [{ metricaId: "entregas", etiqueta: "Entregas", unidad: "conteo" }],
    desagregacion: "mensajero",
  };

  it("el tablero de hoy cumple R26 porque no tiene esa leyenda", () => {
    expect(cumpleLaAdvertencia(PANELES_OPERATIVOS, null)).toBe(true);
  });

  it("y el criterio discrimina: con la leyenda y sin advertencia, R26 se incumple", () => {
    expect(cumpleLaAdvertencia([...PANELES_OPERATIVOS, PANEL_SINTETICO], null)).toBe(false);
    expect(
      cumpleLaAdvertencia(
        [...PANELES_OPERATIVOS, PANEL_SINTETICO],
        "Las etiquetas de mensajero no son estables entre consultas: no identifican a la misma persona en dos cargas distintas.",
      ),
    ).toBe(true);
  });

  it("y hoy no existe tal advertencia en los textos del tablero, porque no hay donde ponerla", () => {
    // Declarado, no escondido: si alguien anade el panel de arriba, el caso anterior le dice
    // exactamente que le falta.
    const textos = fs.readFileSync(
      path.join(REPO_ROOT, "app/(app)/analitica/_components/operativo/textos.ts"),
      "utf8",
    );
    expect(/no son estables|cambian entre consultas/i.test(soloCodigo(textos))).toBe(false);
  });
});
