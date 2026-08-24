// @vitest-environment jsdom
//
// Feature 258 (F2.3) — LOS CINCO ESTADOS DE LA RUTA, cada uno con SU icono.
// Mapea: R24, R25, R26, R27, R28, R29, R30.
//
// Por qué esto es un test y no una revisión visual: un icono repetido en dos estados, o un
// icono colocado como segundo hijo de un `Alert`, no rompe nada — la pantalla sigue
// pintándose y ningún test de la 192 se entera. Es exactamente la familia de defectos que
// este repo llama «el sistema no falla, aparenta».
//
// Lo que se mide:
//   - que cada estado pinta UN icono (R24);
//   - que los CINCO son distintos entre sí (R25): dos estados con el mismo dibujo no se
//     distinguen de un vistazo, que es para lo que sirve el icono;
//   - que el del vacío entra por la prop `icon` de `EmptyState` y sale decorativo (R26);
//   - que en los `Alert` el `<svg>` es el PRIMER hijo (R27): la primitiva aplica
//     `has-[>svg]:grid-cols-[auto_1fr]` y sin esa posición la rejilla no se forma;
//   - que el esqueleto conserva su anuncio accesible (R28);
//   - que con los `<svg>` suprimidos el mensaje SIGUE siendo legible (R29): el icono acelera
//     el reconocimiento, no lo sustituye;
//   - que los cinco siguen distinguiéndose en el DOM por su `data-slot` (R30).

import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  AvisoDenegado,
  AvisoTarjetaDesaparecida,
} from "@/app/(app)/monitoreo/_components/TableroDiaModule";
import {
  QUITAR_FILTRO,
  TableroDiaAvisoRefresco,
  TableroDiaSinCoincidencias,
  TableroDiaSkeleton,
  TableroDiaVacio,
} from "@/app/(app)/monitoreo/_components/TableroDiaEstados";
import { quitarComentarios } from "../fixtures/sin-comentarios";

afterEach(cleanup);

/**
 * Los CINCO estados de la ruta, con el `data-slot` por el que se distinguen (R30). El vacío
 * del filtro va aparte: no es uno de los cinco, pero lleva icono por coherencia (R42) y su
 * icono también tiene que ser distinto.
 */
const ESTADOS = [
  { nombre: "cargando", slot: "tablero-dia-skeleton", pinta: () => <TableroDiaSkeleton /> },
  {
    nombre: "sin órdenes para hoy",
    slot: "tablero-dia-vacio",
    pinta: () => <TableroDiaVacio />,
  },
  {
    nombre: "refresco fallido",
    slot: "tablero-dia-aviso-refresco",
    pinta: () => <TableroDiaAvisoRefresco />,
  },
  { nombre: "acceso denegado", slot: "tablero-dia-denegado", pinta: () => <AvisoDenegado /> },
  {
    nombre: "tarjeta desaparecida",
    slot: "tablero-dia-aviso-desaparecido",
    pinta: () => <AvisoTarjetaDesaparecida />,
  },
] as const;

/** El nodo raíz del estado, localizado por su `data-slot` (R30). */
function raiz(slot: string): HTMLElement {
  const nodo = document.querySelector(`[data-slot="${slot}"]`);
  if (!(nodo instanceof HTMLElement)) throw new Error(`sin estado ${slot}`);
  return nodo;
}

/**
 * El nombre del icono de lucide, sacado de la clase que la librería pone en el `<svg>`
 * (`lucide lucide-lock`). Se lee así y no por el componente importado porque lo que hay que
 * comparar es lo que SE PINTA: dos estados podrían importar iconos distintos y renderizar el
 * mismo por un copy-paste.
 */
function iconosDe(nodo: HTMLElement): string[] {
  return [...nodo.querySelectorAll("svg")]
    .map((svg) => (svg.getAttribute("class") ?? "").match(/lucide-[a-z0-9-]+/)?.[0] ?? "")
    .filter(Boolean);
}

