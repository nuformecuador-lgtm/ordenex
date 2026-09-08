// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { CierresAdminModule } from "@/app/(app)/cierres-admin/_components/CierresAdminModule";
import { CorregirResultadoDialog } from "@/app/(app)/cierres-admin/_components/CorregirResultadoDialog";
import {
  CierreFacturaDetalle,
  type CierreFacturaCabecera,
} from "@/app/(app)/cierres-admin/_components/cierre-factura";
import {
  corregirResultadoGestion,
  verCierreDetalle,
  listarHistoricoCierresAdminPaginado,
  listarPendientesCierresAdminPaginado,
} from "@/lib/actions/cierres-admin";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreResultado,
  TotalesIngresoOrdenex,
} from "@/lib/interfaces/services/ICierreDiaService";
import type { CierreEstado } from "@/lib/types/cierre";

/**
 * 💰 FICHA 398 (R16) — LA PANTALLA de la corrección del RESULTADO de una gestión.
 *
 * El caso que la obliga a existir: un mensajero marcó `entregada` una orden que fue rechazada y
 * ya había solicitado el cierre. El 2026-09-08 hubo que arreglarlo A MANO en la base de
 * producción porque esta pantalla no existía.
 *
 * Lo que el servidor ya cubre NO se repite aquí: el rol, el alcance, el estado del cierre, el
 * resultado vigente, el motivo y los seis totales viven en
 * `tests/unit/services/cierres-admin-corregir-resultado.test.ts` y en
 * `tests/integration/db/correccion-resultado-gestion.int.test.ts` (15 de los 16 requisitos). Aquí
 * se afirma lo ÚNICO que sólo se ve montando la pantalla, y que se rompe en silencio:
 *
 *   1. DÓNDE se ofrece (R16): sólo sobre una gestión `entregada`, y sólo en el detalle de un
 *      cierre ABIERTO (`solicitado`/`vencido`) de quien tiene permiso. Nunca en un `aprobado`
 *      —que es el único estado en el que un cierre puede estar consolidado— ni en un `rechazado`.
 *   2. QUÉ viaja: dos claves, `gestionId` y `motivo`. El nuevo resultado NO se manda: el borde es
 *      `.strict()` y lo rechazaría.
 *   3. Que sin motivo NO se puede pulsar: es lo que queda escrito para explicar por qué cambió el
 *      dinero de un cierre.
 *   4. Que los cuatro totales que se pintan al terminar son LOS DE LA RESPUESTA, verbatim: el
 *      navegador no los suma, no los resta y no los convierte a número.
 */

vi.mock("@/lib/actions/cierres-admin", () => ({
  corregirResultadoGestion: vi.fn(),
  // Las que monta el módulo entero (parte 2 de este archivo). Ninguna aserción depende de ellas
  // más allá de abrir el detalle.
  verCierreDetalle: vi.fn(),
  aprobarCierre: vi.fn(),
  rechazarCierre: vi.fn(),
  forzarSolicitudVencido: vi.fn(),
  listarHistoricoCierresAdminPaginado: vi.fn(),
  listarPendientesCierresAdminPaginado: vi.fn(),
  listarGestionesCierresAdminCompleto: vi.fn(),
  listarPendientesCierresAdminCompleto: vi.fn(),
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
  usePathname: () => "/cierres-admin",
  useSearchParams: () => new URLSearchParams(),
}));

const accionMock = vi.mocked(corregirResultadoGestion);
const verDetalleMock = vi.mocked(verCierreDetalle);
const historicoPaginadoMock = vi.mocked(listarHistoricoCierresAdminPaginado);
const pendientesPaginadoMock = vi.mocked(listarPendientesCierresAdminPaginado);

/**
 * Los totales que devuelve el SERVIDOR tras corregir. No coinciden con nada que el navegador
 * pueda derivar de la gestión corregida —él sólo conoce ESA gestión, no las otras del cierre—, y
 * ése es justamente el punto: se pintan porque llegan, no porque se calculen.
 */
const TOTALES_TRAS_CORREGIR = {
  efectivo: "12500.00",
  simpe: "3400.50",
  transferencia: "0.00",
  general: "15900.50",
};

