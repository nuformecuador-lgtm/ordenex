// @vitest-environment jsdom
// Feature 230 (T4.1 · T4.2) — el DIÁLOGO de la descarga DETALLADA de cierres.
//
// Cubre R28, R29, R30, R31, R32 (mitad de cliente), R34, R35 y R39, los valores por defecto
// —todos los mensajeros marcados (pedido humano 2026-08-19) y el rango VACÍO (ficha 384)— y los
// dos avisos de conjunto vacío que la ficha 384 trajo.
//
// ⚠️ FICHA 384 (2026-09-07): hasta esa fecha el diálogo abría con el rango puesto en HOY-HOY, y
// este archivo lo afirmaba. Era un filtro que el usuario no puso y que se comía su descarga en
// silencio; el humano lo reportó como «si no tengo filtros aplicados no me deja descargar».
// Ahora el rango arranca vacío y el atajo «Hoy» lo pone en un clic. Los casos de abajo miden las
// dos mitades: que abrir y descargar SIN TOCAR NADA no recorta por fecha, y que cuando no hay
// filas el aviso no culpa a unos filtros inexistentes.
//
// Lo que este archivo vigila, y por qué cada caso está: el diálogo es lo ÚNICO que decide el
// conjunto del archivo (D11). Si se le colara un filtro de la pantalla, o si llamara al borde
// con la selección vacía, el archivo dejaría de ser lo que el usuario pidió — y en el segundo
// caso «ningún mensajero» se leería como «todos», que es exactamente lo que R39 niega.
//
// ⚠ EL DEFECTO NO DEBILITA R39, y por eso sigue habiendo un caso para él: que el diálogo ABRA
// con todos marcados no es lo mismo que tratar el vacío como todos. Desmarcar «Todos» y
// confirmar tiene que seguir sin llamar al borde.
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
import { COLUMNAS_DESCARGA_GESTIONES_FUNDIDA } from "@/app/(app)/cierres-admin/_components/cierres-gestiones-fundida-descarga-columnas";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";
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

/**
 * El día que el atajo «Hoy» pone en los dos extremos del rango (ficha 384; hasta entonces era el
 * DEFECTO del diálogo). Se calcula con la MISMA función que el componente y no con un literal:
 * un literal ataría la suite a la fecha en que se escribió, y `toISOString().slice(0,10)` la
 * pondría roja cada tarde a partir de las 18:00 CR.
 */
const HOY = fechaCalendarioCR();

/**
 * ⚠️ FICHA 351 — `mensajerosFiltro` ES A PROPÓSITO MÁS CORTO QUE `mensajeros`, Y ESO ES EL TEST.
 *
 * Beto está en el universo (`mensajeros`) pero NO entre las opciones del desplegable de filtro:
 * es la forma de un mensajero dado de baja. Este diálogo tiene que seguir viéndolo, porque sus
 * ids son la selección POR DEFECTO de la descarga y recortarla borraría del archivo las gestiones
 * históricas de quien ya no está —en silencio—. Si alguien «arregla» el diálogo para que lea
 * `mensajerosFiltro` (que es lo correcto en la barra de filtros y lo que invita a copiar), Beto
 * desaparece de las casillas y de la selección por defecto, y los casos de abajo se ponen rojos.
 */
const CATALOGO: CatalogoFiltrosCierresDTO = {
  zonas: [{ id: ZONA, nombre: "Limón" }],
  mensajeros: [
    { id: ANA, nombre: "Ana Mensajera", zonaId: ZONA },
    { id: BETO, nombre: "Beto Mensajero", zonaId: null },
  ],
  mensajerosFiltro: [{ id: ANA, nombre: "Ana Mensajera", zonaId: ZONA }],
};

