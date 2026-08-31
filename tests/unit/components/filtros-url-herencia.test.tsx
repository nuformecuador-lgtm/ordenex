// @vitest-environment jsdom
import { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// Feature 335 / T5.1 — PRUEBA DE HERENCIA: la capacidad va ligada al COMPONENTE, no a la
// vista (restriccion dura 1 de requirements.md).
//
// Se monta un consumidor REAL —`NovedadesFiltrosBarra`, que es puro presentacion y cuyo
// estado vive en `useNovedadesFiltro`— entrando por una URL con params, y se comprueba que
// la barra llega escrita y el control montado y acotado SIN que el diff de esta ficha toque
// un solo archivo bajo `app/`. Si este test pasa, lo hace porque el consumidor hereda la
// capacidad de los dos canonicos compartidos y no porque nadie lo haya parcheado.

const replaceMock = vi.fn();
const pushMock = vi.fn();

let parametros = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock, refresh: vi.fn() }),
  usePathname: () => "/novedades",
  useSearchParams: () => parametros,
}));

import { NovedadesFiltrosBarra } from "@/app/(app)/novedades/_components/NovedadesFiltrosBarra";
import type { NovedadesFiltro } from "@/app/(app)/novedades/_components/useNovedadesFiltro";
import type { FilterDef, FilterSelection } from "@/components/shared/FilterComponent";
import { olvidarParamsBorrados } from "@/hooks/useFiltrosUrl";

const ZONA: FilterDef = {
  key: "zona",
  label: "Zona",
  kind: "multi",
  options: [
    { value: "norte", label: "Norte" },
    { value: "sur", label: "Sur" },
  ],
};

const OFRECIDOS = [{ key: "zona", label: "Zona" }];

beforeEach(() => {
  replaceMock.mockClear();
  pushMock.mockClear();
  parametros = new URLSearchParams();
  olvidarParamsBorrados();
});

afterEach(() => {
  cleanup();
});

/**
 * El consumidor minimo de la barra: posee las claves ACTIVAS y decide que controles monta,
 * que es exactamente el reparto de `useNovedadesFiltro`. El resto del contrato se rellena
 * con lo que la barra no mira en este caso (paginacion, conteos, recarga).
 */
function BarraDeNovedades({
  onTerminoChange,
  onSeleccionChange,
}: {
  onTerminoChange: (termino: string) => void;
  onSeleccionChange: (seleccion: FilterSelection) => void;
}) {
  const [activos, setActivos] = useState<string[]>([]);
  const [seleccion, setSeleccion] = useState<FilterSelection>({});

  const filtro: NovedadesFiltro = {
    ofrecidos: OFRECIDOS,
    montados: activos.includes("zona") ? [ZONA] : [],
    activos,
    onActivosChange: setActivos,
    onTerminoChange,
    onSeleccionChange: (siguiente) => {
      setSeleccion(siguiente);
      onSeleccionChange(siguiente);
    },
    reset: 0,
    hayFiltrosAplicados: activos.length > 0,
    limpiar: vi.fn(),
    filtrando: Object.keys(seleccion).length > 0,
    barraEnUso: activos.length > 0,
    estado: "listo",
    resultados: [],
    pagina: 1,
    irAPagina: vi.fn(),
    quitar: vi.fn(),
    recargar: vi.fn(async () => {}),
    reintentar: vi.fn(),
    limite: null,
  };

  return (
    <NovedadesFiltrosBarra
      filtro={filtro}
      label="Buscar novedades"
      regionLabel="Filtros de novedades"
    />
  );
}

describe("Herencia de la lectura de URL en un consumidor real (R1, R2, R3, R5, R6)", () => {
  it("R1/R2/R3/R5 — entrando con `?q=…&zona=…` la barra llega escrita, el control montado y la seleccion acotada", async () => {
    parametros = new URLSearchParams("q=guia123&zona=norte");
    const onTerminoChange = vi.fn();
    const onSeleccionChange = vi.fn();

    render(
      <BarraDeNovedades
        onTerminoChange={onTerminoChange}
        onSeleccionChange={onSeleccionChange}
      />,
    );

    // R1 — el campo, ya escrito; R5 — y el termino emitido, para que la lista se acote.
    expect(
      (screen.getByRole("searchbox", { name: "Buscar novedades" }) as HTMLInputElement)
        .value,
    ).toBe("guia123");
    expect(onTerminoChange).toHaveBeenCalledWith("guia123");

    // R2 — el control se monta sin que nadie lo pida desde el selector; R3/R5 — con su
    // valor ya elegido y emitido.
    const control = await screen.findByRole("button", { name: "Zona: Norte" });
    expect(control).toBeInTheDocument();
    await waitFor(() =>
      expect(onSeleccionChange).toHaveBeenCalledWith({ zona: ["norte"] }),
    );
  });

  it("R6 — sin params el consumidor se comporta como siempre: campo vacio, ningun control y ninguna emision", () => {
    const onTerminoChange = vi.fn();
    const onSeleccionChange = vi.fn();

    render(
      <BarraDeNovedades
        onTerminoChange={onTerminoChange}
        onSeleccionChange={onSeleccionChange}
      />,
    );

    expect(
      (screen.getByRole("searchbox", { name: "Buscar novedades" }) as HTMLInputElement)
        .value,
    ).toBe("");
    expect(screen.queryByRole("button", { name: /^Zona:/ })).toBeNull();
    expect(onTerminoChange).not.toHaveBeenCalled();
    expect(onSeleccionChange).not.toHaveBeenCalled();
  });
});
