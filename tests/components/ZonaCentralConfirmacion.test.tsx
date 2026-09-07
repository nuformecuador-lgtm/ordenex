// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ProvinciaArbolDTO } from "@/lib/actions/geografia";

/**
 * ⭑ FICHA 376 / T12 — LA PANTALLA AVISA ANTES Y EXPLICA DESPUÉS (R20-R23).
 *
 * Lo que se mide aquí, y por qué cada caso existe:
 *
 * · **R20** — hasta esta ficha la confirmación vivía dentro de `if (esCentral)`: al MARCAR
 *   preguntaba, al DESMARCAR no preguntaba nada. Quitarle la marca a la única zona central
 *   cambia la columna de flete de una zona entera y no había ni un diálogo por el medio.
 * · **R21** — la confirmación al marcar SÍ existía, y no tenía ni un test: borrarla no rompía
 *   nada. Aquí queda anclada, con el NOMBRE de la zona que pierde la marca.
 * · **R22** — cancelar no envía. Es la mitad que hace que una confirmación signifique algo.
 * · **R23** — `fieldErrors.esCentral` llegaba al cliente y NO se pintaba en ningún sitio: el
 *   servidor rechazaba con un motivo y la pantalla se lo comía.
 * · **Q4** — la confirmación dice el IMPACTO EN ÓRDENES, no solo el nombre de las zonas.
 *
 * ⚠️ **La regla NO se duplica en el cliente.** Desmarcar la única zona central termina SIEMPRE en
 * rechazo del servidor (R5); el formulario confirma, ENVÍA y pinta el rechazo. Por eso el caso
 * de R23 va después de una confirmación real y no de un `if` local (design.md §8, Q2).
 *
 * Los textos se afirman como LITERALES. Compararlos contra la función que los genera —o contra
 * el mensaje que el servicio exporta— estaría verde con el texto roto.
 */

const crearZonaMock = vi.fn();
const actualizarZonaMock = vi.fn();
const impactoZonaCentralMock = vi.fn();
vi.mock("@/lib/actions/zonas", () => ({
  crearZona: (...a: unknown[]) => crearZonaMock(...a),
  actualizarZona: (...a: unknown[]) => actualizarZonaMock(...a),
  impactoZonaCentral: (...a: unknown[]) => impactoZonaCentralMock(...a),
}));

vi.mock("@/lib/actions/tarifas", () => ({
  crearTarifa: vi.fn(),
  actualizarTarifa: vi.fn(),
}));

