import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import {
  CLAVES_CONTADOR,
  COLOR_SEGMENTO,
  VARIANTE_CONTADOR,
} from "@/app/(app)/monitoreo/_components/contadores";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

import { arbolDeLaFeature, REPO_ROOT, sinComentarios } from "./_arbol-de-la-feature";

/**
 * Feature 258 (F7.1) — GUARDIA DE PRIMITIVAS del tablero del día.
 * Mapea: R17, R18, R19, R20, R21, R22, R23, R46, R47, R48, R65, R67, R74, R75, R78.
 *
 * ── POR QUÉ EXISTE, Y POR QUÉ CENSA EL ÁRBOL Y NO EL DIFF
 * Todo lo que esta ficha promete —«se reusan las primitivas», «ni un hex», «el tamaño de
 * página sale de la configuración», «recharts no entra en la carga inicial»— es cierto HOY
 * porque se escribió así. Nada de eso rompe un test el día que alguien lo deshaga: la pantalla
 * sigue pintándose, el typecheck sigue verde y el lint no tiene nada que decir. Es la familia
 * de defectos que este repo llama «el sistema no falla, aparenta».
 *
 * Se censa por RUTA (`arbolDeLaFeature`) y no `git diff`: un guardia que mirase el diff deja de
 * proteger nada en cuanto la rama se mergea.
 *
 * ── CADA DETECTOR SE PRUEBA CONTRA CÓDIGO QUE SÍ INFRINGE
 * Un detector que no puede fallar es decorado, y este repo ya pagó por eso. Cada cláusula lleva
 * su caso POSITIVO, y donde existe un archivo REAL del repo que infringe, se usa ése en vez de
 * una cadena inventada: `lienzo/LineasLienzo.tsx` importa `recharts` de verdad, `EstatusBadge`
 * nombra `badgeVariants` de verdad y `RutaMapaInner` escribe hexes de verdad.
 */

const ARBOL = arbolDeLaFeature();

/** Sólo los archivos de la RUTA: las cláusulas de primitivas hablan de la pantalla. */
const DE_LA_RUTA = ARBOL.filter((a) => a.ruta.startsWith("app/(app)/monitoreo/"));

const COMPONENTES_DE_LA_RUTA = "app/(app)/monitoreo/_components";

function leer(ruta: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, ruta), "utf8");
}

function codigoDe(ruta: string): string {
  return sinComentarios(leer(ruta));
}

/** Los archivos del árbol que cumplen el predicado, por su ruta. */
function infractores(detector: (codigo: string) => boolean): string[] {
  return ARBOL.filter((a) => detector(a.codigo)).map((a) => a.ruta);
}

/* ── Los detectores ─────────────────────────────────────────────────────────────────────── */