describe("Feature 258 · R24/R30 — cada estado pinta su icono y se distingue en el DOM", () => {
  it.each(ESTADOS)("«$nombre» pinta un icono de lucide dentro de su `data-slot`", ({ slot, pinta }) => {
    render(pinta());
    const iconos = iconosDe(raiz(slot));
    expect(iconos.length, `el estado ${slot} no pinta ningún icono`).toBeGreaterThanOrEqual(1);
  });

  it("el vacío del FILTRO también lleva icono, y su propio `data-slot` (R42)", () => {
    render(<TableroDiaSinCoincidencias onQuitarFiltro={() => {}} />);
    expect(iconosDe(raiz("tablero-dia-sin-coincidencias")).length).toBeGreaterThanOrEqual(1);
    // Y la salida: sin ella, quien filtró mal se queda mirando una pantalla vacía.
    expect(screen.getByRole("button", { name: QUITAR_FILTRO })).toBeInTheDocument();
  });
});

describe("Feature 258 · R25 — los cinco iconos son DISTINTOS entre sí", () => {
  it("ningún estado repite el dibujo de otro", () => {
    const porEstado = ESTADOS.map(({ slot, pinta }) => {
      render(pinta());
      const icono = iconosDe(raiz(slot))[0];
      cleanup();
      return { slot, icono };
    });

    const nombres = porEstado.map((e) => e.icono);
    expect(
      new Set(nombres).size,
      `dos estados llevan el mismo icono: ${porEstado.map((e) => `${e.slot}=${e.icono}`).join(" | ")}`,
    ).toBe(ESTADOS.length);
  });

  it("el del vacío del filtro tampoco repite ninguno de los cinco", () => {
    const cinco = ESTADOS.map(({ slot, pinta }) => {
      render(pinta());
      const icono = iconosDe(raiz(slot))[0];
      cleanup();
      return icono;
    });

    render(<TableroDiaSinCoincidencias onQuitarFiltro={() => {}} />);
    const delFiltro = iconosDe(raiz("tablero-dia-sin-coincidencias"))[0];
    expect(cinco).not.toContain(delFiltro);
  });
});

describe("Feature 258 · R26 — el icono del vacío lo pinta `EmptyState`", () => {
  it("va dentro del disco `bg-muted` que produce la primitiva, y es decorativo", () => {
    render(<TableroDiaVacio />);
    const svg = raiz("tablero-dia-vacio").querySelector("svg");
    expect(svg).not.toBeNull();

    // `EmptyState` envuelve el icono en un `<span aria-hidden class="… rounded-full bg-muted …">`.
    // Si alguien pintara el icono a mano fuera de la primitiva, ese envoltorio no estaría.
    const envoltorio = svg!.parentElement as HTMLElement;
    expect(envoltorio.getAttribute("aria-hidden")).toBe("true");
    expect(envoltorio.className).toContain("bg-muted");
  });
});

describe("Feature 258 · R27 — en un `Alert`, el icono es el PRIMER hijo", () => {
  const ALERTAS = [
    { slot: "tablero-dia-aviso-refresco", pinta: () => <TableroDiaAvisoRefresco /> },
    { slot: "tablero-dia-denegado", pinta: () => <AvisoDenegado /> },
    { slot: "tablero-dia-aviso-desaparecido", pinta: () => <AvisoTarjetaDesaparecida /> },
  ] as const;

  it.each(ALERTAS)("$slot pone el `<svg>` antes del título", ({ slot, pinta }) => {
    render(pinta());
    const alerta = raiz(slot);
    // Es un `Alert` de verdad: la primitiva le pone `role="alert"`.
    expect(alerta.getAttribute("role")).toBe("alert");
    expect(
      alerta.firstElementChild?.tagName.toLowerCase(),
      "el icono no es el primer hijo: la rejilla de dos columnas del Alert no se forma",
    ).toBe("svg");
  });
});

