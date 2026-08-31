// @vitest-environment jsdom
//
// 💰 FICHA 338 (2026-08-31) — EL PANEL DE LA DERECHA DICE QUÉ SE COBRÓ, NO QUÉ PRECIOS EXISTEN.
//
// EL DEFECTO, reportado por el humano mirando la pantalla: el bloque se titulaba «Tarifa
// aplicada» y listaba los NUEVE valores de la tarifa congelada. Ver nueve importes bajo ese
// título hace pensar que se cobraron los nueve, y en una REPROGRAMADA —que no cobra nada— no
// había ni una frase que lo dijera: la única señal era la AUSENCIA del «← se aplicó», o sea que
// había que deducir el cero de que no hubiera ninguna marca.
//
// EL DISEÑO, elegido por el humano y textual: «se pueden mostrar todos los posibles cobros pero
// marcar precio unicamente en los que si se esta aplicando cobro, los demas en cero». O sea:
// se listan TODOS los conceptos posibles, cada fila lleva el IMPORTE REALMENTE COBRADO, cero
// donde no aplica, y la columna PASA A SER SUMABLE y termina en su total. Con eso el «← se
// aplicó» sobra y se retira, y el título pasa a «Cobros de esta gestión» — que no es cosmética:
// con «Valor flete» en ₡0 mientras la tarifa vale ₡2.800, «Tarifa aplicada» sería FALSO.
//
// LAS DOS INVARIANTES QUE ESTE ARCHIVO FIJA, y son las que hay que leer si algo de aquí enrojece:
//   1. **Una gestión que no cobra nada pinta TODAS sus filas en cero** (y su total en cero).
//   2. **La columna suma exactamente lo que dice el total**, leído del DOM y sumado con
//      `Prisma.Decimal`. Si una fila pintara el PRECIO de la tarifa en vez del importe cobrado
//      —que es justo lo que hacía antes— la suma dejaría de cuadrar.
//
// ⚠️ NO SE MUEVE UNA MONEDA AQUÍ NI EN EL COMPONENTE. Los importes los deriva
// `derivarIngresoOrden` en el servidor y el total es `ingresoOrdenex.total` del DTO (sumado con
// `Prisma.Decimal` en `CierresAdminRepository.toIngresoOrdenex`). El `Prisma.Decimal` de este
// archivo es del TEST: sirve para comprobar que lo que se pinta cuadra, no para pintarlo.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { Prisma } from "@prisma/client";

import {
  DesgloseIngresoOrdenex,
  COBROS_TITULO,
  COBROS_NOTA,
  COBROS_TOTAL_LABEL,
  DESGLOSE_TITULO,
  VALOR_FLETE_LABEL,
  VALOR_FLETE_GAM_LABEL,
  FLETE_RECHAZO_LABEL,
  FLETE_RECHAZO_GAM_LABEL,
  IVA_FLETE_LABEL,
  IVA_FLETE_RECHAZO_LABEL,
  COMISION_COD_LABEL,
  IVA_COMISION_LABEL,
  TARIFA_ESPECIAL_LABEL,
  TARIFA_ESPECIAL_DEV_LABEL,
} from "@/app/(app)/cierres-admin/_components/cierre-detalle-shared";
import { money, monedaConfig } from "@/lib/config/moneda";
import type {
  CierreDetalleGestion,
  IngresoOrdenexDTO,
  TarifaSnapshotDTO,
} from "@/lib/interfaces/services/ICierreDiaService";

