// @vitest-environment jsdom
// Feature 253 (T7.2) — el panel del admin de las postulaciones de vehículo o bodega.
// Cubre R29 (la lista), R30 (paginación), R31 (la fila desaparece al atender), R33 (las dos
// pestañas) , R34 (**el fallo de atender NO es mudo y la fila permanece**) y R35 (estado vacío).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { PostulacionRecursoPanel } from "@/app/(app)/_components/PostulacionRecursoPanel";
import {
  listarPostulacionesRecurso,
  marcarPostulacionRecursoAtendida,
} from "@/lib/actions/atencion-postulaciones-recurso";
import type { PostulacionRecursoDTO } from "@/lib/types/postulacion-recurso";

// Las DOS Server Actions del admin son el único borde que este panel toca. Se doblan porque el
// servidor tiene sus propios tests (T3.4/T5.1) y aquí se mide la superficie.
vi.mock("@/lib/actions/atencion-postulaciones-recurso", () => ({
  listarPostulacionesRecurso: vi.fn(),
  marcarPostulacionRecursoAtendida: vi.fn(),
}));

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

const listarMock = vi.mocked(listarPostulacionesRecurso);
const atenderMock = vi.mocked(marcarPostulacionRecursoAtendida);

function hacer(
  id: string,
  overrides: Partial<PostulacionRecursoDTO> = {},
): PostulacionRecursoDTO {
  return {
    id,
    tipo: "vehiculo",
    nombre: `Persona-${id}`,
    telefono: "+506 8888-8888",
    correo: `${id}@example.com`,
    mensaje: `Mensaje de ${id}`,
    createdAt: "2026-08-20T15:30:00.000Z",
    atendidaAt: null,
    atendidaPor: null,
    ...overrides,
  };
}

function ok(items: PostulacionRecursoDTO[], total = items.length) {
  return { status: "ok" as const, items, page: 1, pageSize: 20, total };
}

function renderPanel(): void {
  const element: ReactElement = (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PostulacionRecursoPanel />
    </SWRConfig>
  );
  render(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  listarMock.mockResolvedValue(ok([]));
});

afterEach(() => {
  cleanup();
});

// -------------------------------------------------------------------------------------------------

describe("253/R29 + R30 — el panel lista y pagina", () => {
  it("al montar pide las PENDIENTES y las pinta", async () => {
    listarMock.mockResolvedValue(ok([hacer("p1"), hacer("p2")]));
    renderPanel();

    await screen.findByText("Persona-p1");
    expect(screen.getByText("Persona-p2")).toBeInTheDocument();
    expect(listarMock).toHaveBeenCalledWith({
      atendidas: false,
      page: 1,
      pageSize: 20,
    });
  });

  it("R30: la paginación existe y cambia de página pidiendo la siguiente", async () => {
    listarMock.mockResolvedValue(ok([hacer("p1")], 60));
    renderPanel();
    await screen.findByText("Persona-p1");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Página siguiente/ }));

    await waitFor(() =>
      expect(listarMock).toHaveBeenCalledWith({
        atendidas: false,
        page: 2,
        pageSize: 20,
      }),
    );
  });

  it("mientras carga lo dice, y si la carga falla lo dice TAMBIÉN (no se queda en blanco)", async () => {
    listarMock.mockReturnValue(new Promise(() => {}));
    renderPanel();
    expect(screen.getByRole("status")).toHaveTextContent(/Cargando/i);

    cleanup();
    vi.clearAllMocks();
    // El fetcher LANZA si el status no es `ok`: sin eso, SWR nunca expondría `error` y un
    // `forbidden` se leería como «no hay postulaciones».
    listarMock.mockResolvedValue({ status: "forbidden" });
    renderPanel();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudieron cargar las postulaciones de vehículos y bodegas.",
    );
  });
});

// -------------------------------------------------------------------------------------------------

describe("253/R35 — el estado vacío EXPLICA de dónde salen estas postulaciones", () => {
  it("sin pendientes, dice qué va a aparecer ahí y por qué", async () => {
    renderPanel();

    expect(
      await screen.findByText("No hay vehículos ni bodegas por revisar"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Cuando alguien ofrezca su vehículo o su bodega desde la web, su postulación aparece acá para que la contacten.",
      ),
    ).toBeInTheDocument();
  });
});

// -------------------------------------------------------------------------------------------------

