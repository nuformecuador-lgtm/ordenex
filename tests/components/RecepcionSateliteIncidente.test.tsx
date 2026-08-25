// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { RolValue } from "@prisma/client";

import { RecepcionSateliteModule } from "@/app/(app)/recepcion-satelite/_components/RecepcionSateliteModule";
import { puedeReportarIncidenteSatelite } from "@/app/(app)/recepcion-satelite/_components/incidente-satelite";
import { REPORTAR_INCIDENTE_ACCION_LABEL } from "@/app/(app)/ordenes/_components/ReportarIncidenteAccion";
import { REPORTAR_INCIDENTE_TITULO } from "@/app/(app)/ordenes/_components/ReportarIncidenteModal";
import { ORIGENES_INCIDENTE_ADMIN } from "@/lib/services/IncidenteAdminService";
import OrdenesPage from "@/app/(app)/ordenes/page";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import {
  PAGE_SIZE_SATELITE,
  catalogoSatelite,
  paginaBodega,
} from "@/tests/fixtures/satelite-bodega";

// Feature 158 (T2.7 — extensión decidida por el HUMANO el 2026-07-30) — el reporte de
// incidente en la superficie propia del `adminSatelite`, `/recepcion-satelite`.
//
// POR QUÉ existe este archivo: el service autoriza al `adminSatelite` acotado a su zona
// (R48) y le muestra la cola de `/incidentes`, pero `/ordenes` —donde vivía la única acción
// de reporte— le hace `notFound` desde la feature 63. Sin esta superficie, dos de los cinco
// orígenes del conjunto cerrado (`en_bodega_satelite`, `en_ruta_bodega_satelite`) sólo podían
// reportarse desde la central, sobre paquetes que el central no tiene delante.
//
// Lo que este archivo protege:
//   - que el `adminSatelite` VE y puede USAR la acción en su superficie;
//   - que sigue SIN poder entrar a `/ordenes` (eso no cambia, y es lo que hace necesaria
//     esta superficie);
//   - que la acción sólo aparece donde el estado es un origen válido (R41);
//   - que NO aparece sobre una orden de otra zona ni sin zona asignada (R48).
// Feature 170 — FASE 2 (T K.3): el listado de la bodega pide su página al servidor. El doble
// devuelve las órdenes del caso sin recortar: aquí no se pagina nada.
const { paginadoBodegaMock } = vi.hoisted(() => ({ paginadoBodegaMock: vi.fn() }));
vi.mock("@/lib/actions/recepcion-satelite", () => ({
  recibirPorQr: vi.fn(),
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
vi.mock("@/lib/actions/envio-devolucion-central", () => ({ enviarACentral: vi.fn() }));
vi.mock("@/lib/actions/resolver-novedad", () => ({ recuperarABodega: vi.fn() }));
vi.mock("@/lib/actions/incidentes", () => ({ reportarIncidente: vi.fn() }));
vi.mock("@/lib/actions/filtros-ordenes", () => ({
  obtenerCatalogoFiltrosOrdenes: vi.fn(),
}));
vi.mock("@/lib/auth/resolve-actor", () => ({ resolveActorFromSession: vi.fn() }));
vi.mock("html5-qrcode", () => ({ Html5Qrcode: vi.fn() }));

class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundError";
  }
}
const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError();
  },
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const resolveActorMock = vi.mocked(resolveActorFromSession);

const ZONA = "Limón";
const ORDEN_ID = "0f1e2d3c-4b5a-4c7d-8e9f-0a1b2c3d4e5f";

