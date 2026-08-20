// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { CierresAdminModule } from "@/app/(app)/cierres-admin/_components/CierresAdminModule";
import {
  verCierreDetalle,
  aprobarCierre,
  listarPendientesCierresAdminPaginado,
} from "@/lib/actions/cierres-admin";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreResultado,
  CierreTotales,
  TotalesIngresoOrdenex,
} from "@/lib/interfaces/services/ICierreDiaService";

// Feature 238 (T4.1-T4.7 — R16/R27-R37) — la VENTANA DE CONFIRMACIÓN FÍSICA: antes de aprobar,
// bodega confirma guía a guía que tiene delante cada paquete que vuelve (devoluciones, rechazos
// y reprogramadas).
//
// Lo que protege este archivo, y que ningún test de backend puede proteger:
//   - que un cierre CON paquetes que vuelven no se apruebe sin pasar por la ventana (R7);
//   - que un cierre SIN nada que devolver se apruebe con el payload de siempre (R16) — medido:
//     es 3 de cada 12 cierres, un camino de igual rango y no un `else`;
//   - que los CUATRO desenlaces de una guía leída digan cuatro cosas distintas (R29-R32) y que
//     ninguno de los cuatro marque una fila ni llame a la Server Action;
//   - que el bloqueo se diga con TEXTO y nombre la salida (R27) — se lee el texto, no el
//     `disabled`, porque un botón apagado y mudo se lee como una app rota;
//   - que los incidentes aparezcan NOMBRADOS como excluidos (R34);
//   - que con la ventana cerrada la tarjeta de escaneo no esté en el árbol (R36);
//   - que con incidentes y retornables la confirmación vaya ANTES que los montos (R37).
//
// Todos los textos esperados están escritos A MANO, con sus tildes, y NO importados del módulo
// que los produce: una aserción contra su propia fuente está siempre verde. El 2026-08-07 este
// repo encontró siete etiquetas mal escritas que doce mil tests daban por buenas.
vi.mock("@/lib/actions/cierres-admin", () => ({
  listarGestionesCierresAdminCompleto: vi.fn(),
  verCierreDetalle: vi.fn(),
  aprobarCierre: vi.fn(),
  rechazarCierre: vi.fn(),
  listarCierresAdmin: vi.fn(),
  forzarSolicitudVencido: vi.fn(),
  listarHistoricoCierresAdminPaginado: vi.fn(async () => ({
    status: "ok" as const,
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  })),
  listarPendientesCierresAdminPaginado: vi.fn(),
}));

const { successMock, errorMock, refreshMock, startMock, decodeCallback } = vi.hoisted(
  () => ({
    successMock: vi.fn(),
    errorMock: vi.fn(),
    refreshMock: vi.fn(),
    startMock: vi.fn(),
    decodeCallback: { current: null as ((texto: string) => void) | null },
  }),
);

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

// Sin hardware de cámara en CI: el doble captura el callback de decodificación que `start`
// recibe, exactamente como lo hace `RecogerPaqueteCard.test.tsx`. Es el MISMO `QrScanner`.
vi.mock("html5-qrcode", () => ({
  Html5Qrcode: class {
    start = startMock;
    stop = vi.fn().mockResolvedValue(undefined);
    clear = vi.fn();
  },
}));

const verDetalleMock = vi.mocked(verCierreDetalle);
const aprobarMock = vi.mocked(aprobarCierre);

const VENTANA = "Confirmar los paquetes que vuelven";
const SUB_MODAL_MONTOS = "Indemnizar los incidentes del cierre";
const BOTON_ESCANEAR = "Escanear con cámara";

const ZERO_TOTALES: CierreTotales = {
  efectivo: "0.00",
  simpe: "0.00",
  transferencia: "0.00",
  general: "0.00",
};

function makeResumen(
  over: Partial<CierreAdminResumen> & { cierreId: string },
): CierreAdminResumen {
  return {
    mensajeroId: `m-${over.cierreId}`,
    mensajeroNombre: "Ana Mensajera",
    estado: "solicitado",
    destinoTipo: "bodega_central",
    destinoZonaId: "z1",
    destinoZonaNombre: "GAM",
    totales: ZERO_TOTALES,
    totalPagoMensajero: "0.00",
    totalIngresoBodegaRechazos: "0.00",
    pendientePagoMensajero: null,
    solicitadoAt: "2026-08-19T10:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
    ...over,
  };
}

function makeGestion(
  over: Partial<CierreDetalleGestion> & { gestionId: string; resultado: CierreResultado },
): CierreDetalleGestion {
  return {
    ordenId: `o-${over.gestionId}`,
    numGuia: 1001,
    numRemision: "REM-001",
    destinatario: "Beto Ruiz",
    direccion: "Calle 1",
    zonaNombre: "GAM",
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
    causaIncidente: null,
    indemnizacion: null,
    ...over,
  };
}

