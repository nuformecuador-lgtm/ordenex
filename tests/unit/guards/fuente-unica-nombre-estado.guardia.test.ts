// GUARDIA — FICHA 455 (T1.10 · G3, design §6.3; R3, R12, R42, R44): EL NOMBRE DE UN ESTADO VIVE EN
// UN SOLO SITIO.
//
// Antes de la 455 cada superficie escribia su propio mapa `codigo -> texto` (el chip de `/ordenes`,
// el rastreo, WhatsApp, la analitica, el chat del mensajero…) o «humanizaba» el codigo cambiando los
// guiones bajos por espacios. Por eso divergian. La fuente unica es `NOMBRE_ESTADO`
// (`lib/types/order-status.ts`) y esta guardia denuncia, fuera de ella:
//   (a) un objeto literal con DOS o mas claves que son codigos de estado vigentes y cuyos valores son
//       TEXTO VISIBLE (una cadena con mayuscula o espacio que no es una clase de Tailwind ni un token
//       de variante): es un segundo mapa de nombres (R42);
//   (b) `.replaceAll("_", " ")` o `.replace(/_/g, " ")` sobre algo cuyo nombre dice estado/estatus/
//       status: es humanizar un codigo (R3);
//   (c) un objeto literal con DOS o mas claves que son NOMBRES VISIBLES de la tabla §0.1: un mapa de
//       presentacion indexado por el texto y no por el codigo (R12, el caso de `pos-estado.ts`).
// Un mapa `codigo -> clase/variante/color` es legitimo (R12 lo pide asi) y no se denuncia.
//
// ⏳ FASE 1 → FASE 2 (2026-09-24): lo que la pantalla todavia hace mal vive en `PENDIENTES_FASE_2`
// con el numero exacto; la Fase 2 lo vacia sin anadir nada (T2.9).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { NOMBRE_ESTADO, ORDER_STATUS_SEED } from "@/lib/types/order-status";
import { NOMBRES_RETIRADOS } from "../../fixtures/nombres-retirados-455";

const RAIZ = path.resolve(__dirname, "../../..");
const CODIGOS = new Set<string>(ORDER_STATUS_SEED);
// Nombres visibles vigentes Y retirados (§0.3): un mapa indexado por cualquiera de ellos es un mapa por texto.
const NOMBRES = new Set<string>([...Object.values(NOMBRE_ESTADO), ...NOMBRES_RETIRADOS]);
const FUENTE_UNICA = "lib/types/order-status.ts";

/** ⏳ Lo que la Fase 2 tiene que cambiar (medido el 2026-09-24). */
const PENDIENTES_FASE_2: Record<string, number> = {};

/** ¿Es texto visible (y no una clase de Tailwind / un token de variante / una clave de columna)? */
function esTextoVisible(s: string): boolean {
  if (/^[a-z0-9_-]+$/.test(s)) return false; // token: `success`, `chart6`, `entregadas`, `sinRecoger`
  if (/^[a-z]/.test(s) && /(^|\s)(bg|text|border|dark:|ring|fill|stroke)[-:]/.test(s)) return false; // clases
  if (/^[a-z][A-Za-z0-9]*$/.test(s)) return false; // camelCase
  return /[A-ZÁÉÍÓÚÑ]|\s/.test(s);
}

/** El texto de un valor: una cadena, o la `label`/`etiqueta`/`nombre` de un objeto literal. */
function textoDe(valor: ts.Expression | undefined): string | null {
  if (valor === undefined) return null;
  if (ts.isStringLiteral(valor) || ts.isNoSubstitutionTemplateLiteral(valor)) return valor.text;
  if (ts.isObjectLiteralExpression(valor)) {
    for (const p of valor.properties) {
      const n = nombreDePropiedad(p);
      if ((n === "label" || n === "etiqueta" || n === "nombre") && ts.isPropertyAssignment(p)) return textoDe(p.initializer);
    }
  }
  return null;
}

/** Los nombres de las funciones y constantes que encierran al nodo (de dentro afuera). */
function funcionQueEncierra(n: ts.Node): string {
  const nombres: string[] = [];
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name) nombres.push(p.name.text);
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) nombres.push(p.name.text);
    if (ts.isMethodDeclaration(p) && ts.isIdentifier(p.name)) nombres.push(p.name.text);
  }
  return nombres.join(" ");
}

function nombreDePropiedad(p: ts.ObjectLiteralElementLike): string | null {
  if (!("name" in p) || p.name === undefined) return null;
  const n = p.name;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n)) return n.text;
  return null;
}

