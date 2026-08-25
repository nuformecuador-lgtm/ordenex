// @vitest-environment jsdom
// Feature 149 — T6.5: UI de "Deshacer asignación". Cubre R34, R35, R36, R37, R38 y R39.
//
// Las DOS superficies se ejercitan con el componente REAL (listado del maestro y módulo de la
// bodega satélite); lo único mockeado es el borde (Server Actions), el toast y el router, para
// que lo verificado sea el cableado de la UI y no la implementación del backend.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import { ORDER_STATUS_LABELS } from "@/app/(app)/ordenes/_components/EstatusBadge";
import {
  MSG_CARRERA,
  MSG_CATALOGO_INCOMPLETO,
  MSG_ORDEN_BORRADA,
  MSG_ORDEN_NO_EXISTE,
  MSG_SIN_HISTORIAL,
  MSG_ZONA_CENTRAL_NO_CONFIGURADA,
  MSG_ZONA_DESTINO_INCOHERENTE,
  msgEstadoNoReversible,
} from "@/lib/services/mensajes-deshacer-asignacion";

const { refreshMock, successMock, errorMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  successMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
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

// Borde de la feature: UNA sola llamada por lote (R20/R24).
const deshacerAsignacionMock = vi.fn();
vi.mock("@/lib/actions/deshacer-asignacion", () => ({
  deshacerAsignacion: (...a: unknown[]) => deshacerAsignacionMock(...a),
}));

// --- Acciones que consume el listado del maestro ---
const listarOrderStatusMock = vi.fn();
vi.mock("@/lib/actions/order-status", () => ({
  listarOrderStatus: (...a: unknown[]) => listarOrderStatusMock(...a),
}));

const listarOrdenesMock = vi.fn();
vi.mock("@/lib/actions/ordenes", () => ({
  listarOrdenes: (...a: unknown[]) => listarOrdenesMock(...a),
}));

vi.mock("@/lib/actions/ordenes-guia", () => ({
  listarMensajerosParaAsignacion: vi.fn().mockResolvedValue({
    status: "ok",
    mensajeros: [],
    bloqueadosIds: [],
  }),
  listarZonasBloqueadasPorCierre: vi
    .fn()
    .mockResolvedValue({ status: "ok", zonasBloqueadasIds: [] }),
}));

// --- Acciones que consume el módulo de la bodega satélite ---
// Feature 170 — FASE 2 (T K.3): el listado pide su página al servidor; el doble devuelve las
// órdenes que el caso monta, sin recortar (aquí no se pagina nada).
const { paginadoBodegaMock } = vi.hoisted(() => ({ paginadoBodegaMock: vi.fn() }));
vi.mock("@/lib/actions/recepcion-satelite", () => ({
  recibirPorQr: vi.fn(),
  listarRecepcionSatelite: vi.fn(),
  asignarDesdeSatelite: vi.fn(),
  listarOrdenesBodegaPaginado: (...args: unknown[]) => paginadoBodegaMock(...args),
  // Feature 184 — Tanda A (T A.4/T A.5): el modulo importa las DOS acciones nuevas —el
  // conjunto de la descarga y la vigencia con la que poda la seleccion—, asi que el doble
  // tiene que declararlas o el modulo revienta al importarlo. Aqui no se invocan: no se
  // descarga nada y no hay marcas fuera de la pagina visible (el listado cabe entero).
  listarOrdenesBodegaCompleto: vi.fn(async () => ({ status: "ok", items: [], total: 0 })),
  listarIdsVigentesBodega: vi.fn(async () => ({ status: "ok", ids: [] })),
}));
vi.mock("@/lib/actions/envio-devolucion-central", () => ({
  enviarACentral: vi.fn(),
}));
vi.mock("@/lib/actions/resolver-novedad", () => ({
  recuperarABodega: vi.fn(),
}));
vi.mock("html5-qrcode", () => ({ Html5Qrcode: vi.fn() }));

import { OrdenesListado } from "@/app/(app)/ordenes/_components/OrdenesListado";
import { RecepcionSateliteModule } from "@/app/(app)/recepcion-satelite/_components/RecepcionSateliteModule";
import { DeshacerAsignacionModal } from "@/app/(app)/ordenes/_components/DeshacerAsignacionModal";
import {
  PAGE_SIZE_SATELITE,
  catalogoSatelite,
  paginaBodega,
} from "@/tests/fixtures/satelite-bodega";
import {
  MOTIVO_INVALIDO,
  MOTIVO_MIN_LEN,
  deshacerAsignacionErrorMessage,
  motivoValido,
} from "@/app/(app)/ordenes/_components/deshacer-asignacion-error-messages";

const ACCION = "Deshacer asignación";
const MOTIVO_OK = "el mensajero se reportó enfermo y no pasa hoy";

const CATALOGO = [
  { id: "est-por_recoger", value: "por_recoger" },
  { id: "est-en_ruta_bodega_satelite", value: "en_ruta_bodega_satelite" },
  { id: "est-en_bodega_central", value: "en_bodega_central" },
];

function makeOrden(
  over: Partial<OrdenListItemDTO> & { id: string },
): OrdenListItemDTO {
  return {
    numGuia: 1001,
    numRemision: `REM-${over.id}`,
    estatusId: "est-por_recoger",
    estatusValue: "por_recoger",
    destinatario: "Destino",
    telefonoDest: "0999999999",
    tiendaId: "tienda-1",
    tiendaNombre: "Tienda X",
    zonaId: "zona-1",
    zonaNombre: "Limón",
    zonaEsGam: false,
    provinciaId: "prov-1",
    cantonId: "canton-1",
    distritoId: null,
    producto: "Producto",
    peso: 1,
    notas: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  } as OrdenListItemDTO;
}

function makeOrdenSatelite(
  over: Partial<RecepcionSateliteDTO> & { id: string },
): RecepcionSateliteDTO {
  return {
    numGuia: 2001,
    numRemision: `SAT-${over.id}`,
    estatusValue: "por_recoger",
    destinatario: "Ana Pérez",
    telefonoDest: "88880000",
    direccion: "Calle 1",
    producto: "Caja",
    montoCobrar: 150,
    tiendaNombre: "Tienda X",
    zonaNombre: "Limón",
    provinciaNombre: "Limón",
    cantonNombre: "Central",
    distritoNombre: "Limón",
    ...over,
  } as RecepcionSateliteDTO;
}

function renderConSwr(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {ui}
    </SWRConfig>,
  );
}

