// @vitest-environment jsdom
//
// ⏳ FICHA 337 (2026-08-31) — EL PANEL DE COBROS MIRA EL RESULTADO, NO SOLO LA ZONA.
//
// EL DEFECTO, reportado por el humano mirando la pantalla: en el desglose de una orden ENTREGADA
// de zona GAM se encendían A LA VEZ «Valor flete GAM» y «Flete devuelto GAM». Es imposible por
// construcción —o el paquete se entregó o se devolvió— y a quien audita un cierre le dice que se
// cobraron dos precios que no se cobraron.
//
// LA CAUSA, y explica por qué ningún test lo cazó: cada fila decidía con `esCentral` (la zona) y
// el pacto especial, y NUNCA con el resultado de la gestión. La zona elige la COLUMNA de la
// tarifa; el resultado elige QUÉ CONCEPTO se cobra. Faltaba la segunda mitad.
//
// LA FUENTE DE VERDAD ya estaba en el DTO y no hizo falta aritmética nueva: `derivarIngresoOrden`
// deja `flete` en `null` salvo en `entregada` y `fleteDevolucion` en `null` salvo en `rechazada`.
// `null` significa «este concepto no existe acá», que es exactamente la pregunta.
//
// 💰 FICHA 338 (2026-08-31) — ESTE ARCHIVO CAMBIÓ DE IDIOMA, NO DE REQUISITO.
//
// La 337 fijaba la invariante sobre una MARCA («← se aplicó») al lado de un precio de la tarifa
// congelada. La 338 retiró esa marca y el panel dejó de pintar precios: ahora cada fila lleva el
// IMPORTE que la gestión cobró, y cero donde no cobró. La invariante es la MISMA pregunta —¿qué
// concepto se cobró de verdad?— y sale REFORZADA, porque antes se afirmaba sobre un rótulo de
// tres palabras y ahora sobre el dinero. Sigue diciendo:
//
//   **como mucho UNA de las filas de flete lleva importe, y en las gestiones que no cobran nada
//   no lo lleva NINGUNA.**
//
// Money-safe: acá no se calcula nada. El componente elige entre el STRING que mandó el servidor
// y el literal «0.00»; este archivo compara textos ya formateados por `money()`.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

import {
  DesgloseIngresoOrdenex,
  COBROS_TITULO,
  COBROS_NOTA,
  DESGLOSE_TITULO,
  FLETE_LABEL,
  VALOR_FLETE_LABEL,
  VALOR_FLETE_GAM_LABEL,
  FLETE_RECHAZO_LABEL,
  FLETE_RECHAZO_GAM_LABEL,
  TARIFA_ESPECIAL_LABEL,
  TARIFA_ESPECIAL_DEV_LABEL,
} from "@/app/(app)/cierres-admin/_components/cierre-detalle-shared";
import { money } from "@/lib/config/moneda";
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

/** Lo que `derivarIngresoOrden` produce para una ENTREGA (flete + IVA, sin rechazo). */
const ENTREGADA = { flete: "800.00", ivaFlete: "104.00", fleteConIva: "904.00", total: "904.00" };
/** Lo que produce un RECHAZO (flete por rechazo + IVA, sin flete de entrega). */
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

/**
 * La fila del PANEL DE COBROS cuyo rótulo es exactamente `label`. Se busca dentro de la región y
 * no en la pantalla entera porque el desglose de la izquierda repite varios rótulos a propósito:
 * explica la FÓRMULA del mismo concepto que aquí sale como importe.
 */
function fila(label: string): HTMLElement {
  const panel = screen.getByRole("region", { name: COBROS_TITULO });
  return within(panel).getByText(label).closest("div") as HTMLElement;
}

/** El importe pintado en esa fila del panel de cobros. */
function cobro(label: string): string {
  return (fila(label).lastElementChild?.textContent ?? "").trim();
}

const CERO = money("0.00");

/** ¿Esta fila lleva un cobro, o sea algo distinto del cero explícito? */
function cobra(label: string): boolean {
  return cobro(label) !== CERO;
}

/** Las CUATRO filas de flete de la tabla de precios, que es donde estaba la doble marca. */
const FILAS_FLETE = [
  VALOR_FLETE_LABEL,
  VALOR_FLETE_GAM_LABEL,
  FLETE_RECHAZO_LABEL,
  FLETE_RECHAZO_GAM_LABEL,
] as const;

afterEach(cleanup);

