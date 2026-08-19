// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { RecepcionSateliteModule } from "@/app/(app)/recepcion-satelite/_components/RecepcionSateliteModule";
import {
  PAGE_SIZE_SATELITE,
  catalogoSatelite,
  paginaBodega,
} from "@/tests/fixtures/satelite-bodega";
import { ORDER_STATUS_LABELS } from "@/app/(app)/ordenes/_components/EstatusBadge";
import { enviarACentral } from "@/lib/actions/envio-devolucion-central";
import { recibirLote } from "@/lib/actions/recepcion-satelite";
import { recuperarABodega } from "@/lib/actions/resolver-novedad";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";

// Feature 33 (T12) — módulo de la bodega satélite. Se mockean la Server Action de
// recepción, el toast, el router (refresh) y la lib de cámara (sin hardware en CI).
// Feature 63: se mockea también `recibirLote` (la recepción "Aceptar" por-orden, que
// viaja por el mismo camino en lote con UN id) que consume la sección compartida
// "Por recibir". Pedido humano del 2026-08-19: ya no hay "Aceptar todas".
// Feature 170 — FASE 2 (T K.3): el listado de la bodega pide su página al servidor. El doble
// devuelve las órdenes que el caso monta, sin recortar: aquí no se pagina nada (eso lo mide
// `tests/components/paginacion/SatelitePaginacion.test.tsx`).
const { paginadoBodegaMock } = vi.hoisted(() => ({ paginadoBodegaMock: vi.fn() }));
vi.mock("@/lib/actions/recepcion-satelite", () => ({
  recibirPorQr: vi.fn(),
  listarRecepcionSatelite: vi.fn(),
  asignarDesdeSatelite: vi.fn(),
  recibirLote: vi.fn(),
  listarOrdenesBodegaPaginado: (...a: unknown[]) => paginadoBodegaMock(...a),
  // Feature 184 — Tanda A (T A.4/T A.5): el modulo importa las DOS acciones nuevas —el
  // conjunto de la descarga y la vigencia con la que poda la seleccion—, asi que el doble
  // tiene que declararlas o el modulo revienta al importarlo. Aqui no se invocan: no se
  // descarga nada y no hay marcas fuera de la pagina visible (el listado cabe entero).
  listarOrdenesBodegaCompleto: vi.fn(async () => ({ status: "ok", items: [], total: 0 })),
  listarIdsVigentesBodega: vi.fn(async () => ({ status: "ok", ids: [] })),
}));

const recibirLoteMock = vi.mocked(recibirLote);

// Feature 139 (T3.3): la sección "Por devolver" envía POR LOTE a la bodega central vía
// esta Server Action; se mockea para verificar la invocación por selección.
vi.mock("@/lib/actions/envio-devolucion-central", () => ({
  enviarACentral: vi.fn(),
}));

const enviarACentralMock = vi.mocked(enviarACentral);

// Feature 100 (T4.1): la sección "Devueltas" ejecuta la recuperación vía esta Server
// Action; se mockea para verificar la invocación por fila (R12).
vi.mock("@/lib/actions/resolver-novedad", () => ({
  recuperarABodega: vi.fn(),
}));

const recuperarABodegaMock = vi.mocked(recuperarABodega);

const { refreshMock, successMock, errorMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  successMock: vi.fn(),
  errorMock: vi.fn(),
}));

// R9: el estado legible de "Recibidas" se COMPONE como "<etiqueta del estado> de
// <zona>". Lo verificado es esa composición, no el texto de la etiqueta: por eso la
// parte del estado sale del mapa de presentación (fuente de verdad) y solo el
// " de <zona>" queda literal. Los literales del mapa los blinda
// `tests/components/EstatusLabel.test.ts`.
const ESTADO_SATELITE_LIMON = `${ORDER_STATUS_LABELS.en_bodega_satelite} de Limón`;

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

// La cámara nunca se abre en estos tests; el mock evita cargar el módulo real.
vi.mock("html5-qrcode", () => ({ Html5Qrcode: vi.fn() }));

function makeOrden(
  over: Partial<RecepcionSateliteDTO> & { id: string },
): RecepcionSateliteDTO {
  return {
    numGuia: 1001,
    numRemision: "REM-001",
    estatusValue: "en_ruta_bodega_satelite",
    destinatario: "Ana Pérez",
    telefonoDest: "88880000",
    direccion: "Calle 1, casa 2",
    producto: "Caja mediana",
    montoCobrar: 150,
    tiendaNombre: "Tienda X",
    zonaNombre: "Limón",
    provinciaNombre: "Limón",
    cantonNombre: "Central",
    distritoNombre: "Limón",
    ...over,
  };
}

/**
 * Feature 170 — FASE 2 (T K.3): el módulo ya no recibe los cinco arrays por estado, sino UNA
 * PÁGINA del listado. Los casos siguen describiendo la bodega por GRUPOS —que es como se
 * lee— y este andamiaje los concatena en el orden del flujo, igual que hacía el módulo, para
 * armar la página, el catálogo y el doble de la Server Action.
 */
type GruposBodega = Partial<
  Record<
    | "porRecibir"
    | "recibidas"
    | "asignadas"
    | "porDevolver"
    | "enTransitoACentral"
    | "devueltas",
    RecepcionSateliteDTO[]
  >
>;
type PropsModulo = Omit<
  Partial<Parameters<typeof RecepcionSateliteModule>[0]>,
  "porRecibir" | "ordenesBodega" | "catalogoFiltros"
>;