/** El motivo real que se escribió a mano en producción el 2026-09-08. */
const MOTIVO_REAL = "Corrección desde la central por error del mensajero";

function gestion(over: Partial<CierreDetalleGestion> = {}): CierreDetalleGestion {
  return {
    gestionId: "g1",
    ordenId: "o1",
    fechaGestion: "2026-09-07",
    numGuia: 1001,
    numRemision: "REM-001",
    destinatario: "Ana Pérez",
    direccion: "Calle 1",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    producto: "Caja",
    tiendaNombre: "Tienda X",
    resultado: "entregada",
    montoRecibido: "8000.00",
    metodoPago: null,
    pagos: [{ metodo: "efectivo", monto: "8000.00" }],
    motivo: null,
    fechaReprogramacion: null,
    evidenciaUrl: null,
    pagoMensajero: "1500.00",
    ingresoBodegaRechazo: null,
    tarifaFaltante: false,
    esRechazoSla: false,
    desdeAyudaTienda: false,
    causaIncidente: null,
    indemnizacion: null,
    ...over,
  };
}

function grupos(g: CierreDetalleGestion): CierreGrupos {
  const vacios: Record<CierreResultado, CierreDetalleGestion[]> = {
    entregada: [],
    reprogramada: [],
    devuelta: [],
    rechazada: [],
    incidente: [],
  };
  return { ...vacios, [g.resultado]: [g] };
}

const CABECERA: CierreFacturaCabecera = {
  cierreId: "c1",
  estado: "solicitado",
  destinoTipo: "bodega_central",
  destinoZonaNombre: "GAM",
  totales: {
    efectivo: "8000.00",
    simpe: "0.00",
    transferencia: "0.00",
    general: "8000.00",
  },
  totalPagoMensajero: "1500.00",
  totalIngresoBodegaRechazos: "0.00",
  solicitadoAt: "2026-09-07T10:00:00.000Z",
  resueltoAt: null,
  motivoRechazo: null,
};

const BOTON_CORREGIR = "Corregir el resultado de la orden REM-001 · Ana Pérez";
const BOTON_CONFIRMAR = "Marcar como rechazada";

