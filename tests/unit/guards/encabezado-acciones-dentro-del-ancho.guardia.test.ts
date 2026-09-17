import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ GUARDIA — FICHA 437 · LOS CONTROLES DEL ENCABEZADO CABEN EN LA PANTALLA
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// QUE DEFIENDE. Que «Salir» (y el resto de la fila de controles) sea ALCANZABLE en un telefono.
// El 2026-09-17, en `/mis-asignaciones/reparto` a 390x844 con sesion de mensajero, el boton
// empezaba en x=352 y terminaba en 427 con el viewport en 390, y
// `documentElement.scrollWidth - clientWidth` daba 0: sin scroll horizontal, o sea que NO HABIA
// FORMA de cerrar sesion desde un telefono. No lo rompio un test: el boton existia, tenia su rol
// y su nombre accesible, y `PageHeader.test.tsx` lo encontraba perfectamente estando fuera de la
// pantalla. Por eso esta guardia NO afirma «existe el boton».
//
// POR QUE ES UNA GUARDIA DE TEXTO Y NO UN RENDER. jsdom no calcula layout: `getBoundingClientRect`
// devuelve ceros, asi que un test de render pasa en VERDE con el defecto puesto —se comprobo, es
// justo lo que hacia la suite hasta ahora—. Sin un navegador, lo unico que distingue el estado
// bueno del malo es la clase declarada. Es el mismo razonamiento, y el mismo formato, que
// `tests/unit/components/calendario-ancho-de-celda.guardia.test.ts`.
//
// LA ARITMETICA ES LA MEDIDA EN EL NAVEGADOR, no una regla de estilo. Se deja aqui para que el
// dia que alguien quiera bajar el breakpoint tenga los numeros delante y no una opinion.
const FUENTE = readFileSync(
  resolve(process.cwd(), "components/shared/PageHeader.tsx"),
  "utf8",
);

/** Breakpoints de Tailwind v4 por defecto, en px. */
const BREAKPOINTS: Record<string, number> = { sm: 640, md: 768, lg: 1024, xl: 1280, "2xl": 1536 };

/**
 * ANCHO QUE EL ENCABEZADO NECESITA PARA CABER EN UNA SOLA FILA, medido en Chromium el 2026-09-17
 * sobre el dev server, con las tres pantallas del reporte.
 *
 * De `sm` para arriba la fila de controles mide 521 px: fecha 110 · «?» 90 · tema 82 ·
 * campana 116 · «Salir» 75, con cuatro huecos de `gap-3` (12). A eso se le suman los dos
 * `px-5` (20 + 20), el `gap-3` que la separa del titulo (12) y el ancho MINIMO del bloque de
 * titulo, que no puede ceder mas: 83 px en `/cierres-admin`, 118 px en `/monitoreo`.
 */
const CONTROLES_PX = 521;
const PADDING_Y_HUECO_PX = 20 + 12 + 20;
const TITULO_MINIMO_PX = 118; // el peor de los medidos (`/monitoreo`)
const ENCABEZADO_NECESITA_PX = CONTROLES_PX + PADDING_Y_HUECO_PX + TITULO_MINIMO_PX; // 691

/**
 * EL ENCABEZADO NO MIDE LO QUE EL VIEWPORT. Desde `md` el sidebar es fijo y visible
 * (`SIDEBAR_WIDTH = "16rem"` + `md:flex`, en `components/ui/sidebar.tsx`), asi que le come 256 px.
 * Medido: a 768 de viewport el encabezado mide 512 y «Salir» terminaba en 927 contra un limite
 * de 748.
 */
const SIDEBAR_PX = 256;
const SIDEBAR_DESDE_PX = BREAKPOINTS.md;

/** Ancho REAL del encabezado cuando el viewport mide `viewportPx`. */
export function anchoDelEncabezado(viewportPx: number): number {
  return viewportPx >= SIDEBAR_DESDE_PX ? viewportPx - SIDEBAR_PX : viewportPx;
}

