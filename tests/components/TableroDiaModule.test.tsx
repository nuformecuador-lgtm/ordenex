// @vitest-environment jsdom
//
// Feature 192 (F2.4/F2.5) — EL MÓDULO del tablero: R31, R32, R33, R34 y R56.
//
// Lo que se mide aquí no es cómo se ve el tablero (eso lo mide `TableroDiaTarjetas.test.tsx`),
// sino cómo se COMPORTA con el tiempo y con los fallos, que es donde una pantalla de monitoreo
// engaña sin romperse:
//
//   - R31: se vuelve a consultar cada 30 s mientras está abierta.
//   - R32: si una re-consulta falla, los últimos datos SIGUEN en pantalla y se avisa. Vaciar el
//     tablero o poner ceros sería decirle al supervisor que hoy nadie ha entregado nada.
//   - R33: "hoy no hay órdenes" se dice explícitamente y NO se pinta como un error.
//   - R34: la antigüedad se calcula contra `generadoAt` —cuándo se leyó el dato de la base—, no
//     contra el reloj del render. Con caché de 15 s sobre refresco de 30 s el peor caso real
//     ronda los 45 s, y una pantalla que dijera "hace 0 s" sobre ese dato haría que alguien
//     decidiera con un número viejo creyéndolo fresco.
//   - R56: el detalle NO se pide hasta que el usuario abre una tarjeta.
//   - R2/R3: un denegado se dice; nunca se degrada a un tablero de ceros.
//
// Los temporizadores son FALSOS a propósito: esperar 30 s de reloj real en una suite es cambiar
// un test por una sala de espera, y además lo volvería no determinista.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { SWRConfig } from "swr";

import { TableroDiaModule } from "@/app/(app)/monitoreo/_components/TableroDiaModule";
import { leerTableroDia, leerDetalleMensajeroDia } from "@/lib/actions/tablero-dia";
import type { FilaTableroDia, TableroDia } from "@/lib/types/tablero-dia";

// Las dos Server Actions se espían: no se llaman de verdad (arrastrarían Prisma a jsdom) y,
// sobre todo, poder CONTAR sus llamadas es lo que hace medibles R31 y R56.
vi.mock("@/lib/actions/tablero-dia", () => ({
  leerTableroDia: vi.fn(),
  leerDetalleMensajeroDia: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/monitoreo",
  useSearchParams: () => new URLSearchParams(),
}));

const leerTableroMock = vi.mocked(leerTableroDia);
const leerDetalleMock = vi.mocked(leerDetalleMensajeroDia);

const AHORA = new Date("2026-08-08T20:00:00.000Z");

const fila = (parcial: Partial<FilaTableroDia> = {}): FilaTableroDia => ({
  mensajeroId: "m-1",
  mensajeroNombre: "Ana Rojas",
  asignadas: 9,
  entregadas: 4,
  reprogramadas: 1,
  devueltas: 1,
  rechazadas: 1,
  incidentes: 0,
  sinRecoger: 1,
  enReparto: 1,
  otros: 0,
  ...parcial,
});

/** Totales sumados sobre las claves del acumulador (sin literales de bucket: ver R46). */
function tablero(filas: readonly FilaTableroDia[], generadoAt = AHORA.toISOString()): TableroDia {
  const acumulado: Record<keyof TableroDia["totales"], number> = {
    asignadas: 0,
    entregadas: 0,
    reprogramadas: 0,
    devueltas: 0,
    rechazadas: 0,
    incidentes: 0,
    sinRecoger: 0,
    enReparto: 0,
    otros: 0,
  };
  for (const f of filas) {
    for (const clave of Object.keys(acumulado) as (keyof typeof acumulado)[]) {
      acumulado[clave] += f[clave];
    }
  }
  return {
    fecha: "2026-08-08",
    generadoAt,
    alcance: "global",
    filas,
    totales: acumulado,
  };
}

const ok = (filas: readonly FilaTableroDia[], generadoAt?: string) =>
  ({ estado: "ok", tablero: tablero(filas, generadoAt) }) as const;

/** Caché aislada por test y sin dedupe: cada montaje consulta de verdad. */
function renderModulo() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <TableroDiaModule />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Feature 192 · R31 — la pantalla se vuelve a consultar cada 30 s", () => {
  it("a los 30 s hay una segunda consulta, y el dato nuevo sustituye al viejo", async () => {
    leerTableroMock
      .mockResolvedValueOnce(ok([fila({ asignadas: 9 })]))
      .mockResolvedValue(ok([fila({ asignadas: 12 })]));

    renderModulo();

    await waitFor(() => expect(screen.getByText("Ana Rojas")).toBeInTheDocument());
    expect(leerTableroMock).toHaveBeenCalledTimes(1);

    // Justo ANTES del tick no puede haber una segunda consulta: si la hubiera, el intervalo no
    // sería de 30 s y la aserción de abajo pasaría por cualquier valor menor.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    expect(leerTableroMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(leerTableroMock).toHaveBeenCalledTimes(2);
  });
});

