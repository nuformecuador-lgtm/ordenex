// @vitest-environment jsdom
// Feature 170 (T B.4) — descarga de los tres listados de CONFIGURACIÓN (usuarios, plantillas
// de mensaje y API keys). Cubre R1, R3, R9, R12 y R13.
//
// Las tres son de FAMILIA A: lo que la tabla pinta es una PÁGINA. El riesgo que estos tests
// cierran no es que el botón exista, sino que el archivo traiga esa página en vez del
// conjunto entero —un `xlsx` de 20 filas cuando hay 300 es peor que no tener descarga,
// porque nadie sospecha— y que el cableado cuele `page`/`pageSize` en un schema `.strict()`,
// que devolvería `validation_error` en vez de un archivo.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows, XLSX_MIME } from "@/lib/utils/xlsx-template";
import { usuariosConfig } from "@/lib/config/usuarios";
import { plantillasConfig } from "@/lib/config/plantillas";
import { apiKeysConfig } from "@/lib/config/api-keys";
import { descargaConfig } from "@/lib/config/descarga";
import type { UsuarioListItemDTO } from "@/lib/types/usuario";
import type { PlantillaListItemDTO } from "@/lib/types/plantilla-mensaje";
import type { ApiKeyListItemDTO } from "@/lib/types/api-key";

const listarUsuariosMock = vi.fn();
const listarUsuariosCompletoMock = vi.fn();
vi.mock("@/lib/actions/usuarios", () => ({
  listarUsuarios: (...a: unknown[]) => listarUsuariosMock(...a),
  listarUsuariosCompleto: (...a: unknown[]) => listarUsuariosCompletoMock(...a),
  obtenerUsuario: vi.fn(),
  cambiarEstadoUsuario: vi.fn(),
}));

const listarPlantillasMock = vi.fn();
const listarPlantillasCompletoMock = vi.fn();
vi.mock("@/lib/actions/plantillas", () => ({
  listarPlantillas: (...a: unknown[]) => listarPlantillasMock(...a),
  listarPlantillasCompleto: (...a: unknown[]) => listarPlantillasCompletoMock(...a),
  cambiarEstadoPlantilla: vi.fn(),
  eliminarPlantilla: vi.fn(),
}));

const listarApiKeysMock = vi.fn();
const listarApiKeysCompletoMock = vi.fn();
vi.mock("@/lib/actions/api-keys", () => ({
  listarApiKeys: (...a: unknown[]) => listarApiKeysMock(...a),
  listarApiKeysCompleto: (...a: unknown[]) => listarApiKeysCompletoMock(...a),
}));

vi.mock("@/lib/actions/webhooks", () => ({ registrarWebhook: vi.fn() }));

// El aviso del tope se lee del `toast.error` (el control no pinta el mensaje en la tabla),
// igual que en `OrdenesDescarga.test.tsx` de la 151.
const toastErrorMock = vi.fn();
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: (...a: unknown[]) => toastErrorMock(...a),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

// Se aísla SOLO el codificador binario (exceljs): el despachador `construirDescarga` corre
// REAL, así que el MIME y el NOMBRE del archivo son los de producción (R12).
vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
  return { ...actual, buildXlsxRows: vi.fn(async () => new ArrayBuffer(8)) };
});
const buildXlsxRowsMock = vi.mocked(buildXlsxRows);

import { UsuariosModule } from "@/app/(app)/configuracion/_components/UsuariosModule";
import { PlantillasModule } from "@/app/(app)/configuracion/plantillas/_components/PlantillasModule";
import { ApiKeysModule } from "@/app/(app)/configuracion/api/_components/ApiKeysModule";

// --- Datos ---------------------------------------------------------------

function usuario(i: number): UsuarioListItemDTO {
  return {
    id: `u-${i}`,
    nombre: `Usuario ${i}`,
    email: `usuario${i}@ordenex.test`,
    rolValue: "mensajero",
    estado: i % 2 === 0 ? "inactivo" : "activo",
    createdAt: new Date("2026-07-01T10:00:00Z"),
  } as UsuarioListItemDTO;
}

function plantilla(i: number): PlantillaListItemDTO {
  return {
    id: `p-${i}`,
    nombre: `Plantilla ${i}`,
    cuerpo: `Cuerpo de la plantilla ${i}`,
    estado: "aprobada",
    templateId: `meta-${i}`,
    variables: [],
    createdAt: new Date("2026-07-01T10:00:00Z"),
  } as unknown as PlantillaListItemDTO;
}

