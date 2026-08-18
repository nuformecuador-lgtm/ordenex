// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { SWRConfig } from "swr";

import { DEBOUNCE_MS_DEFAULT } from "@/components/shared/FilterComponent";
import {
  FiltroSeccionesProvider,
  SeccionFiltrable,
} from "@/app/(app)/_components/filtro-secciones";

import {
  construirFiltrosEntregas,
  ATAJOS_CREACION,
  CLAVE_CREACION,
  CLAVE_MENSAJERO,
} from "@/app/(app)/_components/entregas-filtros-def";
import { FiltrosEntregas } from "@/app/(app)/_components/FiltrosEntregas";
import { construirFiltrosOrdenes } from "@/app/(app)/ordenes/_components/ordenes-filtros-def";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";

vi.mock("@/lib/actions/filtros-ordenes", () => ({
  obtenerCatalogoFiltrosOrdenes: vi.fn(async () => ({
    status: "ok" as const,
    catalogo: CATALOGO,
  })),
}));
vi.mock("@/lib/actions/ordenes-guia", () => ({
  listarMensajerosParaAsignacion: vi.fn(async () => ({
    status: "ok" as const,
    mensajeros: [{ id: "m1", nombre: "Ana" }],
  })),
}));

const CATALOGO: CatalogoFiltrosOrdenesDTO = {
  zonas: [{ id: "z1", nombre: "Central" }],
  tiendas: [],
  provincias: [{ id: "p1", nombre: "San José" }],
  cantones: [{ id: "c1", nombre: "Escazú", padreId: "p1" }],
  distritos: [{ id: "d1", nombre: "San Rafael", padreId: "c1" }],
};

const MENSAJEROS = [{ id: "m1", nombre: "Ana" }];

/** Fecha fija: los atajos se resuelven a rangos, y un rango sin reloj fijo no se compara. */
const AHORA = new Date("2026-08-17T12:00:00.000Z");

afterEach(cleanup);

describe("Barra de entregas — los SEIS filtros pedidos", () => {
  it("declara fecha, zona, provincia, cantón, distrito y mensajero, y nada más", () => {
    const defs = construirFiltrosEntregas(CATALOGO, MENSAJEROS, { ahora: AHORA });

    expect(defs.map((f) => f.key)).toEqual([
      CLAVE_CREACION,
      "zona_id",
      "provincia_id",
      "canton_id",
      "distrito_id",
      CLAVE_MENSAJERO,
    ]);
    expect(defs.map((f) => f.label)).toEqual([
      "Fecha",
      "Zona",
      "Provincia",
      "Cantón",
      "Distrito",
      "Mensajero",
    ]);
  });

  // La cadena geográfica es lo que hace que cantón y distrito ofrezcan solo lo que cuelga
  // de lo ya elegido. Sin `dependsOn` los tres filtros seguirían montándose, pero cada uno
  // ofrecería el país entero: la barra parecería igual y filtraría distinto.
  it("la geografía se declara en cadena: cantón depende de provincia y distrito de cantón", () => {
    const defs = construirFiltrosEntregas(CATALOGO, MENSAJEROS, { ahora: AHORA });
    const por = (k: string) => defs.find((f) => f.key === k);

    expect(por("provincia_id")?.dependsOn).toBeUndefined();
    expect(por("canton_id")?.dependsOn).toBe("provincia_id");
    expect(por("distrito_id")?.dependsOn).toBe("canton_id");
    // Y el hijo declara de quién cuelga cada opción, que es lo que el acotamiento lee.
    expect(por("canton_id")?.options?.[0]?.parentValue).toBe("p1");
    expect(por("distrito_id")?.options?.[0]?.parentValue).toBe("c1");
  });

  it("el filtro de mensajero se llena con la lista servida, no con el catálogo", () => {
    const defs = construirFiltrosEntregas(CATALOGO, MENSAJEROS, { ahora: AHORA });
    const mensajero = defs.find((f) => f.key === CLAVE_MENSAJERO);

    expect(mensajero?.kind).toBe("multi");
    expect(mensajero?.options).toEqual([{ value: "m1", label: "Ana" }]);
  });
});

