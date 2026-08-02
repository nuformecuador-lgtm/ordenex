// Guard estatico del paquete de analitica (feature 130):
// R1-R4, R26, R27, R29, R34, R39, R40, R41.
//
// Censo de archivos, no de intenciones. Un componente `private/` que un dia
// empiece a fetchear, o un `recharts` que se cuele en el portal del mensajero,
// no se detectan leyendo el diff: se detectan aqui. La feature se mergea SIN
// llamador en produccion (H1), asi que este es justo el momento de poner la valla.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const PAQUETE = path.join(RAIZ, "components", "private", "analytics");
const LIENZO = path.join(PAQUETE, "lienzo");

function archivos(dir: string, extensiones = [".ts", ".tsx"]): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entrada) => {
    const completo = path.join(dir, entrada);
    if (statSync(completo).isDirectory()) return archivos(completo, extensiones);
    return extensiones.includes(path.extname(completo)) ? [completo] : [];
  });
}

/**
 * Quita comentarios antes de censar. Sin esto el guard se dispara con la propia
 * documentacion del paquete ("no leemos matchMedia") y se convierte en un test
 * que castiga explicar las cosas.
 */
function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

const DEL_PAQUETE = archivos(PAQUETE).map((archivo) => ({
  ruta: path.relative(RAIZ, archivo).split(path.sep).join("/"),
  codigo: sinComentarios(readFileSync(archivo, "utf8")),
}));

/** Todo el codigo fuente del repo, para las reglas que valen en TODO el arbol. */
const FUENTES_REPO = ["app", "components", "hooks", "lib", "providers", "middleware.ts"].flatMap(
  (entrada) => {
    const completo = path.join(RAIZ, entrada);
    if (!existsSync(completo)) return [];
    if (statSync(completo).isFile()) return [completo];
    return archivos(completo);
  },
);

