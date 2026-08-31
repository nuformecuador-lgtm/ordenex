// @vitest-environment jsdom
//
// ⏳ FICHA 337 (2026-08-31) — EL "← se aplicó" DEL PANEL DE TARIFA CONGELADA MIRA EL RESULTADO.
//
// EL DEFECTO, reportado por el humano mirando la pantalla: en el desglose de una orden ENTREGADA
// de zona GAM se encendían A LA VEZ «Valor flete GAM» y «Flete devuelto GAM». Es imposible por
// construcción —o el paquete se entregó o se devolvió— y a quien audita un cierre le dice que se
// cobraron dos precios que no se cobraron.
//
// LA CAUSA, y explica por qué ningún test lo cazó: cada fila decidía su marca con `esCentral` (la
// zona) y el pacto especial, y NUNCA con el resultado de la gestión. La zona elige la COLUMNA de
// la tarifa; el resultado elige QUÉ CONCEPTO se cobra. Faltaba la segunda mitad.
//
// LA FUENTE DE VERDAD ya estaba en el DTO y no hizo falta aritmética nueva: `derivarIngresoOrden`
// deja `flete` en `null` salvo en `entregada` y `fleteDevolucion` en `null` salvo en `rechazada`.
// `null` significa «este concepto no existe acá», que es exactamente la pregunta.
//
// LA INVARIANTE QUE ESTE ARCHIVO FIJA, y es la que hay que leer si algo de aquí se pone rojo:
// **como mucho UNA de las filas de la tarifa congelada lleva la marca, y en las gestiones que
// cobran 0,00 no la lleva NINGUNA.** No mueve dinero (el importe lo deriva el server), pero es la
// única pista visible de qué precio se aplicó.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

import {
  DesgloseIngresoOrdenex,
  APLICADA_HINT,
  TARIFA_NOTA,
  TARIFA_ESPECIAL_LABEL,
  TARIFA_ESPECIAL_DEV_LABEL,
} from "@/app/(app)/cierres-admin/_components/cierre-detalle-shared";
import type {
  CierreDetalleGestion,
  IngresoOrdenexDTO,
  TarifaSnapshotDTO,
} from "@/lib/interfaces/services/ICierreDiaService";

const TARIFA_ID = "8f1c0b2e-0000-4000-8000-000000000042";

function tarifa(over: Partial<TarifaSnapshotDTO> = {}): TarifaSnapshotDTO {
  return {
    tarifaId: TARIFA_ID,
    valorFlete: "1000.00",
    valorFleteGam: "800.00",
    valorFleteDevuelto: "500.00",
    valorFleteDevueltoGam: "400.00",
    comisionCod: "5.00",
    ivaFlete: "13.00",
    ivaComisionCod: "13.00",
    fulfillment: null,
    tarifaEspecial: null,
    tarifaEspecialDevuelta: null,
    ...over,
  };
}

/** Base NEUTRA: sin conceptos derivados. Cada caso enciende SOLO el que su resultado cobra. */
function ingreso(over: Partial<IngresoOrdenexDTO> = {}): IngresoOrdenexDTO {
  return {
    montoCobrar: "10000.00",
    cobraComision: false,
    esCentral: false,
    esZonaEspecial: false,
    fleteOrigen: "normal",
    fleteDevolucionOrigen: "normal",
    flete: null,
    ivaFlete: null,
    fleteDevolucion: null,
    ivaFleteDevolucion: null,
    comisionCod: null,
    ivaComisionCod: null,
    fleteConIva: null,
    fleteDevolucionConIva: null,
    comisionConIva: null,
    total: "0.00",
    tarifa: tarifa(),
    ...over,
  };
}

/** Lo que `derivarIngresoOrden` produce para una ENTREGA (flete + IVA, sin devolución). */
const ENTREGADA = { flete: "800.00", ivaFlete: "104.00", fleteConIva: "904.00", total: "904.00" };
/** Lo que produce un RECHAZO (flete de devolución + IVA, sin flete de entrega). */
const RECHAZADA = {
  fleteDevolucion: "400.00",
  ivaFleteDevolucion: "52.00",
  fleteDevolucionConIva: "452.00",
  total: "452.00",
};

