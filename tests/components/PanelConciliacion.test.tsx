// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

import { PanelConciliacion } from "@/app/(app)/analitica/_components/financiero/PanelConciliacion";
import { formatearValor } from "@/components/private/analytics/formato";
import type { ResultadoFinancieroConciliacion } from "@/lib/types/analitica-financiera";

// Feature 132 (T4.3) — R19.
//
// El panel de conciliacion es el unico que puede descubrir que el dinero
// declarado en los cierres no coincide con el libro. Las dos pruebas de abajo
// cubren los dos unicos desenlaces que importan: cuando cuadra no hay alarma que
// distraiga, y cuando NO cuadra la alarma es visible, dice CUANTOS cierres estan
// descuadrados y —esto es lo que se rompe con mas facilidad— el resto del panel
// se sigue viendo. Un panel que se apagara al detectar el descuadre escondera
// justo la tabla con la que se investiga.
//
// Se afirma sobre texto y nombres accesibles, nunca sobre nodos pintados.

const ETIQUETA = "Conciliación de cierres";

/**
 * El importe formateado, con los espacios normalizados como los normaliza
 * testing-library.
 *
 * `Intl` separa los miles con un espacio DURO (U+00A0) y el matcher de
 * testing-library colapsa ese espacio a uno normal antes de comparar: sin esta
 * normalizacion el esperado y el DOM difieren en un byte invisible.
 */
function cifra(valor: number, unidad: "moneda" | "conteo"): string {
  return formatearValor(valor, unidad).replace(/\s+/g, " ");
}

function datosDe(cuadra: boolean, cierresDescuadrados: readonly string[]): ResultadoFinancieroConciliacion {
  return {
    tipo: "conciliacion",
    metricaId: "conciliacion_cierres",
    etiqueta: ETIQUETA,
    unidad: "moneda",
    rango: { desdeFecha: "2026-07-05", hastaFecha: "2026-08-03" },
    esAcumulado: false,
    conciliacion: {
      porEstado: [
        {
          nivel: "cierre_dia",
          estado: "aprobado",
          cantidad: 7,
          totales: {
            efectivo: "1000.00",
            simpe: "250.50",
            transferencia: "0.00",
            general: "1250.50",
          },
          fechadoPor: "resuelto_at",
        },
        {
          nivel: "cierre_bodega",
          estado: "solicitado",
          cantidad: 2,
          totales: {
            efectivo: "300.00",
            simpe: "0.00",
            transferencia: "10.00",
            general: "310.00",
          },
          fechadoPor: "solicitado_at",
        },
      ],
      cuadre: {
        cuadra,
        totalSnapshot: "1560.50",
        totalLedger: "1500.00",
        diferencia: "60.50",
        cierresDescuadrados,
      },
    },
  };
}

afterEach(cleanup);

