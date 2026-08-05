// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { PanelesOperativos } from "@/app/(app)/analitica/_components/operativo/PanelesOperativos";
import { PANELES_OPERATIVOS } from "@/app/(app)/analitica/_components/operativo/catalogo-paneles";
import { consultarAnaliticaOperativa } from "@/lib/actions/analitica-operativa";
import { PENUMBRA, type ResultadoOperativo } from "@/lib/types/analitica-operativa";
import { ToastProvider } from "@/providers/ToastProvider";

// Feature 131 (T7.2) — MEDIR el coste de las N invocaciones. D4 lo hace parte de la
// entrega, no un extra: el design declara que ese coste NO estaba medido y que medirlo era
// deuda de esta feature.
//
// Que mide y que NO: aqui la Server Action esta MOCKEADA con una latencia fija, asi que
// esto NO mide la base de datos ni la red. Mide lo unico que es responsabilidad del
// tablero y que si puede degradarse en silencio: **cuantas invocaciones dispara un cambio
// de filtro y si se SOLAPAN o se SERIALIZAN**. Con N invocaciones de latencia L, el reloj
// distingue las dos hipotesis sin ambiguedad.
//
// Lo que se cronometra es el INSTANTE DE ARRANQUE de cada invocacion, no el reloj de pared
// del test: `userEvent.click` y el sondeo de `waitFor` (50 ms por vuelta) meten un ruido
// del mismo orden que la latencia simulada y taparian la senal. Con N invocaciones de
// latencia L: si SOLAPAN, todas arrancan casi a la vez y la dispersion es ~0; si se
// SERIALIZAN, la ultima arranca ~(N-1) x L despues de la primera.
//
// La cota se deja HOLGADA (una sola latencia de dispersion) a proposito: este caso existe
// para cazar una regresion estructural —alguien encadena las llamadas con `await` dentro
// de un bucle, o mete un `mutate` secuencial—, no para medir la maquina de nadie.

vi.mock("@/lib/actions/analitica-operativa", () => ({
  consultarAnaliticaOperativa: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/analitica",
}));

const accion = vi.mocked(consultarAnaliticaOperativa);

/** Latencia simulada de UNA invocacion. */
const LATENCIA_MS = 50;

const METRICAS = PANELES_OPERATIVOS.flatMap((p) => p.metricas.map((m) => m.metricaId));

function ok(metricaId: string): ResultadoOperativo {
  return {
    status: "ok",
    datos: {
      metricaId,
      unidad: "conteo",
      unidadDeConteo: "gestion",
      rango: {
        preset: "semana",
        desde: new Date("2026-08-03T06:00:00.000Z"),
        hasta: new Date("2026-08-04T06:00:00.000Z"),
        desdeFecha: "2026-08-03",
        hastaFecha: "2026-08-03",
      },
      puntos: [{ fecha: "2026-08-03", valor: 3 }],
      cobertura: { fechasNoComparables: [], penumbra: PENUMBRA },
    },
  };
}

/** Instante de ARRANQUE de cada invocacion, en el orden en que entraron. */
let arranques: number[] = [];

/** Dispersion entre la primera y la ultima invocacion de un lote. */
function dispersion(desde: number): number {
  const lote = arranques.slice(desde);
  return lote.length === 0 ? 0 : Math.max(...lote) - Math.min(...lote);
}

beforeEach(() => {
  vi.clearAllMocks();
  arranques = [];
  accion.mockImplementation(({ metricaId }) => {
    arranques.push(performance.now());
    return new Promise((resolver) => setTimeout(() => resolver(ok(metricaId)), LATENCIA_MS));
  });
});
afterEach(cleanup);

describe("Feature 131 (T7.2, D4) — el coste de las N invocaciones", () => {
  it("una carga del tablero dispara UNA invocacion por metrica declarada, y ni una mas", async () => {
    render(
      // Feature 134 (T4.2): el tablero monta ahora el control de descarga, que llama a
      // `useToast()`. En la app el `ToastProvider` vive en el layout; aqui se aporta igual.
      <ToastProvider>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <PanelesOperativos />
        </SWRConfig>
      </ToastProvider>,
    );
    await screen.findByRole("region", { name: "Ordenes creadas" }, { timeout: 4000 });
    await waitFor(() => expect(accion.mock.calls.length).toBe(METRICAS.length));

    // D4 fija el presupuesto en <=6 PANELES; el numero de invocaciones sale de las
    // metricas que esos paneles declaran y queda anotado aqui para que un crecimiento
    // silencioso del catalogo se vea en un test y no en la pantalla de un usuario.
    expect(PANELES_OPERATIVOS.length).toBeLessThanOrEqual(6);
    expect(accion.mock.calls.map(([e]) => e.metricaId).sort()).toEqual([...METRICAS].sort());
  });

  it("las invocaciones se SOLAPAN: no se serializan una tras otra", async () => {
    render(
      // Feature 134 (T4.2): el tablero monta ahora el control de descarga, que llama a
      // `useToast()`. En la app el `ToastProvider` vive en el layout; aqui se aporta igual.
      <ToastProvider>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <PanelesOperativos />
        </SWRConfig>
      </ToastProvider>,
    );
    await waitFor(() => expect(accion.mock.calls.length).toBe(METRICAS.length), {
      timeout: 10_000,
    });

    const separacion = dispersion(0);
    const serializado = (METRICAS.length - 1) * LATENCIA_MS;
    expect(
      separacion,
      `las ${METRICAS.length} invocaciones arrancaron con ${Math.round(separacion)} ms de ` +
        `dispersion; serializadas costarian ~${serializado} ms`,
    ).toBeLessThan(LATENCIA_MS);
  });

  it("un cambio de filtro rehace TODOS los paneles, tambien en paralelo", async () => {
    render(
      // Feature 134 (T4.2): el tablero monta ahora el control de descarga, que llama a
      // `useToast()`. En la app el `ToastProvider` vive en el layout; aqui se aporta igual.
      <ToastProvider>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <PanelesOperativos />
        </SWRConfig>
      </ToastProvider>,
    );
    await waitFor(() => expect(accion.mock.calls.length).toBe(METRICAS.length), {
      timeout: 10_000,
    });

    const antes = accion.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: /Actualizar/ }));
    await waitFor(() => expect(accion.mock.calls.length).toBe(antes + METRICAS.length), {
      timeout: 10_000,
    });

    const separacion = dispersion(antes);
    expect(
      separacion,
      `la revalidacion arranco sus ${METRICAS.length} invocaciones con ` +
        `${Math.round(separacion)} ms de dispersion`,
    ).toBeLessThan(LATENCIA_MS);
  });
});
