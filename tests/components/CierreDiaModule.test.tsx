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
// Feature 213 (T9/R25): las etiquetas de método se MUTAN en un caso para probar que la celda
// las lee de aquí y no de una cadena escrita a mano en la pantalla.
import { METODO_LABEL } from "@/app/(app)/cierres-admin/_components/cierre-labels";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreTotales,
  CierrePasadoDTO,
  CierreResultado,
} from "@/lib/interfaces/services/ICierreDiaService";
import type { BloqueoDetalle } from "@/lib/utils/bloqueo-cierre";
import { SIN_BLOQUEO, estaBloqueadoPorCierres } from "@/lib/utils/bloqueo-cierre";
import {
  bloqueoConRechazado,
  bloqueoConVencido,
  bloqueoDe,
  bloqueoMixtoElMasViejoEsSuyo,
  bloqueoPorAcumular,
  bloqueoTodosPorEnviar,
} from "@/tests/fixtures/bloqueo-cierre";

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
    // Feature 212/R31: el DTO gana el desglose y CONSERVA el escalar de arriba.
    pagos: [],
    motivo: null,
    fechaReprogramacion: null,
    evidenciaUrl: null,
    pagoMensajero: null, // feature 39
    ingresoBodegaRechazo: null, // feature 56
    tarifaFaltante: false, // feature 56/R23
    esRechazoSla: false, // feature 102
    desdeAyudaTienda: false, // feature 237 (D6/R41): la registro el mensajero, no la tienda
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
        bloqueo={props?.bloqueo ?? SIN_BLOQUEO}
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
        // Feature 213 (T8): el fixture declara el desglose COHERENTE con su escalar. La
        // presentación deriva del desglose (R23) y la aserción de abajo no se relaja.
        pagos: [{ metodo: "SINPE", monto: "1250.50" }],
      }),
    ];
    renderModule({ grupos });

    const region = screen.getByRole("region", { name: "Entregadas" });
    expect(within(region).getByText("₡1.251")).toBeInTheDocument();
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

    // Feature 230/R20: el general es el REDONDEO DEL TOTAL del servidor (`160.35`
    // -> `₡160`), no la suma de los tres redondeados de arriba. Aquí las dos cuentas
    // coinciden; cuando no coincidan, manda el del servidor (consecuencia A1, ya
    // aceptada: una columna puede no cuadrar a ojo con su total por ±1/±2).
    const region = screen.getByRole("region", { name: "Totales del día" });
    expect(within(region).getByText("₡100")).toBeInTheDocument();
    expect(within(region).getByText("₡50")).toBeInTheDocument();
    expect(within(region).getByText("₡10")).toBeInTheDocument();
    expect(within(region).getByText("₡160")).toBeInTheDocument();
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
        pagos: [{ metodo: "efectivo", monto: "1250.50" }], // feature 213 (T8)
        pagoMensajero: "1500.00",
      }),
    ];
    renderModule({ grupos });

    const region = screen.getByRole("region", { name: "Entregadas" });
    expect(within(region).getByText("₡1.500")).toBeInTheDocument();
  });

  it("R11: el total a pagar al mensajero se muestra separado de los totales de dinero recibido", () => {
    renderModule({ totalPagoMensajero: "4200.00" });

    const region = screen.getByRole("region", { name: "Ganancia" });
    expect(within(region).getByText("₡4.200")).toBeInTheDocument();
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
    expect(within(region).queryByText("₡3.500")).not.toBeInTheDocument();
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
    // Pedido humano del 2026-08-16: el histórico es una tira de COMPROBANTES. Lo que la fila
    // decía en ocho columnas lo dice ahora la cabecera de la hoja —estado, destino, fecha y el
    // total— y su desglose, que llega detrás del desplegable.
    expect(within(region).getByText("Solicitado")).toBeInTheDocument();
    expect(within(region).getByText("Bodega central")).toBeInTheDocument();
    // Un solo ₡300 a la vista: el de la cabecera. El desglose por método está plegado.
    // El importe va sin céntimos desde la feature 230 de `dev`.
    expect(within(region).getAllByText("₡300")).toHaveLength(1);
    // El histórico del mensajero nunca enseñó el ingreso de bodega por rechazos: es plata de
    // la empresa (design §7.2), y no la ve NI plegada ni desplegada — lo comprueba el caso de
    // abajo, que es la mitad que la tabla no podía tener.
    expect(within(region).queryByText("₡2.100")).not.toBeInTheDocument();
    expect(within(region).getByText("2026-07-11")).toBeInTheDocument();
  });

  it("R18 + design §7.2: al desplegar su comprobante, el mensajero ve SU ganancia y no el ingreso de la empresa", async () => {
    // La tarjeta esconde el desglose tras un botón, así que un dato que no le toca no se vería
    // al primer vistazo: se vería al segundo. Esto abre el desplegable y mira.
    const user = userEvent.setup();
    const cierresPasados: CierrePasadoDTO[] = [
      {
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
        totalIngresoBodegaRechazos: "2100.00",
        solicitadoAt: "2026-07-11T10:00:00.000Z",
      },
    ];
    renderModule({ cierresPasados });

    const region = screen.getByRole("region", { name: "Cierres solicitados" });
    await user.click(
      within(region).getByRole("button", { name: /^Ver detalles de tu cierre del/ }),
    );

    // Su pago está, y con SU rótulo: en su pantalla ese monto se llama «Ganancia».
    expect(within(region).getByText("Ganancia")).toBeInTheDocument();
    expect(within(region).getByText("₡45")).toBeInTheDocument();
    // Y el ingreso de bodega por rechazos sigue sin aparecer, ni el rótulo ni el monto.
    expect(
      within(region).queryByText("Ingreso de bodega por rechazos"),
    ).not.toBeInTheDocument();
    expect(within(region).queryByText("₡2.100")).not.toBeInTheDocument();
  });

  // Pedido humano: cada cierre del histórico se puede ABRIR y ver su detalle, con el MISMO
  // comprobante del admin en variante `mensajero`.
  it("el histórico ofrece 'Ver' y abre el comprobante del cierre con sus órdenes", async () => {
    const user = userEvent.setup();
    verCierrePasadoMock.mockResolvedValue({
      ordenesSinGestion: [],
      sinGestionRegistrado: true,
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
            pagos: [{ metodo: "efectivo", monto: "300.00" }], // feature 213 (T8)
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

  // =============================================================================================
  // Feature 41 (F2/R21) + 111 (R12) + 109 (R31) -> FEATURE 271 (T9.2/T9.3)
  // =============================================================================================
  //
  // ⚠️ EL AVISO CAMBIÓ DOS VECES EN TRES DÍAS Y LA SEGUNDA DESHACE MEDIA PRIMERA.
  //   · Hasta el 19/08: «No puedes gestionar NI RECIBIR NUEVAS ASIGNACIONES…».
  //   · El 20/08 (241): se le quitó lo de recibir —la regla firmada declaraba la asignación exenta
  //     de todo bloqueo— y quedó «Sí puedes seguir recibiendo asignaciones: te esperan en
  //     «Entregas»».
  //   · El 23/08 (esta ficha, palabra del humano): esa mitad se REVIERTE. Un mensajero bloqueado
  //     TAMPOCO recibe trabajo nuevo, ni reparto ni recolección. La frase del 20/08 pasó de cierta
  //     a falsa, y este archivo la afirmaba palabra por palabra.
  //
  // ⚠️ LOS LITERALES VAN A MANO Y COMPLETOS, y NO importados de `avisoBloqueo` — compararlos
  // contra la función que los genera estaría siempre verde: cambiar el copy cambiaría el aserto
  // con él y esto no vigilaría nada. Aquí el texto es el CONTRATO con el mensajero, aprobado por
  // el humano el 2026-08-23 (§10.2), en su variante SIN puntero: ya está en esta pantalla.
  //
  // ⚠️ Y AHORA EL AVISO CUENTA. Antes era una cadena fija; ahora dice CUÁNTOS cierres arrastra y
  // CUÁL toca resolver primero (R43), con la fecha de la JORNADA —no la del nacimiento del cierre,
  // que en un vencido va un día por delante—.

  it("271/§10.2 caso 1 · bloqueado por ACUMULAR (N=2, V=0), con la fecha de la jornada", () => {
    renderModule({ bloqueo: bloqueoPorAcumular("2026-08-21") });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Tienes 2 cierres esperando aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Se desbloquea cuando la bodega apruebe el más antiguo, el del 21 de agosto.",
    );
  });

  it("271/R60 · el MISMO caso sin jornada fiable: la fecha desaparece entera", () => {
    renderModule({ bloqueo: bloqueoPorAcumular(null) });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Tienes 2 cierres esperando aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Se desbloquea cuando la bodega apruebe el más antiguo.",
    );
  });

  it("271/§10.2 caso 2 · con algo que reenviar (N=1, V=1): el botón está DEBAJO, no en otra pantalla", () => {
    renderModule({ bloqueo: bloqueoConVencido() });

    // La única diferencia con los portales «Entregas» y «Recolección» (R52): allí el puntero manda
    // a «Cierre del día»; aquí el mensajero YA está, y remitirlo aquí sería ruido.
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Tienes un cierre sin enviar a aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Envíalo a aprobación con el botón de abajo.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(/Ve a «Cierre del día»/);
  });

  it("271/§10.2 caso 3 · las DOS cosas a la vez (N=2, V=1)", () => {
    renderModule({ bloqueo: bloqueoDe({ n: 2, v: 1, jornadaCR: "2026-08-21" }) });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Tienes 2 cierres sin resolver y 1 de ellos no se ha enviado a aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Envía el que falta y espera a que la bodega apruebe el más antiguo, el del 21 de agosto.",
    );
    // Aquí NUNCA hay puntero (R52): el mensajero ya está en esta pantalla. El cambio del
    // 2026-08-23 —el puntero de este caso pierde el objeto— sólo afecta a los otros tres portales.
    expect(screen.getByRole("alert")).not.toHaveTextContent(/Ve a «Cierre del día»/);
  });

  it("271/§10.2 caso 3 con el MÁS VIEJO SUYO · la fecha es la del que él envía", () => {
    // ⚠️ LA CUARTA RAMA (aprobada el 2026-08-23, y el estado se midió en el navegador): el admin
    // rechazó el PRIMERO de sus dos `solicitado`, así que el cierre más viejo es SUYO. Antes decía
    // «espera a que la bodega apruebe el más antiguo» fechando su propio cierre — le mandaba a
    // esperar por el mismo que el botón le ofrece reenviar. Ahora la fecha nombra el que ÉL envía y
    // la espera se corre al RESTO.
    renderModule({ bloqueo: bloqueoMixtoElMasViejoEsSuyo({ jornadaCR: "2026-08-20" }) });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Tienes 2 cierres sin resolver y 1 de ellos no se ha enviado a aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Envía el que falta, el del 20 de agosto, y después espera a que la bodega apruebe el resto.",
    );
    // Aquí nunca hay puntero (R52) y el botón del rechazado está debajo, en la misma pantalla.
    expect(screen.getByRole("alert")).not.toHaveTextContent(/Ve a «Cierre del día»/);
    expect(
      screen.getByRole("button", { name: "Solicitar aprobación del cierre rechazado" }),
    ).toBeInTheDocument();
  });

  it("271/§10.2 caso 3 con V = N · TODO en su tejado: ni singular ni esperar a la bodega", () => {
    // Estado alcanzable (dos `rechazado`, o `vencido` + `rechazado`). Hasta el 2026-08-23 leía el
    // texto de arriba, que aquí dice dos cosas falsas: singular con DOS por enviar, y esperar a la
    // bodega cuando el más antiguo es suyo. Y sigue sin puntero, que es lo propio de esta pantalla.
    renderModule({ bloqueo: bloqueoTodosPorEnviar(2, "2026-08-21") });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Tienes 2 cierres sin resolver y ninguno se ha enviado a aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Envíalos a aprobación, empezando por el más antiguo, el del 21 de agosto.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(/Ve a «Cierre del día»/);
  });

  it("271/R51 · el aviso NO promete recibir asignaciones ni recoger en tiendas", () => {
    // Guardia de la regresión concreta, en su forma NEGATIVA: que hoy diga la verdad no impide que
    // mañana vuelva a colarse la promesa «para suavizar el mensaje». Era cierta hasta el 22 de
    // agosto y es falsa desde el 23.
    renderModule({ bloqueo: bloqueoDe({ n: 2, v: 1, jornadaCR: "2026-08-21" }) });

    const aviso = screen.getByRole("alert");
    expect(aviso).not.toHaveTextContent(/seguir recibiendo asignaciones/i);
    expect(aviso).not.toHaveTextContent(/seguir recogiendo en tiendas/i);
    expect(aviso).not.toHaveTextContent(/sí puedes/i);
    expect(aviso).not.toHaveTextContent(/ni recibir nuevas asignaciones/i);
  });

  it("271/R5 · un solo cierre YA enviado (N=1, V=0) NO muestra el aviso", () => {
    // La mitad de la regla del 2026-08-20 que esta ficha CONSERVA: ese mensajero ya hizo lo suyo y
    // espera al administrador (mediana 8,2 h, p90 22,1 h medidas contra producción).
    renderModule({ bloqueo: bloqueoDe({ n: 1, v: 0 }) });

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("271/R4 · sin ningún cierre abierto tampoco hay aviso", () => {
    renderModule({ bloqueo: SIN_BLOQUEO });

    expect(screen.queryByRole("alert")).toBeNull();
  });

  // ---------- Feature 111 (R13) -> 271 (T9.3): el CTA del cierre vencido, DERIVADO ----------
  //
  // El CTA ya no llega en una prop propia: se deriva del MISMO detalle que enciende el aviso. Dos
  // fuentes para la misma pregunta —el predicado por un lado, el histórico de cierres por otro— es
  // exactamente cómo se desincronizan.

  it("R13: con el más viejo VENCIDO aparece el CTA, habilitado aunque no pueda solicitar", () => {
    renderModule({ bloqueo: bloqueoConVencido(), puedesSolicitar: false });

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

  it("R13: sin nada que reenviar NO aparece el CTA del vencido", () => {
    renderModule({ bloqueo: bloqueoDe({ n: 1, v: 0 }) });

    expect(
      screen.queryByRole("button", {
        name: "Solicitar aprobación del cierre vencido",
      }),
    ).not.toBeInTheDocument();
  });

  it("R13/271: al confirmar el CTA del vencido invoca solicitarCierre y muestra su toast", async () => {
    const user = userEvent.setup();
    // FEATURE 271: el servidor ya NO distingue `vencido_solicitado` de `rechazado_solicitado` —la
    // re-solicitud se decide por EDAD, no por estado (R18)—, así que devuelve `resolicitado` y
    // quien sabe qué acaba de pasar es el botón que se pulsó.
    solicitarMock.mockResolvedValue({ status: "ok", via: "resolicitado" });
    renderModule({ bloqueo: bloqueoConVencido(), puedesSolicitar: false });

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

  // ---------- Feature 109 (R31) -> 271: el CTA del cierre rechazado ----------

  it("R31: con el más viejo RECHAZADO aparece su CTA, habilitado aunque no pueda solicitar", () => {
    renderModule({ bloqueo: bloqueoConRechazado(), puedesSolicitar: false });

    const cta = screen.getByRole("button", {
      name: "Solicitar aprobación del cierre rechazado",
    });
    expect(cta).toBeInTheDocument();
    expect(cta).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Solicitar cierre" }),
    ).toBeDisabled();
  });

  // ⚠️ FEATURE 271 — LOS DOS AVISOS DE ABAJO PERDIERON SU PROMESA, Y NO ES UN RECORTE DE ESTILO.
  //
  // Decían «Envíalo a aprobación PARA DESTRABAR tu operación» y «con eso SE LEVANTA EL BLOQUEO y
  // sigues gestionando y cobrando, sin esperar a que tu bodega lo apruebe». Era cierto mientras un
  // mensajero no podía tener más de un cierre abierto: enviar el único que arrastraba lo dejaba
  // libre en esa misma escritura, y la feature 241 lo verificó contra el predicado.
  //
  // Desde esta ficha puede arrastrar DOS, y entonces enviar el que falta NO lo desbloquea: sigue
  // bloqueado hasta que la bodega apruebe el más antiguo (R8). La promesa pasó de cierta a
  // condicional, y una promesa condicional dicha en absoluto es una promesa falsa la mitad de las
  // veces. Quien dice ahora qué pasa después es el aviso de bloqueo de arriba, que SÍ distingue
  // los dos casos —y que se pinta siempre que hay algo que reenviar, porque tenerlo implica estar
  // bloqueado por la propia regla—.

  const AVISO_RECHAZADO_ESPERADO =
    "Tu cierre fue rechazado, pero no queda cerrado. Vuelve a enviarlo a aprobación con el botón de abajo.";

  it("R31/271: el aviso del rechazado dice que NO queda cerrado, y ya no promete el desbloqueo", () => {
    renderModule({ bloqueo: bloqueoConRechazado() });

    const region = screen.getByRole("region", { name: "Cierre rechazado" });
    expect(region).toHaveTextContent(AVISO_RECHAZADO_ESPERADO);
    // Lo que el aviso SIGUE aportando y no se perdió: un rechazado no es terminal.
    expect(region).toHaveTextContent(/no queda cerrado/i);
  });

  it("R31/271: el aviso NO promete que el bloqueo se levante al reenviar (con dos cierres, no)", () => {
    renderModule({ bloqueo: bloqueoConRechazado() });

    const region = screen.getByRole("region", { name: "Cierre rechazado" });
    // Ni la promesa vieja de la 109 («hasta que tu bodega lo apruebe») ni la de la 241 («con eso
    // se levanta el bloqueo»): las dos son ciertas sólo para un valor concreto de N.
    expect(region).not.toHaveTextContent(/sigue bloqueando/i);
    expect(region).not.toHaveTextContent(/y tu bodega lo apruebe/i);
    expect(region).not.toHaveTextContent(/se levanta el bloqueo/i);
  });

  it("R13/271: el aviso del vencido dice qué pasó y dónde está el botón, sin prometer nada más", () => {
    renderModule({ bloqueo: bloqueoConVencido() });

    const region = screen.getByRole("region", { name: "Cierre vencido" });
    expect(region).toHaveTextContent(
      "Tu cierre venció sin enviarse a aprobación. Envíalo con el botón de abajo.",
    );
    expect(region).not.toHaveTextContent(/destrabar tu operación/i);
  });

  it("R31: sin cierre rechazado NO aparece su CTA", () => {
    renderModule({ bloqueo: bloqueoConVencido() });

    expect(
      screen.queryByRole("button", {
        name: "Solicitar aprobación del cierre rechazado",
      }),
    ).not.toBeInTheDocument();
  });

  it("R31/271: al confirmar el CTA del rechazado invoca la MISMA action y muestra su toast", async () => {
    const user = userEvent.setup();
    solicitarMock.mockResolvedValue({ status: "ok", via: "resolicitado" });
    renderModule({ bloqueo: bloqueoConRechazado(), puedesSolicitar: false });

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

  // =============================================================================================
  // FEATURE 271 — QUÉ PUEDE REENVIAR **ÉL**: LOS CASOS 5, 6 Y 7 DE LA TABLA DE VERDAD
  // =============================================================================================
  //
  // EL BOTÓN NO CONTESTA LA PREGUNTA DE LA COLA. `aResolverPrimero` dice qué se resuelve PRIMERO
  // (el abierto más viejo, R11); `aReenviarPrimero` dice qué puede tocar ÉL (el RE-SOLICITABLE más
  // viejo, R18). En los casos 5 y 7 son el mismo cierre y da igual de cuál se lea; en el CASO 6
  // —«solicitó el primero y dejó vencer el segundo», N=2 V=1— son DOS cierres distintos, y ahí es
  // donde la pantalla se equivocaba: derivaba el botón del primero, veía un `solicitado` —que
  // resuelve la BODEGA— y no pintaba nada, aunque `solicitarCierre` sí le dejaba reenviar el otro
  // (R16/R18). Un mensajero con algo que hacer y sin dónde hacerlo.
  //
  // ⚠️ AQUÍ VIVIÓ UN TERCER CTA «NEUTRO» («Enviar el cierre a aprobación») y estos tests vigilan
  // que NO vuelva. Existía sólo porque el dato no viajaba: decía que había algo que enviar sin
  // poder decir qué. Ahora el caso 6 enciende el CTA del `vencido` o el del `rechazado`, con
  // nombre propio, así que un botón sin nombre sería un segundo botón para el MISMO envío.
  const CTA_NEUTRO_RETIRADO = "Enviar el cierre a aprobación";

  /**
   * El CASO 7 —«dos cierres rechazados», N=2 V=2— se compone AQUÍ y no se pide a `bloqueoDe`:
   * esa fábrica sólo sabe producir `vencido`, y **dos `vencido` a la vez son IMPOSIBLES** (R17,
   * corregido por el humano el 2026-08-23). Pedirle `{ n: 2, v: 2 }` daría un doble que la base no
   * puede producir, y un test verde contra un imposible no dice nada. El caso real de dos
   * re-solicitables incluye siempre un `rechazado`.
   *
   * `bloqueado` NO se escribe a mano —sale de `estaBloqueadoPorCierres`, igual que en la fábrica
   * compartida—: un doble no debe poder afirmar un estado que la regla no produce.
   */
  function bloqueoCaso7(): BloqueoDetalle {
    const rechazadoMasViejo = {
      cierreId: "c-rechazado-viejo",
      estado: "rechazado" as const,
      solicitadoAt: "2026-08-20T18:00:00.000Z",
      jornadaCR: "2026-08-20",
      resuelve: "mensajero" as const,
    };
    return {
      bloqueado: estaBloqueadoPorCierres({ n: 2, v: 2 }),
      cierresAbiertos: 2,
      cierresPorReenviar: 2,
      // Con los DOS abiertos re-solicitables, el más viejo de la cola y el más viejo de los
      // re-solicitables son el MISMO cierre: los dos campos apuntan ahí (R18).
      aResolverPrimero: rechazadoMasViejo,
      aReenviarPrimero: rechazadoMasViejo,
    };
  }

  it("271/caso 5 (N=1, V=1): con un único cierre vencido, su CTA y ningún otro", () => {
    // Los dos campos nombran el mismo cierre. Es el caso que ya funcionaba, y está aquí para que se
    // vea que la lectura nueva no lo rompe: no hace falta ramificar por caso.
    renderModule({ bloqueo: bloqueoConVencido("2026-08-21"), puedesSolicitar: false });

    expect(
      screen.getByRole("button", { name: "Solicitar aprobación del cierre vencido" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Solicitar aprobación del cierre rechazado" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: CTA_NEUTRO_RETIRADO })).toBeNull();
  });

  it("271/caso 6 (N=2, V=1): el CTA sale del RE-SOLICITABLE, no del más viejo de la cola", () => {
    // ⚠️ ÉSTE ES EL TEST DE LA REGRESIÓN. El más viejo es el `solicitado` que espera a la bodega;
    // el suyo es el `vencido`. Derivar el botón del primero deja la pantalla SIN botón —el fallo
    // que este cambio cierra—, así que este aserto muere si alguien vuelve a leer aquel campo.
    renderModule({
      bloqueo: bloqueoDe({ n: 2, v: 1, jornadaCR: "2026-08-21" }),
      puedesSolicitar: false,
    });

    const cta = screen.getByRole("button", {
      name: "Solicitar aprobación del cierre vencido",
    });
    expect(cta).toBeEnabled();
    // Y con nombre propio: el CTA neutro se retiró junto con la deuda que lo justificaba.
    expect(screen.queryByRole("button", { name: CTA_NEUTRO_RETIRADO })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Solicitar aprobación del cierre rechazado" }),
    ).toBeNull();
  });

  it("271/caso 6: el aviso dice LAS DOS COSAS y el botón está debajo, en la misma pantalla", () => {
    // R43 — qué espera de la bodega (`aResolverPrimero`, con SU fecha) y qué puede hacer él ya
    // mismo (`aReenviarPrimero`, que es el botón). Antes decía sólo la primera mitad y la segunda
    // no tenía dónde ocurrir.
    //
    // ⚠️ LITERAL A MANO Y COMPLETO (§10.2, aprobado por el humano el 2026-08-23), nunca comparado
    // contra `avisoBloqueo`: un texto medido contra la función que lo genera está siempre verde.
    renderModule({
      bloqueo: bloqueoDe({ n: 2, v: 1, jornadaCR: "2026-08-21" }),
      puedesSolicitar: false,
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Tienes 2 cierres sin resolver y 1 de ellos no se ha enviado a aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Envía el que falta y espera a que la bodega apruebe el más antiguo, el del 21 de agosto.",
    );
    expect(
      screen.getByRole("button", { name: "Solicitar aprobación del cierre vencido" }),
    ).toBeEnabled();
  });

  it("271/caso 6: la fecha del aviso es la del cierre que espera a la BODEGA, no la del suyo", () => {
    // Las dos jornadas son distintas a propósito (21 el `solicitado`, 22 el `vencido`). La
    // aposición cuelga de «el más antiguo», que es el de la bodega: leerla del re-solicitable
    // nombraría el 22 y mandaría al mensajero a esperar por un cierre que ya es suyo.
    renderModule({
      bloqueo: bloqueoDe({
        n: 2,
        v: 1,
        jornadaCR: "2026-08-21",
        jornadaCRReenviable: "2026-08-22",
      }),
    });

    const aviso = screen.getByRole("alert");
    expect(aviso).toHaveTextContent("el más antiguo, el del 21 de agosto");
    expect(aviso).not.toHaveTextContent("22 de agosto");
  });

  it("271/caso 7 (N=2, V=2, dos rechazados): aparece el CTA del rechazado, que es SU clase", () => {
    renderModule({ bloqueo: bloqueoCaso7(), puedesSolicitar: false });

    expect(
      screen.getByRole("button", { name: "Solicitar aprobación del cierre rechazado" }),
    ).toBeEnabled();
    // Ni el del vencido —ese cierre no lo está— ni el neutro, que ya no existe.
    expect(
      screen.queryByRole("button", { name: "Solicitar aprobación del cierre vencido" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: CTA_NEUTRO_RETIRADO })).toBeNull();
  });

  it("271/caso 4: bloqueado por ACUMULAR (V=0) NO ofrece ningún botón de reenvío", () => {
    // `aReenviarPrimero` es `null`: sus dos cierres están enviados y no tiene nada que hacer.
    // Ofrecerle un botón sería mandarlo a buscar una acción que el servidor no tiene, y es la misma
    // razón por la que este caso es el único cuyo aviso no lleva llamado a la acción.
    renderModule({ bloqueo: bloqueoPorAcumular("2026-08-21"), puedesSolicitar: false });

    expect(screen.queryByRole("button", { name: CTA_NEUTRO_RETIRADO })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Solicitar aprobación del cierre vencido" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Solicitar aprobación del cierre rechazado" }),
    ).toBeNull();
  });

  it("271/casos 2 y 3: un solo cierre YA enviado (N=1, V=0) tampoco ofrece reenvío", () => {
    // Ni bloqueo ni botón: ese mensajero ya hizo lo suyo y espera al administrador.
    renderModule({ bloqueo: bloqueoDe({ n: 1, v: 0 }) });

    expect(screen.queryByRole("button", { name: CTA_NEUTRO_RETIRADO })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Solicitar aprobación del cierre vencido" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Solicitar aprobación del cierre rechazado" }),
    ).toBeNull();
  });

  it("271/caso 1: sin ningún cierre abierto no hay ni aviso ni botón de reenvío", () => {
    renderModule({ bloqueo: SIN_BLOQUEO });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: CTA_NEUTRO_RETIRADO })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Solicitar aprobación del cierre vencido" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Solicitar aprobación del cierre rechazado" }),
    ).toBeNull();
  });

  it("271/caso 6: al confirmar, el CTA nombrado invoca la MISMA action y da SU toast", async () => {
    const user = userEvent.setup();
    solicitarMock.mockResolvedValue({ status: "ok", via: "resolicitado" });
    renderModule({
      bloqueo: bloqueoDe({ n: 2, v: 1, jornadaCR: "2026-08-21" }),
      puedesSolicitar: false,
    });

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
    // El servidor devuelve `resolicitado` sin decir de qué clase (mueve el más viejo por EDAD,
    // R18); quien sabe qué acaba de pasar es el botón que se pulsó, y aquí ya sabe nombrarlo.
    await vi.waitFor(() =>
      expect(successMock).toHaveBeenCalledWith("Cierre vencido enviado a aprobación."),
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
    expect(within(panel).getAllByText("₡150")).toHaveLength(2);
    expect(
      within(screen.getByRole("region", { name: "Ganancia" })).getByText("₡1.500"),
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

/**
 * Feature 213 (T9) — el TERCER sitio de presentación del desglose: la celda «Método» de la
 * tabla del cierre del día. Los otros dos (la tabla del detalle compartido y el comprobante
 * tipo factura) tienen sus casos gemelos en `CierreDetallePagos.test.tsx`; los tres afirman
 * lo mismo, porque los tres leen del MISMO formateador.
 */
describe("Feature 213 — desglose de pago en la tabla del cierre del día", () => {
  /**
   * Texto de la celda «Método» de la primera fila, localizada por el ÍNDICE de su cabecera:
   * así el caso no depende de la posición de la columna y el "—" no se confunde con el de
   * otra celda de la misma fila.
   */
  function celdaMetodo(): string {
    const region = screen.getByRole("region", { name: "Entregadas" });
    const tabla = within(region).getByRole("table");
    const encabezados = within(tabla)
      .getAllByRole("columnheader")
      .map((th) => th.textContent?.trim() ?? "");
    const indice = encabezados.indexOf("Método");
    expect(indice).toBeGreaterThanOrEqual(0);
    const celdas = within(within(tabla).getAllByRole("row")[1]).getAllByRole("cell");
    return celdas[indice].textContent?.trim() ?? "";
  }

  function renderEntrega(over: Partial<CierreDetalleGestion>) {
    const grupos = emptyGrupos();
    grupos.entregada = [
      makeGestion({
        gestionId: "g1",
        resultado: "entregada",
        numRemision: "REM-ENT",
        montoRecibido: "8000.00",
        ...over,
      }),
    ];
    renderModule({ grupos });
  }

  it("R20: una sola línea se ve EXACTAMENTE igual que antes: la etiqueta a secas, sin monto", () => {
    renderEntrega({ pagos: [{ metodo: "SINPE", monto: "8000.00" }] });

    expect(celdaMetodo()).toBe("SINPE");
  });

  it("R21: dos líneas se ven las DOS, cada una con su monto en la moneda de configuración", () => {
    renderEntrega({
      pagos: [
        { metodo: "efectivo", monto: "5000.00" },
        { metodo: "transferencia", monto: "3000.00" },
      ],
    });

    expect(celdaMetodo()).toBe("Efectivo ₡5.000 + Transferencia ₡3.000");
  });

  it("R22/R23: sin líneas la celda sigue siendo «—», aunque la gestión traiga el escalar", () => {
    // El escalar sigue vivo en el DTO (R32): si la celda lo leyera, aquí diría «SINPE».
    renderEntrega({ metodoPago: "SINPE", pagos: [] });

    expect(celdaMetodo()).toBe("—");
  });

  it("R24: se pinta el ORDEN del DTO, no el alfabético", () => {
    // Alfabéticamente sería Efectivo, SINPE, Transferencia; el DTO las manda al revés.
    renderEntrega({
      pagos: [
        { metodo: "transferencia", monto: "3000.00" },
        { metodo: "SINPE", monto: "2000.00" },
        { metodo: "efectivo", monto: "3000.00" },
      ],
    });

    expect(celdaMetodo()).toBe(
      "Transferencia ₡3.000 + SINPE ₡2.000 + Efectivo ₡3.000",
    );
  });

  it("R25: la etiqueta sale de METODO_LABEL (mutarla cambia lo pintado)", () => {
    const original = METODO_LABEL.SINPE;
    try {
      METODO_LABEL.SINPE = "SINPE-MUTADO";
      renderEntrega({ pagos: [{ metodo: "SINPE", monto: "8000.00" }] });
      expect(celdaMetodo()).toBe("SINPE-MUTADO");
    } finally {
      METODO_LABEL.SINPE = original;
    }
  });
});

// =================================================================================================
// FEATURE 237 (T7.5 — R41, D6) — LA FILA DICE QUIEN REGISTRO LA GESTION.
// =================================================================================================
//
// **Lo que protege.** Desde la 237 la TIENDA puede resolver una orden que sigue en la moto del
// mensajero, y esa gestion se le atribuye a el: entra en este cierre, suma un intento y mueve el
// mismo dinero. Sin la marca, el mensajero firma su cierre con una gestion que no hizo y una
// evidencia que no subio, y no puede explicarla si le preguntan. La orden ya desaparecio de su
// portal (R40), asi que esta pantalla es el UNICO sitio donde la vuelve a ver.
//
// ⚠️ EL PAR PRESENCIA / AUSENCIA VA EN LA MISMA TABLA, y es deliberado: una marca que aparece en
// TODAS las filas pasa igual de verde que una que no aparece en ninguna. Los dos casos que se
// afirman aqui viven sobre el MISMO render, asi que uno no puede estar bien y el otro vacio.
//
// ⚠️ LOS TEXTOS, ESCRITOS A MANO. No se importan `GESTION_TIENDA_BADGE_LABEL` ni `..._NOTA`:
// comparar un texto con la constante que lo genera esta siempre verde, y en esta misma rama se
// arreglaron dos avisos que mentian exactamente por eso.
describe("Cierre del día — 237/R41: la gestión que registró la tienda va marcada", () => {
  /** La `<tr>` que contiene ese número de guía. */
  function filaDeGuia(guia: string): HTMLElement {
    const fila = screen.getByText(guia).closest("tr");
    expect(fila, `no hay ninguna fila con la guía ${guia}`).not.toBeNull();
    return fila as HTMLElement;
  }

  /** Dos rechazos en la MISMA sección: uno de la tienda (5555) y uno del mensajero (7777). */
  function renderConLasDos() {
    const grupos = emptyGrupos();
    grupos.rechazada = [
      makeGestion({
        gestionId: "g-tienda",
        resultado: "rechazada",
        numGuia: 5555,
        numRemision: "REM-TIENDA",
        desdeAyudaTienda: true,
      }),
      makeGestion({
        gestionId: "g-mensajero",
        resultado: "rechazada",
        numGuia: 7777,
        numRemision: "REM-MENSAJERO",
        desdeAyudaTienda: false,
      }),
    ];
    renderModule({ grupos });
  }

  it("la fila de la TIENDA lleva la marca y la del MENSAJERO no (el par, en la misma tabla)", () => {
    renderConLasDos();

    // Presencia: dice QUIÉN, no sólo que la fila es distinta.
    expect(within(filaDeGuia("5555")).getByText("La tienda")).toBeInTheDocument();
    // Ausencia: y su significado es «la registraste vos», no «no lo sé» — el DTO trae el campo
    // obligatorio y derivado del historial, que nace en la misma transacción que la gestión.
    expect(within(filaDeGuia("7777")).queryByText("La tienda")).toBeNull();
  });

  it("la marca trae su nota accesible, que es lo que le deja explicarla si le preguntan", () => {
    renderConLasDos();
    const marca = within(filaDeGuia("5555")).getByText("La tienda");

    // El literal completo, a mano. Dice desde dónde se hizo, que el motivo y la foto no son suyos,
    // y que aun así cuenta en su cierre: las tres cosas que necesita para responder.
    const NOTA =
      "Esta gestión la registró la tienda desde «Ayuda solicitada», no vos: el motivo y la foto son suyos. Cuenta en tu cierre igual.";
    expect(marca).toHaveAttribute("title", NOTA);
    // `title` es sólo para el puntero: quien navega con lector de pantalla —o desde un móvil, donde
    // no hay hover— necesita el nombre en el propio control.
    expect(marca).toHaveAttribute("aria-label", NOTA);
  });

  it("la nota nombra las tres cosas: quién, con qué evidencia y que cuenta igual", () => {
    // Anti-degradación: un «Registrada por la tienda» seco pasaría el caso de arriba si alguien
    // acortara el texto, pero no éste. Lo que no puede perderse es que la evidencia no es suya y
    // que el cierre la incluye de todos modos — es lo que hace que la marca sirva de algo.
    renderConLasDos();
    const nota = within(filaDeGuia("5555"))
      .getByText("La tienda")
      .getAttribute("title") as string;

    expect(nota).toContain("Ayuda solicitada");
    expect(nota).toContain("el motivo y la foto son suyos");
    expect(nota).toContain("Cuenta en tu cierre igual");
  });

  it("la marca NO se come la guía: el número sigue ahí", () => {
    // El badge cuelga del número, que es el identificador con el que el mensajero busca el paquete.
    // Si lo sustituyera, la marca costaría más de lo que informa.
    renderConLasDos();
    const fila = filaDeGuia("5555");

    expect(within(fila).getByText("5555")).toBeInTheDocument();
    expect(within(fila).getByText("REM-TIENDA")).toBeInTheDocument();
  });

  it("vale para los DOS desenlaces que la tienda puede registrar, no sólo para el rechazo", () => {
    // La 237 declaró dos aristas desde `ayuda_tienda`: `reprogramada` y `rechazada`. Marcar sólo
    // una dejaría la mitad de las gestiones de la tienda indistinguibles de las del mensajero.
    const grupos = emptyGrupos();
    grupos.reprogramada = [
      makeGestion({
        gestionId: "g-repro-tienda",
        resultado: "reprogramada",
        numGuia: 4444,
        desdeAyudaTienda: true,
      }),
    ];
    grupos.entregada = [
      // El contraste: una entrega NUNCA puede venir de la tienda (no hay arista), y aquí se ve.
      makeGestion({
        gestionId: "g-entrega",
        resultado: "entregada",
        numGuia: 3333,
        desdeAyudaTienda: false,
      }),
    ];
    renderModule({ grupos });

    expect(within(filaDeGuia("4444")).getByText("La tienda")).toBeInTheDocument();
    expect(within(filaDeGuia("3333")).queryByText("La tienda")).toBeNull();
  });
});

// =================================================================================================
// FEATURE 237 (D3/R38) — «DEVOLVER A GESTION» NO SE OFRECE SOBRE LA GESTION DE LA TIENDA.
// =================================================================================================
//
// **El defecto que cierra, y de donde salio.** Lo encontro el recorrido con la app del 2026-08-20,
// no la suite: el boton salia HABILITADO en la fila de la tienda, abria su modal —que promete «la
// orden volvera a tu lista para gestionar»— y el servidor lo rechazaba. Un boton que SIEMPRE falla,
// detras de un modal que afirma lo que no va a pasar.
//
// ⚠️ EL PAR VA EN LA MISMA TABLA: una accion que nunca esta disponible pasa igual de verde que una
// que siempre lo esta. Los dos casos viven sobre el MISMO render.
//
// ⚠️ LOS TEXTOS, A MANO. No se importa `DESHACER_BLOQUEO_TIENDA`: compararlo con la constante que
// lo genera estaria siempre verde.
describe("Cierre del día — 237/D3: la gestión de la tienda no se puede devolver a gestión", () => {
  /** El motivo, escrito a mano. Es el MISMO que devuelve el servidor si se llega por otra vía. */
  const MOTIVO =
    "Esta orden la resolvió la tienda desde su pantalla de ayuda; solo ella puede corregirlo. Escribile por el chat de la orden.";

  /** La `<tr>` que contiene ese número de guía. */
  function fila(guia: string): HTMLElement {
    const tr = screen.getByText(guia).closest("tr");
    expect(tr, `no hay ninguna fila con la guía ${guia}`).not.toBeNull();
    return tr as HTMLElement;
  }

  /** El botón de acciones de esa fila, sea cual sea su nombre accesible. */
  function botonDeshacer(guia: string): HTMLElement {
    return within(fila(guia)).getByRole("button", { name: /^Devolver a gestión/ });
  }

  /** Dos rechazos en la MISMA sección: uno de la tienda (5555) y uno del mensajero (7777). */
  function renderConLasDos() {
    const grupos = emptyGrupos();
    grupos.rechazada = [
      makeGestion({
        gestionId: "g-tienda",
        resultado: "rechazada",
        numGuia: 5555,
        numRemision: "REM-TIENDA",
        desdeAyudaTienda: true,
      }),
      makeGestion({
        gestionId: "g-mensajero",
        resultado: "rechazada",
        numGuia: 7777,
        numRemision: "REM-MENSAJERO",
        desdeAyudaTienda: false,
      }),
    ];
    renderModule({ grupos });
  }

  it("la fila de la TIENDA lo tiene bloqueado y la del MENSAJERO no (el par, misma tabla)", () => {
    renderConLasDos();

    expect(botonDeshacer("5555")).toBeDisabled();
    // El par: sin esto, «está deshabilitado» pasaría igual con la columna entera apagada, que es
    // otro defecto —y peor: le quitaría al mensajero el deshacer de TODAS sus gestiones—.
    expect(botonDeshacer("7777")).toBeEnabled();
  });

  it("y dice POR QUÉ: el motivo va en el `title` y también en el nombre accesible", () => {
    renderConLasDos();
    const boton = botonDeshacer("5555");

    expect(boton).toHaveAttribute("title", MOTIVO);
    // En el NOMBRE y no sólo en el `title`: un botón `disabled` sale del orden de tabulación, así
    // que su tooltip es inalcanzable con el teclado. Quien navega con lector de pantalla lo lee al
    // recorrer la tabla.
    const nombre = boton.getAttribute("aria-label") as string;
    expect(nombre).toContain("no disponible");
    expect(nombre).toContain(MOTIVO);
    // Y sigue diciendo QUÉ ES y sobre QUÉ orden: el motivo se suma al nombre, no lo sustituye.
    expect(nombre).toContain("Devolver a gestión la orden REM-TIENDA");
  });

  it("el motivo es ACCIONABLE: dice a quién acudir, no un «no se puede» a secas", () => {
    // Anti-degradación. Un «No podés deshacer esta gestión.» pasaría los dos casos de arriba, y
    // dejaría al mensajero con un botón apagado y ninguna salida.
    renderConLasDos();
    const titulo = botonDeshacer("5555").getAttribute("title") as string;

    expect(titulo).toContain("la resolvió la tienda");
    expect(titulo).toContain("Escribile por el chat de la orden");
  });

  it("pulsarlo NO abre el modal que promete devolver la orden, ni llama al servidor", async () => {
    const user = userEvent.setup();
    renderConLasDos();

    await user.click(botonDeshacer("5555"));

    // El modal es el que afirma «la orden volverá a tu lista para gestionar»: sobre esta fila esa
    // frase es falsa, y no llegar a enseñarla es el punto entero de la tanda.
    expect(screen.queryByRole("dialog", { name: "Devolver la orden a gestión" })).toBeNull();
    expect(deshacerMock).not.toHaveBeenCalled();

    // El par: el mismo gesto sobre la fila del mensajero SÍ abre el modal. Sin esto, «no se abre»
    // pasaría igual con el modal roto para todas las filas.
    await user.click(botonDeshacer("7777"));
    expect(
      await screen.findByRole("dialog", { name: "Devolver la orden a gestión" }),
    ).toBeInTheDocument();
  });

  it("RED DE SEGURIDAD: si se llegara a enviar, el motivo del servidor se muestra tal cual", async () => {
    // Contesta la pregunta del recorrido: ¿el mensajero se entera cuando el servidor rechaza? SÍ —
    // `confirmarDeshacer` pinta el `motivo` del `conflict` sin reescribirlo (67/R38). Hoy ese
    // camino ya no es alcanzable desde esta pantalla (el botón está apagado), y por eso este caso
    // se monta sobre una fila NORMAL con la respuesta de D3 forzada: lo que afirma es que la
    // pantalla no se come el mensaje, no que el botón siga ofreciéndose.
    deshacerMock.mockResolvedValue({ status: "conflict", motivo: MOTIVO });
    const user = userEvent.setup();
    renderConLasDos();

    await user.click(botonDeshacer("7777"));
    const dialog = await screen.findByRole("dialog", { name: "Devolver la orden a gestión" });
    await user.click(within(dialog).getByRole("button", { name: "Devolver a gestión" }));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalledWith(MOTIVO));
    expect(successMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
