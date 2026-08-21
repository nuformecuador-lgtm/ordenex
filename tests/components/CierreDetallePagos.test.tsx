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
    desdeAyudaTienda: false, // feature 237 (D6/R41): la registro el mensajero, no la tienda
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

/** Encabezados de la tabla de una región, en el orden en que se pintan. */
function encabezados(region: HTMLElement): string[] {
  return within(within(region).getByRole("table"))
    .getAllByRole("columnheader")
    .map((th) => th.textContent?.trim() ?? "");
}

/**
 * Texto de la celda de UN MEDIO DE PAGO en la primera fila, localizada por el ÍNDICE de su
 * cabecera y no por posición fija: así el caso sigue diciendo la verdad si mañana se añade
 * una columna antes, y un `getByText("—")` no puede confundirse con el "—" de otra celda.
 */
function celdaMedio(region: HTMLElement, encabezado: string): string {
  const tabla = within(region).getByRole("table");
  const indice = encabezados(region).indexOf(encabezado);
  expect(indice, `no existe la columna «${encabezado}»`).toBeGreaterThanOrEqual(0);
  const filas = within(tabla).getAllByRole("row");
  const celdas = within(filas[1]).getAllByRole("cell");
  return celdas[indice].textContent?.trim() ?? "";
}

/** Las tres celdas de medios de pago de la primera fila, en el orden de las columnas. */
function celdasDeMedios(region: HTMLElement): [string, string, string] {
  return [
    celdaMedio(region, "Efectivo"),
    celdaMedio(region, "SINPE"),
    celdaMedio(region, "Transferencia"),
  ];
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

describe("Detalle del cierre — UNA COLUMNA POR MEDIO DE PAGO (cierre-detalle-shared)", () => {
  // Sustituye a los casos de la feature 213 que probaban la celda única «Método» con el
  // desglose concatenado. Lo que se afirma sigue siendo lo mismo (R23/R25): lo pintado sale
  // del DESGLOSE y no del campo escalar, y los nombres salen de `METODO_LABEL`. Lo que cambia
  // es dónde: el medio es ahora el ENCABEZADO de la columna y la celda lleva solo su monto.
  //
  // El comprobante de factura NO cambió: sigue con la celda concatenada y sus casos, abajo.

  it("ya no existe la columna «Método»: los medios son tres columnas", () => {
    const region = renderTabla(
      gruposConEntrega({ pagos: [{ metodo: "SINPE", monto: "8000.00" }] }),
    );
    const cabeceras = encabezados(region);

    expect(cabeceras).not.toContain("Método");
    // En el orden de declaración del enum, que es el del DTO (R24). Es lo que permite leer la
    // tabla en columna: la posición no depende de por dónde cobró cada gestión.
    expect(cabeceras.filter((c) => ["Efectivo", "SINPE", "Transferencia"].includes(c))).toEqual([
      "Efectivo",
      "SINPE",
      "Transferencia",
    ]);
  });

  it("una sola línea pone su monto en SU columna y deja las otras dos en «—»", () => {
    const region = renderTabla(
      gruposConEntrega({ pagos: [{ metodo: "SINPE", monto: "8000.00" }] }),
    );

    // El monto va en la moneda de configuración, como el resto del dinero de la tabla.
    expect(celdasDeMedios(region)).toEqual(["—", "₡8.000", "—"]);
  });

  it("dos líneas se ven las DOS, cada una en su columna", () => {
    const region = renderTabla(
      gruposConEntrega({
        pagos: [
          { metodo: "efectivo", monto: "5000.00" },
          { metodo: "transferencia", monto: "3000.00" },
        ],
      }),
    );

    expect(celdasDeMedios(region)).toEqual(["₡5.000", "—", "₡3.000"]);
  });

  it("R22/R23: sin líneas las tres celdas son «—», aunque la gestión traiga el escalar", () => {
    // El escalar SIGUE VIVO en el DTO (R32) y aquí vale `SINPE`: si alguna celda lo leyera,
    // este caso pintaría un monto bajo SINPE. Es la contraprueba de que la presentación
    // deriva del DESGLOSE (R23).
    const region = renderTabla(gruposConEntrega({ metodoPago: "SINPE", pagos: [] }));

    expect(celdasDeMedios(region)).toEqual(["—", "—", "—"]);
  });

  it("R24: el orden del DTO no altera en qué columna cae cada monto", () => {
    // Con la celda concatenada el orden del DTO ERA el orden pintado. Con una columna por
    // medio ya no puede serlo: aquí el DTO llega al revés del enum y cada monto sigue cayendo
    // donde le toca. Eso es lo que hace sumable la columna.
    const region = renderTabla(
      gruposConEntrega({
        pagos: [
          { metodo: "transferencia", monto: "3000.00" },
          { metodo: "SINPE", monto: "2000.00" },
          { metodo: "efectivo", monto: "3000.00" },
        ],
      }),
    );

    expect(celdasDeMedios(region)).toEqual(["₡3.000", "₡2.000", "₡3.000"]);
  });

  it("R25: los encabezados SON las etiquetas de METODO_LABEL, no un literal tecleado", () => {
    // Antes esto se probaba MUTANDO el mapa en caliente, porque la etiqueta se leía en cada
    // render. Ahora las columnas se declaran una vez al cargar el módulo, así que mutar el
    // mapa no cambiaría lo pintado: lo que se afirma es la igualdad con el mapa, que es la
    // propiedad que R25 protege (una sola fuente para pantalla y archivo).
    const region = renderTabla(
      gruposConEntrega({ pagos: [{ metodo: "SINPE", monto: "8000.00" }] }),
    );
    const cabeceras = encabezados(region);

    for (const etiqueta of Object.values(METODO_LABEL)) {
      expect(cabeceras).toContain(etiqueta);
    }
  });
});

describe("Feature 213 — desglose de pago en el comprobante (cierre-factura)", () => {
  it("R20: una sola línea deja la fila «Recibido» EXACTAMENTE como antes: monto · etiqueta", async () => {
    const texto = await recibidoEnFactura(
      gruposConEntrega({ pagos: [{ metodo: "SINPE", monto: "8000.00" }] }),
    );

    expect(texto).toBe("₡8.000 · SINPE");
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

    expect(texto).toBe("₡8.000 · Efectivo ₡5.000 + Transferencia ₡3.000");
  });

  it("R22/R23: sin líneas la fila muestra SOLO el monto —lo mismo que hoy—, aunque la gestión traiga el escalar", async () => {
    // El marcador de ausencia de ESTA fila es no decir nada del método (`DatoFila` no pinta
    // lo que no aplica): sin líneas no aparece separador ni texto nuevo (R22). Y con
    // `metodoPago` puesto seguiría igual, que es lo que prueba R23.
    const texto = await recibidoEnFactura(
      gruposConEntrega({ metodoPago: "SINPE", pagos: [] }),
    );

    expect(texto).toBe("₡8.000");
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
      "₡8.000 · Transferencia ₡3.000 + SINPE ₡2.000 + Efectivo ₡3.000",
    );
  });

  it("R25: la etiqueta sale de METODO_LABEL (mutarla cambia lo pintado)", async () => {
    const original = METODO_LABEL.SINPE;
    try {
      METODO_LABEL.SINPE = "SINPE-MUTADO";
      const texto = await recibidoEnFactura(
        gruposConEntrega({ pagos: [{ metodo: "SINPE", monto: "8000.00" }] }),
      );
      expect(texto).toBe("₡8.000 · SINPE-MUTADO");
    } finally {
      METODO_LABEL.SINPE = original;
    }
  });
});