function renderModulosSatelite(asignadas: RecepcionSateliteDTO[]) {
  paginadoBodegaMock.mockResolvedValue({
    status: "ok",
    items: asignadas,
    page: 1,
    pageSize: PAGE_SIZE_SATELITE,
    total: asignadas.length,
  });
  // Caché de SWR nueva por montaje: la clave de la página 1 es la misma en todos los casos,
  // y sin esto el dato del anterior ganaría sobre el `fallbackData` del siguiente (T I.2).
  return renderConSwr(
    <RecepcionSateliteModule
      porRecibir={[
        makeOrdenSatelite({
          id: "b1",
          numRemision: "SAT-RUTA",
          estatusValue: "en_ruta_bodega_satelite",
        }),
      ]}
      ordenesBodega={paginaBodega(asignadas)}
      catalogoFiltros={catalogoSatelite(asignadas)}
      zonaNombre="Limón"
      sinZona={false}
      mensajeros={[]}
      bloqueoBodega={{
        bloqueada: false,
        porMensajeros: false,
        porCierreBodega: false,
        cierresAbiertos: 0,
        totalMensajeros: 2,
        mensajerosConCierreIds: [],
      }}
    />,
  );
}

/** Marca el checkbox de una fila del listado del maestro por su nº de remisión. */
async function seleccionarFila(
  user: ReturnType<typeof userEvent.setup>,
  numRemision: string,
) {
  const checkbox = await screen.findByRole("checkbox", {
    name: `Seleccionar orden ${numRemision}`,
  });
  await user.click(checkbox);
}