function gestion(): CierreGestionDescargaDTO {
  return {
    mensajeroNombre: "Ana Mensajera",
    cierreSolicitadoAt: "2026-07-11T10:00:00.000Z",
    fechaGestion: "2026-07-11",
    diaReparto: "2026-07-11",
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

/**
 * El borde que responde SIN FILAS. `{ ok, items: [] }` es la respuesta de las dos situaciones que
 * D12/R38 obliga a no distinguir: «este mensajero no tiene cierres» y «este mensajero no es de tu
 * alcance». El servicio nunca devuelve `forbidden` para la segunda.
 */
function accionVacia() {
  return vi.fn(async (_recorte: FiltrosDescargaGestiones) => ({
    status: "ok" as const,
    items: [] as CierreGestionDescargaDTO[],
    total: 0,
  }));
}

function montar(accion: ReturnType<typeof accionOk>) {
  return render(
    <ToastProvider>
      {/* Las columnas llegan por prop desde el botón que abre esta ventana (su selector es
          quien las elige). Aquí se le pasan TODAS: lo que este archivo mide es el diálogo, no
          la preferencia de columnas — ésa vive en `CierresDescargaNiveles.test.tsx`. */}
      <DescargarGestionesDialog
        catalogo={CATALOGO}
        accion={accion}
        columnas={COLUMNAS_DESCARGA_GESTIONES_FUNDIDA}
      />
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

function checkbox(nombre: string) {
  return screen.getByRole("checkbox", { name: nombre });
}

/**
 * Deja marcado SOLO a quien se nombre. Con el defecto de «todos marcados», el camino corto es
 * apagar la lista entera desde «Todos» y encender al que interesa — que es además la interacción
 * que se quiere ejercitada en la mayoría de los casos.
 */
async function elegirSolo(nombre: string) {
  await userEvent.click(checkbox("Todos"));
  await userEvent.click(checkbox(nombre));
}

/**
 * Escribe una fecha. El `clear` es defensivo: desde la ficha 384 los controles abren vacíos, pero
 * varios casos escriben DOS veces sobre el mismo y sin vaciarlo el valor se concatenaría.
 */
async function ponerFecha(label: string, valor: string) {
  const control = screen.getByLabelText(label);
  await userEvent.clear(control);
  if (valor !== "") await userEvent.type(control, valor);
}

/** El atajo que rellena el rango con el día de hoy (ficha 384). */
function atajoHoy() {
  return screen.getByRole("button", { name: "Hoy: poner el rango de fechas en el día de hoy" });
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
    // R28: presentar el diálogo ANTES de producir archivo alguno. El defecto no lo cambia: que
    // todo venga marcado no dispara nada, sólo ahorra clics.
    expect(accion).not.toHaveBeenCalled();
    expect(descargarBlobMock).not.toHaveBeenCalled();
  });

  it("el diálogo solo ofrece mensajeros del catálogo del alcance (R29)", async () => {
    const accion = accionOk();
    montar(accion);
    await userEvent.click(disparador());

    const dialogo = await screen.findByRole("dialog");
    // Los DOS del catálogo más «Todos», y ninguno más: el diálogo no inventa opciones ni pide
    // una consulta propia. El catálogo ya viene acotado al alcance por el servidor.
    expect(within(dialogo).getAllByRole("checkbox")).toHaveLength(3);
    expect(within(dialogo).getByRole("checkbox", { name: "Ana Mensajera" })).toBeInTheDocument();
    expect(within(dialogo).getByRole("checkbox", { name: "Beto Mensajero" })).toBeInTheDocument();
    expect(within(dialogo).getByRole("checkbox", { name: "Todos" })).toBeInTheDocument();
    expect(within(dialogo).queryByRole("checkbox", { name: "Carla Ajena" })).toBeNull();
  });

  it("permite seleccionar varios mensajeros a la vez (R30)", async () => {
    const accion = accionOk();
    montar(accion);
    await userEvent.click(disparador());

    // Se parte del defecto (los dos marcados), se apaga uno y se vuelve a encender: lo que R30
    // pide es que el conjunto sea varios a la vez, no cómo se llega a él.
    await userEvent.click(await screen.findByRole("checkbox", { name: "Beto Mensajero" }));
    await userEvent.click(checkbox("Beto Mensajero"));
    await userEvent.click(botonDescargar());

    await waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const enviado = accion.mock.calls[0][0];
    expect(new Set(enviado.mensajeroIds)).toEqual(new Set([ANA, BETO]));
  });

  it("ofrece un rango de fechas que viaja al borde (R31)", async () => {
    const accion = accionOk();
    montar(accion);
    await userEvent.click(disparador());

    await screen.findByRole("checkbox", { name: "Ana Mensajera" });
    await elegirSolo("Ana Mensajera");
    // Controles PROPIOS del diálogo: sin ellos el conjunto por defecto sería todo el histórico.
    await ponerFecha("Desde", "2026-07-01");
    await ponerFecha("Hasta", "2026-07-31");
    await userEvent.click(botonDescargar());

    await waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(accion).toHaveBeenCalledWith({
      mensajeroIds: [ANA],
      desde: "2026-07-01",
      hasta: "2026-07-31",
    });
  });

  it("una fecha vacía no viaja: el extremo se quita de verdad (R31)", async () => {
    const accion = accionOk();
    montar(accion);
    await userEvent.click(disparador());

    await screen.findByRole("checkbox", { name: "Ana Mensajera" });
    await elegirSolo("Ana Mensajera");
    await ponerFecha("Desde", "");
    await ponerFecha("Hasta", "");
    await userEvent.click(botonDescargar());

    await waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    // `desde: undefined` no es «sin fecha»: es una clave de más contra una lista blanca
    // `.strict()`. Lo que se vació no se declara.
    const enviado = accion.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(enviado)).toEqual(["mensajeroIds"]);
  });

  it("un rango invertido no produce archivo (R32)", async () => {
    const accion = accionOk();
    montar(accion);
    await userEvent.click(disparador());

    await screen.findByRole("checkbox", { name: "Ana Mensajera" });
    await elegirSolo("Ana Mensajera");
    await ponerFecha("Desde", "2026-07-31");
    await ponerFecha("Hasta", "2026-07-01");
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

    // (a) Confirmar SIN nadie elegido: «ninguno» no es «todos». Hay que llegar ahí a propósito,
    // porque el diálogo abre con todos marcados — pero el corte tiene que seguir existiendo.
    await userEvent.click(disparador());
    await screen.findByRole("dialog");
    await userEvent.click(checkbox("Todos"));
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

  it("confirmar con selección produce el archivo detallado con sus 29 columnas", async () => {
    const accion = accionOk();
    montar(accion);
    await userEvent.click(disparador());

    await screen.findByRole("checkbox", { name: "Ana Mensajera" });
    await elegirSolo("Ana Mensajera");
    await userEvent.click(botonDescargar());

    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));
    // UN archivo, UNA hoja (R6), con el nombre que identifica la descarga detallada (R51).
    expect(descargarBlobMock.mock.calls[0][2]).toMatch(
      /^gestiones-de-cierres-\d{4}-\d{2}-\d{2}\.xlsx$/,
    );
    expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1);
    const [columnas, filas, hoja] = buildXlsxRowsMock.mock.calls[0];
    const encabezados = columnas.map((c) => c.header);
    // 29 desde el 2026-09-05: las 27 de la 230 más «Fecha de gestión» y «Día de reparto».
    expect(encabezados).toHaveLength(29);
    expect(encabezados[0]).toBe("Mensajero");
    expect(encabezados).toContain("Resultado");
    expect(encabezados).toContain("Fecha de gestión");
    expect(encabezados).toContain("Día de reparto");
    // D8/R40: la columna de evidencia no existe en la fundida, en ningun resultado.
    expect(encabezados).not.toContain("Tiene evidencia");
    // UNA hoja, y su nombre es el titulo de la descarga detallada (R6/R51).
    expect(hoja).toBe("Gestiones de cierres");
    expect(filas).toHaveLength(1);
    expect(filas[0].resultado).toBe("Entregada");
  });
});