function emptyGrupos(): CierreGrupos {
  return { entregada: [], reprogramada: [], devuelta: [], rechazada: [], incidente: [] };
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

// --- El cierre de referencia: tres paquetes que vuelven, uno entregado y un incidente ---
// Es la forma que la medición del 2026-08-19 encontró en producción: los incidentes conviven
// con retornables en el mismo cierre (2 de 12), así que la línea de exclusión de R34 se ve.
const DEV_1 = makeGestion({
  gestionId: "g-dev-1",
  resultado: "devuelta",
  numGuia: 7001,
  numRemision: "REM-DEV-1",
  destinatario: "Delia Vargas",
  tiendaNombre: "Tienda Norte",
});
const REC_1 = makeGestion({
  gestionId: "g-rec-1",
  resultado: "rechazada",
  numGuia: 7002,
  numRemision: "REM-REC-1",
  destinatario: "Rita Solano",
  tiendaNombre: "Tienda Sur",
});
const REP_1 = makeGestion({
  gestionId: "g-rep-1",
  resultado: "reprogramada",
  numGuia: 7003,
  numRemision: "REM-REP-1",
  destinatario: "Rodrigo Pérez",
  tiendaNombre: "Tienda Este",
});
const ENT_1 = makeGestion({
  gestionId: "g-ent-1",
  resultado: "entregada",
  numGuia: 7004,
  numRemision: "REM-ENT-1",
  destinatario: "Elena Castro",
});
const INC_1 = makeGestion({
  gestionId: "g-inc-1",
  resultado: "incidente",
  numGuia: 7005,
  numRemision: "REM-INC-1",
  destinatario: "Iván Mora",
  causaIncidente: "robado",
});

/** Programa el detalle que devolverá `verCierreDetalle` con los grupos indicados. */
function conGrupos(grupos: Partial<CierreGrupos>) {
  verDetalleMock.mockResolvedValue({
    status: "ok",
    desgloseIngresoBodegaRechazos: { sla: "0.00", manual: "0.00", total: "0.00" },
    cierre: makeResumen({ cierreId: "c1", estado: "solicitado" }),
    grupos: { ...emptyGrupos(), ...grupos },
    totalesIngreso: zeroIngreso(),
    ganancia: "0.00",
    pagoTienda: "0.00",
  });
}

/** Abre el detalle del cierre `c1` y pulsa "Aprobar". */
async function pulsarAprobar(user: ReturnType<typeof userEvent.setup>) {
  const cola = paginaInicial([makeResumen({ cierreId: "c1" })]);
  vi.mocked(listarPendientesCierresAdminPaginado).mockResolvedValue({
    status: "ok",
    page: 1,
    ...cola,
  });
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <CierresAdminModule
        pendientes={cola}
        historico={paginaInicial<CierreAdminResumen>([])}
        sinZona={false}
      />
    </SWRConfig>,
  );
  await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
  const dialog = await screen.findByRole("dialog", { name: "Detalle del cierre" });
  await user.click(within(dialog).getByRole("button", { name: "Aprobar" }));
}

/** Abre la ventana de confirmación física y la devuelve. */
async function abrirVentana(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  await pulsarAprobar(user);
  return screen.findByRole("dialog", { name: VENTANA });
}

/** URL del paquete tal como la codifica el QR de la etiqueta. */
function qrDeGuia(numGuia: number): string {
  return `https://ordenex.app/paquete/${numGuia}`;
}

/** Abre la cámara dentro de la ventana y simula que decodifica el texto dado. */
async function escanear(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  texto: string,
) {
  await user.click(within(dialog).getByRole("button", { name: BOTON_ESCANEAR }));
  await vi.waitFor(() => expect(decodeCallback.current).not.toBeNull());
  await act(async () => {
    decodeCallback.current?.(texto);
  });
}

/** Teclea el número de guía en la ventana y confirma con Enter (submit del formulario). */
async function teclear(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  texto: string,
) {
  await user.type(within(dialog).getByLabelText("Número de guía"), `${texto}{Enter}`);
}

/** El texto de la fila de una gestión (guía, remisión, destinatario, resultado y estado). */
function fila(dialog: HTMLElement, gestionId: string): string {
  const li = dialog.querySelector(`[data-gestion="${gestionId}"]`);
  expect(li, `no se pintó la fila de ${gestionId}`).not.toBeNull();
  return li?.textContent ?? "";
}

