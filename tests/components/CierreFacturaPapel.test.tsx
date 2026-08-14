// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

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
