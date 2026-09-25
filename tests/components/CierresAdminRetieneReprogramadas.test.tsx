// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

import {
  CierreFacturaDetalle,
  CierreFacturaResumen,
  type CierreFacturaCabecera,
} from "@/app/(app)/cierres-admin/_components/cierre-factura";
import { CierresAdminHistoricoLista } from "@/app/(app)/cierres-admin/_components/CierresAdminHistoricoLista";
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
import type { CierreGrupos } from "@/lib/interfaces/services/ICierreDiaService";

// El histórico importa la lectura de su descarga; se dobla para no arrastrar sesión ni DB.
vi.mock("@/lib/actions/cierres-admin", () => ({
  listarHistoricoCierresAdminCompleto: vi.fn(),
}));

/**
 * FICHA 462 (T3.3, S3, R27/R28/R29/R30) — LA MARCA «Retiene N paquetes reprogramados para hoy» EN LAS
 * TRES SUPERFICIES DE `/cierres-admin`: la COLA y el HISTÓRICO (las dos usan el comprobante compacto
 * `CierreFacturaResumen`) y la cabecera del DETALLE (`CierreFacturaDetalle`).
 *
 * ── LO QUE PROTEGE
 *  - con `reprogramadasRetenidasHoy: N > 0` la marca se lee, literal a mano;
 *  - con 0 o sin el campo NO aparece nada de esta ficha (R27) — un `aprobado` llega siempre con 0 (R28);
 *  - un `rechazado` la lleva (R28/R41): el histórico es el único sitio donde se ve;
 *  - las acciones y las otras marcas de la fila siguen ahí (R29): esta marca no desplaza nada.
 *
 * ── LO QUE NO AFIRMA
 * De dónde sale el número. Aquí llega por props; que sea UNA lectura por página y el mismo conteo que
 * la campana lo afirma `tests/unit/services/cierres-admin-retenidas.test.ts` (R26/R51).
 *
 * Literales A MANO (memoria «asercion contra su propia fuente»).
 */

const TOTALES = { efectivo: "1000.00", simpe: "0.00", transferencia: "0.00", general: "1000.00" };

function resumen(over: Partial<CierreAdminResumen> & { cierreId: string }): CierreAdminResumen {
  return {
    mensajeroId: `m-${over.cierreId}`,
    mensajeroNombre: "Ana Pérez",
    estado: "solicitado",
    destinoTipo: "bodega_central",
    destinoZonaId: "z1",
    destinoZonaNombre: "GAM",
    totales: TOTALES,
    totalPagoMensajero: "1200.00",
    totalIngresoBodegaRechazos: "0.00",
    pendientePagoMensajero: null,
    solicitadoAt: "2026-09-24T10:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
    ...over,
  };
}

const MARCA_2 = "Retiene 2 paquetes reprogramados para hoy";
const MARCA_1 = "Retiene 1 paquete reprogramado para hoy";

afterEach(cleanup);

describe("462/R27 — la COLA: el comprobante compacto con la cifra del servidor", () => {
  it("con `reprogramadasRetenidasHoy: 2` pinta la marca y conserva la botonera (R29)", () => {
    render(
      <CierreFacturaResumen
        cierre={resumen({ cierreId: "c1", reprogramadasRetenidasHoy: 2 })}
        acciones={<button type="button">Aprobar</button>}
      />,
    );
    const hoja = screen.getByRole("region", { name: "Comprobante del cierre de Ana Pérez" });
    expect(within(hoja).getByText(MARCA_2)).toBeInTheDocument();
    expect(within(hoja).getByRole("button", { name: "Aprobar" })).toBeInTheDocument();
    // El estado sigue siendo el badge de la hoja: la marca no lo sustituye.
    expect(within(hoja).getByText("Solicitado")).toBeInTheDocument();
  });

  it("con 1 el singular; con 0 o SIN el campo no aparece nada de esta ficha (R27)", () => {
    render(<CierreFacturaResumen cierre={resumen({ cierreId: "c1", reprogramadasRetenidasHoy: 1 })} />);
    expect(screen.getByText(MARCA_1)).toBeInTheDocument();
    cleanup();

    render(<CierreFacturaResumen cierre={resumen({ cierreId: "c2", reprogramadasRetenidasHoy: 0 })} />);
    expect(screen.queryByText(/Retiene/)).toBeNull();
    cleanup();

    render(<CierreFacturaResumen cierre={resumen({ cierreId: "c3" })} />);
    expect(screen.queryByText(/Retiene/)).toBeNull();
  });

  it("un `vencido` que retiene la lleva igual que un `solicitado` (R28/R42)", () => {
    render(
      <CierreFacturaResumen
        cierre={resumen({ cierreId: "c4", estado: "vencido", reprogramadasRetenidasHoy: 2 })}
      />,
    );
    expect(screen.getByText(MARCA_2)).toBeInTheDocument();
    expect(screen.getByText("Vencido")).toBeInTheDocument();
  });
});