/** El `className` del `<header>` (plantilla literal, puede ocupar varias lineas). */
function claseDelHeader(fuente = FUENTE): string {
  return (fuente.match(/<header className=\{`([^`]*)`/)?.[1] ?? "").replace(/\s+/g, " ").trim();
}

/**
 * El `className` del contenedor de controles: el `<div>` que envuelve la fecha, el «?», el tema,
 * la campana y «Salir». Se ancla por su contenido (`<LogoutButton />`) y no por su posicion, para
 * que reordenar el encabezado no apague el detector en silencio.
 */
function claseDeLosControles(fuente = FUENTE): string {
  const m = fuente.match(/<div className="([^"]*)">(?:(?!<\/div>)[\s\S])*?<LogoutButton \/>/);
  return (m?.[1] ?? "").replace(/\s+/g, " ").trim();
}

/** El breakpoint con el que una clase vuelve a poner la fila en horizontal (`lg:flex-row` -> lg). */
function breakpointDeFilaHorizontal(clase: string): string | null {
  return clase.match(/\b(sm|md|lg|xl|2xl):flex-row\b/)?.[1] ?? null;
}

/** El breakpoint POR DEBAJO del cual los controles pueden envolver (`max-lg:flex-wrap` -> lg). */
function breakpointDeEnvoltura(clase: string): string | null {
  return clase.match(/\bmax-(sm|md|lg|xl|2xl):flex-wrap\b/)?.[1] ?? null;
}

describe("437 · encabezado — la fila de controles cabe, y «Salir» es alcanzable", () => {
  it("los extractores leen las dos clases por separado", () => {
    expect(claseDelHeader()).not.toBe("");
    expect(claseDeLosControles()).not.toBe("");
    expect(claseDelHeader()).not.toBe(claseDeLosControles());
    // El de los controles es el que tiene a «Salir» dentro, no el del titulo.
    expect(claseDelHeader()).toContain("border-b");
  });

  it("⭑ el encabezado NO es una fila horizontal fija: por defecto apila", () => {
    const clase = claseDelHeader();
    expect(clase, "el encabezado declara `flex-col` como base").toContain("flex-col");
    // Y no queda un `flex-row` suelto (sin breakpoint) que lo anule: ese era el estado roto.
    expect(clase).not.toMatch(/(^|\s)flex-row(\s|$)/);
    expect(clase).not.toMatch(/(^|\s)justify-between(\s|$)/);
  });

  it("⭑ el breakpoint que devuelve la fila horizontal deja sitio para TODOS los controles", () => {
    const bp = breakpointDeFilaHorizontal(claseDelHeader());
    expect(bp, "el encabezado no declara ningun `<bp>:flex-row`").not.toBeNull();

    const viewport = BREAKPOINTS[bp!];
    const disponible = anchoDelEncabezado(viewport);
    // El numero, no la opinion: a `lg` son 1024 - 256 = 768 px contra los 691 que pide el
    // peor caso medido. Con `md` serian 512 y con `sm`, 640: los dos por debajo.
    expect(
      disponible,
      `con \`${bp}:\` el encabezado tendria ${disponible}px y necesita ${ENCABEZADO_NECESITA_PX}px`,
    ).toBeGreaterThanOrEqual(ENCABEZADO_NECESITA_PX);
  });

  it("⭑ por debajo de ese mismo breakpoint los controles pueden envolver (seguro del caso estrecho)", () => {
    const bpFila = breakpointDeFilaHorizontal(claseDelHeader());
    const bpEnvoltura = breakpointDeEnvoltura(claseDeLosControles());
    expect(
      bpEnvoltura,
      "la fila de controles no declara `max-<bp>:flex-wrap`: a 320px, o con el boton de instalar la PWA visible, se sale de la pantalla",
    ).not.toBeNull();
    // Mismo breakpoint que la fila: si se separan, queda una franja de anchos sin cubrir.
    expect(bpEnvoltura).toBe(bpFila);
  });

  it("los controles NO envuelven de `lg` para arriba (el escritorio se queda como estaba)", () => {
    const clase = claseDeLosControles();
    // `flex-wrap` a secas aplicaria tambien a 1440 y ahi los controles se parten en dos lineas:
    // medido, «Salir» saltaba a x=926 en `/monitoreo`.
    expect(clase).not.toMatch(/(^|\s)flex-wrap(\s|$)/);
  });

  it("la aritmetica de esta guardia es la medida, y el sidebar entra en la cuenta", () => {
    expect(ENCABEZADO_NECESITA_PX).toBe(691);
    expect(anchoDelEncabezado(390)).toBe(390);
    expect(anchoDelEncabezado(767)).toBe(767);
    expect(anchoDelEncabezado(768)).toBe(512);
    expect(anchoDelEncabezado(1024)).toBe(768);
    expect(anchoDelEncabezado(1440)).toBe(1184);
  });

  describe("CONTRAPRUEBAS — sobre cuerpos mutados, el detector los ve", () => {
    it("volver al `flex-row justify-between` fijo (el estado del reporte)", () => {
      const mutado = FUENTE.replace(
        "flex flex-col gap-3 px-5 py-4",
        "flex flex-row gap-3 px-5 py-4",
      ).replace("lg:flex-row lg:justify-between", "justify-between");
      expect(mutado).not.toBe(FUENTE);
      const clase = claseDelHeader(mutado);
      expect(clase).not.toContain("flex-col");
      expect(breakpointDeFilaHorizontal(clase)).toBeNull();
      expect(clase).toMatch(/(^|\s)justify-between(\s|$)/);
    });

    it("bajar el breakpoint a `md` deja el encabezado en 512px, por debajo de los 691", () => {
      const mutado = FUENTE.replace("lg:flex-row", "md:flex-row");
      expect(mutado).not.toBe(FUENTE);
      const bp = breakpointDeFilaHorizontal(claseDelHeader(mutado));
      expect(bp).toBe("md");
      expect(anchoDelEncabezado(BREAKPOINTS[bp!])).toBeLessThan(ENCABEZADO_NECESITA_PX);
    });

    it("bajarlo a `sm` tampoco llega, aunque ahi no haya sidebar", () => {
      const bp = "sm";
      expect(anchoDelEncabezado(BREAKPOINTS[bp])).toBeLessThan(ENCABEZADO_NECESITA_PX);
    });

    it("quitarle la envoltura a la fila de controles", () => {
      const mutado = FUENTE.replace(' max-lg:flex-wrap"', '"');
      expect(mutado).not.toBe(FUENTE);
      expect(breakpointDeEnvoltura(claseDeLosControles(mutado))).toBeNull();
      // …y el detector de la fila sigue vivo, o sea que no se apago entero.
      expect(breakpointDeFilaHorizontal(claseDelHeader(mutado))).toBe("lg");
    });

    it("dejar la envoltura SIN acotar (`flex-wrap` a secas) parte los controles en el escritorio", () => {
      // ⚠️ El literal `max-lg:flex-wrap` tambien aparece en el comentario del componente, y
      // ANTES: un `replace` a secas mutaba la prosa y dejaba la clase intacta —el test fallaba
      // por la razon equivocada—. Se muta el atributo entero, con su comilla de cierre.
      const mutado = FUENTE.replace(
        'className="flex items-center gap-3 max-lg:flex-wrap"',
        'className="flex flex-wrap items-center gap-3"',
      );
      expect(mutado).not.toBe(FUENTE);
      expect(claseDeLosControles(mutado)).toMatch(/(^|\s)flex-wrap(\s|$)/);
    });

    it("si alguien borra el `<LogoutButton />`, el extractor no finge que todo sigue bien", () => {
      const mutado = FUENTE.replace("<LogoutButton />", "{null}");
      expect(mutado).not.toBe(FUENTE);
      expect(claseDeLosControles(mutado)).toBe("");
    });
  });
});