export function hallazgos(codigo: string, nombre = "fuente.tsx"): string[] {
  const sf = ts.createSourceFile(nombre, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const anotar = (n: ts.Node, que: string) => {
    const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
    out.push(`${nombre}:${line + 1} ${que}`);
  };
  const visitar = (n: ts.Node): void => {
    if (ts.isObjectLiteralExpression(n)) {
      let codigoATexto = 0;
      let porNombre = 0;
      for (const p of n.properties) {
        const clave = nombreDePropiedad(p);
        if (clave === null) continue;
        const valor = ts.isPropertyAssignment(p) ? p.initializer : undefined;
        const texto = textoDe(valor);
        if (CODIGOS.has(clave) && texto !== null && esTextoVisible(texto)) codigoATexto++;
        if (NOMBRES.has(clave)) porNombre++;
      }
      if (codigoATexto >= 2) anotar(n, "mapa codigo->texto");
      if (porNombre >= 2) anotar(n, "mapa indexado por nombre visible");
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const metodo = n.expression.name.text;
      const [a, b] = n.arguments;
      const reemplazaGuion =
        (metodo === "replaceAll" && a && ts.isStringLiteral(a) && a.text === "_") ||
        (metodo === "replace" && a && ts.isRegularExpressionLiteral(a) && /^\/_\/g?$/.test(a.text));
      const porEspacio = b && ts.isStringLiteral(b) && b.text === " ";
      const sujeto = n.expression.expression.getText(sf);
      const contexto = `${sujeto} ${funcionQueEncierra(n)}`;
      if (reemplazaGuion && porEspacio && /estado|estatus|status/i.test(contexto)) anotar(n, "humaniza un codigo");
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return out;
}

function listar(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const c = path.join(dir, e);
    if (statSync(c).isDirectory()) listar(c, acc);
    else if (/\.tsx?$/.test(e) && !/\.d\.ts$/.test(e)) acc.push(c);
  }
  return acc;
}

function censo(): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const d of ["app", "lib", "components", "hooks"]) {
    for (const f of listar(path.join(RAIZ, d))) {
      const rel = path.relative(RAIZ, f).split(path.sep).join("/");
      if (rel === FUENTE_UNICA) continue;
      const h = hallazgos(readFileSync(f, "utf8"), rel);
      if (h.length > 0) m.set(rel, h);
    }
  }
  return m;
}

describe("455/G3 — el detector de segundas fuentes no esta roto", () => {
  it("no denuncia la variante/color por codigo, las claves de columna ni un solo estado", () => {
    const sano = [
      `const V = { entregado: "success", novedad: "warning", en_reparto: "secondary" };`,
      `const C = { en_reparto: "bg-brand-soft text-brand-dark", reprogramado: "border-hivis/60" };`,
      `const K = { entregado: "entregadas", novedad: "devueltas" };`,
      `const U = { entregado: "Entregado" };`,
      `const h = nombre.replaceAll("_", " ");`,
    ].join("\n");
    expect(hallazgos(sano)).toEqual([]);
  });

  it("MUTACION (R44): ve el mapa codigo->texto, el mapa por nombre y la humanizacion", () => {
    const infractor = [
      `const L = { entregado: "Entregado", novedad: "Novedad" };`,
      `const P = { "En reparto": "chip-a", "Novedad": "chip-b" };`,
      `const t = estado.replaceAll("_", " ");`,
      `const u = fila.status.replace(/_/g, " ");`,
      `function etiquetaDeStatus(value: string) { const x = value.replaceAll("_", " "); return x; }`,
      `const CHIP = { entregado: { label: "Entregado", className: "x" }, novedad: { label: "Novedad", className: "y" } };`,
    ].join("\n");
    expect(hallazgos(infractor)).toEqual([
      "fuente.tsx:1 mapa codigo->texto",
      "fuente.tsx:2 mapa indexado por nombre visible",
      "fuente.tsx:3 humaniza un codigo",
      "fuente.tsx:4 humaniza un codigo",
      "fuente.tsx:5 humaniza un codigo",
      "fuente.tsx:6 mapa codigo->texto",
    ]);
  });

  it("no-vacuidad: la fuente unica SI es un mapa codigo->texto (el detector la veria)", () => {
    const propia = hallazgos(readFileSync(path.join(RAIZ, FUENTE_UNICA), "utf8"));
    expect(propia.some((h) => h.endsWith("mapa codigo->texto"))).toBe(true);
  });
});

describe("455/R42 · R3 · R12 (G3) — el arbol", () => {
  const todos = censo();

  it("ninguna segunda fuente de nombres ni humanizacion fuera de lo pendiente de la Fase 2", () => {
    const infractores: string[] = [];
    for (const [archivo, h] of todos) {
      const permitido = PENDIENTES_FASE_2[archivo];
      if (permitido !== undefined && h.length <= permitido) continue;
      infractores.push(...h);
    }
    expect(
      infractores,
      "otro modulo declara nombres de estado o humaniza un codigo. El nombre sale de `nombreDeEstado` " +
        "(`lib/types/order-status.ts`); los colores y variantes, de un mapa indexado por CODIGO.",
    ).toEqual([]);
  });

  it("cada pendiente sigue haciendo falta, con su numero exacto", () => {
    for (const [archivo, n] of Object.entries(PENDIENTES_FASE_2)) {
      expect(todos.get(archivo)?.length ?? 0, `${archivo}: el pendiente cambio (retira o ajusta la entrada)`).toBe(n);
    }
  });
});