/** Despliega el renglón de la orden en el comprobante, que es donde vive el acceso. */
async function abrirRenglon(
  g: CierreDetalleGestion,
  onCorregirResultado?: (g: CierreDetalleGestion) => void,
) {
  const user = userEvent.setup();
  render(
    <CierreFacturaDetalle
      cierre={CABECERA}
      grupos={grupos(g)}
      onCorregirResultado={onCorregirResultado}
    />,
  );
  await user.click(
    screen.getByRole("button", {
      name: `Detalle de la orden ${g.numRemision} · ${g.destinatario}`,
    }),
  );
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  accionMock.mockResolvedValue({
    status: "ok",
    gestionId: "g1",
    totales: TOTALES_TRAS_CORREGIR,
  });
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// 1. R16 — dónde se ofrece, en la FILA
// ---------------------------------------------------------------------------

describe("R16 — la corrección se ofrece sobre una gestión `entregada`, y sólo sobre ella", () => {
  it("en una entrega, cuando el padre lo autoriza", async () => {
    await abrirRenglon(gestion(), vi.fn());
    expect(screen.getByRole("button", { name: BOTON_CORREGIR })).toBeInTheDocument();
  });

  it("también en una entrega SIN cobro: lo que se corrige es el resultado, no el dinero", async () => {
    // Diferencia deliberada con la corrección del desglose, que sí exige líneas de pago: una
    // entrega declarada sin dinero también puede no haber ocurrido, y el servidor sólo mira el
    // `resultado` (R4).
    await abrirRenglon(gestion({ montoRecibido: "0.00", pagos: [] }), vi.fn());
    expect(screen.getByRole("button", { name: BOTON_CORREGIR })).toBeInTheDocument();
  });

  it("sobre una gestión YA rechazada NO se ofrece: no hay entrega que corregir", async () => {
    await abrirRenglon(
      gestion({
        resultado: "rechazada",
        montoRecibido: null,
        pagos: [],
        motivo: "Cliente ausente",
        pagoMensajero: "0.00",
        ingresoBodegaRechazo: "700.00",
      }),
      vi.fn(),
    );
    expect(screen.queryByRole("button", { name: BOTON_CORREGIR })).toBeNull();
  });

  it("sobre una devuelta, una reprogramada o un incidente tampoco", async () => {
    for (const resultado of ["devuelta", "reprogramada", "incidente"] as const) {
      await abrirRenglon(
        gestion({ resultado, montoRecibido: null, pagos: [], motivo: "Nadie" }),
        vi.fn(),
      );
      expect(screen.queryByRole("button", { name: BOTON_CORREGIR })).toBeNull();
      cleanup();
    }
  });

  it("sin autorización del padre NO se ofrece: la hoja es de solo lectura", async () => {
    // Es el caso del cierre ya resuelto, el del rol que no corrige y el de la vista del
    // mensajero: los tres llegan aquí como «sin callback».
    await abrirRenglon(gestion(), undefined);
    expect(screen.queryByRole("button", { name: BOTON_CORREGIR })).toBeNull();
  });

  it("pulsarlo abre la corrección de ESA gestión", async () => {
    const onCorregir = vi.fn();
    const user = await abrirRenglon(gestion(), onCorregir);
    await user.click(screen.getByRole("button", { name: BOTON_CORREGIR }));
    expect(onCorregir).toHaveBeenCalledWith(expect.objectContaining({ gestionId: "g1" }));
  });
});

// ---------------------------------------------------------------------------
// 2. R16 — dónde se ofrece, en el MÓDULO: sólo desde un cierre ABIERTO
// ---------------------------------------------------------------------------

function makeResumen(over: Partial<CierreAdminResumen> & { cierreId: string }): CierreAdminResumen {
  return {
    mensajeroId: `m-${over.cierreId}`,
    mensajeroNombre: "Ana Mensajera",
    estado: "solicitado",
    destinoTipo: "bodega_central",
    destinoZonaId: "z1",
    destinoZonaNombre: "GAM",
    totales: CABECERA.totales,
    totalPagoMensajero: "1500.00",
    totalIngresoBodegaRechazos: "0.00",
    pendientePagoMensajero: null,
    solicitadoAt: "2026-09-07T10:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
    ...over,
  };
}

function zeroIngreso(): TotalesIngresoOrdenex {
  return {
    montoCobrar: "0.00",
    fleteConIva: "0.00",
    fleteDevolucionConIva: "0.00",
    comisionConIva: "0.00",
    total: "0.00",
    flete: "0.00",
    ivaFlete: "0.00",
    fleteDevolucion: "0.00",
    ivaFleteDevolucion: "0.00",
    comisionCod: "0.00",
    ivaComisionCod: "0.00",
  };
}

/**
 * Monta la pantalla completa con UN cierre en el estado que se quiere probar y su detalle ya
 * programado, y abre ese detalle por el gesto real: la tarjeta de la cola si sigue pendiente, la
 * de la pestaña «Resueltos» si ya está resuelto.
 */
async function abrirDetalleDelModulo(opciones: {
  estado: CierreEstado;
  puedeCorregirResultado?: boolean;
  g?: CierreDetalleGestion;
}) {
  const user = userEvent.setup();
  const resuelto = opciones.estado === "aprobado" || opciones.estado === "rechazado";
  const cierre = makeResumen({
    cierreId: "c1",
    estado: opciones.estado,
    resueltoAt: resuelto ? "2026-09-08T08:00:00.000Z" : null,
  });
  const g = opciones.g ?? gestion();

  verDetalleMock.mockResolvedValue({
    status: "ok",
    cierre,
    grupos: grupos(g),
    totalesIngreso: zeroIngreso(),
    desgloseIngresoBodegaRechazos: { sla: "0.00", manual: "0.00", total: "0.00" },
    ganancia: "0.00",
    pagoTienda: "0.00",
    cobradoSobreRecaudado: "0.00",
    netoOrdenex: "0.00",
    ganaLaTienda: "0.00",
    fleteRechazoYaCobradoATienda: false,
    ordenesSinGestion: [],
    sinGestionRegistrado: true,
  });

  const cola = paginaInicial(resuelto ? [] : [cierre]);
  const historico = paginaInicial(resuelto ? [cierre] : []);
  pendientesPaginadoMock.mockResolvedValue({ status: "ok", page: 1, ...cola });
  historicoPaginadoMock.mockResolvedValue({ status: "ok", page: 1, ...historico });

  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <CierresAdminModule
        pendientes={cola}
        historico={historico}
        sinZona={false}
        puedeCorregirResultado={opciones.puedeCorregirResultado ?? true}
      />
    </SWRConfig>,
  );

  if (resuelto) {
    await user.click(screen.getByRole("button", { name: /^Resueltos/ }));
    await user.click(
      screen.getByRole("button", { name: "Ver el cierre resuelto de Ana Mensajera" }),
    );
  } else if (opciones.estado === "vencido") {
    // Feature 111/R15: un `vencido` de la cola no es resoluble por la vía normal, así que su
    // tarjeta ofrece «Ver» (y la válvula de escape) en vez de «Ver / decidir». El detalle que
    // abre es el mismo.
    await user.click(screen.getByRole("button", { name: "Ver el cierre de Ana Mensajera" }));
  } else {
    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
  }

  const dialogo = await screen.findByRole("dialog", { name: "Detalle del cierre" });
  await user.click(
    within(dialogo).getByRole("button", {
      name: new RegExp(
        `(Desglose de ingreso|Detalle) de la orden ${g.numRemision} · ${g.destinatario}`,
      ),
    }),
  );
  return { user, dialogo };
}

