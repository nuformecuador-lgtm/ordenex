// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RolValue } from "@prisma/client";

import { RecepcionSateliteModule } from "@/app/(app)/recepcion-satelite/_components/RecepcionSateliteModule";
import { puedeReportarIncidenteSatelite } from "@/app/(app)/recepcion-satelite/_components/incidente-satelite";
import { REPORTAR_INCIDENTE_ACCION_LABEL } from "@/app/(app)/ordenes/_components/ReportarIncidenteAccion";
import { REPORTAR_INCIDENTE_TITULO } from "@/app/(app)/ordenes/_components/ReportarIncidenteModal";
import { ORIGENES_INCIDENTE_ADMIN } from "@/lib/services/IncidenteAdminService";
import OrdenesPage from "@/app/(app)/ordenes/page";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";

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
vi.mock("@/lib/actions/recepcion-satelite", () => ({
  recibirPorQr: vi.fn(),
  listarRecepcionSatelite: vi.fn(),
  asignarDesdeSatelite: vi.fn(),
  recibirLote: vi.fn(),
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

function renderModule(
  props?: Partial<Parameters<typeof RecepcionSateliteModule>[0]>,
) {
  render(
    <RecepcionSateliteModule
      porRecibir={props?.porRecibir ?? []}
      recibidas={props?.recibidas ?? []}
      porDevolver={props?.porDevolver ?? []}
      enTransitoACentral={props?.enTransitoACentral ?? []}
      devueltas={props?.devueltas ?? []}
      asignadas={props?.asignadas ?? []}
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
    />,
  );
}

function disparador(numRemision = "REM-001") {
  return screen.queryByRole("button", {
    name: `${REPORTAR_INCIDENTE_ACCION_LABEL} de la orden ${numRemision}`,
  });
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("Feature 158 (T2.7 · satélite) — el adminSatelite SÍ tiene desde dónde reportar", () => {
  it("«Recibidas» (`en_bodega_satelite`) ofrece la acción por fila", () => {
    renderModule({ recibidas: [makeOrden({ id: ORDEN_ID })] });
    const tabla = screen.getByRole("table", { name: "Recibidas" });
    expect(within(tabla).getByRole("button", {
      name: `${REPORTAR_INCIDENTE_ACCION_LABEL} de la orden REM-001`,
    })).toBeInTheDocument();
  });

  it("«Asignadas (por recoger)» (`por_recoger`) también la ofrece", () => {
    renderModule({
      asignadas: [
        makeOrden({ id: ORDEN_ID, estatusValue: "por_recoger", numRemision: "REM-A1" }),
      ],
    });
    const tabla = screen.getByRole("table", { name: "Asignadas (por recoger)" });
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
  it("«Por devolver» (`por_devolver`) NO ofrece la acción", () => {
    renderModule({
      porDevolver: [
        makeOrden({ id: ORDEN_ID, estatusValue: "por_devolver", numRemision: "REM-D1" }),
      ],
    });
    const tabla = screen.getByRole("table", { name: "Por devolver" });
    expect(
      within(tabla).queryByRole("button", { name: /Reportar incidente/ }),
    ).toBeNull();
  });

  it("«En tránsito a central» (`devolviendo_a_bodega_central`) NO ofrece la acción", () => {
    renderModule({
      enTransitoACentral: [
        makeOrden({
          id: ORDEN_ID,
          estatusValue: "devolviendo_a_bodega_central",
          numRemision: "REM-T1",
        }),
      ],
    });
    const tabla = screen.getByRole("table", { name: "En tránsito a central" });
    expect(
      within(tabla).queryByRole("button", { name: /Reportar incidente/ }),
    ).toBeNull();
  });

  // ⚠️ Los dos casos de arriba miran el BOTÓN, y el botón falta igual aunque la columna se
  // cuele: el disparador se auto-oculta por estado. Se midió (mutación Z4: 0 rojos) y por eso
  // estos dos miran la CABECERA: una columna de acción muerta en una sección donde la acción
  // no puede aplicar nunca es ruido permanente en una tabla que ya tiene 14 columnas.
  it("«Por devolver» no monta siquiera la COLUMNA de incidente", () => {
    renderModule({
      porDevolver: [makeOrden({ id: ORDEN_ID, estatusValue: "por_devolver" })],
    });
    const tabla = screen.getByRole("table", { name: "Por devolver" });
    const headers = within(tabla)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).not.toContain("Incidente");
  });

  it("caso de CONTROL: «Recibidas» SÍ monta la columna", () => {
    renderModule({ recibidas: [makeOrden({ id: ORDEN_ID })] });
    const tabla = screen.getByRole("table", { name: "Recibidas" });
    const headers = within(tabla)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toContain("Incidente");
  });

  it("una orden en un estado NO reportable dentro de «Recibidas» tampoco la ofrece", () => {
    // La sección se llama «Recibidas» pero la decisión la toma el ESTADO de cada fila, no la
    // sección: si el servidor mandara ahí una orden en otro estado, no se ofrece.
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
