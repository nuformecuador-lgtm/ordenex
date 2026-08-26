// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AsignarBodegaModal } from "@/app/(app)/ordenes/_components/AsignarBodegaModal";
import { AsignarRecoleccionModal } from "@/app/(app)/ordenes/_components/AsignarRecoleccionModal";
import { AsignarSateliteModal } from "@/app/(app)/recepcion-satelite/_components/AsignarSateliteModal";
import { MOTIVO_BLOQUEADO_POR_CIERRE } from "@/app/(app)/ordenes/_components/mensajero-options";
import { MOTIVO_USUARIO_NO_ASIGNABLE } from "@/lib/constants/estado-usuario-asignable";
import type { MensajeroLiteDTO } from "@/lib/types/orden-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";

/**
 * =================================================================================================
 * Pedido humano (2026-08-26) — EL MENSAJERO DADO DE BAJA NO PUEDE ELEGIRSE, EN LOS TRES SELECTORES.
 * =================================================================================================
 *
 * Sus palabras: «un usuario con estado inactivo se le puede asignar ordenes, si esta
 * inactivo/bloqueado no se le puede asignar paquetes». La primera mitad era el BUG —el estado del
 * usuario no se miraba en ninguna de las tres escrituras ni en ninguno de los tres selectores— y la
 * segunda, la regla.
 *
 * ⚠️ QUÉ AFIRMA ESTE ARCHIVO Y QUÉ NO. Afirma que la PANTALLA marca a quien el servidor va a
 * rechazar; que el servidor lo rechace vive en `guia-asignacion-service.test.ts` y
 * `asignacion-satelite-service.test.ts`. Las dos mitades tienen que existir por separado: es la
 * lección del incidente del 18/08 (ver `mensajero-options.ts`), donde pantalla y servidor
 * discrepaban y quien asignaba se topaba con el rechazo al confirmar.
 *
 * El motivo va EN el nombre accesible de la opción, no sólo en un atributo: un nombre gris sin
 * explicación deja a quien asigna preguntándose si es un fallo de la pantalla.
 */

vi.mock("@/lib/actions/ordenes-guia", () => ({
  asignarDesdeBodega: vi.fn(),
  asignarRecoleccion: vi.fn(),
}));

