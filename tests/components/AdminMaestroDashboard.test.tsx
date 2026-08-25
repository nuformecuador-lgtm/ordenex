// @vitest-environment jsdom
// Feature 253 (T7.3) — el dashboard del maestro con SUS DOS paneles. Cubre R36 (ningún texto de
// la pantalla afirma algo que dejó de ser cierto al añadir el panel) y el montaje del panel nuevo.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { SWRConfig } from "swr";

import { AdminMaestroDashboard } from "@/app/(app)/_components/AdminMaestroDashboard";
import { listarPostulacionesPendientes } from "@/lib/actions/aprobacion-postulaciones";
import { listarPostulacionesRecurso } from "@/lib/actions/atencion-postulaciones-recurso";
import type {
  DocumentoFirmadoDTO,
  PostulacionPendienteDTO,
} from "@/lib/types/aprobacion-postulacion";
import type { PostulacionRecursoDTO } from "@/lib/types/postulacion-recurso";

vi.mock("@/lib/actions/aprobacion-postulaciones", () => ({
  listarPostulacionesPendientes: vi.fn(),
  aprobarPostulacion: vi.fn(),
  rechazarPostulacion: vi.fn(),
}));

vi.mock("@/lib/actions/atencion-postulaciones-recurso", () => ({
  listarPostulacionesRecurso: vi.fn(),
  marcarPostulacionRecursoAtendida: vi.fn(),
}));

// El shell (`AppPage` -> `PageHeader`) monta el botón de salir, que llama a `useRouter`: sin
// router montado el árbol entero revienta. Mismo doble que usa `HomePageMaestro.test.tsx`.
vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-button-stub">Salir</button>,
}));

