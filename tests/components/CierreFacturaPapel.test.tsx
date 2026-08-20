// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import path from "node:path";

import { reglasDeArchivo } from "../fixtures/css-reglas";
import { codigoSinComentarios } from "../fixtures/sin-comentarios";
import { Modal } from "@/components/shared/Modal";
import {
  CierreFacturaDetalle,
  CierreFacturaResumen,
  type CierreFacturaCabecera,
} from "@/app/(app)/cierres-admin/_components/cierre-factura";
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
import type {
  CierreDetalleGestion,
  CierreGrupos,
} from "@/lib/interfaces/services/ICierreDiaService";

/**
 * Feature 217 — las DOS hojas del comprobante giran con el tema, y llevan la clase que las
 * devuelve a claro AL IMPRIMIR.
 *
 * ⚠️ LO QUE ESTE ARCHIVO **NO** DEMUESTRA, y conviene leerlo antes que su verde.
 * jsdom no compone estilos: no resuelve la cascada, no calcula un color heredado y no aplica
 * `@media print`. Lo único que se lee aquí es la CADENA DE CLASES del elemento. Que la hoja se
 * vea legible en oscuro lo sostiene el inventario de pares de
 * `tests/unit/guards/factura-contraste.guardia.test.ts` (aritmética sobre los tokens vigentes),
 * y que la regla de impresión exista y no diverja del tema claro lo sostiene
 * `tests/unit/guards/tema-encendido.guardia.test.ts`. Ninguno de los tres afirma «se ve bien»:
 * ninguna pieza del gate renderiza en un navegador ni en papel.
 *
 * Las hojas se localizan por su `role="region"` + `aria-label`, NUNCA por una clase: localizarlas
 * por la clase que se está comprobando haría que el caso pasara por construcción.
 */

function emptyGrupos(): CierreGrupos {
  return {
    entregada: [],
    reprogramada: [],
    devuelta: [],
    rechazada: [],
    incidente: [],
  };
}

function gestion(over: Partial<CierreDetalleGestion> = {}): CierreDetalleGestion {
  return {
    gestionId: "g1",
    ordenId: "o1",
    numGuia: 1001,
    numRemision: "REM-001",
    destinatario: "Ana Pérez",
    direccion: "Calle 1, casa 2",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    producto: "Caja mediana",
    tiendaNombre: "Tienda X",
    resultado: "entregada",
    montoRecibido: "8000.00",
    metodoPago: null,
    pagos: [],
    motivo: null,
    fechaReprogramacion: null,
    evidenciaUrl: null,
    pagoMensajero: "1200.00",
    ingresoBodegaRechazo: null,
    tarifaFaltante: false,
    esRechazoSla: false,
    desdeAyudaTienda: false, // feature 237 (D6/R41): la registro el mensajero, no la tienda
    causaIncidente: null,
    indemnizacion: null,
    ...over,
  };
}

const TOTALES = {
  efectivo: "5000.00",
  simpe: "0.00",
  transferencia: "3000.00",
  general: "8000.00",
};

const CABECERA: CierreFacturaCabecera = {
  cierreId: "c1000001",
  estado: "solicitado",
  destinoTipo: "bodega_central",
  destinoZonaNombre: "GAM",
  mensajeroNombre: "Ana Pérez",
  totales: TOTALES,
  totalPagoMensajero: "1200.00",
  totalIngresoBodegaRechazos: "0.00",
  solicitadoAt: "2026-08-13T10:00:00.000Z",
  resueltoAt: null,
  motivoRechazo: null,
};

const RESUMEN: CierreAdminResumen = {
  cierreId: "c1000001",
  mensajeroId: "m1",
  mensajeroNombre: "Ana Pérez",
  estado: "solicitado",
  destinoTipo: "bodega_central",
  destinoZonaId: "z1",
  destinoZonaNombre: "GAM",
  totales: TOTALES,
  totalPagoMensajero: "1200.00",
  totalIngresoBodegaRechazos: "0.00",
  pendientePagoMensajero: null,
  solicitadoAt: "2026-08-13T10:00:00.000Z",
  resueltoAt: null,
  motivoRechazo: null,
};