describe("Feature 132 (R19) — cuadre correcto: conteos y cuadre, sin alarma", () => {
  it("muestra los conteos por nivel y estado POR SEPARADO y las tres cifras del cuadre", () => {
    render(<PanelConciliacion datos={datosDe(true, [])} />);

    const seccion = screen.getByRole("region", { name: ETIQUETA });

    // Los dos niveles viven en filas distintas: fundirlos contaria el mismo
    // dinero dos veces.
    expect(within(seccion).getByText(/cierre_dia · aprobado/)).toBeInTheDocument();
    expect(within(seccion).getByText(/cierre_bodega · solicitado/)).toBeInTheDocument();

    // El conteo se formatea como CONTEO, no como importe.
    expect(within(seccion).getByText(cifra(7, "conteo"))).toBeInTheDocument();

    expect(within(seccion).getByText(cifra(1560.5, "moneda"))).toBeInTheDocument();
    expect(within(seccion).getByText(cifra(1500, "moneda"))).toBeInTheDocument();
    expect(within(seccion).getAllByText(cifra(60.5, "moneda")).length).toBeGreaterThan(0);
  });

  it("muestra los importes por metodo de CADA fila, no solo sus conteos", () => {
    // R19 pide los conteos por (nivel, estado) CON SUS TOTALES. Sin esto, un panel
    // que perdiera los cuatro importes de cada fila —y dejara solo la cantidad—
    // seguiria en verde: el cuadre de abajo sale de otra parte del DTO.
    render(<PanelConciliacion datos={datosDe(true, [])} />);

    const seccion = screen.getByRole("region", { name: ETIQUETA });

    // Fila `cierre_dia · aprobado`: efectivo 1000,00 · SINPE 250,50 · general 1250,50.
    expect(within(seccion).getByText(cifra(1000, "moneda"))).toBeInTheDocument();
    expect(within(seccion).getByText(cifra(250.5, "moneda"))).toBeInTheDocument();
    expect(within(seccion).getByText(cifra(1250.5, "moneda"))).toBeInTheDocument();

    // Fila `cierre_bodega · solicitado`: efectivo 300,00 · transferencia 10,00 ·
    // general 310,00. Las DOS filas quedan cubiertas: perder los importes de una
    // sola tambien tiene que poner esto rojo.
    expect(within(seccion).getByText(cifra(300, "moneda"))).toBeInTheDocument();
    expect(within(seccion).getByText(cifra(10, "moneda"))).toBeInTheDocument();
    expect(within(seccion).getByText(cifra(310, "moneda"))).toBeInTheDocument();
  });

  it("no emite ninguna alerta cuando el cuadre es correcto", () => {
    render(<PanelConciliacion datos={datosDe(true, [])} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("pinta el rango tal cual lo devuelve el DTO (R22)", () => {
    render(<PanelConciliacion datos={datosDe(true, [])} />);
    const seccion = screen.getByRole("region", { name: ETIQUETA });
    expect(within(seccion).getByText(/2026-07-05/)).toBeInTheDocument();
    expect(within(seccion).getByText(/2026-08-03/)).toBeInTheDocument();
  });
});

describe("Feature 132 (R19) — cuadre roto: alerta visible con la cantidad, y el panel sigue en pie", () => {
  const DESCUADRADOS = ["cierre-a", "cierre-b", "cierre-c"];

  it("muestra un aviso con role=alert que incluye CUANTOS cierres estan descuadrados", () => {
    render(<PanelConciliacion datos={datosDe(false, DESCUADRADOS)} />);

    const aviso = screen.getByRole("alert");
    expect(aviso).toBeInTheDocument();
    // La cantidad, no la lista de ids: con la cantidad se prioriza; sin ella el
    // aviso solo dice "algo pasa".
    expect(aviso.textContent ?? "").toContain(String(DESCUADRADOS.length));
  });

  it("el resto de la tabla y el cuadre se renderizan IGUALMENTE (el panel nunca se apaga)", () => {
    render(<PanelConciliacion datos={datosDe(false, DESCUADRADOS)} />);

    const seccion = screen.getByRole("region", { name: ETIQUETA });
    expect(within(seccion).getByText(/cierre_dia · aprobado/)).toBeInTheDocument();
    expect(within(seccion).getByText(/cierre_bodega · solicitado/)).toBeInTheDocument();
    expect(within(seccion).getByText(cifra(1560.5, "moneda"))).toBeInTheDocument();
    expect(within(seccion).getByText(cifra(1500, "moneda"))).toBeInTheDocument();
  });

  it("no lanza con la lista de descuadrados vacia pero `cuadra` en falso", () => {
    // Caso incomodo y real: el servicio puede declarar que no cuadra sin poder
    // señalar cierres concretos. El panel tiene que decirlo, no reventar.
    expect(() => render(<PanelConciliacion datos={datosDe(false, [])} />)).not.toThrow();
    expect(screen.getByRole("alert").textContent ?? "").toContain(
      cifra(0, "conteo"),
    );
  });
});