describe("Feature 258 · R28 — el icono NO sustituye el anuncio de carga", () => {
  it("el esqueleto conserva `role=\"status\"`, `aria-busy` y su nombre accesible", () => {
    render(<TableroDiaSkeleton tarjetas={3} />);
    const esqueleto = raiz("tablero-dia-skeleton");

    expect(esqueleto.getAttribute("role")).toBe("status");
    expect(esqueleto.getAttribute("aria-busy")).toBe("true");
    expect(esqueleto.getAttribute("aria-label")).toMatch(/cargando/i);
    // El icono va dentro de la MISMA región y es decorativo.
    expect(esqueleto.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Feature 258 · R29 — ningún icono es el único portador de información", () => {
  it.each(ESTADOS)(
    "«$nombre» sigue diciendo lo suyo con los `<svg>` suprimidos",
    ({ slot, pinta }) => {
      render(pinta());
      const nodo = raiz(slot);
      for (const svg of [...nodo.querySelectorAll("svg")]) svg.remove();

      // Texto visible, o —en el esqueleto, que no tiene texto de datos— el nombre accesible.
      const texto = `${nodo.textContent ?? ""} ${nodo.getAttribute("aria-label") ?? ""}`.trim();
      expect(
        texto.length,
        `el estado ${slot} se queda mudo sin su icono`,
      ).toBeGreaterThan(10);
    },
  );
});

/* ══════════════════════════════════════════════════════════════════════════════════════════
   FEATURE 259 (T7) — LA PANTALLA YA NO DICE LO CONTRARIO DE LO QUE CUENTA

   Desde el 2026-08-21 el tablero cuenta por el día PARA EL QUE se asignó la orden, no por el
   día en que se asignó. Cuatro textos quedaron diciendo lo contrario, y el peor prometía algo
   que ya no ocurre: «En cuanto se asigne la primera, aparecerá aquí» es FALSO si esa primera
   se asigna para mañana. Es la familia de defectos que este repo llama «el sistema no falla,
   aparenta»: no rompe ningún test, no la caza `eslint`, y sólo se ve abriendo la app.

   Aquí se miden dos de los cuatro sitios (los que este archivo puede renderizar) y, por
   fuente, la regla de lenguaje (R25) sobre los cuatro.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Los cuatro archivos con texto del día, por RUTA. Se censa la fuente y no lo renderizado
 * porque dos de las cuatro frases no se pintan desde aquí: el `aria-label` de la tarjeta y la
 * cabecera del detalle piden el módulo entero con SWR, y viven en sus propios archivos de test.
 */
const FUENTES_CON_TEXTO_DEL_DIA = [
  "app/(app)/monitoreo/_components/TableroDiaEstados.tsx",
  "app/(app)/monitoreo/_components/TableroDiaModule.tsx",
  "app/(app)/monitoreo/_components/MensajeroCard.tsx",
  "app/(app)/monitoreo/_components/DetalleMensajeroPanel.tsx",
] as const;

/**
 * R25 — la jerga que un texto de esta pantalla NO puede usar: el nombre interno de la idea
 * («día de reparto»), el nombre de las columnas y las siglas. Esta app ya arrastra una deuda
 * por escribir una sigla en una pantalla; el detector existe para que no haya una segunda.
 */
const JERGA: readonly RegExp[] = [
  /d[ií]a de reparto/i,
  /fecha_reparto/,
  /asignado_at/,
  /\bSLA\b/,
];

/** Los patrones de jerga que aparecen en un texto. Función pura: se autocomprueba abajo. */
function jergaEn(texto: string): string[] {
  return JERGA.filter((patron) => patron.test(texto)).map((patron) => patron.source);
}

/** El texto visible de un estado ya renderizado. */
function textoDe(slot: string): string {
  return raiz(slot).textContent ?? "";
}

describe("Feature 259 · R23 — el vacío ya NO promete que la siguiente asignación aparecerá aquí", () => {
  it("dice qué cuenta la pantalla, y la promesa vieja NO está", () => {
    render(<TableroDiaVacio />);
    const texto = textoDe("tablero-dia-vacio");

    expect(texto).toContain("Sin órdenes asignadas para hoy");
    expect(texto).toContain("Ningún mensajero tiene órdenes asignadas para hoy dentro de tu alcance.");
    expect(
      texto,
      "volvió «aparecerá aquí»: es falso si esa primera orden se asigna para otro día",
    ).not.toMatch(/aparecer[áa] aqu[ií]/i);
  });

  it("en vez de prometer, dice DÓNDE aparece lo que se asigna para otro día", () => {
    // No es adorno: sin esta frase, quien asigne para mañana verá desaparecer sus órdenes del
    // tablero de hoy y lo leerá como «se perdieron».
    render(<TableroDiaVacio />);
    expect(textoDe("tablero-dia-vacio")).toContain(
      "lo que se asigne para otro día aparecerá en el tablero de ese día",
    );
  });
});

describe("Feature 259 · R24 — los textos renderizables dicen «para hoy», no «hoy»", () => {
  it("el estado vacío", () => {
    render(<TableroDiaVacio />);
    const texto = textoDe("tablero-dia-vacio");
    expect(texto).toMatch(/asignadas para hoy/);
    expect(texto, "volvió el criterio viejo: «asignadas hoy»").not.toMatch(/asignadas hoy/i);
  });

  it("el aviso de «se cerró el detalle» — el CUARTO sitio, el que no estaba en la pregunta", () => {
    render(<AvisoTarjetaDesaparecida />);
    const texto = textoDe("tablero-dia-aviso-desaparecido");

    expect(texto).toContain(
      "ya no tiene órdenes asignadas para hoy dentro de tu alcance",
    );
    expect(
      texto,
      "volvió «asignadas hoy»: la misma pantalla diría dos cosas distintas del mismo conteo",
    ).not.toMatch(/asignadas hoy/i);
  });

  it("⛔ el vacío del FILTRO no entra en esta ficha y sigue intacto", () => {
    // Habla del texto que escribiste, no del día: cambiarlo sería pasarse del alcance.
    render(<TableroDiaSinCoincidencias onQuitarFiltro={() => {}} />);
    expect(textoDe("tablero-dia-sin-coincidencias")).toContain(
      "El día sí tiene órdenes asignadas: lo que no encuentra nada es el texto que escribiste.",
    );
  });
});

describe("Feature 259 · R25 — lenguaje de quien opera, en los CUATRO sitios", () => {
  it.each(FUENTES_CON_TEXTO_DEL_DIA)("%s no nombra la jerga interna", (ruta) => {
    const codigo = quitarComentarios(readFileSync(path.join(process.cwd(), ruta), "utf8"));
    expect(
      jergaEn(codigo),
      "un texto de esta pantalla nombra la idea interna, una columna o una sigla",
    ).toEqual([]);
  });

  it("el detector NO es decorado: marca lo que infringe y no marca lo que no", () => {
    // Sin esto, la cláusula de arriba podría estar verde por no detectar nada.
    expect(jergaEn("Sin órdenes con día de reparto hoy")).toContain("d[ií]a de reparto");
    expect(jergaEn('const x = "fecha_reparto";')).toContain("fecha_reparto");
    expect(jergaEn("o.asignado_at")).toContain("asignado_at");
    // `String.raw` y no `"\bSLA\b"`: en una cadena normal `\b` es un BACKSPACE, no dos
    // caracteres, y la comparación con `RegExp.source` falla por un motivo que no es el suyo.
    expect(jergaEn("Vence el SLA")).toContain(String.raw`\bSLA\b`);
    expect(jergaEn("Ningún mensajero tiene órdenes asignadas para hoy.")).toEqual([]);
  });
});