function makeOrden(
  over: Partial<RecepcionSateliteDTO> & { id: string },
): RecepcionSateliteDTO {
  return {
    numGuia: 1001,
    numRemision: "REM-001",
    estatusValue: "en_bodega_satelite",
    destinatario: "Beto Ruiz",
    telefonoDest: "88880000",
    direccion: "Calle 1",
    producto: "Caja mediana",
    montoCobrar: 150,
    tiendaNombre: "Tienda X",
    zonaNombre: ZONA,
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
// Feature 278 (T4.3b): `porRecibir` SALE de estos grupos. La pantalla que monta este
// archivo es «En bodega», y desde la partición del portal ya no lista —ni recibe— las
// órdenes en camino: eso es de `/recepcion-satelite/por-recibir`.
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
        zonaNombre={props?.zonaNombre ?? ZONA}
        sinZona={props?.sinZona ?? false}
        mensajeros={props?.mensajeros ?? []}
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

function disparador(numRemision = "REM-001") {
  return screen.queryByRole("button", {
    name: `${REPORTAR_INCIDENTE_ACCION_LABEL} de la orden ${numRemision}`,
  });
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

// Rediseño ux (merge de dev en `ux`, 2026-07-30): la bodega satélite dejó de tener una tabla
// por sección y pasó a UN SOLO listado filtrable, `SateliteOrdenesListado` (aria-label
// «Órdenes de la bodega»). Los casos de abajo se reescribieron contra esa tabla única; lo que
// se AFIRMA no cambió: qué filas ofrecen la acción y cuáles no.
const TABLA_BODEGA = "Órdenes de la bodega";

describe("Feature 158 (T2.7 · satélite) — el adminSatelite SÍ tiene desde dónde reportar", () => {
  it("una orden `en_bodega_satelite` ofrece la acción por fila", () => {
    renderModule({ recibidas: [makeOrden({ id: ORDEN_ID })] });
    const tabla = screen.getByRole("table", { name: TABLA_BODEGA });
    expect(within(tabla).getByRole("button", {
      name: `${REPORTAR_INCIDENTE_ACCION_LABEL} de la orden REM-001`,
    })).toBeInTheDocument();
  });

  it("una orden `por_recoger` también la ofrece", () => {
    renderModule({
      asignadas: [
        makeOrden({ id: ORDEN_ID, estatusValue: "por_recoger", numRemision: "REM-A1" }),
      ],
    });
    const tabla = screen.getByRole("table", { name: TABLA_BODEGA });
    expect(within(tabla).getByRole("button", {
      name: `${REPORTAR_INCIDENTE_ACCION_LABEL} de la orden REM-A1`,
    })).toBeInTheDocument();
  });

  it("el disparador abre el MISMO modal de reporte, con esa orden", async () => {
    const user = userEvent.setup();
    renderModule({ recibidas: [makeOrden({ id: ORDEN_ID })] });
    expect(screen.queryByText(REPORTAR_INCIDENTE_TITULO)).toBeNull();
    await user.click(disparador()!);
    expect(await screen.findByText(REPORTAR_INCIDENTE_TITULO)).toBeInTheDocument();
    // La causa, el motivo y las fotos son las MISMAS del modal de `/ordenes`: no hay una
    // segunda implementación que pueda divergir.
    expect(screen.getByRole("radiogroup", { name: "Causa del incidente" })).toBeInTheDocument();
    expect(screen.getByLabelText("Motivo")).toBeInTheDocument();
    expect(screen.getByLabelText("Fotos de evidencia")).toBeInTheDocument();
  });

  it("el adminSatelite sigue SIN poder entrar a /ordenes (por eso hace falta esta superficie)", async () => {
    resolveActorMock.mockResolvedValue({
      usuarioId: "u1",
      rol: "adminSatelite" as RolValue,
    });
    // La página ni siquiera llega a renderizar: el guard de rol (feature 63) corta antes.
    await expect(OrdenesPage()).rejects.toThrow(NotFoundError);
  });
});

describe("Feature 158 (T2.7 · satélite) — R41: sólo en los estados que son orígenes válidos", () => {
  it("una orden `por_devolver` NO ofrece la acción", () => {
    renderModule({
      porDevolver: [
        makeOrden({ id: ORDEN_ID, estatusValue: "por_devolver", numRemision: "REM-D1" }),
      ],
    });
    const tabla = screen.getByRole("table", { name: TABLA_BODEGA });
    expect(
      within(tabla).queryByRole("button", { name: /Reportar incidente/ }),
    ).toBeNull();
  });

  it("una orden `devolviendo_a_bodega_central` NO ofrece la acción", () => {
    renderModule({
      enTransitoACentral: [
        makeOrden({
          id: ORDEN_ID,
          estatusValue: "devolviendo_a_bodega_central",
          numRemision: "REM-T1",
        }),
      ],
    });
    const tabla = screen.getByRole("table", { name: TABLA_BODEGA });
    expect(
      within(tabla).queryByRole("button", { name: /Reportar incidente/ }),
    ).toBeNull();
  });

  // ⚠️ CAMBIO DECLARADO por el rediseño ux. Antes había una tabla por sección y estos dos
  // casos miraban la CABECERA: no montar la columna en «Por devolver» evitaba una columna
  // muerta. Con UNA tabla que mezcla los cinco estados eso ya no es posible —la columna es del
  // listado, no de la sección—, así que la garantía se traslada íntegra a la FILA: en una tabla
  // mixta, la fila `por_devolver` no pinta disparador y la `en_bodega_satelite` de al lado sí.
  // Es la afirmación más fuerte que la nueva estructura admite, y no depende de que las dos
  // filas estén en tablas distintas.
  it("en la MISMA tabla, sólo la fila cuyo estado es origen pinta el disparador", () => {
    renderModule({
      recibidas: [makeOrden({ id: ORDEN_ID, numRemision: "REM-OK" })],
      porDevolver: [
        makeOrden({
          id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
          estatusValue: "por_devolver",
          numRemision: "REM-D1",
        }),
      ],
    });
    const tabla = screen.getByRole("table", { name: TABLA_BODEGA });
    expect(
      within(tabla).getByRole("button", {
        name: `${REPORTAR_INCIDENTE_ACCION_LABEL} de la orden REM-OK`,
      }),
    ).toBeInTheDocument();
    expect(
      within(tabla).queryByRole("button", {
        name: `${REPORTAR_INCIDENTE_ACCION_LABEL} de la orden REM-D1`,
      }),
    ).toBeNull();
  });

  it("caso de CONTROL: el listado SÍ monta la columna de incidente", () => {
    renderModule({ recibidas: [makeOrden({ id: ORDEN_ID })] });
    const tabla = screen.getByRole("table", { name: TABLA_BODEGA });
    const headers = within(tabla)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toContain("Incidente");
  });

  it("una orden en un estado NO reportable tampoco la ofrece", () => {
    // La decisión la toma el ESTADO de cada fila: si el servidor mandara al grupo de las
    // recibidas una orden en otro estado, no se ofrece.
    renderModule({
      recibidas: [makeOrden({ id: ORDEN_ID, estatusValue: "entregada" })],
    });
    expect(disparador()).toBeNull();
  });
});

describe("Feature 158 (T2.7 · satélite) — R48: alcance por zona", () => {
  it("una orden de OTRA zona NO ofrece la acción", () => {
    renderModule({
      recibidas: [makeOrden({ id: ORDEN_ID, zonaNombre: "Puntarenas" })],
      zonaNombre: ZONA,
    });
    expect(disparador()).toBeNull();
  });

  it("caso de CONTROL: la MISMA orden en la zona del actor SÍ la ofrece", () => {
    // Sin este control, «no aparece» podría ser cierto por la razón equivocada (p. ej. que
    // la columna no se monte nunca en esa sección).
    renderModule({
      recibidas: [makeOrden({ id: ORDEN_ID, zonaNombre: ZONA })],
      zonaNombre: ZONA,
    });
    expect(disparador()).not.toBeNull();
  });

  it("un adminSatelite SIN zona no la ofrece sobre nada", () => {
    renderModule({
      recibidas: [makeOrden({ id: ORDEN_ID })],
      zonaNombre: null,
      sinZona: true,
    });
    expect(disparador()).toBeNull();
  });
});

describe("Feature 158 (T2.7 · satélite) — el predicado, en aislado", () => {
  const enZona = { estatusValue: "en_bodega_satelite", zonaNombre: ZONA };

  it.each(ORIGENES_INCIDENTE_ADMIN)(
    "acepta el origen `%s` cuando la zona casa",
    (estatusValue) => {
      expect(
        puedeReportarIncidenteSatelite({ estatusValue, zonaNombre: ZONA }, ZONA, false),
      ).toBe(true);
    },
  );

  it.each(["en_reparto", "por_devolver", "devuelta", "entregada", "incidente"])(
    "rechaza el estado `%s`, que no es origen",
    (estatusValue) => {
      expect(
        puedeReportarIncidenteSatelite({ estatusValue, zonaNombre: ZONA }, ZONA, false),
      ).toBe(false);
    },
  );

  it("rechaza una orden de otra zona aunque el estado sea válido", () => {
    expect(
      puedeReportarIncidenteSatelite(
        { estatusValue: "en_bodega_satelite", zonaNombre: "Puntarenas" },
        ZONA,
        false,
      ),
    ).toBe(false);
  });

  it("falla CERRADO sin zona del actor, aunque `sinZona` viniera en `false`", () => {
    expect(puedeReportarIncidenteSatelite(enZona, null, false)).toBe(false);
  });

  it("falla CERRADO con `sinZona`, aunque hubiera un nombre de zona", () => {
    expect(puedeReportarIncidenteSatelite(enZona, ZONA, true)).toBe(false);
  });
});
