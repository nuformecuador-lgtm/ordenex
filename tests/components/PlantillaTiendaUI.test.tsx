// @vitest-environment jsdom
//
// PLANTILLA DE TIENDA en la pantalla (2026-08-27). Lo que se vigila aqui son las DOS puertas
// que el interruptor abre o cierra, y que no se pueden comprobar en el service:
//
//   1. El boton "Enviar para aprobacion" DESAPARECE de una fila de tienda. No basta con que el
//      service la rechace: un boton visible que siempre falla es una promesa rota en pantalla.
//   2. Guardar una plantilla que Meta YA tiene PREGUNTA antes de guardar. Es la segunda puerta
//      del aviso (la primera se pregunta al abrir el formulario) y es la que ve los cambios ya
//      escritos, que es cuando el maestro sabe de verdad que esta a punto de mandarlos.
//
// Y el reverso de las dos: una plantilla de tienda no pregunta nada, porque su texto no sale
// de casa y no hay riesgo del que avisar.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { PlantillaListItemDTO } from "@/lib/types/plantilla-mensaje";

const listarPlantillasMock = vi.fn();
const eliminarPlantillaMock = vi.fn();
const cambiarEstadoPlantillaMock = vi.fn();
const crearPlantillaMock = vi.fn();
const actualizarPlantillaMock = vi.fn();
const previewPlantillaMock = vi.fn();
const marcarPlantillaBienvenidaMock = vi.fn();
const enviarPlantillaAprobacionMock = vi.fn();
vi.mock("@/lib/actions/plantillas", () => ({
  listarPlantillas: (...a: unknown[]) => listarPlantillasMock(...a),
  eliminarPlantilla: (...a: unknown[]) => eliminarPlantillaMock(...a),
  cambiarEstadoPlantilla: (...a: unknown[]) => cambiarEstadoPlantillaMock(...a),
  crearPlantilla: (...a: unknown[]) => crearPlantillaMock(...a),
  actualizarPlantilla: (...a: unknown[]) => actualizarPlantillaMock(...a),
  previewPlantilla: (...a: unknown[]) => previewPlantillaMock(...a),
  marcarPlantillaBienvenida: (...a: unknown[]) => marcarPlantillaBienvenidaMock(...a),
  enviarPlantillaAprobacion: (...a: unknown[]) => enviarPlantillaAprobacionMock(...a),
}));

import { PlantillasModule } from "@/app/(app)/configuracion/plantillas/_components/PlantillasModule";

function fila(overrides: Partial<PlantillaListItemDTO> = {}): PlantillaListItemDTO {
  return {
    id: "p1",
    nombre: "aviso",
    cuerpo: "Hola {{cliente}}",
    estado: "saved_not_aprobation",
    variables: ["cliente"],
    variablesNombres: {},
    welcomeMessage: false,
    plantillaTienda: false,
    templateId: null,
    createdAt: new Date("2026-08-27T12:00:00Z"),
    ...overrides,
  };
}

function renderConFila(item: PlantillaListItemDTO): ReactElement {
  listarPlantillasMock.mockResolvedValue({
    status: "ok",
    items: [item],
    page: 1,
    pageSize: 25,
    total: 1,
  });
  return <PlantillasModule initialData={{ items: [item], total: 1, pageSize: 25 }} />;
}

function montar(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  actualizarPlantillaMock.mockResolvedValue({ status: "ok", plantilla: {} });
  // La vista previa se dispara sola al abrir el formulario (con retardo): sin esto la promesa
  // llega `undefined` y revienta FUERA del test, en el timer.
  previewPlantillaMock.mockResolvedValue({ status: "ok", texto: "Hola CLIENTE" });
});

afterEach(() => {
  cleanup();
});

describe("una plantilla de tienda no tiene nada que enviar a aprobar", () => {
  it("oculta 'Enviar para aprobación' y se anuncia con su insignia", async () => {
    montar(renderConFila(fila({ plantillaTienda: true, estado: "activo" })));

    const table = screen.getByRole("table", { name: "Plantillas de mensaje" });
    await within(table).findByText("aviso");

    expect(
      within(table).queryByRole("button", { name: "Enviar para aprobación" }),
    ).toBeNull();
    expect(within(table).getByText("Tienda")).toBeInTheDocument();
  });

  // El contraste es el requisito: la MISMA fila, con el interruptor apagado, sí lo ofrece.
  it("la misma fila sin el interruptor sí lo ofrece", async () => {
    montar(renderConFila(fila({ estado: "saved_not_aprobation" })));

    const table = screen.getByRole("table", { name: "Plantillas de mensaje" });
    await within(table).findByText("aviso");

    expect(
      within(table).getByRole("button", { name: "Enviar para aprobación" }),
    ).toBeInTheDocument();
  });
});