beforeEach(() => {
  vi.clearAllMocks();
  listarOrderStatusMock.mockResolvedValue({ status: "ok", estatus: CATALOGO });
  listarOrdenesMock.mockResolvedValue({
    status: "ok",
    items: [makeOrden({ id: "o1" })],
    page: 1,
    pageSize: 25,
    total: 1,
  });
  deshacerAsignacionMock.mockResolvedValue({
    status: "ok",
    resultados: [{ ordenId: "o1", estado: "en_bodega_satelite" }],
  });
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// R34 — listado del maestro: la acción se ofrece en los DOS estados elegibles
// ---------------------------------------------------------------------------
describe("R34 — acción por lote en el listado del maestro", () => {
  it("se ofrece con una selección en `por_recoger`", async () => {
    const user = userEvent.setup();
    renderConSwr(<OrdenesListado accionesLote />);

    await seleccionarFila(user, "REM-o1");

    expect(
      await screen.findByRole("button", { name: ACCION }),
    ).toBeInTheDocument();
  });

  it("se ofrece con una selección en `en_ruta_bodega_satelite` (caso b)", async () => {
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: [
        makeOrden({
          id: "o2",
          estatusId: "est-en_ruta_bodega_satelite",
          estatusValue: "en_ruta_bodega_satelite",
        }),
      ],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    const user = userEvent.setup();
    renderConSwr(<OrdenesListado accionesLote />);

    await seleccionarFila(user, "REM-o2");

    expect(
      await screen.findByRole("button", { name: ACCION }),
    ).toBeInTheDocument();
  });

  it("NO se ofrece en un estado no elegible (`en_bodega_central`)", async () => {
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: [
        makeOrden({
          id: "o3",
          estatusId: "est-en_bodega_central",
          estatusValue: "en_bodega_central",
          zonaEsGam: true,
        }),
      ],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    const user = userEvent.setup();
    renderConSwr(<OrdenesListado accionesLote />);

    await seleccionarFila(user, "REM-o3");

    // La barra de acciones existe (Asignar mensajero / Imprimir etiquetas)...
    expect(
      await screen.findByRole("button", { name: "Asignar mensajero" }),
    ).toBeInTheDocument();
    // ...pero "Deshacer asignación" no aparece.
    expect(screen.queryByRole("button", { name: ACCION })).toBeNull();
  });

  it("el checkbox de `por_recoger` NO se bloquea (Q1: el cierre del mensajero no impide deshacer)", async () => {
    const user = userEvent.setup();
    renderConSwr(<OrdenesListado accionesLote />);

    const checkbox = await screen.findByRole("checkbox", {
      name: "Seleccionar orden REM-o1",
    });
    expect(checkbox).not.toBeDisabled();
    await user.click(checkbox);
    expect(
      await screen.findByRole("button", { name: ACCION }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// R35 / R36 — bodega satélite
// ---------------------------------------------------------------------------
describe("R35/R36 — módulo de la bodega satélite", () => {
  // Rediseño ux: la satélite dejó de tener una sección (y una tabla) POR ESTADO y pasó a UN
  // listado filtrable, así que las `por_recoger` y su acción de lote viven ahí. Lo que la
  // feature 149 exige —que se listen y que la acción sea por lote sobre la selección— no
  // cambia; solo cambia dónde se busca.
  const LISTADO_BODEGA = "Órdenes de la bodega";

  it("R35: lista sus `por_recoger` y ofrece la acción por lote sobre ellas", async () => {
    const user = userEvent.setup();
    renderModulosSatelite([makeOrdenSatelite({ id: "s1" })]);

    const seccion = screen.getByRole("region", { name: LISTADO_BODEGA });
    expect(within(seccion).getByText("SAT-s1")).toBeInTheDocument();

    // Feature 170 — FASE 2 (T K.3, R48): la acción se decide sobre lo SELECCIONADO, no sobre
    // el contenido del listado. Sin nada marcado ya no se ofrece —no hay nada sobre lo que
    // actuar—; antes se pintaba deshabilitada porque miraba el conjunto a la vista, y con la
    // tabla paginada ese conjunto ya no es el del actor.
    expect(within(seccion).queryByRole("button", { name: ACCION })).toBeNull();
    await user.click(
      within(seccion).getByRole("checkbox", { name: "Seleccionar SAT-s1" }),
    );
    expect(within(seccion).getByRole("button", { name: ACCION })).toBeEnabled();
  });

  it("R36: la sección 'Por recibir' (en_ruta_bodega_satelite) NO ofrece deshacer", () => {
    renderModulosSatelite([makeOrdenSatelite({ id: "s1" })]);

    const porRecibir = screen.getByRole("region", { name: "Por recibir" });
    expect(within(porRecibir).queryByRole("button", { name: ACCION })).toBeNull();
    // La orden del caso (b) está listada, pero solo con la acción de recepción.
    expect(within(porRecibir).getAllByText(/SAT-RUTA/).length).toBeGreaterThan(0);
  });

  it("R38: tras el éxito se relee el estado del servidor (router.refresh)", async () => {
    const user = userEvent.setup();
    deshacerAsignacionMock.mockResolvedValue({
      status: "ok",
      resultados: [{ ordenId: "s1", estado: "en_bodega_satelite" }],
    });
    renderModulosSatelite([makeOrdenSatelite({ id: "s1" })]);

    const seccion = screen.getByRole("region", { name: LISTADO_BODEGA });
    await user.click(
      within(seccion).getByRole("checkbox", { name: "Seleccionar SAT-s1" }),
    );
    await user.click(within(seccion).getByRole("button", { name: ACCION }));

    await user.type(await screen.findByLabelText("Motivo"), MOTIVO_OK);
    // El último botón con ese nombre es el confirmar del modal (portal al final del body).
    await user.click(screen.getAllByRole("button", { name: ACCION }).at(-1)!);

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(deshacerAsignacionMock).toHaveBeenCalledWith({
      ordenIds: ["s1"],
      motivo: MOTIVO_OK,
    });
  });
});

// ---------------------------------------------------------------------------
// R37 — motivo OBLIGATORIO (D4): sin motivo válido no se puede confirmar
// ---------------------------------------------------------------------------
describe("R37 — el confirmar depende del motivo", () => {
  function renderModal(props: Partial<Parameters<typeof DeshacerAsignacionModal>[0]> = {}) {
    return render(
      <DeshacerAsignacionModal
        open
        ordenes={[{ id: "o1", numRemision: "REM-o1", zonaNombre: "Limón" }]}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
        {...props}
      />,
    );
  }

  it("sin motivo el botón está deshabilitado", () => {
    renderModal();
    expect(screen.getByRole("button", { name: ACCION })).toBeDisabled();
  });

  it("con un motivo demasiado corto (o solo espacios) sigue deshabilitado", async () => {
    const user = userEvent.setup();
    renderModal();
    const campo = screen.getByLabelText("Motivo");

    await user.type(campo, "corto");
    expect(screen.getByRole("button", { name: ACCION })).toBeDisabled();

    await user.clear(campo);
    await user.type(campo, "          "); // 10 espacios: trim -> ""
    expect(screen.getByRole("button", { name: ACCION })).toBeDisabled();
  });

  it("con un motivo válido se habilita y la acción se invoca UNA vez con el lote completo", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    render(
      <DeshacerAsignacionModal
        open
        ordenes={[
          { id: "o1", numRemision: "REM-o1" },
          { id: "o2", numRemision: "REM-o2" },
        ]}
        onOpenChange={vi.fn()}
        onSuccess={onSuccess}
      />,
    );

    await user.type(screen.getByLabelText("Motivo"), `  ${MOTIVO_OK}  `);
    const boton = screen.getByRole("button", { name: ACCION });
    expect(boton).toBeEnabled();
    await user.click(boton);

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    // R20/R24: UNA llamada, con TODO el lote y el motivo YA recortado.
    expect(deshacerAsignacionMock).toHaveBeenCalledTimes(1);
    expect(deshacerAsignacionMock).toHaveBeenCalledWith({
      ordenIds: ["o1", "o2"],
      motivo: MOTIVO_OK,
    });
  });

  it("el predicado de validez es el mismo del borde (10..300 tras recortar)", () => {
    expect(motivoValido("")).toBe(false);
    expect(motivoValido("   ")).toBe(false);
    expect(motivoValido("x".repeat(MOTIVO_MIN_LEN - 1))).toBe(false);
    expect(motivoValido("x".repeat(MOTIVO_MIN_LEN))).toBe(true);
    expect(motivoValido("x".repeat(300))).toBe(true);
    expect(motivoValido("x".repeat(301))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R38 — éxito: revalidación del listado + aviso con el número de órdenes
// ---------------------------------------------------------------------------
describe("R38 — éxito en el listado del maestro", () => {
  it("revalida el listado y avisa cuántas órdenes se revirtieron", async () => {
    const user = userEvent.setup();
    deshacerAsignacionMock.mockResolvedValue({
      status: "ok",
      resultados: [{ ordenId: "o1", estado: "en_bodega_satelite" }],
    });
    renderConSwr(<OrdenesListado accionesLote />);

    await seleccionarFila(user, "REM-o1");
    await user.click(await screen.findByRole("button", { name: ACCION }));
    await user.type(await screen.findByLabelText("Motivo"), MOTIVO_OK);

    const llamadasPrevias = listarOrdenesMock.mock.calls.length;
    await user.click(screen.getAllByRole("button", { name: ACCION }).at(-1)!);

    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith("1 orden(es) devuelta(s) a bodega."),
    );
    // R38: se relee el estado del servidor (la orden revertida sale de este listado).
    await waitFor(() =>
      expect(listarOrdenesMock.mock.calls.length).toBeGreaterThan(llamadasPrevias),
    );
  });

  it("un fallo muestra el mensaje accionable y NO avisa de éxito", async () => {
    const user = userEvent.setup();
    deshacerAsignacionMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: msgEstadoNoReversible("en_reparto") }],
    });
    renderConSwr(<OrdenesListado accionesLote />);

    await seleccionarFila(user, "REM-o1");
    await user.click(await screen.findByRole("button", { name: ACCION }));
    await user.type(await screen.findByLabelText("Motivo"), MOTIVO_OK);
    await user.click(screen.getAllByRole("button", { name: ACCION }).at(-1)!);

    await waitFor(() => expect(errorMock).toHaveBeenCalledTimes(1));
    expect(errorMock.mock.calls[0][0]).toContain(ORDER_STATUS_LABELS.en_reparto);
    expect(successMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// R39 — un mensaje accionable DISTINTO por causa (y sin identificadores internos)
// ---------------------------------------------------------------------------
describe("R39 — mensajes accionables por causa", () => {
  const casos: Array<[string, unknown]> = [
    ["sin permiso / zona ajena", { status: "forbidden" }],
    ["sin zona asignada", { status: "sin_zona" }],
    ["sesión expirada", { status: "unauthenticated" }],
    ["motivo inválido", { status: "validation_error", fieldErrors: { motivo: ["x"] } }],
    [
      "catálogo incompleto",
      { status: "validation_error", fieldErrors: { estatus: [MSG_CATALOGO_INCOMPLETO] } },
    ],
    [
      "zona central sin configurar",
      { status: "validation_error", fieldErrors: { zona: [MSG_ZONA_CENTRAL_NO_CONFIGURADA] } },
    ],
    [
      "orden ya recogida",
      { status: "conflict", detalle: [{ ordenId: "x", motivo: msgEstadoNoReversible("en_reparto") }] },
    ],
    [
      "orden ya recibida en satélite",
      {
        status: "conflict",
        detalle: [{ ordenId: "x", motivo: msgEstadoNoReversible("en_bodega_satelite") }],
      },
    ],
    [
      "orden borrada",
      { status: "conflict", detalle: [{ ordenId: "x", motivo: MSG_ORDEN_BORRADA }] },
    ],
    [
      "orden inexistente",
      { status: "conflict", detalle: [{ ordenId: "x", motivo: MSG_ORDEN_NO_EXISTE }] },
    ],
    [
      "sin historial para derivar",
      { status: "conflict", detalle: [{ ordenId: "x", motivo: MSG_SIN_HISTORIAL }] },
    ],
    [
      "incoherencia zona/destino",
      { status: "conflict", detalle: [{ ordenId: "x", motivo: MSG_ZONA_DESTINO_INCOHERENTE }] },
    ],
    ["carrera", { status: "conflict", detalle: [{ ordenId: "x", motivo: MSG_CARRERA }] }],
  ];

  it.each(casos)("%s produce un mensaje propio", (_nombre, resultado) => {
    const mensaje = deshacerAsignacionErrorMessage(resultado);
    expect(mensaje.length).toBeGreaterThan(0);
    expect(mensaje).not.toBe("No se pudo deshacer la asignación."); // no cae al fallback
  });

  it("los mensajes son DISTINTOS entre sí (una causa, una salida)", () => {
    const mensajes = casos.map(([, resultado]) =>
      deshacerAsignacionErrorMessage(resultado),
    );
    // Las dos variantes de "estado no reversible" nombran estados distintos, así que el
    // conjunto completo no tiene repetidos.
    expect(new Set(mensajes).size).toBe(mensajes.length);
  });

  it("R40: ningún mensaje expone UUIDs ni el motivo crudo del backend", () => {
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    for (const [, resultado] of casos) {
      const mensaje = deshacerAsignacionErrorMessage(resultado);
      expect(mensaje).not.toMatch(uuid);
    }
    // Un motivo desconocido (backend más nuevo que la UI) no se filtra tal cual.
    const desconocido = deshacerAsignacionErrorMessage({
      status: "conflict",
      detalle: [{ ordenId: "x", motivo: "motivo-interno-no-mapeado" }],
    });
    expect(desconocido).not.toContain("motivo-interno-no-mapeado");
  });

  it("un status desconocido cae en el mensaje genérico", () => {
    expect(deshacerAsignacionErrorMessage({ status: "vaya" })).toBe(
      "No se pudo deshacer la asignación.",
    );
    expect(deshacerAsignacionErrorMessage(undefined)).toBe(
      "No se pudo deshacer la asignación.",
    );
  });

  it("el `validation_error` del motivo usa el texto del campo", () => {
    expect(
      deshacerAsignacionErrorMessage({
        status: "validation_error",
        fieldErrors: { motivo: ["lo que diga zod"] },
      }),
    ).toBe(MOTIVO_INVALIDO);
  });
});
