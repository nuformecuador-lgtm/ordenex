// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { SinpeBodegaDTO } from "@/lib/types/sinpe-bodega";

/**
 * ⭑ FICHA 429 / T22 — EL AVISO DEL PRIMER INGRESO (R26, R27, R28, R29, R30).
 *
 * Lo que se mide aquí, y por qué cada caso existe:
 *
 * · **R26** — el aviso PONE DELANTE el número y el titular vigentes de esa bodega, sin que haya
 *   que ir a buscarlos. Es la única de las tres capas de D3 que consigue que alguien MIRE el
 *   número: las otras dos garantizan que no hay hueco, no que nadie se haya fijado.
 * · **R27** — se corrige EN EL SITIO. Mandar a otra pantalla es un paso donde la gente se cae, y
 *   quien acaba de ver que el número está mal es exactamente quien puede arreglarlo en ese
 *   segundo.
 * · **R25/R29** — CERRAR NO CONFIRMA NADA. Es la mitad que hace que «confirmar» signifique algo:
 *   si cerrar marcara la bodega como revisada, el tercer nivel de D3 sería un adorno que se
 *   desactiva con un Escape sin leer nada.
 * · **R29** — dentro de la MISMA sesión no reaparece; sin la marca de sesión, sí. Un aviso que
 *   vuelve a cada navegación se cierra por reflejo a los tres minutos y deja de decir nada.
 * · **R25** — confirmar SIN cambiar nada llama a `confirmarSinpeBodega` y NO a `guardarSinpeBodega`:
 *   una confirmación no cambia nada y no mueve dinero, así que no puede dejar fila en el registro
 *   del dinero.
 *
 * Los textos se afirman como LITERALES, no contra `sinpe-textos.ts`: compararlos con la fuente
 * que los genera estaría verde con el texto roto (es el defecto que este repo ya documentó como
 * «aserción contra su propia fuente»).
 */

const guardarSinpeBodegaMock = vi.fn();
const confirmarSinpeBodegaMock = vi.fn();
vi.mock("@/lib/actions/sinpe-bodega", () => ({
  guardarSinpeBodega: (...a: unknown[]) => guardarSinpeBodegaMock(...a),
  confirmarSinpeBodega: (...a: unknown[]) => confirmarSinpeBodegaMock(...a),
  listarSinpeBodegas: vi.fn(),
}));

const { successMock, errorMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
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

const { RevisionSinpeBodega } = await import(
  "@/components/shared/RevisionSinpeBodega"
);

/** ⚠️ NINGÚN SINPE DE AQUÍ ES REAL: el repositorio es PÚBLICO. */
const BODEGA: SinpeBodegaDTO = {
  zonaId: "z-guanacaste",
  zonaNombre: "Guanacaste",
  esCentral: false,
  numero: "80000000",
  nombre: "Titular de Prueba",
  revisadoAt: null,
  editable: true,
};

const campoNumero = () => screen.getByRole("textbox", { name: "Número SINPE" });
const campoNombre = () => screen.getByRole("textbox", { name: "A nombre de" });
const botonConfirmar = () => screen.getByRole("button", { name: "Confirmar" });
const botonAhoraNo = () => screen.getByRole("button", { name: "Ahora no" });

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  confirmarSinpeBodegaMock.mockResolvedValue({ status: "ok" });
  guardarSinpeBodegaMock.mockResolvedValue({
    status: "ok",
    bodega: { ...BODEGA, numero: "71111111", revisadoAt: "2026-09-15T18:00:00.000Z" },
  });
});

afterEach(cleanup);

describe("429/R26 — el aviso enseña el par vigente, sin que haya que ir a buscarlo", () => {
  it("nombra la bodega en el título y precarga los dos campos con lo que hay guardado", () => {
    render(<RevisionSinpeBodega bodega={BODEGA} />);

    expect(
      screen.getByText("Confirmá el SINPE de Guanacaste"),
    ).toBeInTheDocument();
    expect(campoNumero()).toHaveValue("80000000");
    expect(campoNombre()).toHaveValue("Titular de Prueba");
  });

  it("⭑ dice POR QUÉ se lo están pidiendo, no solo que lo confirme", () => {
    render(<RevisionSinpeBodega bodega={BODEGA} />);

    expect(
      screen.getByText(
        "Hasta ahora tu bodega cobraba en el número de la central. Confirmá el tuyo para que la plata de tus clientes llegue a donde tiene que llegar.",
      ),
    ).toBeInTheDocument();
  });

  it("⭑ ofrece LAS DOS salidas, y «Ahora no» es una de ellas", () => {
    // R28: el aviso pide, no bloquea. Dejar a alguien sin poder entrar a trabajar por no
    // confirmar un número sería un remedio peor que la enfermedad.
    render(<RevisionSinpeBodega bodega={BODEGA} />);

    expect(botonConfirmar()).toBeInTheDocument();
    expect(botonAhoraNo()).toBeInTheDocument();
  });
});