describe("ubicacion y pureza del paquete (R1, R2)", () => {
  it("expone los cinco componentes en components/private/analytics", () => {
    for (const componente of [
      "KpiCard.tsx",
      "GraficaBarras.tsx",
      "GraficaLineas.tsx",
      "GraficaDonut.tsx",
      "TablaResumen.tsx",
    ]) {
      expect(existsSync(path.join(PAQUETE, componente)), `falta ${componente}`).toBe(true);
    }
  });

  it("ningun archivo del paquete hace fetch, usa server actions ni toca la base", () => {
    const prohibidos = [
      /\bfetch\s*\(/,
      /["']use server["']/,
      /from\s+["']next\/headers["']/,
      /from\s+["']swr["']/,
      /from\s+["']@\/lib\/actions\//,
      /from\s+["']@\/lib\/db/,
      /from\s+["']@prisma\/client["']/,
    ];
    for (const { ruta, codigo } of DEL_PAQUETE) {
      for (const patron of prohibidos) {
        expect(patron.test(codigo), `${ruta} incumple ${patron}`).toBe(false);
      }
    }
  });

  it("toma la unidad de lib/analytics/types con import type y no importa el catalogo metrics", () => {
    for (const { ruta, codigo } of DEL_PAQUETE) {
      expect(/from\s+["']@\/lib\/analytics\/metrics["']/.test(codigo), `${ruta} importa metrics`).toBe(
        false,
      );
      const importaTypes = /import\s+([^;]*?)from\s+["']@\/lib\/analytics\/types["']/.exec(codigo);
      if (importaTypes) {
        expect(importaTypes[1].includes("type"), `${ruta} importa types sin 'type'`).toBe(true);
      }
    }
    // Y alguien tiene que importarlo: el contrato de la 135 se usa, no se copia.
    expect(
      DEL_PAQUETE.some(({ codigo }) => codigo.includes('from "@/lib/analytics/types"')),
    ).toBe(true);
    // Nadie redeclara la union de unidades.
    for (const { ruta, codigo } of DEL_PAQUETE) {
      expect(/type\s+MetricaUnidad\s*=/.test(codigo), `${ruta} redeclara MetricaUnidad`).toBe(false);
    }
  });

  it("ningun componente lee window, document ni matchMedia", () => {
    for (const { ruta, codigo } of DEL_PAQUETE) {
      expect(/\bwindow\./.test(codigo), `${ruta} lee window`).toBe(false);
      expect(/\bdocument\./.test(codigo), `${ruta} lee document`).toBe(false);
      expect(/matchMedia/.test(codigo), `${ruta} lee matchMedia`).toBe(false);
      expect(/localStorage/.test(codigo), `${ruta} lee localStorage`).toBe(false);
    }
  });

  // El mismo censo de literales que ya protege a `components/shared/KpiValorAnimado.tsx`.
  // Aqui no es un lujo: es la UNICA red que distingue `formatMonto(v)` de un
  // `` `₡${…}` `` escrito a mano. Con la configuracion por defecto (es-CR/CRC) los
  // dos producen strings BYTE-IDENTICOS, asi que ninguna asercion de salida puede
  // separarlos y un test que derive su esperado de `monedaConfig` pasaria igual con
  // el simbolo incrustado. Lo verifica `CHECKPOINTS.md`: "no se hardcodeo pais,
  // moneda ni cuenta".
  it("ningun archivo del paquete escribe un simbolo de moneda, un codigo ISO ni un locale", () => {
    const simbolos = /[₡€£¥]/;
    // `$` es legitimo en `${…}` de un template literal y en ningun otro sitio del paquete.
    const dolar = /\$(?!\{)/;
    const iso = /\b(?:CRC|USD|EUR|GBP|JPY|MXN|COP|ARS|CLP|PEN)\b/;
    const locale = /["'`][a-z]{2}-[A-Z]{2}["'`]/;

    for (const { ruta, codigo } of DEL_PAQUETE) {
      expect(simbolos.test(codigo), `${ruta} escribe un simbolo de moneda`).toBe(false);
      expect(dolar.test(codigo), `${ruta} escribe un simbolo de moneda`).toBe(false);
      expect(iso.test(codigo), `${ruta} escribe un codigo ISO de moneda`).toBe(false);
      expect(locale.test(codigo), `${ruta} incrusta un literal de idioma`).toBe(false);
    }
  });

  it("el formato de moneda y el locale salen de lib/config/moneda, no del paquete", () => {
    const formato = DEL_PAQUETE.find(({ ruta }) => ruta.endsWith("formato.ts"));
    expect(formato, "falta formato.ts").toBeDefined();
    expect(formato?.codigo).toMatch(/from\s+["']@\/lib\/config\/moneda["']/);
    expect(formato?.codigo).toMatch(/\bformatMonto\b/);
    expect(formato?.codigo).toMatch(/monedaConfig\.locale/);
  });

  it("ningun componente sincroniza estado con useEffect", () => {
    for (const { ruta, codigo } of DEL_PAQUETE) {
      expect(/\buseEffect\b/.test(codigo), `${ruta} usa useEffect`).toBe(false);
      expect(/\buseState\b/.test(codigo), `${ruta} usa useState`).toBe(false);
    }
  });
});

describe("confinamiento de recharts (R26, R27)", () => {
  it("recharts solo se importa desde el paquete de analitica", () => {
    const importadores = FUENTES_REPO.filter((archivo) =>
      /from\s+["']recharts["']/.test(readFileSync(archivo, "utf8")),
    ).map((archivo) => path.relative(RAIZ, archivo).split(path.sep).join("/"));

    expect(importadores.length).toBeGreaterThan(0);
    for (const importador of importadores) {
      expect(
        importador.startsWith("components/private/analytics/lienzo/"),
        `${importador} importa recharts fuera de analytics/lienzo/`,
      ).toBe(true);
    }
  });

  it("los componentes de grafica se montan por importacion diferida", () => {
    for (const grafica of ["GraficaBarras.tsx", "GraficaLineas.tsx", "GraficaDonut.tsx"]) {
      const codigo = readFileSync(path.join(PAQUETE, grafica), "utf8");
      expect(/lazy\(\s*\(\)\s*=>\s*import\(/.test(codigo), `${grafica} no difiere su lienzo`).toBe(
        true,
      );
      // Import estatico del lienzo = chunk en el First Load: prohibido.
      expect(/^import\s+.*from\s+["']\.\/lienzo\//m.test(codigo), `${grafica} importa el lienzo estatico`).toBe(
        false,
      );
    }
  });

  it("el paquete no tiene barril: un index.ts arrastraria recharts a cualquier consumidor", () => {
    expect(existsSync(path.join(PAQUETE, "index.ts"))).toBe(false);
    expect(existsSync(path.join(PAQUETE, "index.tsx"))).toBe(false);
  });
});

describe("decisiones de la puerta F1.4 convertidas en guard (R34, R39, R40)", () => {
  it("no existe components/ui/chart y el paquete no lo importa", () => {
    const uiChart = archivos(path.join(RAIZ, "components", "ui")).filter((archivo) =>
      path.basename(archivo).startsWith("chart"),
    );
    expect(uiChart, "aparecio la primitiva de shadcn: hay que reabrir Q1").toEqual([]);
    for (const { ruta, codigo } of DEL_PAQUETE) {
      expect(/@\/components\/ui\/chart/.test(codigo), `${ruta} importa components/ui/chart`).toBe(
        false,
      );
    }
  });

  it("el paquete no importa next-themes ni escribe la clase dark", () => {
    for (const { ruta, codigo } of DEL_PAQUETE) {
      expect(/next-themes/.test(codigo), `${ruta} importa next-themes`).toBe(false);
      expect(/classList\s*\.\s*(add|toggle|remove)/.test(codigo), `${ruta} escribe clases`).toBe(
        false,
      );
      expect(/\btema\b|\btheme\b/i.test(codigo), `${ruta} expone una prop de tema`).toBe(false);
    }
  });

  it("el paquete no agrupa en otros ni re-muestrea por semana o mes", () => {
    for (const { ruta, codigo } of DEL_PAQUETE) {
      expect(/["']otros["']/i.test(codigo), `${ruta} agrupa en otros`).toBe(false);
      expect(/\b(agrupar|agregarPor|reMuestrear|porSemana|porMes)\b/i.test(codigo), `${ruta} agrega`).toBe(
        false,
      );
    }
  });
});

describe("aserciones que midan algo (R41)", () => {
  it("ningun test del paquete consulta nodos de recharts", () => {
    // El propio guard queda fuera del censo: contiene los patrones prohibidos
    // porque su trabajo es buscarlos.
    const testsDelPaquete = archivos(path.join(RAIZ, "tests")).filter(
      (archivo) =>
        /Analytics|analytics-/.test(path.basename(archivo)) &&
        path.basename(archivo) !== "analytics-paquete-guard.test.ts",
    );
    expect(testsDelPaquete.length).toBeGreaterThan(0);

    for (const archivo of testsDelPaquete) {
      const codigo = sinComentarios(readFileSync(archivo, "utf8"));
      const nombre = path.relative(RAIZ, archivo).split(path.sep).join("/");
      expect(/querySelector\(\s*["']svg/.test(codigo), `${nombre} consulta el svg`).toBe(false);
      expect(/recharts-/.test(codigo), `${nombre} consulta clases de recharts`).toBe(false);
      expect(/querySelectorAll\(\s*["'](?:rect|path|circle)/.test(codigo), `${nombre} cuenta nodos pintados`).toBe(
        false,
      );
    }
  });

  it("los tres lienzos existen y son los unicos que hablan recharts", () => {
    for (const lienzo of ["BarrasLienzo.tsx", "LineasLienzo.tsx", "DonutLienzo.tsx"]) {
      const codigo = readFileSync(path.join(LIENZO, lienzo), "utf8");
      expect(/from\s+["']recharts["']/.test(codigo), `${lienzo} no usa recharts`).toBe(true);
      expect(codigo.startsWith('"use client"'), `${lienzo} no es client component`).toBe(true);
    }
  });
});
