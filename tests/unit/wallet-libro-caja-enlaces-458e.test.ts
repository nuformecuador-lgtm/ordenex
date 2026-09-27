import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hrefEstadoCuenta } from "@/app/(app)/wallet/_components/libro-caja-labels";

/**
 * Merge 458-E + 458-D (R56): el enlace de «A quién» del libro de la caja (458-E) tiene que abrir la
 * pantalla REAL del estado de cuenta que crea la 458-D, no solo tener «buena pinta». Se resuelve el
 * `href` contra el árbol de rutas del App Router (segmento dinámico incluido) y se comprueba que esa
 * página pide el estado de cuenta del MISMO tipo de cuenta con el id del segmento.
 */

const RAIZ = path.resolve(__dirname, "../..");
const APP = path.join(RAIZ, "app", "(app)");

/** Resuelve un pathname a su `page.tsx` como lo haría el App Router (estático antes que dinámico). */
function resolverRuta(pathname: string): { archivo: string; params: Record<string, string> } | null {
  const segmentos = pathname.split("/").filter(Boolean);
  let dir = APP;
  const params: Record<string, string> = {};
  for (const seg of segmentos) {
    const estatico = path.join(dir, seg);
    if (existsSync(estatico)) {
      dir = estatico;
      continue;
    }
    const dinamico = readdirSync(dir).find((d) => /^\[[^.\]]+\]$/.test(d));
    if (dinamico === undefined) return null;
    params[dinamico.slice(1, -1)] = decodeURIComponent(seg);
    dir = path.join(dir, dinamico);
  }
  const archivo = path.join(dir, "page.tsx");
  return existsSync(archivo) ? { archivo, params } : null;
}

const UUID = "3f2b8c1e-9a4d-4e7b-8c21-5d6f7a8b9c0d";

describe("458-E R56 · «A quién» abre el estado de cuenta de la 458-D", () => {
  it.each([
    ["tienda", "tiendaId"],
    ["mensajero", "mensajeroId"],
  ] as const)("%s: el href llega a su página y la página pide el estado de cuenta de ESA cuenta", (tipo, param) => {
    const href = hrefEstadoCuenta({ tipo, id: UUID });
    const ruta = resolverRuta(href);
    expect(ruta, `${href} no resuelve a ninguna page.tsx`).not.toBeNull();
    // El uuid entra entero en el segmento dinámico que la página lee.
    expect(ruta?.params).toEqual({ [param]: UUID });

    const fuente = readFileSync(ruta?.archivo as string, "utf8");
    expect(fuente).toContain(`const { ${param} } = await params;`);
    expect(fuente).toContain(`verEstadoCuentaAction({ cuenta: { tipo: "${tipo}", id: ${param} } })`);
  });

  it("el enlace de una tienda no cae en la página del mensajero (ni al revés)", () => {
    expect(resolverRuta(hrefEstadoCuenta({ tipo: "tienda", id: UUID }))?.archivo).toContain(
      path.join("tiendas", "[tiendaId]"),
    );
    expect(resolverRuta(hrefEstadoCuenta({ tipo: "mensajero", id: UUID }))?.archivo).toContain(
      path.join("mensajeros", "[mensajeroId]"),
    );
  });
});