describe("253/R33 — las dos pestañas: un clic equivocado no hace desaparecer nada", () => {
  it("«Atendidas» vuelve a pedir el listado con el filtro puesto y vuelve a la página 1", async () => {
    listarMock.mockResolvedValue(ok([hacer("p1")], 60));
    renderPanel();
    await screen.findByText("Persona-p1");

    const user = userEvent.setup();
    // Se avanza de página primero: la 3 de pendientes no significa nada en atendidas, y quedarse
    // en ella pintaría un vacío que no quiere decir «no hay ninguna».
    await user.click(screen.getByRole("button", { name: /Página siguiente/ }));
    await waitFor(() =>
      expect(listarMock).toHaveBeenCalledWith({ atendidas: false, page: 2, pageSize: 20 }),
    );

    listarMock.mockResolvedValue(
      ok([hacer("a1", { atendidaAt: "2026-08-21T18:00:00.000Z", atendidaPor: "Marta Vega" })]),
    );
    await user.click(screen.getByRole("tab", { name: "Atendidas" }));

    await waitFor(() =>
      expect(listarMock).toHaveBeenCalledWith({ atendidas: true, page: 1, pageSize: 20 }),
    );
    expect(await screen.findByText(/Atendida por Marta Vega el/)).toBeInTheDocument();
    // Y sobre una fila YA atendida no se ofrece volver a atenderla: `atender` es una mutación
    // única y en un solo sentido, y un segundo intento sólo puede acabar en `conflict`.
    expect(screen.queryByRole("button", { name: "Marcar como atendida" })).toBeNull();
  });

  it("en «Atendidas» no hay botón de atender, y el estado vacío es el suyo", async () => {
    renderPanel();
    await screen.findByText("No hay vehículos ni bodegas por revisar");

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Atendidas" }));

    expect(await screen.findByText("No hay postulaciones atendidas")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Acá quedan las postulaciones que alguien del equipo ya marcó como atendidas.",
      ),
    ).toBeInTheDocument();
  });
});

// -------------------------------------------------------------------------------------------------

describe("253/R31 — atender registra la atención y la fila desaparece de pendientes", () => {
  it("confirmar llama a la acción con el id y refresca el listado", async () => {
    listarMock.mockResolvedValue(ok([hacer("p1")]));
    atenderMock.mockResolvedValue({
      status: "ok",
      id: "p1",
      atendidaAt: "2026-08-21T18:00:00.000Z",
    });
    renderPanel();
    await screen.findByText("Persona-p1");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Marcar como atendida" }));

    // El refresco trae la lista YA sin esa fila: es lo que ve el administrador.
    listarMock.mockResolvedValue(ok([]));
    const dialogo = await screen.findByRole("dialog");
    await user.click(within(dialogo).getByRole("button", { name: "Marcar como atendida" }));

    await waitFor(() => expect(atenderMock).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(screen.queryByText("Persona-p1")).toBeNull());
    expect(successMock).toHaveBeenCalledWith("Postulación marcada como atendida.");
  });
});

// -------------------------------------------------------------------------------------------------

describe("253/R34 — 💀 si atender falla, la pantalla lo DICE y la fila permanece", () => {
  /**
   * La lección literal de `progress/impl_240.md` §9.1 y de la ficha 248: un control que no hace
   * nada **ni avisa** es el mismo defecto que esta ficha cierra, una capa más abajo. Por eso el
   * aviso va por DOS canales —toast y texto en pantalla—: el toast se va solo, y quien mire la
   * lista dos segundos después no tendría forma de saber que la operación no ocurrió.
   */
  it.each([
    ["conflict", "Esa postulación ya la atendió alguien más."],
    ["not_found", "Esa postulación ya no existe."],
    ["forbidden", "No tienes permiso para marcar postulaciones como atendidas."],
  ] as const)("%s: mensaje visible en pantalla, y la fila sigue ahí", async (status, texto) => {
    listarMock.mockResolvedValue(ok([hacer("p1")]));
    atenderMock.mockResolvedValue({ status } as never);
    renderPanel();
    await screen.findByText("Persona-p1");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Marcar como atendida" }));
    const dialogo = await screen.findByRole("dialog");
    await user.click(within(dialogo).getByRole("button", { name: "Marcar como atendida" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(texto);
    expect(errorMock).toHaveBeenCalledWith(texto);
    // R34: la fila PERMANECE. Nada se optimiza en local antes de que el servidor confirme.
    expect(screen.getByText("Persona-p1")).toBeInTheDocument();
  });

  it("una promesa ROTA tampoco deja el panel mudo (no llega ningún `status`)", async () => {
    listarMock.mockResolvedValue(ok([hacer("p1")]));
    atenderMock.mockRejectedValue(new Error("network down"));
    renderPanel();
    await screen.findByText("Persona-p1");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Marcar como atendida" }));
    const dialogo = await screen.findByRole("dialog");
    await user.click(within(dialogo).getByRole("button", { name: "Marcar como atendida" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo marcar la postulación como atendida. Volvé a intentarlo.",
    );
    expect(screen.getByText("Persona-p1")).toBeInTheDocument();
  });
});
