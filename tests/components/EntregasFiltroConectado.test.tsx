// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

import { seleccionAFiltroAnalitica } from "@/app/(app)/_components/entregas-filtro-analitica";
import {
  FiltroEntregasProvider,
  useFiltroEntregas,
} from "@/app/(app)/_components/filtro-entregas";
import {
  CLAVE_CANTON,
  CLAVE_DISTRITO,
  CLAVE_MENSAJERO,
  CLAVE_PROVINCIA,
  CLAVE_TIENDA,
  CLAVE_ZONA,
} from "@/app/(app)/_components/entregas-filtros-def";
import { ConteoEntregasAnillo } from "@/app/(app)/analitica/_components/entregas/ConteoEntregasAnillo";
import { consultarConteoEntregas } from "@/lib/actions/conteo-entregas";

vi.mock("@/lib/actions/conteo-entregas", () => ({
  consultarConteoEntregas: vi.fn(),
}));

const consultarMock = vi.mocked(consultarConteoEntregas);

/** La selección completa de la barra: las seis facetas de catálogo a la vez. */
const SELECCION = {
  [CLAVE_ZONA]: ["z1"],
  [CLAVE_PROVINCIA]: ["p1"],
  [CLAVE_CANTON]: ["c1"],
  [CLAVE_DISTRITO]: ["d1"],
  [CLAVE_TIENDA]: ["t1"],
  [CLAVE_MENSAJERO]: ["m1"],
};

/**
 * El papel de la BARRA, reducido a lo único que hace por la cifra: traducir su selección y
 * publicarla. Se imita en vez de manejar los combos reales porque lo que este archivo
 * verifica es el cable —barra -> proveedor -> anillo—, no el widget de selección múltiple,
 * que tiene sus propios tests.
 */
function BarraDePrueba() {
  const { setFiltro } = useFiltroEntregas();
  return (
    <button type="button" onClick={() => setFiltro(seleccionAFiltroAnalitica(SELECCION))}>
      filtrar
    </button>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  consultarMock.mockResolvedValue({
    status: "ok",
    datos: {
      porDesenlace: { entregada: 20, devuelta: 5, rechazada: 3, reprogramada: 7, incidente: 1, otros: 64 },
      total: 100,
      lastSync: "2026-08-17T18:30:00.000Z",
    },
  });
});
afterEach(cleanup);

describe("El filtro de entregas llega hasta la cifra", () => {
  it("la primera consulta va sin recorte y la siguiente lleva las SEIS facetas", async () => {
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <FiltroEntregasProvider>
          <BarraDePrueba />
          <ConteoEntregasAnillo />
        </FiltroEntregasProvider>
      </SWRConfig>,
    );

    await waitFor(() => expect(consultarMock).toHaveBeenCalledTimes(1));
    // Vacío del todo: ni facetas ni ventana temporal. Lo que la barra no ha mandado, no viaja.
    expect(consultarMock.mock.calls[0]?.[0]).toEqual({});

    fireEvent.click(screen.getByRole("button", { name: "filtrar" }));

    // La mutación que este caso mata: publicar el filtro sin que forme parte de la clave de
    // SWR. Entonces no habría segunda consulta y en pantalla quedaría la cifra anterior como
    // si fuera la del filtro nuevo.
    await waitFor(() => expect(consultarMock).toHaveBeenCalledTimes(2));

    // Y LAS TRES GEOGRÁFICAS entre ellas. Es el cable que la versión anterior no tenía: la
    // barra las ofrecía o no según la fuente, y con `analytics_daily` el recorte se perdía en
    // silencio. Que lleguen hasta la consulta es lo que impide que vuelva a pasar.
    expect(consultarMock.mock.calls[1]?.[0]).toMatchObject({
      zona_id: ["z1"],
      provincia_id: ["p1"],
      canton_id: ["c1"],
      distrito_id: ["d1"],
      tienda_id: ["t1"],
      mensajero_id: ["m1"],
    });
  });
});
