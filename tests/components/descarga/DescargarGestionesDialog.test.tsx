// @vitest-environment jsdom
// Feature 230 (T4.1 · T4.2) — el DIÁLOGO de la descarga DETALLADA de cierres.
//
// Cubre R28, R29, R30, R31, R32 (mitad de cliente), R34, R35 y R39.
//
// Lo que este archivo vigila, y por qué cada caso está: el diálogo es lo ÚNICO que decide el
// conjunto del archivo (D11). Si se le colara un filtro de la pantalla, o si llamara al borde
// con la selección vacía, el archivo dejaría de ser lo que el usuario pidió — y en el segundo
// caso «ningún mensajero» se leería como «todos», que es exactamente lo que R39 niega.
//
// El espía va sobre la ACCIÓN, que llega por prop: así se afirma «no se llamó al borde», que es
// más fuerte que «no se descargó nada» (podría no descargarse por un fallo del generador).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "@/providers/ToastProvider";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows } from "@/lib/utils/xlsx-template";
import { DescargarGestionesDialog } from "@/app/(app)/cierres-admin/_components/DescargarGestionesDialog";
import type { CierreGestionDescargaDTO } from "@/lib/interfaces/services/ICierresAdminService";
import type {
  CatalogoFiltrosCierresDTO,
  FiltrosDescargaGestiones,
} from "@/lib/types/filtros-cierres";

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
  return { ...actual, buildXlsxRows: vi.fn(async () => new ArrayBuffer(8)) };
});
const buildXlsxRowsMock = vi.mocked(buildXlsxRows);

// El control dice los fallos por toast, no en el DOM del diálogo: para poder afirmar QUÉ dice
// —y sobre todo que NO produjo archivo— el doble tiene que ser inspeccionable.
const { errorToastMock } = vi.hoisted(() => ({ errorToastMock: vi.fn() }));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: errorToastMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

// --- Datos ----------------------------------------------------------------

/** Los ids son UUID: es la regla del módulo de filtros de cierres, y el schema los exige. */
const ANA = "11111111-1111-4111-8111-111111111111";
const BETO = "22222222-2222-4222-8222-222222222222";
const ZONA = "33333333-3333-4333-8333-333333333333";

const CATALOGO: CatalogoFiltrosCierresDTO = {
  zonas: [{ id: ZONA, nombre: "Limón" }],
  mensajeros: [
    { id: ANA, nombre: "Ana Mensajera", zonaId: ZONA },
    { id: BETO, nombre: "Beto Mensajero", zonaId: null },
  ],
};

function gestion(): CierreGestionDescargaDTO {
  return {
    mensajeroNombre: "Ana Mensajera",
    cierreSolicitadoAt: "2026-07-11T10:00:00.000Z",
    numGuia: 1001,
    numRemision: "REM-1",
    destinatario: "Ana Pérez",
    direccion: "Calle 1",
    zonaNombre: "Limón",
    provinciaNombre: "Limón",
    cantonNombre: "Central",
    distritoNombre: null,
    producto: "Caja",
    tiendaNombre: "Tienda X",
    resultado: "entregada",
    montoRecibido: "1000.10",
    pagos: [{ metodo: "SINPE", monto: "1000.10" }],
    motivo: null,
    fechaReprogramacion: null,
    esRechazoSla: false,
    causaIncidente: null,
    indemnizacion: null,
    pagoMensajero: "100.10",
    ingresoBodegaRechazo: null,
    ingresoOrdenex: null,
  };
}

function accionOk() {
  // El parámetro se declara —aunque el doble no lo use— para que `mock.calls[0][0]` esté
  // TIPADO: es sobre ese objeto sobre el que se afirma R34, y un espía sin firma lo deja en
  // `never` y hace que la aserción no compruebe nada.
  return vi.fn(async (_recorte: FiltrosDescargaGestiones) => ({
    status: "ok" as const,
    items: [gestion()],
    total: 1,
  }));
}

function montar(accion: ReturnType<typeof accionOk>) {
  return render(
    <ToastProvider>
      <DescargarGestionesDialog catalogo={CATALOGO} accion={accion} />
    </ToastProvider>,
  );
}

/** El disparador del diálogo (no es el control de descarga: ése vive DENTRO). */
function disparador() {
  return screen.getByRole("button", { name: "Descargar detallada por mensajero" });
}