/* ========================================================================== */
/* Los valores por defecto (pedido humano 2026-08-19)                          */
/* ========================================================================== */

describe("valores por defecto del diálogo", () => {
  // FICHA 384 — EL CASO QUE FALLABA ANTES DE LA FICHA, y el que reportó el humano: abrir y
  // descargar SIN TOCAR NADA tiene que llevarse lo que la pantalla enseña, no el día de hoy.
  //
  // Se afirma sobre lo que VIAJA al borde y no sólo sobre el píxel: un control pintado en blanco
  // que aun así mandara `desde` sería exactamente el fallo mudo que la ficha viene a cerrar. Y se
  // afirma con `Object.keys`, porque `desde: undefined` NO es «sin fecha» —es una clave de más
  // contra la lista blanca `.strict()` del borde—.
  it("abre con todos los mensajeros marcados y SIN rango de fechas (ficha 384)", async () => {
    const accion = accionOk();
    montar(accion);
    await userEvent.click(disparador());
    await screen.findByRole("dialog");

    expect(checkbox("Todos")).toBeChecked();
    expect(checkbox("Ana Mensajera")).toBeChecked();
    expect(checkbox("Beto Mensajero")).toBeChecked();
    expect(screen.getByLabelText("Desde")).toHaveValue("");
    expect(screen.getByLabelText("Hasta")).toHaveValue("");

    await userEvent.click(botonDescargar());

    await waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(accion).toHaveBeenCalledWith({ mensajeroIds: [ANA, BETO] });
    const enviado = accion.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(enviado)).toEqual(["mensajeroIds"]);
  });

  // La otra mitad de la ficha 384: lo que el defecto de hoy-hoy ahorraba sigue estando, pero a un
  // clic del USUARIO. El pedido del 2026-08-19 —el cierre del día de toda la flota— se sirve así.
  it("el atajo «Hoy» pone el día en los dos extremos, y entonces sí viaja (ficha 384)", async () => {
    const accion = accionOk();
    montar(accion);
    await userEvent.click(disparador());
    await screen.findByRole("dialog");

    await userEvent.click(atajoHoy());

    // Los DOS extremos: con uno solo el rango sería abierto por un lado y el archivo traería
    // histórico que nadie pidió.
    expect(screen.getByLabelText("Desde")).toHaveValue(HOY);
    expect(screen.getByLabelText("Hasta")).toHaveValue(HOY);

    await userEvent.click(botonDescargar());

    await waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(accion).toHaveBeenCalledWith({
      mensajeroIds: [ANA, BETO],
      desde: HOY,
      hasta: HOY,
    });
  });

  it("«Todos» desmarca y vuelve a marcar la lista entera", async () => {
    const accion = accionOk();
    montar(accion);
    await userEvent.click(disparador());
    await screen.findByRole("dialog");

    await userEvent.click(checkbox("Todos"));
    expect(checkbox("Ana Mensajera")).not.toBeChecked();
    expect(checkbox("Beto Mensajero")).not.toBeChecked();

    await userEvent.click(checkbox("Todos"));
    expect(checkbox("Ana Mensajera")).toBeChecked();
    expect(checkbox("Beto Mensajero")).toBeChecked();
  });

  // El tri-estado: con ALGUNOS marcados «Todos» no puede decir ni sí ni no. Un `checked` a secas
  // afirmaría que van los dos y bastaría un clic distraído para llevarse el doble de lo pedido.
  it("«Todos» queda indeterminado cuando hay una selección parcial", async () => {
    const accion = accionOk();
    montar(accion);
    await userEvent.click(disparador());
    await screen.findByRole("dialog");

    await userEvent.click(checkbox("Beto Mensajero"));

    expect(checkbox("Todos")).toHaveAttribute("aria-checked", "mixed");
    expect(checkbox("Ana Mensajera")).toBeChecked();
    expect(checkbox("Beto Mensajero")).not.toBeChecked();
  });
});

