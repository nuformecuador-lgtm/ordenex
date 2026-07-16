// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RecepcionSateliteModule } from "@/app/(app)/recepcion-satelite/_components/RecepcionSateliteModule";
import { devolverATienda } from "@/lib/actions/devolucion-origen";
import { recibirLote } from "@/lib/actions/recepcion-satelite";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";

// Feature 33 (T12) — módulo de la bodega satélite. Se mockean la Server Action de
// recepción, el toast, el router (refresh) y la lib de cámara (sin hardware en CI).
// Feature 63: se mockea también `recibirLote` (recepción en lote "Aceptar todas"/
// "Aceptar") que consume la sección compartida "Por recibir".
vi.mock("@/lib/actions/recepcion-satelite", () => ({
  recibirPorQr: vi.fn(),
  listarRecepcionSatelite: vi.fn(),
  asignarDesdeSatelite: vi.fn(),
  recibirLote: vi.fn(),
}));

const recibirLoteMock = vi.mocked(recibirLote);

// Feature 48 (T9): la sección "Por devolver a tienda" ejecuta el retorno vía esta
// Server Action; se mockea para verificar la invocación por fila.
vi.mock("@/lib/actions/devolucion-origen", () => ({
  devolverATienda: vi.fn(),
}));

const devolverATiendaMock = vi.mocked(devolverATienda);

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

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