function renderModule(props?: GruposBodega & PropsModulo) {
  const conjunto = [
    ...(props?.recibidas ?? []),
    ...(props?.asignadas ?? []),
    ...(props?.porDevolver ?? []),
    ...(props?.enTransitoACentral ?? []),
    ...(props?.devueltas ?? []),
  ];
  paginadoBodegaMock.mockResolvedValue({
    status: "ok",
    items: conjunto,
    page: 1,
    pageSize: PAGE_SIZE_SATELITE,
    total: conjunto.length,
  });
  // Caché de SWR NUEVA por montaje: la clave de la página 1 es la misma en todos los casos
  // del archivo, así que sin esto el dato del caso anterior ganaría sobre el `fallbackData`
  // del siguiente y la tabla pintaría las órdenes de otro test (medido en T I.2).
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <RecepcionSateliteModule
        porRecibir={props?.porRecibir ?? []}
        ordenesBodega={paginaBodega(conjunto)}
        catalogoFiltros={catalogoSatelite(conjunto)}
        zonaNombre={props?.zonaNombre ?? "Limón"}
        sinZona={props?.sinZona ?? false}
        mensajeros={props?.mensajeros ?? [{ id: "m1", nombre: "Ana Mensajera" }]}
        bloqueoBodega={
          props?.bloqueoBodega ?? {
            bloqueada: false,
            porMensajeros: false,
            porCierreBodega: false,
          }
        }
        liberadasHoy={props?.liberadasHoy ?? []}
      />
    </SWRConfig>,
  );
}

/**
 * El acceso al receptor por guía/escaneo, esté la tarjeta plegada o no. Desde el 2026-07-31
 * (decisión del humano) la tarjeta vive plegada tras este disparador: dentro vive
 * `QrScanner` y montada dejaba la cámara ENCENDIDA todo el rato que la bodega tuviera la
 * pantalla abierta. Lo que hay dentro lo fija `EscanerRecepcion.test.tsx`.
 */
const accesoReceptor = () =>
  screen.queryByRole("button", { name: "Recibir paquete" });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// Pedido humano (rama ux): las cuatro secciones por estado (Recibidas / Por devolver /
// En tránsito a central / Devueltas) se fundieron en UN listado con barra de filtros, al
// estilo del listado del admin. Las pruebas se reapuntan a esa región y tabla únicas; las
// acciones ya no viven en la cabecera de cada sección, sino como acciones de LOTE que
// aparecen al seleccionar filas del mismo estado.
const LISTADO = "Órdenes de la bodega";

