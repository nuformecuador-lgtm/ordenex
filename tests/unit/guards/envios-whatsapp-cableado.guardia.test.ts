import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";

// FICHA 474 (T8.4, design §4.2, R26/R50) — GUARDIA DEL CABLEADO DEL PUENTE avisos -> WhatsApp.
//
// AMPLIA la de push (`push-cableado-unico.guardia.test.ts`), no la sustituye: aquella sigue
// vigilando que ningun binding construya su repositorio por su cuenta y que `new
// NotificacionRepository(` aparezca una sola vez. Esta afirma lo que es SOLO de la 474:
//   1. `repoReal()` DEVUELVE el repositorio envuelto por `conEnviosWhatsapp(` (pasarlo, no importarlo);
//   2. el decorador recibe sus dos piezas (`new WhatsappEnvioRepository(`, `new JobRepository(`);
//   3. `conEnviosWhatsapp(` no se construye en ningun otro sitio de `lib/` ni `app/` (un segundo
//      cableado duplicaria los trabajos, o desviaria avisos por un camino sin la puerta R50).
//
// Si alguien quita el decorador, la integracion `whatsapp-envio-puente-aviso.test.ts` se pone roja
// por COMPORTAMIENTO; esta lo hace por FORMA, y corre siempre (tambien en el modo rapido).

const RAIZ = path.resolve(__dirname, "..", "..", "..");
const CODIGO = quitarComentarios(fs.readFileSync(path.join(RAIZ, "lib", "notificaciones", "notificadores.ts"), "utf8"));

function cuerpoDe(codigo: string, firma: string): string {
  const i = codigo.indexOf(firma);
  expect(i, `no se encontro ${firma}`).toBeGreaterThan(-1);
  const abre = codigo.indexOf("{", i);
  let nivel = 0;
  for (let j = abre; j < codigo.length; j++) {
    if (codigo[j] === "{") nivel += 1;
    if (codigo[j] === "}") {
      nivel -= 1;
      if (nivel === 0) return codigo.slice(abre, j + 1);
    }
  }
  throw new Error(`no se cerro ${firma}`);
}

/** El detector: el `return` de `repoReal()` pasa por `conEnviosWhatsapp(` y DENTRO va `conPushWeb(`. */
export function repoRealPuenteado(cuerpo: string): boolean {
  return /return\s+conEnviosWhatsapp\(\s*conPushWeb\(\s*new NotificacionRepository\(/.test(cuerpo);
}

describe("474 · autocomprobacion", () => {
  it("lee el fuente y encuentra `repoReal`", () => {
    expect(CODIGO.length).toBeGreaterThan(2000);
    expect(CODIGO).toContain("function repoReal()");
  });

  it("⭑ MUTACION: el detector distingue el cableado de su ausencia", () => {
    const sinPuente =
      "{ const prisma = getPrismaClient(); return conPushWeb(new NotificacionRepository(prisma), {}); }";
    const soloImportado = "{ void conEnviosWhatsapp; return conPushWeb(new NotificacionRepository(prisma), {}); }";
    expect(repoRealPuenteado(sinPuente)).toBe(false);
    expect(repoRealPuenteado(soloImportado)).toBe(false);
    expect(
      repoRealPuenteado("{ return conEnviosWhatsapp(conPushWeb(new NotificacionRepository(prisma), {}), {}); }"),
    ).toBe(true);
  });
});

describe("474/R26 · `repoReal()` devuelve el repositorio PUENTEADO", () => {
  it("⭑ el return pasa por conEnviosWhatsapp( con conPushWeb( dentro", () => {
    expect(repoRealPuenteado(cuerpoDe(CODIGO, "function repoReal()"))).toBe(true);
  });

  it("el decorador recibe sus dos piezas", () => {
    const cuerpo = cuerpoDe(CODIGO, "function repoReal()");
    const tramo = cuerpo.slice(cuerpo.lastIndexOf("}),"));
    expect(tramo).toContain("envios: new WhatsappEnvioRepository(");
    expect(tramo).toContain("cola: new JobRepository(");
  });
});

describe("474/R26 · un solo punto de cableado en el arbol", () => {
  function fuentes(dir: string, acc: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) fuentes(p, acc);
      else if (/\.tsx?$/.test(e.name)) acc.push(p);
    }
    return acc;
  }

  it("⭑ `conEnviosWhatsapp(` se LLAMA solo en notificadores.ts (una vez)", () => {
    const llamadas: string[] = [];
    for (const raiz of ["lib", "app"]) {
      for (const f of fuentes(path.join(RAIZ, raiz))) {
        const rel = path.relative(RAIZ, f).split(path.sep).join("/");
        const codigo = quitarComentarios(fs.readFileSync(f, "utf8"));
        // La DEFINICION (`export function conEnviosWhatsapp(`) no es una llamada.
        const n = [...codigo.matchAll(/(?<!function\s)\bconEnviosWhatsapp\(/g)].length;
        for (let i = 0; i < n; i++) llamadas.push(rel);
      }
    }
    expect(llamadas).toEqual(["lib/notificaciones/notificadores.ts"]);
  });
});