function apiKey(i: number): ApiKeyListItemDTO {
  return {
    id: `k-${i}`,
    identificador: `tienda-${i}`,
    keyPrefix: `ok_live_${i}`,
    usuarioId: `u-${i}`,
    usuarioEmail: `api${i}@ordenex.test`,
    estado: "activa",
    createdAt: new Date("2026-07-01T10:00:00Z"),
  } as unknown as ApiKeyListItemDTO;
}

const USUARIOS_PAGINA = [usuario(1), usuario(2)];
const USUARIOS_TODOS = Array.from({ length: 5 }, (_, i) => usuario(i + 1));
const PLANTILLAS_PAGINA = [plantilla(1)];
const PLANTILLAS_TODAS = Array.from({ length: 4 }, (_, i) => plantilla(i + 1));
const API_KEYS_PAGINA = [apiKey(1)];
const API_KEYS_TODAS = Array.from({ length: 3 }, (_, i) => apiKey(i + 1));

function envolver(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

function renderUsuarios() {
  return envolver(
    <UsuariosModule
      initialData={{
        items: USUARIOS_PAGINA,
        total: 42,
        pageSize: usuariosConfig.DEFAULT_PAGE_SIZE,
      }}
    />,
  );
}

function renderPlantillas() {
  return envolver(
    <PlantillasModule
      initialData={{
        items: PLANTILLAS_PAGINA,
        total: 30,
        pageSize: plantillasConfig.DEFAULT_PAGE_SIZE,
      }}
    />,
  );
}

function renderApiKeys() {
  return envolver(
    <ApiKeysModule
      initialData={{
        items: API_KEYS_PAGINA,
        total: 25,
        pageSize: apiKeysConfig.DEFAULT_PAGE_SIZE,
      }}
    />,
  );
}

/** Los tres listados, con su render, su título y su acción del dataset completo. */
const LISTADOS = [
  {
    titulo: "Usuarios",
    slug: "usuarios",
    montar: renderUsuarios,
    completo: listarUsuariosCompletoMock,
    paginado: listarUsuariosMock,
    pageSize: usuariosConfig.DEFAULT_PAGE_SIZE,
    todos: USUARIOS_TODOS,
    // Una columna que la tabla enseña, para comprobar que el archivo la lleva.
    encabezado: "Email",
  },
  {
    titulo: "Plantillas de mensaje",
    slug: "plantillas-de-mensaje",
    montar: renderPlantillas,
    completo: listarPlantillasCompletoMock,
    paginado: listarPlantillasMock,
    pageSize: plantillasConfig.DEFAULT_PAGE_SIZE,
    todos: PLANTILLAS_TODAS,
    encabezado: "Cuerpo",
  },
  {
    titulo: "API keys",
    slug: "api-keys",
    montar: renderApiKeys,
    completo: listarApiKeysCompletoMock,
    paginado: listarApiKeysMock,
    pageSize: apiKeysConfig.DEFAULT_PAGE_SIZE,
    todos: API_KEYS_TODAS,
    encabezado: "Identificador",
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  listarUsuariosMock.mockResolvedValue({
    status: "ok",
    items: USUARIOS_PAGINA,
    page: 1,
    pageSize: usuariosConfig.DEFAULT_PAGE_SIZE,
    total: 42,
  });
  listarPlantillasMock.mockResolvedValue({
    status: "ok",
    items: PLANTILLAS_PAGINA,
    page: 1,
    pageSize: plantillasConfig.DEFAULT_PAGE_SIZE,
    total: 30,
  });
  listarApiKeysMock.mockResolvedValue({
    status: "ok",
    items: API_KEYS_PAGINA,
    page: 1,
    pageSize: apiKeysConfig.DEFAULT_PAGE_SIZE,
    total: 25,
  });
  listarUsuariosCompletoMock.mockResolvedValue({
    status: "ok",
    items: USUARIOS_TODOS,
    total: USUARIOS_TODOS.length,
  });
  listarPlantillasCompletoMock.mockResolvedValue({
    status: "ok",
    items: PLANTILLAS_TODAS,
    total: PLANTILLAS_TODAS.length,
  });
  listarApiKeysCompletoMock.mockResolvedValue({
    status: "ok",
    items: API_KEYS_TODAS,
    total: API_KEYS_TODAS.length,
  });
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
});

afterEach(() => {
  cleanup();
});

describe("Configuración · descarga de los tres listados", () => {
  it("los tres ofrecen su control con nombre accesible", async () => {
    // R1/R13: el nombre del control identifica QUÉ se descarga. Si los tres se llamaran
    // "Descargar", en una pantalla con dos tablas nadie sabría cuál pulsa.
    for (const listado of LISTADOS) {
      listado.montar();
      expect(
        screen.getByRole("button", { name: `Descargar ${listado.titulo}` }),
        `${listado.titulo} sin control`,
      ).toBeInTheDocument();
      cleanup();
    }
  });

  it("el archivo trae TODAS las filas, no solo la página visible", async () => {
    // R9. Es el corazón de la Familia A: la tabla pinta `pageSize` filas de un total mayor;
    // el archivo tiene que traer el conjunto entero que devuelve la acción del modo completo.
    for (const listado of LISTADOS) {
      const user = userEvent.setup();
      listado.montar();

      const tabla = screen.getByRole("table", { name: listado.titulo });
      const filasEnPantalla = within(tabla).getAllByRole("row").length - 1;
      expect(filasEnPantalla).toBeLessThan(listado.todos.length);

      await user.click(screen.getByRole("button", { name: `Descargar ${listado.titulo}` }));
      await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

      const [columnas, filas, titulo] = buildXlsxRowsMock.mock.calls[0];
      expect(filas, `${listado.titulo}: nº de filas del archivo`).toHaveLength(
        listado.todos.length,
      );
      expect(columnas.map((c) => c.header)).toContain(listado.encabezado);
      expect(titulo).toBe(listado.titulo);

      // R18: al modo completo NO se le manda paginación (su schema es `.strict()`).
      expect(listado.completo).toHaveBeenCalledTimes(1);
      const input = listado.completo.mock.calls[0][0] as Record<string, unknown>;
      expect(Object.keys(input)).not.toContain("page");
      expect(Object.keys(input)).not.toContain("pageSize");

      cleanup();
      vi.clearAllMocks();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
      listado.completo.mockResolvedValue({
        status: "ok",
        items: listado.todos,
        total: listado.todos.length,
      });
    }
  });

  it("el nombre del archivo identifica el listado y la fecha", async () => {
    // R12: `<slug del listado>-YYYY-MM-DD.xlsx`, y con el MIME de xlsx (R34).
    for (const listado of LISTADOS) {
      const user = userEvent.setup();
      listado.montar();

      await user.click(screen.getByRole("button", { name: `Descargar ${listado.titulo}` }));
      await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

      const [, mime, nombreArchivo] = descargarBlobMock.mock.calls[0];
      expect(mime).toBe(XLSX_MIME);
      expect(nombreArchivo).toMatch(
        new RegExp(`^${listado.slug}-\\d{4}-\\d{2}-\\d{2}\\.xlsx$`),
      );

      cleanup();
      vi.clearAllMocks();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
      listado.completo.mockResolvedValue({
        status: "ok",
        items: listado.todos,
        total: listado.todos.length,
      });
    }
  });

  it("con el tope superado no se produce archivo y el aviso dice total y tope", async () => {
    // R26/R27/R28: el servicio devuelve `limite_excedido` y NO items. Lo que no puede pasar
    // es que se genere un xlsx igualmente (truncado o vacío): sin archivo, con mensaje.
    const user = userEvent.setup();
    const total = descargaConfig.MAX_FILAS + 7;
    listarUsuariosCompletoMock.mockResolvedValue({
      status: "limite_excedido",
      total,
      limite: descargaConfig.MAX_FILAS,
    });
    renderUsuarios();

    await user.click(screen.getByRole("button", { name: "Descargar Usuarios" }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
    const mensaje = String(toastErrorMock.mock.calls[0][0]);
    expect(mensaje).toContain(String(total));
    expect(mensaje).toContain(String(descargaConfig.MAX_FILAS));
    expect(mensaje).toMatch(/acota los filtros/i);
    // Sin archivo: ni generación ni entrega. Un xlsx truncado en silencio sería peor.
    expect(buildXlsxRowsMock).not.toHaveBeenCalled();
    expect(descargarBlobMock).not.toHaveBeenCalled();
  });

  it("los tres listados siguen comportándose igual: misma consulta paginada y sin lecturas de más", async () => {
    // R3/R32: montar el control no cambia el listado. La primera consulta es la de siempre
    // y la acción del modo completo NO se llama hasta que alguien pulsa el botón.
    for (const listado of LISTADOS) {
      listado.montar();

      await waitFor(() => expect(listado.paginado).toHaveBeenCalled());
      expect(listado.paginado.mock.calls[0][0]).toEqual({
        page: 1,
        pageSize: listado.pageSize,
      });
      expect(listado.completo).not.toHaveBeenCalled();
      expect(screen.getByRole("table", { name: listado.titulo })).toBeInTheDocument();

      cleanup();
      vi.clearAllMocks();
      listado.paginado.mockResolvedValue({
        status: "ok",
        items: [],
        page: 1,
        pageSize: listado.pageSize,
        total: 0,
      });
    }
  });
});
