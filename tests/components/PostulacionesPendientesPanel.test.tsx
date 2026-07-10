// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { PostulacionesPendientesPanel } from "@/app/(app)/_components/PostulacionesPendientesPanel";
import {
  listarPostulacionesPendientes,
  aprobarPostulacion,
  rechazarPostulacion,
} from "@/lib/actions/aprobacion-postulaciones";
import type {
  DocumentoFirmadoDTO,
  PostulacionPendienteDTO,
} from "@/lib/types/aprobacion-postulacion";

// Feature 23 — mock de las 3 Server Actions consumidas (feature 22). El panel
// consume solo estas actions; no toca services/repositories/prisma (R19).
vi.mock("@/lib/actions/aprobacion-postulaciones", () => ({
  listarPostulacionesPendientes: vi.fn(),
  aprobarPostulacion: vi.fn(),
  rechazarPostulacion: vi.fn(),
}));

// El feedback usa useToast: se mockea para aseverar success/error sin viewport.
const { successMock, errorMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    info: vi.fn(),
    warning: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const listarMock = vi.mocked(listarPostulacionesPendientes);
const aprobarMock = vi.mocked(aprobarPostulacion);
const rechazarMock = vi.mocked(rechazarPostulacion);

function makeDocumentos(): DocumentoFirmadoDTO[] {
  return [
    { tipo: "cedula_anverso", url: "https://s/ced-a", expiresInSeconds: 300 },
    { tipo: "cedula_reverso", url: "https://s/ced-r", expiresInSeconds: 300 },
    { tipo: "propiedad_anverso", url: "https://s/mat-a", expiresInSeconds: 300 },
    { tipo: "propiedad_reverso", url: "https://s/mat-r", expiresInSeconds: 300 },
    { tipo: "foto_rostro", url: "https://s/foto", expiresInSeconds: 300 },
  ];
}

function makePostulacion(
  id: string,
  overrides: Partial<PostulacionPendienteDTO> = {},
): PostulacionPendienteDTO {
  return {
    usuarioId: id,
    nombre: `Nombre-${id}`,
    primerApellido: "Ap",
    segundoApellido: null,
    email: `${id}@example.com`,
    telefono: "0999999999",
    tipoIdentificacion: "cedula",
    cedula: "0102030405",
    vehiculo: "moto",
    placa: "ABC-1234",
    documentos: makeDocumentos(),
    ...overrides,
  };
}

function renderPanel(): void {
  const element: ReactElement = (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PostulacionesPendientesPanel />
    </SWRConfig>
  );
  render(element);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("PostulacionesPendientesPanel (feature 23)", () => {
  it("R6: al montar invoca listarPostulacionesPendientes y lista los items", async () => {
    listarMock.mockResolvedValue({
      status: "ok",
      items: [makePostulacion("u1"), makePostulacion("u2")],
      page: 1,
      pageSize: 20,
      total: 2,
    });

    renderPanel();

    await screen.findByText("Nombre-u1 Ap");
    expect(screen.getByText("Nombre-u2 Ap")).toBeInTheDocument();
    expect(listarMock).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });

  it("R10: muestra estado de carga mientras resuelve", () => {
    listarMock.mockReturnValue(new Promise(() => {}));
    renderPanel();
    expect(screen.getByRole("status")).toHaveTextContent(/Cargando/i);
  });

  it("R11: muestra 'No hay postulaciones pendientes' con lista vacía", async () => {
    listarMock.mockResolvedValue({
      status: "ok",
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
    renderPanel();
    await screen.findByText("No hay postulaciones pendientes");
  });

  it("R12: muestra estado de error cuando la action devuelve ActionError", async () => {
    listarMock.mockResolvedValue({ status: "forbidden" });
    renderPanel();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No se pudieron cargar las postulaciones");
  });

  it("R9: pagina con Pagination usando page/pageSize/total del backend", async () => {
    listarMock.mockResolvedValue({
      status: "ok",
      items: [makePostulacion("u1")],
      page: 1,
      pageSize: 20,
      total: 45,
    });
    renderPanel();

    await screen.findByText("Nombre-u1 Ap");
    // total 45 / pageSize 20 => 3 páginas.
    const nav = screen.getByRole("navigation", { name: "Paginación" });
    expect(within(nav).getByText("Página 1 de 3")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(within(nav).getByRole("button", { name: "Página siguiente" }));
    await waitFor(() =>
      expect(listarMock).toHaveBeenCalledWith({ page: 2, pageSize: 20 }),
    );
  });

  it("R14/R15/R17: aprobar abre el modal, confirmar invoca aprobarPostulacion con el usuarioId, toast de éxito, refresco y la fila desaparece", async () => {
    const user = userEvent.setup();
    let items = [makePostulacion("u1"), makePostulacion("u2")];
    listarMock.mockImplementation(async () => ({
      status: "ok",
      items,
      page: 1,
      pageSize: 20,
      total: items.length,
    }));
    aprobarMock.mockImplementation(async () => {
      items = items.filter((p) => p.usuarioId !== "u1");
      return { status: "ok", usuarioId: "u1", estado: "activo" };
    });

    renderPanel();
    const card = await screen.findByTestId("postulacion-u1");

    // R14: abre el modal de confirmación.
    await user.click(within(card).getByRole("button", { name: "Aprobar" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Aprobar la postulación de Nombre-u1/)).toBeInTheDocument();

    // R15: confirmar invoca aprobarPostulacion con el usuarioId.
    await user.click(within(dialog).getByRole("button", { name: "Aprobar" }));
    await waitFor(() => expect(aprobarMock).toHaveBeenCalledWith("u1"));

    // R17: toast de éxito y la fila desaparece tras el refresco.
    await waitFor(() => expect(successMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByTestId("postulacion-u1")).toBeNull(),
    );
    expect(screen.getByTestId("postulacion-u2")).toBeInTheDocument();
  });

  it("R15: rechazar confirmado invoca rechazarPostulacion con el usuarioId", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue({
      status: "ok",
      items: [makePostulacion("u9")],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    rechazarMock.mockResolvedValue({
      status: "ok",
      usuarioId: "u9",
      estado: "inactivo",
    });

    renderPanel();
    const card = await screen.findByTestId("postulacion-u9");
    await user.click(within(card).getByRole("button", { name: "Rechazar" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Rechazar" }));

    await waitFor(() => expect(rechazarMock).toHaveBeenCalledWith("u9"));
    await waitFor(() => expect(successMock).toHaveBeenCalledTimes(1));
  });

  it("R16: mientras corre la action el confirmar se bloquea y muestra spinner", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue({
      status: "ok",
      items: [makePostulacion("u1")],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    let resolveAprobar!: (v: {
      status: "ok";
      usuarioId: string;
      estado: "activo";
    }) => void;
    aprobarMock.mockImplementation(
      () =>
        new Promise((res) => {
          resolveAprobar = res;
        }),
    );

    renderPanel();
    const card = await screen.findByTestId("postulacion-u1");
    await user.click(within(card).getByRole("button", { name: "Aprobar" }));

    const dialog = await screen.findByRole("dialog");
    const confirmar = within(dialog).getByRole("button", { name: "Aprobar" });
    await user.click(confirmar);

    // Mientras corre: spinner (role=status) y confirmar deshabilitado.
    await waitFor(() =>
      expect(within(dialog).getByRole("status")).toBeInTheDocument(),
    );
    expect(within(dialog).getByRole("button", { name: /Aprobar/ })).toBeDisabled();

    resolveAprobar({ status: "ok", usuarioId: "u1", estado: "activo" });
    await waitFor(() => expect(successMock).toHaveBeenCalled());
  });

  it("R18: ActionError → toast de error mapeado y la fila permanece", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue({
      status: "ok",
      items: [makePostulacion("u1")],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    aprobarMock.mockResolvedValue({ status: "conflict" });

    renderPanel();
    const card = await screen.findByTestId("postulacion-u1");
    await user.click(within(card).getByRole("button", { name: "Aprobar" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Aprobar" }));

    await waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith("La postulación ya fue procesada."),
    );
    expect(successMock).not.toHaveBeenCalled();
    // La fila permanece.
    expect(screen.getByTestId("postulacion-u1")).toBeInTheDocument();
  });
});
