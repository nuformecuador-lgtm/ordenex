import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// =================================================================================================
// FICHA 467 (T8) — GUARDIA DE LA BARRA ÚNICA DE LAS WALLETS
// =================================================================================================
//
// (a) R37 — la ayuda de la caja, de los estados de cuenta (tiendas, mensajeros, satélites) y de
//     `/mi-wallet` ya no habla de «Aplicar», «Quitar periodo» ni de las dos zonas, y SÍ nombra el botón
//     «Filtros» y cada casilla de su superficie.
// (b) R32 — las barras (`LibroCajaBarra.tsx`, `EstadoCuenta.tsx`) no montan controles propios: no
//     importan el `Select` ni el `Label` de `components/ui/`.
// (c) R3 — ningún archivo de `app/` ni de `components/` contiene los textos de alcance de la 463.
// (d) R36 — los `*-labels.ts` que tocó la ficha no dicen «SLA».
//
// Comprobado a mano el 2026-10-02 (anotado en `progress/impl_467.md`): reponer «Estos filtros cambian
// toda la wallet» en `zonas-filtros-labels.ts`, o «Aplicar» en la ayuda de la caja, pone esto en rojo.
// =================================================================================================

const RAIZ = path.resolve(__dirname, "../../..");
const leer = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

/** El cuerpo de una ayuda, sin el frontmatter (las `fuentes` no son texto que lea nadie). */
function cuerpoDeAyuda(rel: string): string {
  const texto = leer(rel);
  const fin = texto.indexOf("\n---", 3);
  return texto.startsWith("---") && fin > 0 ? texto.slice(fin + 4) : texto;
}

const AYUDAS: { archivo: string; casillas: string[] }[] = [
  { archivo: "docs/ayuda/oficina/wallet-caja.md", casillas: ["Periodo", "A quién", "Entra/Sale", "Concepto"] },
  { archivo: "docs/ayuda/oficina/wallet-tiendas.md", casillas: ["Periodo", "Tipo de movimiento", "Cierre"] },
  { archivo: "docs/ayuda/oficina/wallet-mensajeros.md", casillas: ["Periodo", "Tipo de movimiento", "Cierre"] },
  { archivo: "docs/ayuda/oficina/wallet-satelites.md", casillas: ["Periodo", "Tipo de movimiento"] },
  { archivo: "docs/ayuda/tienda/mi-wallet.md", casillas: ["Periodo", "Tipo de movimiento", "Cierre"] },
];

const PROHIBIDOS_EN_AYUDA = ["Aplicar", "Quitar periodo", "Estos filtros cambian", "solo afectan al libro", "dos zonas"];

describe("467 (a) R37 — la ayuda describe la barra única", () => {
  it.each(AYUDAS)("$archivo", ({ archivo, casillas }) => {
    const cuerpo = cuerpoDeAyuda(archivo);
    for (const prohibido of PROHIBIDOS_EN_AYUDA) {
      expect(cuerpo, `«${prohibido}» en ${archivo}`).not.toContain(prohibido);
    }
    expect(cuerpo).toContain("**Filtros**");
    for (const casilla of casillas) expect(cuerpo, `falta la casilla «${casilla}»`).toContain(`**${casilla}**`);
  });
});

describe("467 (b) R32 — las barras solo montan los componentes compartidos", () => {
  it.each(["app/(app)/wallet/_components/LibroCajaBarra.tsx", "components/shared/estado-cuenta/EstadoCuenta.tsx"])(
    "%s no importa `ui/select` ni `ui/label`",
    (archivo) => {
      const fuente = leer(archivo);
      expect(fuente).not.toMatch(/from\s+["']@\/components\/ui\/select["']/);
      expect(fuente).not.toMatch(/from\s+["']@\/components\/ui\/label["']/);
      // Y sí monta los compartidos de la barra.
      expect(fuente).toContain("@/components/shared/BuscadorFiltros");
      expect(fuente).toContain("@/components/shared/FilterComponent");
      expect(fuente).toContain("@/components/shared/SegmentedToggle");
    },
  );
});

/** Todos los `.ts`/`.tsx` bajo `dir` (relativo a la raíz). */
function fuentesBajo(dir: string): string[] {
  const out: string[] = [];
  const recorrer = (abs: string) => {
    for (const nombre of readdirSync(abs)) {
      const ruta = path.join(abs, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (/\.(ts|tsx)$/.test(nombre)) out.push(ruta);
    }
  };
  recorrer(path.join(RAIZ, dir));
  return out;
}

describe("467 (c) R3 — los textos de alcance de la 463 no vuelven", () => {
  const ARCHIVOS = [...fuentesBajo("app"), ...fuentesBajo("components")];

  it("no-vacuidad: se revisan archivos de las dos carpetas", () => {
    expect(ARCHIVOS.some((a) => a.includes(`${path.sep}app${path.sep}`))).toBe(true);
    expect(ARCHIVOS.some((a) => a.includes(`${path.sep}components${path.sep}`))).toBe(true);
    expect(ARCHIVOS.length).toBeGreaterThan(100);
  });

  it("ninguno contiene «Estos filtros cambian toda la wallet» ni «Estos filtros solo afectan al libro de movimientos»", () => {
    const culpables = ARCHIVOS.filter((a) => {
      const t = readFileSync(a, "utf8");
      return t.includes("Estos filtros cambian toda la wallet") || t.includes("Estos filtros solo afectan al libro de movimientos");
    }).map((a) => path.relative(RAIZ, a));
    expect(culpables).toEqual([]);
  });
});

describe("467 (d) R36 — los textos de la ficha no usan la sigla «SLA»", () => {
  it.each([
    "components/shared/wallet/zonas-filtros-labels.ts",
    "app/(app)/wallet/_components/libro-caja-labels.ts",
    "components/shared/estado-cuenta/estado-cuenta-labels.ts",
  ])("%s", (archivo) => {
    expect(leer(archivo)).not.toMatch(/\bSLA\b/);
  });
});