describe("462/R27/R28 — el HISTÓRICO: el `rechazado` que retiene la lleva; el `aprobado` no", () => {
  function renderHistorico(items: CierreAdminResumen[]) {
    render(
      <CierresAdminHistoricoLista
        pagina={{ items, total: items.length, pageSize: 10 }}
        page={1}
        isLoading={false}
        hayError={false}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
        onAbrir={() => {}}
      />,
    );
  }

  it("⭑ exactamente UNA marca: en el `rechazado` con 2, ninguna en el `aprobado` con 0; «Ver» y «Bloqueante» intactos", () => {
    renderHistorico([
      resumen({
        cierreId: "r1",
        mensajeroNombre: "Beto Mora",
        estado: "rechazado",
        motivoRechazo: "Falta efectivo",
        resueltoAt: "2026-09-24T12:00:00.000Z",
        reprogramadasRetenidasHoy: 2,
      }),
      resumen({
        cierreId: "a1",
        mensajeroNombre: "Carla Vega",
        estado: "aprobado",
        pendientePagoMensajero: "0.00",
        resueltoAt: "2026-09-24T12:00:00.000Z",
        reprogramadasRetenidasHoy: 0,
      }),
    ]);

    expect(screen.getAllByText(/Retiene \d+ paquetes? reprogramados? para hoy/)).toHaveLength(1);
    const rechazado = screen.getByRole("region", { name: "Comprobante del cierre de Beto Mora" });
    expect(within(rechazado).getByText(MARCA_2)).toBeInTheDocument();
    // R29: las marcas y acciones previas de la fila siguen ahí.
    expect(within(rechazado).getByText("Bloqueante hasta re-solicitud")).toBeInTheDocument();
    expect(within(rechazado).getByRole("button", { name: "Ver el cierre resuelto de Beto Mora" })).toBeInTheDocument();

    const aprobado = screen.getByRole("region", { name: "Comprobante del cierre de Carla Vega" });
    expect(within(aprobado).queryByText(/Retiene/)).toBeNull();
    expect(within(aprobado).getByRole("button", { name: "Ver el cierre resuelto de Carla Vega" })).toBeInTheDocument();
  });

  it("sin el campo en ninguna fila, el histórico no pinta nada de esta ficha", () => {
    renderHistorico([
      resumen({ cierreId: "a2", estado: "aprobado", pendientePagoMensajero: "0.00", resueltoAt: "2026-09-24T12:00:00.000Z" }),
    ]);
    expect(screen.queryByText(/Retiene/)).toBeNull();
  });
});

describe("462/R27 — la cabecera del DETALLE, junto al estado", () => {
  const CABECERA: CierreFacturaCabecera = {
    cierreId: "c1000001",
    estado: "solicitado",
    destinoTipo: "bodega_central",
    destinoZonaNombre: "GAM",
    mensajeroNombre: "Ana Pérez",
    totales: TOTALES,
    totalPagoMensajero: "1200.00",
    totalIngresoBodegaRechazos: "0.00",
    solicitadoAt: "2026-09-24T10:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
  };
  const GRUPOS: CierreGrupos = {
    entregado: [],
    reprogramado: [],
    novedad: [],
    devolucion_a_origen_por_rechazo: [],
    incidente: [],
  };

  it("con la cifra, la marca acompaña al badge de estado en la cabecera", () => {
    render(<CierreFacturaDetalle cierre={{ ...CABECERA, reprogramadasRetenidasHoy: 3 }} grupos={GRUPOS} />);
    const hoja = screen.getByRole("region", { name: "Comprobante detallado del cierre de Ana Pérez" });
    const marca = within(hoja).getByText("Retiene 3 paquetes reprogramados para hoy");
    const estado = within(hoja).getByText("Solicitado");
    // Mismo contenedor: la marca vive junto al estado, no en otra sección de la hoja.
    expect(marca.parentElement).toBe(estado.parentElement);
  });

  it("sin la cifra (la cabecera del mensajero no la trae) no pinta nada de esta ficha", () => {
    render(<CierreFacturaDetalle cierre={CABECERA} grupos={GRUPOS} />);
    expect(screen.queryByText(/Retiene/)).toBeNull();
  });
});