// El pedido fue "los mismos rangos que en órdenes". Comparar los rangos RESUELTOS —y no
// solo los `value` de los atajos— es lo que mata la mutación que de verdad importa:
// cambiar aquí un `dias` dejaría los mismos cuatro nombres ofreciendo otras fechas.
describe("Barra de entregas — la fecha usa los MISMOS rangos que órdenes", () => {
  it("el filtro de fecha ofrece atajo por atajo el mismo rango que la barra de órdenes", () => {
    const entregas = construirFiltrosEntregas(CATALOGO, MENSAJEROS, { ahora: AHORA });
    const ordenes = construirFiltrosOrdenes(CATALOGO, {
      incluirTienda: false,
      ahora: AHORA,
    });

    const fechaEntregas = entregas.find((f) => f.key === CLAVE_CREACION);
    const fechaOrdenes = ordenes.find((f) => f.key === CLAVE_CREACION);

    expect(fechaEntregas?.kind).toBe("dateRange");
    expect(fechaEntregas?.options).toEqual(fechaOrdenes?.options);
    // Anti-vacío: si los atajos desaparecieran de los dos lados, el `toEqual` de arriba
    // seguiría pasando comparando dos listas vacías.
    expect(fechaEntregas?.options).toHaveLength(ATAJOS_CREACION.length);
    expect(ATAJOS_CREACION.length).toBeGreaterThan(0);
  });
});

describe("Barra de entregas — se monta como la de órdenes", () => {
  it("nace con el buscador y el selector de filtros, sin ningún control puesto", () => {
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <FiltrosEntregas />
      </SWRConfig>,
    );

    expect(
      screen.getByRole("searchbox", { name: "Buscar sección" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /filtros/i })).toBeInTheDocument();
    // Ningún filtro puesto: el selector no anuncia cuenta y no hay combos montados.
    expect(screen.getByRole("button", { name: "Filtros" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

/* ========================================================================== */
/* El campo filtra las SECCIONES de la página                                 */
/* ========================================================================== */

/** La página mínima: la barra y dos secciones con nombre. */
function PaginaDePrueba() {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <FiltroSeccionesProvider>
        <FiltrosEntregas />
        <SeccionFiltrable titulo="Entregas">
          <p>contenido de entregas</p>
        </SeccionFiltrable>
        <SeccionFiltrable titulo="Indicadores operativos">
          <p>contenido operativo</p>
        </SeccionFiltrable>
      </FiltroSeccionesProvider>
    </SWRConfig>
  );
}

/** Teclea en el campo y deja pasar el debounce de la barra. */
async function teclear(texto: string) {
  const campo = screen.getByRole("searchbox", { name: "Buscar sección" });
  fireEvent.change(campo, { target: { value: texto } });
  await screen.findByRole("searchbox", { name: "Buscar sección" });
}

describe("El campo filtra las secciones por su nombre", () => {
  it("sin nada escrito están TODAS: el filtro no se nota hasta que se usa", () => {
    render(<PaginaDePrueba />);

    expect(screen.getByText("contenido de entregas")).toBeInTheDocument();
    expect(screen.getByText("contenido operativo")).toBeInTheDocument();
  });

  it("escribir «Entregas» deja esa sección y RETIRA las demás", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<PaginaDePrueba />);
    await teclear("Entregas");
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS_DEFAULT + 1);
    });

    expect(screen.getByText("contenido de entregas")).toBeInTheDocument();
    // Se DESMONTA, no se esconde con CSS: una sección oculta que sigue en el árbol
    // seguiría leyéndose en un lector de pantalla y tabulándose.
    expect(screen.queryByText("contenido operativo")).toBeNull();
    vi.useRealTimers();
  });

  // Sin normalizar, «operativos» no encontraría «Indicadores operativos» (no es prefijo) y
  // «analitica» no encontraría nada con tilde. Las dos son la forma real de teclear.
  it("busca por subcadena y sin exigir acentos ni mayúsculas", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<PaginaDePrueba />);
    await teclear("OPERATIVOS");
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS_DEFAULT + 1);
    });

    expect(screen.getByText("contenido operativo")).toBeInTheDocument();
    expect(screen.queryByText("contenido de entregas")).toBeNull();
    vi.useRealTimers();
  });

  it("cuando no coincide ninguna, lo DICE en vez de dejar la página en blanco", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<PaginaDePrueba />);
    await teclear("zzz");
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS_DEFAULT + 1);
    });

    expect(screen.queryByText("contenido de entregas")).toBeNull();
    expect(screen.queryByText("contenido operativo")).toBeNull();
    expect(screen.getByText(/ninguna sección coincide/i)).toBeInTheDocument();
    vi.useRealTimers();
  });
});

// Una sección montada FUERA del proveedor no puede quedar escondida para siempre: no hay
// campo que la devuelva. El default del contexto es «no hay filtro» justo por esto.
describe("Sin proveedor, una sección filtrable se pinta siempre", () => {
  it("se renderiza tal cual, sin contexto que la esconda", () => {
    render(
      <SeccionFiltrable titulo="Entregas">
        <p>contenido suelto</p>
      </SeccionFiltrable>,
    );

    expect(screen.getByText("contenido suelto")).toBeInTheDocument();
  });
});