// --- La tarifa congelada. Los precios son A PROPÓSITO distintos de los importes cobrados de
// abajo: si una fila volviera a pintar el PRECIO en vez del COBRO, se ve en el número.
function tarifa(over: Partial<TarifaSnapshotDTO> = {}): TarifaSnapshotDTO {
  return {
    tarifaId: "8f1c0b2e-0000-4000-8000-000000000338",
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

/** Base NEUTRA: ningún concepto derivado, total en cero. Es una REPROGRAMADA. */
function ingreso(over: Partial<IngresoOrdenexDTO> = {}): IngresoOrdenexDTO {
  return {
    montoCobrar: "10000.00",
    cobraComision: true,
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

/** Lo que `derivarIngresoOrden` produce para una ENTREGA en GAM con comisión (800+104+500+65). */
const ENTREGADA_GAM = {
  esCentral: true,
  flete: "800.00",
  ivaFlete: "104.00",
  comisionCod: "500.00",
  ivaComisionCod: "65.00",
  fleteConIva: "904.00",
  comisionConIva: "565.00",
  total: "1469.00",
} satisfies Partial<IngresoOrdenexDTO>;

/** Lo que produce un RECHAZO en GAM: flete por rechazo + su IVA, y NADA más (400+52). */
const RECHAZADA_GAM = {
  esCentral: true,
  fleteDevolucion: "400.00",
  ivaFleteDevolucion: "52.00",
  fleteDevolucionConIva: "452.00",
  total: "452.00",
} satisfies Partial<IngresoOrdenexDTO>;

function gestion(
  ing: IngresoOrdenexDTO,
  resultado: CierreDetalleGestion["resultado"],
): CierreDetalleGestion {
  return {
    gestionId: "g1",
    ordenId: "o1",
    resultado,
    numGuia: 1001,
    numRemision: "REM-338",
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

/** El panel de cobros, por su nombre accesible. Los dos paneles repiten rótulos a propósito
 *  (el desglose de la izquierda explica la fórmula del mismo concepto), así que TODO lo que
 *  este archivo afirma se busca DENTRO de la región, nunca en la pantalla entera. */
function panelCobros(): HTMLElement {
  return screen.getByRole("region", { name: COBROS_TITULO });
}

/**
 * Las filas del panel leídas de su ESTRUCTURA, no de una lista escrita aquí: cada `DesgloseFila`
 * es un `<div>` hijo directo de la sección, y el último de ellos envuelve el total. Se lee así
 * —y no por nombre— para que una fila AÑADIDA de más también se vea: media ficha 337 fue
 * justamente una marca de más que un `getByText` a secas dejó pasar en verde.
 */
function filasDeCobros(): { label: string; valor: string }[] {
  const hijos = Array.from(panelCobros().children).filter((el) => el.tagName === "DIV");
  return hijos.map((el) => {
    const fila = el.classList.contains("border-t") ? (el.firstElementChild as Element) : el;
    return {
      label: (fila.firstElementChild?.textContent ?? "").trim(),
      valor: (fila.lastElementChild?.textContent ?? "").trim(),
    };
  });
}

/**
 * Deshace `money()` para poder SUMAR en el test lo que la pantalla enseña. Es la operación
 * inversa exacta de `formatMontoString` para un importe con forma de decimal: quita el símbolo
 * y los separadores de miles, los dos leídos de `monedaConfig` y no escritos a mano (hardcodear
 * el «₡» aquí sería el hardcode de contexto que `docs/architecture.md` prohíbe).
 */
function deMoney(texto: string): Prisma.Decimal {
  const limpio = texto.split(monedaConfig.simbolo).join("").split(monedaConfig.separadorMiles).join("");
  return new Prisma.Decimal(limpio.trim());
}

/** El valor pintado en la fila de ese rótulo, dentro del panel de cobros. */
function cobroDe(label: string): string {
  const encontrada = filasDeCobros().find((f) => f.label === label);
  expect(encontrada, `no hay fila «${label}» en el panel de cobros`).toBeDefined();
  return encontrada!.valor;
}

const CERO = money("0.00");

afterEach(cleanup);

describe("💰 338 — «Cobros de esta gestión»: importes, ceros y un total que cuadra", () => {
  it("el panel se titula «Cobros de esta gestión» y ya NO «Tarifa aplicada»", () => {
    render(<DesgloseIngresoOrdenex g={gestion(ingreso(ENTREGADA_GAM), "entregada")} />);

    expect(screen.getByRole("heading", { name: COBROS_TITULO })).toBeInTheDocument();
    // El título viejo NO puede sobrevivir en ningún rincón: con las filas en importe sería una
    // etiqueta FALSA («Valor flete ₡0» no es la tarifa, que vale ₡1.000).
    expect(screen.queryByText("Tarifa aplicada")).toBeNull();
  });

  it("la nota explica qué significa un cero, en vez de dejar que se deduzca de una ausencia", () => {
    render(<DesgloseIngresoOrdenex g={gestion(ingreso(), "reprogramada")} />);
    // La frase menciona el cero con el MISMO formateador que pinta las celdas.
    expect(within(panelCobros()).getByText(COBROS_NOTA)).toBeInTheDocument();
    expect(COBROS_NOTA).toContain(CERO);
  });

  // ⭑ EL CASO DEL REPORTE. Antes: nueve precios y ninguna marca; había que deducir el cero.
  it("una REPROGRAMADA pinta TODAS las filas en cero, incluido el total", () => {
    render(<DesgloseIngresoOrdenex g={gestion(ingreso(), "reprogramada")} />);

    const filas = filasDeCobros();
    // El conjunto exacto, no «contiene»: una fila con importe de más es el defecto que la ficha
    // cierra, y un `getByText(CERO)` a secas la habría dejado pasar igual de verde.
    expect(filas.map((f) => f.valor)).toEqual(filas.map(() => CERO));
    expect(cobroDe(COBROS_TOTAL_LABEL)).toBe(CERO);
  });

  it("una DEVUELTA (301: ya no cobra retorno) también pinta todo en cero", () => {
    render(<DesgloseIngresoOrdenex g={gestion(ingreso(), "devuelta")} />);
    expect(filasDeCobros().map((f) => f.valor)).toEqual(filasDeCobros().map(() => CERO));
  });

  it("una ENTREGA en GAM cobra en «Valor flete GAM» y deja en cero las tres de rechazo", () => {
    render(<DesgloseIngresoOrdenex g={gestion(ingreso(ENTREGADA_GAM), "entregada")} />);

    expect(cobroDe(VALOR_FLETE_GAM_LABEL)).toBe(money("800.00"));
    expect(cobroDe(VALOR_FLETE_LABEL)).toBe(CERO); // la columna que NO le tocaba
    expect(cobroDe(IVA_FLETE_LABEL)).toBe(money("104.00"));
    expect(cobroDe(COMISION_COD_LABEL)).toBe(money("500.00"));
    expect(cobroDe(IVA_COMISION_LABEL)).toBe(money("65.00"));
    // Lo que esta gestión NO cobró, dicho con un número y no con un hueco.
    expect(cobroDe(FLETE_RECHAZO_LABEL)).toBe(CERO);
    expect(cobroDe(FLETE_RECHAZO_GAM_LABEL)).toBe(CERO);
    expect(cobroDe(IVA_FLETE_RECHAZO_LABEL)).toBe(CERO);
    expect(cobroDe(COBROS_TOTAL_LABEL)).toBe(money("1469.00"));
  });

  it("un RECHAZO en GAM cobra en «Flete por rechazo GAM» y deja en cero las de entrega", () => {
    render(<DesgloseIngresoOrdenex g={gestion(ingreso(RECHAZADA_GAM), "rechazada")} />);

    expect(cobroDe(FLETE_RECHAZO_GAM_LABEL)).toBe(money("400.00"));
    expect(cobroDe(FLETE_RECHAZO_LABEL)).toBe(CERO);
    expect(cobroDe(IVA_FLETE_RECHAZO_LABEL)).toBe(money("52.00"));
    expect(cobroDe(VALOR_FLETE_LABEL)).toBe(CERO);
    expect(cobroDe(VALOR_FLETE_GAM_LABEL)).toBe(CERO);
    expect(cobroDe(IVA_FLETE_LABEL)).toBe(CERO);
    // Un rechazo no recauda contra entrega: no hay comisión que cobrar.
    expect(cobroDe(COMISION_COD_LABEL)).toBe(CERO);
    expect(cobroDe(IVA_COMISION_LABEL)).toBe(CERO);
    expect(cobroDe(COBROS_TOTAL_LABEL)).toBe(money("452.00"));
  });

  it("con pacto especial, el importe va a la fila del pacto y las columnas normales quedan en cero", () => {
    render(
      <DesgloseIngresoOrdenex
        g={gestion(
          ingreso({
            ...ENTREGADA_GAM,
            esZonaEspecial: true,
            fleteOrigen: "especial",
            flete: "2500.00",
            ivaFlete: "325.00",
            fleteConIva: "2825.00",
            total: "3390.00",
            tarifa: tarifa({ tarifaEspecial: "2500.00", tarifaEspecialDevuelta: "1200.00" }),
          }),
          "entregada",
        )}
      />,
    );

    expect(cobroDe(TARIFA_ESPECIAL_LABEL)).toBe(money("2500.00"));
    expect(cobroDe(VALOR_FLETE_GAM_LABEL)).toBe(CERO);
    expect(cobroDe(VALOR_FLETE_LABEL)).toBe(CERO);
    // El pacto de RETORNO existe en la tarifa, pero esta gestión es una entrega: no se cobró.
    expect(cobroDe(TARIFA_ESPECIAL_DEV_LABEL)).toBe(CERO);
  });

  it("sin pacto congelado esas dos filas no se pintan (y no se pierde ni un colón)", () => {
    render(<DesgloseIngresoOrdenex g={gestion(ingreso(ENTREGADA_GAM), "entregada")} />);
    const labels = filasDeCobros().map((f) => f.label);
    expect(labels).not.toContain(TARIFA_ESPECIAL_LABEL);
    expect(labels).not.toContain(TARIFA_ESPECIAL_DEV_LABEL);
  });

  // ⭑ LA INVARIANTE DE LA COLUMNA SUMABLE, que es lo que hace que un cero no se pueda leer como
  // un cobro: lo que se ve, sumado, ES el total. Se lee del DOM y se suma con `Prisma.Decimal`.
  describe("la columna suma exactamente lo que dice el total", () => {
    const CASOS = [
      { nombre: "entrega en GAM con comisión", ing: ingreso(ENTREGADA_GAM), r: "entregada" },
      {
        nombre: "entrega fuera de GAM",
        ing: ingreso({
          ...ENTREGADA_GAM,
          esCentral: false,
          flete: "1000.00",
          ivaFlete: "130.00",
          fleteConIva: "1130.00",
          total: "1695.00",
        }),
        r: "entregada",
      },
      { nombre: "rechazo en GAM", ing: ingreso(RECHAZADA_GAM), r: "rechazada" },
      {
        nombre: "rechazo fuera de GAM",
        ing: ingreso({
          esCentral: false,
          fleteDevolucion: "500.00",
          ivaFleteDevolucion: "65.00",
          fleteDevolucionConIva: "565.00",
          total: "565.00",
        }),
        r: "rechazada",
      },
      { nombre: "reprogramada (no cobra nada)", ing: ingreso(), r: "reprogramada" },
      {
        nombre: "entrega con pacto especial",
        ing: ingreso({
          ...ENTREGADA_GAM,
          esZonaEspecial: true,
          fleteOrigen: "especial",
          flete: "2500.00",
          ivaFlete: "325.00",
          fleteConIva: "2825.00",
          total: "3390.00",
          tarifa: tarifa({ tarifaEspecial: "2500.00", tarifaEspecialDevuelta: "1200.00" }),
        }),
        r: "entregada",
      },
    ] as const;

    for (const caso of CASOS) {
      it(caso.nombre, () => {
        render(<DesgloseIngresoOrdenex g={gestion(caso.ing, caso.r)} />);

        const filas = filasDeCobros();
        const total = filas[filas.length - 1];
        expect(total.label).toBe(COBROS_TOTAL_LABEL); // el total cierra la columna, no otra cosa

        const suma = filas
          .slice(0, -1)
          .reduce((acc, f) => acc.plus(deMoney(f.valor)), new Prisma.Decimal(0));
        expect(suma.toFixed(2), `filas: ${filas.map((f) => `${f.label}=${f.valor}`).join(" | ")}`)
          .toBe(deMoney(total.valor).toFixed(2));
        // Y el total pintado es el del DTO, no uno recalculado en el navegador.
        expect(total.valor).toBe(money(caso.ing.total));
      });
    }
  });

  it("en la columna de cobros no queda ni un porcentaje ni ningún «se aplicó»", () => {
    render(<DesgloseIngresoOrdenex g={gestion(ingreso(ENTREGADA_GAM), "entregada")} />);

    // «Comisión COD 5,00 %» e «IVA flete 13,00 %» eran dos filas NO sumables en medio de una
    // columna de dinero: la misma ambigüedad, entrando por otra puerta.
    expect(panelCobros().textContent).not.toContain("%");
    // El «← se aplicó» sobra desde que el importe lo dice: no queda en ninguna parte.
    expect(screen.queryByText(/se aplicó/)).toBeNull();

    // Y el porcentaje NO se pierde: sigue explicando el cobro real en el desglose de al lado.
    const desglose = screen.getByRole("region", { name: DESGLOSE_TITULO });
    expect(desglose.textContent).toContain("13.00 %");
  });
});
