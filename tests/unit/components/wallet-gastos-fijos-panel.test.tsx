// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";

// Feature 45 (T12, R22b/R24/R25/R26) — tests del panel CRUD de PLANTILLAS de gasto fijo.
// Las actions se mockean (no se toca el backend real). Verifica: lista concepto/monto STRING/
// estado; "Nueva plantilla" crea; "Editar" actualiza con id; "Desactivar"/"Activar" alternan
// `activa` (nunca borran); la nota deja claro que el egreso lo genera el cron.
//
// Feature 85 (T F.3/T F.6) — la tabla gana «Periodicidad» y «Próximo cobro» (R18/R19/R20), el
// encabezado del monto pasa a «Monto» y ningún texto promete ya un cobro mensual (R22). El
// instante del próximo cobro entra por props desde el servidor (R23): aquí se fija a un día
// conocido, `AHORA_ISO`, para que la fecha esperada sea un literal y no el día de la corrida.
//
// Los casos de la 45 NO se borran: se ADAPTAN. Los de crear/editar pasaban por el diálogo con
// el payload corto que esta ficha cierra, así que ahora aseveran los cinco campos; la guardia
// dura del ciclo (R3) vive en `wallet-gasto-fijo-plantilla-dialog.test.tsx`.

const crearMock = vi.fn();
const actualizarMock = vi.fn();
const setActivaMock = vi.fn();
// Feature 170 - FASE 2 (T I.2): el panel pide su PAGINA al servidor (SWR revalida al montar)
// y relee el conjunto completo al descargar. Las dos se programan en `renderPanel`.
const listarPaginaMock = vi.fn();
const listarCompletoMock = vi.fn();
vi.mock("@/lib/actions/gasto-fijo-plantilla", () => ({
  crearPlantillaAction: (...a: unknown[]) => crearMock(...a),
  actualizarPlantillaAction: (...a: unknown[]) => actualizarMock(...a),
  setActivaPlantillaAction: (...a: unknown[]) => setActivaMock(...a),
  listarPlantillasPaginadoAction: (...a: unknown[]) => listarPaginaMock(...a),
  listarPlantillasAction: (...a: unknown[]) => listarCompletoMock(...a),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { GastosFijosPlantillasPanel } from "@/app/(app)/wallet/_components/GastosFijosPlantillasPanel";

const ACTIVA: GastoFijoPlantillaDTO = {
  id: "11111111-1111-1111-1111-111111111111",
  concepto: "Alquiler de bodega",
  monto: "300.00",
  activa: true,
  periodicidadUnidad: "meses",
  periodicidadCantidad: 1,
  fechaCobro: "2026-07-01",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const INACTIVA: GastoFijoPlantillaDTO = {
  id: "22222222-2222-2222-2222-222222222222",
  concepto: "Internet",
  monto: "45.00",
  activa: false,
  periodicidadUnidad: "meses",
  periodicidadCantidad: 1,
  fechaCobro: "2026-07-01",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

/**
 * El instante que el SERVIDOR resuelve y baja por props (R23): 2026-07-15 a las 12:00 de Costa
 * Rica. Con `ACTIVA` (mensual, anclada el 1 de julio) el próximo cobro cae el 1 de agosto.
 */
const AHORA_ISO = "2026-07-15T18:00:00.000Z";

/** Una plantilla con un ciclo que NO es mensual, para que la columna diga algo distinto. */
const QUINCENAL: GastoFijoPlantillaDTO = {
  ...ACTIVA,
  id: "33333333-3333-3333-3333-333333333333",
  concepto: "Combustible",
  periodicidadUnidad: "semanas",
  periodicidadCantidad: 2,
  fechaCobro: "2026-07-06",
};

function renderPanel(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

/**
 * Feature 170 - FASE 2 (T I.2): monta el panel con su PAGINA y deja las dos lecturas
 * devolviendo el MISMO conjunto, para que la revalidacion de SWR no vacie la tabla.
 */
function montarPanel(plantillas: GastoFijoPlantillaDTO[], ahoraIso: string = AHORA_ISO) {
  listarPaginaMock.mockResolvedValue({
    status: "ok",
    page: 1,
    ...paginaInicial(plantillas),
  });
  listarCompletoMock.mockResolvedValue({ status: "ok", plantillas });
  return renderPanel(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <GastosFijosPlantillasPanel
        initialData={paginaInicial(plantillas)}
        ahoraIso={ahoraIso}
      />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("GastosFijosPlantillasPanel — listado (R26)", () => {
  it("lista concepto, monto STRING y estado; muestra la nota del cron", () => {
    montarPanel([ACTIVA, INACTIVA]);

    expect(screen.getByText("Alquiler de bodega")).toBeInTheDocument();
    // El `"300.00"` del servidor se pinta sin la cola de céntimos (feature 230).
    // El formulario de edición sigue viéndola: es dato, no presentación (§1/Q2).
    expect(screen.getByText("₡300")).toBeInTheDocument();
    expect(screen.getByText("Activa")).toBeInTheDocument();
    expect(screen.getByText("Internet")).toBeInTheDocument();
    expect(screen.getByText("Inactiva")).toBeInTheDocument();
    // Deja explícito que el egreso lo emite el cron, no este panel. Feature 85 (R22): la
    // nota decía «automáticamente cada mes», que dejó de ser cierto cuando el ciclo se abrió a
    // días y semanas; ahora nombra la periodicidad de cada plantilla.
    expect(
      screen.getByText(/según la periodicidad que tenga cada una/i),
    ).toBeInTheDocument();
  });
});

describe("GastosFijosPlantillasPanel — el ciclo en la tabla (feature 85, R18/R19/R20)", () => {
  it("la tabla muestra la periodicidad en palabras y la fecha del próximo cobro", () => {
    montarPanel([ACTIVA, QUINCENAL]);

    // Las dos columnas nuevas existen, con su encabezado.
    expect(screen.getByRole("columnheader", { name: "Periodicidad" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Próximo cobro" })).toBeInTheDocument();

    // `ACTIVA` es mensual anclada el 1 de julio; con el instante del 15 de julio, el próximo
    // cobro es el 1 de AGOSTO (el de julio ya pasó).
    const filaMensual = screen.getByRole("row", { name: /Alquiler de bodega/ });
    expect(within(filaMensual).getByText("Mensual")).toBeInTheDocument();
    expect(within(filaMensual).getByText("1 de agosto de 2026")).toBeInTheDocument();

    // `QUINCENAL` está anclada el 6 de julio: 6 + 14 días = 20 de julio.
    const filaQuincenal = screen.getByRole("row", { name: /Combustible/ });
    expect(within(filaQuincenal).getByText("Quincenal")).toBeInTheDocument();
    expect(within(filaQuincenal).getByText("20 de julio de 2026")).toBeInTheDocument();
  });

  it("una plantilla inactiva dice que no se cobra en vez de una fecha", () => {
    montarPanel([INACTIVA]);

    const fila = screen.getByRole("row", { name: /Internet/ });
    expect(within(fila).getByText("No se cobra")).toBeInTheDocument();
    // La celda no lleva NINGUNA fecha: una plantilla apagada no tiene próximo cobro.
    expect(within(fila).queryByText(/de agosto de/)).not.toBeInTheDocument();
    // Y su periodicidad se sigue viendo: el ciclo existe aunque esté desactivada.
    expect(within(fila).getByText("Mensual")).toBeInTheDocument();
  });

  it("el próximo cobro se calcula con el instante recibido por props, no con el reloj del navegador", () => {
    // El reloj del proceso se pone en 2030 a propósito: si el panel lo leyera, la fecha
    // pintada sería de 2030 y no la que corresponde al instante que llegó por props.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2030-11-20T18:00:00.000Z"));
    montarPanel([ACTIVA], "2026-07-15T18:00:00.000Z");

    const fila = screen.getByRole("row", { name: /Alquiler de bodega/ });
    expect(within(fila).getByText("1 de agosto de 2026")).toBeInTheDocument();
    expect(within(fila).queryByText(/2030/)).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("con otro instante por props, la misma plantilla anuncia otro cobro", () => {
    // La contraparte del caso anterior: la fecha SIGUE a la prop. Un panel que ignorara
    // `ahoraIso` pintaría lo mismo en los dos montajes.
    montarPanel([ACTIVA], "2026-09-15T18:00:00.000Z");

    const fila = screen.getByRole("row", { name: /Alquiler de bodega/ });
    expect(within(fila).getByText("1 de octubre de 2026")).toBeInTheDocument();
  });
});

describe("GastosFijosPlantillasPanel — textos sin promesa mensual (feature 85, R22)", () => {
  it("ningún texto del panel ni del diálogo dice «cada mes»", async () => {
    const user = userEvent.setup();
    montarPanel([ACTIVA]);

    const textoDelPanel = document.body.textContent ?? "";
    expect(textoDelPanel).not.toMatch(/cada mes/i);
    expect(textoDelPanel).not.toMatch(/monto mensual/i);
    expect(textoDelPanel).not.toMatch(/próximos meses/i);

    // El encabezado del monto es «Monto» a secas: con la periodicidad al lado, «Monto
    // mensual» era falso para toda plantilla que no fuera mensual.
    expect(screen.getByRole("columnheader", { name: "Monto" })).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Monto mensual" }),
    ).not.toBeInTheDocument();

    // Y tampoco lo dice el diálogo que se abre desde aquí.
    await user.click(screen.getByRole("button", { name: "Nueva plantilla" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent ?? "").not.toMatch(/cada mes/i);
    expect(dialog.textContent ?? "").not.toMatch(/monto mensual/i);
  }, 15000);

  it("el aviso de desactivar tampoco promete un ciclo mensual", async () => {
    const user = userEvent.setup();
    setActivaMock.mockResolvedValue({ status: "ok", plantilla: { ...ACTIVA, activa: false } });
    montarPanel([ACTIVA]);

    const fila = screen.getByRole("row", { name: /Alquiler de bodega/ });
    await user.click(within(fila).getByRole("button", { name: "Desactivar" }));

    const aviso = await screen.findByText(/Plantilla desactivada/);
    expect(aviso.textContent ?? "").not.toMatch(/meses/i);
    expect(aviso.textContent ?? "").not.toMatch(/cada mes/i);
  }, 15000);
});

describe("GastosFijosPlantillasPanel — crear (R24)", () => {
  it("Nueva plantilla abre el diálogo y crea con concepto + monto", async () => {
    const user = userEvent.setup();
    crearMock.mockResolvedValue({ status: "ok", plantilla: { ...ACTIVA } });
    montarPanel([]);

    await user.click(screen.getByRole("button", { name: "Nueva plantilla" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Nueva plantilla de gasto fijo")).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Concepto"), "Luz");
    await user.type(within(dialog).getByLabelText("Monto"), "60.00");
    // Feature 85 (R15): la fecha del primer cobro se fija a mano para que el valor esperado
    // sea un literal y no «lo que devuelva hoy `fechaCalendarioCR()`» — una aserción contra la
    // propia fuente del componente. `fireEvent.change` porque `type` no es fiable sobre un
    // `<input type="date">` en jsdom.
    fireEvent.change(within(dialog).getByLabelText("Día del primer cobro"), {
      target: { value: "2026-09-01" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    expect(crearMock).toHaveBeenCalledTimes(1);
    // Los CINCO campos: crear también manda el ciclo (R15), con el preset mensual por defecto.
    expect(crearMock.mock.calls[0][0]).toEqual({
      concepto: "Luz",
      monto: "60.00",
      periodicidadUnidad: "meses",
      periodicidadCantidad: 1,
      fechaCobro: "2026-09-01",
    });
    expect(actualizarMock).not.toHaveBeenCalled();
  }, 15000);

  it("no crea si el concepto está vacío o el monto es inválido", async () => {
    const user = userEvent.setup();
    montarPanel([]);

    await user.click(screen.getByRole("button", { name: "Nueva plantilla" }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Monto"), "0");
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    expect(crearMock).not.toHaveBeenCalled();
    expect(within(dialog).getByText("El concepto es obligatorio.")).toBeInTheDocument();
    expect(
      within(dialog).getByText("El monto debe ser un número mayor que 0."),
    ).toBeInTheDocument();
  }, 15000);
});

describe("GastosFijosPlantillasPanel — editar (R25)", () => {
  it("Editar prefila los campos y actualiza con el id de la plantilla", async () => {
    const user = userEvent.setup();
    actualizarMock.mockResolvedValue({ status: "ok", plantilla: { ...ACTIVA } });
    montarPanel([ACTIVA]);

    const fila = screen.getByRole("row", { name: /Alquiler de bodega/ });
    await user.click(within(fila).getByRole("button", { name: "Editar" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Editar plantilla de gasto fijo")).toBeInTheDocument();
    // Prefill desde la plantilla, ciclo incluido (feature 85, R14).
    expect(within(dialog).getByLabelText("Concepto")).toHaveValue("Alquiler de bodega");
    expect(within(dialog).getByLabelText("Monto")).toHaveValue("300.00");
    expect(within(dialog).getByLabelText("Día del primer cobro")).toHaveValue("2026-07-01");

    await user.clear(within(dialog).getByLabelText("Monto"));
    await user.type(within(dialog).getByLabelText("Monto"), "350.00");
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    expect(actualizarMock).toHaveBeenCalledTimes(1);
    // Feature 85 (R3): cambiar el monto reenvía el ciclo VIGENTE tal cual, en literales. Antes
    // de esta ficha aquí viajaban solo tres campos y el borde reescribía el ciclo en silencio.
    expect(actualizarMock.mock.calls[0][0]).toEqual({
      id: ACTIVA.id,
      concepto: "Alquiler de bodega",
      monto: "350.00",
      periodicidadUnidad: "meses",
      periodicidadCantidad: 1,
      fechaCobro: "2026-07-01",
    });
  }, 15000);
});

describe("GastosFijosPlantillasPanel — activar/desactivar (R25)", () => {
  it("Desactivar una plantilla activa llama setActiva con activa=false", async () => {
    const user = userEvent.setup();
    setActivaMock.mockResolvedValue({ status: "ok", plantilla: { ...ACTIVA, activa: false } });
    montarPanel([ACTIVA]);

    const fila = screen.getByRole("row", { name: /Alquiler de bodega/ });
    await user.click(within(fila).getByRole("button", { name: "Desactivar" }));

    await waitFor(() => expect(setActivaMock).toHaveBeenCalledTimes(1));
    expect(setActivaMock.mock.calls[0][0]).toEqual({ id: ACTIVA.id, activa: false });
  }, 15000);

  it("Activar una plantilla inactiva llama setActiva con activa=true", async () => {
    const user = userEvent.setup();
    setActivaMock.mockResolvedValue({ status: "ok", plantilla: { ...INACTIVA, activa: true } });
    montarPanel([INACTIVA]);

    const fila = screen.getByRole("row", { name: /Internet/ });
    await user.click(within(fila).getByRole("button", { name: "Activar" }));

    await waitFor(() => expect(setActivaMock).toHaveBeenCalledTimes(1));
    expect(setActivaMock.mock.calls[0][0]).toEqual({ id: INACTIVA.id, activa: true });
  }, 15000);
});