vi.mock("@/lib/actions/recepcion-satelite", () => ({
  asignarDesdeSatelite: vi.fn(),
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

const MENSAJEROS: MensajeroLiteDTO[] = [
  { id: "m1", nombre: "Ana Mensajera" },
  { id: "m2", nombre: "Beto Mensajero" },
];

const FECHAS_DIA_REPARTO = { hoy: "2026-08-20", manana: "2026-08-21" };

function makeOrden(id: string, estatusValue: string): OrdenListItemDTO {
  return {
    id,
    numGuia: 100,
    numRemision: `REM-${id}`,
    estatusId: "st-1",
    estatusValue,
    destinatario: "Destino",
    telefonoDest: "88880000",
    tiendaId: "t1",
    tiendaNombre: "Tienda X",
    zonaId: "z1",
    zonaEsGam: true,
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: null,
    producto: "Caja",
    peso: 1,
    notas: null,
    createdAt: new Date("2026-08-20T00:00:00Z"),
    updatedAt: new Date("2026-08-20T00:00:00Z"),
  };
}

function makeOrdenSatelite(id: string): RecepcionSateliteDTO {
  return {
    id,
    numGuia: 1001,
    numRemision: "REM-000",
    estatusValue: "en_bodega_satelite",
    destinatario: "Destino",
    telefonoDest: "88880000",
    direccion: "Calle 1",
    producto: "Caja",
    montoCobrar: 150,
    tiendaNombre: "Tienda X",
    zonaNombre: "Limón",
    provinciaNombre: "Limón",
    cantonNombre: "Central",
    distritoNombre: "Limón",
  };
}

async function abrirSelector(
  user: ReturnType<typeof userEvent.setup>,
  nombre = "Mensajero para el lote",
) {
  await user.click(screen.getByRole("combobox", { name: nombre }));
  return screen.findByRole("listbox");
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("2026-08-26 · el mensajero inactivo/bloqueado no es elegible", () => {
  it("reparto desde bodega central: sale deshabilitado y con el motivo EN la etiqueta", async () => {
    const user = userEvent.setup();
    render(
      <AsignarBodegaModal
        open
        ordenes={[makeOrden("o1", "en_bodega_central")]}
        mensajeros={MENSAJEROS}
        mensajerosNoAsignablesIds={["m2"]}
        fechasDiaReparto={FECHAS_DIA_REPARTO}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const listbox = await abrirSelector(user);
    const noAsignable = within(listbox).getByRole("option", {
      name: `Beto Mensajero (${MOTIVO_USUARIO_NO_ASIGNABLE})`,
    });
    expect(noAsignable).toHaveAttribute("aria-disabled", "true");
    // Y su compañero activo sigue elegible: no se prohíbe la bodega entera.
    expect(
      within(listbox).getByRole("option", { name: "Ana Mensajera" }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  it("recolección en tienda: sale deshabilitado, igual que en reparto", async () => {
    const user = userEvent.setup();
    render(
      <AsignarRecoleccionModal
        open
        ordenes={[makeOrden("o1", "por_recolectar_en_tienda")]}
        mensajeros={MENSAJEROS}
        mensajerosNoAsignablesIds={["m2"]}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const listbox = await abrirSelector(user, "Mensajero para la recolección");
    expect(
      within(listbox).getByRole("option", {
        name: `Beto Mensajero (${MOTIVO_USUARIO_NO_ASIGNABLE})`,
      }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("bodega satélite: sale deshabilitado — es la pantalla del incidente del 18/08", async () => {
    const user = userEvent.setup();
    render(
      <AsignarSateliteModal
        open
        ordenes={[makeOrdenSatelite("o1")]}
        mensajeros={MENSAJEROS}
        mensajerosNoAsignablesIds={["m2"]}
        fechasDiaReparto={FECHAS_DIA_REPARTO}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const listbox = await abrirSelector(user);
    expect(
      within(listbox).getByRole("option", {
        name: `Beto Mensajero (${MOTIVO_USUARIO_NO_ASIGNABLE})`,
      }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("con la lista vacía no se marca a nadie (no se prohíbe de más)", async () => {
    const user = userEvent.setup();
    render(
      <AsignarBodegaModal
        open
        ordenes={[makeOrden("o1", "en_bodega_central")]}
        mensajeros={MENSAJEROS}
        mensajerosNoAsignablesIds={[]}
        fechasDiaReparto={FECHAS_DIA_REPARTO}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const listbox = await abrirSelector(user);
    expect(
      within(listbox).getByRole("option", { name: "Beto Mensajero" }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  // Cuando concurren los DOS motivos gana el del ESTADO, y no es una preferencia estética: un
  // mensajero dado de baja no se desbloquea cerrando cierres, así que mandar a quien asigna a
  // esperar ese cierre sería mandarlo a esperar algo que no cambia nada.
  it("si además arrastra cierres, el motivo que se lee es el del estado", async () => {
    const user = userEvent.setup();
    render(
      <AsignarBodegaModal
        open
        ordenes={[makeOrden("o1", "en_bodega_central")]}
        mensajeros={MENSAJEROS}
        mensajerosBloqueadosIds={["m2"]}
        mensajerosNoAsignablesIds={["m2"]}
        fechasDiaReparto={FECHAS_DIA_REPARTO}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const listbox = await abrirSelector(user);
    expect(
      within(listbox).getByRole("option", {
        name: `Beto Mensajero (${MOTIVO_USUARIO_NO_ASIGNABLE})`,
      }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      within(listbox).queryByRole("option", {
        name: `Beto Mensajero (${MOTIVO_BLOQUEADO_POR_CIERRE})`,
      }),
    ).toBeNull();
  });
});
