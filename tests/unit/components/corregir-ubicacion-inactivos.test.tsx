// @vitest-environment jsdom
// FICHA 374 (H9 · R29) — LOS DESPLEGABLES DE LA CORRECCIÓN NO OFRECEN LO RETIRADO.
//
// **Por qué aquí sí se recorta, cuando en todo el resto del catálogo NO.** El catálogo de filtros
// sigue trayendo los nodos retirados a propósito (R28): sin ellos, las órdenes históricas de un
// distrito retirado dejarían de poder filtrarse, porque en geografía nadie teclea un uuid. Pero
// corregir la ubicación de una orden es un ALTA ENCUBIERTA —crea futuro, no consulta pasado—, así
// que un nodo que ya no se puede usar no debe ofrecerse.
//
// **Y este filtro es COMODIDAD, no la puerta.** `CorregirDatosClienteService` rechaza en el
// servidor una corrección hacia un distrito retirado (R30); eso lo mide
// `tests/unit/services/corregir-datos-cliente-geo-retirada.test.ts`.
//
// **LA CONTRAPRUEBA VA PRIMERO.** Con las mismas listas y todo `disponible: true`, los tres nodos
// SÍ se ofrecen. Sin ese caso, «no aparece» pasaría en verde con un desplegable roto que no ofrece
// nada.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import {
  CorregirDatosClienteAccion,
  CORREGIR_DATOS_ACCION_LABEL,
} from "@/app/(app)/ordenes/_components/CorregirDatosClienteAccion";
import {
  CORREGIR_TITULO,
  CORREGIR_PROVINCIA_LABEL,
  CORREGIR_CANTON_LABEL,
  CORREGIR_DISTRITO_LABEL,
  CORREGIR_UBICACION_CARGANDO,
} from "@/app/(app)/ordenes/_components/CorregirDatosClienteModal";
import type { OrdenListItemDTO } from "@/lib/types/orden";

const corregirDatosClienteMock = vi.fn();
const obtenerUbicacionOrdenMock = vi.fn();
vi.mock("@/lib/actions/corregir-datos-cliente", () => ({
  corregirDatosCliente: (...args: unknown[]) => corregirDatosClienteMock(...args),
  obtenerUbicacionOrden: (...args: unknown[]) => obtenerUbicacionOrdenMock(...args),
}));

const obtenerCatalogoMock = vi.fn();
vi.mock("@/lib/actions/filtros-ordenes", () => ({
  obtenerCatalogoFiltrosOrdenes: (...args: unknown[]) => obtenerCatalogoMock(...args),
}));

// ⚠️ SWR va REAL, con una caché NUEVA por caso (`SWRConfig` + `provider`). El catálogo geográfico
// se pide bajo una clave COMPARTIDA (`correccion:geografia`), así que con la caché global por
// defecto el segundo caso leería el catálogo del primero y este archivo pasaría en verde sin haber
// medido el filtro. Medido: sin el `provider`, la contraprueba «contamina» al caso ⭑.

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

const ORDEN_ID = "0f1e2d3c-4b5a-4c7d-8e9f-0a1b2c3d4e5f";
const DISPARADOR = `${CORREGIR_DATOS_ACCION_LABEL} de la orden REM-001`;

const ORDEN = {
  id: ORDEN_ID,
  numRemision: "REM-001",
  numGuia: null,
  estatusValue: "en_reparto",
  destinatario: "Ana Pérez",
  telefonoDest: "8888-7777",
  producto: "Zapatos negros",
  notas: null,
  tiendaNombre: "Tienda X",
} as unknown as OrdenListItemDTO;

/**
 * Un nodo retirado por nivel: una provincia, un cantón hermano del elegido y un distrito hermano
 * del elegido. Con un solo nivel, un componente que filtrase provincias y olvidara los otros dos
 * pasaría en verde.
 */
function catalogo(todoDisponible: boolean) {
  const retirado = todoDisponible;
  return {
    status: "ok" as const,
    catalogo: {
      zonas: [],
      tiendas: [],
      mensajeros: [],
      provincias: [
        { id: "prov-sj", nombre: "San José", disponible: true },
        { id: "prov-li", nombre: "Limón", disponible: retirado },
      ],
      cantones: [
        { id: "can-escazu", nombre: "Escazú", padreId: "prov-sj", disponible: true },
        { id: "can-osa", nombre: "Osa", padreId: "prov-sj", disponible: retirado },
      ],
      distritos: [
        {
          id: "dis-san-rafael",
          nombre: "San Rafael",
          padreId: "can-escazu",
          disponible: true,
        },
        {
          id: "dis-san-antonio",
          nombre: "San Antonio",
          padreId: "can-escazu",
          disponible: retirado,
        },
      ],
    },
  };
}

const UBICACION = {
  status: "ok" as const,
  orden: {
    ordenId: ORDEN_ID,
    destinatario: "Ana Pérez",
    telefonoDest: "8888-7777",
    producto: "Zapatos negros",
    notas: null,
    direccion: "Av. Central 120",
    peso: 1.5,
    provinciaId: "prov-sj",
    cantonId: "can-escazu",
    distritoId: "dis-san-rafael",
    zonaNombre: "GAM Oeste",
    distritoNombre: "San Rafael",
    numGuia: null,
    yaEnUnCierre: false,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  obtenerUbicacionOrdenMock.mockResolvedValue(UBICACION);
});

afterEach(() => {
  cleanup();
});

/** Abre la ventana y espera a que la precarga termine. */
async function abrir(todoDisponible: boolean) {
  obtenerCatalogoMock.mockResolvedValue(catalogo(todoDisponible));
  const user = userEvent.setup();
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <CorregirDatosClienteAccion orden={ORDEN} />
    </SWRConfig>,
  );
  await user.click(screen.getByRole("button", { name: DISPARADOR }));
  expect(await screen.findByText(CORREGIR_TITULO)).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText(CORREGIR_UBICACION_CARGANDO)).toBeNull());
  return user;
}

/** Los nombres de las opciones que ofrece uno de los tres desplegables encadenados. */
async function opcionesDe(
  user: ReturnType<typeof userEvent.setup>,
  etiqueta: string,
): Promise<string[]> {
  await user.click(screen.getByRole("combobox", { name: etiqueta }));
  const listbox = await screen.findByRole("listbox");
  const opciones = within(listbox)
    .getAllByRole("option")
    .map((o) => o.textContent ?? "");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  return opciones;
}

describe("374/R29 — la corrección de ubicación solo ofrece nodos disponibles", () => {
  it("CONTRAPRUEBA: con todo disponible, los tres desplegables ofrecen los dos de cada nivel", async () => {
    const user = await abrir(true);

    expect(await opcionesDe(user, CORREGIR_PROVINCIA_LABEL)).toEqual(["San José", "Limón"]);
    expect(await opcionesDe(user, CORREGIR_CANTON_LABEL)).toEqual(["Escazú", "Osa"]);
    expect(await opcionesDe(user, CORREGIR_DISTRITO_LABEL)).toEqual([
      "San Rafael",
      "San Antonio",
    ]);
  });

  it("⭑ el nodo RETIRADO desaparece de los tres desplegables, y los demás siguen", async () => {
    const user = await abrir(false);

    expect(await opcionesDe(user, CORREGIR_PROVINCIA_LABEL)).toEqual(["San José"]);
    expect(await opcionesDe(user, CORREGIR_CANTON_LABEL)).toEqual(["Escazú"]);
    expect(await opcionesDe(user, CORREGIR_DISTRITO_LABEL)).toEqual(["San Rafael"]);
  });
});
