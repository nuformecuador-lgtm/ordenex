// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DetalleSecciones } from "@/app/(app)/cierres-admin/_components/cierre-detalle-shared";
import {
  CierreFacturaDetalle,
  type CierreFacturaCabecera,
} from "@/app/(app)/cierres-admin/_components/cierre-factura";
import { METODO_LABEL } from "@/app/(app)/cierres-admin/_components/cierre-labels";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreResultado,
} from "@/lib/interfaces/services/ICierreDiaService";

/**
 * Feature 213 (T9) — la PRESENTACIÓN del desglose de pago en DOS de los tres sitios: la
 * tabla del detalle (`cierre-detalle-shared`, compartida por los cierres de mensajero y los
 * de bodega) y el comprobante tipo factura (`cierre-factura`, que es también el que ve el
 * mensajero al abrir un cierre pasado). El TERCER sitio —la tabla del cierre del día— tiene
 * sus casos gemelos en `CierreDiaModule.test.tsx`, donde ya vive el arnés de ese módulo.
 *
 * Lo que se afirma aquí (R20/R21/R22/R24/R25) es siempre lo mismo visto desde dos sitios:
 * que lo pintado sale del DESGLOSE y no del campo escalar (R23), en el orden del DTO, con
 * las etiquetas de `METODO_LABEL` y la moneda de configuración.
 */

// El botón de descarga de cada sección pide el toast; aquí no se descarga nada, así que se
// mockea igual que en los demás tests de estas tablas en vez de montar el provider entero.
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

function makeGestion(
  over: Partial<CierreDetalleGestion> & {
    gestionId: string;
    resultado: CierreResultado;
  },
): CierreDetalleGestion {
  return {
    ordenId: `o-${over.gestionId}`,
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
    montoRecibido: null,
    metodoPago: null,
    pagos: [],
    motivo: null,
    fechaReprogramacion: null,
    evidenciaUrl: null,
    pagoMensajero: null,
    ingresoBodegaRechazo: null,
    tarifaFaltante: false,
    esRechazoSla: false,
    causaIncidente: null,
    indemnizacion: null,
    ...over,
  };
}

function emptyGrupos(): CierreGrupos {
  return {
    entregada: [],
    reprogramada: [],
    devuelta: [],
    rechazada: [],
    incidente: [],
  };
}

/** Una entrega de 8.000 con el desglose que le pase el caso. */
function gruposConEntrega(over: Partial<CierreDetalleGestion>): CierreGrupos {
  return {
    ...emptyGrupos(),
    entregada: [
      makeGestion({
        gestionId: "g1",
        resultado: "entregada",
        montoRecibido: "8000.00",
        ...over,
      }),
    ],
  };
}

const CABECERA: CierreFacturaCabecera = {
  cierreId: "c1",
  estado: "solicitado",
  destinoTipo: "bodega_central",
  destinoZonaNombre: "GAM",
  totales: {
    efectivo: "5000.00",
    simpe: "0.00",
    transferencia: "3000.00",
    general: "8000.00",
  },
  totalPagoMensajero: "0.00",
  totalIngresoBodegaRechazos: "0.00",
  solicitadoAt: "2026-08-11T10:00:00.000Z",
  resueltoAt: null,
  motivoRechazo: null,
};

/**
 * Texto de la celda «Método» de la primera fila de una tabla, localizada por el ÍNDICE de su
 * cabecera y no por posición fija: así el caso sigue diciendo la verdad si mañana se añade
 * una columna antes, y un `getByText("—")` no puede confundirse con el "—" de otra celda.
 */
function celdaMetodo(region: HTMLElement): string {
  const tabla = within(region).getByRole("table");
  const encabezados = within(tabla)
    .getAllByRole("columnheader")
    .map((th) => th.textContent?.trim() ?? "");
  const indice = encabezados.indexOf("Método");
  expect(indice).toBeGreaterThanOrEqual(0);
  const filas = within(tabla).getAllByRole("row");
  const celdas = within(filas[1]).getAllByRole("cell");
  return celdas[indice].textContent?.trim() ?? "";
}

function renderTabla(grupos: CierreGrupos) {
  render(<DetalleSecciones grupos={grupos} onVerEvidencia={() => {}} />);
  return screen.getByRole("region", { name: "Entregadas" });
}

/** Abre el renglón de la orden en el comprobante y devuelve el texto de la fila «Recibido». */
async function recibidoEnFactura(grupos: CierreGrupos): Promise<string> {
  const user = userEvent.setup();
  render(<CierreFacturaDetalle cierre={CABECERA} grupos={grupos} />);
  await user.click(
    screen.getByRole("button", { name: "Detalle de la orden REM-001 · Ana Pérez" }),
  );
  const rotulo = screen.getByText("Recibido:");
  const fila = rotulo.parentElement as HTMLElement;
  return fila.textContent?.replace("Recibido:", "").trim() ?? "";
}

afterEach(() => {
  cleanup();
});

