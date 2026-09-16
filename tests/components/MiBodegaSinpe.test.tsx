// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { SinpeBodegaDTO } from "@/lib/types/sinpe-bodega";

/**
 * ⭑ FICHA 429 / T21-A — `/mi-bodega`: UNA SOLA FICHA, Y LA VISTA PREVIA AL LADO.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * LO QUE ESTE ARCHIVO EXISTE PARA IMPEDIR
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * Que la vista previa se convierta en un adorno. Es la pieza que hace visible un fallo mudo: un
 * número de ocho dígitos VÁLIDO pero ajeno pasa el `CHECK` de Postgres, pasa el zod del borde y
 * pasa el formulario sin una sola señal. Lo único que lo delata es leerlo junto al titular en la
 * frase que el cliente va a recibir. Por eso aquí se afirma que:
 *   1. se pinta el CUERPO REAL de la plantilla, con los demás campos ya resueltos;
 *   2. el número y el titular salen RESALTADOS dentro de esa frase;
 *   3. se actualiza con lo que se escribe, ANTES de guardar — que es el único momento en que
 *      alguien puede darse cuenta.
 * Si mañana alguien sustituye el cuerpo real por un texto de relleno, el caso 1 se pone rojo.
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

const { MiBodegaSinpeModule } = await import(
  "@/app/(app)/mi-bodega/_components/MiBodegaSinpeModule"
);

/** El cuerpo REAL de `listo_para_entrega_mensajero`, la única plantilla viva que usa el par. */
const CUERPO =
  "Hola {{cliente}}, tu pedido {{guia}} ({{producto}}) sale hoy. Total a pagar: {{total}}. " +
  "En caso de que pague por SINPE será al número {{sinpe}} a nombre de {{sinpe_nombre}}.";

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
const mensaje = () => screen.getByTestId("sinpe-preview-mensaje");

function renderModulo(
  bodega: SinpeBodegaDTO = BODEGA,
  cuerpo: string | null = CUERPO,
) {
  return render(
    <MiBodegaSinpeModule bodega={bodega} cuerpoPlantilla={cuerpo} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  guardarSinpeBodegaMock.mockResolvedValue({
    status: "ok",
    bodega: { ...BODEGA, numero: "71111111", revisadoAt: "2026-09-15T18:00:00.000Z" },
  });
});

afterEach(cleanup);

