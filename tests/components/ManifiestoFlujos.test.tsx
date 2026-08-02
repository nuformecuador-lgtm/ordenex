// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OrdenesCargaResumen } from "@/app/(app)/ordenes/_components/OrdenesCargaResumen";
import { GenerarGuiaModal } from "@/app/(app)/ordenes/_components/GenerarGuiaModal";
import { AsignarBodegaModal } from "@/app/(app)/ordenes/_components/AsignarBodegaModal";
import { RutearSateliteModal } from "@/app/(app)/ordenes/_components/RutearSateliteModal";
import { DevolverATiendaModal } from "@/app/(app)/ordenes/_components/DevolverATiendaModal";
import { AsignarSateliteModal } from "@/app/(app)/recepcion-satelite/_components/AsignarSateliteModal";
import { RecepcionSateliteModule } from "@/app/(app)/recepcion-satelite/_components/RecepcionSateliteModule";

import { obtenerManifiesto } from "@/lib/actions/manifiesto";
import {
  generarGuia,
  asignarDesdeBodega,
  rutearABodegaSatelite,
} from "@/lib/actions/ordenes-guia";
import { asignarDesdeSatelite } from "@/lib/actions/recepcion-satelite";
import { enviarACentral } from "@/lib/actions/envio-devolucion-central";
import { devolverATienda } from "@/lib/actions/devolucion-origen";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { ManifiestoFilaDTO } from "@/lib/types/manifiesto";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import {
  PAGE_SIZE_SATELITE,
  catalogoSatelite,
  paginaBodega,
} from "@/tests/fixtures/satelite-bodega";

// Feature 148 (T20) — los 5 puntos de enganche (6 superficies de UI): cada flujo, tras
// COMETER su operación de negocio, ofrece la descarga del manifiesto de SU lote (R18–R23)
// sin alterar la llamada de negocio ni su resultado (R25, R27).

vi.mock("@/lib/actions/manifiesto", () => ({ obtenerManifiesto: vi.fn() }));
// El paso 3 de la carga masiva pide su tabla al montar; aqui solo se ejercita el manifiesto.
vi.mock("@/lib/actions/carga-masiva-resumen", () => ({
  resumenCargaMasiva: vi.fn(async () => ({ status: "ok", ordenes: [] })),
}));
vi.mock("@/lib/actions/ordenes-guia", () => ({
  generarGuia: vi.fn(),
  asignarDesdeBodega: vi.fn(),
  rutearABodegaSatelite: vi.fn(),
}));
// Feature 170 — FASE 2 (T K.3): el listado de la bodega pide su página al servidor; el doble
// devuelve las órdenes que el caso monta, sin recortar (aquí no se pagina nada).
const { paginadoBodegaMock } = vi.hoisted(() => ({ paginadoBodegaMock: vi.fn() }));
vi.mock("@/lib/actions/recepcion-satelite", () => ({
  asignarDesdeSatelite: vi.fn(),
  recibirLote: vi.fn(),
  recibirPorQr: vi.fn(),
  listarRecepcionSatelite: vi.fn(),
  listarOrdenesBodegaPaginado: (...args: unknown[]) => paginadoBodegaMock(...args),
}));
vi.mock("@/lib/actions/envio-devolucion-central", () => ({
  enviarACentral: vi.fn(),
}));
vi.mock("@/lib/actions/devolucion-origen", () => ({ devolverATienda: vi.fn() }));
vi.mock("@/lib/actions/resolver-novedad", () => ({ recuperarABodega: vi.fn() }));

vi.mock("swr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("swr")>();
  return { ...actual, useSWRConfig: () => ({ mutate: vi.fn() }) };
});

// El generador se aísla de exceljs; el binario real lo cubre `manifiesto-xlsx.test.ts`.
const { buildManifiestoXlsxMock } = vi.hoisted(() => ({
  buildManifiestoXlsxMock: vi.fn<() => Promise<ArrayBuffer>>(),
}));
vi.mock("@/lib/utils/manifiesto-xlsx", () => ({
  buildManifiestoXlsx: buildManifiestoXlsxMock,
  manifiestoFileName: (flujo: string, fecha: string) =>
    `manifiesto-${flujo}-${fecha}.xlsx`,
}));

const { successMock, errorMock, warningMock, refreshMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  warningMock: vi.fn(),
  refreshMock: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: warningMock,
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));
vi.mock("html5-qrcode", () => ({ Html5Qrcode: vi.fn() }));