describe("Feature 213 — desglose de pago en la tabla del detalle (cierre-detalle-shared)", () => {
  it("R20: una sola línea se ve EXACTAMENTE igual que antes: la etiqueta a secas, sin monto", () => {
    const region = renderTabla(
      gruposConEntrega({ pagos: [{ metodo: "SINPE", monto: "8000.00" }] }),
    );

    expect(celdaMetodo(region)).toBe("SINPE");
  });

  it("R21: dos líneas se ven las DOS, cada una con su monto en la moneda de configuración", () => {
    const region = renderTabla(
      gruposConEntrega({
        pagos: [
          { metodo: "efectivo", monto: "5000.00" },
          { metodo: "transferencia", monto: "3000.00" },
        ],
      }),
    );

    expect(celdaMetodo(region)).toBe("Efectivo ₡5.000,00 + Transferencia ₡3.000,00");
  });

  it("R22/R23: sin líneas la celda sigue siendo «—», aunque la gestión traiga el escalar", () => {
    // El escalar SIGUE VIVO en el DTO (R32) y aquí vale `SINPE`: si la celda lo leyera,
    // este caso pintaría «SINPE». Es la contraprueba de que la presentación deriva del
    // DESGLOSE (R23).
    const region = renderTabla(gruposConEntrega({ metodoPago: "SINPE", pagos: [] }));

    expect(celdaMetodo(region)).toBe("—");
  });

  it("R24: se pinta el ORDEN del DTO, no el alfabético", () => {
    // Orden alfabético de las etiquetas: Efectivo, SINPE, Transferencia. El DTO las manda
    // al revés, así que si alguien ordenara la lista el texto saldría distinto.
    const region = renderTabla(
      gruposConEntrega({
        pagos: [
          { metodo: "transferencia", monto: "3000.00" },
          { metodo: "SINPE", monto: "2000.00" },
          { metodo: "efectivo", monto: "3000.00" },
        ],
      }),
    );

    expect(celdaMetodo(region)).toBe(
      "Transferencia ₡3.000,00 + SINPE ₡2.000,00 + Efectivo ₡3.000,00",
    );
  });

  it("R25: la etiqueta sale de METODO_LABEL (mutarla cambia lo pintado)", () => {
    const original = METODO_LABEL.SINPE;
    try {
      METODO_LABEL.SINPE = "SINPE-MUTADO";
      const region = renderTabla(
        gruposConEntrega({ pagos: [{ metodo: "SINPE", monto: "8000.00" }] }),
      );
      expect(celdaMetodo(region)).toBe("SINPE-MUTADO");
    } finally {
      METODO_LABEL.SINPE = original;
    }
  });
});

describe("Feature 213 — desglose de pago en el comprobante (cierre-factura)", () => {
  it("R20: una sola línea deja la fila «Recibido» EXACTAMENTE como antes: monto · etiqueta", async () => {
    const texto = await recibidoEnFactura(
      gruposConEntrega({ pagos: [{ metodo: "SINPE", monto: "8000.00" }] }),
    );

    expect(texto).toBe("₡8.000,00 · SINPE");
  });

  it("R21: dos líneas ponen los DOS métodos con su monto junto a lo recibido", async () => {
    const texto = await recibidoEnFactura(
      gruposConEntrega({
        pagos: [
          { metodo: "efectivo", monto: "5000.00" },
          { metodo: "transferencia", monto: "3000.00" },
        ],
      }),
    );

    expect(texto).toBe("₡8.000,00 · Efectivo ₡5.000,00 + Transferencia ₡3.000,00");
  });

  it("R22/R23: sin líneas la fila muestra SOLO el monto —lo mismo que hoy—, aunque la gestión traiga el escalar", async () => {
    // El marcador de ausencia de ESTA fila es no decir nada del método (`DatoFila` no pinta
    // lo que no aplica): sin líneas no aparece separador ni texto nuevo (R22). Y con
    // `metodoPago` puesto seguiría igual, que es lo que prueba R23.
    const texto = await recibidoEnFactura(
      gruposConEntrega({ metodoPago: "SINPE", pagos: [] }),
    );

    expect(texto).toBe("₡8.000,00");
  });

  it("R24: se pinta el ORDEN del DTO, no el alfabético", async () => {
    const texto = await recibidoEnFactura(
      gruposConEntrega({
        pagos: [
          { metodo: "transferencia", monto: "3000.00" },
          { metodo: "SINPE", monto: "2000.00" },
          { metodo: "efectivo", monto: "3000.00" },
        ],
      }),
    );

    expect(texto).toBe(
      "₡8.000,00 · Transferencia ₡3.000,00 + SINPE ₡2.000,00 + Efectivo ₡3.000,00",
    );
  });

  it("R25: la etiqueta sale de METODO_LABEL (mutarla cambia lo pintado)", async () => {
    const original = METODO_LABEL.SINPE;
    try {
      METODO_LABEL.SINPE = "SINPE-MUTADO";
      const texto = await recibidoEnFactura(
        gruposConEntrega({ pagos: [{ metodo: "SINPE", monto: "8000.00" }] }),
      );
      expect(texto).toBe("₡8.000,00 · SINPE-MUTADO");
    } finally {
      METODO_LABEL.SINPE = original;
    }
  });
});