/** El control que produce el archivo, dentro del diálogo. */
function botonDescargar() {
  return screen.getByRole("button", { name: "Descargar Gestiones de cierres" });
}

beforeEach(() => {
  vi.clearAllMocks();
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
});
afterEach(() => cleanup());

describe("diálogo de descarga detallada de gestiones (T4.1)", () => {
  it("pulsar el control abre el diálogo y no descarga nada todavía (R28)", async () => {
    const accion = accionOk();
    montar(accion);

    // Antes de pulsar no hay diálogo y no se ha pedido nada.
    expect(screen.queryByRole("dialog")).toBeNull();

    await userEvent.click(disparador());

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    // R28: presentar el diálogo ANTES de producir archivo alguno.
    expect(accion).not.toHaveBeenCalled();
    expect(descargarBlobMock).not.toHaveBeenCalled();
  });

  it("el diálogo solo ofrece mensajeros del catálogo del alcance (R29)", async () => {
    const accion = accionOk();
    montar(accion);
    await userEvent.click(disparador());

    const dialogo = await screen.findByRole("dialog");
    // Los DOS del catálogo, y ninguno más: el diálogo no inventa opciones ni pide una consulta
    // propia. El catálogo ya viene acotado al alcance por el servidor.
    expect(within(dialogo).getAllByRole("checkbox")).toHaveLength(2);
    expect(within(dialogo).getByRole("checkbox", { name: "Ana Mensajera" })).toBeInTheDocument();
    expect(within(dialogo).getByRole("checkbox", { name: "Beto Mensajero" })).toBeInTheDocument();
    expect(within(dialogo).queryByRole("checkbox", { name: "Carla Ajena" })).toBeNull();
  });

  it("permite seleccionar varios mensajeros a la vez (R30)", async () => {
    const accion = accionOk();
    montar(accion);
    await userEvent.click(disparador());

    await userEvent.click(await screen.findByRole("checkbox", { name: "Ana Mensajera" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Beto Mensajero" }));
    await userEvent.click(botonDescargar());

    await waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(accion).toHaveBeenCalledWith({ mensajeroIds: [ANA, BETO] });
  });

  it("ofrece un rango de fechas opcional que viaja al borde (R31)", async () => {
    const accion = accionOk();
    montar(accion);
    await userEvent.click(disparador());

    await userEvent.click(await screen.findByRole("checkbox", { name: "Ana Mensajera" }));
    // Controles PROPIOS del diálogo: sin ellos el conjunto por defecto sería todo el histórico.
    await userEvent.type(screen.getByLabelText("Desde"), "2026-07-01");
    await userEvent.type(screen.getByLabelText("Hasta"), "2026-07-31");
    await userEvent.click(botonDescargar());

    await waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(accion).toHaveBeenCalledWith({
      mensajeroIds: [ANA],
      desde: "2026-07-01",
      hasta: "2026-07-31",
    });
  });

  it("el rango es opcional de verdad: sin fechas no viaja ninguna clave de fecha (R31)", async () => {
    const accion = accionOk();
    montar(accion);
    await userEvent.click(disparador());

    await userEvent.click(await screen.findByRole("checkbox", { name: "Ana Mensajera" }));
    await userEvent.click(botonDescargar());

    await waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    // `desde: undefined` no es «sin fecha»: es una clave de más contra una lista blanca
    // `.strict()`. Lo que no se eligió no se declara.
    const enviado = accion.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(enviado)).toEqual(["mensajeroIds"]);
  });

  it("un rango invertido no produce archivo (R32)", async () => {
    const accion = accionOk();
    montar(accion);
    await userEvent.click(disparador());

    await userEvent.click(await screen.findByRole("checkbox", { name: "Ana Mensajera" }));
    await userEvent.type(screen.getByLabelText("Desde"), "2026-07-31");
    await userEvent.type(screen.getByLabelText("Hasta"), "2026-07-01");
    await userEvent.click(botonDescargar());

    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));
    expect(errorToastMock.mock.calls[0][0]).toMatch(/invertido/i);
    // Ni archivo ni viaje al servidor: «del 31 al 1» no es una pregunta que valga la pena hacer.
    expect(accion).not.toHaveBeenCalled();
    expect(descargarBlobMock).not.toHaveBeenCalled();
    // Y el diálogo lo dice a la vista, no solo por toast.
    expect(screen.getByRole("alert")).toHaveTextContent(/invertido/i);
  });

  it("cancelar o confirmar sin selección no produce archivo ni llama al borde (R39)", async () => {
    const accion = accionOk();
    montar(accion);

    // (a) Confirmar SIN nadie elegido: «ninguno» no es «todos».
    await userEvent.click(disparador());
    await screen.findByRole("dialog");
    await userEvent.click(botonDescargar());

    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));
    expect(errorToastMock.mock.calls[0][0]).toMatch(/mensajero/i);
    expect(accion).not.toHaveBeenCalled();
    expect(descargarBlobMock).not.toHaveBeenCalled();

    // (b) Cancelar: se cierra y no pasa nada.
    await userEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(accion).not.toHaveBeenCalled();
    expect(descargarBlobMock).not.toHaveBeenCalled();
  });

  it("confirmar con selección produce el archivo detallado con sus 26 columnas", async () => {
    const accion = accionOk();
    montar(accion);
    await userEvent.click(disparador());

    await userEvent.click(await screen.findByRole("checkbox", { name: "Ana Mensajera" }));
    await userEvent.click(botonDescargar());

    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));
    // UN archivo, UNA hoja (R6), con el nombre que identifica la descarga detallada (R51).
    expect(descargarBlobMock.mock.calls[0][2]).toMatch(/^gestiones-de-cierres-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1);
    const [columnas, filas, hoja] = buildXlsxRowsMock.mock.calls[0];
    const encabezados = columnas.map((c) => c.header);
    expect(encabezados).toHaveLength(26);
    expect(encabezados[0]).toBe("Mensajero");
    expect(encabezados).toContain("Resultado");
    // D8/R40: la columna de evidencia no existe en la fundida, en ningun resultado.
    expect(encabezados).not.toContain("Tiene evidencia");
    // UNA hoja, y su nombre es el titulo de la descarga detallada (R6/R51).
    expect(hoja).toBe("Gestiones de cierres");
    expect(filas).toHaveLength(1);
    expect(filas[0].resultado).toBe("Entregada");
  });
});

