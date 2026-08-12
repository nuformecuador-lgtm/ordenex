// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { CierreDiaModule } from "@/app/(app)/cierre-dia/_components/CierreDiaModule";
import {
  deshacerGestion,
  listarCierresPasadosPaginado,
  solicitarCierre,
  verCierrePasado,
} from "@/lib/actions/cierre-dia";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreTotales,
  CierrePasadoDTO,
  CierreResultado,
} from "@/lib/interfaces/services/ICierreDiaService";

// Feature 37 (T15) — módulo cliente del "Cierre del día". Se mockea la Server
// Action (solicitarCierre), el toast y el router (refresh) para afirmar la
// composición (agrupación, totales, gate, histórico) y el envío sin DB ni sesión.
vi.mock("@/lib/actions/cierre-dia", () => ({
  solicitarCierre: vi.fn(),
  listarCierreDia: vi.fn(),
  // Feature 67 (T17/T18): la Server Action del deshacer también se mockea (contrato
  // cerrado por el backend: recibe un OBJETO `{ gestionId }`, no un string).
  deshacerGestion: vi.fn(),
  // Pedido humano: detalle de un cierre pasado (se pide bajo demanda al abrir el visor).
  verCierrePasado: vi.fn(),
  // Feature 170 — FASE 2 (T I.2): «Cierres solicitados» llega paginado del servidor.
  listarCierresPasadosPaginado: vi.fn(),
}));

const { successMock, errorMock, refreshMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

const solicitarMock = vi.mocked(solicitarCierre);
const deshacerMock = vi.mocked(deshacerGestion);
const verCierrePasadoMock = vi.mocked(verCierrePasado);

/** Cierre del histórico usado por los casos del visor de detalle. */
const CIERRE_PASADO: CierrePasadoDTO = {
  cierreId: "c1",
  estado: "aprobado",
  destinoTipo: "bodega_central",
  destinoZonaId: "z1",
  totales: {
    efectivo: "300.00",
    simpe: "0.00",
    transferencia: "0.00",
    general: "300.00",
  },
  totalPagoMensajero: "45.00",
  totalIngresoBodegaRechazos: "0.00",
  solicitadoAt: "2026-07-11T10:00:00.000Z",
  resueltoAt: "2026-07-12T09:00:00.000Z",
  motivoRechazo: null,
};

function makeGestion(
  over: Partial<CierreDetalleGestion> & { gestionId: string; resultado: CierreResultado },
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
    // Feature 208/R31: el DTO gana el desglose y CONSERVA el escalar de arriba.
    pagos: [],
    motivo: null,
    fechaReprogramacion: null,
    evidenciaUrl: null,
    pagoMensajero: null, // feature 39
    ingresoBodegaRechazo: null, // feature 56
    tarifaFaltante: false, // feature 56/R23
    esRechazoSla: false, // feature 102
    // Feature 158/R9/R19: campos POR RAMA del incidente; los casos del incidente los
    // sobreescriben.
    causaIncidente: null,
    indemnizacion: null,
    ...over,
  };
}

function emptyGrupos(): CierreGrupos {
  return { entregada: [], reprogramada: [], devuelta: [], rechazada: [], incidente: [] };
}

const ZERO_TOTALES: CierreTotales = {
  efectivo: "0.00",
  simpe: "0.00",
  transferencia: "0.00",
  general: "0.00",
};

/**
 * Feature 170 — FASE 2 (T I.2): `cierresPasados` ya no es un array, es la PÁGINA que pre-carga
 * el Server Component. El helper sigue recibiendo el array para no reescribir cada caso, y
 * ADEMÁS programa la Server Action paginada con esa misma página (SWR revalida al montar).
 */
function renderModule(
  props?: Omit<Partial<Parameters<typeof CierreDiaModule>[0]>, "cierresPasados"> & {
    cierresPasados?: CierrePasadoDTO[];
  },
) {
  const pagina = paginaInicial(props?.cierresPasados ?? []);
  vi.mocked(listarCierresPasadosPaginado).mockResolvedValue({
    status: "ok",
    page: 1,
    ...pagina,
  });
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <CierreDiaModule
        grupos={props?.grupos ?? emptyGrupos()}
        totales={props?.totales ?? ZERO_TOTALES}
        totalPagoMensajero={props?.totalPagoMensajero ?? "0.00"}
        puedesSolicitar={props?.puedesSolicitar ?? true}
        motivoBloqueo={props?.motivoBloqueo ?? null}
        cierresPasados={pagina}
        bloqueado={props?.bloqueado ?? false}
        tieneVencido={props?.tieneVencido ?? false}
        tieneRechazado={props?.tieneRechazado ?? false}
      />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  solicitarMock.mockResolvedValue({
    status: "ok",
    cierreId: "c1",
    totales: ZERO_TOTALES,
    destinoTipo: "bodega_satelite",
  });
  deshacerMock.mockResolvedValue({ status: "ok", ordenId: "o-g1" });
});