const obtenerManifiestoMock = vi.mocked(obtenerManifiesto);
const generarGuiaMock = vi.mocked(generarGuia);
const asignarDesdeBodegaMock = vi.mocked(asignarDesdeBodega);
const rutearMock = vi.mocked(rutearABodegaSatelite);
const asignarDesdeSateliteMock = vi.mocked(asignarDesdeSatelite);
const enviarACentralMock = vi.mocked(enviarACentral);
const devolverATiendaMock = vi.mocked(devolverATienda);

function makeFila(over: Partial<ManifiestoFilaDTO> = {}): ManifiestoFilaDTO {
  return {
    numGuia: 1001,
    numRemision: "REM-001",
    destinatario: "Ana Pérez",
    telefono: "88880000",
    direccion: "Calle 1",
    zona: "Limón",
    monto: 15000,
    intentos: 0, // feature 160/R28a: dato de la orden, numerico y no nullable
    origen: "Bodega central",
    destino: "Limón",
    responsable: "Beto Mensajero",
    fecha: "2026-07-28",
    ...over,
  };
}

function makeOrden(
  over: Partial<OrdenListItemDTO> & { id: string },
): OrdenListItemDTO {
  return {
    numGuia: null,
    numRemision: "REM-000",
    estatusId: "id-estatus",
    // Feature 155/R28: el estado de fulfillment en bodega salio del catalogo. El fixture
    // usa `en_preparacion`, que es donde nace ahora la orden que YA esta en bodega y el
    // origen del primer flujo de esta suite ("Generar guia"). Ningun caso asevera sobre
    // este campo: es solo un default valido del DTO.
    estatusValue: "en_preparacion",
    destinatario: "Destino",
    telefonoDest: "88880000",
    tiendaId: "tienda-uuid",
    tiendaNombre: "Tienda X",
    zonaId: "zona-1",
    provinciaId: "prov-1",
    cantonId: "canton-1",
    distritoId: null,
    producto: "Producto",
    peso: 1,
    notas: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

function makeRecepcion(
  over: Partial<RecepcionSateliteDTO> & { id: string },
): RecepcionSateliteDTO {
  return {
    numGuia: 1001,
    numRemision: "REM-001",
    estatusValue: "por_devolver",
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
  };
}

let anchorClick: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(URL, "createObjectURL", {
    value: vi.fn(() => "blob:mock-url"),
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: vi.fn(),
    configurable: true,
  });
  anchorClick = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  buildManifiestoXlsxMock.mockResolvedValue(new ArrayBuffer(8));
  obtenerManifiestoMock.mockResolvedValue({
    status: "ok",
    filas: [makeFila()],
    omitidas: [],
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** El botón compartido del manifiesto, por su nombre accesible. */
function botonManifiesto(): HTMLElement {
  return screen.getByRole("button", { name: /descargar manifiesto/i });
}

describe("Feature 148 — enganche del manifiesto en los 5 flujos", () => {
  it("R18: tras la carga masiva ofrece el manifiesto de las remisiones creadas", async () => {
    const user = userEvent.setup();
    // Feature 157 (bloque E): el boton vive ahora en el paso que el modal MONTA de verdad.
    // Antes colgaba de `OrdenesCargaResumenPaso`, huerfano desde la 159 — por eso una tienda
    // que cargaba por la UI no tenia forma de sacar su manifiesto.
    render(<OrdenesCargaResumen numRemisiones={["REM-A", "REM-B"]} />);

    await user.click(botonManifiesto());

    expect(obtenerManifiestoMock).toHaveBeenCalledWith({
      flujo: "carga_masiva",
      numRemisiones: ["REM-A", "REM-B"],
    });
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
  });

  it("R17/R18: sin órdenes nuevas el paso de carga masiva NO ofrece manifiesto", () => {
    render(<OrdenesCargaResumen numRemisiones={[]} />);

    expect(
      screen.queryByRole("button", { name: /descargar manifiesto/i }),
    ).toBeNull();
  });

  it("R19: tras generar guía ofrece el manifiesto de las órdenes del lote", async () => {
    const user = userEvent.setup();
    // Feature 156: generar guía tiene un destino ÚNICO (`en_bodega_central`) y el
    // modal ya no recibe `mensajeros`. Las aserciones del manifiesto no cambian.
    generarGuiaMock.mockResolvedValue({
      status: "ok",
      resultados: [
        { ordenId: "o1", numGuia: 1, estado: "en_bodega_central" },
        { ordenId: "o2", numGuia: 2, estado: "en_bodega_central" },
      ],
    });
    const onSuccess = vi.fn();
    render(
      <GenerarGuiaModal
        open
        ordenes={[makeOrden({ id: "o1" }), makeOrden({ id: "o2" })]}
        onOpenChange={vi.fn()}
        onSuccess={onSuccess}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Generar guía" }));
    await user.click(await screen.findByRole("button", { name: /descargar manifiesto/i }));

    expect(obtenerManifiestoMock).toHaveBeenCalledWith({
      flujo: "generacion_guia",
      ordenIds: ["o1", "o2"],
    });
    // La descarga NO cierra el flujo: el resultado sigue visible (R26).
    expect(onSuccess).not.toHaveBeenCalled();
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
  });

  it("R19: tras asignar desde bodega ofrece el manifiesto del lote", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock.mockResolvedValue({
      status: "ok",
      resultados: [
        { ordenId: "o1", estado: "por_recoger" },
        { ordenId: "o2", estado: "por_recoger" },
      ],
    });
    render(
      <AsignarBodegaModal
        open
        ordenes={[makeOrden({ id: "o1" }), makeOrden({ id: "o2" })]}
        mensajeros={[{ id: "m1", nombre: "Ana" }]}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Mensajero para el lote" }));
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: "Ana" }));
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await user.click(await screen.findByRole("button", { name: /descargar manifiesto/i }));
    expect(obtenerManifiestoMock).toHaveBeenCalledWith({
      flujo: "generacion_guia",
      ordenIds: ["o1", "o2"],
    });
  });

  it("R20: tras rutear a satélite ofrece el manifiesto del lote", async () => {
    const user = userEvent.setup();
    rutearMock.mockResolvedValue({
      status: "ok",
      resultados: [
        { ordenId: "o1", estado: "en_ruta_bodega_satelite" },
        { ordenId: "o2", estado: "en_ruta_bodega_satelite" },
      ],
    });
    render(
      <RutearSateliteModal
        open
        ordenes={[makeOrden({ id: "o1" }), makeOrden({ id: "o2" })]}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Rutear a bodega satélite" }),
    );
    await user.click(await screen.findByRole("button", { name: /descargar manifiesto/i }));

    expect(obtenerManifiestoMock).toHaveBeenCalledWith({
      flujo: "ruteo_satelite",
      ordenIds: ["o1", "o2"],
    });
  });

  it("R21: tras asignar desde la bodega satélite ofrece el manifiesto del lote", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "ok",
      resultados: [{ ordenId: "s1", estado: "por_recoger" }],
    });
    render(
      <AsignarSateliteModal
        open
        ordenes={[makeRecepcion({ id: "s1", estatusValue: "en_bodega_satelite" })]}
        mensajeros={[{ id: "m1", nombre: "Ana" }]}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Mensajero para el lote" }));
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: "Ana" }));
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await user.click(await screen.findByRole("button", { name: /descargar manifiesto/i }));
    expect(obtenerManifiestoMock).toHaveBeenCalledWith({
      flujo: "asignacion_satelite",
      ordenIds: ["s1"],
    });
  });

  it("R22: tras enviar a central ofrece el manifiesto SOLO de las enviadas con éxito", async () => {
    const user = userEvent.setup();
    // La primera sale ok, la segunda falla: el manifiesto solo lleva la primera.
    enviarACentralMock
      .mockResolvedValueOnce({ status: "ok" })
      .mockResolvedValueOnce({ status: "conflict", motivo: "estado inválido" });

    const porDevolver = [
      makeRecepcion({ id: "d1", numRemision: "REM-D1" }),
      makeRecepcion({ id: "d2", numRemision: "REM-D2" }),
    ];
    paginadoBodegaMock.mockResolvedValue({
      status: "ok",
      items: porDevolver,
      page: 1,
      pageSize: PAGE_SIZE_SATELITE,
      total: porDevolver.length,
    });
    render(
      <RecepcionSateliteModule
        porRecibir={[]}
        ordenesBodega={paginaBodega(porDevolver)}
        catalogoFiltros={catalogoSatelite(porDevolver)}
        zonaNombre="Limón"
        sinZona={false}
        mensajeros={[]}
        bloqueoBodega={{
          bloqueada: false,
          porMensajeros: false,
          porCierreBodega: false,
        }}
      />,
    );

    // Sin envío previo no hay nada que descargar (R17).
    expect(
      screen.queryByRole("button", { name: /descargar manifiesto/i }),
    ).toBeNull();

    // El rediseño de la bodega satélite (pedido humano) fundió las cuatro secciones por
    // estado en UN listado con barra de filtros, así que ya no hay región "Por devolver" que
    // acotar: los checkboxes se buscan por su nombre, que sigue siendo único por remisión.
    // Lo que este caso protege —el manifiesto lleva SOLO las enviadas con éxito— no cambia.
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar REM-D1" }));
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar REM-D2" }));
    await user.click(screen.getByRole("button", { name: "Enviar a central" }));

    const boton = await screen.findByRole("button", {
      name: /descargar manifiesto/i,
    });
    await user.click(boton);

    expect(obtenerManifiestoMock).toHaveBeenCalledWith({
      flujo: "devolucion_central",
      ordenIds: ["d1"], // la que falló queda fuera
    });
  });

  it("R23: tras enviar a la tienda ofrece el manifiesto de las enviadas", async () => {
    const user = userEvent.setup();
    devolverATiendaMock.mockResolvedValue({ status: "ok" });
    render(
      <DevolverATiendaModal
        open
        ordenes={[makeOrden({ id: "t1" }), makeOrden({ id: "t2" })]}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Enviar a la tienda" }));
    await user.click(await screen.findByRole("button", { name: /descargar manifiesto/i }));

    expect(obtenerManifiestoMock).toHaveBeenCalledWith({
      flujo: "envio_tienda",
      ordenIds: ["t1", "t2"],
    });
  });

  it("R23/R25: si el envío a la tienda falla, no hay fase de resultado ni manifiesto", async () => {
    const user = userEvent.setup();
    devolverATiendaMock.mockResolvedValue({ status: "conflict", motivo: "estado" });
    const onSuccess = vi.fn();
    render(
      <DevolverATiendaModal
        open
        ordenes={[makeOrden({ id: "t1" })]}
        onOpenChange={vi.fn()}
        onSuccess={onSuccess}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Enviar a la tienda" }));

    await waitFor(() => expect(errorMock).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("button", { name: /descargar manifiesto/i }),
    ).toBeNull();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(obtenerManifiestoMock).not.toHaveBeenCalled();
  });

  it("R25: un fallo de la descarga NO re-ejecuta la acción de negocio ni revierte su resultado", async () => {
    const user = userEvent.setup();
    generarGuiaMock.mockResolvedValue({
      status: "ok",
      resultados: [{ ordenId: "o1", numGuia: 7, estado: "en_bodega_central" }],
    });
    obtenerManifiestoMock.mockRejectedValue(new Error("red caída"));
    const onSuccess = vi.fn();
    render(
      <GenerarGuiaModal
        open
        ordenes={[makeOrden({ id: "o1" })]}
        onOpenChange={vi.fn()}
        onSuccess={onSuccess}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Generar guía" }));
    const descargar = await screen.findByRole("button", {
      name: /descargar manifiesto/i,
    });
    await user.click(descargar);

    await waitFor(() => expect(errorMock).toHaveBeenCalledTimes(1));
    // La operación de negocio NO se repite ni se deshace…
    expect(generarGuiaMock).toHaveBeenCalledTimes(1);
    // …su resultado sigue visible y con su toast de éxito intacto (R26).
    expect(successMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/guía generada para 1 orden\(es\)/i),
    ).toBeInTheDocument();
    // …y se puede cerrar el flujo con normalidad: el refresco del padre ocurre igual.
    await user.click(screen.getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it("R27: la llamada de negocio conserva su input, su toast y su manejo de resultado", async () => {
    const user = userEvent.setup();
    rutearMock.mockResolvedValue({
      status: "ok",
      resultados: [{ ordenId: "o1", estado: "en_ruta_bodega_satelite" }],
    });
    const onSuccess = vi.fn();
    render(
      <RutearSateliteModal
        open
        ordenes={[makeOrden({ id: "o1", numRemision: "REM-1" })]}
        onOpenChange={vi.fn()}
        onSuccess={onSuccess}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Rutear a bodega satélite" }),
    );

    // Input idéntico y UNA sola llamada; el manifiesto no participa de la operación.
    expect(rutearMock).toHaveBeenCalledTimes(1);
    expect(rutearMock).toHaveBeenCalledWith({ ordenIds: ["o1"] });
    expect(successMock).toHaveBeenCalledWith(
      "1 orden(es) en ruta a bodega satélite.",
    );
    // La acción de lectura del manifiesto NO se dispara sola (§9.7: botón explícito).
    expect(obtenerManifiestoMock).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();

    // Y el refresco del padre sigue ocurriendo, al cerrar la fase de resultado.
    await user.click(screen.getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });
});