describe("429/R27 — se corrige EN EL SITIO, sin abandonar la pantalla", () => {
  it("⭑ cambiar el número y confirmar GUARDA el par nuevo desde el propio aviso", async () => {
    const user = userEvent.setup();
    render(<RevisionSinpeBodega bodega={BODEGA} />);

    await user.clear(campoNumero());
    await user.type(campoNumero(), "71111111");
    await user.click(botonConfirmar());

    await waitFor(() =>
      expect(guardarSinpeBodegaMock).toHaveBeenCalledWith("z-guanacaste", {
        numero: "71111111",
        nombre: "Titular de Prueba",
      }),
    );
    // Y NO por la puerta de «confirmar sin cambios»: eso dejaría el número viejo en la base y la
    // bodega marcada como revisada, que es el peor de los dos estados posibles.
    expect(confirmarSinpeBodegaMock).not.toHaveBeenCalled();
  });

  it("⭑ un número inválido pinta el error JUNTO AL CAMPO del número, no como toast genérico", async () => {
    guardarSinpeBodegaMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: {
        numero: [
          "El SINPE tiene que ser un móvil de Costa Rica: 8 dígitos que empiecen por 6, 7 u 8.",
        ],
      },
    });
    const user = userEvent.setup();
    render(<RevisionSinpeBodega bodega={BODEGA} />);

    await user.clear(campoNumero());
    await user.type(campoNumero(), "12345678");
    await user.click(botonConfirmar());

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent(
      "El SINPE tiene que ser un móvil de Costa Rica: 8 dígitos que empiecen por 6, 7 u 8.",
    );
    // El error es DE ESTE CONTROL: el campo lo declara por `aria-describedby`, así que un lector
    // de pantalla lo anuncia como su error y no como un texto suelto de la pantalla.
    expect(campoNumero()).toHaveAttribute("aria-invalid", "true");
    expect(campoNumero().getAttribute("aria-describedby")).toContain(error.id);
    // Y el aviso sigue abierto: un modal que se cierra al rechazar se lleva el error por delante.
    expect(botonConfirmar()).toBeInTheDocument();
  });

  it("⭑ confirmar SIN cambiar nada no guarda: confirma (R25, cero filas de historial)", async () => {
    const user = userEvent.setup();
    render(<RevisionSinpeBodega bodega={BODEGA} />);

    await user.click(botonConfirmar());

    await waitFor(() =>
      expect(confirmarSinpeBodegaMock).toHaveBeenCalledWith("z-guanacaste"),
    );
    expect(guardarSinpeBodegaMock).not.toHaveBeenCalled();
  });
});

describe("429/R28+R29 — cerrarlo no confirma nada, y vuelve al siguiente ingreso", () => {
  it("⭑ «Ahora no» NO llama a ninguna acción: la bodega sigue SIN revisar", async () => {
    const user = userEvent.setup();
    render(<RevisionSinpeBodega bodega={BODEGA} />);

    await user.click(botonAhoraNo());

    await waitFor(() =>
      expect(screen.queryByText("Confirmá el SINPE de Guanacaste")).toBeNull(),
    );
    expect(confirmarSinpeBodegaMock).not.toHaveBeenCalled();
    expect(guardarSinpeBodegaMock).not.toHaveBeenCalled();
  });

  it("⭑ con la marca de ESTA sesión puesta, el aviso no se pinta (no reaparece al navegar)", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<RevisionSinpeBodega bodega={BODEGA} />);
    await user.click(botonAhoraNo());
    unmount();

    // Segundo montaje = la siguiente navegación del portal, con el mismo `sessionStorage`.
    render(<RevisionSinpeBodega bodega={BODEGA} />);
    expect(screen.queryByText("Confirmá el SINPE de Guanacaste")).toBeNull();
  });

  it("⭑ SIN esa marca —o sea, en el siguiente inicio de sesión— vuelve a salir", () => {
    // `sessionStorage` muere con la pestaña: entrar de nuevo es exactamente este estado. Es la
    // propiedad literal de R29, y es por lo que NO se usa `localStorage` (no volvería nunca).
    window.sessionStorage.clear();
    render(<RevisionSinpeBodega bodega={BODEGA} />);

    expect(
      screen.getByText("Confirmá el SINPE de Guanacaste"),
    ).toBeInTheDocument();
  });

  it("la marca es POR BODEGA: aplazar una no aplaza la de otra", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<RevisionSinpeBodega bodega={BODEGA} />);
    await user.click(botonAhoraNo());
    unmount();

    render(
      <RevisionSinpeBodega
        bodega={{ ...BODEGA, zonaId: "z-limon", zonaNombre: "Limón" }}
      />,
    );
    expect(screen.getByText("Confirmá el SINPE de Limón")).toBeInTheDocument();
  });

  it("⭑ tras confirmar, el aviso se cierra y no vuelve en esta sesión", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<RevisionSinpeBodega bodega={BODEGA} />);

    await user.click(botonConfirmar());
    await waitFor(() => expect(confirmarSinpeBodegaMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByText("Confirmá el SINPE de Guanacaste")).toBeNull(),
    );
    unmount();

    // R30 lo garantiza el SERVIDOR (la bodega queda con fecha y el resolvedor no vuelve a
    // emitirla). Aquí se comprueba la mitad del cliente: sin recargar, tampoco reaparece.
    render(<RevisionSinpeBodega bodega={BODEGA} />);
    expect(screen.queryByText("Confirmá el SINPE de Guanacaste")).toBeNull();
  });
});