// La campana del `PageHeader` consulta notificaciones vía Server Action, que aquí no tiene
// request scope. Se dobla para que el ruido de OTRA feature no se mezcle con lo que este archivo
// mide; la campana tiene su propia suite (146).
vi.mock("@/hooks/useNotificaciones", () => ({
  useNotificaciones: () => ({
    items: [],
    noLeidas: 0,
    isLoading: false,
    error: undefined,
    refrescar: vi.fn(),
    marcarLeidas: vi.fn(),
  }),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const listarMensajerosMock = vi.mocked(listarPostulacionesPendientes);
const listarRecursosMock = vi.mocked(listarPostulacionesRecurso);

/** La descripción de la página HASTA esta ficha. Con dos paneles pasó a ser falsa en pequeño. */
const DESCRIPCION_VIEJA = "Postulaciones de mensajeros pendientes";

function renderDashboard(): void {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AdminMaestroDashboard />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listarMensajerosMock.mockResolvedValue({
    status: "ok",
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
  });
  listarRecursosMock.mockResolvedValue({
    status: "ok",
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
  });
});

afterEach(() => {
  cleanup();
});

describe("253/R36 — la descripción de la página dice la verdad con DOS paneles", () => {
  it("ya no se describe la pantalla entera como «Postulaciones de mensajeros pendientes»", async () => {
    renderDashboard();
    // Se espera a que los dos paneles asienten antes de mirar: si no, las actualizaciones de SWR
    // caen fuera de `act` y el ruido tapa lo que este caso mide.
    await screen.findByText("No hay postulaciones pendientes");
    await screen.findByText("No hay vehículos ni bodegas por revisar");

    expect(
      screen.getByRole("heading", { level: 1, name: "Panel maestro" }),
    ).toBeInTheDocument();
    // Un texto que dejó de ser cierto es exactamente el defecto que esta ficha cierra una capa
    // más arriba; dejarlo habría sido arreglar el acuse y estrenar otra frase falsa.
    expect(screen.queryByText(DESCRIPCION_VIEJA)).toBeNull();
    expect(
      screen.getByText(
        "Postulaciones pendientes: mensajeros, y vehículos o bodegas ofrecidos desde la web",
      ),
    ).toBeInTheDocument();
  });

  it("los dos bloques están, cada uno con su título y su propio listado", async () => {
    renderDashboard();

    expect(screen.getByText("Postulaciones de mensajeros")).toBeInTheDocument();
    expect(screen.getByText("Vehículos y bodegas ofrecidos")).toBeInTheDocument();

    // Y cada panel consulta LO SUYO: el del recurso no se cuelga del listado del hermano.
    await screen.findByText("No hay postulaciones pendientes");
    expect(await screen.findByText("No hay vehículos ni bodegas por revisar")).toBeInTheDocument();
    // 281/R10 — QUÉ **NO** MIDE ESTA LÍNEA, medido el 2026-08-25 y escrito para que nadie la use
    // como prueba de «el panel se monta una vez». Con el montaje duplicado presente este caso
    // moría ANTES, en el `findByText` de arriba, así que la sensibilidad de este contador al doble
    // montaje NO llegó a medirse: SWR deduplica por clave y podría estar en 1 con dos montajes.
    // La medida de la cardinalidad de montajes es la de más abajo, por regiones del DOM
    // (`getAllByRole("region", …)`). Esta línea se conserva sin relajar: mide que cada panel
    // consulta LO SUYO, que es otra cosa.
    expect(listarMensajerosMock).toHaveBeenCalledTimes(1);
    expect(listarRecursosMock).toHaveBeenCalledTimes(1);
  });
});

// -------------------------------------------------------------------------------------------------
// Feature 281 — LA CUENTA. Hasta el 2026-08-25 este dashboard montaba
// `<PostulacionesPendientesPanel />` DOS veces: una suelta, fuera de todo `ContenedorSeccion`, y
// otra dentro del bloque titulado. Efecto visible: TRES tarjetas de «no hay» en la pantalla vacía,
// la de arriba sin título; y con datos, la lista entera duplicada.
//
// Estos casos cuentan de forma BILATERAL, que es la única que sirve:
//   - `getAllByText(...)` LANZA si el elemento sale CERO veces  → cubre el «de menos».
//   - `.toHaveLength(1)`  FALLA si sale DOS o más              → cubre el «de más».
// Queda prohibido aquí `queryAllByText` sin comparar longitud, `toBeTruthy()` y `length >= 1`:
// pasan igual con la pantalla rota, que es como el defecto llegó hasta producción.

const TEXTO_VACIO_MENSAJEROS = "No hay postulaciones pendientes";
const TEXTO_VACIO_RECURSOS = "No hay vehículos ni bodegas por revisar";
const ROTULO_MENSAJEROS = "Postulaciones de mensajeros";
const ROTULO_RECURSOS = "Vehículos y bodegas ofrecidos";

function documentosFirmados(): DocumentoFirmadoDTO[] {
  return [
    { tipo: "cedula_anverso", url: "https://s/ced-a", expiresInSeconds: 300 },
    { tipo: "cedula_reverso", url: "https://s/ced-r", expiresInSeconds: 300 },
    { tipo: "propiedad_anverso", url: "https://s/mat-a", expiresInSeconds: 300 },
    { tipo: "propiedad_reverso", url: "https://s/mat-r", expiresInSeconds: 300 },
    { tipo: "foto_rostro", url: "https://s/foto", expiresInSeconds: 300 },
  ];
}

/** Mismo patrón que `PostulacionesPendientesPanel.test.tsx`: rinde el texto «Nombre-u1 Ap». */
function postulacionMensajero(id: string): PostulacionPendienteDTO {
  return {
    usuarioId: id,
    nombre: `Nombre-${id}`,
    primerApellido: "Ap",
    segundoApellido: null,
    email: `${id}@example.com`,
    telefono: "0999999999",
    tipoIdentificacion: "cedula",
    cedula: "0102030405",
    vehiculo: "moto",
    placa: "ABC-1234",
    documentos: documentosFirmados(),
  };
}

function postulacionRecurso(id: string): PostulacionRecursoDTO {
  return {
    id,
    tipo: "vehiculo",
    nombre: `Persona-${id}`,
    telefono: "+506 8888-8888",
    correo: `${id}@example.com`,
    mensaje: `Mensaje de ${id}`,
    createdAt: "2026-08-20T15:30:00.000Z",
    atendidaAt: null,
    atendidaPor: null,
  };
}

describe("281/R4 — sin postulaciones, la pantalla muestra un aviso de vacío por sección y ni uno más", () => {
  it("hay exactamente un «no hay postulaciones pendientes» y exactamente un «no hay vehículos ni bodegas»", async () => {
    renderDashboard();
    await screen.findAllByText(TEXTO_VACIO_MENSAJEROS);
    await screen.findAllByText(TEXTO_VACIO_RECURSOS);

    // Esto es lo que el humano contó en la captura: había TRES tarjetas y sobraba una.
    expect(screen.getAllByText(TEXTO_VACIO_MENSAJEROS)).toHaveLength(1);
    expect(screen.getAllByText(TEXTO_VACIO_RECURSOS)).toHaveLength(1);
  });
});

describe("281/R6 — cada panel se monta una sola vez, haya datos o no", () => {
  // ESTA es la medida principal de la ficha, por encima de la de las tarjetas de vacío: no depende
  // del estado de los datos y ataca la CAUSA (el doble montaje) en vez del SÍNTOMA (la tarjeta
  // repetida). El conteo de arriba mide lo que se ve en la captura; éste mide lo que estaba mal.
  // Dos regiones con el mismo nombre accesible son, para un lector de pantalla, dos secciones
  // distintas rotuladas igual.
  it("con las dos listas vacías hay una sola región de cada panel", async () => {
    renderDashboard();
    await screen.findAllByText(TEXTO_VACIO_MENSAJEROS);

    expect(
      screen.getAllByRole("region", { name: "Postulaciones pendientes" }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("region", { name: ROTULO_RECURSOS }),
    ).toHaveLength(1);
  });

  it("con postulaciones en las dos listas sigue habiendo una sola región de cada panel", async () => {
    listarMensajerosMock.mockResolvedValue({
      status: "ok",
      items: [postulacionMensajero("u1")],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    listarRecursosMock.mockResolvedValue({
      status: "ok",
      items: [postulacionRecurso("r1")],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    renderDashboard();
    await screen.findAllByText("Nombre-u1 Ap");

    expect(
      screen.getAllByRole("region", { name: "Postulaciones pendientes" }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("region", { name: ROTULO_RECURSOS }),
    ).toHaveLength(1);
  });
});

describe("281/R5 — ningún panel cuelga suelto: cada uno vive dentro de su sección con título", () => {
  // LÍMITE DECLARADO de este caso: la tarjeta se localiza por `[data-slot="card"]`, o sea por un
  // detalle de la primitiva de shadcn, no por un rol accesible. Es a propósito: `ContenedorSeccion`
  // NO emite `role="region"` deliberadamente (ver su docblock — los landmarks los declaran los
  // shells, y las guardias de analítica congelan cuántas regiones hay). Darle un landmark al
  // contenedor para poder consultarlo por rol rompería esas guardias y sería rediseñar el
  // componente para acomodar un test.
  it("la región de mensajeros tiene una tarjeta por ancestro y esa tarjeta lleva su rótulo", async () => {
    renderDashboard();
    await screen.findAllByText(TEXTO_VACIO_MENSAJEROS);

    const region = screen.getByRole("region", { name: "Postulaciones pendientes" });
    const tarjeta = region.closest('[data-slot="card"]');
    expect(tarjeta).not.toBeNull();
    expect(
      within(tarjeta as HTMLElement).getAllByText(ROTULO_MENSAJEROS),
    ).toHaveLength(1);
  });

  it("la región de vehículos y bodegas tiene una tarjeta por ancestro y esa tarjeta lleva su rótulo", async () => {
    renderDashboard();
    await screen.findAllByText(TEXTO_VACIO_RECURSOS);

    const region = screen.getByRole("region", { name: ROTULO_RECURSOS });
    const tarjeta = region.closest('[data-slot="card"]');
    expect(tarjeta).not.toBeNull();
    expect(
      within(tarjeta as HTMLElement).getAllByText(ROTULO_RECURSOS),
    ).toHaveLength(1);
  });
});

describe("281/R7 + R8 — con postulaciones no queda ningún aviso de vacío y nada sale repetido", () => {
  it("cada postulación aparece una sola vez, los rótulos siguen y el vacío desaparece", async () => {
    listarMensajerosMock.mockResolvedValue({
      status: "ok",
      items: [postulacionMensajero("u1")],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    listarRecursosMock.mockResolvedValue({
      status: "ok",
      items: [postulacionRecurso("r1")],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    renderDashboard();
    await screen.findAllByText("Nombre-u1 Ap");
    await screen.findAllByText("Persona-r1");

    // R8 — la fila repetida es el mismo defecto de la tarjeta repetida, visto con datos. Es el
    // motivo por el que esta ficha no se cierra sólo con la pantalla vacía.
    expect(screen.getAllByText("Nombre-u1 Ap")).toHaveLength(1);
    expect(screen.getAllByText("Persona-r1")).toHaveLength(1);

    // R7 — con datos, cero avisos de vacío; y los rótulos de sección siguen en su sitio.
    expect(screen.queryAllByText(TEXTO_VACIO_MENSAJEROS)).toHaveLength(0);
    expect(screen.queryAllByText(TEXTO_VACIO_RECURSOS)).toHaveLength(0);
    expect(screen.getAllByText(ROTULO_MENSAJEROS)).toHaveLength(1);
    expect(screen.getAllByText(ROTULO_RECURSOS)).toHaveLength(1);
  });
});