vi.mock("@/lib/actions/geografia", () => ({
  actualizarDistritosEspeciales: vi.fn().mockResolvedValue({ status: "ok" }),
  listarArbolGeografico: vi.fn(),
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

const { CrearZonaForm, cobroVacio } = await import(
  "@/app/(app)/configuracion/tarifas/_components/CrearZonaForm"
);

/** Texto EXACTO con el que el servicio rechaza quitar la última marca (376/R6). */
const MOTIVO_DEL_SERVIDOR =
  "Tiene que haber una zona central. Para quitarle la marca a ésta, márcala en otra zona.";

function zonaDTO(id: string, nombre: string, esCentral = false) {
  return { id, nombre, cobroVehiculo: false, distritosCount: 1, esCentral };
}

/** Árbol mínimo con un solo distrito, suficiente para montar el selector. */
function arbol(): ProvinciaArbolDTO[] {
  return [
    {
      id: "p1",
      nombre: "San José",
      activo: true,
      cantones: [
        {
          id: "c1",
          nombre: "Central",
          activo: true,
          distritos: [
            {
              id: "d1",
              nombre: "Carmen",
              zonaId: null,
              zonaNombre: null,
              zonaEspecial: false,
              activo: true,
            },
          ],
        },
      ],
    },
  ];
}

/**
 * Renderiza el formulario ya con nombre y distrito precargados: lo que se mide aquí son las dos
 * confirmaciones y el error de la casilla, no el resto del formulario (cubierto por
 * `ZonaDistritoEspecial.test.tsx`).
 */
function renderForm(opts: {
  mode: "crear" | "editar";
  zonaId?: string;
  nombre?: string;
  esCentral?: boolean;
  zonas?: ReturnType<typeof zonaDTO>[];
}) {
  return render(
    <CrearZonaForm
      mode={opts.mode}
      provincias={arbol()}
      vehiculos={[]}
      zonas={opts.zonas ?? []}
      initial={{
        zonaId: opts.zonaId,
        nombre: opts.nombre ?? "GAM",
        distritoIds: ["d1"],
        cobro: cobroVacio(),
        esCentral: opts.esCentral,
      }}
      onSaved={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

const casilla = () => screen.getByRole("checkbox", { name: "Zona Central" });
const botonGuardar = () => screen.getByRole("button", { name: "Guardar" });
const botonContinuar = () => screen.getByRole("button", { name: "Continuar" });

beforeEach(() => {
  vi.clearAllMocks();
  impactoZonaCentralMock.mockResolvedValue({ status: "ok", impacto: [] });
});

afterEach(cleanup);

describe("R20 — desmarcar la zona central pregunta antes de enviar nada", () => {
  it("abre el modal nombrando la zona y NO llama a actualizarZona todavía", async () => {
    const user = userEvent.setup();
    renderForm({ mode: "editar", zonaId: "z-gam", nombre: "GAM", esCentral: true });

    await user.click(casilla());
    await user.click(botonGuardar());

    expect(
      await screen.findByText("Quitar la marca de zona central"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "La zona GAM es hoy la zona Central. Siempre tiene que haber una zona Central: si le quitas la marca sin marcar otra zona, el guardado se rechaza. ¿Desea continuar?",
      ),
    ).toBeInTheDocument();
    expect(actualizarZonaMock).not.toHaveBeenCalled();
    expect(crearZonaMock).not.toHaveBeenCalled();
  });

  it("al confirmar SÍ envía, con la marca apagada (la regla la aplica el servidor)", async () => {
    actualizarZonaMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { esCentral: [MOTIVO_DEL_SERVIDOR] },
    });
    const user = userEvent.setup();
    renderForm({ mode: "editar", zonaId: "z-gam", nombre: "GAM", esCentral: true });

    await user.click(casilla());
    await user.click(botonGuardar());
    await waitFor(() => expect(botonContinuar()).toBeEnabled());
    await user.click(botonContinuar());

    await waitFor(() =>
      expect(actualizarZonaMock).toHaveBeenCalledWith(
        "z-gam",
        expect.objectContaining({ esCentral: false }),
      ),
    );
  });

  it("guardar una zona que NO es la central no abre ninguna confirmación", async () => {
    actualizarZonaMock.mockResolvedValue({
      status: "ok",
      zona: zonaDTO("z-otra", "Cartago"),
      ordenesReconciliadas: 0,
    });
    const user = userEvent.setup();
    renderForm({
      mode: "editar",
      zonaId: "z-otra",
      nombre: "Cartago",
      esCentral: false,
      zonas: [zonaDTO("z-otra", "Cartago")],
    });

    await user.click(botonGuardar());

    await waitFor(() => expect(actualizarZonaMock).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByText("Quitar la marca de zona central"),
    ).not.toBeInTheDocument();
    expect(impactoZonaCentralMock).not.toHaveBeenCalled();
  });
});

describe("R21 — marcar con otra zona central abierta pregunta y la nombra", () => {
  it("el modal dice el NOMBRE de la zona que perderá la marca", async () => {
    const user = userEvent.setup();
    renderForm({
      mode: "editar",
      zonaId: "z-nueva",
      nombre: "Cartago",
      esCentral: false,
      zonas: [zonaDTO("z-gam", "GAM", true), zonaDTO("z-nueva", "Cartago")],
    });

    await user.click(casilla());
    await user.click(botonGuardar());

    expect(
      await screen.findByText(
        "La zona GAM ya está marcada como Central. Esta acción reestablecerá la zona Central. ¿Desea continuar?",
      ),
    ).toBeInTheDocument();
    expect(actualizarZonaMock).not.toHaveBeenCalled();
  });

  it("al confirmar envía con la marca encendida", async () => {
    actualizarZonaMock.mockResolvedValue({
      status: "ok",
      zona: zonaDTO("z-nueva", "Cartago", true),
      ordenesReconciliadas: 0,
    });
    const user = userEvent.setup();
    renderForm({
      mode: "editar",
      zonaId: "z-nueva",
      nombre: "Cartago",
      esCentral: false,
      zonas: [zonaDTO("z-gam", "GAM", true), zonaDTO("z-nueva", "Cartago")],
    });

    await user.click(casilla());
    await user.click(botonGuardar());
    await waitFor(() => expect(botonContinuar()).toBeEnabled());
    await user.click(botonContinuar());

    await waitFor(() =>
      expect(actualizarZonaMock).toHaveBeenCalledWith(
        "z-nueva",
        expect.objectContaining({ esCentral: true }),
      ),
    );
  });
});

describe("R22 — cancelar la confirmación no envía nada", () => {
  it("cancelar el modal de desmarcar no llama a ninguna acción de guardado", async () => {
    const user = userEvent.setup();
    renderForm({ mode: "editar", zonaId: "z-gam", nombre: "GAM", esCentral: true });

    await user.click(casilla());
    await user.click(botonGuardar());
    await screen.findByText("Quitar la marca de zona central");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() =>
      expect(
        screen.queryByText("Quitar la marca de zona central"),
      ).not.toBeInTheDocument(),
    );
    expect(actualizarZonaMock).not.toHaveBeenCalled();
    expect(crearZonaMock).not.toHaveBeenCalled();
  });

  it("cancelar el modal de marcar tampoco envía (la otra zona conserva la marca)", async () => {
    const user = userEvent.setup();
    renderForm({
      mode: "crear",
      nombre: "Cartago",
      zonas: [zonaDTO("z-gam", "GAM", true)],
    });

    await user.click(casilla());
    await user.click(botonGuardar());
    await screen.findByText("Zona central ya asignada");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() =>
      expect(
        screen.queryByText("Zona central ya asignada"),
      ).not.toBeInTheDocument(),
    );
    expect(crearZonaMock).not.toHaveBeenCalled();
    expect(actualizarZonaMock).not.toHaveBeenCalled();
  });
});

describe("R23 — el rechazo del servidor se pinta JUNTO a la casilla", () => {
  it("fieldErrors.esCentral aparece bajo «Zona Central» y la casilla lo referencia", async () => {
    actualizarZonaMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { esCentral: [MOTIVO_DEL_SERVIDOR] },
    });
    const user = userEvent.setup();
    renderForm({ mode: "editar", zonaId: "z-gam", nombre: "GAM", esCentral: true });

    await user.click(casilla());
    await user.click(botonGuardar());
    await waitFor(() => expect(botonContinuar()).toBeEnabled());
    await user.click(botonContinuar());

    const aviso = await screen.findByText(MOTIVO_DEL_SERVIDOR);
    // El bloque de error es el `FieldError` de la casilla: `role="alert"` con el id que la
    // casilla enlaza por `aria-describedby`. Sin el enlace, un lector de pantalla lo leería
    // como un texto suelto y no como el error de ESE control.
    const bloque = aviso.closest("[role='alert']");
    expect(bloque).not.toBeNull();
    expect(bloque).toHaveAttribute("id", "es-central-zona-error");
    expect(casilla()).toHaveAttribute(
      "aria-describedby",
      "es-central-zona-error",
    );
  });

  it("el toast repite el motivo del servidor, no «el formulario está incompleto»", async () => {
    actualizarZonaMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { esCentral: [MOTIVO_DEL_SERVIDOR] },
    });
    const user = userEvent.setup();
    renderForm({ mode: "editar", zonaId: "z-gam", nombre: "GAM", esCentral: true });

    await user.click(casilla());
    await user.click(botonGuardar());
    await waitFor(() => expect(botonContinuar()).toBeEnabled());
    await user.click(botonContinuar());

    await waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(MOTIVO_DEL_SERVIDOR),
    );
    expect(errorMock).not.toHaveBeenCalledWith(
      "Revisa los campos: el formulario está incompleto.",
    );
    expect(successMock).not.toHaveBeenCalled();
  });

  it("un validation_error de OTRO campo conserva el mensaje genérico", async () => {
    actualizarZonaMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { nombre: ["nombre invalido"] },
    });
    const user = userEvent.setup();
    renderForm({
      mode: "editar",
      zonaId: "z-otra",
      nombre: "Cartago",
      esCentral: false,
      zonas: [zonaDTO("z-otra", "Cartago")],
    });

    await user.click(botonGuardar());

    await waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        "Revisa los campos: el formulario está incompleto.",
      ),
    );
  });
});