/** El progreso, que vive en la barra de estado de la ventana. */
function progreso(dialog: HTMLElement): string {
  return within(dialog).getByRole("status").textContent ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  decodeCallback.current = null;
  startMock.mockImplementation(
    async (_config: unknown, _opciones: unknown, onDecode: (texto: string) => void) => {
      decodeCallback.current = onDecode;
    },
  );
  aprobarMock.mockResolvedValue({
    status: "ok",
    cierreId: "c1",
    estado: "aprobado",
    pendientePagoMensajero: "0.00",
  });
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------------------------
// T4.1 — las TRES ramas de `pedirAprobacion()`
// ---------------------------------------------------------------------------------------------

describe("T4.1/R16 — un cierre SIN nada que devolver se aprueba de un click, como hoy", () => {
  it("no abre ninguna ventana y manda `{ cierreId }` sin campos nuevos", async () => {
    const user = userEvent.setup();
    conGrupos({ entregada: [ENT_1] });
    await pulsarAprobar(user);

    expect(screen.queryByRole("dialog", { name: VENTANA })).toBeNull();
    expect(screen.queryByRole("dialog", { name: SUB_MODAL_MONTOS })).toBeNull();
    await vi.waitFor(() => expect(aprobarMock).toHaveBeenCalledWith({ cierreId: "c1" }));
    // Ni una clave nueva: el contrato de la 38 queda intacto (R16).
    expect(Object.keys(aprobarMock.mock.calls[0][0] as object)).toEqual(["cierreId"]);
    await vi.waitFor(() => expect(successMock).toHaveBeenCalled());
  });

  it("PAREJA de la ausencia: el MISMO cierre con una devolución SÍ abre la ventana", async () => {
    // Sin esta pareja, el caso de arriba estaría verde también si la ventana no existiera o si
    // el módulo hubiera dejado de renderizar. Es la lección de la marca de ruta de la 235.
    const user = userEvent.setup();
    conGrupos({ entregada: [ENT_1], devuelta: [DEV_1] });
    await pulsarAprobar(user);

    expect(await screen.findByRole("dialog", { name: VENTANA })).toBeInTheDocument();
    expect(aprobarMock).not.toHaveBeenCalled();
  });
});

describe("T4.1/R7 — con paquetes que vuelven, aprobar pasa SIEMPRE por la ventana", () => {
  it("abre la ventana y NO aprueba todavía", async () => {
    const user = userEvent.setup();
    conGrupos({ devuelta: [DEV_1], rechazada: [REC_1], reprogramada: [REP_1] });
    const dialog = await abrirVentana(user);

    expect(dialog).toBeInTheDocument();
    expect(aprobarMock).not.toHaveBeenCalled();
  });

  it("sin retornables pero CON incidentes va directo a los montos (rama de la 158 intacta)", async () => {
    const user = userEvent.setup();
    conGrupos({ incidente: [INC_1] });
    await pulsarAprobar(user);

    expect(await screen.findByRole("dialog", { name: SUB_MODAL_MONTOS })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: VENTANA })).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// T4.2 — la ventana: qué muestra (R33) y la cámara desmontada (R36)
// ---------------------------------------------------------------------------------------------

describe("T4.2/R33 — cada fila muestra guía, remisión, destinatario, resultado y estado", () => {
  it("las tres filas del conjunto esperado, agrupadas por resultado", async () => {
    const user = userEvent.setup();
    conGrupos({
      devuelta: [DEV_1],
      rechazada: [REC_1],
      reprogramada: [REP_1],
      entregada: [ENT_1],
    });
    const dialog = await abrirVentana(user);

    for (const g of [DEV_1, REC_1, REP_1]) {
      const texto = fila(dialog, g.gestionId);
      expect(texto).toContain(`Nº Guía ${g.numGuia}`);
      expect(texto).toContain(g.numRemision);
      expect(texto).toContain(g.destinatario);
      expect(texto).toContain("Pendiente");
    }
    // El resultado de cada una, en singular y traducido (nunca el value del enum).
    expect(fila(dialog, DEV_1.gestionId)).toContain("Devuelta");
    expect(fila(dialog, REC_1.gestionId)).toContain("Rechazada");
    expect(fila(dialog, REP_1.gestionId)).toContain("Reprogramada");
    // Y los encabezados de grupo, en plural.
    for (const seccion of ["Reprogramadas (1)", "Devueltas (1)", "Rechazadas (1)"]) {
      expect(within(dialog).getByText(seccion)).toBeInTheDocument();
    }
    // La `entregada` NO entra en el conjunto esperado: su paquete se quedó con el cliente.
    expect(dialog.querySelector(`[data-gestion="${ENT_1.gestionId}"]`)).toBeNull();
    expect(dialog.textContent).not.toContain("REM-ENT-1");
  });

  it("una fila confirmada cambia su estado a «Confirmada» (la otra sigue pendiente)", async () => {
    const user = userEvent.setup();
    conGrupos({ devuelta: [DEV_1], rechazada: [REC_1] });
    const dialog = await abrirVentana(user);

    await teclear(user, dialog, "7001");

    expect(fila(dialog, DEV_1.gestionId)).toContain("Confirmada");
    expect(fila(dialog, REC_1.gestionId)).toContain("Pendiente");
  });
});

describe("T4.2/R36 — la cámara no se queda montada detrás de nada", () => {
  it("con la ventana CERRADA la tarjeta de escaneo no está en el árbol; abierta, sí", async () => {
    const user = userEvent.setup();
    conGrupos({ devuelta: [DEV_1] });
    const cola = paginaInicial([makeResumen({ cierreId: "c1" })]);
    vi.mocked(listarPendientesCierresAdminPaginado).mockResolvedValue({
      status: "ok",
      page: 1,
      ...cola,
    });
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <CierresAdminModule
          pendientes={cola}
          historico={paginaInicial<CierreAdminResumen>([])}
          sinZona={false}
        />
      </SWRConfig>,
    );

    // 1) Con el detalle abierto pero la ventana cerrada: nada de cámara.
    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const detalle = await screen.findByRole("dialog", { name: "Detalle del cierre" });
    expect(screen.queryByRole("button", { name: BOTON_ESCANEAR })).toBeNull();

    // 2) Al abrir la ventana, aparece: la ausencia de arriba es del cierre de la ventana y no
    //    de un componente que nunca se montó.
    await user.click(within(detalle).getByRole("button", { name: "Aprobar" }));
    const dialog = await screen.findByRole("dialog", { name: VENTANA });
    expect(within(dialog).getByRole("button", { name: BOTON_ESCANEAR })).toBeInTheDocument();

    // 3) Y al cerrarla, se va otra vez.
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await vi.waitFor(() =>
      expect(screen.queryByRole("button", { name: BOTON_ESCANEAR })).toBeNull(),
    );
  });

  it("el montaje es CONDICIONAL y no depende de lo que el diálogo haga con su contenido", async () => {
    // MEDIDO, y por eso este caso existe: montar la tarjeta incondicionalmente (`{true ? …}`)
    // deja el caso de arriba EN VERDE. La propiedad se cumple hoy por DOS mecanismos —el
    // ternario y el desmontaje del portal de Base UI— y desde el árbol renderizado sólo se ve
    // el de fuera. Si mañana el Modal gana una animación de salida o un `keepMounted`, el de
    // fuera desaparece sin que ningún test se entere y la cámara se queda encendida detrás de
    // algo invisible.
    //
    // Se vigila el mecanismo de dentro leyendo la fuente, que es lo que este repo ya hace con
    // el `satisfies` de `RETORNA_A_BODEGA`: una red que no se ve en runtime se vigila donde se
    // escribe. El censo va en un archivo de test y nunca por `node -e`.
    const { readFileSync } = await import("node:fs");
    const modulo = readFileSync(
      "app/(app)/cierres-admin/_components/CierresAdminModule.tsx",
      "utf8",
    );
    expect(modulo).toMatch(/\{confirmando \? \(\s*<ConfirmacionFisicaCuerpo/);
  });
});

// ---------------------------------------------------------------------------------------------
// T4.3 — los CUATRO desenlaces de una guía leída (R29-R32), un caso por mensaje
// ---------------------------------------------------------------------------------------------

describe("T4.3/R29 — un código que no se puede interpretar como guía", () => {
  it("avisa, no marca ninguna fila y no manda nada al servidor", async () => {
    const user = userEvent.setup();
    conGrupos({ devuelta: [DEV_1], rechazada: [REC_1] });
    const dialog = await abrirVentana(user);

    await escanear(user, dialog, "esto-no-es-una-url");

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "No se pudo leer un número de guía en ese código. Escaneá de nuevo o escribí el número.",
    );
    expect(progreso(dialog)).toBe("Paquetes confirmados: 0 de 2.");
    expect(fila(dialog, DEV_1.gestionId)).toContain("Pendiente");
    expect(aprobarMock).not.toHaveBeenCalled();
  });
});

describe("T4.3/R30 — una guía que no pertenece a este cierre", () => {
  it("lo dice con su mensaje propio, no marca nada y no manda nada", async () => {
    const user = userEvent.setup();
    conGrupos({ devuelta: [DEV_1], rechazada: [REC_1] });
    const dialog = await abrirVentana(user);

    await escanear(user, dialog, qrDeGuia(9999));

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Esa guía no pertenece a este cierre.",
    );
    expect(progreso(dialog)).toBe("Paquetes confirmados: 0 de 2.");
    expect(fila(dialog, DEV_1.gestionId)).toContain("Pendiente");
    expect(fila(dialog, REC_1.gestionId)).toContain("Pendiente");
    expect(aprobarMock).not.toHaveBeenCalled();
  });
});

describe("T4.3/R31 — una guía del cierre cuyo paquete NO vuelve a bodega", () => {
  it("el incidente recibe un mensaje PROPIO, distinto del de la guía ajena", async () => {
    const user = userEvent.setup();
    conGrupos({ devuelta: [DEV_1], incidente: [INC_1] });
    const dialog = await abrirVentana(user);

    await escanear(user, dialog, qrDeGuia(INC_1.numGuia ?? 0));

    const aviso = within(dialog).getAllByRole("alert")[0];
    expect(aviso).toHaveTextContent(
      "Esa guía es de este cierre, pero ese paquete no vuelve a bodega. Resultado: Incidente.",
    );
    // La diferencia con R30 no es cosmética: «no pertenece» manda a buscar el paquete, y el
    // incidente no hay dónde buscarlo (se perdió, se robó o se dañó: se indemniza).
    expect(aviso.textContent).not.toContain("Esa guía no pertenece a este cierre.");
    expect(progreso(dialog)).toBe("Paquetes confirmados: 0 de 1.");
    expect(fila(dialog, DEV_1.gestionId)).toContain("Pendiente");
    expect(aprobarMock).not.toHaveBeenCalled();
  });

  it("una `entregada` del cierre recibe el mismo mensaje, con su resultado", async () => {
    const user = userEvent.setup();
    conGrupos({ devuelta: [DEV_1], entregada: [ENT_1] });
    const dialog = await abrirVentana(user);

    await teclear(user, dialog, String(ENT_1.numGuia));

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Esa guía es de este cierre, pero ese paquete no vuelve a bodega. Resultado: Entregada.",
    );
    expect(progreso(dialog)).toBe("Paquetes confirmados: 0 de 1.");
  });
});

describe("T4.3/R32 — una guía ya confirmada en esta sesión", () => {
  it("lo dice y NO la cuenta dos veces", async () => {
    const user = userEvent.setup();
    conGrupos({ devuelta: [DEV_1], rechazada: [REC_1] });
    const dialog = await abrirVentana(user);

    await teclear(user, dialog, "7001");
    expect(progreso(dialog)).toBe("Paquetes confirmados: 1 de 2.");

    await teclear(user, dialog, "7001");

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Esa guía ya está confirmada. No se cuenta dos veces.",
    );
    // El contador NO avanza: dos lecturas de la misma guía no cubren dos paquetes.
    expect(progreso(dialog)).toBe("Paquetes confirmados: 1 de 2.");
    expect(
      within(dialog).getByRole("button", { name: "Confirmar y aprobar" }),
    ).toBeDisabled();
    expect(aprobarMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// T4.4 — los DOS caminos de captura (R28)
// ---------------------------------------------------------------------------------------------

describe("T4.4/R28 — se confirma por cámara o por número tecleado", () => {
  it("por CÁMARA: el QR de la etiqueta confirma esa gestión", async () => {
    const user = userEvent.setup();
    conGrupos({ devuelta: [DEV_1] });
    const dialog = await abrirVentana(user);

    await escanear(user, dialog, qrDeGuia(7001));

    expect(fila(dialog, DEV_1.gestionId)).toContain("Confirmada");
    expect(progreso(dialog)).toBe("Paquetes confirmados: 1 de 1.");
    await user.click(within(dialog).getByRole("button", { name: "Confirmar y aprobar" }));
    await vi.waitFor(() =>
      expect(aprobarMock).toHaveBeenCalledWith({
        cierreId: "c1",
        confirmacionFisica: [{ gestionId: "g-dev-1", numGuia: 7001 }],
      }),
    );
  });

  it("por NÚMERO TECLEADO: el mismo número confirma la misma gestión", async () => {
    const user = userEvent.setup();
    conGrupos({ devuelta: [DEV_1] });
    const dialog = await abrirVentana(user);

    await teclear(user, dialog, "7001");

    expect(fila(dialog, DEV_1.gestionId)).toContain("Confirmada");
    expect(progreso(dialog)).toBe("Paquetes confirmados: 1 de 1.");
    await user.click(within(dialog).getByRole("button", { name: "Confirmar y aprobar" }));
    await vi.waitFor(() =>
      expect(aprobarMock).toHaveBeenCalledWith({
        cierreId: "c1",
        confirmacionFisica: [{ gestionId: "g-dev-1", numGuia: 7001 }],
      }),
    );
  });

  it("un número tecleado que no son dígitos se queda en el campo para corregirlo", async () => {
    const user = userEvent.setup();
    conGrupos({ devuelta: [DEV_1] });
    const dialog = await abrirVentana(user);

    await teclear(user, dialog, "70O1"); // una «O» donde va un cero

    expect(within(dialog).getByLabelText("Número de guía")).toHaveValue("70O1");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "No se pudo leer un número de guía en ese código.",
    );
    expect(progreso(dialog)).toBe("Paquetes confirmados: 0 de 1.");
  });
});

// ---------------------------------------------------------------------------------------------
// T4.5 — el bloqueo CON PALABRAS (R27) y la exclusión NOMBRADA (R34)
// ---------------------------------------------------------------------------------------------

describe("T4.5/R27 — el bloqueo se dice con texto, no sólo con un botón apagado", () => {
  it("dice cuántas faltan y qué hacer si un paquete no llegó", async () => {
    const user = userEvent.setup();
    conGrupos({ devuelta: [DEV_1], rechazada: [REC_1], reprogramada: [REP_1] });
    const dialog = await abrirVentana(user);

    // Se lee el TEXTO, no el `disabled`: un botón apagado y mudo se lee como una app rota.
    expect(within(dialog).getByRole("note")).toHaveTextContent(
      "Faltan 3 paquetes por confirmar. Si alguno no llegó, rechazá el cierre indicando cuáles faltan.",
    );
    expect(progreso(dialog)).toBe("Paquetes confirmados: 0 de 3.");

    await teclear(user, dialog, "7001");
    await teclear(user, dialog, "7002");

    // Con una sola pendiente, el texto pasa al singular y sigue nombrando la salida.
    expect(within(dialog).getByRole("note")).toHaveTextContent(
      "Falta 1 paquete por confirmar. Si no llegó, rechazá el cierre indicando cuál falta.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Confirmar y aprobar" }),
    ).toBeDisabled();

    await teclear(user, dialog, "7003");

    expect(within(dialog).getByRole("note")).toHaveTextContent(
      "Están todos. Ya se puede aprobar el cierre.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Confirmar y aprobar" }),
    ).toBeEnabled();
  });

  it("con una guía sin confirmar, forzar el botón no llama a la Server Action", async () => {
    const user = userEvent.setup();
    conGrupos({ devuelta: [DEV_1], rechazada: [REC_1] });
    const dialog = await abrirVentana(user);

    await teclear(user, dialog, "7001");
    await user.click(within(dialog).getByRole("button", { name: "Confirmar y aprobar" }));

    expect(aprobarMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog", { name: VENTANA })).toBeInTheDocument();
  });

  it("una gestión sin número de guía se nombra como no confirmable, en su fila", async () => {
    // R13, la mitad del cliente: medido el 2026-08-19 esa población no existe, pero si
    // apareciera, el cierre no se podría aprobar y bodega tiene que saber por qué en vez de
    // escanear las otras trece y chocar con un botón apagado.
    const user = userEvent.setup();
    const sinGuia = makeGestion({
      gestionId: "g-dev-2",
      resultado: "devuelta",
      numGuia: null,
      numRemision: "REM-DEV-2",
      destinatario: "Sara Vega",
    });
    conGrupos({ devuelta: [DEV_1, sinGuia] });
    const dialog = await abrirVentana(user);

    expect(fila(dialog, "g-dev-2")).toContain(
      "Sin número de guía: no se puede confirmar. Avisá a un administrador.",
    );
    // Y la que SÍ tiene guía no lleva ese aviso: la línea es de la fila, no del bloque.
    expect(fila(dialog, DEV_1.gestionId)).not.toContain("Sin número de guía");
  });
});

describe("T4.5/R34 — los incidentes aparecen nombrados como excluidos, con su razón", () => {
  it("los nombra uno a uno y dice por qué no se escanean", async () => {
    const user = userEvent.setup();
    conGrupos({ devuelta: [DEV_1], incidente: [INC_1] });
    const dialog = await abrirVentana(user);

    const seccion = within(dialog).getByRole("region", {
      name: "Incidentes excluidos de la confirmación",
    });
    expect(seccion).toHaveTextContent(
      "1 incidente de este cierre no se escanea: ese paquete no vuelve a bodega, se indemniza.",
    );
    // «Nombradas» de verdad: con su guía, su remisión y su destinatario, para que bodega pueda
    // contar los paquetes del estante y no busque el que «falta».
    expect(seccion).toHaveTextContent("Nº Guía 7005");
    expect(seccion).toHaveTextContent("REM-INC-1");
    expect(seccion).toHaveTextContent("Iván Mora");
    // Y NO entra en el conjunto esperado: no hay fila suya que confirmar.
    expect(dialog.querySelector(`[data-gestion="${INC_1.gestionId}"]`)).toBeNull();
    expect(progreso(dialog)).toBe("Paquetes confirmados: 0 de 1.");
  });

  it("PAREJA de la ausencia: sin incidentes, la línea de exclusión no se pinta", async () => {
    const user = userEvent.setup();
    conGrupos({ devuelta: [DEV_1] });
    const dialog = await abrirVentana(user);

    expect(
      within(dialog).queryByRole("region", {
        name: "Incidentes excluidos de la confirmación",
      }),
    ).toBeNull();
    expect(dialog.textContent).not.toContain("no se escanea");
    // Pero la ventana SÍ está pintada: la ausencia es de la línea, no del componente.
    expect(fila(dialog, DEV_1.gestionId)).toContain("Nº Guía 7001");
  });
});

// ---------------------------------------------------------------------------------------------
// T4.6 — cerrar sin completar (R35) y el orden de los dos pasos (R37)
// ---------------------------------------------------------------------------------------------

describe("T4.6/R35 — cerrar la ventana sin completarla no envía nada", () => {
  it("cancelar no llama a `aprobarCierre` y conserva lo ya escaneado al reabrir", async () => {
    const user = userEvent.setup();
    conGrupos({ devuelta: [DEV_1], rechazada: [REC_1] });
    const dialog = await abrirVentana(user);
    await teclear(user, dialog, "7001");

    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog", { name: VENTANA })).toBeNull());

    expect(aprobarMock).not.toHaveBeenCalled();

    // Reabrir NO obliga a re-escanear lo ya leído: no existe una confirmación a medias
    // persistida, así que lo confirmado vive mientras el detalle siga abierto.
    const detalle = screen.getByRole("dialog", { name: "Detalle del cierre" });
    await user.click(within(detalle).getByRole("button", { name: "Aprobar" }));
    const dos = await screen.findByRole("dialog", { name: VENTANA });
    expect(progreso(dos)).toBe("Paquetes confirmados: 1 de 2.");
  });

  it("cerrar el DETALLE descarta lo confirmado: el siguiente cierre arranca de cero", async () => {
    const user = userEvent.setup();
    conGrupos({ devuelta: [DEV_1], rechazada: [REC_1] });
    const dialog = await abrirVentana(user);
    await teclear(user, dialog, "7001");
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await user.click(
      within(screen.getByRole("dialog", { name: "Detalle del cierre" })).getAllByRole(
        "button",
        { name: "Cerrar" },
      )[0],
    );

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const detalle = await screen.findByRole("dialog", { name: "Detalle del cierre" });
    await user.click(within(detalle).getByRole("button", { name: "Aprobar" }));
    const dos = await screen.findByRole("dialog", { name: VENTANA });
    expect(progreso(dos)).toBe("Paquetes confirmados: 0 de 2.");
    expect(aprobarMock).not.toHaveBeenCalled();
  });
});

describe("T4.6/R37 — con incidentes y retornables, la confirmación va ANTES que los montos", () => {
  it("primero la ventana, después el sub-modal de montos, y el payload lleva las dos listas", async () => {
    const user = userEvent.setup();
    conGrupos({ devuelta: [DEV_1], incidente: [INC_1] });
    const dialog = await abrirVentana(user);

    // Paso 1: la confirmación física. Los montos todavía no se piden — si falta un paquete, no
    // tiene sentido teclear dinero que se va a descartar.
    expect(screen.queryByRole("dialog", { name: SUB_MODAL_MONTOS })).toBeNull();
    // Y el botón no promete aprobar: queda un paso.
    expect(within(dialog).getByRole("button", { name: "Continuar" })).toBeDisabled();

    await teclear(user, dialog, "7001");
    // Con todo confirmado, el texto NO promete aprobar: nombra el paso que queda. Prometerlo
    // junto a un botón que dice «Continuar» deja a bodega buscando un botón que no existe.
    expect(within(dialog).getByRole("note")).toHaveTextContent(
      "Están todos. Queda indicar los montos de los incidentes.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Continuar" }));

    // Paso 2: los montos. Y todavía no se aprobó nada.
    const montos = await screen.findByRole("dialog", { name: SUB_MODAL_MONTOS });
    expect(aprobarMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(screen.queryByRole("dialog", { name: VENTANA })).toBeNull());

    const campo = document.getElementById("indemnizacion-g-inc-1") as HTMLInputElement;
    await user.type(campo, "12500.00");
    await user.click(
      within(montos).getByRole("button", { name: "Aprobar e indemnizar" }),
    );

    await vi.waitFor(() =>
      expect(aprobarMock).toHaveBeenCalledWith({
        cierreId: "c1",
        indemnizaciones: [{ gestionId: "g-inc-1", monto: "12500.00" }],
        confirmacionFisica: [{ gestionId: "g-dev-1", numGuia: 7001 }],
      }),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// T4.7 — los errores del servidor, por fila
// ---------------------------------------------------------------------------------------------

describe("T4.7 — un `validation_error` con clave de gestión se pinta en SU fila", () => {
  it("la ventana sigue abierta y el error aparece en la fila de esa gestión", async () => {
    const user = userEvent.setup();
    conGrupos({ devuelta: [DEV_1], rechazada: [REC_1] });
    // El servidor discute UNA de las dos: es su mensaje real (`MSG_CONFIRMACION_GUIA_DISTINTA`).
    aprobarMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { "g-rec-1": ["La guía leída no es la de este paquete."] },
    });
    const dialog = await abrirVentana(user);
    await teclear(user, dialog, "7001");
    await teclear(user, dialog, "7002");
    await user.click(within(dialog).getByRole("button", { name: "Confirmar y aprobar" }));

    await vi.waitFor(() => expect(aprobarMock).toHaveBeenCalledTimes(1));
    // Sigue abierta: cerrarla obligaría a re-escanear todo lo ya leído.
    const abierta = await screen.findByRole("dialog", { name: VENTANA });
    await vi.waitFor(() =>
      expect(document.getElementById("confirmacion-g-rec-1-error")).not.toBeNull(),
    );
    expect(fila(abierta, "g-rec-1")).toContain("La guía leída no es la de este paquete.");
    // Y NO se pinta en la fila de la otra gestión.
    expect(fila(abierta, "g-dev-1")).not.toContain("La guía leída no es la de este paquete.");
    // Nada se aprobó.
    expect(successMock).not.toHaveBeenCalled();
  });

  it("un error de un INCIDENTE no abre la ventana: se pinta donde se teclean los montos", async () => {
    // Las dos coberturas devuelven sus errores con la MISMA forma (clave = id de gestión), así
    // que el módulo tiene que repartirlos. El criterio es «¿está en el conjunto esperado?», y
    // los dos conjuntos son disjuntos por construcción: un incidente no vuelve a bodega.
    // Sin el reparto, un error de monto reabriría la ventana de escaneo, que no arregla nada.
    const user = userEvent.setup();
    conGrupos({ devuelta: [DEV_1], incidente: [INC_1] });
    aprobarMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { "g-inc-1": ["Falta el monto de indemnización de este incidente."] },
    });
    const dialog = await abrirVentana(user);
    await teclear(user, dialog, "7001");
    await user.click(within(dialog).getByRole("button", { name: "Continuar" }));

    const montos = await screen.findByRole("dialog", { name: SUB_MODAL_MONTOS });
    await user.type(
      document.getElementById("indemnizacion-g-inc-1") as HTMLInputElement,
      "10.00",
    );
    await user.click(within(montos).getByRole("button", { name: "Aprobar e indemnizar" }));

    await vi.waitFor(() =>
      expect(document.getElementById("indemnizacion-g-inc-1")).toHaveAttribute(
        "aria-invalid",
        "true",
      ),
    );
    // La ventana de confirmación NO vuelve: el paquete ya está confirmado, lo que falta es un
    // monto.
    expect(screen.queryByRole("dialog", { name: VENTANA })).toBeNull();
    expect(await screen.findByRole("dialog", { name: SUB_MODAL_MONTOS })).toBeInTheDocument();
    expect(successMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// La GUÍA REPETIDA — el bloqueo duro encontrado conduciendo la app (T5.6, 2026-08-19)
// ---------------------------------------------------------------------------------------------
//
// Un cierre puede traer DOS gestiones vivas de la MISMA orden y, por tanto, con la MISMA guía.
// Medido contra producción ese mismo día (sólo lectura): 1 de 48 pares (cierre, orden) vivos está
// así, y es justo del tipo que dispara el bloqueo (la gestión que vuelve, repetida).
//
// Con la resolución por `find` —la primera fila que case— pasaba esto: la primera lectura
// confirmaba la primera fila; la segunda lectura de la MISMA guía volvía a caer en esa fila y
// respondía «ya está confirmada»; y la segunda fila se quedaba `Pendiente` para siempre, con el
// contador clavado en `N-1 de N` y el botón apagado. El cierre no se podía aprobar por ninguna vía
// y nada en la pantalla decía por qué. Visto en pantalla: «Paquetes confirmados: 11 de 12».
//
// La decisión: **una lectura confirma TODAS las filas pendientes de esa guía**, porque hay UN solo
// paquete físico. Pedir dos escaneos de la misma caja es pedir que se atestigüe dos veces un único
// acto. El servidor lo admite sin cambios: dedupe por `gestionId` (no por guía) y compara la guía
// contra la de CADA gestión.

/** Dos gestiones vivas de la misma orden: una guía, un bulto, dos filas. */
const DUP_A = makeGestion({
  gestionId: "g-dup-a",
  ordenId: "o-dup",
  resultado: "devuelta",
  numGuia: 7010,
  numRemision: "REM-DUP",
  destinatario: "Dora Quesada",
});
const DUP_B = makeGestion({
  gestionId: "g-dup-b",
  ordenId: "o-dup",
  resultado: "devuelta",
  numGuia: 7010,
  numRemision: "REM-DUP",
  destinatario: "Dora Quesada",
});

describe("guía repetida — una lectura confirma TODAS las filas de ese paquete", () => {
  it("las dos filas quedan confirmadas, el botón se habilita y el cierre se aprueba", async () => {
    const user = userEvent.setup();
    conGrupos({ devuelta: [DUP_A, DUP_B], rechazada: [REC_1] });
    const dialog = await abrirVentana(user);

    // Dos bultos: el repetido (dos filas) y el rechazo. Las TRES filas están en la lista.
    expect(progreso(dialog)).toBe("Paquetes confirmados: 0 de 2.");
    expect(fila(dialog, "g-dup-a")).toContain("Pendiente");
    expect(fila(dialog, "g-dup-b")).toContain("Pendiente");

    await teclear(user, dialog, "7010");

    // El corazón del arreglo: UNA lectura, las DOS filas de esa guía confirmadas.
    expect(fila(dialog, "g-dup-a")).toContain("Confirmada");
    expect(fila(dialog, "g-dup-b")).toContain("Confirmada");
    expect(fila(dialog, "g-rec-1")).toContain("Pendiente");
    expect(progreso(dialog)).toBe("Paquetes confirmados: 1 de 2.");
    expect(
      within(dialog).getByRole("button", { name: "Confirmar y aprobar" }),
    ).toBeDisabled();

    await teclear(user, dialog, "7002");

    // Antes del arreglo esto se quedaba en «1 de 3» para siempre: la segunda fila del bulto
    // repetido no había forma de confirmarla, y el botón nunca se habilitaba.
    expect(progreso(dialog)).toBe("Paquetes confirmados: 2 de 2.");
    expect(within(dialog).getByRole("note")).toHaveTextContent(
      "Están todos. Ya se puede aprobar el cierre.",
    );
    const boton = within(dialog).getByRole("button", { name: "Confirmar y aprobar" });
    expect(boton).toBeEnabled();

    await user.click(boton);

    // Y el payload lleva UNA ENTRADA POR GESTIÓN con la misma guía repetida: es lo que el
    // servicio exige (cobertura exacta del conjunto esperado, dedupe por `gestionId`).
    await vi.waitFor(() =>
      expect(aprobarMock).toHaveBeenCalledWith({
        cierreId: "c1",
        confirmacionFisica: [
          { gestionId: "g-dup-a", numGuia: 7010 },
          { gestionId: "g-dup-b", numGuia: 7010 },
          { gestionId: "g-rec-1", numGuia: 7002 },
        ],
      }),
    );
  });

  it("R32 SIGUE VIVO: con las dos filas ya confirmadas, otra lectura avisa y no cuenta de más", async () => {
    // R32 no se ablanda, se corrige: el aviso es para cuando esa guía YA NO CUBRE NADA. Antes
    // saltaba con una fila todavía pendiente, y ahí era donde mentía.
    const user = userEvent.setup();
    conGrupos({ devuelta: [DUP_A, DUP_B], rechazada: [REC_1] });
    const dialog = await abrirVentana(user);

    await teclear(user, dialog, "7010");
    expect(progreso(dialog)).toBe("Paquetes confirmados: 1 de 2.");

    await teclear(user, dialog, "7010");

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Esa guía ya está confirmada. No se cuenta dos veces.",
    );
    expect(progreso(dialog)).toBe("Paquetes confirmados: 1 de 2.");
    expect(fila(dialog, "g-rec-1")).toContain("Pendiente");
    expect(
      within(dialog).getByRole("button", { name: "Confirmar y aprobar" }),
    ).toBeDisabled();
    expect(aprobarMock).not.toHaveBeenCalled();
  });

  it("una `entregada` que comparte guía con una `devuelta` no roba la lectura (R31 sigue siendo suyo)", async () => {
    // El mismo `find` mirado desde el otro lado: si la primera fila que casa no vuelve a bodega,
    // la lectura contestaba «ese paquete no vuelve» y la `devuelta` quedaba imposible. Basta con
    // que UNA de las filas de esa guía vuelva para que haya un bulto delante que confirmar.
    const user = userEvent.setup();
    const ENT_DUP = makeGestion({
      gestionId: "g-ent-dup",
      ordenId: "o-mix",
      resultado: "entregada",
      numGuia: 7020,
      numRemision: "REM-MIX",
      destinatario: "Eva Mixta",
    });
    const DEV_DUP = makeGestion({
      gestionId: "g-dev-dup",
      ordenId: "o-mix",
      resultado: "devuelta",
      numGuia: 7020,
      numRemision: "REM-MIX",
      destinatario: "Eva Mixta",
    });
    conGrupos({ entregada: [ENT_DUP], devuelta: [DEV_DUP] });
    const dialog = await abrirVentana(user);

    await teclear(user, dialog, "7020");

    expect(fila(dialog, "g-dev-dup")).toContain("Confirmada");
    expect(dialog.textContent).not.toContain("ese paquete no vuelve a bodega");
    expect(progreso(dialog)).toBe("Paquetes confirmados: 1 de 1.");
    await user.click(within(dialog).getByRole("button", { name: "Confirmar y aprobar" }));
    await vi.waitFor(() =>
      expect(aprobarMock).toHaveBeenCalledWith({
        cierreId: "c1",
        confirmacionFisica: [{ gestionId: "g-dev-dup", numGuia: 7020 }],
      }),
    );
  });
});

describe("el contador dice PAQUETES y cuenta paquetes, no filas", () => {
  it("dos filas de la misma guía son UN bulto, y la fila lo explica", async () => {
    // El rótulo decía «Paquetes confirmados: X de N» con N = filas. En el cierre medido eran
    // doce filas para once bultos: el rótulo ya mentía antes del arreglo. Y contando filas, una
    // sola lectura movería el contador de dos en dos, que a quien escanea se le lee como un
    // error de la app.
    const user = userEvent.setup();
    conGrupos({ devuelta: [DUP_A, DUP_B], rechazada: [REC_1] });
    const dialog = await abrirVentana(user);

    expect(progreso(dialog)).toBe("Paquetes confirmados: 0 de 2.");
    expect(within(dialog).getByRole("note")).toHaveTextContent(
      "Faltan 2 paquetes por confirmar. Si alguno no llegó, rechazá el cierre indicando cuáles faltan.",
    );
    // Pero las TRES filas siguen ahí: R33 pide una fila por gestión, y agrupar el conteo no es
    // esconder ninguna.
    expect(fila(dialog, "g-dup-a")).toContain("Nº Guía 7010");
    expect(fila(dialog, "g-dup-b")).toContain("Nº Guía 7010");
    expect(fila(dialog, "g-rec-1")).toContain("Nº Guía 7002");

    // Y la guía repetida se NOMBRA en sus dos filas: sin esto, ver la misma guía dos veces y que
    // las dos cambien de golpe se lee como un error.
    const explicacion =
      "Este paquete aparece en 2 filas de esta lista: una sola lectura las confirma todas.";
    expect(fila(dialog, "g-dup-a")).toContain(explicacion);
    expect(fila(dialog, "g-dup-b")).toContain(explicacion);
    // La fila que no comparte bulto NO lleva la línea.
    expect(fila(dialog, "g-rec-1")).not.toContain("Este paquete aparece en");
  });

  it("dos filas SIN guía no se funden en un bulto: cada una cuenta, y siguen bloqueando", async () => {
    // Sin guía no hay forma de saber si dos filas son el mismo bulto. Colapsarlas rebajaría el
    // total —el número de paquetes que bodega tiene que poner delante— y esas filas además no se
    // pueden confirmar nunca (R13), así que el bloqueo tiene que seguir contándolas.
    const user = userEvent.setup();
    const SIN_GUIA_1 = makeGestion({
      gestionId: "g-sin-1",
      resultado: "devuelta",
      numGuia: null,
      numRemision: "REM-SIN-1",
      destinatario: "Sara Vega",
    });
    const SIN_GUIA_2 = makeGestion({
      gestionId: "g-sin-2",
      resultado: "devuelta",
      numGuia: null,
      numRemision: "REM-SIN-2",
      destinatario: "Saúl Ruiz",
    });
    conGrupos({ devuelta: [DEV_1, SIN_GUIA_1, SIN_GUIA_2] });
    const dialog = await abrirVentana(user);

    expect(progreso(dialog)).toBe("Paquetes confirmados: 0 de 3.");

    await teclear(user, dialog, "7001");

    expect(progreso(dialog)).toBe("Paquetes confirmados: 1 de 3.");
    expect(within(dialog).getByRole("note")).toHaveTextContent(
      "Faltan 2 paquetes por confirmar.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Confirmar y aprobar" }),
    ).toBeDisabled();
  });
});
