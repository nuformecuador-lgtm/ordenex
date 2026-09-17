import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ GUARDIA — FICHA 446 · EL BUSCADOR Y «ACTUALIZAR» NO SE PISAN EN LA BARRA DE ANALÍTICA
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// QUE DEFIENDE. Que el campo «Nombre de la sección…» de `/analitica` sea legible y pulsable en un
// teléfono. Medido en Chromium el 2026-09-17 a 390x844 con sesión de maestro, sobre el dev
// server: el campo ocupaba x=24..274 (250 px de ancho) y el botón «Actualizar» x=141..255, LOS
// DOS a la misma altura (y=217..249). O sea 114 px de ancho por 32 de alto de SOLAPE: el botón
// pintado encima del buscador. Lo vieron dos agentes por separado.
//
// POR QUE NO LO VIO NINGUN TEST. `documentElement.scrollWidth - clientWidth` daba 0, así que no
// era un desbordamiento que una guardia de ancho pudiera cazar: los dos controles estaban DENTRO
// de la pantalla, uno encima del otro. Y jsdom no calcula layout —`getBoundingClientRect` da
// ceros—, así que un test de render pasa en verde con el defecto puesto. Sin un navegador, lo
// único que distingue el estado bueno del malo es la clase declarada. Mismo razonamiento, y
// mismo formato, que `encabezado-acciones-dentro-del-ancho.guardia.test.ts` (ficha 437).
//
// LA CAUSA, QUE NO ERA LA QUE PARECIA. La fila YA declaraba `flex-wrap`. Lo que impedía que
// envolviera era la celda del filtro: `min-w-0 flex-1` es `flex: 1 1 0%` con el mínimo
// automático anulado, así que la celda podía encogerse hasta CERO y la fila nunca tenía motivo
// para partirse. Su contenido, en cambio, NO encogía: el campo de `BuscadorFiltros` declara
// `min-w-[250px]` y se desbordaba de su propia celda, por debajo del botón.
const FUENTE = readFileSync(
  resolve(process.cwd(), "app/(app)/analitica/page.tsx"),
  "utf8",
);

/** Breakpoints de Tailwind v4 por defecto, en px. */
const BREAKPOINTS: Record<string, number> = { sm: 640, md: 768, lg: 1024, xl: 1280, "2xl": 1536 };

/**
 * ANCHO QUE LA FILA NECESITA PARA CABER EN UNA SOLA LINEA, medido en el navegador el 2026-09-17.
 *
 * Se deja la aritmética escrita para que quien quiera bajar el breakpoint tenga los números
 * delante y no una opinión.
 */
/** El mínimo del campo de búsqueda: `min-w-[250px]` en `components/shared/BuscadorFiltros.tsx`. */
const BUSCADOR_MINIMO_PX = 250;
/** El grupo «Actualizar»: botón 115 + `gap-2` (8) + el sello de frescura (~100). */
const ACTUALIZAR_PX = 223;
/** Los dos `px-6` de la fila pegajosa (24 + 24) más su `lg:gap-x-4` (16). */
const PADDING_Y_HUECO_PX = 24 + 16 + 24;
const FILA_NECESITA_PX = BUSCADOR_MINIMO_PX + ACTUALIZAR_PX + PADDING_Y_HUECO_PX; // 537

/**
 * LA FILA NO MIDE LO QUE EL VIEWPORT. Desde `md` el sidebar es fijo y visible
 * (`SIDEBAR_WIDTH = "16rem"` + `md:flex`, en `components/ui/sidebar.tsx`), así que le come
 * 256 px. El `-mx-6` de la fila sólo compensa el `p-6` del contenedor: no le devuelve ancho.
 */
const SIDEBAR_PX = 256;
const SIDEBAR_DESDE_PX = BREAKPOINTS.md;

/** Ancho REAL de la fila pegajosa cuando el viewport mide `viewportPx`. */
export function anchoDeLaFila(viewportPx: number): number {
  return viewportPx >= SIDEBAR_DESDE_PX ? viewportPx - SIDEBAR_PX : viewportPx;
}

/**
 * EL PEOR ANCHO DESDE UN BREAKPOINT HACIA ARRIBA, y no el ancho EN ese breakpoint. La diferencia
 * importa y es la que descarta `sm`: `anchoDeLaFila` NO crece de forma monótona con el viewport
 * —a 767 la fila mide 767 y a 768 mide 512, porque justo ahí aparece el sidebar—, así que elegir
 * un breakpoint por lo que mide en su propio umbral deja sin mirar la BAJADA que viene después.
 *
 * Con `sm:flex-row` la fila cabría de 640 a 767 (640 px ≥ 537) y se rompería de 768 a 1023
 * (512 px), que es una tableta entera. Por eso el mínimo se toma sobre los dos puntos donde la
 * función puede tocar suelo: el propio umbral y el salto del sidebar.
 */