describe("R16 — la corrección se ofrece únicamente desde el detalle de un cierre ABIERTO", () => {
  it("en un cierre `solicitado`", async () => {
    const { dialogo } = await abrirDetalleDelModulo({ estado: "solicitado" });
    expect(
      within(dialogo).getByRole("button", { name: BOTON_CORREGIR }),
    ).toBeInTheDocument();
  });

  it("y en un `vencido`, que es un cierre abierto que el mensajero nunca solicitó", async () => {
    const { dialogo } = await abrirDetalleDelModulo({ estado: "vencido" });
    expect(
      within(dialogo).getByRole("button", { name: BOTON_CORREGIR }),
    ).toBeInTheDocument();
  });

  it("💰 en un cierre APROBADO no, y ése es el único estado en el que puede estar consolidado", async () => {
    // La consolidación en un `cierre_bodega` sólo toma cierres `aprobado`, así que exigir
    // `solicitado`/`vencido` cubre por construcción el «no consolidado». Si esta pantalla lo
    // ofreciera, el admin pulsaría un botón sobre dinero ya consolidado.
    const { dialogo } = await abrirDetalleDelModulo({ estado: "aprobado" });
    expect(within(dialogo).queryByRole("button", { name: BOTON_CORREGIR })).toBeNull();
  });

  it("en un cierre RECHAZADO tampoco: su vía es que el mensajero lo re-solicite", async () => {
    const { dialogo } = await abrirDetalleDelModulo({ estado: "rechazado" });
    expect(within(dialogo).queryByRole("button", { name: BOTON_CORREGIR })).toBeNull();
  });

  it("sin el permiso del servidor no se ofrece ni en un cierre abierto (falla cerrado)", async () => {
    const { dialogo } = await abrirDetalleDelModulo({
      estado: "solicitado",
      puedeCorregirResultado: false,
    });
    expect(within(dialogo).queryByRole("button", { name: BOTON_CORREGIR })).toBeNull();
  });

  it("un montaje que se OLVIDE de pasar el permiso tampoco lo ofrece", async () => {
    // El default de la prop es `false`: la pantalla no se lo ofrece a nadie en vez de
    // ofrecérselo a todos.
    const user = userEvent.setup();
    const cierre = makeResumen({ cierreId: "c1", estado: "solicitado" });
    verDetalleMock.mockResolvedValue({
      status: "ok",
      cierre,
      grupos: grupos(gestion()),
      totalesIngreso: zeroIngreso(),
      desgloseIngresoBodegaRechazos: { sla: "0.00", manual: "0.00", total: "0.00" },
      ganancia: "0.00",
      pagoTienda: "0.00",
      cobradoSobreRecaudado: "0.00",
      netoOrdenex: "0.00",
      ganaLaTienda: "0.00",
      fleteRechazoYaCobradoATienda: false,
      ordenesSinGestion: [],
      sinGestionRegistrado: true,
    });
    const cola = paginaInicial([cierre]);
    const historico = paginaInicial<CierreAdminResumen>([]);
    pendientesPaginadoMock.mockResolvedValue({ status: "ok", page: 1, ...cola });
    historicoPaginadoMock.mockResolvedValue({ status: "ok", page: 1, ...historico });

    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <CierresAdminModule pendientes={cola} historico={historico} sinZona={false} />
      </SWRConfig>,
    );

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const dialogo = await screen.findByRole("dialog", { name: "Detalle del cierre" });
    await user.click(
      within(dialogo).getByRole("button", {
        name: /(Desglose de ingreso|Detalle) de la orden REM-001 · Ana Pérez/,
      }),
    );
    expect(within(dialogo).queryByRole("button", { name: BOTON_CORREGIR })).toBeNull();
  });

  it("pulsarlo abre el diálogo de la corrección con la orden nombrada", async () => {
    const { user, dialogo } = await abrirDetalleDelModulo({ estado: "solicitado" });
    await user.click(within(dialogo).getByRole("button", { name: BOTON_CORREGIR }));

    const correccion = await screen.findByRole("dialog", {
      name: "Corregir el resultado de la entrega",
    });
    expect(correccion).toHaveTextContent("Orden REM-001 · Ana Pérez");
  });
});