describe("RecepcionSateliteModule", () => {
  it("R6/R8: muestra DOS secciones separadas 'Por recibir' y 'Recibidas'", () => {
    renderModule({
      porRecibir: [makeOrden({ id: "r1", numRemision: "REM-R1" })],
      recibidas: [
        makeOrden({
          id: "b1",
          numRemision: "REM-B1",
          estatusValue: "en_bodega_satelite",
        }),
      ],
    });

    expect(
      screen.getByRole("region", { name: "Por recibir" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: LISTADO })).toBeInTheDocument();
  });

  it("Feature 63: la sección 'Por recibir' expone 'Aceptar' por-orden (sin lote) y NO asignar/gestionar", () => {
    renderModule({
      porRecibir: [
        makeOrden({ id: "r1", numRemision: "REM-R1" }),
        makeOrden({ id: "r2", numRemision: "REM-R2" }),
      ],
    });

    const region = screen.getByRole("region", { name: "Por recibir" });
    // Pedido humano del 2026-08-19: NO hay acción en lote…
    expect(within(region).queryByRole("button", { name: /todas/i })).toBeNull();
    // …sólo una acción por-orden por cada tarjeta.
    expect(
      within(region).getAllByRole("button", { name: "Aceptar" }),
    ).toHaveLength(2);
    // Sigue SIN exponer asignar/gestionar en esta sección.
    expect(
      within(region).queryByRole("button", { name: /asignar|gestionar/i }),
    ).toBeNull();
  });

  it("R9: 'Recibidas' renderiza el estado legible '<etiqueta del estado> de <zona>'", () => {
    renderModule({
      recibidas: [
        makeOrden({
          id: "b1",
          numRemision: "REM-B1",
          estatusValue: "en_bodega_satelite",
          zonaNombre: "Limón",
        }),
      ],
      zonaNombre: "Limón",
    });

    const region = screen.getByRole("region", { name: LISTADO });
    expect(
      within(region).getByText(ESTADO_SATELITE_LIMON),
    ).toBeInTheDocument();
  });

  it("R8: 'Recibidas' lista las órdenes en_bodega_satelite de la zona", () => {
    renderModule({
      recibidas: [
        makeOrden({
          id: "b1",
          numRemision: "REM-RECIBIDA",
          destinatario: "Beto Ruiz",
          estatusValue: "en_bodega_satelite",
        }),
      ],
    });

    const region = screen.getByRole("region", { name: LISTADO });
    // El texto aparece tanto en el título de la card como en el detalle.
    expect(within(region).getAllByText(/REM-RECIBIDA/).length).toBeGreaterThan(0);
    expect(within(region).getAllByText(/Beto Ruiz/).length).toBeGreaterThan(0);
  });

  it("R5: si sinZona, muestra aviso accionable y NO ofrece el escáner", () => {
    renderModule({ sinZona: true, zonaNombre: null });

    expect(screen.getByRole("alert")).toHaveTextContent(
      /no tienes una zona asignada/i,
    );
    // Sin zona → sin recepción posible: no se monta la sección de escaneo, ni siquiera su
    // acceso (el disparador del desplegable).
    expect(accesoReceptor()).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Recepción por escaneo" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Escanear con cámara" }),
    ).toBeNull();
  });

  // El camino del lector físico (input keyboard-wedge, R10) se retiró por decisión
  // humana: la cámara es la ÚNICA entrada de recepción por escaneo.
  // Pedido humano (rama ux): la recepción se opera igual que la recogida del mensajero
  // (cámara O número tecleado, misma tarjeta) y solo se ofrece si hay algo por recibir.
  it("con zona y órdenes por recibir, ofrece cámara y número de guía tecleado", async () => {
    const user = userEvent.setup();
    renderModule({
      sinZona: false,
      porRecibir: [makeOrden({ id: "r1", numRemision: "REM-R1" })],
    });

    // La tarjeta arranca plegada (la cámara no se enciende sola): el acceso está y al
    // abrirlo aparecen los dos caminos.
    await user.click(screen.getByRole("button", { name: "Recibir paquete" }));
    const region = screen.getByRole("region", {
      name: "Recibir por número de guía o escaneo",
    });
    expect(
      within(region).getByRole("button", { name: "Escanear con cámara" }),
    ).toBeInTheDocument();
    expect(within(region).getByRole("textbox")).toBeInTheDocument();
  });

  it("sin órdenes por recibir no se muestra la tarjeta de recepción ni la sección", () => {
    renderModule({ sinZona: false, porRecibir: [] });

    expect(accesoReceptor()).toBeNull();
    expect(
      screen.queryByRole("region", {
        name: "Recibir por número de guía o escaneo",
      }),
    ).toBeNull();
    expect(screen.queryByRole("region", { name: "Por recibir" })).toBeNull();
  });

  // ---------- Feature 34 (T8) ----------

  it("R4 (34): 'Recibidas' permite seleccionar órdenes y habilita 'Asignar'", async () => {
    const user = userEvent.setup();
    renderModule({
      recibidas: [
        makeOrden({
          id: "b1",
          numRemision: "REM-B1",
          estatusValue: "en_bodega_satelite",
        }),
      ],
    });

    const region = screen.getByRole("region", { name: LISTADO });
    // Feature 170 — FASE 2 (T K.3, R48): la acción se decide sobre lo SELECCIONADO. Sin nada
    // marcado no se ofrece; antes se pintaba deshabilitada porque miraba el contenido del
    // listado, que era todo el conjunto del actor y con la tabla paginada ya no lo es.
    expect(within(region).queryByRole("button", { name: "Asignar" })).toBeNull();

    const checkbox = within(region).getByRole("checkbox", {
      name: "Seleccionar REM-B1",
    });
    await user.click(checkbox);

    expect(within(region).getByRole("button", { name: "Asignar" })).toBeEnabled();
  });

  it("Pedido humano: 'Recibidas' se renderiza como TABLA (DataTable) con sus columnas y una fila por orden", () => {
    renderModule({
      recibidas: [
        makeOrden({
          id: "b1",
          numGuia: 2002,
          numRemision: "REM-B1",
          destinatario: "Beto Ruiz",
          producto: "Caja grande",
          direccion: "Av. Central 10",
          tiendaNombre: "Tienda Z",
          montoCobrar: 320,
          estatusValue: "en_bodega_satelite",
          zonaNombre: "Limón",
        }),
      ],
      zonaNombre: "Limón",
    });

    const region = screen.getByRole("region", { name: LISTADO });
    // Es una tabla, no una lista de cards.
    const tabla = within(region).getByRole("table", { name: LISTADO });
    // Cabeceras: la de selección (checkbox "seleccionar todo", sin texto) + las de
    // datos espejadas de ordenes-columns.
    const headers = within(tabla)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toEqual([
      "",
      "Nº Guía",
      "Nº Remisión",
      "Estado",
      // Feature 160 (R17/R25): columna propia, misma posición relativa que en
      // `/ordenes` (justo tras "Estado").
      "Intentos",
      "Destinatario",
      "Producto",
      "Dirección",
      "Tienda",
      "Zona",
      "Provincia",
      "Cantón",
      "Distrito",
      "Monto a cobrar",
      // Feature 158 (T2.7, decisión del humano del 2026-07-30): acción POR FILA "Reportar
      // incidente". `en_bodega_satelite` es uno de los cinco orígenes del conjunto cerrado y
      // el adminSatelite tiene el paquete delante. Va al FINAL, como columna de acción.
      "Incidente",
    ]);
    // La fila muestra los datos de la orden en columnas.
    expect(within(tabla).getByText("REM-B1")).toBeInTheDocument();
    expect(within(tabla).getByText("Beto Ruiz")).toBeInTheDocument();
    expect(within(tabla).getByText("Caja grande")).toBeInTheDocument();
    expect(within(tabla).getByText("Av. Central 10")).toBeInTheDocument();
    expect(within(tabla).getByText("Tienda Z")).toBeInTheDocument();
    expect(
      within(tabla).getByText(ESTADO_SATELITE_LIMON),
    ).toBeInTheDocument();
    // Una fila de datos (más la de cabecera).
    expect(within(tabla).getAllByRole("row")).toHaveLength(2);
    // La cabecera de la columna de selección es un checkbox "seleccionar todo".
    expect(
      within(tabla).getByRole("checkbox", {
        name: "Seleccionar todas las órdenes de esta página",
      }),
    ).toBeInTheDocument();
  });

  it("Pedido humano: el checkbox de cabecera marca/desmarca todas las recibidas", async () => {
    const user = userEvent.setup();
    renderModule({
      recibidas: [
        makeOrden({
          id: "b1",
          numRemision: "REM-B1",
          estatusValue: "en_bodega_satelite",
          zonaNombre: "Limón",
        }),
        makeOrden({
          id: "b2",
          numRemision: "REM-B2",
          estatusValue: "en_bodega_satelite",
          zonaNombre: "Limón",
        }),
      ],
      zonaNombre: "Limón",
    });

    const tabla = screen.getByRole("table", { name: LISTADO });
    const seleccionarTodo = within(tabla).getByRole("checkbox", {
      name: "Seleccionar todas las órdenes de esta página",
    });
    const fila1 = within(tabla).getByRole("checkbox", { name: "Seleccionar REM-B1" });
    const fila2 = within(tabla).getByRole("checkbox", { name: "Seleccionar REM-B2" });

    // Marca todas.
    await user.click(seleccionarTodo);
    expect(fila1).toBeChecked();
    expect(fila2).toBeChecked();

    // Desmarca todas.
    await user.click(seleccionarTodo);
    expect(fila1).not.toBeChecked();
    expect(fila2).not.toBeChecked();
  });

  it("Pedido humano: 'Nº Guía' vacía se muestra como 'Pendiente' en la tabla", () => {
    renderModule({
      recibidas: [
        makeOrden({
          id: "b1",
          numGuia: null,
          numRemision: "REM-B1",
          estatusValue: "en_bodega_satelite",
        }),
      ],
    });

    const tabla = within(
      screen.getByRole("region", { name: LISTADO }),
    ).getByRole("table", { name: LISTADO });
    expect(within(tabla).getByText("Pendiente")).toBeInTheDocument();
  });

  it("Pedido humano: sin órdenes recibidas la tabla muestra el vacío", () => {
    renderModule({ recibidas: [] });

    const tabla = within(
      screen.getByRole("region", { name: LISTADO }),
    ).getByRole("table", { name: LISTADO });
    expect(
      within(tabla).getByText("No hay órdenes en la bodega."),
    ).toBeInTheDocument();
  });

  it("Pedido humano: la selección por checkbox en la tabla habilita 'Asignar' y alimenta el modal", async () => {
    const user = userEvent.setup();
    renderModule({
      recibidas: [
        makeOrden({
          id: "b1",
          numRemision: "REM-B1",
          destinatario: "Beto Ruiz",
          estatusValue: "en_bodega_satelite",
        }),
      ],
    });

    const region = screen.getByRole("region", { name: LISTADO });
    const tabla = within(region).getByRole("table", { name: LISTADO });
    // R48: sin selección no hay acción de lote que ofrecer.
    expect(within(region).queryByRole("button", { name: "Asignar" })).toBeNull();

    await user.click(
      within(tabla).getByRole("checkbox", { name: "Seleccionar REM-B1" }),
    );
    const asignar = within(region).getByRole("button", { name: "Asignar" });
    expect(asignar).toBeEnabled();

    // Abre el modal de asignación (feature 34) con la orden seleccionada.
    await user.click(asignar);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText(/REM-B1/).length).toBeGreaterThan(0);
  });

  it("R7 (33, no regresión): 'Por recibir' NO ofrece seleccionar ni asignar", () => {
    renderModule({
      porRecibir: [makeOrden({ id: "r1", numRemision: "REM-R1" })],
      recibidas: [
        makeOrden({
          id: "b1",
          numRemision: "REM-B1",
          estatusValue: "en_bodega_satelite",
        }),
      ],
    });

    const porRecibir = screen.getByRole("region", { name: "Por recibir" });
    // Ni checkbox de selección ni botón de asignar en "Por recibir".
    expect(within(porRecibir).queryByRole("checkbox")).toBeNull();
    expect(
      within(porRecibir).queryByRole("button", { name: /asignar/i }),
    ).toBeNull();
  });

  // ---------- Feature 41 (F3, R22) ----------

  it("R22: bodega bloqueada por SUS MENSAJEROS (i) muestra el aviso de esa causa y deshabilita 'Asignar'", async () => {
    const user = userEvent.setup();
    renderModule({
      recibidas: [
        makeOrden({
          id: "b1",
          numRemision: "REM-B1",
          estatusValue: "en_bodega_satelite",
        }),
      ],
      bloqueoBodega: {
        bloqueada: true,
        porMensajeros: true,
        porCierreBodega: false,
      },
    });

    // El aviso de bloqueo precede al listado (no está dentro de su región).
    const alerta = screen.getByRole("alert");
    const region = screen.getByRole("region", { name: LISTADO });
    expect(alerta).toHaveTextContent(/resuelve los cierres pendientes de tus mensajeros/i);
    expect(alerta).not.toHaveTextContent(/cierre de bodega hacia la central/i);

    // Aun seleccionando una orden, "Asignar" queda deshabilitado por el bloqueo.
    const checkbox = within(region).getByRole("checkbox", {
      name: "Seleccionar REM-B1",
    });
    await user.click(checkbox);
    expect(within(region).getByRole("button", { name: "Asignar" })).toBeDisabled();
  });

  it("R22: bodega bloqueada por CIERRE DE BODEGA (ii) muestra el aviso de esa causa", async () => {
    const user = userEvent.setup();
    renderModule({
      recibidas: [
        makeOrden({
          id: "b1",
          numRemision: "REM-B1",
          estatusValue: "en_bodega_satelite",
        }),
      ],
      bloqueoBodega: {
        bloqueada: true,
        porMensajeros: false,
        porCierreBodega: true,
      },
    });

    // El aviso de bloqueo precede al listado (no está dentro de su región).
    const alerta = screen.getByRole("alert");
    const region = screen.getByRole("region", { name: LISTADO });
    expect(alerta).toHaveTextContent(/cierre de bodega hacia la central está pendiente de aprobación/i);
    expect(alerta).not.toHaveTextContent(/resuelve los cierres pendientes de tus mensajeros/i);
    // R48: la acción se ofrece al marcar, y el bloqueo la deja deshabilitada.
    await user.click(
      within(region).getByRole("checkbox", { name: "Seleccionar REM-B1" }),
    );
    expect(within(region).getByRole("button", { name: "Asignar" })).toBeDisabled();
  });

  it("R22: bloqueada por AMBAS causas lista las dos líneas accionables", () => {
    renderModule({
      recibidas: [
        makeOrden({
          id: "b1",
          numRemision: "REM-B1",
          estatusValue: "en_bodega_satelite",
        }),
      ],
      bloqueoBodega: {
        bloqueada: true,
        porMensajeros: true,
        porCierreBodega: true,
      },
    });

    // El aviso precede al listado (no está dentro de su región).
    const alerta = screen.getByRole("alert");
    expect(alerta).toHaveTextContent(/resuelve los cierres pendientes de tus mensajeros/i);
    expect(alerta).toHaveTextContent(/cierre de bodega hacia la central/i);
  });

  it("R22: sin bloqueo NO muestra aviso y 'Asignar' se habilita al seleccionar", async () => {
    const user = userEvent.setup();
    renderModule({
      recibidas: [
        makeOrden({
          id: "b1",
          numRemision: "REM-B1",
          estatusValue: "en_bodega_satelite",
        }),
      ],
    });

    const region = screen.getByRole("region", { name: LISTADO });
    expect(within(region).queryByRole("alert")).toBeNull();
    await user.click(
      within(region).getByRole("checkbox", { name: "Seleccionar REM-B1" }),
    );
    expect(within(region).getByRole("button", { name: "Asignar" })).toBeEnabled();
  });

  // ---------- Feature 139 (T3.3) — "Por devolver" por lote a bodega central ----------

  it("R13/R21: 'Por devolver' es una TABLA seleccionable de las órdenes por_devolver + botón 'Enviar a central'", async () => {
    const user = userEvent.setup();
    renderModule({
      porDevolver: [
        makeOrden({
          id: "d1",
          numRemision: "REM-PORDEV",
          destinatario: "Caro Díaz",
          estatusValue: "por_devolver",
        }),
      ],
    });

    const region = screen.getByRole("region", { name: LISTADO });
    // Es una tabla (patrón "Recibidas"), no cards con botón por fila.
    const tabla = within(region).getByRole("table", { name: LISTADO });
    expect(within(tabla).getByText("REM-PORDEV")).toBeInTheDocument();
    expect(within(tabla).getAllByText(/Caro Díaz/).length).toBeGreaterThan(0);
    // Checkbox de selección por fila + botón de acción por lote sobre lo marcado (R48).
    const checkbox = within(tabla).getByRole("checkbox", {
      name: "Seleccionar REM-PORDEV",
    });
    expect(checkbox).toBeInTheDocument();
    await user.click(checkbox);
    expect(
      within(region).getByRole("button", { name: "Enviar a central" }),
    ).toBeInTheDocument();
  });

  it("R13/R48: sin selección 'Enviar a central' no se ofrece; al seleccionar aparece habilitado", async () => {
    const user = userEvent.setup();
    renderModule({
      porDevolver: [
        makeOrden({
          id: "d1",
          numRemision: "REM-PORDEV",
          estatusValue: "por_devolver",
        }),
      ],
    });

    const region = screen.getByRole("region", { name: LISTADO });
    // Feature 170 — FASE 2 (T K.3, R48): la decisión se toma sobre lo SELECCIONADO. Sin nada
    // marcado no hay lote, así que no hay botón; antes se pintaba deshabilitado mirando el
    // contenido del listado.
    expect(
      within(region).queryByRole("button", { name: "Enviar a central" }),
    ).toBeNull();

    await user.click(
      within(region).getByRole("checkbox", { name: "Seleccionar REM-PORDEV" }),
    );
    expect(
      within(region).getByRole("button", { name: "Enviar a central" }),
    ).toBeEnabled();
  });

  it("R13: 'Enviar a central' dispara enviarACentral por cada seleccionada y en éxito refresca", async () => {
    const user = userEvent.setup();
    enviarACentralMock.mockResolvedValue({ status: "ok" });
    renderModule({
      porDevolver: [
        makeOrden({ id: "d1", numRemision: "REM-A", estatusValue: "por_devolver" }),
        makeOrden({ id: "d2", numRemision: "REM-B", estatusValue: "por_devolver" }),
      ],
    });

    const region = screen.getByRole("region", { name: LISTADO });
    // Selecciona todas con el checkbox de cabecera.
    await user.click(
      within(region).getByRole("checkbox", {
        name: "Seleccionar todas las órdenes de esta página",
      }),
    );
    await user.click(
      within(region).getByRole("button", { name: "Enviar a central" }),
    );

    await vi.waitFor(() =>
      expect(enviarACentralMock).toHaveBeenCalledTimes(2),
    );
    expect(enviarACentralMock).toHaveBeenCalledWith({ ordenId: "d1" });
    expect(enviarACentralMock).toHaveBeenCalledWith({ ordenId: "d2" });
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("R13: un resultado no-ok se reporta por toast de error (y aun así refresca)", async () => {
    const user = userEvent.setup();
    enviarACentralMock.mockResolvedValue({ status: "conflict", motivo: "estado" });
    renderModule({
      porDevolver: [
        makeOrden({ id: "d1", numRemision: "REM-A", estatusValue: "por_devolver" }),
      ],
    });

    const region = screen.getByRole("region", { name: LISTADO });
    await user.click(
      within(region).getByRole("checkbox", { name: "Seleccionar REM-A" }),
    );
    await user.click(
      within(region).getByRole("button", { name: "Enviar a central" }),
    );

    await vi.waitFor(() => expect(enviarACentralMock).toHaveBeenCalledTimes(1));
    expect(errorMock).toHaveBeenCalledWith(
      expect.stringMatching(/por devolver/i),
    );
  });

  it("sin órdenes por devolver la tabla muestra el vacío y no hay 'Enviar a central' activo", () => {
    renderModule({ porDevolver: [] });

    const region = screen.getByRole("region", { name: LISTADO });
    const tabla = within(region).getByRole("table", { name: LISTADO });
    expect(
      within(tabla).getByText("No hay órdenes en la bodega."),
    ).toBeInTheDocument();
    // Sin órdenes `por_devolver` la acción ni siquiera se ofrece.
    expect(
      within(region).queryByRole("button", { name: "Enviar a central" }),
    ).toBeNull();
  });

  // ---------- Feature 139 (T3.3) — "En tránsito a central" (informativa) ----------

  it("R21: 'En tránsito a central' lista las devolviendo_a_bodega_central SIN acción (read-only)", () => {
    renderModule({
      enTransitoACentral: [
        makeOrden({
          id: "t1",
          numRemision: "REM-TRANSITO",
          estatusValue: "devolviendo_a_bodega_central",
        }),
      ],
    });

    const region = screen.getByRole("region", { name: LISTADO });
    const tabla = within(region).getByRole("table", { name: LISTADO });
    expect(within(tabla).getByText("REM-TRANSITO")).toBeInTheDocument();
    // Informativa: no hay NINGUNA acción de lote para este estado (ni asignar, ni
    // enviar a central, ni recuperar), aunque la fila se pueda seleccionar.
    for (const accion of ["Asignar", "Enviar a central", "Recuperar"]) {
      expect(within(region).queryByRole("button", { name: accion })).toBeNull();
    }
  });

  it("R21: 'En tránsito a central' sin órdenes muestra el vacío", () => {
    renderModule({ enTransitoACentral: [] });

    const region = screen.getByRole("region", { name: LISTADO });
    const tabla = within(region).getByRole("table", { name: LISTADO });
    expect(
      within(tabla).getByText("No hay órdenes en la bodega."),
    ).toBeInTheDocument();
  });

  // ---------- Feature 100 (T4.1) — recuperar a bodega (devueltas) ----------

  it("R12: 'Devueltas' lista las órdenes devuelta de la zona con su botón 'Recuperar'", async () => {
    const user = userEvent.setup();
    renderModule({
      devueltas: [
        makeOrden({
          id: "n1",
          numRemision: "REM-DEVUELTA",
          destinatario: "Caro Díaz",
          estatusValue: "devuelta",
        }),
      ],
    });

    const region = screen.getByRole("region", { name: LISTADO });
    expect(within(region).getAllByText(/REM-DEVUELTA/).length).toBeGreaterThan(0);
    expect(within(region).getAllByText(/Caro Díaz/).length).toBeGreaterThan(0);
    // R48: la acción aparece al marcar la fila, no por estar la orden en el listado.
    await user.click(
      within(region).getByRole("checkbox", { name: "Seleccionar REM-DEVUELTA" }),
    );
    expect(
      within(region).getByRole("button", { name: "Recuperar" }),
    ).toBeInTheDocument();
  });

  it("R12: 'Recuperar' dispara recuperarABodega con el ordenId y en éxito refresca", async () => {
    const user = userEvent.setup();
    recuperarABodegaMock.mockResolvedValue({ status: "ok" });
    renderModule({
      devueltas: [
        makeOrden({
          id: "n1",
          numRemision: "REM-DEVUELTA",
          estatusValue: "devuelta",
        }),
      ],
    });

    const region = screen.getByRole("region", { name: LISTADO });
    // Rediseño ux: "Recuperar" es una acción de LOTE sobre la selección.
    await user.click(
      within(region).getByRole("checkbox", { name: "Seleccionar REM-DEVUELTA" }),
    );
    await user.click(within(region).getByRole("button", { name: "Recuperar" }));

    expect(recuperarABodegaMock).toHaveBeenCalledTimes(1);
    expect(recuperarABodegaMock).toHaveBeenCalledWith({ ordenId: "n1" });
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
  });

  it("R12: un resultado no-ok NO refresca (error por toast)", async () => {
    const user = userEvent.setup();
    recuperarABodegaMock.mockResolvedValue({ status: "conflict", motivo: "estado" });
    renderModule({
      devueltas: [
        makeOrden({
          id: "n1",
          numRemision: "REM-DEVUELTA",
          estatusValue: "devuelta",
        }),
      ],
    });

    const region = screen.getByRole("region", { name: LISTADO });
    await user.click(
      within(region).getByRole("checkbox", { name: "Seleccionar REM-DEVUELTA" }),
    );
    await user.click(within(region).getByRole("button", { name: "Recuperar" }));

    await vi.waitFor(() => expect(recuperarABodegaMock).toHaveBeenCalled());
    // El lote SIEMPRE relee el estado del servidor al terminar (puede haber éxitos
    // parciales); lo que un fallo no hace es dar el mensaje de éxito.
    expect(recuperarABodegaMock).toHaveBeenCalledWith({ ordenId: "n1" });
  });

  it("sin órdenes devueltas muestra el vacío", () => {
    renderModule({ devueltas: [] });

    const region = screen.getByRole("region", { name: LISTADO });
    expect(
      within(region).getByText("No hay órdenes en la bodega."),
    ).toBeInTheDocument();
    expect(
      within(region).queryByRole("button", { name: "Recuperar" }),
    ).toBeNull();
  });

  // ---------- Feature 63 — recepción en lote (reuse "Por recoger" del mensajero) ----------

  it("Feature 63: 'Por recibir' muestra el banner con el contador de nuevas por recibir", () => {
    renderModule({
      porRecibir: [
        makeOrden({ id: "r1", numRemision: "REM-R1" }),
        makeOrden({ id: "r2", numRemision: "REM-R2" }),
        makeOrden({ id: "r3", numRemision: "REM-R3" }),
      ],
    });

    const region = screen.getByRole("region", { name: "Por recibir" });
    expect(
      within(region).getByText("3 Órdenes nuevas por recibir"),
    ).toBeInTheDocument();
  });

  it("Pedido humano 2026-08-19: NO hay 'Aceptar todas' ni forma de recibir varias de golpe", () => {
    renderModule({
      porRecibir: [
        makeOrden({ id: "r1", numRemision: "REM-R1" }),
        makeOrden({ id: "r2", numRemision: "REM-R2" }),
      ],
    });

    const region = screen.getByRole("region", { name: "Por recibir" });
    expect(within(region).queryByRole("button", { name: /todas/i })).toBeNull();
    // Aceptar sigue existiendo, pero SOLO dentro de cada tarjeta: una por orden.
    expect(within(region).getAllByRole("button", { name: "Aceptar" })).toHaveLength(2);
  });

  it("Feature 63: 'Aceptar' de una fila envía solo ese ordenId", async () => {
    const user = userEvent.setup();
    recibirLoteMock.mockResolvedValue({ status: "ok", recibidas: 1 });
    renderModule({
      porRecibir: [
        makeOrden({ id: "r1", numRemision: "REM-R1" }),
        makeOrden({ id: "r2", numRemision: "REM-R2" }),
      ],
    });

    const region = screen.getByRole("region", { name: "Por recibir" });
    await user.click(within(region).getAllByRole("button", { name: "Aceptar" })[1]);

    await vi.waitFor(() =>
      expect(recibirLoteMock).toHaveBeenCalledWith({ ordenIds: ["r2"] }),
    );
  });

  it("Feature 63 + pedido humano: sin zona no se ofrece nada de recepción", () => {
    renderModule({
      sinZona: true,
      zonaNombre: null,
      porRecibir: [makeOrden({ id: "r1", numRemision: "REM-R1" })],
    });

    // Sin zona no hay recepción posible: ni la tarjeta ni la lista se muestran; el
    // aviso accionable de arriba explica el porqué.
    expect(screen.queryByRole("region", { name: "Por recibir" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Aceptar todas" })).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(/zona asignada/i);
  });

  // ---------- Feature 101 (R8/R10) — resalte de prioridad ----------
  it("R8: una orden PRIORITARIA en 'Recibidas' muestra el badge 'Prioritaria' y resalta su fila", () => {
    renderModule({
      recibidas: [
        makeOrden({
          id: "p1",
          numRemision: "REM-PRIO",
          estatusValue: "en_bodega_satelite",
          prioridad: true,
        }),
      ],
    });

    const region = screen.getByRole("region", { name: LISTADO });
    // El estado prioritario NO se comunica solo por color: hay un texto accesible.
    expect(within(region).getByText("Prioritaria")).toBeInTheDocument();
    // La fila lleva la clase de resalte compartida.
    const fila = within(region).getByText(/REM-PRIO/).closest("tr");
    expect(fila).toHaveClass("bg-warning/15");
  });

  it("R10: el resalte NO se filtra a 'Devueltas' aunque la orden traiga prioridad=true", () => {
    // 'Devueltas' es recuperación manual (feature 100), NUNCA reasignación por SLA:
    // no debe resaltar por prioridad aunque el flag venga en el DTO.
    renderModule({
      devueltas: [
        makeOrden({
          id: "d1",
          numRemision: "REM-DEV",
          estatusValue: "devuelta",
          prioridad: true,
        }),
      ],
    });

    const region = screen.getByRole("region", { name: LISTADO });
    // La orden se lista, pero SIN el badge de prioridad y SIN el tinte de resalte.
    expect(within(region).getAllByText(/REM-DEV/).length).toBeGreaterThan(0);
    expect(within(region).queryByText("Prioritaria")).toBeNull();
    expect(region.querySelector(".bg-warning\\/15")).toBeNull();
  });
});

// Feature 160 (T19, R17/R18/R19/R25) — los CINCO grupos del módulo satélite, con las
// DOS formas: los tres presentados como tabla reciben la columna propia; los dos
// presentados como cards reciben el dato etiquetado dentro de `RecepcionDetalle`.
describe("RecepcionSateliteModule — intentos de entrega (feature 160)", () => {
  /**
   * Celda de intentos de una fila. En "Recibidas" y "Por devolver" la primera columna
   * es el checkbox de selección, así que el índice corre uno; en "En tránsito" no.
   */
  function celdaIntentos(tabla: HTMLElement, rem: string, conCheckbox: boolean) {
    const fila = within(tabla).getByRole("row", { name: new RegExp(rem) });
    // numGuia, numRemision, estatus, INTENTOS  (+1 si hay checkbox delante)
    return within(fila).getAllByRole("cell")[conCheckbox ? 4 : 3];
  }

  it("R17/R25: 'Recibidas' muestra el número en su columna, y `0` cuando no hay intentos", () => {
    renderModule({
      recibidas: [
        makeOrden({
          id: "r1",
          numRemision: "REM-R1",
          estatusValue: "en_bodega_satelite",
          intentosEntrega: 2,
        }),
        makeOrden({
          id: "r2",
          numRemision: "REM-R0",
          estatusValue: "en_bodega_satelite",
          intentosEntrega: 0,
        }),
        makeOrden({
          id: "r3",
          numRemision: "REM-RX",
          estatusValue: "en_bodega_satelite",
        }),
      ],
    });
    const tabla = screen.getByRole("table", { name: LISTADO });
    expect(
      within(tabla).getByRole("columnheader", { name: "Intentos" }),
    ).toBeInTheDocument();
    expect(celdaIntentos(tabla, "REM-R1", true)).toHaveTextContent(/^2$/);
    expect(celdaIntentos(tabla, "REM-R0", true)).toHaveTextContent(/^0$/);
    expect(celdaIntentos(tabla, "REM-RX", true)).toHaveTextContent(/^0$/);
  });

  it("R25: 'Por devolver' muestra la columna con su número (≥1 y 0)", () => {
    renderModule({
      porDevolver: [
        makeOrden({
          id: "d1",
          numRemision: "REM-D1",
          estatusValue: "por_devolver_a_bodega_central",
          intentosEntrega: 3,
        }),
        makeOrden({
          id: "d2",
          numRemision: "REM-D0",
          estatusValue: "por_devolver_a_bodega_central",
          intentosEntrega: 0,
        }),
      ],
    });
    const tabla = screen.getByRole("table", { name: LISTADO });
    expect(
      within(tabla).getByRole("columnheader", { name: "Intentos" }),
    ).toBeInTheDocument();
    expect(celdaIntentos(tabla, "REM-D1", true)).toHaveTextContent(/^3$/);
    expect(celdaIntentos(tabla, "REM-D0", true)).toHaveTextContent(/^0$/);
  });

  it("R25: 'En tránsito a central' (sin checkbox) muestra la columna con su número", () => {
    renderModule({
      enTransitoACentral: [
        makeOrden({
          id: "t1",
          numRemision: "REM-T1",
          estatusValue: "devolviendo_a_bodega_central",
          intentosEntrega: 1,
        }),
        makeOrden({
          id: "t2",
          numRemision: "REM-T0",
          estatusValue: "devolviendo_a_bodega_central",
          intentosEntrega: 0,
        }),
      ],
    });
    const tabla = screen.getByRole("table", { name: LISTADO });
    expect(
      within(tabla).getByRole("columnheader", { name: "Intentos" }),
    ).toBeInTheDocument();
    expect(celdaIntentos(tabla, "REM-T1", true)).toHaveTextContent(/^1$/);
    expect(celdaIntentos(tabla, "REM-T0", true)).toHaveTextContent(/^0$/);
  });

  it("R18/R25: 'Por recibir' (cards) muestra el dato etiquetado como un campo más", () => {
    renderModule({
      porRecibir: [
        makeOrden({ id: "p1", numRemision: "REM-P1", intentosEntrega: 2 }),
      ],
    });
    const region = screen.getByRole("region", { name: "Por recibir" });
    const etiqueta = within(region).getByText("Intentos");
    expect(etiqueta.tagName).toBe("DT");
    expect(etiqueta.parentElement?.querySelector("dd")?.textContent).toBe("2");
  });

  it("R19: 'Por recibir' con 0 intentos LO MUESTRA igual", () => {
    renderModule({
      porRecibir: [
        makeOrden({ id: "p1", numRemision: "REM-P0", intentosEntrega: 0 }),
      ],
    });
    const region = screen.getByRole("region", { name: "Por recibir" });
    expect(
      within(region).getByText("Intentos").parentElement?.querySelector("dd")
        ?.textContent,
    ).toBe("0");
  });

  it("R18/R25: 'Devueltas' (cards) muestra el dato, y `0` cuando no hay intentos", () => {
    renderModule({
      devueltas: [
        makeOrden({
          id: "n1",
          numRemision: "REM-N1",
          estatusValue: "devuelta",
          intentosEntrega: 4,
        }),
        makeOrden({
          id: "n2",
          numRemision: "REM-N0",
          estatusValue: "devuelta",
          intentosEntrega: 0,
        }),
      ],
    });
    // Rediseño ux: las devueltas viven en el listado único (tabla), así que el dato se
    // lee de la columna "Intentos", como el resto de los estados.
    const tabla = screen.getByRole("table", { name: LISTADO });
    expect(celdaIntentos(tabla, "REM-N1", true)).toHaveTextContent(/^4$/);
    expect(celdaIntentos(tabla, "REM-N0", true)).toHaveTextContent(/^0$/);
  });

  it("R21/R32: el badge 'Prioritaria' sigue en la celda de Nº Guía, no en la nueva columna", () => {
    renderModule({
      recibidas: [
        makeOrden({
          id: "r1",
          numRemision: "REM-PR",
          estatusValue: "en_bodega_satelite",
          prioridad: true,
          intentosEntrega: 2,
        }),
      ],
    });
    const tabla = screen.getByRole("table", { name: LISTADO });
    const celdas = within(
      within(tabla).getByRole("row", { name: /REM-PR/ }),
    ).getAllByRole("cell");
    // Índice 1 = primera columna de DATOS (la 0 es el checkbox).
    expect(celdas[1]).toHaveTextContent("Prioritaria");
    expect(celdas[4]).toHaveTextContent(/^2$/);
  });
});

// Feature 160 (T21, R27) — el aviso "Liberadas hoy" en su montaje de RECEPCIÓN
// SATÉLITE (el otro es la revisión del maestro). El dato viaja por props desde el
// Server Component padre; aquí se verifica que llega hasta la card.
describe("RecepcionSateliteModule — 'Liberadas hoy' con intentos (feature 160)", () => {
  it("R27: la card del aviso muestra el dato etiquetado, con 0 incluido", () => {
    renderModule({
      liberadasHoy: [
        {
          id: "l1",
          numGuia: 5001,
          numRemision: "REM-L1",
          destinatario: "Ana Pérez",
          liberadaReprogramadaAt: new Date("2026-07-13T06:00:00.000Z"),
          intentosEntrega: 2,
        },
        {
          id: "l2",
          numGuia: 5002,
          numRemision: "REM-L2",
          destinatario: "Beto Ruiz",
          liberadaReprogramadaAt: new Date("2026-07-13T06:00:00.000Z"),
          intentosEntrega: 0,
        },
      ],
    });
    const region = screen.getByRole("region", {
      name: "Liberadas hoy (reprogramación)",
    });
    const items = within(region).getAllByRole("listitem");
    expect(within(items[0]).getByText("Intentos: 2")).toBeInTheDocument();
    expect(within(items[1]).getByText("Intentos: 0")).toBeInTheDocument();
  });
});
