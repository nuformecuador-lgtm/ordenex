// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { RecepcionSateliteModule } from "@/app/(app)/recepcion-satelite/_components/RecepcionSateliteModule";
import { AVISO_SIN_ZONA_SATELITE } from "@/app/(app)/recepcion-satelite/_components/AvisoSinZonaSatelite";
import {
  PAGE_SIZE_SATELITE,
  catalogoSatelite,
  paginaBodega,
} from "@/tests/fixtures/satelite-bodega";
import { ORDER_STATUS_LABELS } from "@/app/(app)/ordenes/_components/EstatusBadge";
import { enviarACentral } from "@/lib/actions/envio-devolucion-central";
import { recuperarABodega } from "@/lib/actions/resolver-novedad";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";

// Feature 33 (T12) — módulo de la bodega satélite. Se mockean la Server Action de
// recepción, el toast, el router (refresh) y la lib de cámara (sin hardware en CI).
//
// FEATURE 278 (T4.1, 2026-08-24) — ESTE ARCHIVO JUZGA «EN BODEGA», NO EL PORTAL ENTERO.
// El portal del `adminSatelite` se partió en dos pantallas. Este módulo se quedó con el
// listado de la bodega y PERDIÓ el bloque «Por recibir» (escáner + tarjetas), que vive
// ahora en `PorRecibirModule`. Lo que eso mueve, caso por caso:
//
// - Cuatro casos cuyo SUJETO eran las tarjetas por recibir —el banner del contador, los
//   dos de intentos de entrega en las cards y el «sin zona no se ofrece nada de
//   recepción»— se MUDAN a `tests/components/PorRecibirModule.test.tsx`, donde vive su
//   sujeto. No se pierden: cada uno tiene su heredero nombrado en el sitio donde estaba.
// - Los que afirmaban que «Por recibir» no ofrecía tal o cual cosa se REEXPRESAN aquí como
//   AUSENCIA DE LA REGIÓN: en esta pantalla no hay dónde ofrecer nada (R16/R18). Cada
//   ausencia lleva su POSITIVO en el mismo caso (R29) — un `queryByRole` que no encuentra
//   nada pasa igual de verde si el render entero se rompió.
// - El escáner SIGUE aquí y ya no depende de ninguna lista (R42): la condición es tener
//   zona, y nada más. El caso que afirmaba lo contrario cambia de sentido, con la decisión
//   firmada escrita dentro.
// Feature 278 (T3B.1, R34): `recibirLote` YA NO SE DOBLA porque ya no existe. La recepción
// en lote se retiro entera —Server Action, schema, servicio y repositorio— y con ella el
// boton "Aceptar" por-orden, su unico consumidor. Recibir es SOLO por QR (`recibirPorQr`).
// Feature 170 — FASE 2 (T K.3): el listado de la bodega pide su página al servidor. El doble
// devuelve las órdenes que el caso monta, sin recortar: aquí no se pagina nada (eso lo mide
// `tests/components/paginacion/SatelitePaginacion.test.tsx`).
const { paginadoBodegaMock, recibirPorQrMock } = vi.hoisted(() => ({
  paginadoBodegaMock: vi.fn(),
  /**
   * Feature 278 (T4.1b, R22): la ÚNICA vía de recepción que queda. El caso de R22 la
   * dobla a `ok` para comprobar que recibir por guía desde «En bodega» mete la orden en
   * este listado sin recargar la página.
   */
  recibirPorQrMock: vi.fn(),
}));
vi.mock("@/lib/actions/recepcion-satelite", () => ({
  recibirPorQr: (...a: unknown[]) => recibirPorQrMock(...a),
  listarRecepcionSatelite: vi.fn(),
  asignarDesdeSatelite: vi.fn(),
  listarOrdenesBodegaPaginado: (...a: unknown[]) => paginadoBodegaMock(...a),
  // Feature 184 — Tanda A (T A.4/T A.5): el modulo importa las DOS acciones nuevas —el
  // conjunto de la descarga y la vigencia con la que poda la seleccion—, asi que el doble
  // tiene que declararlas o el modulo revienta al importarlo. Aqui no se invocan: no se
  // descarga nada y no hay marcas fuera de la pagina visible (el listado cabe entero).
  listarOrdenesBodegaCompleto: vi.fn(async () => ({ status: "ok", items: [], total: 0 })),
  listarIdsVigentesBodega: vi.fn(async () => ({ status: "ok", ids: [] })),
}));

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
  "ordenesBodega" | "catalogoFiltros"
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
  // Feature 278 (T4.1a, R16/R18) — REEXPRESADO. Este caso afirmaba que la pantalla montaba
  // LAS DOS regiones. Con el portal partido, «En bodega» monta UNA: la suya. La región
  // «Por recibir» ya no existe aquí y su contenido se afirma en `PorRecibirModule.test.tsx`.
  it("R18: 'En bodega' monta SU listado y NO la región 'Por recibir'", () => {
    renderModule({
      recibidas: [
        makeOrden({
          id: "b1",
          numRemision: "REM-B1",
          estatusValue: "en_bodega_satelite",
        }),
      ],
    });

    // POSITIVO: el render ocurrió y el listado está con su fila.
    const listado = screen.getByRole("region", { name: LISTADO });
    expect(listado).toBeInTheDocument();
    expect(within(listado).getAllByText(/REM-B1/).length).toBeGreaterThan(0);

    // AUSENCIA: ni la región ni su encabezado.
    expect(screen.queryByRole("region", { name: "Por recibir" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Por recibir" })).toBeNull();
  });

  // Feature 278 (T3B.1/T4.1a, R1/R34) — este caso afirmaba lo CONTRARIO: que cada tarjeta
  // de «Por recibir» traía su botón "Aceptar" por-orden. Cambió de sentido con la decisión
  // firmada (recibir es SOLO por QR), y ahora además cambia de ámbito: la sección se mudó,
  // así que lo que aquí se afirma es que el botón no está EN NINGUNA PARTE de esta
  // pantalla — ni de lote, ni por-orden, ni reintroducido por otra vía.
  it("Feature 278 (R1/R34): ninguna de las dos vías de recepción del botón sobrevive en 'En bodega'", () => {
    renderModule({
      recibidas: [
        makeOrden({
          id: "b1",
          numRemision: "REM-B1",
          estatusValue: "en_bodega_satelite",
        }),
      ],
    });

    // POSITIVO: la pantalla se pintó entera — el listado con su fila y el acceso al
    // escáner, que es la única vía de recepción que queda.
    const listado = screen.getByRole("region", { name: LISTADO });
    expect(within(listado).getAllByText(/REM-B1/).length).toBeGreaterThan(0);
    expect(accesoReceptor()).not.toBeNull();

    // AUSENCIA, en TODA la pantalla: ni "Aceptar todas" (retirada el 2026-08-19) ni el
    // "Aceptar" por-orden (esta ficha).
    expect(screen.queryByRole("button", { name: /todas/i })).toBeNull();
    expect(screen.queryAllByRole("button", { name: "Aceptar" })).toHaveLength(0);
    expect(screen.queryByRole("region", { name: "Por recibir" })).toBeNull();
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

  // Feature 278 (T4.1c, R25/R27) — sin zona, en ESTA pantalla, el listado SIGUE (a
  // diferencia de «Por recibir», donde no queda más que el aviso). El texto del aviso se
  // afirma contra el literal que exporta `AvisoSinZonaSatelite`, no contra una copia a
  // mano: si el aviso cambia de redacción, este caso sigue midiendo la pantalla y no su
  // propia transcripción.
  it("R25/R27: sin zona muestra el aviso y NO ofrece el escáner, pero el listado sigue", () => {
    renderModule({
      sinZona: true,
      zonaNombre: null,
      recibidas: [
        makeOrden({
          id: "b1",
          numRemision: "REM-B1",
          estatusValue: "en_bodega_satelite",
        }),
      ],
    });

    expect(screen.getByRole("alert")).toHaveTextContent(AVISO_SIN_ZONA_SATELITE);

    // POSITIVO (R27): el listado de la bodega sigue montado y con su fila.
    const listado = screen.getByRole("region", { name: LISTADO });
    expect(within(listado).getAllByText(/REM-B1/).length).toBeGreaterThan(0);

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
  // (cámara O número tecleado, misma tarjeta).
  // Feature 278 (R42): «y sólo se ofrece si hay algo por recibir» DEJA DE SER CIERTO —y el
  // montaje lo demuestra: esta pantalla ya no recibe ninguna lista de órdenes por recibir
  // y el escáner se ofrece igual.
  it("R42: con zona ofrece cámara y número de guía tecleado", async () => {
    const user = userEvent.setup();
    renderModule({ sinZona: false });

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

  // Feature 278 (T4.1d, R42/R43) — ESTE CASO AFIRMABA LO CONTRARIO, y cambia de sentido
  // con la decisión firmada del 2026-08-24. Decía que sin órdenes por recibir NO se
  // mostraba la tarjeta de recepción: exactamente el fallo que la feature 167 ya había
  // documentado con la recolección del mensajero — la herramienta se escondía justo cuando
  // el actor tenía el paquete en la mano y la orden todavía no figuraba en la última
  // lectura. Ahora la única condición es la zona. No se borra: se reexpresa, y así queda
  // escrito de dónde viene el cambio.
  it("R42/R43: el escáner NO depende de la lista de por-recibir — se ofrece con la bodega vacía", () => {
    renderModule({ sinZona: false });

    // POSITIVO: la pantalla montó su listado (aunque sin filas) y el acceso al escáner.
    expect(screen.getByRole("region", { name: LISTADO })).toBeInTheDocument();
    expect(accesoReceptor()).not.toBeNull();

    // Y sigue sin montar la región «Por recibir», que es de la otra pantalla.
    expect(screen.queryByRole("region", { name: "Por recibir" })).toBeNull();
  });

  // Feature 278 (T4.1b, R22) — LA RELECTURA QUE SE PIERDE EN SILENCIO SI ALGUIEN LA
  // "SIMPLIFICA". El escáner sigue montado en «En bodega» (decisión firmada), y una
  // recepción por QR mete una fila NUEVA en ESTE listado. Sus filas las tiene SWR, así que
  // `router.refresh()` NO basta: sin `mutate()` la orden recién recibida no aparecería
  // hasta recargar la página, y ningún otro caso del repo se pondría rojo.
  //
  // Por eso se afirman las DOS cosas: que la lectura paginada se REPITIÓ y que la fila
  // aparece. Sólo lo segundo dejaría pasar un `mutate()` que devolviera lo mismo; sólo lo
  // primero, una revalidación que no llega a pintarse.
  it("R22: recibir por guía mete la orden en el listado sin recargar la página", async () => {
    const user = userEvent.setup();
    const yaEnBodega = makeOrden({
      id: "b1",
      numRemision: "REM-B1",
      estatusValue: "en_bodega_satelite",
    });
    const recienRecibida = makeOrden({
      id: "b2",
      numRemision: "REM-NUEVA",
      numGuia: 1001,
      estatusValue: "en_bodega_satelite",
    });
    recibirPorQrMock.mockResolvedValue({ status: "ok", ordenId: "b2" });

    renderModule({ recibidas: [yaEnBodega] });
    const listado = () => screen.getByRole("region", { name: LISTADO });

    // Estado de partida: la fila vieja está y la nueva NO. Sin esto, el aserto de más
    // abajo podría estar encontrando algo que ya estaba.
    //
    // La espera se ancla al CONTENIDO y no a un conteo, a propósito: mientras el listado
    // carga, la tabla tiene su cabecera y su fila `role="status"`, así que un
    // `.length > 0` se cumple a media carga y no distingue la pantalla asentada de la que
    // todavía está pintando el esqueleto (lo vigila `ancla-de-carga.guardia.test.ts`).
    await waitFor(() => expect(listado()).toHaveTextContent("REM-B1"));
    expect(within(listado()).queryByText(/REM-NUEVA/)).toBeNull();

    // A partir de aquí el servidor ya devuelve la orden recibida.
    paginadoBodegaMock.mockResolvedValue({
      status: "ok",
      items: [yaEnBodega, recienRecibida],
      page: 1,
      pageSize: PAGE_SIZE_SATELITE,
      total: 2,
    });
    const lecturasAntes = paginadoBodegaMock.mock.calls.length;

    // El camino MANUAL (número tecleado), que no necesita cámara.
    await user.click(screen.getByRole("button", { name: "Recibir paquete" }));
    const modal = await screen.findByRole("dialog");
    await user.type(within(modal).getByRole("textbox"), "1001");
    await user.click(within(modal).getByRole("button", { name: "Recibir" }));
    await waitFor(() => expect(recibirPorQrMock).toHaveBeenCalled());
    // El escáner vive en un modal y mientras está abierto el resto queda `aria-hidden`:
    // sin cerrarlo, la tabla que este caso juzga no existe para las queries.
    await user.click(within(modal).getByRole("button", { name: /Cerrar/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // (1) la lectura paginada SE REPITIÓ: `mutate()` no es un no-op.
    await waitFor(() =>
      expect(paginadoBodegaMock.mock.calls.length).toBeGreaterThan(lecturasAntes),
    );
    // (2) y la fila nueva se pintó, sin recargar la página. Otra vez por contenido: es lo
    // que distingue «la relectura llegó y se pintó» de «la tabla tiene N elementos».
    await waitFor(() => expect(listado()).toHaveTextContent("REM-NUEVA"));
    // (3) el Server Component también se vuelve a resolver (bloqueo, liberadas, total).
    expect(refreshMock).toHaveBeenCalled();
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

  // Feature 278 (T4.1a, R16/R18) — REEXPRESADO. Afirmaba que la sección «Por recibir» no
  // ofrecía seleccionar ni asignar. Con la partición, esa sección no está en esta
  // pantalla: la afirmación se refuerza —no hay región donde ofrecerlo— y su heredera, que
  // las tarjetas no traen NINGÚN control, vive en `PorRecibirModule.test.tsx`.
  it("R7/R18 (no regresión): la selección y 'Asignar' viven SOLO en el listado, no en una sección de por-recibir", () => {
    renderModule({
      recibidas: [
        makeOrden({
          id: "b1",
          numRemision: "REM-B1",
          estatusValue: "en_bodega_satelite",
        }),
      ],
    });

    // POSITIVO: la selección existe donde debe existir — en el listado de la bodega.
    const listado = screen.getByRole("region", { name: LISTADO });
    expect(within(listado).getAllByRole("checkbox").length).toBeGreaterThan(0);

    // AUSENCIA: no hay ninguna otra región de la que hablar.
    expect(screen.queryByRole("region", { name: "Por recibir" })).toBeNull();
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

  // ---------- Feature 278: dónde fue a parar lo que juzgaba las tarjetas por recibir ------
  //
  // Aquí vivían tres casos con SUJETO en la sección «Por recibir». Los tres se MUDAN a
  // `tests/components/PorRecibirModule.test.tsx`, que es donde vive ahora ese sujeto, y
  // ninguno se pierde:
  //
  // - `"Feature 63: 'Por recibir' muestra el banner con el contador de nuevas por recibir"`
  //   → `"R2: el banner cuenta las órdenes por recibir"`.
  // - `"Feature 278 (R1/R34): ninguna de las dos vías de recepción del botón sobrevive"` →
  //   se afirma en las DOS pantallas: aquí arriba (ausencia en «En bodega») y allí como
  //   `"R1: las tarjetas no ofrecen NINGÚN botón"`.
  // - `"Feature 63 + pedido humano: sin zona no se ofrece nada de recepción"` →
  //   `"R26: sin zona sólo el aviso — ni escáner ni tarjetas"`. Su mitad de ESTA pantalla
  //   es otra regla (R27: el listado sigue) y la afirma el caso `"R25/R27"` de arriba.
  //
  // Y uno MURIÓ con el código, en la mitad de servidor (T3B.6, R40): `"Feature 63:
  // 'Aceptar' de una fila envia solo ese ordenId"`. Era la única prueba del cableado botón
  // → `recibirLote`, y ese cableado ya no existe. No se repone con un equivalente porque
  // no hay acción equivalente: la recepción pasa por el escáner, y ESE camino está
  // afirmado en `tests/components/EscanerRecepcion.test.tsx`, que esta ficha no toca.

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

  // Feature 278 (T4.1): los dos casos de intentos sobre las CARDS de «Por recibir» —el
  // etiquetado como un campo más y el `0` que se muestra igual— se MUDAN a
  // `tests/components/PorRecibirModule.test.tsx` («R18/R25» y «R19»), porque esas cards ya
  // no las monta esta pantalla. La columna «Intentos» del LISTADO, que sí es de aquí,
  // sigue afirmada en los tres casos de arriba.

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
