import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { quitarComentarios } from "../../fixtures/sin-comentarios";

// GUARDIA DEL ARNES — FICHA 454 (T1.3, design §3/§4.3) — «GESTION PENDIENTE» Y «AYUDA ABIERTA»
// TIENEN UNA SOLA DEFINICION CADA UNA.
//
// Las dos son DERIVACIONES sobre `orden_evento`, no columnas. Su valor depende de que TODOS los
// consumidores (guardia de gestionabilidad, portal, corte, traspaso, cambio de dia, novedades, hilo,
// avisos...) pregunten lo MISMO. Si un repositorio reescribe el predicado a mano —p. ej. se olvida
// del `cierre.estado <> aprobado`, o del «estrictamente posterior» de la ayuda— la aplicacion
// empieza a decir dos cosas distintas sobre la misma orden, y el sintoma es de dinero: el corte
// barre una orden gestionada (D4) o el mensajero la gestiona dos veces.
//
// Regla medida: FUERA de los modulos del predicado, los literales `gestion_registrada` y
// `ayuda_solicitada` solo pueden aparecer en una ESCRITURA (el `data` de un `create`, o un
// `INSERT`), nunca en un `where`. Se lee el CODIGO sin comentarios (los comentarios los nombran a
// proposito). Heuristica declarada: para cada aparicion se mira hacia atras la ultima palabra
// clave entre `where`/`WHERE`/`some`/`none`/`every` (lectura) y `data`/`INSERT`/`VALUES`
// (escritura); gana la mas cercana.
//
// SE DECLARA COMO GUARDIA PORQUE ESCANEA EL ARBOL: ningun grafo de imports la seleccionaria.

const RAIZ = path.resolve(__dirname, "..", "..", "..");

const MODULOS_DEL_PREDICADO = new Set([
  "lib/types/orden-evento.ts",
  "lib/repositories/gestion-pendiente.ts",
  "lib/repositories/ayuda-abierta.ts",
]);

function archivos(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(e.name)) {
        out.push(path.relative(RAIZ, full).split(path.sep).join("/"));
      }
    }
  };
  walk(path.join(RAIZ, "lib"));
  walk(path.join(RAIZ, "app"));
  return out;
}

const LECTURA = /\b(where|WHERE|some|none|every)\b/g;
const ESCRITURA = /\b(data|INSERT|VALUES)\b/g;

function ultimaPosicion(re: RegExp, texto: string): number {
  let ultima = -1;
  for (const m of texto.matchAll(re)) ultima = m.index ?? ultima;
  return ultima;
}

/** Las apariciones de `literal` en lectura (un `where`) fuera de los modulos del predicado. */
function lecturasFuera(literal: string): string[] {
  const hallazgos: string[] = [];
  for (const rel of archivos()) {
    if (MODULOS_DEL_PREDICADO.has(rel)) continue;
    const codigo = quitarComentarios(fs.readFileSync(path.join(RAIZ, rel), "utf8"));
    let desde = 0;
    for (;;) {
      const i = codigo.indexOf(literal, desde);
      if (i < 0) break;
      desde = i + literal.length;
      const antes = codigo.slice(Math.max(0, i - 400), i);
      if (ultimaPosicion(LECTURA, antes) > ultimaPosicion(ESCRITURA, antes)) {
        const linea = codigo.slice(0, i).split("\n").length;
        hallazgos.push(`${rel}:${linea}`);
      }
    }
  }
  return hallazgos;
}

describe("454/T1.3 · guardia: gestion pendiente y ayuda abierta, una sola definicion", () => {
  it("autocomprobacion: el recorrido ve el arbol y los modulos del predicado existen", () => {
    const todos = archivos();
    expect(todos.length).toBeGreaterThan(500);
    for (const m of MODULOS_DEL_PREDICADO) expect(todos, m).toContain(m);
  });

  it("autocomprobacion: la heuristica DETECTA un `where` con el literal y deja pasar un `data`", () => {
    const leer = (codigo: string) => {
      const i = codigo.indexOf("gestion_registrada");
      const antes = codigo.slice(0, i);
      return ultimaPosicion(LECTURA, antes) > ultimaPosicion(ESCRITURA, antes);
    };
    expect(leer(`tx.gestionOrden.count({ where: { eventos: { some: { tipo: "gestion_registrada" } } } })`)).toBe(true);
    expect(leer(`tx.ordenEvento.create({ data: { tipo: "gestion_registrada", ordenId } })`)).toBe(false);
    expect(leer(`INSERT INTO "orden_evento" ("tipo") VALUES ('gestion_registrada')`)).toBe(false);
    expect(leer(`WHERE "e"."tipo" = 'gestion_registrada'`)).toBe(true);
  });

  it("⭑ `gestion_registrada` no se lee en ningun `where` fuera de `gestion-pendiente.ts`", () => {
    expect(lecturasFuera("gestion_registrada")).toEqual([]);
  });

  it("⭑ `ayuda_solicitada` no se lee en ningun `where` fuera de `ayuda-abierta.ts`", () => {
    expect(lecturasFuera("ayuda_solicitada")).toEqual([]);
  });
});
