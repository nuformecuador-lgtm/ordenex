// @vitest-environment jsdom
//
// Ficha 476 (T5.1, R3 de pantalla) — el PANEL de parámetros del informe de picking dentro del
// formulario de un envío. La acción `listarTiendasPicking` se dobla: se afirma lo que el panel PINTA
// y lo que MANDA al formulario. Textos esperados LITERALES (no importados de `picking-textos`), para
// que un texto cambiado ponga esto en rojo en vez de compararse contra su propia fuente.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";

import type { InformeDTO } from "@/lib/types/envios-whatsapp";

const listar = vi.fn();
vi.mock("@/lib/actions/informe-picking", () => ({
  listarTiendasPicking: (...x: unknown[]) => listar(...x),
}));

import { ParamsPicking } from "@/app/(app)/configuracion/envios-whatsapp/_components/ParamsPicking";
import { ParametrosInforme } from "@/app/(app)/configuracion/envios-whatsapp/_components/ParametrosInforme";

const TIENDAS_N2 = [
  { tiendaId: "t-gameos", nombre: "Gameos", ordenes: 25, atrasadas: 2 },
  { tiendaId: "t-nuform", nombre: "Nuform", ordenes: 61, atrasadas: 4 },
  { tiendaId: "t-sicommer", nombre: "Sicommer", ordenes: 1, atrasadas: 0 },
];
const TIENDAS_N5 = [
  { tiendaId: "t-gameos", nombre: "Gameos", ordenes: 25, atrasadas: 0 },
  { tiendaId: "t-nuform", nombre: "Nuform", ordenes: 61, atrasadas: 1 },
  { tiendaId: "t-sicommer", nombre: "Sicommer", ordenes: 1, atrasadas: 0 },
];

function ok(tiendas: typeof TIENDAS_N2) {
  return { status: "ok" as const, tiendas };
}

/** Una promesa que el test resuelve cuando quiere (para respuestas que llegan tarde). */
function diferida<T>() {
  let resolver!: (v: T) => void;
  const promesa = new Promise<T>((r) => {
    resolver = r;
  });
  return { promesa, resolver };
}

let ultimos: Record<string, unknown> = {};
const onCambiarEspia = vi.fn();
function Harness({ inicial, errores = {} }: { inicial: Record<string, unknown>; errores?: Record<string, string[]> }) {
  const [v, setV] = useState(inicial);
  useEffect(() => {
    ultimos = v;
  }, [v]);
  return (
    <ParamsPicking
      etiqueta="Parámetros del picking"
      ayuda="Solo aparecen las tiendas con fulfillment. Cada tienda va en su propio envío."
      valores={v}
      onCambiar={(c, x) => {
        onCambiarEspia(c, x);
        setV((p) => ({ ...p, [c]: x }));
      }}
      errores={errores}
      retardoMs={0}
    />
  );
}

async function montar(inicial: Record<string, unknown> = { tiendaId: "", diasAtraso: 2 }, errores: Record<string, string[]> = {}) {
  render(<Harness inicial={inicial} errores={errores} />);
  await screen.findByRole("radio", { name: /Gameos/ });
}

function conteo(id: string): string {
  return screen.getByTestId(`conteo-${id}`).textContent ?? "";
}

beforeEach(() => {
  ultimos = {};
  onCambiarEspia.mockReset();
  listar.mockReset();
  listar.mockImplementation(async ({ diasAtraso }: { diasAtraso: number }) => ok(diasAtraso === 5 ? TIENDAS_N5 : TIENDAS_N2));
});
afterEach(cleanup);