export function anchoMinimoDesde(viewportPx: number): number {
  const candidatos = viewportPx < SIDEBAR_DESDE_PX ? [viewportPx, SIDEBAR_DESDE_PX] : [viewportPx];
  return Math.min(...candidatos.map(anchoDeLaFila));
}

/**
 * El `className` de la fila pegajosa. Se ancla por `sticky top-0 z-20`, que es lo que la hace
 * ser ESA fila, y no por su posición en el archivo: mover el bloque no apaga el detector.
 */
function claseDeLaFila(fuente = FUENTE): string {
  const m = fuente.match(/<div className="(sticky top-0 z-20[^"]*)"/);
  return (m?.[1] ?? "").replace(/\s+/g, " ").trim();
}

/**
 * El `className` de la celda que envuelve la barra de filtros. Se ancla por su CONTENIDO
 * (`<FiltrosEntregas`), no por su clase: así una clase cambiada se ve, en vez de dejar el
 * extractor devolviendo `""` y la guardia en verde por no encontrar nada.
 */
function claseDeLaCelda(fuente = FUENTE): string {
  const m = fuente.match(/<div className="([^"]*)">\s*(?:\{\/\*(?:(?!\*\/)[\s\S])*?\*\/\}\s*)?<FiltrosEntregas/);
  return (m?.[1] ?? "").replace(/\s+/g, " ").trim();
}

/** El breakpoint con el que una clase vuelve a poner la fila en horizontal (`lg:flex-row` -> lg). */
function breakpointDeFilaHorizontal(clase: string): string | null {
  return clase.match(/\b(sm|md|lg|xl|2xl):flex-row\b/)?.[1] ?? null;
}

/** El breakpoint desde el que la celda puede volver a encogerse (`lg:min-w-0` -> lg). */
function breakpointDeCeldaEncogible(clase: string): string | null {
  return clase.match(/\b(sm|md|lg|xl|2xl):min-w-0\b/)?.[1] ?? null;
}

