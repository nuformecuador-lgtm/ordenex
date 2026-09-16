// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { SinpeBodegaDTO } from "@/lib/types/sinpe-bodega";

/**
 * ⭑ FICHA 429 / T21-B — «SINPE por bodega»: LAS OCHO, Y EL CHIP QUE NO ES UNA ALARMA.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * LO QUE ESTE ARCHIVO EXISTE PARA IMPEDIR
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * Que «sin revisar» se pinte como un ERROR. Una bodega que sigue con la semilla tiene un número
 * PERFECTAMENTE VÁLIDO —el de la central—; no hay nada roto, hay una decisión de negocio
 * pendiente. Pintarlo en rojo dejaría a la oficina con OCHO alarmas la mañana del despliegue,
 * todas por lo mismo y ninguna accionable en el momento, y una alarma que sale ocho veces el
 * primer día se aprende a ignorar antes de que llegue la que sí importa.
 *
 * Por eso hay un caso que afirma el chip `warning` Y afirma que NO es `danger`/`destructive`. Si
 * alguien lo «sube de tono» creyéndolo más seguro, este archivo lo dice.
 *
 * ⚠️ NINGÚN SINPE DE AQUÍ ES REAL: el repositorio es PÚBLICO.
 */

const guardarSinpeBodegaMock = vi.fn();
vi.mock("@/lib/actions/sinpe-bodega", () => ({
  guardarSinpeBodega: (...a: unknown[]) => guardarSinpeBodegaMock(...a),
  confirmarSinpeBodega: vi.fn(),
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

const { SinpeBodegasModule } = await import(
  "@/app/(app)/configuracion/sinpe/_components/SinpeBodegasModule"
);

/** Las OCHO bodegas: la central revisada y siete sembradas sin revisar (el día del despliegue). */
function ochoBodegas(): SinpeBodegaDTO[] {
  const satelites = [
    "Guanacaste",
    "Limón",
    "Puntarenas",
    "Pérez Zeledón",
    "San Carlos",
    "Zona Norte",
    "Pacífico Central",
  ];
  return [
    {
      zonaId: "z-gam",
      zonaNombre: "GAM",
      esCentral: true,
      numero: "80000000",
      nombre: "Titular de Prueba",
      revisadoAt: "2026-09-15T18:00:00.000Z",
      editable: true,
    },
    ...satelites.map((nombre, i) => ({
      zonaId: `z-${i}`,
      zonaNombre: nombre,
      esCentral: false,
      numero: "80000000",
      nombre: "Titular de Prueba",
      revisadoAt: null,
      editable: true,
    })),
  ];
}

const filas = () => screen.getAllByRole("row").slice(1); // sin la cabecera
const filaDe = (bodega: string) =>
  filas().find((f) => within(f).queryByText(bodega) !== null)!;

beforeEach(() => {
  vi.clearAllMocks();
  guardarSinpeBodegaMock.mockResolvedValue({
    status: "ok",
    bodega: {
      zonaId: "z-0",
      zonaNombre: "Guanacaste",
      esCentral: false,
      numero: "71111111",
      nombre: "Titular Nuevo de Prueba",
      revisadoAt: "2026-09-15T19:00:00.000Z",
      editable: true,
    },
  });
});

afterEach(cleanup);

describe("429/T21-B — la oficina ve LAS OCHO bodegas", () => {
  it("pinta una fila por bodega, con su número y su titular", () => {
    render(<SinpeBodegasModule bodegasIniciales={ochoBodegas()} />);

    expect(filas()).toHaveLength(8);
    expect(within(filaDe("Guanacaste")).getByText("80000000")).toBeInTheDocument();
  });

  it("⭑ la central lleva su chip, y es la ÚNICA", () => {
    render(<SinpeBodegasModule bodegasIniciales={ochoBodegas()} />);

    expect(screen.getAllByText("Central")).toHaveLength(1);
    expect(within(filaDe("GAM")).getByText("Central")).toBeInTheDocument();
  });

  it("⭑ el encabezado dice que cada bodega cobra en SU número", () => {
    render(<SinpeBodegasModule bodegasIniciales={ochoBodegas()} />);

    expect(
      screen.getByText(
        "Cada bodega cobra en su propio número. Lo que cambiés acá es lo que van a leer los clientes de esa bodega cuando su pedido salga a entrega.",
      ),
    ).toBeInTheDocument();
  });

  it("cada botón de editar identifica SU fila (ocho «Editar» son ocho botones iguales)", () => {
    render(<SinpeBodegasModule bodegasIniciales={ochoBodegas()} />);

    expect(
      screen.getByRole("button", { name: "Editar el SINPE de Guanacaste" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Editar el SINPE de GAM" }),
    ).toBeInTheDocument();
  });

  it("una bodega que este actor NO puede editar no ofrece el botón", () => {
    // `editable` lo decide el SERVIDOR (R20). La pantalla lo obedece, no lo calcula.
    const bodegas = ochoBodegas().map((b) =>
      b.zonaNombre === "Limón" ? { ...b, editable: false } : b,
    );
    render(<SinpeBodegasModule bodegasIniciales={bodegas} />);

    expect(
      screen.queryByRole("button", { name: "Editar el SINPE de Limón" }),
    ).toBeNull();
  });
});

describe("429/T21-B — «Sin revisar» es un AVISO, no un error", () => {
  it("⭑ las bodegas sembradas llevan el chip, y la revisada lleva su fecha", () => {
    render(<SinpeBodegasModule bodegasIniciales={ochoBodegas()} />);

    expect(screen.getAllByText("Sin revisar")).toHaveLength(7);
    expect(within(filaDe("GAM")).queryByText("Sin revisar")).toBeNull();
    expect(within(filaDe("GAM")).getByText(/2026/)).toBeInTheDocument();
  });

  it("⭑ el chip es `warning` y NO una señal de error (ni `danger` ni `destructive`)", () => {
    // La afirmación va contra las CLASES del token, que es donde vive la diferencia visual:
    // `bg-warning-soft`/`text-warning-strong` frente a la familia `danger`. Comparar contra el
    // nombre de la variante que el propio componente pasa estaría verde con el color roto.
    render(<SinpeBodegasModule bodegasIniciales={ochoBodegas()} />);

    const chip = screen.getAllByText("Sin revisar")[0];
    expect(chip.className).toContain("bg-warning-soft");
    expect(chip.className).toContain("text-warning-strong");
    // Se miran el FONDO y la TINTA, no la cadena entera: la clase base de `Badge` incluye
    // `aria-invalid:border-destructive`, que es el estado de un control inválido y no el color
    // de este chip. Buscar «destructive» a secas daría rojo con el chip perfectamente correcto.
    expect(chip.className).not.toContain("bg-danger");
    expect(chip.className).not.toContain("text-danger");
    expect(chip.className).not.toContain("bg-destructive");
    expect(chip.className).not.toContain("text-destructive");
  });

  it("⭑ y hay una nota que EXPLICA qué significa, no solo un chip suelto", () => {
    render(<SinpeBodegasModule bodegasIniciales={ochoBodegas()} />);

    expect(
      screen.getByText(
        "«Sin revisar» no es un error: esas bodegas siguen con el número de la central, que es un número válido. Lo que hay que decidir es si ese cobro tiene que entrar a la central o a la bodega.",
      ),
    ).toBeInTheDocument();
  });
});

describe("429/T21-B — editar una bodega", () => {
  it("⭑ guarda el par de ESA bodega y repinta su fila con lo guardado", async () => {
    const user = userEvent.setup();
    render(<SinpeBodegasModule bodegasIniciales={ochoBodegas()} />);

    await user.click(
      screen.getByRole("button", { name: "Editar el SINPE de Guanacaste" }),
    );
    const numero = await screen.findByRole("textbox", { name: "Número SINPE" });
    await user.clear(numero);
    await user.type(numero, "71111111");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(guardarSinpeBodegaMock).toHaveBeenCalledWith("z-0", {
        numero: "71111111",
        nombre: "Titular de Prueba",
      }),
    );
    await waitFor(() =>
      expect(within(filaDe("Guanacaste")).getByText("71111111")).toBeInTheDocument(),
    );
    // Y deja de estar «sin revisar»: guardarla ES revisarla.
    expect(screen.getAllByText("Sin revisar")).toHaveLength(6);
  });

  it("⭑ un número inválido pinta el error JUNTO AL CAMPO y NO cierra el modal", async () => {
    guardarSinpeBodegaMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: {
        numero: [
          "El SINPE tiene que ser un móvil de Costa Rica: 8 dígitos que empiecen por 6, 7 u 8.",
        ],
      },
    });
    const user = userEvent.setup();
    render(<SinpeBodegasModule bodegasIniciales={ochoBodegas()} />);

    await user.click(
      screen.getByRole("button", { name: "Editar el SINPE de Guanacaste" }),
    );
    const numero = await screen.findByRole("textbox", { name: "Número SINPE" });
    await user.clear(numero);
    await user.type(numero, "12345678");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent(
      "El SINPE tiene que ser un móvil de Costa Rica: 8 dígitos que empiecen por 6, 7 u 8.",
    );
    expect(numero).toHaveAttribute("aria-invalid", "true");
    expect(numero.getAttribute("aria-describedby")).toContain(error.id);
    // El modal sigue abierto: uno que se cierra al rechazar se lleva el error por delante y la
    // persona vuelve a la tabla sin saber qué pasó.
    expect(screen.getByRole("textbox", { name: "Número SINPE" })).toBeInTheDocument();
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("cancelar no envía nada y la fila se queda como estaba", async () => {
    const user = userEvent.setup();
    render(<SinpeBodegasModule bodegasIniciales={ochoBodegas()} />);

    await user.click(
      screen.getByRole("button", { name: "Editar el SINPE de Guanacaste" }),
    );
    const numero = await screen.findByRole("textbox", { name: "Número SINPE" });
    await user.clear(numero);
    await user.type(numero, "71111111");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Número SINPE" })).toBeNull(),
    );
    expect(guardarSinpeBodegaMock).not.toHaveBeenCalled();
    expect(within(filaDe("Guanacaste")).getByText("80000000")).toBeInTheDocument();
  });
});
