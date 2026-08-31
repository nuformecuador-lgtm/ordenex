// @vitest-environment jsdom
//
// La tarifa especial por distrito, RESALTADA en los cierres. El importe de un flete que salió
// del monto pactado es indistinguible de uno normal —es un número más en la columna—, así que
// sin marca el admin no puede reconciliarlo contra la tabla de precios: el número no está ahí.
//
// Se afirman los TRES estados de `OrigenFlete`, porque los tres significan cosas distintas:
//   - `normal`              -> ninguna marca (es la inmensa mayoría de las filas);
//   - `especial`            -> marca informativa: se cobró el pacto, como se pidió;
//   - `especial_sin_pacto`  -> ADVERTENCIA: el distrito está marcado pero la tarifa congelada
//                              no traía pacto, así que se cobró la tarifa normal. El importe es
//                              idéntico al de una orden corriente y el hueco de configuración
//                              sólo se ve por esta marca.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

import {
  DesgloseIngresoOrdenex,
  ESPECIAL_BADGE_LABEL,
  ESPECIAL_BADGE_NOTA,
  ESPECIAL_SIN_PACTO_BADGE_LABEL,
  ESPECIAL_SIN_PACTO_BADGE_NOTA,
  TARIFA_ESPECIAL_LABEL,
  TARIFA_ESPECIAL_DEV_LABEL,
  APLICADA_HINT,
  columnasPara,
} from "@/app/(app)/cierres-admin/_components/cierre-detalle-shared";
import type {
  CierreDetalleGestion,
  IngresoOrdenexDTO,
  TarifaSnapshotDTO,
} from "@/lib/interfaces/services/ICierreDiaService";

