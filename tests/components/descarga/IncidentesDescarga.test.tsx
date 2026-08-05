// @vitest-environment jsdom
// Feature 170 (T E.6) — descarga de las DOS tablas de la cola de incidentes: pendientes de
// decisión e histórico de resueltos. Cubre R1, R8, R11, R14, R20, R22, R30 y R32.
//
// El dato caliente aquí es `evidenciaUrls`: un incidente llega con URL FIRMADAS de sus fotos.
// La tabla no las muestra (se ven en el detalle) y el archivo tampoco puede llevarlas — un
// `xlsx` reenviado por correo con una URL firmada dentro es acceso a la foto sin sesión.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows, XLSX_MIME } from "@/lib/utils/xlsx-template";
import type { IncidenteAdminDTO } from "@/lib/interfaces/services/IIncidenteAdminService";
import {
  listarIncidentes,
  listarHistoricoIncidentesPaginado,
  listarPendientesIncidentesCompleto,
  listarPendientesIncidentesPaginado,
} from "@/lib/actions/incidentes";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";

vi.mock("@/lib/actions/incidentes", () => ({
  aprobarIncidente: vi.fn(),
  rechazarIncidente: vi.fn(),
  retractarIncidente: vi.fn(),
  verIncidente: vi.fn(),
  listarIncidentes: vi.fn(),
  // Feature 170 — FASE 2 (T I.2): el histórico llega paginado del servidor.
  listarHistoricoIncidentesPaginado: vi.fn(),
  // Feature 170 — FASE 2 (T J.2): la COLA de pendientes también.
  listarPendientesIncidentesPaginado: vi.fn(),
  // Feature 184 — Tanda F (T F.3): la lectura DEDICADA de la COLA de incidentes. El doble de
  // `listarIncidentes` se conserva A PROPÓSITO —y programado con las DOS mitades, cola e
  // histórico— porque es el listado compuesto del que salían los dos archivos de esta
  // pantalla: sin él, «ya no se relee» no sería una decisión de la pantalla, sería que el
  // doble no responde.
  listarPendientesIncidentesCompleto: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
  return { ...actual, buildXlsxRows: vi.fn(async () => new ArrayBuffer(8)) };
});
const buildXlsxRowsMock = vi.mocked(buildXlsxRows);

// Feature 184 — Tanda F (T F.3, R7): el toast de error se HOISTEA para poder leer su mensaje.
// La factoría anterior devolvía un `vi.fn()` nuevo en cada render, así que no había forma de
// afirmar qué se le dijo al usuario cuando la lectura del conjunto falla.
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

import { IncidentesAdminModule } from "@/app/(app)/incidentes/_components/IncidentesAdminModule";

/** URL FIRMADA de evidencia: lo que NO puede acabar en el archivo (R22). */
const EVIDENCIA_FIRMADA =
  "https://storage.example/storage/v1/evidencias/incidente.jpg?token=secreto";

function incidente(
  over: Partial<IncidenteAdminDTO> & { incidenteId: string },
): IncidenteAdminDTO {
  return {
    ordenId: `o-${over.incidenteId}`,
    numGuia: 1001,
    numRemision: `REM-${over.incidenteId}`,
    destinatario: "Ana Pérez",
    zonaNombre: "Limón",
    estatusValue: "incidente",
    causa: "robado",
    motivo: "Robo en la parada",
    estado: "solicitado",
    indemnizacion: null,
    reportadoPorNombre: "Beto Mensajero",
    resueltoPorNombre: null,
    resueltoAt: null,
    motivoRechazo: null,
    createdAt: "2026-07-11T10:00:00.000Z",
    evidenciaUrls: [EVIDENCIA_FIRMADA],
    esPropio: false,
    ...over,
  };
}

const PENDIENTES = [
  incidente({ incidenteId: "i1" }),
  incidente({ incidenteId: "i2", causa: "danado", destinatario: "Beto Cliente" }),
];
const HISTORICO = [
  incidente({
    incidenteId: "i3",
    estado: "aprobado",
    causa: "perdido",
    indemnizacion: "2500.10",
    resueltoPorNombre: "Maestra Ordenex",
    resueltoAt: "2026-07-12T10:00:00.000Z",
  }),
  incidente({
    incidenteId: "i4",
    estado: "rechazado",
    resueltoPorNombre: "Maestra Ordenex",
    resueltoAt: "2026-07-13T10:00:00.000Z",
    motivoRechazo: "No procede",
  }),
];

function envolver(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

/**
 * Feature 170 — FASE 2 (T I.2 el histórico, T J.2 la cola): las DOS tablas se pintan desde su
 * PÁGINA, y las dos descargas RELEEN el conjunto completo del servidor (R52). El helper
 * programa las tres lecturas con los mismos datos: las dos páginas que se ven y el listado
 * compuesto del que sale lo que se descarga.
 */
function renderIncidentes(
  pendientes = PENDIENTES,
  historico = HISTORICO,
  historicoCompleto = historico,
) {
  const cola = paginaInicial(pendientes);
  const pagina = paginaInicial(historico, { total: historicoCompleto.length });
  vi.mocked(listarPendientesIncidentesPaginado).mockResolvedValue({
    status: "ok",
    page: 1,
    ...cola,
  });
  vi.mocked(listarHistoricoIncidentesPaginado).mockResolvedValue({
    status: "ok",
    page: 1,
    ...pagina,
  });
  // Feature 184 — Tanda F (T F.3): de aquí sale el archivo de la COLA — SU mitad del alcance,
  // sin recorte y con la forma que `filasDesdeResultado` traduce (`ListarCompletoResult`).
  vi.mocked(listarPendientesIncidentesCompleto).mockResolvedValue({
    status: "ok",
    items: pendientes,
    total: pendientes.length,
  });
  // El listado COMPUESTO sigue programado, y con las DOS mitades dentro: es lo que hace que «no
  // se relee» sea observable (si la pantalla lo llamara, respondería).
  vi.mocked(listarIncidentes).mockResolvedValue({
    status: "ok",
    pendientes,
    historico: historicoCompleto,
    sinZona: false,
  });
  return envolver(
    <IncidentesAdminModule pendientes={cola} historico={pagina} sinZona={false} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
});

afterEach(() => {
  cleanup();
});

describe("Incidentes · descarga", () => {
  it("las dos tablas ofrecen su control, con nombres accesibles distintos", async () => {
    // R1/R13: las dos viven en la MISMA pantalla, así que sus controles no pueden llamarse
    // igual. Y no se llaman como los encabezados ("Pendientes de decisión" / "Histórico"),
    // que son genéricos: el archivo tiene que decir de qué es.
    renderIncidentes();

    expect(
      screen.getByRole("button", { name: "Descargar Incidentes pendientes" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Descargar Incidentes resueltos" }),
    ).toBeInTheDocument();
  });

  it("cada archivo trae SU tabla entera, en el orden de la pantalla", async () => {
    // R11: el archivo trae la tabla ENTERA, en el orden de la pantalla. Feature 170 — FASE 2
    // (T I.2/T J.2): las dos tablas paginan, así que el conjunto se RELEE del servidor
    // (`listarIncidentes`) en vez de proyectarse de lo que se ve (R52).
    const user = userEvent.setup();
    renderIncidentes();

    const tabla = screen.getByRole("table", { name: "Pendientes de decisión" });
    expect(within(tabla).getAllByRole("row")).toHaveLength(PENDIENTES.length + 1);

    await user.click(screen.getByRole("button", { name: "Descargar Incidentes pendientes" }));
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    const [, filas, titulo] = buildXlsxRowsMock.mock.calls[0];
    expect(filas).toHaveLength(PENDIENTES.length);
    expect(filas.map((f) => f.numRemision)).toEqual(PENDIENTES.map((i) => i.numRemision));
    expect(titulo).toBe("Incidentes pendientes");

    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));
    const [, mime, nombreArchivo] = descargarBlobMock.mock.calls[0];
    expect(mime).toBe(XLSX_MIME);
    expect(nombreArchivo).toMatch(/^incidentes-pendientes-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it("estados y causas salen como etiqueta legible, nunca el slug del enum", async () => {
    // R8. Un archivo que dijera `perdido` o `rechazado` obligaría a traducir a mano lo que
    // la pantalla ya traduce. Y la indemnización viaja money-safe: STRING tal cual.
    const user = userEvent.setup();
    renderIncidentes();

    await user.click(screen.getByRole("button", { name: "Descargar Incidentes resueltos" }));
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas[0].estado).toBe("Aprobado");
    expect(filas[0].causa).toBe("Paquete perdido");
    expect(filas[0].indemnizacion).toBe("2500.10");
    expect(String(filas[0].indemnizacion)).not.toContain("₡");
    // Un rechazado no tiene monto: celda VACÍA, que NO es lo mismo que un cero.
    expect(filas[1].estado).toBe("Rechazado");
    expect(filas[1].indemnizacion).toBeNull();
    expect(filas[1].motivo).toBe("No procede");
  });

  it("ninguna URL firmada ni ruta de almacenamiento llega al archivo", async () => {
    // R22: el DTO trae `evidenciaUrls` firmadas; ni la tabla ni el archivo las muestran.
    const user = userEvent.setup();
    renderIncidentes();

    for (const control of ["Incidentes pendientes", "Incidentes resueltos"]) {
      await user.click(screen.getByRole("button", { name: `Descargar ${control}` }));
      await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalled());

      const [, filas] = buildXlsxRowsMock.mock.calls.at(-1)!;
      for (const fila of filas) {
        for (const celda of Object.values(fila)) {
          const texto = String(celda ?? "");
          expect(texto, `${control}: celda con URL`).not.toMatch(/https?:\/\//i);
          expect(texto, `${control}: celda con ruta de almacén`).not.toMatch(
            /(^|\/)(storage|buckets?|evidencias?|uploads?)\//i,
          );
          expect(texto).not.toContain("token=");
        }
      }
    }
  });

  it("el archivo del adminSatelite solo trae los incidentes de su alcance", async () => {
    // R14/R20: el acotamiento por zona lo pone el SERVIDOR (el listado del adminSatelite solo
    // devuelve los suyos, esté paginado o no). Lo que se fija aquí es que la descarga no lo
    // amplía: el archivo es exactamente el conjunto que el servidor devolvió, ni una fila más.
    const user = userEvent.setup();
    const soloSuZona = [incidente({ incidenteId: "iz", zonaNombre: "Limón" })];
    renderIncidentes(soloSuZona, []);

    await user.click(screen.getByRole("button", { name: "Descargar Incidentes pendientes" }));
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas).toHaveLength(1);
    expect(filas[0].zona).toBe("Limón");
    expect(filas[0].numRemision).toBe(soloSuZona[0].numRemision);
  });

  // -------------------------------------------------------------------------
  // Feature 184 — Tanda F (T F.3): «Incidentes pendientes de decisión» (listado 8)
  // -------------------------------------------------------------------------

  it("el archivo de la cola de incidentes sale de su lectura DEDICADA, no del listado compuesto (R1/R8)", async () => {
    // Las tres mitades, como en las tandas B, C, D y E:
    //
    //   (a) montar la pantalla NO ejecuta la lectura del conjunto (R8);
    //   (b) al pulsar se llama a `listarPendientesIncidentesCompleto` UNA vez y SIN un solo
    //       argumento: este listado no tiene filtros, así que ni `page`, ni `pageSize`, ni
    //       `zonaId` —la única cuya aceptación convertiría el archivo de un `adminSatelite` en
    //       el de la zona vecina— pueden viajar (R3/R4/R17);
    //   (c) y NO se relee `listarIncidentes`, el listado COMPUESTO de esta pantalla.
    const user = userEvent.setup();
    renderIncidentes();

    expect(listarPendientesIncidentesCompleto).not.toHaveBeenCalled();
    expect(listarIncidentes).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Descargar Incidentes pendientes" }));
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    expect(listarPendientesIncidentesCompleto).toHaveBeenCalledTimes(1);
    expect(vi.mocked(listarPendientesIncidentesCompleto).mock.calls[0]).toEqual([]);
    expect(listarIncidentes).not.toHaveBeenCalled();
    // Y sigue sin pedir páginas: descargar por partes lo que se entrega entero es la otra forma
    // de degradar el archivo.
    expect(listarPendientesIncidentesPaginado).toHaveBeenCalledTimes(1);
  });

  it("descargar los incidentes pendientes ya no arrastra el HISTÓRICO: el compuesto trae las dos mitades y ya no se pide (R1)", async () => {
    // LA propiedad de esta tanda, y la que el xlsx por sí solo NO puede distinguir. El listado
    // compuesto (`listarIncidentes`) devuelve la cola de pendientes de decisión Y el histórico
    // entero de incidentes resueltos del alcance; esta descarga se quedaba con una de las dos
    // mitades y pagaba las dos. Volver a ese camino y seleccionar `res.pendientes` produce
    // EXACTAMENTE las mismas filas, en el mismo orden: no hay ninguna celda que cambie. Lo
    // único que lo delata es contar las llamadas — por eso este `expect` no es decorado: si se
    // quita, la relectura puede volver sin que nada falle.
    //
    // Y aquí la asimetría pesa del lado feo: la cola son los incidentes sin decidir —un
    // puñado— y el histórico que arrastraba crece sin techo con los días.
    //
    // La mitad de SERVIDOR (que la lectura dedicada corta por estado en la base y no lee el
    // alcance entero) vive en `tests/unit/services/incidentes-completo.test.ts`.
    const user = userEvent.setup();
    renderIncidentes();

    await user.click(screen.getByRole("button", { name: "Descargar Incidentes pendientes" }));
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    expect(listarIncidentes).not.toHaveBeenCalled();

    // ANTI-VACUIDAD, en dos pasos, porque «cero llamadas» pasa igual con un doble muerto:
    //  1. la descarga SÍ ocurrió y produjo sus filas —el cero de arriba no es «no pasó nada»—;
    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas).toHaveLength(PENDIENTES.length);
    //  2. y el doble del compuesto está VIVO y trae LAS DOS MITADES: si la pantalla lo llamara,
    //     respondería con el histórico además de la cola. No llamarlo es una decisión de la
    //     pantalla, no del arnés.
    const compuesto = await listarIncidentes();
    expect(compuesto.status === "ok" && compuesto.pendientes).toHaveLength(PENDIENTES.length);
    expect(compuesto.status === "ok" && compuesto.historico).toHaveLength(HISTORICO.length);
  });

  it("la pantalla NO recorta ni reordena la cola de incidentes que devolvió el servidor (R2)", async () => {
    // El discriminador entre «el servidor entrega el conjunto» y «lo entrega Y la pantalla lo
    // vuelve a tocar», con los dos números separados a propósito:
    //
    //   · el doble devuelve TREINTA filas y la tabla pinta DOS, así que un archivo de 25 —el
    //     `pageSize` de este dominio— o de 2 se distingue del bueno (recorte). Con el fixture
    //     de dos filas a secas, recortar a la página entera no se vería: la página SERÍA el
    //     conjunto;
    //   · y las tres primeras van en un orden que NINGÚN orden de cliente reproduce: ni por
    //     fecha descendente (sería 19, 12, 11) ni ascendente (11, 12, 19) (reordenación). El
    //     campo por el que difieren es el que la fila de descarga PROYECTA (`createdAt` →
    //     `fecha`): con un campo idéntico en las treinta filas, un `sort` estable no movería
    //     nada y la mutación sobreviviría por un defecto del fixture, no del código.
    const user = userEvent.setup();
    renderIncidentes();

    const pendiente = (i: number, dia: string) =>
      incidente({
        incidenteId: `ip-${i}`,
        createdAt: `2026-07-${dia}T10:00:00.000Z`,
      });
    const relleno = Array.from({ length: 27 }, (_, i) => pendiente(100 + i, "15"));
    vi.mocked(listarPendientesIncidentesCompleto).mockResolvedValueOnce({
      status: "ok",
      items: [pendiente(1, "12"), pendiente(2, "19"), pendiente(3, "11"), ...relleno],
      total: 30,
    });

    await user.click(screen.getByRole("button", { name: "Descargar Incidentes pendientes" }));
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas, "el archivo trae la página, no el conjunto").toHaveLength(30);
    expect(filas.slice(0, 3).map((f) => f.fecha)).toEqual([
      "2026-07-12",
      "2026-07-19",
      "2026-07-11",
    ]);
  });

  it("un fallo de la lectura de la cola de incidentes no produce archivo y el mensaje no lleva datos personales (R7)", async () => {
    const user = userEvent.setup();
    renderIncidentes();
    vi.mocked(listarPendientesIncidentesCompleto).mockResolvedValueOnce({
      status: "forbidden",
    });

    await user.click(screen.getByRole("button", { name: "Descargar Incidentes pendientes" }));
    // Ancla POSITIVA: el aviso que SALE, no el archivo que no sale.
    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));

    const [mensaje] = errorToastMock.mock.calls[0] as [string];
    expect(mensaje).toMatch(/Vuelve a intentarlo/);
    // Accionable, y sin un solo dato del dominio: ni destinatario, ni quién reportó, ni zona,
    // ni el motivo del incidente, ni identificadores. Cada fila de esta cola nombra a una
    // persona y el paquete que perdió.
    for (const dato of ["Ana Pérez", "Beto Mensajero", "Limón", "Robo en la parada", "REM-i1"]) {
      expect(mensaje).not.toContain(dato);
    }
    expect(descargarBlobMock).not.toHaveBeenCalled();
    expect(buildXlsxRowsMock).not.toHaveBeenCalled();
  });
});