// ---------------------------------------------------------------------------
// 3. El diálogo
// ---------------------------------------------------------------------------

describe("el diálogo de la corrección", () => {
  function renderDialogo(
    g: CierreDetalleGestion | null,
    onCorregido: () => void | Promise<void> = vi.fn(),
  ) {
    return render(
      <CorregirResultadoDialog
        gestion={g}
        onOpenChange={vi.fn()}
        onCorregido={onCorregido}
      />,
    );
  }

  it("dice EN CLARO las tres cosas que van a pasar", () => {
    renderDialogo(gestion());
    const aviso = screen.getByRole("region", { name: "Al corregir:" });
    expect(aviso).toHaveTextContent("El cobro registrado de esa entrega desaparece del cierre.");
    expect(aviso).toHaveTextContent("El pago al mensajero por esa entrega pasa a cero.");
    expect(aviso).toHaveTextContent(
      "El paquete se tratará como una devolución al aprobar el cierre.",
    );
  });

  it("💰 SIN MOTIVO no se puede confirmar, y no viaja nada", async () => {
    const user = userEvent.setup();
    renderDialogo(gestion());

    expect(screen.getByRole("button", { name: BOTON_CONFIRMAR })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: BOTON_CONFIRMAR }));
    expect(accionMock).not.toHaveBeenCalled();
  });

  it("💰 un motivo de solo espacios tampoco cuenta como motivo", async () => {
    const user = userEvent.setup();
    renderDialogo(gestion());

    await user.type(screen.getByLabelText("Motivo de la corrección"), "    ");

    expect(screen.getByRole("button", { name: BOTON_CONFIRMAR })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: BOTON_CONFIRMAR }));
    expect(accionMock).not.toHaveBeenCalled();
  });

  it("con el motivo escrito envía DOS claves: la gestión y el motivo, nunca el resultado", async () => {
    const user = userEvent.setup();
    const onCorregido = vi.fn();
    renderDialogo(gestion(), onCorregido);

    await user.type(screen.getByLabelText("Motivo de la corrección"), MOTIVO_REAL);
    await user.click(screen.getByRole("button", { name: BOTON_CONFIRMAR }));

    await waitFor(() => expect(accionMock).toHaveBeenCalledTimes(1));
    const enviado = accionMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(enviado).toEqual({ gestionId: "g1", motivo: MOTIVO_REAL });
    // El borde es `.strict()`: colar el destino sería un `validation_error`, no una corrección.
    expect(Object.keys(enviado).sort()).toEqual(["gestionId", "motivo"]);
    await waitFor(() => expect(onCorregido).toHaveBeenCalledTimes(1));
  });

  it("💰 pinta los CUATRO totales que devolvió el servidor, tal cual llegaron", async () => {
    const user = userEvent.setup();
    renderDialogo(gestion());

    await user.type(screen.getByLabelText("Motivo de la corrección"), MOTIVO_REAL);
    await user.click(screen.getByRole("button", { name: BOTON_CONFIRMAR }));

    const panel = await screen.findByRole("region", {
      name: "Totales del cierre tras la corrección",
    });
    // Los cuatro, con el formato de dinero de la app y sin una sola operación en el navegador:
    // ninguno de estos números se puede derivar de la gestión que se acaba de corregir.
    expect(within(panel).getByText("₡12.500")).toBeInTheDocument();
    expect(within(panel).getByText("₡3.400,50")).toBeInTheDocument();
    expect(within(panel).getByText("₡0")).toBeInTheDocument();
    expect(within(panel).getByText("₡15.900,50")).toBeInTheDocument();
    // Y el editor del motivo ya no está: lo aplicado no se vuelve a aplicar.
    expect(screen.queryByLabelText("Motivo de la corrección")).toBeNull();
  });

  it("si el cierre dejó de estar abierto mientras corregías, lo dice y NO relee el detalle", async () => {
    accionMock.mockResolvedValue({ status: "conflict" });
    const user = userEvent.setup();
    const onCorregido = vi.fn();
    renderDialogo(gestion(), onCorregido);

    await user.type(screen.getByLabelText("Motivo de la corrección"), MOTIVO_REAL);
    await user.click(screen.getByRole("button", { name: BOTON_CONFIRMAR }));

    expect(
      await screen.findByText(
        "El cierre dejó de estar abierto mientras corregías: recarga el detalle para ver su estado.",
      ),
    ).toBeInTheDocument();
    expect(onCorregido).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("region", { name: "Totales del cierre tras la corrección" }),
    ).toBeNull();
  });

  it("un `forbidden` del servidor se dice con palabras y no se pinta ningún total", async () => {
    accionMock.mockResolvedValue({ status: "forbidden" });
    const user = userEvent.setup();
    renderDialogo(gestion());

    await user.type(screen.getByLabelText("Motivo de la corrección"), MOTIVO_REAL);
    await user.click(screen.getByRole("button", { name: BOTON_CONFIRMAR }));

    expect(
      await screen.findByText("No tienes permiso para corregir el resultado de una gestión."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Totales del cierre tras la corrección" }),
    ).toBeNull();
  });

  it("un `validation_error` del campo `resultado` se pinta con el texto del servidor", async () => {
    accionMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { resultado: ["solo una gestion entregada se puede corregir"] },
    });
    const user = userEvent.setup();
    renderDialogo(gestion());

    await user.type(screen.getByLabelText("Motivo de la corrección"), MOTIVO_REAL);
    await user.click(screen.getByRole("button", { name: BOTON_CONFIRMAR }));

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("solo una gestion entregada se puede corregir");
  });

  it("al abrir con OTRA gestión arranca limpio: sin el motivo ni los totales de la anterior", async () => {
    const user = userEvent.setup();
    const { rerender } = renderDialogo(gestion());

    await user.type(screen.getByLabelText("Motivo de la corrección"), MOTIVO_REAL);
    await user.click(screen.getByRole("button", { name: BOTON_CONFIRMAR }));
    await screen.findByRole("region", { name: "Totales del cierre tras la corrección" });

    rerender(
      <CorregirResultadoDialog
        gestion={gestion({ gestionId: "g2", numRemision: "REM-002" })}
        onOpenChange={vi.fn()}
        onCorregido={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("region", { name: "Totales del cierre tras la corrección" }),
    ).toBeNull();
    expect(screen.getByLabelText("Motivo de la corrección")).toHaveValue("");
    expect(screen.getByRole("button", { name: BOTON_CONFIRMAR })).toBeDisabled();
  });
});