function gestion(ing: IngresoOrdenexDTO, resultado: CierreDetalleGestion["resultado"]) {
  return {
    gestionId: "g1",
    ordenId: "o1",
    resultado,
    numGuia: 1001,
    numRemision: "REM-001",
    destinatario: "Beto Ruiz",
    direccion: "Calle 1",
    zonaNombre: "Zona 2",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    producto: "Caja",
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
    desdeAyudaTienda: false,
    causaIncidente: null,
    indemnizacion: null,
    ingresoOrdenex: ing,
  } satisfies CierreDetalleGestion;
}

/** La fila del panel de tarifa congelada cuyo `label` es exactamente `label`. */
function fila(label: string): HTMLElement {
  return screen.getByText(label).closest("div") as HTMLElement;
}

function marcada(label: string): boolean {
  return within(fila(label)).queryByText(APLICADA_HINT) !== null;
}

/** Las CUATRO filas de la tabla de precios, que es donde estaba la doble marca. */
const FILAS_TARIFA = [
  "Valor flete",
  "Valor flete GAM",
  "Flete devuelto",
  "Flete devuelto GAM",
] as const;

afterEach(cleanup);

describe("💰 337 — la tarifa congelada marca la fila que DE VERDAD se aplicó", () => {
  // ⭑ EL CASO DEL REPORTE, literal: entrega en GAM. Antes salían DOS marcas.
  it("una ENTREGA en GAM marca «Valor flete GAM» y NINGUNA fila de devolución", () => {
    render(
      <DesgloseIngresoOrdenex g={gestion(ingreso({ esCentral: true, ...ENTREGADA }), "entregada")} />,
    );

    // El conjunto exacto de filas marcadas, no «contiene»: la mitad del defecto era una marca DE
    // MÁS, y un `getByText(...)` a secas la habría dejado pasar igual de verde.
    expect(FILAS_TARIFA.filter(marcada)).toEqual(["Valor flete GAM"]);
    expect(screen.getAllByText(APLICADA_HINT)).toHaveLength(1);
  });

  it("una ENTREGA fuera de GAM marca «Valor flete», y tampoco ninguna de devolución", () => {
    render(
      <DesgloseIngresoOrdenex
        g={gestion(ingreso({ esCentral: false, ...ENTREGADA, flete: "1000.00" }), "entregada")}
      />,
    );
    expect(FILAS_TARIFA.filter(marcada)).toEqual(["Valor flete"]);
  });

  // El espejo: un rechazo cobra la devolución y NADA de la entrega.
  it("un RECHAZO en GAM marca «Flete devuelto GAM» y NINGUNA fila de entrega", () => {
    render(
      <DesgloseIngresoOrdenex g={gestion(ingreso({ esCentral: true, ...RECHAZADA }), "rechazada")} />,
    );
    expect(FILAS_TARIFA.filter(marcada)).toEqual(["Flete devuelto GAM"]);
  });

  it("un RECHAZO fuera de GAM marca «Flete devuelto»", () => {
    render(
      <DesgloseIngresoOrdenex
        g={gestion(
          ingreso({ esCentral: false, ...RECHAZADA, fleteDevolucion: "500.00" }),
          "rechazada",
        )}
      />,
    );
    expect(FILAS_TARIFA.filter(marcada)).toEqual(["Flete devuelto"]);
  });

  // ⭑ LA MITAD QUE PEDÍA EL REQUISITO Y QUE ES FÁCIL OLVIDAR: cuando el resultado NO genera
  // cobro, NINGUNA fila se marca. Una reprogramada cobra 0,00 y decir «se aplicó» sobre cualquier
  // precio sería afirmar un cobro inexistente.
  it("una REPROGRAMADA (cobra 0,00) no marca NINGUNA fila", () => {
    render(
      <DesgloseIngresoOrdenex g={gestion(ingreso({ esCentral: true }), "reprogramada")} />,
    );
    expect(FILAS_TARIFA.filter(marcada)).toEqual([]);
    expect(screen.queryByText(APLICADA_HINT)).toBeNull();
  });

  // Desde la ficha 301 una `devuelta` tampoco emite ningún concepto. Mismo trato, y se afirma
  // aparte porque son dos decisiones de negocio distintas que dan el mismo resultado visual.
  it("una DEVUELTA (301: ya no cobra retorno) tampoco marca NINGUNA fila", () => {
    render(<DesgloseIngresoOrdenex g={gestion(ingreso({ esCentral: false }), "devuelta")} />);
    expect(FILAS_TARIFA.filter(marcada)).toEqual([]);
  });

  // El pacto especial sigue ganando a la columna normal, pero AHORA además tiene que haberse
  // cobrado: sin esto, una reprogramada de distrito especial marcaría el pacto.
  it("con pacto especial y ENTREGA, la marca va al pacto y a ninguna columna normal", () => {
    render(
      <DesgloseIngresoOrdenex
        g={gestion(
          ingreso({
            esCentral: true,
            esZonaEspecial: true,
            fleteOrigen: "especial",
            ...ENTREGADA,
            flete: "2500.00",
            tarifa: tarifa({ tarifaEspecial: "2500.00", tarifaEspecialDevuelta: "1200.00" }),
          }),
          "entregada",
        )}
      />,
    );
    expect(marcada(TARIFA_ESPECIAL_LABEL)).toBe(true);
    expect(marcada(TARIFA_ESPECIAL_DEV_LABEL)).toBe(false); // ⭑ la que se encendía de más
    expect(FILAS_TARIFA.filter(marcada)).toEqual([]);
    expect(screen.getAllByText(APLICADA_HINT)).toHaveLength(1);
  });

  it("con pacto especial y REPROGRAMADA, tampoco se marca el pacto", () => {
    render(
      <DesgloseIngresoOrdenex
        g={gestion(
          ingreso({
            esCentral: true,
            esZonaEspecial: true,
            fleteOrigen: "especial",
            fleteDevolucionOrigen: "especial",
            tarifa: tarifa({ tarifaEspecial: "2500.00", tarifaEspecialDevuelta: "1200.00" }),
          }),
          "reprogramada",
        )}
      />,
    );
    expect(screen.queryByText(APLICADA_HINT)).toBeNull();
  });

  // Un flete legítimo de "0.00" NO es «no se cobró»: la marca lee la PRESENCIA del concepto, no
  // su importe. Si alguien cambiara el `!== null` por una comparación numérica, esto enrojece.
  it("un flete de «0.00» SÍ se marca (0,00 es un cobro, no una ausencia)", () => {
    render(
      <DesgloseIngresoOrdenex
        g={gestion(
          ingreso({
            esCentral: true,
            flete: "0.00",
            ivaFlete: "0.00",
            fleteConIva: "0.00",
            tarifa: tarifa({ valorFleteGam: "0.00" }),
          }),
          "entregada",
        )}
      />,
    );
    expect(FILAS_TARIFA.filter(marcada)).toEqual(["Valor flete GAM"]);
  });

  // --- El segundo defecto de pantalla del mismo reporte -------------------------------------

  it("el panel ya NO imprime el UUID crudo de la tarifa, y conserva la nota que sí se lee", () => {
    render(
      <DesgloseIngresoOrdenex g={gestion(ingreso({ esCentral: true, ...ENTREGADA }), "entregada")} />,
    );
    // A una persona un identificador interno no le dice nada; era ruido junto a la única frase
    // del panel que sí explica qué está viendo.
    expect(screen.queryByText(TARIFA_ID)).toBeNull();
    expect(screen.getByText(TARIFA_NOTA)).toBeInTheDocument();
  });
});
