import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { quitarComentarios } from "../../fixtures/sin-comentarios";

// GUARDIA DEL ARNES — FICHA 454 (T1.9, design §10, DA) — NINGUNA GESTION SINTETICA LLEVA EL EVENTO
// `gestion_registrada`.
//
// La 6.ª condicion de `whereIntentosVigentes` gano una SEGUNDA via de inclusion: una gestion cuenta
// como intento si tiene el evento `gestion_registrada` (la `devuelta` nueva se aplica con la familia
// `anclaje_devolucion`, que no puede entrar en `ORIGEN_TIPOS_VISITA_REAL`). Esa via solo es segura
// mientras el evento lo escriban EXCLUSIVAMENTE las dos vias de CALLE: el mensajero
// (`registrarGestionPendiente`) y la tienda desde una ayuda (`crearGestionDesdeAyuda`). Si un
// productor sintetico —el escalado por plazo, reprogramar/rechazar desde `devuelta`, la correccion
// #69 del admin, el corte— lo escribiera, sus gestiones empezarian a contar como intento, alguien
// llegaria al tope antes de tiempo y la tienda pagaria un rechazo que nadie hizo en la calle.
//
// Regla medida: cada ESCRITURA del literal (`tipo: "gestion_registrada"` en un `data`, o un
// `INSERT ... 'gestion_registrada'`) en `lib/` y `app/` vive en uno de los dos metodos permitidos.
// Se lee el CODIGO sin comentarios. Heuristica declarada: el metodo que contiene la escritura es la
// ultima cabecera de metodo de clase (indentada a 2) o de `function` antes de ella. Limite
// declarado: una escritura con el tipo en una VARIABLE no se ve; por eso la autocomprobacion exige
// que se vean EXACTAMENTE las dos escrituras de hoy (una tercera, o una que desaparezca, la pone roja).
//
// SE DECLARA COMO GUARDIA PORQUE ESCANEA EL ARBOL: ningun grafo de imports la seleccionaria.

const RAIZ = path.resolve(__dirname, "..", "..", "..");

const PERMITIDOS = new Set([
  "lib/repositories/GestionOrdenRepository.ts#registrarGestionPendiente",
  "lib/repositories/GestionOrdenRepository.ts#crearGestionDesdeAyuda",
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
/** El literal como VALOR del campo `tipo` (Prisma) o como literal SQL. */
const LITERAL = /tipo["']?\s*:\s*["']gestion_registrada["']|'gestion_registrada'/g;
const CABECERA = /\n(?: {2}(?:(?:public|private|protected|static|async)\s+)*(?!(?:if|for|while|switch|catch|return|await)\b)([A-Za-z_$][\w$]*)\s*\(|(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\()/g;

function ultimaPosicion(re: RegExp, texto: string): number {
  let ultima = -1;
  for (const m of texto.matchAll(re)) ultima = m.index ?? ultima;
  return ultima;
}

function metodoQueContiene(codigo: string, i: number): string {
  let nombre = "(modulo)";
  for (const m of codigo.slice(0, i).matchAll(CABECERA)) nombre = m[1] ?? m[2] ?? nombre;
  return nombre;
}

/** Cada escritura del literal en `codigo`, como `metodo`. */
function escriturasEn(codigo: string): string[] {
  const out: string[] = [];
  for (const m of codigo.matchAll(LITERAL)) {
    const i = m.index ?? 0;
    const antes = codigo.slice(Math.max(0, i - 400), i);
    if (ultimaPosicion(ESCRITURA, antes) > ultimaPosicion(LECTURA, antes)) out.push(metodoQueContiene(codigo, i));
  }
  return out;
}

function escrituras(): string[] {
  const out: string[] = [];
  for (const rel of archivos()) {
    const codigo = quitarComentarios(fs.readFileSync(path.join(RAIZ, rel), "utf8"));
    for (const metodo of escriturasEn(codigo)) out.push(`${rel}#${metodo}`);
  }
  return out;
}

describe("454/T1.9 · guardia: ninguna gestion sintetica lleva el evento `gestion_registrada`", () => {
  it("autocomprobacion: la heuristica ve una escritura, ignora un `where` y atribuye el metodo", () => {
    const clase = [
      "class R {",
      "  async registrarGestionPendiente(input: X) {",
      "    await tx.ordenEvento.create({ data: { ordenId, tipo: \"gestion_registrada\" } });",
      "  }",
      "  async escalarDevueltaSla(input: Y) {",
      "    const n = await tx.gestionOrden.count({ where: { eventos: { some: { tipo: \"gestion_registrada\" } } } });",
      "    await tx.$executeRaw`INSERT INTO \"orden_evento\" (\"tipo\") VALUES ('gestion_registrada')`;",
      "  }",
      "}",
    ].join("\n");
    expect(escriturasEn(clase)).toEqual(["registrarGestionPendiente", "escalarDevueltaSla"]);
  });

  it("autocomprobacion: se ven EXACTAMENTE las dos escrituras de hoy (ni una de mas, ni una de menos)", () => {
    const todas = escrituras();
    expect(todas.sort()).toEqual([...PERMITIDOS].sort());
  });

  it("⭑ toda escritura del evento vive en una de las dos vias de CALLE", () => {
    expect(escrituras().filter((e) => !PERMITIDOS.has(e))).toEqual([]);
  });

  it("⭑ los productores SINTETICOS conocidos no nombran el evento en su cuerpo", () => {
    const productores: [string, string][] = [
      ["lib/repositories/DevolucionSlaRepository.ts", "escalarDevueltaSla"],
      ["lib/repositories/GestionOrdenRepository.ts", "reprogramarDesdeDevuelta"],
      ["lib/repositories/GestionOrdenRepository.ts", "rechazarDesdeDevuelta"],
    ];
    for (const [rel, metodo] of productores) {
      const codigo = quitarComentarios(fs.readFileSync(path.join(RAIZ, rel), "utf8"));
      const inicio = codigo.search(new RegExp(`\\n {2}async ${metodo}\\(`));
      expect(inicio, `${rel}#${metodo} existe`).toBeGreaterThan(0);
      const resto = codigo.slice(inicio + 1);
      const fin = resto.search(/\n {2}(?:async\s+)?(?!(?:if|for|while|switch|catch|return|await)\b)[A-Za-z_$][\w$]*\s*\(/);
      const cuerpo = fin < 0 ? resto : resto.slice(0, fin);
      expect(cuerpo.length, `${rel}#${metodo} tiene cuerpo`).toBeGreaterThan(100);
      expect(cuerpo.includes("gestion_registrada"), `${rel}#${metodo}`).toBe(false);
    }
  });
});