describe("R3 — el selector ofrece las tiendas de la acción, con sus conteos", () => {
  it("pide la lista con el N del formulario y pinta UNA opción por tienda, en el orden recibido", async () => {
    await montar();
    expect(listar).toHaveBeenCalledWith({ diasAtraso: 2 });
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(screen.getByRole("radiogroup", { name: "Tienda" })).toBeTruthy();
    expect(radios.map((r) => r.closest("label")?.textContent)).toEqual([
      "Gameos25 órdenes · 2 atrasadas",
      "Nuform61 órdenes · 4 atrasadas",
      "Sicommer1 orden · 0 atrasadas",
    ]);
  });

  it("elegir una tienda manda SOLO su id (una sola elección)", async () => {
    const user = userEvent.setup();
    await montar();
    await user.click(screen.getByRole("radio", { name: /Nuform/ }));
    expect(ultimos.tiendaId).toBe("t-nuform");
    await user.click(screen.getByRole("radio", { name: /Gameos/ }));
    expect(ultimos.tiendaId).toBe("t-gameos");
    expect(screen.getByRole("radio", { name: /Gameos/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: /Nuform/ }).getAttribute("aria-checked")).toBe("false");
  });

  it("al cambiar N vuelve a pedir y recalcula las atrasadas de cada tienda", async () => {
    const user = userEvent.setup();
    await montar();
    expect(conteo("t-nuform")).toBe("61 órdenes · 4 atrasadas");
    const n = screen.getByLabelText("Marcar las órdenes atrasadas");
    await user.clear(n);
    await user.type(n, "5");
    await waitFor(() => expect(conteo("t-nuform")).toBe("61 órdenes · 1 atrasada"));
    expect(listar).toHaveBeenLastCalledWith({ diasAtraso: 5 });
    expect(conteo("t-gameos")).toBe("25 órdenes · 0 atrasadas");
    expect(ultimos.diasAtraso).toBe(5);
  });

  it("descarta una respuesta que llega TARDE de un N anterior", async () => {
    const user = userEvent.setup();
    const lenta = diferida<ReturnType<typeof ok>>();
    await montar();
    listar.mockImplementation(({ diasAtraso }: { diasAtraso: number }) =>
      diasAtraso === 3 ? lenta.promesa : Promise.resolve(ok(TIENDAS_N5)),
    );
    const n = screen.getByLabelText("Marcar las órdenes atrasadas");
    await user.clear(n);
    await user.type(n, "3");
    await waitFor(() => expect(listar).toHaveBeenLastCalledWith({ diasAtraso: 3 }));
    await user.clear(n);
    await user.type(n, "5");
    await waitFor(() => expect(conteo("t-nuform")).toBe("61 órdenes · 1 atrasada"));
    // Llega ahora la de N=3 (con otros números): no debe pisar lo que se ve para N=5.
    await act(async () => {
      lenta.resolver(ok([{ tiendaId: "t-nuform", nombre: "Nuform", ordenes: 61, atrasadas: 9 }, ...TIENDAS_N2.slice(2)]));
      await lenta.promesa;
    });
    expect(conteo("t-nuform")).toBe("61 órdenes · 1 atrasada");
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("mientras llega la lista del N nuevo, los conteos del anterior NO se dan por buenos", async () => {
    const user = userEvent.setup();
    const lenta = diferida<ReturnType<typeof ok>>();
    await montar();
    listar.mockImplementation(() => lenta.promesa);
    const n = screen.getByLabelText("Marcar las órdenes atrasadas");
    await user.clear(n);
    await user.type(n, "5");
    await waitFor(() => expect(conteo("t-nuform")).toBe("calculando…"));
    await act(async () => {
      lenta.resolver(ok(TIENDAS_N5));
      await lenta.promesa;
    });
    expect(conteo("t-nuform")).toBe("61 órdenes · 1 atrasada");
  });
});

describe("R3 — estados de la lista", () => {
  it("sin tiendas con fulfillment: estado vacío claro, sin opciones", async () => {
    listar.mockResolvedValue(ok([]));
    render(<Harness inicial={{ tiendaId: "", diasAtraso: 2 }} />);
    const vacio = await screen.findByTestId("picking-sin-tiendas");
    expect(vacio.textContent).toBe(
      "No hay tiendas con fulfillment. Cuando una tienda tenga fulfillment activo, aparecerá aquí.",
    );
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("sin permiso (no maestro): lo dice en claro y no vuelve a pedir", async () => {
    listar.mockResolvedValue({ status: "forbidden" });
    render(<Harness inicial={{ tiendaId: "", diasAtraso: 2 }} />);
    expect(await screen.findByText("Solo un maestro puede ver las tiendas del picking.")).toBeTruthy();
    expect(listar).toHaveBeenCalledTimes(1);
  });

  it("si la carga falla, avisa y «Reintentar» vuelve a pedir", async () => {
    const user = userEvent.setup();
    listar.mockRejectedValueOnce(new Error("red"));
    render(<Harness inicial={{ tiendaId: "", diasAtraso: 2 }} />);
    expect(await screen.findByText("No se pudieron cargar las tiendas. Inténtalo de nuevo en un momento.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("radio", { name: /Gameos/ })).toBeTruthy();
  });

  it("una tienda guardada que ya no está en la lista se avisa, sin marcar otra", async () => {
    await montar({ tiendaId: "t-borrada", diasAtraso: 2 });
    expect(
      screen.getByText("La tienda guardada ya no tiene fulfillment o no está activa: el envío fallará hasta que elijas otra."),
    ).toBeTruthy();
    expect(screen.getAllByRole("radio").every((r) => r.getAttribute("aria-checked") === "false")).toBe(true);
    expect(ultimos.tiendaId).toBe("t-borrada");
  });
});

describe("R2 de pantalla — errores junto a su campo", () => {
  it("N fuera de 1..30: mensaje claro junto al número y NO se pide la lista", async () => {
    const user = userEvent.setup();
    await montar();
    const llamadas = listar.mock.calls.length;
    const n = screen.getByLabelText("Marcar las órdenes atrasadas");
    await user.clear(n);
    await user.type(n, "31");
    expect(await screen.findByText("Escribe un número entero de días entre 1 y 30.")).toBeTruthy();
    expect(n.getAttribute("aria-invalid")).toBe("true");
    expect(conteo("t-nuform")).toBe("61 órdenes");
    // Al escribir «31» pasa por «3» (válido); «31» no se pide.
    expect(listar.mock.calls.slice(llamadas).every(([x]) => (x as { diasAtraso: number }).diasAtraso !== 31)).toBe(true);
  });

  it("el error de «Guardar» en tiendaId sale junto al selector y se va al elegir", async () => {
    const user = userEvent.setup();
    await montar({ tiendaId: "", diasAtraso: 2 }, { "parametros.tiendaId": ["Elige la tienda del picking."] });
    expect(screen.getByText("Elige la tienda del picking.")).toBeTruthy();
    expect(screen.getByRole("radiogroup").getAttribute("aria-invalid")).toBe("true");
    await user.click(screen.getByRole("radio", { name: /Sicommer/ }));
    expect(screen.queryByText("Elige la tienda del picking.")).toBeNull();
  });

  it("el error de «Guardar» en diasAtraso sale junto al número en español claro", async () => {
    await montar({ tiendaId: "t-gameos", diasAtraso: 2 }, { "parametros.diasAtraso": ["Invalid input"] });
    expect(screen.getByText("Escribe un número entero de días entre 1 y 30.")).toBeTruthy();
    expect(screen.queryByText("Invalid input")).toBeNull();
  });
});

describe("m4 (revisión 475) — la partida que falta no deja el formulario «con cambios»", () => {
  it("sin `diasAtraso`, lo completa con 2 por `onNormalizar` y NO por `onCambiar`", async () => {
    const onCambiar = vi.fn();
    const onNormalizar = vi.fn();
    render(
      <ParamsPicking etiqueta="Parámetros del picking" valores={{ tiendaId: "t-gameos" }} onCambiar={onCambiar} onNormalizar={onNormalizar} errores={{}} retardoMs={0} />,
    );
    await screen.findByRole("radio", { name: /Gameos/ });
    expect(onNormalizar).toHaveBeenCalledWith("diasAtraso", 2);
    expect(onCambiar).not.toHaveBeenCalled();
  });

  it("con la partida completa no normaliza nada", async () => {
    const onCambiar = vi.fn();
    const onNormalizar = vi.fn();
    render(
      <ParamsPicking etiqueta="Parámetros del picking" valores={{ tiendaId: "", diasAtraso: 2 }} onCambiar={onCambiar} onNormalizar={onNormalizar} errores={{}} retardoMs={0} />,
    );
    await screen.findByRole("radio", { name: /Gameos/ });
    expect(onNormalizar).not.toHaveBeenCalled();
    expect(onCambiar).not.toHaveBeenCalled();
  });
});

describe("ParametrosInforme — el descriptor `picking` monta el panel real", () => {
  it("pinta el selector (no la reserva) y le entrega SOLO los errores de sus campos", async () => {
    const informe = {
      clave: "picking",
      nombre: "Picking",
      descripcion: "",
      generaDocumento: true,
      aptoParaAdminTienda: false,
      soloPorEvento: false,
      eventos: [],
      parametrosPorDefecto: { tiendaId: "", diasAtraso: 2 },
      descriptores: [
        {
          campo: "picking",
          tipo: "panel",
          panel: "picking",
          campos: ["tiendaId", "diasAtraso"],
          etiqueta: "Parámetros del picking",
          ayuda: "Solo aparecen las tiendas con fulfillment. Cada tienda va en su propio envío.",
        },
      ],
      variables: [],
    } as unknown as InformeDTO;
    render(
      <ParametrosInforme
        informe={informe}
        valores={{ tiendaId: "", diasAtraso: 2 }}
        onCambiar={() => {}}
        errores={{ "parametros.tiendaId": ["Elige la tienda del picking."], nombre: ["Otro campo"] }}
      />,
    );
    expect(await screen.findByRole("radio", { name: /Gameos/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Parámetros del picking" })).toBeTruthy();
    expect(screen.getByText(/Solo aparecen las tiendas con fulfillment\. Cada tienda va en su propio envío\./)).toBeTruthy();
    expect(screen.getByText("Elige la tienda del picking.")).toBeTruthy();
    expect(screen.queryByText("Otro campo")).toBeNull();
    expect(screen.queryByText(/todavía no está disponible/)).toBeNull();
  });
});