afterEach(() => {
  cleanup();
});

describe("CierreDiaModule", () => {
  it("R3: agrupa las gestiones en las 4 secciones por resultado", () => {
    const grupos: CierreGrupos = {
      entregada: [makeGestion({ gestionId: "g1", resultado: "entregada", numRemision: "REM-ENT" })],
      reprogramada: [makeGestion({ gestionId: "g2", resultado: "reprogramada", numRemision: "REM-REP" })],
      devuelta: [makeGestion({ gestionId: "g3", resultado: "devuelta", numRemision: "REM-DEV" })],
      rechazada: [makeGestion({ gestionId: "g4", resultado: "rechazada", numRemision: "REM-REC" })],
      incidente: [], // feature 158/R18: la 5.a seccion la puebla la fase 2 (T2.2)
    };
    renderModule({ grupos });

    expect(
      within(screen.getByRole("region", { name: "Entregadas" })).getByText("REM-ENT"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Reprogramadas" })).getByText("REM-REP"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Devueltas" })).getByText("REM-DEV"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Rechazadas" })).getByText("REM-REC"),
    ).toBeInTheDocument();
  });

  it("R4: muestra el detalle completo de la orden gestionada", () => {
    const grupos = emptyGrupos();
    grupos.devuelta = [
      makeGestion({
        gestionId: "g1",
        resultado: "devuelta",
        numGuia: 2002,
        numRemision: "REM-DETALLE",
        destinatario: "Beto Ruiz",
        direccion: "Av. Central 100",
        producto: "Sobre",
        tiendaNombre: "Tienda Norte",
        zonaNombre: "Cartago",
        provinciaNombre: "Cartago",
        cantonNombre: "Oreamuno",
        distritoNombre: "San Rafael",
        motivo: "Cliente rechazó",
      }),
    ];
    renderModule({ grupos });

    const region = screen.getByRole("region", { name: "Devueltas" });
    expect(within(region).getByText("2002")).toBeInTheDocument();
    expect(within(region).getByText("Beto Ruiz")).toBeInTheDocument();
    expect(within(region).getByText("Av. Central 100")).toBeInTheDocument();
    expect(within(region).getByText("Sobre")).toBeInTheDocument();
    expect(within(region).getByText("Tienda Norte")).toBeInTheDocument();
    expect(within(region).getByText("Cliente rechazó")).toBeInTheDocument();
    expect(
      within(region).getByText("Cartago · Cartago · Oreamuno · San Rafael"),
    ).toBeInTheDocument();
  });

  it("R6: una entrega expone su monto (string, money-safe) y su método de pago", () => {
    const grupos = emptyGrupos();
    grupos.entregada = [
      makeGestion({
        gestionId: "g1",
        resultado: "entregada",
        numRemision: "REM-ENT",
        montoRecibido: "1250.50",
        metodoPago: "SINPE",
      }),
    ];
    renderModule({ grupos });

    const region = screen.getByRole("region", { name: "Entregadas" });
    expect(within(region).getByText("₡1.250,50")).toBeInTheDocument();
    expect(within(region).getByText("SINPE")).toBeInTheDocument();
  });

  it("R5: la evidencia se muestra vía URL firmada en el visor (nunca el path crudo)", async () => {
    const user = userEvent.setup();
    const grupos = emptyGrupos();
    grupos.rechazada = [
      makeGestion({
        gestionId: "g1",
        resultado: "rechazada",
        numRemision: "REM-REC",
        motivo: "Dirección inexistente",
        evidenciaUrl: "https://signed.example/evidencia.jpg?token=abc",
      }),
    ];
    renderModule({ grupos });

    await user.click(screen.getByRole("button", { name: "Ver evidencia" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Evidencia de la gestión",
    });
    const img = within(dialog).getByRole("img", {
      name: "Evidencia fotográfica de la gestión",
    });
    expect(img).toHaveAttribute(
      "src",
      "https://signed.example/evidencia.jpg?token=abc",
    );
  });

  it("R7: el panel de totales muestra los 4 totales tal cual (sin reparsear)", () => {
    renderModule({
      totales: {
        efectivo: "100.00",
        simpe: "50.25",
        transferencia: "10.10",
        general: "160.35",
      },
    });

    const region = screen.getByRole("region", { name: "Totales del día" });
    expect(within(region).getByText("₡100,00")).toBeInTheDocument();
    expect(within(region).getByText("₡50,25")).toBeInTheDocument();
    expect(within(region).getByText("₡10,10")).toBeInTheDocument();
    expect(within(region).getByText("₡160,35")).toBeInTheDocument();
  });

  it("R10: expone el pago al mensajero por orden (string, money-safe) en la sección de entregadas", () => {
    const grupos = emptyGrupos();
    grupos.entregada = [
      makeGestion({
        gestionId: "g1",
        resultado: "entregada",
        numRemision: "REM-ENT",
        montoRecibido: "1250.50",
        metodoPago: "efectivo",
        pagoMensajero: "1500.00",
      }),
    ];
    renderModule({ grupos });

    const region = screen.getByRole("region", { name: "Entregadas" });
    expect(within(region).getByText("₡1.500,00")).toBeInTheDocument();
  });

  it("R11: el total a pagar al mensajero se muestra separado de los totales de dinero recibido", () => {
    renderModule({ totalPagoMensajero: "4200.00" });

    const region = screen.getByRole("region", { name: "Ganancia" });
    expect(within(region).getByText("₡4.200,00")).toBeInTheDocument();
  });

  it("feature 56/R12: el ingreso de bodega por rechazos NO se muestra por orden en la tabla de rechazadas (solo el total; el desglose vive en las vistas de bodega/admin)", () => {
    const grupos = emptyGrupos();
    grupos.rechazada = [
      makeGestion({
        gestionId: "g1",
        resultado: "rechazada",
        numRemision: "REM-REC",
        motivo: "Cliente rechazó",
        ingresoBodegaRechazo: "3500.00",
      }),
    ];
    renderModule({ grupos });

    const region = screen.getByRole("region", { name: "Rechazadas" });
    expect(within(region).queryByText("Ingreso bodega")).not.toBeInTheDocument();
    expect(within(region).queryByText("₡3.500,00")).not.toBeInTheDocument();
  });

  it("feature 56/R10: el ingreso de bodega por rechazos NO se le muestra al mensajero (el total vive en las vistas de bodega/admin)", () => {
    renderModule();

    expect(
      screen.queryByRole("region", { name: "Ingreso de bodega por rechazos" }),
    ).not.toBeInTheDocument();
  });

  it("R10/R11: sin poder solicitar, el botón está deshabilitado y se muestra el motivo", () => {
    renderModule({
      puedesSolicitar: false,
      motivoBloqueo: "Tenés órdenes sin gestionar; gestionalas antes de cerrar.",
    });

    expect(
      screen.getByRole("button", { name: "Solicitar cierre" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Tenés órdenes sin gestionar; gestionalas antes de cerrar."),
    ).toBeInTheDocument();
  });

  it("solicitar cierre OK: confirma, muestra toast de éxito y refresca", async () => {
    const user = userEvent.setup();
    const grupos = emptyGrupos();
    grupos.entregada = [makeGestion({ gestionId: "g1", resultado: "entregada" })];
    renderModule({ grupos, puedesSolicitar: true });

    await user.click(screen.getByRole("button", { name: "Solicitar cierre" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Solicitar cierre del día",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Solicitar cierre" }),
    );

    await vi.waitFor(() => expect(solicitarMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(successMock).toHaveBeenCalled());
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("solicitar cierre conflict: muestra toast de error con el motivo del dominio", async () => {
    const user = userEvent.setup();
    solicitarMock.mockResolvedValue({
      status: "conflict",
      motivo: "Ya tienes un cierre solicitado.",
    });
    const grupos = emptyGrupos();
    grupos.entregada = [makeGestion({ gestionId: "g1", resultado: "entregada" })];
    renderModule({ grupos, puedesSolicitar: true });

    await user.click(screen.getByRole("button", { name: "Solicitar cierre" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Solicitar cierre del día",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Solicitar cierre" }),
    );

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith("Ya tienes un cierre solicitado."),
    );
    expect(successMock).not.toHaveBeenCalled();
  });

  it("R18: el histórico lista los cierres pasados con estado, destino y totales", () => {
    const cierresPasados: CierrePasadoDTO[] = [
      {
        cierreId: "c1",
        estado: "solicitado",
        destinoTipo: "bodega_central",
        destinoZonaId: "z1",
        totales: {
          efectivo: "300.00",
          simpe: "0.00",
          transferencia: "0.00",
          general: "300.00",
        },
        totalPagoMensajero: "0.00", // feature 39/R13
        totalIngresoBodegaRechazos: "2100.00", // en el DTO, pero el mensajero no lo ve
        solicitadoAt: "2026-07-11T10:00:00.000Z",
      },
    ];
    renderModule({ cierresPasados });

    const region = screen.getByRole("region", { name: "Cierres solicitados" });
    expect(within(region).getByText("Solicitado")).toBeInTheDocument();
    expect(within(region).getByText("Bodega central")).toBeInTheDocument();
    // Efectivo y total general comparten valor: hay 2 celdas con ₡300,00.
    expect(within(region).getAllByText("₡300,00")).toHaveLength(2);
    // El histórico del mensajero nunca tuvo columna de ingreso de bodega (la tabla no
    // renderiza `totalIngresoBodegaRechazos`); ese desglose vive en bodega/admin.
    expect(within(region).queryByText("₡2.100,00")).not.toBeInTheDocument();
    expect(within(region).getByText("2026-07-11")).toBeInTheDocument();
  });

  // Pedido humano: cada cierre del histórico se puede ABRIR y ver su detalle, con el MISMO
  // comprobante del admin en variante `mensajero`.
  it("el histórico ofrece 'Ver' y abre el comprobante del cierre con sus órdenes", async () => {
    const user = userEvent.setup();
    verCierrePasadoMock.mockResolvedValue({
      status: "ok",
      cierre: CIERRE_PASADO,
      grupos: {
        ...emptyGrupos(),
        entregada: [
          makeGestion({
            gestionId: "g1",
            resultado: "entregada",
            destinatario: "Ana Pérez",
            montoRecibido: "300.00",
            metodoPago: "efectivo",
            pagoMensajero: "45.00",
          }),
        ],
      },
    });
    renderModule({ cierresPasados: [CIERRE_PASADO] });

    const region = screen.getByRole("region", { name: "Cierres solicitados" });
    await user.click(within(region).getByRole("button", { name: /^Ver del cierre/ }));

    await vi.waitFor(() =>
      expect(verCierrePasadoMock).toHaveBeenCalledWith({ cierreId: "c1" }),
    );
    // El comprobante se pinta con la orden del cierre y el pago rotulado como GANANCIA
    // (para el mensajero ese monto es su ganancia, no "pago al mensajero").
    const comprobante = await screen.findByRole("region", {
      name: "Comprobante detallado de tu cierre",
    });
    expect(within(comprobante).getByText("Ana Pérez")).toBeInTheDocument();
    expect(within(comprobante).getAllByText("Ganancia").length).toBeGreaterThan(0);
    // Plata de la EMPRESA: no aparece en la vista del mensajero (design §7.2).
    expect(within(comprobante).queryByText("Pago al mensajero")).toBeNull();
    expect(within(comprobante).queryByText("Liquidación")).toBeNull();
  });

  it("si el cierre ya no está disponible, el comprobante avisa y no se pinta", async () => {
    const user = userEvent.setup();
    verCierrePasadoMock.mockResolvedValue({ status: "no_encontrada" });
    renderModule({ cierresPasados: [CIERRE_PASADO] });

    await user.click(screen.getByRole("button", { name: /^Ver del cierre/ }));

    expect(
      await screen.findByText("Este cierre ya no está disponible."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Comprobante detallado de tu cierre" }),
    ).toBeNull();
  });

  it("R18: sin cierres pasados muestra el estado vacío del histórico", () => {
    renderModule({ cierresPasados: [] });
    const region = screen.getByRole("region", { name: "Cierres solicitados" });
    expect(
      within(region).getByText("Aún no has solicitado ningún cierre."),
    ).toBeInTheDocument();
  });

  // ---------- Feature 41 (F2, R21) + Feature 111 (R12) ----------

  it("R12: bloqueado muestra el aviso accionable de BLOQUEO TOTAL (no gestionar NI recibir)", () => {
    renderModule({ bloqueado: true });

    expect(screen.getByRole("alert")).toHaveTextContent(
      /no puedes gestionar ni recibir nuevas asignaciones hasta resolver tu cierre pendiente/i,
    );
  });

  it("R12: sin bloqueo NO muestra el aviso de bloqueo total", () => {
    renderModule({ bloqueado: false });

    expect(
      screen.queryByText(/no puedes gestionar ni recibir nuevas asignaciones/i),
    ).not.toBeInTheDocument();
  });

  // ---------- Feature 111 (R13): CTA del cierre vencido ----------

  it("R13: con un cierre vencido aparece el CTA 'Solicitar aprobación del cierre vencido', habilitado aunque no pueda solicitar", () => {
    renderModule({ tieneVencido: true, puedesSolicitar: false });

    const cta = screen.getByRole("button", {
      name: "Solicitar aprobación del cierre vencido",
    });
    expect(cta).toBeInTheDocument();
    // R13: habilitado con INDEPENDENCIA del gate de creación (`puedesSolicitar`).
    expect(cta).toBeEnabled();
    // El botón normal de "Solicitar cierre" sigue deshabilitado por el gate.
    expect(
      screen.getByRole("button", { name: "Solicitar cierre" }),
    ).toBeDisabled();
  });

  it("R13: sin cierre vencido NO aparece el CTA del vencido", () => {
    renderModule({ tieneVencido: false });

    expect(
      screen.queryByRole("button", {
        name: "Solicitar aprobación del cierre vencido",
      }),
    ).not.toBeInTheDocument();
  });

  it("R13: al confirmar el CTA del vencido invoca solicitarCierre y muestra el toast del vencido", async () => {
    const user = userEvent.setup();
    solicitarMock.mockResolvedValue({ status: "ok", via: "vencido_solicitado" });
    renderModule({ tieneVencido: true, puedesSolicitar: false });

    await user.click(
      screen.getByRole("button", {
        name: "Solicitar aprobación del cierre vencido",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Solicitar aprobación del cierre vencido",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Solicitar aprobación" }),
    );

    await vi.waitFor(() => expect(solicitarMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(successMock).toHaveBeenCalledWith(
        "Cierre vencido enviado a aprobación.",
      ),
    );
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  // ---------- Feature 109 (R31): CTA re-solicitar el cierre `rechazado` ----------

  it("R31: con un cierre rechazado aparece el CTA 'Solicitar aprobación del cierre rechazado', habilitado aunque no pueda solicitar", () => {
    renderModule({ tieneRechazado: true, puedesSolicitar: false });

    const cta = screen.getByRole("button", {
      name: "Solicitar aprobación del cierre rechazado",
    });
    expect(cta).toBeInTheDocument();
    // R31: habilitado con INDEPENDENCIA del gate de creación (`puedesSolicitar`),
    // espejo del CTA del `vencido`.
    expect(cta).toBeEnabled();
    // El botón normal de "Solicitar cierre" sigue deshabilitado por el gate.
    expect(
      screen.getByRole("button", { name: "Solicitar cierre" }),
    ).toBeDisabled();
  });

  it("R31: el aviso comunica que un cierre rechazado NO es terminal (bloquea hasta re-solicitar + aprobar)", () => {
    renderModule({ tieneRechazado: true });

    const region = screen.getByRole("region", { name: "Cierre rechazado" });
    // No se lee como "resuelto/cerrado": sigue bloqueando hasta re-enviarlo y que lo aprueben.
    expect(region).toHaveTextContent(/no queda cerrado/i);
    expect(region).toHaveTextContent(/sigue bloqueando/i);
    expect(region).toHaveTextContent(/apruebe/i);
  });

  it("R31: sin cierre rechazado NO aparece el CTA del rechazado", () => {
    renderModule({ tieneRechazado: false });

    expect(
      screen.queryByRole("button", {
        name: "Solicitar aprobación del cierre rechazado",
      }),
    ).not.toBeInTheDocument();
  });

  it("R31: al confirmar el CTA del rechazado invoca solicitarCierre (misma action) y muestra el toast del rechazado", async () => {
    const user = userEvent.setup();
    solicitarMock.mockResolvedValue({ status: "ok", via: "rechazado_solicitado" });
    renderModule({ tieneRechazado: true, puedesSolicitar: false });

    await user.click(
      screen.getByRole("button", {
        name: "Solicitar aprobación del cierre rechazado",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Solicitar aprobación del cierre rechazado",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Solicitar aprobación" }),
    );

    await vi.waitFor(() => expect(solicitarMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(successMock).toHaveBeenCalledWith(
        "Cierre rechazado enviado a aprobación.",
      ),
    );
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });
});

// ---------- Feature 67 (T17/T18, R35–R38): deshacer gestión ----------
//
// La vista NO decide la elegibilidad: `findGestionesPendientes` ya filtra por la
// ventana (`cierre_id IS NULL` + `anulada_at IS NULL`) y `/cierre-dia` es exclusivo
// del mensajero dueño (`page.tsx` → `notFound()`). Por eso toda fila renderizada es
// deshacible y el botón va en las 4 tablas; una carrera la corta el server con
// `conflict` + motivo accionable, que la vista muestra tal cual (R38).

const REGIONES: Array<{ resultado: CierreResultado; region: string }> = [
  { resultado: "entregada", region: "Entregadas" },
  { resultado: "reprogramada", region: "Reprogramadas" },
  { resultado: "devuelta", region: "Devueltas" },
  { resultado: "rechazada", region: "Rechazadas" },
];

/** Abre el modal de confirmación desde la fila indicada y devuelve el diálogo. */
async function abrirDeshacer(
  user: ReturnType<typeof userEvent.setup>,
  region: string,
  nombreBoton: string,
) {
  await user.click(
    within(screen.getByRole("region", { name: region })).getByRole("button", {
      name: nombreBoton,
    }),
  );
  return screen.findByRole("dialog", { name: "Devolver la orden a gestión" });
}

describe("CierreDiaModule — feature 67: devolver a gestión", () => {
  it.each(REGIONES)(
    "R35: ofrece la acción por fila en la tabla de $region",
    ({ resultado, region }) => {
      const grupos = emptyGrupos();
      grupos[resultado] = [
        makeGestion({ gestionId: "g1", resultado, destinatario: "Ana Pérez", numRemision: "REM-A" }),
      ];
      renderModule({ grupos });

      expect(
        within(screen.getByRole("region", { name: region })).getByRole("button", {
          name: "Devolver a gestión la orden REM-A · Ana Pérez",
        }),
      ).toBeInTheDocument();
    },
  );

  it("R35: hay UN botón por fila y su nombre accesible identifica SU orden", () => {
    const grupos = emptyGrupos();
    grupos.entregada = [
      makeGestion({ gestionId: "g1", resultado: "entregada", numRemision: "REM-1", destinatario: "Ana Pérez" }),
      makeGestion({ gestionId: "g2", resultado: "entregada", numRemision: "REM-2", destinatario: "Beto Ruiz" }),
    ];
    renderModule({ grupos });

    const region = screen.getByRole("region", { name: "Entregadas" });
    expect(
      within(region).getAllByRole("button", { name: /^Devolver a gestión la orden/ }),
    ).toHaveLength(2);
    expect(
      within(region).getByRole("button", { name: "Devolver a gestión la orden REM-1 · Ana Pérez" }),
    ).toBeInTheDocument();
    expect(
      within(region).getByRole("button", { name: "Devolver a gestión la orden REM-2 · Beto Ruiz" }),
    ).toBeInTheDocument();
  });

  it("R35: una tabla vacía no ofrece la acción", () => {
    renderModule({ grupos: emptyGrupos() });

    expect(
      screen.queryByRole("button", { name: /^Devolver a gestión la orden/ }),
    ).not.toBeInTheDocument();
  });

  it("R36: pulsar la acción NO ejecuta el deshacer: pide confirmación explícita", async () => {
    const user = userEvent.setup();
    const grupos = emptyGrupos();
    grupos.devuelta = [
      makeGestion({ gestionId: "g1", resultado: "devuelta", numRemision: "REM-A", destinatario: "Ana Pérez" }),
    ];
    renderModule({ grupos });

    const dialog = await abrirDeshacer(user, "Devueltas", "Devolver a gestión la orden REM-A · Ana Pérez");

    expect(dialog).toBeInTheDocument();
    expect(deshacerMock).not.toHaveBeenCalled();
  });

  it("R36: cancelar la confirmación NO invoca la action ni refresca", async () => {
    const user = userEvent.setup();
    const grupos = emptyGrupos();
    grupos.entregada = [
      makeGestion({ gestionId: "g1", resultado: "entregada", numRemision: "REM-A", destinatario: "Ana Pérez" }),
    ];
    renderModule({ grupos });

    const dialog = await abrirDeshacer(user, "Entregadas", "Devolver a gestión la orden REM-A · Ana Pérez");
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    expect(deshacerMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("R36: la confirmación nombra la orden y advierte que la gestión queda anulada con rastro", async () => {
    const user = userEvent.setup();
    const grupos = emptyGrupos();
    grupos.entregada = [
      makeGestion({ gestionId: "g1", resultado: "entregada", numRemision: "REM-A", destinatario: "Ana Pérez" }),
    ];
    renderModule({ grupos });

    const dialog = await abrirDeshacer(user, "Entregadas", "Devolver a gestión la orden REM-A · Ana Pérez");

    expect(dialog).toHaveTextContent(/Orden REM-A · Ana Pérez/);
    expect(dialog).toHaveTextContent(/quedará anulada/i);
    expect(dialog).toHaveTextContent(/volverá a tu lista para gestionar/i);
  });

  it("R37: al confirmar invoca la action con el gestionId de ESA fila (objeto, no string)", async () => {
    const user = userEvent.setup();
    const grupos = emptyGrupos();
    grupos.reprogramada = [
      makeGestion({ gestionId: "g-abc", resultado: "reprogramada", numRemision: "REM-1", destinatario: "Ana Pérez" }),
      makeGestion({ gestionId: "g-xyz", resultado: "reprogramada", numRemision: "REM-2", destinatario: "Beto Ruiz" }),
    ];
    renderModule({ grupos });

    const dialog = await abrirDeshacer(
      user,
      "Reprogramadas",
      "Devolver a gestión la orden REM-2 · Beto Ruiz",
    );
    await user.click(within(dialog).getByRole("button", { name: "Devolver a gestión" }));

    await vi.waitFor(() => expect(deshacerMock).toHaveBeenCalledTimes(1));
    expect(deshacerMock).toHaveBeenCalledWith({ gestionId: "g-xyz" });
  });

  it("R37: éxito → toast de éxito y refresh (la vista relee el estado del servidor)", async () => {
    const user = userEvent.setup();
    const grupos = emptyGrupos();
    grupos.entregada = [
      makeGestion({ gestionId: "g1", resultado: "entregada", numRemision: "REM-A", destinatario: "Ana Pérez" }),
    ];
    renderModule({ grupos });

    const dialog = await abrirDeshacer(user, "Entregadas", "Devolver a gestión la orden REM-A · Ana Pérez");
    await user.click(within(dialog).getByRole("button", { name: "Devolver a gestión" }));

    await vi.waitFor(() => expect(successMock).toHaveBeenCalled());
    // R37: el nuevo estado (fila fuera + totales recalculados) lo produce el SERVIDOR;
    // la vista solo revalida la ruta. Nunca muta la tabla ni los totales localmente.
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("R38: conflict → muestra el motivo ACCIONABLE del server y NO altera tabla ni totales", async () => {
    const user = userEvent.setup();
    deshacerMock.mockResolvedValue({
      status: "conflict",
      motivo: "Esta orden ya fue procesada por la bodega; ya no se puede deshacer.",
    });
    const grupos = emptyGrupos();
    grupos.devuelta = [
      makeGestion({
        gestionId: "g1",
        resultado: "devuelta",
        numRemision: "REM-A",
        destinatario: "Ana Pérez",
        pagoMensajero: "1500.00",
      }),
    ];
    const totales: CierreTotales = {
      efectivo: "150.00",
      simpe: "0.00",
      transferencia: "0.00",
      general: "150.00",
    };
    renderModule({ grupos, totales, totalPagoMensajero: "1500.00" });

    const dialog = await abrirDeshacer(user, "Devueltas", "Devolver a gestión la orden REM-A · Ana Pérez");
    await user.click(within(dialog).getByRole("button", { name: "Devolver a gestión" }));

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        "Esta orden ya fue procesada por la bodega; ya no se puede deshacer.",
      ),
    );
    expect(successMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
    // La fila sigue en su tabla y los totales no se movieron (R38).
    const region = screen.getByRole("region", { name: "Devueltas" });
    expect(within(region).getByText("REM-A")).toBeInTheDocument();
    expect(
      within(region).getByRole("button", { name: "Devolver a gestión la orden REM-A · Ana Pérez" }),
    ).toBeEnabled();
    const panel = screen.getByRole("region", { name: "Totales del día" });
    expect(within(panel).getAllByText("₡150,00")).toHaveLength(2);
    expect(
      within(screen.getByRole("region", { name: "Ganancia" })).getByText("₡1.500,00"),
    ).toBeInTheDocument();
  });

  it("R38: forbidden → mensaje accionable propio (el server no revela motivo) sin refresh", async () => {
    const user = userEvent.setup();
    deshacerMock.mockResolvedValue({ status: "forbidden" });
    const grupos = emptyGrupos();
    grupos.rechazada = [
      makeGestion({ gestionId: "g1", resultado: "rechazada", numRemision: "REM-A", destinatario: "Ana Pérez" }),
    ];
    renderModule({ grupos });

    const dialog = await abrirDeshacer(user, "Rechazadas", "Devolver a gestión la orden REM-A · Ana Pérez");
    await user.click(within(dialog).getByRole("button", { name: "Devolver a gestión" }));

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith("No podés deshacer esta gestión."),
    );
    expect(refreshMock).not.toHaveBeenCalled();
    expect(
      within(screen.getByRole("region", { name: "Rechazadas" })).getByText("REM-A"),
    ).toBeInTheDocument();
  });

  it("R38: validation_error → muestra el primer fieldError; unauthenticated → mensaje genérico", async () => {
    const user = userEvent.setup();
    const grupos = emptyGrupos();
    grupos.entregada = [
      makeGestion({ gestionId: "g1", resultado: "entregada", numRemision: "REM-A", destinatario: "Ana Pérez" }),
    ];

    deshacerMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { estatus: ["catalogo de estados incompleto (seed pendiente)"] },
    });
    renderModule({ grupos });
    let dialog = await abrirDeshacer(user, "Entregadas", "Devolver a gestión la orden REM-A · Ana Pérez");
    await user.click(within(dialog).getByRole("button", { name: "Devolver a gestión" }));
    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith("catalogo de estados incompleto (seed pendiente)"),
    );

    cleanup();
    vi.clearAllMocks();
    deshacerMock.mockResolvedValue({ status: "unauthenticated" });
    renderModule({ grupos });
    dialog = await abrirDeshacer(user, "Entregadas", "Devolver a gestión la orden REM-A · Ana Pérez");
    await user.click(within(dialog).getByRole("button", { name: "Devolver a gestión" }));
    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith("No se pudo deshacer la gestión. Intentá de nuevo."),
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("R37: tras el éxito, el botón de SU fila queda deshabilitado hasta que el refresh la retire; los demás siguen activos", async () => {
    // Ventana REAL del anti-doble-submit: mientras el modal está abierto, Base UI deja
    // el fondo `inert`/`aria-hidden` (la tabla ni siquiera es alcanzable). El único
    // hueco es entre el `ok` (modal cerrado) y la llegada del `router.refresh()`, que
    // es el que retira la fila. Ahí un segundo envío recibiría el `conflict` "esta
    // gestión ya fue deshecha" (R3): el estado `deshaciendo` lo cierra.
    const user = userEvent.setup();
    const grupos = emptyGrupos();
    grupos.entregada = [
      makeGestion({ gestionId: "g1", resultado: "entregada", numRemision: "REM-1", destinatario: "Ana Pérez" }),
      makeGestion({ gestionId: "g2", resultado: "entregada", numRemision: "REM-2", destinatario: "Beto Ruiz" }),
    ];
    renderModule({ grupos });

    const dialog = await abrirDeshacer(user, "Entregadas", "Devolver a gestión la orden REM-1 · Ana Pérez");
    await user.click(within(dialog).getByRole("button", { name: "Devolver a gestión" }));
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());

    // El refresh aún no repuso las props (el test las mantiene): la fila sigue visible.
    const region = screen.getByRole("region", { name: "Entregadas" });
    await vi.waitFor(() =>
      expect(
        within(region).getByRole("button", { name: "Devolver a gestión la orden REM-1 · Ana Pérez" }),
      ).toBeDisabled(),
    );
    expect(
      within(region).getByRole("button", { name: "Devolver a gestión la orden REM-2 · Beto Ruiz" }),
    ).toBeEnabled();
    expect(deshacerMock).toHaveBeenCalledTimes(1);
  });

  it("R38: tras un error, el botón de la fila vuelve a estar disponible para reintentar", async () => {
    const user = userEvent.setup();
    deshacerMock.mockResolvedValue({ status: "conflict", motivo: "Esta gestión ya fue deshecha." });
    const grupos = emptyGrupos();
    grupos.entregada = [
      makeGestion({ gestionId: "g1", resultado: "entregada", numRemision: "REM-1", destinatario: "Ana Pérez" }),
    ];
    renderModule({ grupos });

    const dialog = await abrirDeshacer(user, "Entregadas", "Devolver a gestión la orden REM-1 · Ana Pérez");
    await user.click(within(dialog).getByRole("button", { name: "Devolver a gestión" }));
    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());

    await vi.waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "Entregadas" })).getByRole("button", {
          name: "Devolver a gestión la orden REM-1 · Ana Pérez",
        }),
      ).toBeEnabled(),
    );
  });
});