describe("independencia de la barra de filtros de la pantalla (T4.2, R34/R35)", () => {
  it("el objeto enviado al borde contiene solo lo elegido en el diálogo (R34)", async () => {
    const accion = accionOk();
    montar(accion);
    await userEvent.click(disparador());

    await userEvent.click(await screen.findByRole("checkbox", { name: "Beto Mensajero" }));
    await userEvent.type(screen.getByLabelText("Desde"), "2026-07-05");
    await userEvent.click(botonDescargar());

    await waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    // EXACTAMENTE esto: ni `destinoZonaIds`, ni `page`, ni `pageSize`, ni el alcance —que lo
    // resuelve el servicio desde la sesión y jamás viaja en la entrada (R15)—.
    expect(accion).toHaveBeenCalledWith({ mensajeroIds: [BETO], desde: "2026-07-05" });
    const enviado = accion.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(enviado).sort()).toEqual(["desde", "mensajeroIds"]);
  });

  it("el control detallado no lee ni modifica ningún filtro de la pantalla (R35)", async () => {
    // La afirmación estructural: el componente recibe SOLO el catálogo y la acción. No hay
    // ninguna prop por la que un filtro de pantalla pueda entrar, y ninguna por la que salga.
    // Si mañana alguien le pasara los filtros, esta lista deja de cuadrar y el caso se rompe.
    const accion = accionOk();
    const { rerender } = montar(accion);

    await userEvent.click(disparador());
    await userEvent.click(await screen.findByRole("checkbox", { name: "Ana Mensajera" }));

    // Cambiar el catálogo (lo único que la pantalla le da) no altera lo que se envía: la
    // selección es del diálogo. Se remonta con un catálogo MÁS amplio, como haría un cambio de
    // filtro en la barra de arriba.
    rerender(
      <ToastProvider>
        <DescargarGestionesDialog
          catalogo={{
            ...CATALOGO,
            zonas: [
              ...CATALOGO.zonas,
              { id: "44444444-4444-4444-8444-444444444444", nombre: "Cartago" },
            ],
          }}
          accion={accion}
        />
      </ToastProvider>,
    );

    await userEvent.click(botonDescargar());
    await waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(accion).toHaveBeenCalledWith({ mensajeroIds: [ANA] });
  });
});