describe("💰 337/338 — el panel de cobros carga el importe en la fila que DE VERDAD se cobró", () => {
  // ⭑ EL CASO DEL REPORTE, literal: entrega en GAM. Antes salían DOS marcas.
  it("una ENTREGA en GAM cobra en «Valor flete GAM» y en NINGUNA fila de rechazo", () => {
    render(
      <DesgloseIngresoOrdenex g={gestion(ingreso({ esCentral: true, ...ENTREGADA }), "entregada")} />,
    );

    // El conjunto exacto de filas con importe, no «contiene»: la mitad del defecto era una marca
    // DE MÁS, y un `getByText(...)` a secas la habría dejado pasar igual de verde.
    expect(FILAS_FLETE.filter(cobra)).toEqual([VALOR_FLETE_GAM_LABEL]);
    expect(cobro(VALOR_FLETE_GAM_LABEL)).toBe(money("800.00"));
  });

  it("una ENTREGA fuera de GAM cobra en «Valor flete», y tampoco en ninguna de rechazo", () => {
    render(
      <DesgloseIngresoOrdenex
        g={gestion(ingreso({ esCentral: false, ...ENTREGADA, flete: "1000.00" }), "entregada")}
      />,
    );
    expect(FILAS_FLETE.filter(cobra)).toEqual([VALOR_FLETE_LABEL]);
    expect(cobro(VALOR_FLETE_LABEL)).toBe(money("1000.00"));
  });

  // El espejo: un rechazo cobra el retorno y NADA de la entrega.
  it("un RECHAZO en GAM cobra en «Flete por rechazo GAM» y en NINGUNA fila de entrega", () => {
    render(
      <DesgloseIngresoOrdenex g={gestion(ingreso({ esCentral: true, ...RECHAZADA }), "rechazada")} />,
    );
    expect(FILAS_FLETE.filter(cobra)).toEqual([FLETE_RECHAZO_GAM_LABEL]);
    expect(cobro(FLETE_RECHAZO_GAM_LABEL)).toBe(money("400.00"));
  });

  it("un RECHAZO fuera de GAM cobra en «Flete por rechazo»", () => {
    render(
      <DesgloseIngresoOrdenex
        g={gestion(
          ingreso({ esCentral: false, ...RECHAZADA, fleteDevolucion: "500.00" }),
          "rechazada",
        )}
      />,
    );
    expect(FILAS_FLETE.filter(cobra)).toEqual([FLETE_RECHAZO_LABEL]);
    expect(cobro(FLETE_RECHAZO_LABEL)).toBe(money("500.00"));
  });

  // ⭑ LA MITAD QUE PEDÍA EL REQUISITO Y QUE ES FÁCIL OLVIDAR: cuando el resultado NO genera
  // cobro, ninguna fila lleva importe. Y desde la 338 eso ya no hay que deducirlo de la ausencia
  // de una marca: cada fila lo DICE, con un cero.
  it("una REPROGRAMADA (cobra 0,00) no carga importe en NINGUNA fila", () => {
    render(<DesgloseIngresoOrdenex g={gestion(ingreso({ esCentral: true }), "reprogramada")} />);
    expect(FILAS_FLETE.filter(cobra)).toEqual([]);
    expect(FILAS_FLETE.map(cobro)).toEqual(FILAS_FLETE.map(() => CERO));
  });

  // Desde la ficha 301 una `devuelta` tampoco emite ningún concepto. Mismo trato, y se afirma
  // aparte porque son dos decisiones de negocio distintas que dan el mismo resultado visual.
  it("una DEVUELTA (301: ya no cobra retorno) tampoco carga importe en NINGUNA fila", () => {
    render(<DesgloseIngresoOrdenex g={gestion(ingreso({ esCentral: false }), "devuelta")} />);
    expect(FILAS_FLETE.filter(cobra)).toEqual([]);
  });

  // El pacto especial sigue ganando a la columna normal, pero AHORA además tiene que haberse
  // cobrado: sin esto, una reprogramada de distrito especial cargaría el pacto.
  it("con pacto especial y ENTREGA, el importe va al pacto y a ninguna columna normal", () => {
    render(
      <DesgloseIngresoOrdenex
        g={gestion(
          ingreso({
            esCentral: true,
            esZonaEspecial: true,
            fleteOrigen: "especial",
            ...ENTREGADA,
            flete: "2500.00",
            total: "2604.00",
            tarifa: tarifa({ tarifaEspecial: "2500.00", tarifaEspecialDevuelta: "1200.00" }),
          }),
          "entregada",
        )}
      />,
    );
    expect(cobro(TARIFA_ESPECIAL_LABEL)).toBe(money("2500.00"));
    expect(cobra(TARIFA_ESPECIAL_DEV_LABEL)).toBe(false); // ⭑ la que se encendía de más
    expect(FILAS_FLETE.filter(cobra)).toEqual([]);
  });

  it("con pacto especial y REPROGRAMADA, tampoco se carga el pacto", () => {
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
    expect(cobra(TARIFA_ESPECIAL_LABEL)).toBe(false);
    expect(cobra(TARIFA_ESPECIAL_DEV_LABEL)).toBe(false);
  });

  // Un flete legítimo de "0.00" NO es «no se cobró»: la elección lee la PRESENCIA del concepto,
  // no su importe. En el panel de cobros los dos casos se pintan igual —un cero es un cero—, así
  // que quien conserva la distinción es el DESGLOSE de la izquierda, que sólo pinta la fila
  // cuando el concepto EXISTE. Si alguien cambiara el `!== null` por una comparación numérica,
  // esa fila desaparecería y esto enrojece.
  it("un flete de «0.00» SIGUE siendo un cobro: el desglose lo lista, aunque valga cero", () => {
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
    const desglose = screen.getByRole("region", { name: DESGLOSE_TITULO });
    expect(within(desglose).getByText(FLETE_LABEL)).toBeInTheDocument();
  });

  // --- El segundo defecto de pantalla del mismo reporte -------------------------------------

  it("el panel ya NO imprime el UUID crudo de la tarifa, y conserva la nota que sí se lee", () => {
    render(
      <DesgloseIngresoOrdenex g={gestion(ingreso({ esCentral: true, ...ENTREGADA }), "entregada")} />,
    );
    // A una persona un identificador interno no le dice nada; era ruido junto a la única frase
    // del panel que sí explica qué está viendo.
    expect(screen.queryByText(TARIFA_ID)).toBeNull();
    expect(screen.getByText(COBROS_NOTA)).toBeInTheDocument();
  });
});