describe("Q4 — la confirmación dice cuántas órdenes se re-tarifan", () => {
  it("pregunta por las DOS zonas del traslado y suma el impacto", async () => {
    impactoZonaCentralMock.mockResolvedValue({
      status: "ok",
      impacto: [
        { zonaId: "z-gam", ordenesVivas: 850 },
        { zonaId: "z-nueva", ordenesVivas: 0 },
      ],
    });
    const user = userEvent.setup();
    renderForm({
      mode: "editar",
      zonaId: "z-nueva",
      nombre: "Cartago",
      esCentral: false,
      zonas: [zonaDTO("z-gam", "GAM", true), zonaDTO("z-nueva", "Cartago")],
    });

    await user.click(casilla());
    await user.click(botonGuardar());

    expect(impactoZonaCentralMock).toHaveBeenCalledWith(["z-gam", "z-nueva"]);
    expect(
      await screen.findByText(
        "850 órdenes sin cerrar pasarían a cobrarse con otra tarifa de flete.",
      ),
    ).toBeInTheDocument();
  });

  it("una sola orden usa el singular", async () => {
    impactoZonaCentralMock.mockResolvedValue({
      status: "ok",
      impacto: [{ zonaId: "z-gam", ordenesVivas: 1 }],
    });
    const user = userEvent.setup();
    renderForm({ mode: "editar", zonaId: "z-gam", nombre: "GAM", esCentral: true });

    await user.click(casilla());
    await user.click(botonGuardar());

    expect(
      await screen.findByText(
        "1 orden sin cerrar pasaría a cobrarse con otra tarifa de flete.",
      ),
    ).toBeInTheDocument();
    expect(impactoZonaCentralMock).toHaveBeenCalledWith(["z-gam"]);
  });

  it("cero órdenes NO se dice igual que «no lo pude contar»", async () => {
    impactoZonaCentralMock.mockResolvedValue({
      status: "ok",
      impacto: [{ zonaId: "z-gam", ordenesVivas: 0 }],
    });
    const user = userEvent.setup();
    renderForm({ mode: "editar", zonaId: "z-gam", nombre: "GAM", esCentral: true });

    await user.click(casilla());
    await user.click(botonGuardar());

    expect(
      await screen.findByText(
        "Ninguna orden sin cerrar cambia de tarifa de flete.",
      ),
    ).toBeInTheDocument();
  });

  it("mientras se cuenta no se puede confirmar, y al llegar el número se desbloquea", async () => {
    let resolver: (valor: unknown) => void = () => {};
    impactoZonaCentralMock.mockReturnValue(
      new Promise((r) => {
        resolver = r;
      }),
    );
    const user = userEvent.setup();
    renderForm({ mode: "editar", zonaId: "z-gam", nombre: "GAM", esCentral: true });

    await user.click(casilla());
    await user.click(botonGuardar());

    expect(
      await screen.findByText(
        "Calculando cuántas órdenes cambiarían de tarifa…",
      ),
    ).toBeInTheDocument();
    expect(botonContinuar()).toBeDisabled();

    resolver({ status: "ok", impacto: [{ zonaId: "z-gam", ordenesVivas: 12 }] });

    expect(
      await screen.findByText(
        "12 órdenes sin cerrar pasarían a cobrarse con otra tarifa de flete.",
      ),
    ).toBeInTheDocument();
    expect(botonContinuar()).toBeEnabled();
  });

  it("si la consulta falla, lo dice y NO deja el guardado atrapado", async () => {
    impactoZonaCentralMock.mockRejectedValue(new Error("red caída"));
    actualizarZonaMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { esCentral: [MOTIVO_DEL_SERVIDOR] },
    });
    const user = userEvent.setup();
    renderForm({ mode: "editar", zonaId: "z-gam", nombre: "GAM", esCentral: true });

    await user.click(casilla());
    await user.click(botonGuardar());

    expect(
      await screen.findByText(
        "No se pudo calcular cuántas órdenes cambiarían de tarifa.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(botonContinuar()).toBeEnabled());
    await user.click(botonContinuar());
    await waitFor(() => expect(actualizarZonaMock).toHaveBeenCalledTimes(1));
  });
});