/** La hoja del detalle, ya renderizada, localizada por su nombre accesible. */
function hojaDetalle(): HTMLElement {
  render(
    <CierreFacturaDetalle
      cierre={CABECERA}
      grupos={{ ...emptyGrupos(), entregada: [gestion()] }}
    />,
  );
  return screen.getByRole("region", {
    name: "Comprobante detallado del cierre de Ana Pérez",
  });
}

/** La hoja compacta, ya renderizada, localizada por su nombre accesible. */
function hojaResumen(): HTMLElement {
  render(<CierreFacturaResumen cierre={RESUMEN} />);
  return screen.getByRole("region", { name: "Comprobante del cierre de Ana Pérez" });
}

afterEach(() => {
  cleanup();
});

describe("Feature 217 — la hoja del comprobante gira con el tema (R1, R9)", () => {
  it("la hoja del DETALLE ya no fija su subárbol a tema claro", () => {
    expect(hojaDetalle().className).not.toContain("tema-claro");
  });

  it("la hoja COMPACTA tampoco: el mismo documento no puede tener dos materiales", () => {
    expect(hojaResumen().className).not.toContain("tema-claro");
  });

  it("la hoja del DETALLE lleva la clase que la devuelve a claro al imprimir", () => {
    expect(hojaDetalle().className).toContain("papel-al-imprimir");
  });

  it("la hoja COMPACTA lleva la misma clase de impresión", () => {
    expect(hojaResumen().className).toContain("papel-al-imprimir");
  });
});

/**
 * Feature 223 (T4) — LA ÚNICA INCÓGNITA TÉCNICA DEL DISEÑO, MEDIDA.
 *
 * `design.md §4.4` la dejó escrita así: «los diálogos suelen bloquear el scroll escribiendo
 * `overflow: hidden` EN LÍNEA sobre `<html>` o `<body>`. Si `@base-ui/react` lo hace, el
 * `overflow: visible` de la cadena PIERDE y la hoja vuelve a salir recortada — un fallo que el
 * censo del CSS no vería, porque la declaración estaría escrita».
 *
 * **Medido el 2026-08-14, y sí lo hace.** No sólo `overflow`: también `position`, `height` y
 * `width`, los cuatro EN LÍNEA sobre el `<body>`, que es justo el primer elemento de la cadena
 * que la regla (B) neutraliza. Por eso la lista de `!important` de R13 no es de uno sino de
 * cinco, y cada uno tiene aquí su motivo medido en vez de un «por si acaso».
 *
 * Este caso congela la medición: si Base UI cambia de técnica, la lista de `!important` del CSS
 * deja de corresponder a nada y hay que releerla. Se pone rojo antes que el papel.
 */
