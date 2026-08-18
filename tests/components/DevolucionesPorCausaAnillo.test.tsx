// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SWRConfig } from "swr";

import { DevolucionesPorCausaAnillo } from "@/app/(app)/analitica/_components/entregas/DevolucionesPorCausaAnillo";
import {
  TEXTO_PROHIBIDO,
  TEXTO_SESION_NO_VALIDA,
} from "@/app/(app)/analitica/_components/operativo/textos";
import { consultarConteoDevoluciones } from "@/lib/actions/conteo-devoluciones";
import type { ConteoDeCausa, ConteoDevolucionesDTO } from "@/lib/types/conteo-devoluciones";

vi.mock("@/lib/actions/conteo-devoluciones", () => ({
  consultarConteoDevoluciones: vi.fn(),
}));

const consultarMock = vi.mocked(consultarConteoDevoluciones);

function datos(porCausa: ConteoDeCausa[]): ConteoDevolucionesDTO {
  return {
    porCausa,
    total: porCausa.reduce((s, f) => s + f.conteo, 0),
    lastSync: "2026-08-18T18:30:00.000Z",
  };
}

/** El motivo aparece DOS veces: en la fila visible y en la lista para lectores de pantalla.
 *  Por eso se busca en plural — `findByText` falla en cuanto hay más de una coincidencia. */
async function hayTexto(patron: RegExp) {
  return (await screen.findAllByText(patron)).length > 0;
}

function renderAnillo() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <DevolucionesPorCausaAnillo />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("Anillo de devoluciones — de dónde sale la cifra", () => {
  it("consulta `consultarConteoDevoluciones` una sola vez y por ninguna otra puerta", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([{ causa: "not_found", motivo: "Cliente no localizado", conteo: 6 }]),
    });
    renderAnillo();

    expect(await hayTexto(/Cliente no localizado/)).toBe(true);
    expect(consultarMock).toHaveBeenCalledTimes(1);
  });

  // La primera consulta va SIN filtro: la pantalla no arranca con una ventana que nadie pidió.
  it("la primera consulta va sin filtro", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([{ causa: "not_found", motivo: "Cliente no localizado", conteo: 6 }]),
    });
    renderAnillo();

    expect(await hayTexto(/Cliente no localizado/)).toBe(true);
    expect(consultarMock.mock.calls[0]?.[0]).toEqual({});
  });
});

describe("Anillo de devoluciones — lo que pinta", () => {
  // Se afirma sobre la ALTERNATIVA TEXTUAL: recharts mide su contenedor y en jsdom mide 0×0.
  it("pinta una porción por causa, con su cifra y su peso", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([
        { causa: "not_found", motivo: "Cliente no localizado", conteo: 6 },
        { causa: "wrong_address", motivo: "Dirección errada", conteo: 3 },
        { causa: "sin_causa", motivo: "Sin causa registrada", conteo: 1 },
      ]),
    });
    renderAnillo();

    // En las filas visibles el nombre y la cifra van en celdas distintas; la línea completa
    // «motivo: cifra (peso)» la escribe la lista accesible, que es donde se afirma.
    expect(await hayTexto(/Cliente no localizado: 6\s\(60\s?%\)/)).toBe(true);
    expect(screen.getByText(/Dirección errada: 3\s\(30\s?%\)/)).toBeInTheDocument();
    expect(screen.getByText(/Sin causa registrada: 1\s\(10\s?%\)/)).toBeInTheDocument();
  });

  // El MOTIVO llega traducido del servidor y el componente no traduce nada: los values del enum
  // están en inglés, y de un value en inglés no se deriva un rótulo en castellano.
  it("pinta el motivo traducido, nunca el value crudo", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([{ causa: "wrong_number", motivo: "Número de celular errado", conteo: 4 }]),
    });
    renderAnillo();

    expect(await hayTexto(/Número de celular errado/)).toBe(true);
    expect(screen.queryByText(/wrong_number/)).toBeNull();
  });

  // Las causas sin gestiones NO viajan, y aquí no se rellenan: al revés que en el anillo de
  // desenlaces —seis segmentos fijos— una causa que nunca se registró no es una categoría del
  // negocio que haya que enseñar vacía.
  it("no inventa las causas que no vinieron", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([{ causa: "not_found", motivo: "Cliente no localizado", conteo: 6 }]),
    });
    renderAnillo();

    expect(await hayTexto(/Cliente no localizado/)).toBe(true);
    expect(screen.queryByText(/Dirección errada/)).toBeNull();
  });

  // Sin devoluciones no se dibuja un anillo de ceros: el marco cae a su estado vacío. Una
  // rosquilla vacía con un «0» al centro se lee como una cifra medida.
  it("con el universo vacío no dibuja anillo", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([]) });
    renderAnillo();

    expect(await screen.findByText(/no hubo|sin datos|vacío/i)).toBeInTheDocument();
  });
});

describe("Anillo de devoluciones — los estados que NO son «sin datos»", () => {
  // Un problema de permisos pintado como cero afirmaría que no hubo devoluciones, que es una
  // mentira distinta. Y «no puedes» y «no sabemos quién eres» no comparten texto.
  it.each([
    ["forbidden", TEXTO_PROHIBIDO],
    ["unauthenticated", TEXTO_SESION_NO_VALIDA],
  ] as const)("%s se presenta con su propio texto", async (status, texto) => {
    consultarMock.mockResolvedValue({ status } as never);
    renderAnillo();

    expect(await screen.findByText(texto)).toBeInTheDocument();
  });

  it("un fallo de red se presenta como aviso, no como vacío", async () => {
    consultarMock.mockRejectedValue(new Error("se cayó"));
    renderAnillo();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
