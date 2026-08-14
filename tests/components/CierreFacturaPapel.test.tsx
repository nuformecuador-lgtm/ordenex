// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