describe("independencia de la barra de filtros de la pantalla (T4.2, R34/R35)", () => {
  it("el objeto enviado al borde contiene solo lo elegido en el diálogo (R34)", async () => {
    const accion = accionOk();
    montar(accion);
    await userEvent.click(disparador());

    await screen.findByRole("checkbox", { name: "Beto Mensajero" });
    await elegirSolo("Beto Mensajero");
    await ponerFecha("Desde", "2026-07-05");
    await ponerFecha("Hasta", "");
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
    await screen.findByRole("checkbox", { name: "Ana Mensajera" });
    await elegirSolo("Ana Mensajera");
    await ponerFecha("Desde", "");
    await ponerFecha("Hasta", "");

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
          columnas={COLUMNAS_DESCARGA_GESTIONES_FUNDIDA}
        />
      </ToastProvider>,
    );

    await userEvent.click(botonDescargar());
    await waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(accion).toHaveBeenCalledWith({ mensajeroIds: [ANA] });
  });
});

/* ========================================================================== */
/* El aviso de «no hay nada» (ficha 384)                                       */
/* ========================================================================== */

// La SEGUNDA mitad de lo reportado el 2026-09-07: cuando el conjunto vuelve vacío, el aviso del
// control común —«No hay datos que descargar con los filtros aplicados. Ajusta los filtros»— le
// pedía al usuario arreglar unos filtros que no había puesto. Ese texto lo comparten ~26 tablas y
// NO se toca; lo que cambia es que este diálogo redacta el suyo por la puerta que el control ya
// ofrece (el mensaje de `obtenerFilas` tiene prioridad).
//
// Los textos se afirman como LITERALES y no contra las constantes del componente: una aserción
// contra su propia fuente está verde por construcción, diga lo que diga el texto.
describe("aviso de conjunto vacío (ficha 384)", () => {
  const CULPA_A_LOS_FILTROS = "con los filtros aplicados";

  it("sin rango puesto, el aviso no culpa a ningún filtro de fecha", async () => {
    const accion = accionVacia();
    montar(accion as unknown as ReturnType<typeof accionOk>);
    await userEvent.click(disparador());
    await screen.findByRole("dialog");

    await userEvent.click(botonDescargar());

    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));
    const aviso = errorToastMock.mock.calls[0][0] as string;
    expect(aviso).toBe(
      "Los mensajeros elegidos no tienen gestiones de cierre. Elegí otros mensajeros y volvé a intentarlo.",
    );
    // Lo que NO puede decir: el usuario no aplicó ningún filtro que ajustar.
    expect(aviso).not.toContain(CULPA_A_LOS_FILTROS);
    // Sigue sin producirse archivo: cambia el texto, no el comportamiento.
    expect(descargarBlobMock).not.toHaveBeenCalled();
  });

  it("con rango puesto, el aviso dice que es EL RANGO lo que no trae nada", async () => {
    const accion = accionVacia();
    montar(accion as unknown as ReturnType<typeof accionOk>);
    await userEvent.click(disparador());
    await screen.findByRole("dialog");

    // UN SOLO extremo, a propósito: «desde el 1 de julio» ya es un recorte, y con él el aviso
    // tiene que hablar del rango. Si la condición fuera «los dos extremos», este caso se pone
    // rojo — que es justo lo que se quiere vigilar.
    await ponerFecha("Desde", "2026-07-01");
    await userEvent.click(botonDescargar());

    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));
    expect(errorToastMock.mock.calls[0][0]).toBe(
      "No hay gestiones de cierre en el rango de fechas elegido para esos mensajeros. Ampliá el rango o vaciá las fechas y volvé a intentarlo.",
    );

    // Y con los dos extremos, el mismo aviso.
    await ponerFecha("Hasta", "2026-07-31");
    await userEvent.click(botonDescargar());
    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(2));
    expect(errorToastMock.mock.calls[1][0]).toBe(errorToastMock.mock.calls[0][0]);
    expect(descargarBlobMock).not.toHaveBeenCalled();
  });

  // ⚠️ D12/R38 NO se debilita con el aviso propio. La rama nueva mira las fechas que puso el
  // USUARIO —estado del cliente— y jamás la respuesta del servidor, así que dos mensajeros con
  // respuestas idénticas (`{ ok, items: [] }`) siguen produciendo el MISMO texto: distinguirlos
  // filtraría quién está y quién no está en el alcance del actor.
  it("dos mensajeros distintos con cero filas producen el mismo aviso (D12/R38)", async () => {
    const accion = accionVacia();
    montar(accion as unknown as ReturnType<typeof accionOk>);
    await userEvent.click(disparador());
    await screen.findByRole("checkbox", { name: "Ana Mensajera" });

    await elegirSolo("Ana Mensajera");
    await userEvent.click(botonDescargar());
    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));

    // Ahora solo Beto: el servidor responde lo mismo, así que la pantalla no puede decir otra cosa.
    await userEvent.click(checkbox("Ana Mensajera"));
    await userEvent.click(checkbox("Beto Mensajero"));
    await userEvent.click(botonDescargar());
    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(2));

    expect(accion.mock.calls[0][0].mensajeroIds).toEqual([ANA]);
    expect(accion.mock.calls[1][0].mensajeroIds).toEqual([BETO]);
    expect(errorToastMock.mock.calls[1][0]).toBe(errorToastMock.mock.calls[0][0]);
    expect(descargarBlobMock).not.toHaveBeenCalled();
  });
});
