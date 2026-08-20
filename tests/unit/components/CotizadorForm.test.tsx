// @vitest-environment jsdom
// Feature 248 (T4.1/T4.2) — la superficie PUBLICA `/cotizador` tal como se ve en el navegador.
// Cubre R9 (la cascada acota) y R11 (el copy de compensacion del riesgo aceptado en D3).
//
// Se monta `CotizadorForm` con un arbol geografico de props —que es exactamente como lo recibe
// en produccion (D13: el Server Component lo lee y lo pasa entero, sin round-trips)— y se dobla
// la Server Action, que es el unico borde que este componente toca. Lo que aqui se mide es la
// SUPERFICIE; la proyeccion publica tiene sus propios tests del lado del servidor.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CotizadorForm } from "@/app/cotizador/CotizadorForm";
import { consultarCoberturaPublica } from "@/lib/actions/cobertura-publica";
import type { ArbolGeograficoPublico } from "@/lib/types/cotizador";

vi.mock("@/lib/actions/cobertura-publica", () => ({
  consultarCoberturaPublica: vi.fn(),
}));

const consultarMock = vi.mocked(consultarCoberturaPublica);

/**
 * Dos provincias con cantones y distritos DISTINTOS y nombres inconfundibles: si la cascada no
 * acotara, los cantones de Heredia apareceria bajo San José y el test lo vería.
 */
const ARBOL: ArbolGeograficoPublico = [
  {
    id: "p-sj",
    nombre: "San José",
    cantones: [
      {
        id: "c-sj-central",
        nombre: "San José Central",
        distritos: [
          { id: "d-carmen", nombre: "Carmen" },
          { id: "d-merced", nombre: "Merced" },
        ],
      },
      {
        id: "c-escazu",
        nombre: "Escazú",
        distritos: [{ id: "d-san-rafael", nombre: "San Rafael de Escazú" }],
      },
    ],
  },
  {
    id: "p-heredia",
    nombre: "Heredia",
    cantones: [
      {
        id: "c-belen",
        nombre: "Belén",
        distritos: [{ id: "d-la-ribera", nombre: "La Ribera" }],
      },
    ],
  },
];

const combo = (nombre: string) => screen.getByRole("combobox", { name: nombre });

/** Abre un `Select` de base-ui y devuelve los nombres accesibles de las opciones ofrecidas. */
async function opcionesDe(
  user: ReturnType<typeof userEvent.setup>,
  nombre: string,
): Promise<string[]> {
  await user.click(combo(nombre));
  const listbox = await screen.findByRole("listbox");
  const opciones = within(listbox)
    .getAllByRole("option")
    .map((opcion) => opcion.textContent?.trim() ?? "");
  await user.keyboard("{Escape}");
  return opciones;
}

/** Abre un `Select` de base-ui y elige la opcion indicada por su etiqueta. */
async function elegir(
  user: ReturnType<typeof userEvent.setup>,
  nombre: string,
  opcion: string,
): Promise<void> {
  await user.click(combo(nombre));
  const listbox = await screen.findByRole("listbox");
  await user.click(within(listbox).getByRole("option", { name: opcion }));
}

beforeEach(() => {
  vi.clearAllMocks();
  consultarMock.mockResolvedValue({ estado: "sin_cobertura" });
});

afterEach(cleanup);

// ---------------------------------------------------------------------------

describe("R9 — la cascada provincia → cantón → distrito", () => {
  it("la cascada acota cantones a la provincia y distritos al cantón", async () => {
    const user = userEvent.setup();
    render(<CotizadorForm arbol={ARBOL} />);

    // Sin provincia elegida no hay nada que ofrecer aguas abajo: los dos controles siguientes
    // están deshabilitados, que es la forma de decir el orden de la cascada sin un mensaje.
    expect(combo("Cantón")).toBeDisabled();
    expect(combo("Distrito")).toBeDisabled();

    await elegir(user, "Provincia", "San José");

    // Los cantones ofrecidos son EXACTAMENTE los de San José: Belén (de Heredia) no está.
    expect(await opcionesDe(user, "Cantón")).toEqual(["San José Central", "Escazú"]);
    expect(combo("Distrito")).toBeDisabled();

    await elegir(user, "Cantón", "San José Central");

    // Y los distritos ofrecidos son EXACTAMENTE los de ese cantón: San Rafael de Escazú (del
    // otro cantón de la misma provincia) no está.
    expect(await opcionesDe(user, "Distrito")).toEqual(["Carmen", "Merced"]);

    // Cambiar de provincia invalida lo elegido aguas abajo: los cantones pasan a ser los de
    // Heredia y el distrito vuelve a estar deshabilitado, sin arrastrar la selección vieja.
    await elegir(user, "Provincia", "Heredia");
    expect(await opcionesDe(user, "Cantón")).toEqual(["Belén"]);
    expect(combo("Distrito")).toBeDisabled();
  });

  it("consulta el TRÍO DE NOMBRES que la cascada compuso, sin ningún identificador de tienda", async () => {
    const user = userEvent.setup();
    consultarMock.mockResolvedValue({ estado: "cubierto", zonaNombre: "GAM" });
    render(<CotizadorForm arbol={ARBOL} />);

    await elegir(user, "Provincia", "San José");
    await elegir(user, "Cantón", "San José Central");
    await elegir(user, "Distrito", "Merced");
    await user.click(screen.getByRole("button", { name: "Consultar cobertura" }));

    expect(consultarMock).toHaveBeenCalledWith({
      provincia: "San José",
      canton: "San José Central",
      distrito: "Merced",
    });
    expect(await screen.findByText(/Zona de cobertura: GAM/)).toBeInTheDocument();
  });
});

describe("R11 — el copy de compensación del riesgo aceptado (D3)", () => {
  it("la página declara que ahí se consulta cobertura y que el costeo vive en el canal por API key", () => {
    render(<CotizadorForm arbol={ARBOL} />);

    // EN EL RENDER INICIAL: sin abrir nada, sin desplegar nada, sin hacer un solo click. Un
    // aviso que hay que descubrir no compensa el nombre de la ruta.
    const copy = screen.getByText(/Acá se consulta cobertura/);
    expect(copy).toBeInTheDocument();
    expect(copy).toHaveTextContent(/no muestra ningún importe/);
    expect(copy).toHaveTextContent(/El costeo del envío se obtiene por el canal de integración con API key/);
  });

  it("el render inicial no pinta ni un importe ni ningún rastro de tarifa", () => {
    const { container } = render(<CotizadorForm arbol={ARBOL} />);

    // R6/R10 — contraprueba de superficie: ni símbolo de moneda, ni dígitos con dos decimales,
    // ni las palabras del dinero. La ausencia de importes es medible, no prometida.
    const texto = container.textContent ?? "";
    expect(texto).not.toMatch(/[₡$€]/);
    expect(texto).not.toMatch(/\d+[.,]\d{2}/);
    expect(texto).not.toMatch(/flete|comisión|\bIVA\b|total a pagar/i);
  });
});