function renderModule(
  props?: Partial<Parameters<typeof RecepcionSateliteModule>[0]>,
) {
  render(
    <RecepcionSateliteModule
      porRecibir={props?.porRecibir ?? []}
      recibidas={props?.recibidas ?? []}
      porDevolver={props?.porDevolver ?? []}
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
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

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
    expect(screen.getByRole("region", { name: "Recibidas" })).toBeInTheDocument();
  });

  it("Feature 63: la sección 'Por recibir' expone 'Aceptar todas' + 'Aceptar' por-orden, pero NO asignar/gestionar", () => {
    renderModule({
      porRecibir: [
        makeOrden({ id: "r1", numRemision: "REM-R1" }),
        makeOrden({ id: "r2", numRemision: "REM-R2" }),
      ],
    });

    const region = screen.getByRole("region", { name: "Por recibir" });
    // La recepción en lote reutiliza la sección del mensajero: acción en lote…
    expect(
      within(region).getByRole("button", { name: "Aceptar todas" }),
    ).toBeInTheDocument();
    // …y una acción por-orden por cada tarjeta.
    expect(
      within(region).getAllByRole("button", { name: "Aceptar" }),
    ).toHaveLength(2);
    // Sigue SIN exponer asignar/gestionar en esta sección.
    expect(
      within(region).queryByRole("button", { name: /asignar|gestionar/i }),
    ).toBeNull();
  });

  it("R9: 'Recibidas' renderiza el estado legible 'En bodega satélite de <zona>'", () => {
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

    const region = screen.getByRole("region", { name: "Recibidas" });
    expect(
      within(region).getByText("En bodega satélite de Limón"),
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

    const region = screen.getByRole("region", { name: "Recibidas" });
    // El texto aparece tanto en el título de la card como en el detalle.
    expect(within(region).getAllByText(/REM-RECIBIDA/).length).toBeGreaterThan(0);
    expect(within(region).getAllByText(/Beto Ruiz/).length).toBeGreaterThan(0);
  });

  it("R5: si sinZona, muestra aviso accionable y NO ofrece el escáner", () => {
    renderModule({ sinZona: true, zonaNombre: null });

    expect(screen.getByRole("alert")).toHaveTextContent(
      /no tienes una zona asignada/i,
    );
    // Sin zona → sin recepción posible: no se monta la sección de escaneo.
    expect(
      screen.queryByRole("region", { name: "Recepción por escaneo" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Escanear con cámara" }),
    ).toBeNull();
  });

  // El camino del lector físico (input keyboard-wedge, R10) se retiró por decisión
  // humana: la cámara es la ÚNICA entrada de recepción por escaneo.
  it("con zona, ofrece el escáner (cámara) como única entrada, sin input de teclado", () => {
    renderModule({ sinZona: false });

    expect(
      screen.getByRole("region", { name: "Recepción por escaneo" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Escanear con cámara" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
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

    const region = screen.getByRole("region", { name: "Recibidas" });
    const asignar = within(region).getByRole("button", { name: "Asignar" });
    // Sin selección, la acción está deshabilitada.
    expect(asignar).toBeDisabled();

    const checkbox = within(region).getByRole("checkbox", {
      name: "Seleccionar REM-B1",
    });
    await user.click(checkbox);

    expect(asignar).toBeEnabled();
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

    const region = screen.getByRole("region", { name: "Recibidas" });
    // Es una tabla, no una lista de cards.
    const tabla = within(region).getByRole("table", { name: "Recibidas" });
    // Cabeceras: la de selección + las de datos espejadas de ordenes-columns.
    const headers = within(tabla)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toEqual([
      "Seleccionar",
      "Nº Guía",
      "Nº Remisión",
      "Estado",
      "Destinatario",
      "Producto",
      "Dirección",
      "Tienda",
      "Zona",
      "Provincia",
      "Cantón",
      "Distrito",
      "Monto a cobrar",
    ]);
    // La fila muestra los datos de la orden en columnas.
    expect(within(tabla).getByText("REM-B1")).toBeInTheDocument();
    expect(within(tabla).getByText("Beto Ruiz")).toBeInTheDocument();
    expect(within(tabla).getByText("Caja grande")).toBeInTheDocument();
    expect(within(tabla).getByText("Av. Central 10")).toBeInTheDocument();
    expect(within(tabla).getByText("Tienda Z")).toBeInTheDocument();
    expect(
      within(tabla).getByText("En bodega satélite de Limón"),
    ).toBeInTheDocument();
    // Una fila de datos (más la de cabecera).
    expect(within(tabla).getAllByRole("row")).toHaveLength(2);
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
      screen.getByRole("region", { name: "Recibidas" }),
    ).getByRole("table", { name: "Recibidas" });
    expect(within(tabla).getByText("Pendiente")).toBeInTheDocument();
  });

  it("Pedido humano: sin órdenes recibidas la tabla muestra el vacío", () => {
    renderModule({ recibidas: [] });

    const tabla = within(
      screen.getByRole("region", { name: "Recibidas" }),
    ).getByRole("table", { name: "Recibidas" });
    expect(
      within(tabla).getByText("Aún no has recibido órdenes."),
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

    const region = screen.getByRole("region", { name: "Recibidas" });
    const tabla = within(region).getByRole("table", { name: "Recibidas" });
    const asignar = within(region).getByRole("button", { name: "Asignar" });
    expect(asignar).toBeDisabled();

    await user.click(
      within(tabla).getByRole("checkbox", { name: "Seleccionar REM-B1" }),
    );
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

    const region = screen.getByRole("region", { name: "Recibidas" });
    const alerta = within(region).getByRole("alert");
    expect(alerta).toHaveTextContent(/resuelve los cierres pendientes de tus mensajeros/i);
    expect(alerta).not.toHaveTextContent(/cierre de bodega hacia la central/i);

    // Aun seleccionando una orden, "Asignar" queda deshabilitado por el bloqueo.
    const checkbox = within(region).getByRole("checkbox", {
      name: "Seleccionar REM-B1",
    });
    await user.click(checkbox);
    expect(within(region).getByRole("button", { name: "Asignar" })).toBeDisabled();
  });

  it("R22: bodega bloqueada por CIERRE DE BODEGA (ii) muestra el aviso de esa causa", () => {
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

    const region = screen.getByRole("region", { name: "Recibidas" });
    const alerta = within(region).getByRole("alert");
    expect(alerta).toHaveTextContent(/cierre de bodega hacia la central está pendiente de aprobación/i);
    expect(alerta).not.toHaveTextContent(/resuelve los cierres pendientes de tus mensajeros/i);
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

    const alerta = within(
      screen.getByRole("region", { name: "Recibidas" }),
    ).getByRole("alert");
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

    const region = screen.getByRole("region", { name: "Recibidas" });
    expect(within(region).queryByRole("alert")).toBeNull();
    await user.click(
      within(region).getByRole("checkbox", { name: "Seleccionar REM-B1" }),
    );
    expect(within(region).getByRole("button", { name: "Asignar" })).toBeEnabled();
  });

  // ---------- Feature 48 (T9) — devolución a la tienda de origen ----------

  it("R10/R14: 'Por devolver a tienda' lista las órdenes rechazada de la zona con su botón", () => {
    renderModule({
      porDevolver: [
        makeOrden({
          id: "d1",
          numRemision: "REM-RECHAZADA",
          destinatario: "Caro Díaz",
          estatusValue: "rechazada",
        }),
      ],
    });

    const region = screen.getByRole("region", {
      name: "Por devolver a tienda",
    });
    expect(within(region).getAllByText(/REM-RECHAZADA/).length).toBeGreaterThan(0);
    expect(within(region).getAllByText(/Caro Díaz/).length).toBeGreaterThan(0);
    expect(
      within(region).getByRole("button", { name: "Devolver a la tienda" }),
    ).toBeInTheDocument();
  });

  it("R4/R10: el botón 'Devolver a la tienda' dispara devolverATienda con el ordenId y en éxito refresca", async () => {
    const user = userEvent.setup();
    devolverATiendaMock.mockResolvedValue({ status: "ok" });
    renderModule({
      porDevolver: [
        makeOrden({
          id: "d1",
          numRemision: "REM-RECHAZADA",
          estatusValue: "rechazada",
        }),
      ],
    });

    const region = screen.getByRole("region", {
      name: "Por devolver a tienda",
    });
    await user.click(
      within(region).getByRole("button", { name: "Devolver a la tienda" }),
    );

    expect(devolverATiendaMock).toHaveBeenCalledTimes(1);
    expect(devolverATiendaMock).toHaveBeenCalledWith({ ordenId: "d1" });
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
  });

  it("R4: un resultado no-ok muestra el error por fila y NO refresca", async () => {
    const user = userEvent.setup();
    devolverATiendaMock.mockResolvedValue({ status: "conflict", motivo: "estado" });
    renderModule({
      porDevolver: [
        makeOrden({
          id: "d1",
          numRemision: "REM-RECHAZADA",
          estatusValue: "rechazada",
        }),
      ],
    });

    const region = screen.getByRole("region", {
      name: "Por devolver a tienda",
    });
    await user.click(
      within(region).getByRole("button", { name: "Devolver a la tienda" }),
    );

    await vi.waitFor(() =>
      expect(within(region).getByRole("alert")).toBeInTheDocument(),
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("sin órdenes por devolver muestra el vacío", () => {
    renderModule({ porDevolver: [] });

    const region = screen.getByRole("region", {
      name: "Por devolver a tienda",
    });
    expect(
      within(region).getByText("No hay órdenes por devolver."),
    ).toBeInTheDocument();
    expect(
      within(region).queryByRole("button", { name: "Devolver a la tienda" }),
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

  it("Feature 63: 'Aceptar todas' llama recibirLote con TODOS los ids y en éxito refresca", async () => {
    const user = userEvent.setup();
    recibirLoteMock.mockResolvedValue({ status: "ok", recibidas: 2 });
    renderModule({
      porRecibir: [
        makeOrden({ id: "r1", numRemision: "REM-R1" }),
        makeOrden({ id: "r2", numRemision: "REM-R2" }),
      ],
    });

    const region = screen.getByRole("region", { name: "Por recibir" });
    await user.click(within(region).getByRole("button", { name: "Aceptar todas" }));

    await vi.waitFor(() => expect(recibirLoteMock).toHaveBeenCalledTimes(1));
    expect(recibirLoteMock).toHaveBeenCalledWith({ ordenIds: ["r1", "r2"] });
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
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

  it("Feature 63: sin zona NO muestra los botones de aceptar (solo se listan)", () => {
    renderModule({
      sinZona: true,
      zonaNombre: null,
      porRecibir: [makeOrden({ id: "r1", numRemision: "REM-R1" })],
    });

    const region = screen.getByRole("region", { name: "Por recibir" });
    expect(
      within(region).queryByRole("button", { name: "Aceptar todas" }),
    ).toBeNull();
    expect(
      within(region).queryByRole("button", { name: "Aceptar" }),
    ).toBeNull();
    // La orden sigue listándose aunque no se pueda aceptar.
    expect(within(region).getAllByText(/REM-R1/).length).toBeGreaterThan(0);
  });
});