function tarifa(over: Partial<TarifaSnapshotDTO> = {}): TarifaSnapshotDTO {
  return {
    tarifaId: "t-1",
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

function ingreso(over: Partial<IngresoOrdenexDTO> = {}): IngresoOrdenexDTO {
  return {
    montoCobrar: "10000.00",
    cobraComision: true,
    esCentral: false,
    esZonaEspecial: false,
    fleteOrigen: "normal",
    fleteDevolucionOrigen: "normal",
    flete: "1000.00",
    ivaFlete: "130.00",
    fleteDevolucion: null,
    ivaFleteDevolucion: null,
    comisionCod: "500.00",
    ivaComisionCod: "65.00",
    fleteConIva: "1130.00",
    fleteDevolucionConIva: null,
    comisionConIva: "565.00",
    total: "1695.00",
    tarifa: tarifa(),
    ...over,
  };
}

function gestion(ing: IngresoOrdenexDTO): CierreDetalleGestion {
  return {
    gestionId: "g1",
    ordenId: "o1",
    resultado: "entregada",
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
    montoRecibido: "10000.00",
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
  };
}

/** Celda de la columna de flete + IVA de una gestión, tal como la pinta la tabla. */
function celdaFlete(ing: IngresoOrdenexDTO) {
  const columna = columnasPara("entregada", () => {}).find((c) => c.id === "fleteConIva");
  // `render` es opcional y puede ser una clave del DTO: acá tiene que ser la función, porque
  // la marca de origen se pinta dentro de ella.
  if (typeof columna?.render !== "function") {
    throw new Error("la columna fleteConIva no declara un render propio");
  }
  return render(<>{columna.render(gestion(ing))}</>);
}

afterEach(cleanup);

describe("Marca del origen del flete en la tabla del detalle", () => {
  it("una tarifa normal NO lleva marca", () => {
    celdaFlete(ingreso());
    expect(screen.queryByText(ESPECIAL_BADGE_LABEL)).toBeNull();
    expect(screen.queryByText(ESPECIAL_SIN_PACTO_BADGE_LABEL)).toBeNull();
  });

  it("un flete cobrado del pacto especial se resalta, con su nota accesible", () => {
    celdaFlete(
      ingreso({
        esZonaEspecial: true,
        fleteOrigen: "especial",
        tarifa: tarifa({ tarifaEspecial: "2500.00" }),
      }),
    );
    const badge = screen.getByText(ESPECIAL_BADGE_LABEL);
    expect(badge).toHaveAttribute("aria-label", ESPECIAL_BADGE_NOTA);
  });

  it("un distrito especial SIN pacto se advierte aparte: cobró la tarifa normal", () => {
    celdaFlete(ingreso({ esZonaEspecial: true, fleteOrigen: "especial_sin_pacto" }));
    const badge = screen.getByText(ESPECIAL_SIN_PACTO_BADGE_LABEL);
    expect(badge).toHaveAttribute("aria-label", ESPECIAL_SIN_PACTO_BADGE_NOTA);
    // Y NO se confunde con el caso en que sí se cobró el pacto.
    expect(screen.queryByText(ESPECIAL_BADGE_LABEL)).toBeNull();
  });
});

describe("Desglose auditable de una orden con tarifa especial", () => {
  it("el flete dice que salió del pacto, y no de la columna GAM / no GAM", () => {
    render(
      <DesgloseIngresoOrdenex
        g={gestion(
          ingreso({
            esZonaEspecial: true,
            fleteOrigen: "especial",
            flete: "2500.00",
            ivaFlete: "325.00",
            tarifa: tarifa({ tarifaEspecial: "2500.00" }),
          }),
        )}
      />,
    );
    // El hint del flete cita el pacto y su monto, no "tarifa no GAM".
    expect(screen.getByText(/tarifa especial pactada/)).toBeInTheDocument();
    expect(screen.queryByText(/tarifa no GAM: /)).toBeNull();
  });

  it("el pacto se lista en la tarifa congelada y se marca como el aplicado", () => {
    render(
      <DesgloseIngresoOrdenex
        g={gestion(
          ingreso({
            esZonaEspecial: true,
            fleteOrigen: "especial",
            tarifa: tarifa({ tarifaEspecial: "2500.00" }),
          }),
        )}
      />,
    );
    const fila = screen.getByText(TARIFA_ESPECIAL_LABEL).closest("div") as HTMLElement;
    expect(within(fila).getByText(APLICADA_HINT)).toBeInTheDocument();

    // Y "Valor flete" —la columna normal que le habría tocado a esta orden (no GAM)— pierde
    // el suyo: el flete tiene UN origen, y marcar dos dejaría al admin sin saber cuál leer.
    //
    // ⏳ FICHA 337 (2026-08-31): aqui decia ademas «El de "Flete devuelto" sigue encendido y es
    // correcto: esa devolución no es especial». Era FALSO y describia el defecto: esta gestión es
    // una ENTREGA (`fleteDevolucion: null`), asi que ninguna devolución se cobró y esa marca no
    // debería existir. Desde la 337 la fila de devolución esta apagada; lo afirma
    // `CierreTarifaAplicada.test.tsx`, que es donde vive ese requisito.
    const normal = screen.getByText("Valor flete").closest("div") as HTMLElement;
    expect(within(normal).queryByText(APLICADA_HINT)).toBeNull();
  });

  it("sin pacto congelado, esas filas NO se pintan (un '—' se leería como pacto de cero)", () => {
    render(<DesgloseIngresoOrdenex g={gestion(ingreso())} />);
    expect(screen.queryByText(TARIFA_ESPECIAL_LABEL)).toBeNull();
    expect(screen.queryByText(TARIFA_ESPECIAL_DEV_LABEL)).toBeNull();
  });

  it("un distrito especial sin pacto deja la nota del hueco de configuración", () => {
    render(
      <DesgloseIngresoOrdenex
        g={gestion(ingreso({ esZonaEspecial: true, fleteOrigen: "especial_sin_pacto" }))}
      />,
    );
    expect(screen.getByRole("note")).toHaveTextContent(ESPECIAL_SIN_PACTO_BADGE_NOTA);
    // El flete SÍ salió de la columna normal: ese "← se aplicó" sigue encendido.
    // ⏳ FICHA 337: y ahora es EXACTAMENTE UNO. Antes eran dos —la entrega y una devolución que no
    // existia—, y un `> 0` no distinguia una cosa de la otra.
    expect(screen.getAllByText(APLICADA_HINT)).toHaveLength(1);
  });
});