describe("avisos al editar y al guardar", () => {
  it("guardar una plantilla que Meta ya tiene pregunta ANTES de guardar", async () => {
    const user = userEvent.setup();
    montar(renderConFila(fila({ estado: "activo", templateId: "tpl-1" })));

    const table = screen.getByRole("table", { name: "Plantillas de mensaje" });
    await within(table).findByText("aviso");

    // Primera puerta: al pulsar "Editar", antes siquiera de abrir el formulario.
    await user.click(within(table).getByRole("button", { name: "Editar" }));
    const aviso = await screen.findByRole("dialog");
    expect(
      within(aviso).getByRole("heading", { name: /envía la plantilla para aprobación/i }),
    ).toBeInTheDocument();
    await user.click(within(aviso).getByRole("button", { name: "Continuar" }));

    // Segunda puerta: al pulsar "Guardar", con los cambios ya escritos.
    await user.click(await screen.findByRole("button", { name: "Guardar" }));
    const confirmar = await screen.findByRole("dialog");
    expect(
      within(confirmar).getByRole("heading", { name: /guardar envía la plantilla/i }),
    ).toBeInTheDocument();
    // Lo que importa: NADA se ha guardado todavía.
    expect(actualizarPlantillaMock).not.toHaveBeenCalled();

    await user.click(within(confirmar).getByRole("button", { name: "Guardar y enviar" }));
    await waitFor(() => expect(actualizarPlantillaMock).toHaveBeenCalledTimes(1));
  });

  // Su texto no sale de casa: ni la puerta de entrada ni la de salida tienen nada que avisar.
  it("una plantilla de tienda se edita y se guarda sin ninguna confirmación", async () => {
    const user = userEvent.setup();
    montar(renderConFila(fila({ plantillaTienda: true, estado: "activo" })));

    const table = screen.getByRole("table", { name: "Plantillas de mensaje" });
    await within(table).findByText("aviso");

    await user.click(within(table).getByRole("button", { name: "Editar" }));
    // El formulario se abre directo: si hubiera aviso, este campo no estaría en pantalla.
    await screen.findByRole("button", { name: "Guardar" });

    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(actualizarPlantillaMock).toHaveBeenCalledTimes(1));
    expect(actualizarPlantillaMock).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ plantillaTienda: true }),
    );
  });
});

// SER PLANTILLA DE TIENDA ES DE IDA (2026-08-28). La puerta real vive en el service; esto
// vigila que la pantalla no OFREZCA lo que el service va a rechazar. Un interruptor que se
// puede mover y luego falla al guardar es peor que uno bloqueado: promete algo imposible.
describe("el interruptor de una plantilla ya guardada como de tienda", () => {
  it("esta bloqueado y dice por que", async () => {
    const user = userEvent.setup();
    montar(renderConFila(fila({ plantillaTienda: true, estado: "activo" })));

    const table = screen.getByRole("table", { name: "Plantillas de mensaje" });
    await within(table).findByText("aviso");
    await user.click(within(table).getByRole("button", { name: "Editar" }));

    const conmutador = await screen.findByRole("switch", {
      name: "Plantilla para envío de la tienda",
    });
    // `aria-disabled` y no `toBeDisabled()`: Base UI pinta la raiz como `<span role="switch">`,
    // y el atributo `disabled` nativo solo existe en controles de formulario.
    expect(conmutador).toHaveAttribute("aria-disabled", "true");
    // El motivo tiene que estar EN PANTALLA: un control muerto sin explicacion se lee como
    // un fallo de la app, no como una regla.
    expect(screen.getByText(/no puede dejar de serlo/i)).toBeInTheDocument();
  });

  // El contraste: la misma pantalla sobre una plantilla que NO es de tienda deja encenderlo.
  // Sin este caso, un `disabled` puesto siempre pasaria el test de arriba.
  it("sigue libre en una plantilla que no es de tienda", async () => {
    const user = userEvent.setup();
    montar(renderConFila(fila({ estado: "saved_not_aprobation" })));

    const table = screen.getByRole("table", { name: "Plantillas de mensaje" });
    await within(table).findByText("aviso");
    await user.click(within(table).getByRole("button", { name: "Editar" }));

    const conmutador = await screen.findByRole("switch", {
      name: "Plantilla para envío de la tienda",
    });
    expect(conmutador).not.toHaveAttribute("aria-disabled", "true");
    await user.click(conmutador);
    expect(conmutador).toBeChecked();
  });
});

// COLUMNA "Plant. Tienda" (pedido humano del 2026-08-28). La insignia junto al nombre ya
// distinguia la fila, pero se lee fila a fila; una columna propia se barre en vertical.
describe("la columna Plant. Tienda", () => {
  it("marca con un chulito la fila que lo es", async () => {
    montar(renderConFila(fila({ plantillaTienda: true, estado: "activo" })));

    const table = screen.getByRole("table", { name: "Plantillas de mensaje" });
    await within(table).findByText("aviso");

    expect(
      within(table).getByRole("columnheader", { name: "Plant. Tienda" }),
    ).toBeInTheDocument();
    expect(within(table).getByRole("img", { name: "Sí" })).toBeInTheDocument();
  });

  // El `false` va VACIO a proposito: la cabecera sigue ahi, la marca no. Si el chulito se
  // pintara siempre, la columna no distinguiria nada.
  it("deja la celda vacia cuando no lo es", async () => {
    montar(renderConFila(fila({ plantillaTienda: false })));

    const table = screen.getByRole("table", { name: "Plantillas de mensaje" });
    await within(table).findByText("aviso");

    expect(
      within(table).getByRole("columnheader", { name: "Plant. Tienda" }),
    ).toBeInTheDocument();
    expect(within(table).queryByRole("img", { name: "Sí" })).toBeNull();
  });
});