const importaRecharts = (codigo: string): boolean => /from\s+["']recharts["']/.test(codigo);

const importaElLienzo = (codigo: string): boolean =>
  /from\s+["'][^"']*\blienzo\//.test(codigo);

const nombraBadgeVariants = (codigo: string): boolean => /\bbadgeVariants\b/.test(codigo);

const escribeHex = (codigo: string): boolean => /#[0-9a-fA-F]{3,8}\b/.test(codigo);

/**
 * Una utilidad de paleta CRUDA de Tailwind (`bg-emerald-600`, `text-slate-400`…). `DESIGN.md`
 * las prohíbe de plano: el color sale de los tokens de `app/globals.css`, que son los que
 * giran con el tema. Se listan las 22 familias por nombre y no `-\d{3}` a secas para no cazar
 * `gap-1.5`, `grid-cols-3`, `size-11` ni `chart-11`, que son tokens legítimos.
 */
const FAMILIAS_CRUDAS =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const PALETA_CRUDA = new RegExp(
  `\\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|shadow|accent|caret|divide|placeholder)-(?:${FAMILIAS_CRUDAS})-\\d{2,3}\\b`,
);
const escribePaletaCruda = (codigo: string): boolean => PALETA_CRUDA.test(codigo);

/**
 * R47 — el par `-soft`/`-strong` NO se arma a mano. Lo produce la variante de `Badge`, que ya
 * trae su compensación `dark:bg-{sem}/15`. Escribirlo aquí es exactamente el bug de tema
 * oscuro que `DESIGN.md` describe: «que gira sobre fijo — `text-{sem}-strong` sobre
 * `bg-{sem}-soft` sin `dark:bg-{sem}/15`».
 */
const armaElParSemanticoAMano = (codigo: string): boolean =>
  /\b(?:bg|text)-(?:success|warning|danger|info)-(?:soft|strong)\b/.test(codigo);

/**
 * R75 — un literal numérico de tamaño de página. Sale de `ordenesConfig.DEFAULT_PAGE_SIZE`
 * (por el detalle que devuelve el servidor) y de ningún otro sitio.
 */
const escribeTamanoDePagina = (codigo: string): boolean =>
  /\bpage_?[sS]ize\s*[:=]\s*\d+/.test(codigo) ||
  /\bpageSize=\{\s*\d+\s*\}/.test(codigo) ||
  /\bPAGE_SIZE\s*=\s*\d+/.test(codigo);

/** R65 — la suma de los ocho contadores. Se IMPORTA del contrato; no se declara. */
const declaraUnaSuma = (codigo: string): boolean =>
  /\b(?:function|const)\s+sumar[A-Za-z]*\s*[(=]/.test(codigo);

/* ── El censo mira algo ─────────────────────────────────────────────────────────────────── */

describe("Feature 258 · el censo de esta guardia NO está vacío", () => {
  it("el árbol incluye los archivos de la ruta que esta ficha reescribe", () => {
    // Si esto estuviera vacío, TODAS las cláusulas de abajo serían verdes por vacío.
    expect(DE_LA_RUTA.length).toBeGreaterThanOrEqual(10);
    expect(DE_LA_RUTA.map((a) => a.ruta)).toEqual(
      expect.arrayContaining([
        "app/(app)/monitoreo/page.tsx",
        `${COMPONENTES_DE_LA_RUTA}/contadores.ts`,
        `${COMPONENTES_DE_LA_RUTA}/ContadoresTablero.tsx`,
        `${COMPONENTES_DE_LA_RUTA}/ComposicionBarra.tsx`,
        `${COMPONENTES_DE_LA_RUTA}/DetalleMensajeroPanel.tsx`,
        `${COMPONENTES_DE_LA_RUTA}/TableroDiaControles.tsx`,
        `${COMPONENTES_DE_LA_RUTA}/TableroDiaEstados.tsx`,
        `${COMPONENTES_DE_LA_RUTA}/TableroDiaModule.tsx`,
        `${COMPONENTES_DE_LA_RUTA}/TableroDiaTotales.tsx`,
        `${COMPONENTES_DE_LA_RUTA}/serie-ritmo.ts`,
        `${COMPONENTES_DE_LA_RUTA}/filtrar-mensajeros.ts`,
      ]),
    );
  });
});

/* ── (a) R74/R78 — recharts no entra por esta puerta ────────────────────────────────────── */

describe("Feature 258 · (a) R74/R78 — el lienzo de recharts sigue confinado y diferido", () => {
  it("ningún archivo del árbol escribe `from \"recharts\"`", () => {
    expect(
      infractores(importaRecharts),
      "un archivo de la feature importa recharts: entra en la carga inicial de /monitoreo",
    ).toEqual([]);
  });

  it("ningún archivo del árbol importa nada de `…/analytics/lienzo/`", () => {
    expect(
      infractores(importaElLienzo),
      "importar el lienzo estáticamente mete su chunk en el First Load, que es lo que R78 evita",
    ).toEqual([]);
  });

  it("las dos cláusulas NO son vacías: el lienzo REAL del repo sí infringe las dos", () => {
    const lienzo = codigoDe("components/private/analytics/lienzo/LineasLienzo.tsx");
    expect(importaRecharts(lienzo)).toBe(true);
    expect(importaElLienzo(codigoDe("components/private/analytics/GraficaLineas.tsx"))).toBe(
      false,
    );
    expect(importaElLienzo('import X from "./lienzo/LineasLienzo";')).toBe(true);
  });

  it("la línea llega diferida porque `GraficaLineas` la difiere, y sigue haciéndolo", () => {
    // No se toca `analytics-paquete-guard.test.ts` (R74): se comprueba el hecho del que
    // depende esta pantalla.
    expect(leer("components/private/analytics/GraficaLineas.tsx")).toMatch(
      /lazy\(\s*\(\)\s*=>\s*import\(/,
    );
  });
});

/* ── (b) R18/R19 — el vocabulario visual no se reescribe ────────────────────────────────── */

describe("Feature 258 · (b) R18 — `badgeVariants` no se nombra en el árbol", () => {
  it("ningún archivo lo escribe", () => {
    expect(
      infractores(nombraBadgeVariants),
      "la variante se saca de `ComponentProps<typeof Badge>`, no del `cva` interno",
    ).toEqual([]);
  });

  it("la cláusula NO es vacía: `EstatusBadge` del listado SÍ lo nombra", () => {
    expect(nombraBadgeVariants(codigoDe("app/(app)/ordenes/_components/EstatusBadge.tsx"))).toBe(
      true,
    );
  });
});

/* ── (c) R17 — los mapas se clavan por CLAVE DE CONTADOR ────────────────────────────────── */

describe("Feature 258 · (c) R17 — los mapas van por clave de contador, no por estatus", () => {
  const VALUES = ORDER_STATUS_SEED as readonly string[];

  it.each([
    ["VARIANTE_CONTADOR", VARIANTE_CONTADOR],
    ["COLOR_SEGMENTO", COLOR_SEGMENTO],
  ])("%s no tiene ni una clave que sea un value del catálogo de estatus", (nombre, mapa) => {
    for (const clave of Object.keys(mapa)) {
      expect(
        VALUES.includes(clave),
        `${nombre} está clavado por estatus (${clave}): eso es un segundo mapa de color de ` +
          "estatus y lo caza la cláusula (f) de `frontera.guardia.test.ts`",
      ).toBe(false);
    }
  });

  it.each([
    ["VARIANTE_CONTADOR", VARIANTE_CONTADOR],
    ["COLOR_SEGMENTO", COLOR_SEGMENTO],
  ])("%s cubre las OCHO claves de contador y ninguna más", (_nombre, mapa) => {
    expect(Object.keys(mapa).sort()).toEqual([...CLAVES_CONTADOR].sort());
  });

  it("la cláusula NO es vacía: un mapa clavado por estatus SÍ se detecta", () => {
    const malo = { entregada: "success", en_reparto: "info" };
    expect(Object.keys(malo).some((clave) => VALUES.includes(clave))).toBe(true);
  });
});

/* ── (d) R46/R47/R48/R67 — todo color sale de un token ──────────────────────────────────── */

describe("Feature 258 · (d) R46/R67 — ni un hex ni una utilidad de paleta cruda", () => {
  it("ningún archivo del árbol escribe un hex", () => {
    expect(
      infractores(escribeHex),
      "el color sale de los tokens de `app/globals.css`, que son los que giran con el tema",
    ).toEqual([]);
  });

  it("ningún archivo del árbol escribe una utilidad de paleta cruda de Tailwind", () => {
    expect(infractores(escribePaletaCruda)).toEqual([]);
  });

  it("las dos cláusulas NO son vacías", () => {
    // Hex: un archivo REAL del repo que sí los escribe (los colores del mapa de ruta).
    expect(
      escribeHex(codigoDe("app/(app)/mis-asignaciones/_components/RutaMapaInner.tsx")),
    ).toBe(true);
    // Paleta cruda: hoy NINGÚN archivo del repo la usa —está prohibida desde `DESIGN.md`—, así
    // que el positivo va sobre la clase escrita. Y se comprueba que el detector no se dispara
    // con los tokens legítimos que sí conviven en estos archivos.
    expect(escribePaletaCruda('className="bg-emerald-600 text-slate-400"')).toBe(true);
    expect(escribePaletaCruda('className="bg-chart-11 bg-muted gap-1.5 grid-cols-3 size-11"')).toBe(
      false,
    );
  });

  it("R47/R48: el par `-soft`/`-strong` lo pone `Badge`, no el árbol", () => {
    expect(
      infractores(armaElParSemanticoAMano),
      "armar `bg-{sem}-soft` + `text-{sem}-strong` a mano se deja el `dark:bg-{sem}/15` fuera, " +
        "que es el bug de tema oscuro más repetido del repo",
    ).toEqual([]);
    // No es vacía: la primitiva SÍ lo escribe, y es su sitio.
    expect(armaElParSemanticoAMano(codigoDe("components/ui/badge.tsx"))).toBe(true);
  });

  it("los ocho colores de la barra son utilidades de fondo sobre tokens declarados", () => {
    const css = fs.readFileSync(path.join(REPO_ROOT, "app", "globals.css"), "utf8");
    for (const clave of CLAVES_CONTADOR) {
      const clase = COLOR_SEGMENTO[clave];
      expect(clase.startsWith("bg-")).toBe(true);
      // El token existe de verdad en `globals.css` (sin el sufijo de opacidad, si lo lleva).
      const nombre = clase.replace(/^bg-/, "").replace(/\/\d+$/, "");
      expect(css, `el token --color-${nombre} no existe`).toContain(`--color-${nombre}:`);
    }
  });
});

/* ── (e) R75 — el tamaño de página no se escribe ────────────────────────────────────────── */

describe("Feature 258 · (e) R75 — ni un literal de tamaño de página en el árbol", () => {
  it("ningún archivo lo escribe", () => {
    expect(
      infractores(escribeTamanoDePagina),
      "el tamaño de página sale de `ordenesConfig.DEFAULT_PAGE_SIZE` (vía el detalle que " +
        "devuelve el servidor); un literal aquí es una segunda fuente de verdad",
    ).toEqual([]);
  });

  it("la cláusula NO es vacía: las tres formas de escribirlo se detectan", () => {
    expect(escribeTamanoDePagina("const detalle = { pageSize: 25 };")).toBe(true);
    expect(escribeTamanoDePagina("<Pagination pageSize={20} />")).toBe(true);
    expect(escribeTamanoDePagina("const PAGE_SIZE = 25;")).toBe(true);
    // Y no se dispara con la forma correcta.
    expect(escribeTamanoDePagina("pageSize={detalle?.pageSize ?? ordenes.length}")).toBe(false);
  });

  it("el servidor lo sigue tomando de la configuración", () => {
    expect(codigoDe("lib/services/TableroDiaService.ts")).toContain(
      "ordenesConfig.DEFAULT_PAGE_SIZE",
    );
  });
});

/* ── (f) R65 — UNA sola suma de los ocho contadores ─────────────────────────────────────── */

describe("Feature 258 · (f) R65 — la suma de los ocho sumandos se declara UNA vez", () => {
  it("sólo `lib/types/tablero-dia.ts` la declara; el resto del árbol la importa", () => {
    const declarantes = infractores(declaraUnaSuma);
    expect(
      declarantes,
      "hay una segunda suma en el árbol: dos implementaciones son dos identidades de ocho " +
        "sumandos distintas, y pueden divergir sin que ningún test lo note (R3/R65)",
    ).toEqual(["lib/types/tablero-dia.ts"]);
  });

  it("y el módulo de cliente la CONSUME de ahí", () => {
    const modulo = codigoDe(`${COMPONENTES_DE_LA_RUTA}/TableroDiaModule.tsx`);
    expect(modulo).toContain("sumarTotalesTablero");
    expect(modulo).toContain("@/lib/types/tablero-dia");
  });

  it("la cláusula NO es vacía: el detector encuentra una suma escrita a mano", () => {
    expect(declaraUnaSuma("function sumarTotalesDeLoFiltrado(filas) { return null; }")).toBe(true);
    expect(declaraUnaSuma("const sumarVisibles = (filas) => filas;")).toBe(true);
    expect(declaraUnaSuma("import { sumarTotalesTablero } from '@/lib/types/tablero-dia';")).toBe(
      false,
    );
  });
});

/* ── (g) R21/R22/R23 — cada bloque monta SU primitiva ───────────────────────────────────── */

describe("Feature 258 · (g) R21/R22/R23 — las primitivas se reusan, no se reimplementan", () => {
  const ESPERADO: readonly (readonly [string, readonly string[]])[] = [
    [`${COMPONENTES_DE_LA_RUTA}/ContadoresTablero.tsx`, ["@/components/ui/badge"]],
    [
      `${COMPONENTES_DE_LA_RUTA}/TableroDiaEstados.tsx`,
      ["@/components/shared/EmptyState", "@/components/ui/alert"],
    ],
    [
      `${COMPONENTES_DE_LA_RUTA}/DetalleMensajeroPanel.tsx`,
      [
        "@/components/shared/Modal",
        "@/components/shared/DataTable",
        "@/components/shared/Pagination",
      ],
    ],
    [
      `${COMPONENTES_DE_LA_RUTA}/TableroDiaControles.tsx`,
      ["@/components/ui/input", "@/components/shared/SegmentedToggle"],
    ],
    [
      `${COMPONENTES_DE_LA_RUTA}/TableroDiaTotales.tsx`,
      ["@/components/private/analytics/GraficaLineas"],
    ],
    [`${COMPONENTES_DE_LA_RUTA}/TableroDiaModule.tsx`, ["@/components/ui/alert"]],
  ];

  it.each(ESPERADO)("%s importa sus primitivas", (ruta, primitivas) => {
    const codigo = codigoDe(ruta);
    for (const primitiva of primitivas) {
      expect(codigo, `${ruta} no monta ${primitiva}`).toContain(primitiva);
    }
  });
});

/* ── (h) R20 — las primitivas no se tocaron por esta pantalla ───────────────────────────── */

describe("Feature 258 · (h) R20 — `components/ui/` y `components/shared/` no saben de esta pantalla", () => {
  /**
   * ── Por qué NO se congela el inventario con una lista de nombres
   * La forma literal de R20 sería una lista de los archivos de `components/ui|shared` y un
   * `toEqual`. Se descarta: eso convierte esta guardia en un peaje para CUALQUIER ficha futura
   * que estrene una primitiva legítima, y la salida barata sería borrar la cláusula. Lo que R20
   * protege de verdad es que esta pantalla no se haya fabricado una primitiva a medida, y eso
   * SÍ es comprobable de forma duradera: una primitiva con dominio del tablero dentro.
   */
  const DIRECTORIOS = ["components/ui", "components/shared"] as const;
  // Sin `\b` al final a propósito: `TableroDiaRejilla` tiene que contar, y un límite de
  // palabra detrás de `TableroDia` no se cumple cuando la siguiente letra es una mayúscula.
  const DOMINIO = /tablero-?d[ií]a|monitoreo|mensajero(?:Id|Nombre)/i;

  function archivosDe(dir: string): string[] {
    const absoluto = path.join(REPO_ROOT, dir);
    const salida: string[] = [];
    for (const entrada of fs.readdirSync(absoluto, { withFileTypes: true })) {
      const relativo = path.posix.join(dir, entrada.name);
      if (entrada.isDirectory()) salida.push(...archivosDe(relativo));
      else if ([".ts", ".tsx"].includes(path.extname(entrada.name))) salida.push(relativo);
    }
    return salida;
  }

  const PRIMITIVAS = DIRECTORIOS.flatMap(archivosDe);

  it("el censo mira algo", () => {
    expect(PRIMITIVAS.length).toBeGreaterThan(20);
  });

  it("ninguna primitiva conoce el dominio del tablero del día", () => {
    const contaminadas = PRIMITIVAS.filter((ruta) => DOMINIO.test(codigoDe(ruta)));
    expect(
      contaminadas,
      "una primitiva compartida sabe de esta pantalla: eso es una primitiva a medida, que es " +
        "lo que R20 evita",
    ).toEqual([]);
  });

  it("la cláusula NO es vacía: el detector reconoce el dominio", () => {
    expect(DOMINIO.test("export function TableroDiaAlgo() {}")).toBe(true);
    expect(DOMINIO.test("export function Pagination() {}")).toBe(false);
  });

  it("las primitivas que esta pantalla monta EXISTEN todas (no se inventó ninguna)", () => {
    for (const ruta of [
      "components/ui/badge.tsx",
      "components/ui/alert.tsx",
      "components/ui/input.tsx",
      "components/shared/EmptyState.tsx",
      "components/shared/Modal.tsx",
      "components/shared/DataTable.tsx",
      "components/shared/Pagination.tsx",
      "components/shared/SegmentedToggle.tsx",
    ]) {
      expect(fs.existsSync(path.join(REPO_ROOT, ruta)), `falta ${ruta}`).toBe(true);
    }
  });
});