describe("446 · /analitica — el buscador y «Actualizar» no comparten píxeles", () => {
  it("los extractores leen las dos clases, y son distintas", () => {
    expect(claseDeLaFila()).not.toBe("");
    expect(claseDeLaCelda()).not.toBe("");
    expect(claseDeLaFila()).not.toBe(claseDeLaCelda());
    expect(claseDeLaFila()).toContain("backdrop-blur-md");
  });

  it("⭑ la fila NO es horizontal por defecto: apila, como el encabezado de la 437", () => {
    const clase = claseDeLaFila();
    expect(clase, "la fila pegajosa declara `flex-col` como base").toContain("flex-col");
    // Y no queda un `flex-row` ni un `justify-between` sueltos que la devuelvan a una línea en
    // el teléfono: ese era exactamente el estado del reporte.
    expect(clase).not.toMatch(/(^|\s)flex-row(\s|$)/);
    expect(clase).not.toMatch(/(^|\s)justify-between(\s|$)/);
  });

  it("⭑ la celda del filtro sólo puede encogerse DE `lg` PARA ARRIBA", () => {
    const clase = claseDeLaCelda();
    // `min-w-0` sin prefijo es la mitad de la causa: anula el mínimo automático del flex y deja
    // que la celda se estruje por debajo del `min-w-[250px]` de su propio buscador, que
    // entonces se sale de ella y se mete debajo del botón.
    expect(clase, "`min-w-0` sin prefijo reintroduce el solape del reporte").not.toMatch(
      /(^|\s)min-w-0(\s|$)/,
    );
    expect(clase).not.toMatch(/(^|\s)flex-1(\s|$)/);
    expect(breakpointDeCeldaEncogible(clase)).toBe(breakpointDeFilaHorizontal(claseDeLaFila()));
  });

  it("⭑ el breakpoint que devuelve la fila a una línea deja sitio para los dos controles", () => {
    const bp = breakpointDeFilaHorizontal(claseDeLaFila());
    expect(bp, "la fila no declara ningun `<bp>:flex-row`").not.toBeNull();

    const disponible = anchoMinimoDesde(BREAKPOINTS[bp!]);
    // El número, no la opinión: de `lg` para arriba el peor caso son 1024 − 256 = 768 px contra
    // los 537 que piden el buscador y el grupo de «Actualizar». De `md` para arriba, 512.
    expect(
      disponible,
      `con \`${bp}:\` la fila llegaria a medir ${disponible}px y necesita ${FILA_NECESITA_PX}px`,
    ).toBeGreaterThanOrEqual(FILA_NECESITA_PX);
  });

  it("la aritmetica de esta guardia es la medida, y el sidebar entra en la cuenta", () => {
    expect(FILA_NECESITA_PX).toBe(537);
    expect(anchoDeLaFila(390)).toBe(390);
    expect(anchoDeLaFila(767)).toBe(767);
    expect(anchoDeLaFila(768)).toBe(512);
    expect(anchoDeLaFila(1024)).toBe(768);
    expect(anchoDeLaFila(1440)).toBe(1184);
    // A 390 no cabe ni de lejos, que es de donde salio la ficha.
    expect(anchoDeLaFila(390)).toBeLessThan(FILA_NECESITA_PX);
    // Y el peor caso NO es el umbral: a 640 la fila mide 640, pero a 768 cae a 512.
    expect(anchoMinimoDesde(640)).toBe(512);
    expect(anchoMinimoDesde(1024)).toBe(768);
  });

  describe("CONTRAPRUEBAS — sobre cuerpos mutados, el detector los ve", () => {
    it("volver al `flex-wrap justify-between` de siempre (el estado del reporte)", () => {
      const mutado = FUENTE.replace(
        'className="sticky top-0 z-20 -mx-6 flex flex-col gap-2 bg-background/70 px-6 py-3 backdrop-blur-md lg:flex-row lg:flex-wrap lg:items-start lg:justify-between lg:gap-x-4 lg:gap-y-2"',
        'className="sticky top-0 z-20 -mx-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-2 bg-background/70 px-6 py-3 backdrop-blur-md"',
      );
      expect(mutado).not.toBe(FUENTE);
      const clase = claseDeLaFila(mutado);
      expect(clase).not.toContain("flex-col");
      expect(breakpointDeFilaHorizontal(clase)).toBeNull();
      expect(clase).toMatch(/(^|\s)justify-between(\s|$)/);
    });

    it("devolverle a la celda su `min-w-0 flex-1` sin prefijo", () => {
      const mutado = FUENTE.replace(
        'className="w-full lg:min-w-0 lg:flex-1"',
        'className="min-w-0 flex-1"',
      );
      expect(mutado).not.toBe(FUENTE);
      const clase = claseDeLaCelda(mutado);
      expect(clase).toMatch(/(^|\s)min-w-0(\s|$)/);
      expect(breakpointDeCeldaEncogible(clase)).toBeNull();
    });

    // ⚠️ El literal `lg:flex-row` aparece TAMBIÉN en el comentario de la página, y un `replace`
    // a secas muta la prosa y deja la clase intacta: el caso pasaría en verde sin haber probado
    // nada. Es la misma trampa que documenta la guardia de la 437, y aquí se evitó mutando el
    // atributo entero. (Este archivo la comprueba: si el ancla dejara de encontrarse, el
    // `not.toBe(FUENTE)` de cada contraprueba lo diría.)
    it("bajar el breakpoint a `md` deja la fila en 512px, por debajo de los 537", () => {
      const mutado = FUENTE.replace(
        "backdrop-blur-md lg:flex-row",
        "backdrop-blur-md md:flex-row",
      );
      expect(mutado).not.toBe(FUENTE);
      const bp = breakpointDeFilaHorizontal(claseDeLaFila(mutado));
      expect(bp).toBe("md");
      expect(anchoMinimoDesde(BREAKPOINTS[bp!])).toBeLessThan(FILA_NECESITA_PX);
    });

    // `sm` es el caso que la aritmética ingenua deja pasar: en su propio umbral la fila mide
    // 640 y cabría. Lo que la descarta es la franja de 768 a 1023, donde el sidebar la deja en
    // 512 — una tableta entera con el botón encima del buscador.
    it("bajarlo a `sm` cabe en su umbral y se rompe en cuanto aparece el sidebar", () => {
      expect(anchoDeLaFila(BREAKPOINTS.sm)).toBeGreaterThanOrEqual(FILA_NECESITA_PX);
      expect(anchoMinimoDesde(BREAKPOINTS.sm)).toBeLessThan(FILA_NECESITA_PX);
    });

    it("si alguien quita `<FiltrosEntregas`, el extractor de la celda no finge que todo sigue bien", () => {
      const mutado = FUENTE.replace("<FiltrosEntregas facetas={recorte.facetas} />", "{null}");
      expect(mutado).not.toBe(FUENTE);
      expect(claseDeLaCelda(mutado)).toBe("");
      // …y el de la fila sigue vivo, o sea que no se apago la guardia entera.
      expect(breakpointDeFilaHorizontal(claseDeLaFila(mutado))).toBe("lg");
    });
  });
});
