// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "@/providers/ToastProvider";
import type { ProvinciaArbolDTO } from "@/lib/actions/geografia";

// Boton "Especial" (estrella) por distrito dentro de "Costos por zona". Se
// mockean las Server Actions: aqui se prueba el estado visual del boton y que
// Guardar envie el DELTA de la marca, no el estado completo.
const actualizarDistritosEspecialesMock = vi.fn();
vi.mock("@/lib/actions/geografia", () => ({
  actualizarDistritosEspeciales: (...a: unknown[]) =>
    actualizarDistritosEspecialesMock(...a),
  listarArbolGeografico: vi.fn(),
}));

const crearZonaMock = vi.fn();
vi.mock("@/lib/actions/zonas", () => ({
  crearZona: (...a: unknown[]) => crearZonaMock(...a),
  actualizarZona: vi.fn(),
}));

vi.mock("@/lib/actions/tarifas", () => ({
  crearTarifa: vi.fn(),
  actualizarTarifa: vi.fn(),
}));

const { CrearZonaForm } = await import(
  "@/app/(app)/configuracion/tarifas/_components/CrearZonaForm"
);

function arbol(): ProvinciaArbolDTO[] {
  return [
    {
      id: "p1",
      nombre: "San José",
      cantones: [
        {
          id: "c1",
          nombre: "Central",
          distritos: [
            // Ya es especial: viene de otra zona que lo marcó antes.
            {
              id: "d1",
              nombre: "Carmen",
              zonaId: "z9",
              zonaNombre: "Zona 2",
              zonaEspecial: true,
            },
            {
              id: "d2",
              nombre: "Test",
              zonaId: null,
              zonaNombre: null,
              zonaEspecial: false,
            },
          ],
        },
      ],
    },
  ];
}

function renderForm(onSaved = vi.fn()) {
  return render(
    <ToastProvider>
      <CrearZonaForm
        mode="crear"
        provincias={arbol()}
        vehiculos={[]}
        zonas={[]}
        onSaved={onSaved}
        onCancel={vi.fn()}
      />
    </ToastProvider>,
  );
}

/**
 * Fila de un distrito. Se ancla al botón "Especial" —el único elemento de la
 * fila con `aria-label` propio— porque el checkbox NO lo tiene: base-ui asocia
 * el `<label>` que lo envuelve con un `aria-labelledby`, que manda sobre el
 * `aria-label`, así que su nombre accesible es el texto visible de la fila.
 */
function filaDe(nombre: string): HTMLElement {
  const boton = screen.getByRole("button", {
    name: new RegExp(`zona especial a ${nombre}$|${nombre} como zona especial$`),
  });
  return boton.parentElement as HTMLElement;
}

/** El checkbox de pertenencia a la zona de ese distrito. */
function checkboxDe(nombre: string): HTMLElement {
  return within(filaDe(nombre)).getByRole("checkbox");
}

/**
 * Despliega el árbol hasta los distritos. Se hace por la búsqueda —que abre
 * todas las ramas que sobreviven al filtro— en vez de a base de clicks en los
 * disparadores: "Central" hace match de cantón, así que se ven sus distritos.
 */
async function abrirArbol(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByLabelText("Buscar en el catálogo geográfico"),
    "Central",
  );
  await screen.findByRole("button", { name: /Marcar Test como zona especial/ });
}

beforeEach(() => {
  vi.clearAllMocks();
  crearZonaMock.mockResolvedValue({ status: "ok", zona: { id: "z1" } });
  actualizarDistritosEspecialesMock.mockResolvedValue({
    status: "ok",
    actualizados: 1,
  });
});

afterEach(cleanup);

describe("Marca de zona especial en el selector de distritos", () => {
  it("cada distrito tiene su botón Especial, resaltado sólo si ya lo es", async () => {
    const user = userEvent.setup();
    renderForm();
    await abrirArbol(user);

    // `d1` llega marcado desde el árbol (lo marcó otra zona): botón resaltado.
    expect(
      screen.getByRole("button", {
        name: "Quitar la marca de zona especial a Carmen",
      }),
    ).toHaveAttribute("aria-pressed", "true");

    // `d2` no lo es: botón en contorno, ofreciendo marcarlo.
    expect(
      screen.getByRole("button", { name: "Marcar Test como zona especial" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("el botón alterna el resaltado sin seleccionar el distrito para la zona", async () => {
    const user = userEvent.setup();
    renderForm();
    await abrirArbol(user);

    await user.click(
      screen.getByRole("button", { name: "Marcar Test como zona especial" }),
    );
    expect(
      screen.getByRole("button", {
        name: "Quitar la marca de zona especial a Test",
      }),
    ).toHaveAttribute("aria-pressed", "true");

    // El checkbox de pertenencia a la zona sigue sin marcar: son dos acciones.
    expect(
      checkboxDe("Test"),
    ).not.toBeChecked();
  });

  it("el cantón cuenta sus especiales, y sólo cuando los hay", async () => {
    const user = userEvent.setup();
    renderForm();
    await abrirArbol(user);

    // Con `Carmen` ya especial: 2 distritos, 1 especial.
    expect(
      screen.getByText(/2 distritos, Zonas especiales: 1/),
    ).toBeInTheDocument();

    // Marcar `Test` sube el conteo…
    await user.click(
      screen.getByRole("button", { name: "Marcar Test como zona especial" }),
    );
    expect(
      screen.getByText(/2 distritos, Zonas especiales: 2/),
    ).toBeInTheDocument();

    // …y sin ninguno el fragmento desaparece: no se muestra un cero.
    await user.click(
      screen.getByRole("button", {
        name: "Quitar la marca de zona especial a Test",
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Quitar la marca de zona especial a Carmen",
      }),
    );
    expect(screen.getByText(/2 distritos/)).toBeInTheDocument();
    expect(screen.queryByText(/Zonas especiales/)).toBeNull();
  });

  it("Guardar envía sólo el delta de la marca (marcar/desmarcar)", async () => {
    const user = userEvent.setup();
    renderForm();
    await abrirArbol(user);

    await user.type(
      screen.getByPlaceholderText("Ej: San José centro"),
      "Zona 3",
    );
    await user.click(
      checkboxDe("Test"),
    );
    // Marca `d2` y quita la marca de `d1`.
    await user.click(
      screen.getByRole("button", { name: "Marcar Test como zona especial" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Quitar la marca de zona especial a Carmen",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(actualizarDistritosEspecialesMock).toHaveBeenCalledWith({
        marcar: ["d2"],
        desmarcar: ["d1"],
      }),
    );
  });

  it("sin tocar ninguna estrella, Guardar no escribe la marca", async () => {
    const user = userEvent.setup();
    renderForm();
    await abrirArbol(user);

    await user.type(
      screen.getByPlaceholderText("Ej: San José centro"),
      "Zona 3",
    );
    await user.click(
      checkboxDe("Test"),
    );
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(crearZonaMock).toHaveBeenCalled());
    expect(actualizarDistritosEspecialesMock).not.toHaveBeenCalled();
  });
});