describe("Feature 223 — el scroll lock del diálogo, medido (R10, R13)", () => {
  /** Las propiedades escritas EN LÍNEA por un `style="a: 1; b: 2"`, sólo sus nombres. */
  function propiedadesEnLinea(el: HTMLElement): string[] {
    const crudo = el.getAttribute("style") ?? "";
    return crudo
      .split(";")
      .map((t) => t.slice(0, t.indexOf(":")).trim())
      .filter(Boolean)
      .sort();
  }

  it("con el diálogo abierto, el `<body>` recibe overflow/position/height/width EN LÍNEA", async () => {
    render(
      <Modal open onOpenChange={() => {}} title="Detalle">
        <p>cuerpo</p>
      </Modal>,
    );
    // El bloqueo lo escribe un efecto, no el render: leerlo síncronamente devuelve una lista
    // VACÍA y este caso pasaría diciendo «no hay estilos en línea», que es justo lo contrario
    // de lo que mide.
    await screen.findByRole("dialog");

    expect(
      propiedadesEnLinea(document.body),
      "Base UI cambió lo que escribe en línea sobre el `<body>` al abrir el diálogo. La lista de " +
        "`!important` del bloque de impresión (`app/globals.css`) se calculó contra ESTA lista: " +
        "un estilo en línea sólo se vence con `!important`, y uno de más es un martillo. " +
        "Recalcúlala con lo que diga este rojo.",
    ).toEqual([
      "box-sizing",
      "height",
      "overflow",
      "position",
      "scroll-behavior",
      "width",
    ]);

    // El `<html>` también queda bloqueado, y eso NO lo cubre la regla (B): su cadena arranca en
    // `body:has(…)` porque R10 acota el alcance a «entre `<body>` y la hoja». Queda declarado
    // como límite medido, no descubierto (ver el comentario del bloque en `app/globals.css`).
    expect(propiedadesEnLinea(document.documentElement)).toEqual([
      "overflow-x",
      "overflow-y",
      "scroll-behavior",
      "scrollbar-gutter",
    ]);
  });

  /**
   * T11 — dónde monta el `Dialog.Portal`, que `design.md` (H4) dejó como comprobación de una
   * línea porque `node_modules` no era legible en aquella sesión.
   *
   * **No es `document.body`**: es un `<div data-base-ui-portal>` colgado del `<body>`. Importa
   * para las ramas de ocultamiento: el diálogo NO es hijo directo del `<body>`, así que hace
   * falta la rama que poda a lo largo de la cadena y no sólo la de los hijos del `<body>`.
   */
  it("el popup se monta en un contenedor propio COLGADO del `<body>`, no en el `<body>`", async () => {
    render(
      <Modal open onOpenChange={() => {}} title="Detalle">
        <p>cuerpo</p>
      </Modal>,
    );
    const popup = await screen.findByRole("dialog");

    expect(popup.parentElement, "el popup quedó sin contenedor").not.toBeNull();
    expect(popup.parentElement).not.toBe(document.body);
    expect(popup.parentElement!.hasAttribute("data-base-ui-portal")).toBe(true);
    expect(popup.parentElement!.parentElement).toBe(document.body);
  });
});

