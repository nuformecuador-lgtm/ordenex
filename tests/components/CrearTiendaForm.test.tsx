// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CrearTiendaForm } from "@/app/(app)/configuracion/tarifas/_components/CrearTiendaForm";
import type { TarifaDTO } from "@/lib/types/tarifa";
import type { UsuarioPorRolDTO } from "@/lib/types/usuario-por-rol";

// El select de "Nueva tienda" sólo ofrece a quien AÚN NO tiene tarifa. Quien ya tiene
// una está en el listado y se toca desde ahí: ofrecerlo aquí sólo lleva a un `conflict`
// del único (zona_id, tienda_id) o —peor— a reescribirla a ciegas con el formulario en
// blanco. En EDICIÓN el filtro no aplica: el select está deshabilitado pero tiene que
// poder mostrar al dueño actual, que por definición ya tiene tarifa.

vi.mock("@/lib/actions/tarifas", () => ({
  crearTarifa: vi.fn(),
  actualizarTarifa: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const ADMIN_TIENDAS: UsuarioPorRolDTO[] = [
  { id: "t-con-default", nombre: "Tienda con tarifa" },
  { id: "t-solo-zona", nombre: "Tienda sólo con zona" },
  { id: "t-sin-tarifa", nombre: "Tienda sin tarifa" },
];

const API_KEYS: UsuarioPorRolDTO[] = [
  { id: "k-con-tarifa", nombre: "Key con tarifa" },
  { id: "k-sin-tarifa", nombre: "Key sin tarifa" },
];

function tarifa(overrides: Partial<TarifaDTO> & { id: string }): TarifaDTO {
  return {
    tiendaId: null,
    valorFlete: 1,
    valorFleteDevuelto: 1,
    valorFleteGam: 1,
    valorFleteDevueltoGam: 1,
    fulfillment: 1,
    comisionCod: 1,
    ivaFlete: 1,
    ivaComisionCod: 1,
    tarifaEspecial: null,
    zonaId: null,
    isDefault: true,
    createdAt: new Date("2026-08-24T00:00:00Z"),
    updatedAt: new Date("2026-08-24T00:00:00Z"),
    ...overrides,
  };
}

const TARIFAS: TarifaDTO[] = [
  tarifa({ id: "a", tiendaId: "t-con-default", zonaId: null }),
  // Sin fila "Por defecto": SÓLO una de zona. Esta tienda ya sale en el listado, así que
  // tampoco debe ofrecerse al crear — su "Por defecto" se añade editándola.
  tarifa({ id: "b", tiendaId: "t-solo-zona", zonaId: "z1", isDefault: false }),
  tarifa({ id: "c", tiendaId: "k-con-tarifa", zonaId: null }),
  // Tarifa de ZONA sin tienda (nivel 3 de la cascada): no es de nadie del select y no
  // puede descontar a ninguna opción. Si el filtro leyera mal el NULL, las quitaría todas.
  tarifa({ id: "d", tiendaId: null, zonaId: "z1", isDefault: false }),
];

function renderForm(props: Partial<Parameters<typeof CrearTiendaForm>[0]> = {}) {
  return render(
    <CrearTiendaForm
      mode="crear"
      adminTiendas={ADMIN_TIENDAS}
      apiKeys={API_KEYS}
      zonas={[]}
      tarifas={TARIFAS}
      onSaved={vi.fn()}
      onCancel={vi.fn()}
      {...props}
    />,
  );
}

/** Nombres de las opciones del select del dueño, con la lista abierta. */
async function opcionesDelSelect(): Promise<string[]> {
  await userEvent.click(screen.getByRole("combobox", { name: /administrador de tienda/i }));
  return screen.getAllByRole("option").map((o) => o.textContent?.trim() ?? "");
}

afterEach(() => cleanup());

describe("CrearTiendaForm — a quién ofrece el select", () => {
  it("al CREAR ofrece sólo a quien no tiene ninguna tarifa", async () => {
    renderForm();
    const opciones = await opcionesDelSelect();

    expect(opciones).toContain("Tienda sin tarifa");
    expect(opciones).toContain("Key sin tarifa");
    expect(opciones).not.toContain("Tienda con tarifa");
    expect(opciones).not.toContain("Key con tarifa");
  });

  // El caso que un filtro escrito contra `porDefecto` se comería: la tienda ya está en
  // el listado aunque no tenga la fila con `zona_id` NULL.
  it("una tienda con SÓLO tarifas de zona tampoco se ofrece", async () => {
    renderForm();
    expect(await opcionesDelSelect()).not.toContain("Tienda sólo con zona");
  });

  it("al EDITAR se conserva al dueño actual, que ya tiene tarifa", () => {
    renderForm({
      mode: "editar",
      initial: {
        tiendaId: "t-con-default",
        tarifaId: "a",
        valores: {
          valorFlete: "1",
          valorFleteDevuelto: "1",
          valorFleteGam: "1",
          valorFleteDevueltoGam: "1",
          fulfillment: "1",
          comisionCod: "1",
          ivaFlete: "1",
          ivaComisionCod: "1",
          tarifaEspecial: "",
        },
      },
    });

    // El select está deshabilitado en edición: lo que importa es que MUESTRE al dueño.
    const combo = screen.getByRole("combobox", { name: /administrador de tienda/i });
    expect(combo).toHaveTextContent("Tienda con tarifa");
  });

  it("sin candidatos lo dice, en vez de ofrecer un select vacío", () => {
    renderForm({ adminTiendas: [ADMIN_TIENDAS[0]], apiKeys: [] });

    expect(screen.getByRole("combobox", { name: /administrador de tienda/i })).toBeDisabled();
    expect(screen.getByText(/ya tienen tarifa/i)).toBeInTheDocument();
  });
});