describe("429/T21-A — la ficha: UNA bodega, con sus dos campos y su pie", () => {
  it("pinta UNA sola ficha (la suya) con el par vigente", () => {
    renderModulo();

    expect(screen.getByText("SINPE de la bodega")).toBeInTheDocument();
    expect(screen.getAllByRole("textbox", { name: "Número SINPE" })).toHaveLength(1);
    expect(campoNumero()).toHaveValue("80000000");
    expect(campoNombre()).toHaveValue("Titular de Prueba");
  });

  it("los dos campos declaran su pista, y la pista dice QUÉ se espera", () => {
    // Una pista que dijera «campo obligatorio» no evita ni un error. «8 dígitos, empieza por
    // 6, 7 u 8» sí: es la regla entera, escrita donde se teclea.
    renderModulo();

    expect(
      screen.getByText("8 dígitos, empieza por 6, 7 u 8."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Tal como aparece en SINPE Móvil al teclear el número."),
    ).toBeInTheDocument();
  });

  it("⭑ una bodega SIN revisar lo dice, y no finge una fecha", () => {
    // R5: la ausencia de revisión no puede confundirse con una revisión.
    renderModulo();

    expect(
      screen.getByText("Nadie ha revisado este número todavía."),
    ).toBeInTheDocument();
  });

  it("una bodega ya revisada enseña la fecha de esa revisión", () => {
    renderModulo({ ...BODEGA, revisadoAt: "2026-09-15T18:00:00.000Z" });

    expect(screen.getByText(/^Última revisión: /)).toBeInTheDocument();
  });

  it("⭑ el aviso del riesgo nombra el DAÑO, no pide cuidado", () => {
    renderModulo();

    expect(
      screen.getByText("Un número mal escrito no da error"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Los clientes transferirían a una cuenta equivocada y nos enteraríamos días después por los reclamos. Por eso queda registrado quién lo cambió y cuándo.",
      ),
    ).toBeInTheDocument();
  });
});

describe("429/T21-A — la vista previa es el mensaje REAL, no una maqueta", () => {
  it("⭑ pinta el cuerpo de la plantilla con los demás campos ya resueltos", () => {
    renderModulo();

    // El texto que se lee es la frase entera, no una plantilla con llaves a medio resolver.
    expect(mensaje()).toHaveTextContent(
      /En caso de que pague por SINPE será al número 80000000 a nombre de Titular de Prueba\./,
    );
    expect(mensaje().textContent).not.toContain("{{");
  });

  it("⭑ el número y el titular salen RESALTADOS dentro de la frase", () => {
    // `<mark>` y no un `<span>` con color: el resaltado es semántico (rol ARIA `mark`), así que
    // también existe para quien no ve la pantalla. Y son EXACTAMENTE dos: el par completo, en el
    // orden en que la plantilla los empareja.
    const { container } = renderModulo();

    const marcas = [...within(mensaje()).getAllByRole("mark")].map((m) => [
      m.getAttribute("data-campo"),
      m.textContent,
    ]);
    expect(marcas).toEqual([
      ["sinpe-numero", "80000000"],
      ["sinpe-nombre", "Titular de Prueba"],
    ]);
    // El rótulo de qué está resaltado vive FUERA de la frase, para no partir la oración que el
    // cliente va a leer ni re-anunciarlo entero en cada tecla.
    expect(mensaje().textContent).not.toContain("Resaltados");
    expect(
      screen.getByText("Resaltados: el número SINPE y el titular."),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("mark")).toHaveLength(2);
  });

  it("⭑ SE ACTUALIZA CON LO QUE SE ESCRIBE, antes de guardar nada", async () => {
    // Es el punto entero de la pantalla: el error se ve ANTES de que el mensaje salga, no
    // días después por un reclamo.
    const user = userEvent.setup();
    const { container } = renderModulo();

    await user.clear(campoNumero());
    await user.type(campoNumero(), "71111111");

    await waitFor(() =>
      expect([...container.querySelectorAll("mark")].map((m) => m.textContent)).toEqual([
        "71111111",
        "Titular de Prueba",
      ]),
    );
    expect(guardarSinpeBodegaMock).not.toHaveBeenCalled();
  });

  it("⭑ enseña lo TECLEADO sin normalizar: `8888 1111` se ve con su espacio", async () => {
    // Normalizarlo en vivo escondería el único momento en que la persona puede notar que se
    // equivocó de campo o de número.
    const user = userEvent.setup();
    const { container } = renderModulo();

    await user.clear(campoNumero());
    await user.type(campoNumero(), "8888 1111");

    await waitFor(() =>
      expect(container.querySelector("mark")?.textContent).toBe("8888 1111"),
    );
  });

  it("⭑ sin plantilla NO se inventa un mensaje: lo dice", () => {
    // Una vista previa que existe para comparar contra el mensaje de verdad y enseña uno
    // inventado es peor que no tener vista previa.
    renderModulo(BODEGA, null);

    expect(screen.queryByTestId("sinpe-preview-mensaje")).toBeNull();
    expect(
      screen.getByText(
        "No se pudo cargar el mensaje que reciben los clientes, así que no hay nada que comparar aquí. El número y el nombre de arriba se guardan igual.",
      ),
    ).toBeInTheDocument();
  });
});

describe("429/T21-A — el guardado", () => {
  it("«Guardar» arranca deshabilitado: sin cambios no hay nada que guardar", () => {
    renderModulo();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  it("guarda el par y repinta lo que quedó GUARDADO, no lo tecleado", async () => {
    // El servidor normaliza (`8888 1111` -> `88881111`). Repintar lo tecleado dejaría la
    // pantalla diciendo una cosa y la base otra.
    const user = userEvent.setup();
    renderModulo();

    await user.clear(campoNumero());
    await user.type(campoNumero(), "7111 1111");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(guardarSinpeBodegaMock).toHaveBeenCalledWith("z-guanacaste", {
        numero: "7111 1111",
        nombre: "Titular de Prueba",
      }),
    );
    await waitFor(() => expect(campoNumero()).toHaveValue("71111111"));
    expect(successMock).toHaveBeenCalledWith("SINPE guardado.");
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
    renderModulo();

    await user.clear(campoNumero());
    await user.type(campoNumero(), "12345678");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent(
      "El SINPE tiene que ser un móvil de Costa Rica: 8 dígitos que empiecen por 6, 7 u 8.",
    );
    expect(campoNumero()).toHaveAttribute("aria-invalid", "true");
    expect(campoNumero().getAttribute("aria-describedby")).toContain(error.id);
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("«Cancelar» devuelve los campos a lo guardado y no llama a nadie", async () => {
    const user = userEvent.setup();
    renderModulo();

    await user.clear(campoNumero());
    await user.type(campoNumero(), "71111111");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(campoNumero()).toHaveValue("80000000");
    expect(guardarSinpeBodegaMock).not.toHaveBeenCalled();
  });

  it("⭑ sin permiso de edición no hay botones que pulsar (el `editable` lo decide el servidor)", () => {
    renderModulo({ ...BODEGA, editable: false });

    expect(screen.queryByRole("button", { name: "Guardar" })).toBeNull();
    expect(campoNumero()).toBeDisabled();
  });
});