describe("Feature 217 — el indicador de la pestaña activa usa tokens que giran (R3)", () => {
  it("la pestaña seleccionada se marca con `border-foreground` y `text-foreground`", () => {
    hojaDetalle();
    const activa = screen
      .getAllByRole("tab")
      .find((t) => t.getAttribute("aria-selected") === "true");

    expect(activa, "ninguna pestaña quedó seleccionada").toBeDefined();
    // Ni `border-primary` ni `text-primary`: `--primary` mide 3.18 sobre blanco, que cumple el
    // 3:1 de componente pero no el 4.5:1 de texto, y acá el mismo condicional pinta las dos cosas.
    expect(activa!.className).toContain("border-foreground");
    expect(activa!.className).toContain("text-foreground");
    expect(activa!.className).not.toContain("border-primary");
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * Feature 223 — LA CANDIDATURA Y LA FORMA DEL DOM QUE LA REGLA DE ELECCIÓN SUPONE
 * ══════════════════════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ QUÉ **NO** DEMUESTRA ESTO, y hay que leerlo antes que su verde.
 * **No demuestra que la factura salga bien en papel.** No hay motor de impresión: nadie compone
 * la cascada, nadie resuelve `@media print` y nadie pagina. Lo que se hace aquí es leer los
 * SELECTORES REALES de `app/globals.css` y preguntarle al DOM a qué elementos enganchan. Eso
 * responde «la regla elige lo que dijimos que eligiera **en este DOM**», no «el papel sale bien».
 * Dónde caen los cortes, cómo fragmenta un flex y qué hace cada navegador con `@page` siguen sin
 * verificarse, y su única comprobación es manual y fuera del gate (`progress/impl_223.md`).
 *
 * ── POR QUÉ SE PUEDE HACER, SI EL DISEÑO DECÍA QUE NO
 * `design.md §6.6` daba por hecho que jsdom «no resuelve `:has()`». **Sí lo resuelve** (medido,
 * jsdom 29.1.1), así que la verificación de la regla de elección deja de ser un censo de texto y
 * pasa a ser una evaluación contra el árbol renderizado. Y no es un lujo: es lo que cazó que el
 * CSS literal del diseño **ocultaba el propio diálogo**, cosa que los catorce censos del CSS
 * daban por buena porque la regla estaba escrita.
 *
 * Los selectores NO se copian aquí: se LEEN del archivo con el parser compartido. Copiarlos haría
 * que estos casos siguieran verdes describiendo un CSS que ya no existe — el modo de fallo que la
 * 222 encontró en una guardia que describía clases retiradas.
 */

/** Los selectores de la regla que OCULTA, leídos del CSS real. */
function selectoresQueOcultan(): string[] {
  const regla = reglasDeArchivo("app/globals.css").find(
    (r) =>
      r.declaraciones["display"] === "none" &&
      r.ancestros.some((a) => /@media\s+print\b/.test(a)),
  );
  if (!regla) {
    throw new Error(
      "no hay ninguna regla `display: none` dentro de `@media print` en app/globals.css. O el " +
        "bloque del flujo desapareció, o este test dejó de saber dónde mirar: fallar es lo " +
        "correcto, no evaluar una lista vacía y dar verde.",
    );
  }
  return regla.selectores;
}

/** Los selectores de la regla que neutraliza la CADENA de ancestros. */
function selectoresDeLaCadena(): string[] {
  const regla = reglasDeArchivo("app/globals.css").find(
    (r) =>
      r.declaraciones["display"] === "block" &&
      r.ancestros.some((a) => /@media\s+print\b/.test(a)),
  );
  if (!regla) throw new Error("no se encontró la regla de la cadena en app/globals.css");
  return regla.selectores;
}

/** Los elementos que la regla de ocultamiento engancha, evaluada sobre el DOM montado. */
function conjuntoOculto(): Set<Element> {
  const fuera = new Set<Element>();
  for (const selector of selectoresQueOcultan()) {
    for (const el of document.querySelectorAll(selector)) fuera.add(el);
  }
  return fuera;
}

/** ¿`el` no llega al papel? Lo es si él o cualquiera de sus ancestros está oculto. */
function noLlegaAlPapel(el: Element, ocultos: Set<Element>): boolean {
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    if (ocultos.has(n)) return true;
  }
  return false;
}

/** La cadena de ancestros de `el` hasta el `<body>`, sin incluirlo. */
function ancestrosHastaBody(el: Element): Element[] {
  const salida: Element[] = [];
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) salida.push(n);
  return salida;
}

describe("Feature 223 — CANDIDATA: una hoja sólo es documento cuando está completa (R5)", () => {
  it("la hoja del DETALLE lleva la marca siempre: es un comprobante completo por sí mismo", () => {
    expect(hojaDetalle().className).toContain("hoja-imprimible");
  });

  it("la hoja COMPACTA plegada NO la lleva: le faltan métodos, ajustes y fechas", () => {
    expect(
      hojaResumen().className,
      "una hoja compacta plegada no es un comprobante: su desglose entero se monta con " +
        "`{open ? … : null}`. Marcarla sería emitir al papel un documento incompleto.",
    ).not.toContain("hoja-imprimible");
  });

  it("y la lleva en cuanto se despliega: desplegar ES el acto de designarla", () => {
    const hoja = hojaResumen();
    expect(hoja.className).not.toContain("hoja-imprimible");

    fireEvent.click(
      screen.getByRole("button", { name: "Ver detalles del cierre de Ana Pérez" }),
    );

    expect(
      screen.getByRole("region", { name: "Comprobante del cierre de Ana Pérez" }).className,
      "tras desplegar, la hoja compacta es un documento completo y tiene que poder imprimirse",
    ).toContain("hoja-imprimible");
  });
});

describe("Feature 223 — ELEGIDA: la forma del DOM y a qué engancha la regla (R6, R9, R11)", () => {
  /**
   * El escenario de la ruta del admin, entero: el detalle abierto en su `Modal` y, DETRÁS, la
   * lista con una hoja compacta desplegada. Es el caso que motivó toda la D5.
   */
  function Escenario({ conModal }: Readonly<{ conModal: boolean }>) {
    return (
      <div>
        <nav aria-label="Barra lateral">lateral</nav>
        <CierreFacturaResumen cierre={RESUMEN} />
        {conModal ? (
          <Modal open onOpenChange={() => {}} title="Detalle del cierre">
            {/* Los MISMOS contenedores que monta `CierresAdminModule`: es la ruta con más
                recortadores de las dos, así que es la que hay que medir. */}
            <div className="flex max-h-[70vh] flex-col gap-6 overflow-y-auto pr-1">
              <CierreFacturaDetalle
                cierre={CABECERA}
                grupos={{ ...emptyGrupos(), entregada: [gestion()] }}
              />
              <section aria-label="Decisión del cierre">
                <button type="button">Aprobar</button>
              </section>
            </div>
          </Modal>
        ) : null}
      </div>
    );
  }

  /**
   * El desplegado de la compacta se hace ANTES de montar el modal, y no es una comodidad:
   * `@base-ui/react` marca `aria-hidden` todo lo que queda fuera del diálogo, así que con el
   * modal abierto Testing Library ya no encuentra ese botón por su nombre accesible. Ese
   * `aria-hidden` es, además, la técnica que `design.md §3.5-b` descartó como anclaje —es un
   * detalle interno de la librería, y el día que cambie degradaría en silencio—; `role="dialog"`
   * es contrato público y es el que se usa.
   */
  function escenarioConModal(): {
    detalle: HTMLElement;
    compacta: HTMLElement;
    popup: HTMLElement;
  } {
    const { rerender } = render(<Escenario conModal={false} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Ver detalles del cierre de Ana Pérez" }),
    );
    rerender(<Escenario conModal />);

    const compacta = screen.getByRole("region", {
      name: "Comprobante del cierre de Ana Pérez",
      hidden: true,
    });
    expect(
      compacta.className,
      "la compacta de detrás tiene que quedar DESPLEGADA: plegada no es candidata y el escenario " +
        "dejaría de comprobar que el nivel 1 la poda",
    ).toContain("hoja-imprimible");

    return {
      detalle: screen.getByRole("region", {
        name: "Comprobante detallado del cierre de Ana Pérez",
      }),
      compacta,
      popup: screen.getByRole("dialog"),
    };
  }

  /** R9 (a) — el anclaje del nivel 1 es contrato público, y deja de ser un supuesto. */
  it("el popup del `Modal` expone `role=\"dialog\"`, que es de lo que depende el nivel 1", () => {
    const { popup } = escenarioConModal();
    expect(popup.getAttribute("role")).toBe("dialog");
    expect(popup.getAttribute("aria-modal")).toBe("true");
  });

  /** R9 (b) — un diálogo, una hoja. Con dos, el nivel 1 no sabría cuál elegir. */
  it("dentro del diálogo hay EXACTAMENTE una candidata, y fuera hay al menos una", () => {
    const { popup, detalle, compacta } = escenarioConModal();

    const dentro = popup.querySelectorAll(".hoja-imprimible");
    expect(
      dentro,
      "un diálogo que monte DOS hojas rompe la regla de elección: el nivel 1 elegiría en " +
        "silencio, y mejor rojo que una elección invisible.",
    ).toHaveLength(1);
    expect(dentro[0]).toBe(detalle);

    const fuera = [...document.querySelectorAll(".hoja-imprimible")].filter(
      (h) => !popup.contains(h),
    );
    expect(fuera.length, "el escenario no montó ninguna candidata fuera del diálogo").toBe(1);
    expect(fuera[0]).toBe(compacta);

    // (d) — la de dentro NO es descendiente de la de fuera: si lo fuera, «podar lo de fuera»
    // se llevaría por delante la elegida.
    expect(compacta.contains(detalle)).toBe(false);
  });

  /**
   * EL CASO. La regla de elección, evaluada contra el DOM real: gana la del diálogo y las de
   * detrás no llegan al papel. Es la objeción que sostenía la exclusión de la v1 del diseño,
   * contestada con una evaluación en vez de con un razonamiento.
   */
  it("con el detalle abierto: sale la hoja del diálogo y NO la compacta de detrás (R6 nivel 1)", () => {
    const { detalle, compacta, popup } = escenarioConModal();
    const ocultos = conjuntoOculto();

    expect(
      noLlegaAlPapel(detalle, ocultos),
      "la hoja ELEGIDA quedó oculta: el papel saldría EN BLANCO. Es el fallo más caro de esta " +
        "ficha y ninguna pantalla lo mostraría.",
    ).toBe(false);
    expect(
      noLlegaAlPapel(popup, ocultos),
      "el propio diálogo quedó oculto, y con él la hoja que contiene. Es exactamente lo que " +
        "hacía el selector de `design.md §3.4` antes de corregirlo.",
    ).toBe(false);
    expect(
      noLlegaAlPapel(compacta, ocultos),
      "la hoja compacta de detrás del modal SÍ llegaría al papel: imprimir el detalle emitiría " +
        "además las N compactas de la lista. Es la objeción que el nivel 1 viene a cerrar.",
    ).toBe(true);
  });

  /** R1 / R4 — y con ellas, los controles: backdrop, botonera del modal, decisión del cierre. */
  it("tampoco llegan al papel los controles: backdrop, botones del modal y la botonera", () => {
    escenarioConModal();
    const ocultos = conjuntoOculto();

    for (const [que, el] of [
      ["el fondo oscuro del diálogo", screen.getByTestId("modal-backdrop")],
      ["la barra lateral del portal", screen.getByRole("navigation", { name: "Barra lateral", hidden: true })],
      ["la botonera de decisión del cierre", screen.getByRole("region", { name: "Decisión del cierre" })],
      ["el botón de cerrar del modal", screen.getByRole("button", { name: "Confirmar" })],
    ] as const) {
      expect(noLlegaAlPapel(el, ocultos), `${que} llegaría al papel`).toBe(true);
    }
  });

  /**
   * R10 / R11 — la CADENA. Todos los ancestros de la hoja elegida, sean cuales sean, quedan
   * cubiertos por la misma regla. No hay una línea para la ruta del admin y otra para la del
   * mensajero: la regla recorre ancestros y no nombra ninguno. Aquí se comprueba sobre la ruta
   * que MÁS contenedores tiene, que es la del admin.
   */
  it("la regla de la cadena cubre TODOS los ancestros de la hoja elegida, sin nombrar ninguno", () => {
    const { detalle } = escenarioConModal();
    const cadena = selectoresDeLaCadena();
    const cubiertos = new Set<Element>();
    for (const selector of cadena) {
      for (const el of document.querySelectorAll(selector)) cubiertos.add(el);
    }

    const ancestros = ancestrosHastaBody(detalle);
    expect(
      ancestros.length,
      "el escenario no montó una cadena de ancestros: sin contenedores intermedios este caso no " +
        "comprueba nada",
    ).toBeGreaterThan(3);

    for (const ancestro of ancestros) {
      expect(
        cubiertos.has(ancestro),
        `el ancestro <${ancestro.tagName.toLowerCase()} class="${ancestro.className}"> NO queda ` +
          "cubierto por la regla de la cadena: si recorta, le limita el alto o lo saca del flujo, " +
          "la hoja vuelve a salir recortada",
      ).toBe(true);
    }
    expect(cubiertos.has(document.body), "el `<body>` tiene que estar en la cadena").toBe(true);
  });
});

/**
 * Feature 223 — R11: LA MISMA REGLA, LAS DOS RUTAS, SIN UNA LÍNEA PARA CADA UNA.
 *
 * `H1` del spec: la ruta del admin y la del mensajero **no montan los mismos contenedores** —la
 * del admin mete un `div.max-h-[70vh].overflow-y-auto` que la del mensajero no tiene—, y esa es
 * la razón por la que R11 exige que la regla recorra la cadena en vez de nombrar contenedores.
 *
 * Hasta la revisión, en el gate sólo se ejercía la del admin: la del mensajero vivía únicamente en
 * la comprobación con motor real, cuyo harness se borró a propósito. Un requisito que dice «vale
 * igual en las dos» verificado sobre una sola dice más de lo que nadie comprueba, así que la
 * segunda ruta entra aquí.
 */
describe("Feature 223 — la ruta del MENSAJERO, con la misma regla (R11)", () => {
  /** Los contenedores de `CierreDiaModule`: el mismo componente, en otro modal y sin el `max-h`. */
  function escenarioMensajero(): { hoja: HTMLElement; nota: HTMLElement } {
    render(
      <div>
        <nav aria-label="Barra lateral">lateral</nav>
        <Modal open onOpenChange={() => {}} title="Detalle de tu cierre">
          <div className="flex flex-col gap-4">
            <CierreFacturaDetalle
              audiencia="mensajero"
              cierre={CABECERA}
              grupos={{ ...emptyGrupos(), entregada: [gestion()] }}
            />
            <p role="note">Solo lectura</p>
          </div>
        </Modal>
      </div>,
    );
    return {
      hoja: screen.getByRole("region", {
        name: "Comprobante detallado del cierre de Ana Pérez",
      }),
      nota: screen.getByRole("note"),
    };
  }

  it("las DOS rutas montan el MISMO componente: por eso una sola regla puede cubrirlas", () => {
    const mensajero = codigoSinComentarios(
      path.join("app", "(app)", "cierre-dia", "_components", "CierreDiaModule.tsx"),
    );
    const admin = codigoSinComentarios(
      path.join("app", "(app)", "cierres-admin", "_components", "CierresAdminModule.tsx"),
    );
    for (const [ruta, codigo] of [
      ["CierreDiaModule", mensajero],
      ["CierresAdminModule", admin],
    ] as const) {
      expect(
        codigo,
        `${ruta} dejó de montar \`CierreFacturaDetalle\`. Si una de las dos rutas pasa a montar ` +
          "otra hoja, R11 deja de significar lo que dice y hay que releer la regla entera.",
      ).toMatch(/<CierreFacturaDetalle\b/);
    }
    // Y la asimetría que obliga a que la regla sea genérica: el `max-h` es SÓLO del admin.
    expect(admin).toContain("max-h-[70vh]");
    expect(
      mensajero,
      "la ruta del mensajero estrenó el `max-h-[70vh]` del admin: si las dos cadenas se " +
        "igualaran, este caso dejaría de comprobar lo que R11 pide y habría que buscar otra " +
        "asimetría real",
    ).not.toContain("max-h-[70vh]");
  });

  it("en la ruta del mensajero: sale la hoja, y su nota de pantalla NO", () => {
    const { hoja, nota } = escenarioMensajero();
    const ocultos = conjuntoOculto();

    expect(
      noLlegaAlPapel(hoja, ocultos),
      "la hoja del mensajero no llegaría al papel con la misma regla que sí funciona en el admin",
    ).toBe(false);
    expect(
      noLlegaAlPapel(nota, ocultos),
      "la nota «solo lectura» es texto de la pantalla, no del comprobante: está declarada entre " +
        "las piezas que dejan de imprimirse",
    ).toBe(true);
    expect(
      noLlegaAlPapel(screen.getByRole("navigation", { name: "Barra lateral", hidden: true }), ocultos),
    ).toBe(true);
  });

  it("y la cadena la cubre entera, aunque tenga un contenedor MENOS que la del admin", () => {
    const { hoja } = escenarioMensajero();
    const cubiertos = new Set<Element>();
    for (const selector of selectoresDeLaCadena()) {
      for (const el of document.querySelectorAll(selector)) cubiertos.add(el);
    }
    const ancestros = ancestrosHastaBody(hoja);
    expect(ancestros.length).toBeGreaterThan(3);
    for (const ancestro of ancestros) {
      expect(
        cubiertos.has(ancestro),
        `el ancestro <${ancestro.tagName.toLowerCase()} class="${ancestro.className}"> de la ruta ` +
          "del mensajero NO queda cubierto: la regla habría dejado de ser genérica y necesitaría " +
          "una línea propia por ruta, que es exactamente lo que R11 prohíbe",
      ).toBe(true);
    }
  });
});

describe("Feature 223 — sin diálogo: todas las candidatas, y con CERO no pasa nada (R7, R8)", () => {
  it("dos compactas desplegadas: las DOS llegan al papel, y lo demás no (R6 nivel 2, R8)", () => {
    render(
      <div>
        <nav aria-label="Barra lateral">lateral</nav>
        <div>
          <CierreFacturaResumen cierre={RESUMEN} />
          <CierreFacturaResumen
            cierre={{ ...RESUMEN, cierreId: "c2000002", mensajeroNombre: "Beto Ruiz" }}
          />
        </div>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ver detalles del cierre de Ana Pérez" }));
    fireEvent.click(screen.getByRole("button", { name: "Ver detalles del cierre de Beto Ruiz" }));

    const ocultos = conjuntoOculto();
    for (const nombre of ["Ana Pérez", "Beto Ruiz"]) {
      expect(
        noLlegaAlPapel(screen.getByRole("region", { name: `Comprobante del cierre de ${nombre}` }), ocultos),
        `la hoja de ${nombre} no llegaría al papel: desplegar es un acto deliberado y desplegar ` +
          "dos es pedir dos comprobantes",
      ).toBe(false);
    }
    expect(
      noLlegaAlPapel(screen.getByRole("navigation", { name: "Barra lateral" }), ocultos),
      "la barra lateral llegaría al papel",
    ).toBe(true);
  });

  /**
   * EL CASO QUE EVITA LA PÁGINA EN BLANCO (R2, R7). Sin ninguna candidata en el documento, la
   * regla no engancha NADA: esa página imprime exactamente como imprimía antes de esta feature.
   * Si un solo selector perdiera su guarda `:has()`, aquí saldría un conjunto no vacío — y en
   * producción, cualquier página del portal se imprimiría vacía sin que ninguna pantalla lo
   * mostrara.
   */
  it("sin ninguna candidata, la regla NO engancha nada: la página imprime como antes (R2, R7)", () => {
    render(
      <div>
        <nav aria-label="Barra lateral">lateral</nav>
        <CierreFacturaResumen cierre={RESUMEN} />
        <p>una página cualquiera del portal</p>
      </div>,
    );

    expect(document.querySelectorAll(".hoja-imprimible")).toHaveLength(0);
    expect(
      [...conjuntoOculto()].map((e) => e.tagName + "." + e.className),
      "la regla de ocultamiento engancha elementos en una página SIN ninguna hoja. En papel esa " +
        "página saldría en blanco, y no hay pantalla que lo muestre: es el fallo más caro de la " +
        "ficha y la guarda `:has()` de cada selector es lo único que lo impide.",
    ).toEqual([]);
  });
});