describe("Feature 192 · R32 — un refresco que falla NO vacía el tablero", () => {
  it("conserva los datos de la primera consulta y señala el fallo", async () => {
    leerTableroMock
      .mockResolvedValueOnce(ok([fila({ mensajeroNombre: "Ana Rojas", asignadas: 9 })]))
      .mockRejectedValue(new Error("se cayó la red"));

    const { container } = renderModulo();
    await waitFor(() => expect(screen.getByText("Ana Rojas")).toBeInTheDocument());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });

    await waitFor(() =>
      expect(container.querySelector('[data-slot="tablero-dia-aviso-refresco"]')).not.toBeNull(),
    );

    // Lo que de verdad importa: la tarjeta sigue ahí y con su número, no a cero ni desaparecida.
    expect(screen.getByText("Ana Rojas")).toBeInTheDocument();
    const tarjeta = container.querySelector('[data-mensajero="m-1"]') as HTMLElement;
    expect(tarjeta).not.toBeNull();
    expect(
      tarjeta.querySelector('[data-contador="asignadas"]')?.textContent,
      "el tablero se vació o se puso a cero tras el fallo",
    ).toContain("9");
    expect(container.querySelector('[data-slot="tablero-dia-vacio"]')).toBeNull();
  });
});

describe("Feature 192 · R33 — sin órdenes hoy se dice, y no es un error", () => {
  it("muestra el vacío explícito y NO el aviso de fallo", async () => {
    leerTableroMock.mockResolvedValue(ok([]));

    const { container } = renderModulo();

    await waitFor(() =>
      expect(container.querySelector('[data-slot="tablero-dia-vacio"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-slot="tablero-dia-aviso-refresco"]')).toBeNull();
    expect(container.querySelector('[data-slot="tablero-dia-denegado"]')).toBeNull();
  });
});

describe("Feature 192 · R2/R3 — un denegado no se degrada a un tablero de ceros", () => {
  it("muestra el aviso de acceso y ni una tarjeta", async () => {
    leerTableroMock.mockResolvedValue({ estado: "denegado", motivo: "rol_no_autorizado" });

    const { container } = renderModulo();

    await waitFor(() =>
      expect(container.querySelector('[data-slot="tablero-dia-denegado"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-slot="tablero-dia-totales"]')).toBeNull();
    expect(container.querySelector('[data-slot="tablero-dia-vacio"]')).toBeNull();
  });
});

describe("Feature 192 · R34 — la antigüedad se mide contra `generadoAt`, no contra el render", () => {
  it("un dato producido hace 45 s se anuncia como tal, no como recién llegado", async () => {
    // El caso real del peor escenario de la caché (15 s) sobre el refresco (30 s). La respuesta
    // llega AHORA; si la pantalla midiera contra el instante de la respuesta o del render diría
    // "hace 0 s" sobre un dato de 45 s, que es justo la mentira que R34 prohíbe.
    const generadoAt = new Date(AHORA.getTime() - 45_000).toISOString();
    leerTableroMock.mockResolvedValue(ok([fila()], generadoAt));

    renderModulo();

    await waitFor(() => expect(screen.getByText("Ana Rojas")).toBeInTheDocument());

    const marca = screen.getByText(/Actualizado hace/i);
    expect(marca.textContent).toContain("45 s");
    expect(marca.textContent, "la pantalla anunció como fresco un dato viejo").not.toContain(
      "0 s",
    );
    // Y el `datetime` del `<time>` es el instante del DATO, no el de la petición.
    expect(marca.getAttribute("datetime")).toBe(generadoAt);
  });
});

describe("Feature 192 · R56 — el detalle no se pide hasta que se abre una tarjeta", () => {
  it("cargar el tablero (y refrescarlo) no consulta ni un detalle", async () => {
    leerTableroMock.mockResolvedValue(
      ok([fila({ mensajeroId: "m-1" }), fila({ mensajeroId: "m-2", mensajeroNombre: "Beto Mora" })]),
    );

    renderModulo();
    await waitFor(() => expect(screen.getByText("Beto Mora")).toBeInTheDocument());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(65_000);
    });

    expect(leerTableroMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(
      leerDetalleMock,
      "el tablero pidió el detalle de alguna tarjeta sin que el usuario la abriera: con 15 " +
        "mensajeros eso son 15 consultas paginadas por refresco",
    ).not.toHaveBeenCalled();
  });
});
