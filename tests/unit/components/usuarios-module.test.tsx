// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { UsuarioListItemDTO } from "@/lib/types/usuario";
import type { UsuarioPublico } from "@/lib/interfaces/repositories/IUserRepository";

const listarUsuariosMock = vi.fn();
// Feature 285 (T-C7): la descarga viaja CON los filtros del render. El doble va aqui para
// que el modulo pueda importarla; sin el, el control quedaria cableado a `undefined`.
const listarUsuariosCompletoMock = vi.fn();
const cambiarEstadoUsuarioMock = vi.fn();
const obtenerUsuarioMock = vi.fn();
const crearUsuarioMock = vi.fn();
const actualizarUsuarioMock = vi.fn();
const listarTiposIdentificacionMock = vi.fn();
const listarRolesMock = vi.fn();
// Feature 287 (T10): el modulo cablea la accion del restablecimiento. El doble va aqui para
// que el modulo pueda importarla; su comportamiento se prueba en `usuarios-restablecer.test.tsx`.
const restablecerContrasenaUsuarioMock = vi.fn();
vi.mock("@/lib/actions/usuarios", () => ({
  listarUsuarios: (...a: unknown[]) => listarUsuariosMock(...a),
  listarUsuariosCompleto: (...a: unknown[]) => listarUsuariosCompletoMock(...a),
  cambiarEstadoUsuario: (...a: unknown[]) => cambiarEstadoUsuarioMock(...a),
  obtenerUsuario: (...a: unknown[]) => obtenerUsuarioMock(...a),
  crearUsuario: (...a: unknown[]) => crearUsuarioMock(...a),
  actualizarUsuario: (...a: unknown[]) => actualizarUsuarioMock(...a),
  listarTiposIdentificacion: (...a: unknown[]) =>
    listarTiposIdentificacionMock(...a),
  listarRoles: (...a: unknown[]) => listarRolesMock(...a),
  restablecerContrasenaUsuario: (...a: unknown[]) =>
    restablecerContrasenaUsuarioMock(...a),
}));

// Feature 285 (T-C7): se aisla SOLO lo binario de la descarga —el codificador xlsx y la
// entrega del blob—, porque lo que se mide es QUE ENTRADA recibe la Server Action, no el
// archivo. El despachador corre real.
vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
  return { ...actual, buildXlsxRows: vi.fn(async () => new ArrayBuffer(8)) };
});

import { UsuariosModule } from "@/app/(app)/configuracion/_components/UsuariosModule";
import { avisoMinimoCaracteres } from "@/components/shared/FilterComponent";
import {
  CLAVE_ROL,
  PLACEHOLDER_BUSQUEDA,
} from "@/app/(app)/configuracion/_components/usuarios-filtros-def";
import { USUARIO_BUSQUEDA_MIN_CHARS } from "@/lib/types/usuario";

const ITEM: UsuarioListItemDTO = {
  id: "u1",
  nombre: "Ana Pérez",
  email: "ana@example.com",
  rolValue: "mensajero",
  estado: "activo",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const USUARIO: UsuarioPublico = {
  id: "u1",
  nombre: "Ana Pérez",
  email: "ana@example.com",
  telefono: "0999999999",
  estado: "activo",
  cedula: "1712345678",
  tipoIdentificacionId: "t1",
  rolId: "rol-mensajero",
  fulfillment: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const INITIAL = { items: [ITEM], total: 1, pageSize: 25 };

function renderModule(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listarUsuariosMock.mockResolvedValue({
    status: "ok",
    items: [ITEM],
    page: 1,
    pageSize: 25,
    total: 1,
  });
  listarUsuariosCompletoMock.mockResolvedValue({
    status: "ok",
    items: [ITEM],
    total: 1,
  });
  listarTiposIdentificacionMock.mockResolvedValue({ status: "ok", tipos: [] });
  listarRolesMock.mockResolvedValue({
    status: "ok",
    roles: [{ id: "rol-mensajero", value: "mensajero" }],
  });
  obtenerUsuarioMock.mockResolvedValue({ status: "ok", usuario: USUARIO });
});

afterEach(() => {
  cleanup();
});

describe("UsuariosModule — listado y paginación (R26)", () => {
  it("lista en DataTable con paginación (R26)", async () => {
    renderModule(<UsuariosModule initialData={INITIAL} />);

    expect(screen.getByRole("table", { name: "Usuarios" })).toBeInTheDocument();
    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Paginación" }),
    ).toBeInTheDocument();
  });
});

describe("UsuariosModule — crear/editar en Modal (R27)", () => {
  it("el botón Crear abre el Modal async con el formulario", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(screen.getByRole("button", { name: "Crear usuario" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Crear usuario")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Guardar" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Nombre")).toBeInTheDocument();
  });

  it("Editar carga el usuario y abre el Modal en modo edición", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Editar" }));

    await waitFor(() => expect(obtenerUsuarioMock).toHaveBeenCalledWith("u1"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Editar usuario")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Email")).toBeDisabled();
  });
});

describe("UsuariosModule — activar/inactivar y feedback (R20/R21/R28)", () => {
  it("el botón Inactivar cambia el estado y muestra toast de éxito (R20/R28)", async () => {
    const user = userEvent.setup();
    cambiarEstadoUsuarioMock.mockResolvedValue({
      status: "ok",
      usuario: { ...USUARIO, estado: "inactivo" },
    });
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Inactivar" }));

    await waitFor(() =>
      expect(cambiarEstadoUsuarioMock).toHaveBeenCalledWith("u1", {
        estado: "inactivo",
      }),
    );
    expect(await screen.findByText("Usuario inactivado")).toBeInTheDocument();
  });

  it("un error del backend muestra toast de error (R28)", async () => {
    const user = userEvent.setup();
    cambiarEstadoUsuarioMock.mockResolvedValue({ status: "not_found" });
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Inactivar" }));

    expect(
      (await screen.findAllByText("El usuario no existe.")).length,
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Feature 285 / T4.5 (design §9.5) — T-C1…T-C8: la barra CABLEADA en la pantalla real.
//
// Lo que estos casos cierran no es que la barra exista, sino las tres trampas que el spec
// dejó señaladas: que el `fallbackData` del servidor pinte el listado SIN filtrar en el
// primer render filtrado (T-C4), que el vacío siga ofreciendo "crea el primero" bajo un
// filtro (T-C5), y que la descarga entregue un archivo que no es lo que la pantalla
// muestra (T-C7).
// ---------------------------------------------------------------------------

/** La barra emite con la espera de la casa (500 ms): las esperas deben sobrevivirla. */
const ESPERA = { timeout: 3000 };

/** El campo de búsqueda de la barra compartida. */
function buscador(): HTMLElement {
  return screen.getByRole("searchbox", { name: "Buscar" });
}

/** Entrada de la ÚLTIMA llamada a `listarUsuarios`. */
function ultimaEntrada(): Record<string, unknown> | undefined {
  return listarUsuariosMock.mock.calls.at(-1)?.[0] as
    | Record<string, unknown>
    | undefined;
}

/**
 * Espera a que la consulta de MONTAJE haya salido y devuelve cuántas van. SWR revalida al
 * montar aunque haya `fallbackData`, así que contar antes de esto daría una llamada de más
 * y "una sola consulta por ráfaga" se mediría contra un número que aún no era estable.
 */
async function llamadasTrasElMontaje(): Promise<number> {
  await waitFor(() => expect(listarUsuariosMock).toHaveBeenCalled());
  return listarUsuariosMock.mock.calls.length;
}

/**
 * El resumen de la paginación (`1-25 de 48` / `Sin resultados`). Es la ÚNICA superficie que
 * delata un `fallbackData` mal condicionado: mientras la consulta está en vuelo `DataTable`
 * pinta esqueletos —`isLoading` de SWR es `true` incluso habiendo `fallbackData`, medido—,
 * así que las FILAS no distinguen un caso del otro. El total sí: sale de `data?.total` y no
 * pasa por `isLoading`.
 */
function resumenPaginacion(): string {
  return (
    screen.getByRole("navigation", { name: "Paginación" }).querySelector("span")
      ?.textContent ?? ""
  );
}

/** Pide un filtro en el selector "Filtros" y cierra el panel. */
async function ponerFiltro(
  user: ReturnType<typeof userEvent.setup>,
  etiqueta: string,
) {
  await user.click(await screen.findByRole("button", { name: /^Filtros/ }));
  const selector = await screen.findByRole("listbox", { name: "Filtros" });
  await user.click(within(selector).getByRole("option", { name: etiqueta }));
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("listbox", { name: "Filtros" })).toBeNull(),
  );
}

/** Marca (o desmarca) una opción dentro de un filtro ya montado. */
async function marcar(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  opcion: string,
) {
  await user.click(screen.getByRole("button", { name: new RegExp(`^${label}:`) }));
  const lista = await screen.findByRole("listbox", { name: label });
  await user.click(within(lista).getByRole("option", { name: opcion }));
  await user.keyboard("{Escape}");
}

describe("UsuariosModule — barra compartida (T-C1, R28)", () => {
  it("T-C1/R28: monta el contenedor COMPARTIDO —campo de búsqueda + selector de filtros—, no controles propios", async () => {
    renderModule(<UsuariosModule initialData={INITIAL} />);

    // Un solo campo, con el nombre accesible y el placeholder que declara su alcance.
    const campo = await screen.findByRole("searchbox", { name: "Buscar" });
    expect(campo).toHaveAttribute("placeholder", PLACEHOLDER_BUSQUEDA);
    expect(screen.getAllByRole("searchbox", { name: "Buscar" })).toHaveLength(1);
    // Y el selector de filtros de la misma barra.
    expect(screen.getByRole("button", { name: /^Filtros/ })).toBeInTheDocument();
  });

  it("T-C1/R12: el selector ofrece el filtro de Rol, y pedirlo monta un control de selección MÚLTIPLE", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);
    await screen.findByRole("searchbox", { name: "Buscar" });

    // La barra nace con el buscador solo: el filtro se PIDE.
    expect(screen.queryByRole("button", { name: /^Rol:/ })).toBeNull();
    await ponerFiltro(user, "Rol");

    await user.click(await screen.findByRole("button", { name: /^Rol:/ }));
    const lista = await screen.findByRole("listbox", { name: "Rol" });
    expect(lista).toHaveAttribute("aria-multiselectable");
    // Las seis etiquetas legibles, no los valores del enum.
    for (const etiqueta of [
      "Maestro",
      "Administrador",
      "Mensajero",
      "Admin de tienda",
      "Admin satélite",
      "API key",
    ]) {
      expect(
        within(lista).getByRole("option", { name: etiqueta }),
      ).toBeInTheDocument();
    }
  });
});

describe("UsuariosModule — el filtro llega a `listarUsuarios` (T-C2, R10/R13)", () => {
  it("T-C2/R10: una ráfaga de pulsaciones dispara UNA sola consulta, con `q`", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);
    await screen.findByRole("searchbox", { name: "Buscar" });
    const previas = await llamadasTrasElMontaje();

    await user.type(buscador(), "ana rojas");

    await waitFor(
      () => expect(ultimaEntrada()).toEqual({ page: 1, pageSize: 25, q: "ana rojas" }),
      ESPERA,
    );
    // Nueve pulsaciones = UNA consulta nueva. Sin el debounce serían nueve.
    expect(listarUsuariosMock.mock.calls.length).toBe(previas + 1);
  });

  it("T-C2/R13: los roles marcados viajan como lista de VALORES del enum, junto al término", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);
    await ponerFiltro(user, "Rol");

    await marcar(user, "Rol", "Mensajero");
    await waitFor(
      () =>
        expect(ultimaEntrada()).toEqual({
          page: 1,
          pageSize: 25,
          rol: ["mensajero"],
        }),
      ESPERA,
    );

    // Y se COMBINAN: el término no sustituye a los roles ni al revés (R16).
    await user.type(buscador(), "ana");
    await waitFor(
      () =>
        expect(ultimaEntrada()).toEqual({
          page: 1,
          pageSize: 25,
          rol: ["mensajero"],
          q: "ana",
        }),
      ESPERA,
    );
  });

  it("R15: desmarcar el último rol OMITE la clave; nunca viaja `rol: []`", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);
    await ponerFiltro(user, "Rol");

    await marcar(user, "Rol", "Mensajero");
    await waitFor(
      () => expect(ultimaEntrada()).toHaveProperty("rol", ["mensajero"]),
      ESPERA,
    );

    await marcar(user, "Rol", "Mensajero"); // desmarca

    await waitFor(
      () => expect(ultimaEntrada()).toEqual({ page: 1, pageSize: 25 }),
      ESPERA,
    );
    // La clave DESAPARECE. Una lista vacía sería `validation_error` en el borde, y un
    // repositorio que la descartara devolvería el listado ENTERO con un filtro puesto.
    expect(Object.keys(ultimaEntrada() ?? {})).not.toContain("rol");
  });

  it("R1: sin filtros, la entrada es EXACTAMENTE la de antes de esta feature", async () => {
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await waitFor(() =>
      expect(listarUsuariosMock).toHaveBeenCalledWith({ page: 1, pageSize: 25 }),
    );
    // Ni `q: ""` ni `rol: []` de relleno: el objeto no tiene esas claves.
    expect(Object.keys(ultimaEntrada() ?? {}).sort()).toEqual(["page", "pageSize"]);
  });
});

describe("UsuariosModule — vuelta a la página 1 (T-C3, R18)", () => {
  it("T-C3/R18: estando en la página 3, cambiar el filtro consulta la página 1", async () => {
    const user = userEvent.setup();
    listarUsuariosMock.mockResolvedValue({
      status: "ok",
      items: [ITEM],
      page: 1,
      pageSize: 25,
      // 75 filas de 25 = TRES páginas, y con tres la paginación pinta el botón de la 3
      // sin elipsis. Con cuatro páginas el control ofrece `1 2 … 4` y la 3 no existe
      // como botón: el caso no fallaría por el requisito, fallaría por no encontrarla.
      total: 75,
    });
    renderModule(
      <UsuariosModule initialData={{ items: [ITEM], total: 75, pageSize: 25 }} />,
    );
    await screen.findByText("Ana Pérez");

    await user.click(screen.getByRole("button", { name: "Ir a la página 3" }));
    await waitFor(
      () => expect(ultimaEntrada()).toEqual({ page: 3, pageSize: 25 }),
      ESPERA,
    );

    await user.type(buscador(), "ana");

    // Sin el reset se pediría la página 3 de un resultado que quizá tiene una sola:
    // la tabla saldría vacía y el usuario leería "ninguno coincide" siendo mentira.
    await waitFor(
      () => expect(ultimaEntrada()).toEqual({ page: 1, pageSize: 25, q: "ana" }),
      ESPERA,
    );
  });
});

describe("UsuariosModule — el `fallbackData` no puede pintar lo SIN FILTRAR (T-C4)", () => {
  it("T-C4: con un filtro puesto, el primer render NO usa el listado precargado por el servidor", async () => {
    const user = userEvent.setup();
    // La consulta filtrada queda EN VUELO: es el instante exacto del fallo. Con el
    // `fallbackData` de hoy (`page === 1 && pageSize === initialData.pageSize`), la
    // condición SIGUE siendo cierta al filtrar, así que SWR daría por buena la respuesta
    // SIN FILTRAR del servidor para una clave que es otra.
    let filtradaEnVuelo = false;
    listarUsuariosMock.mockImplementation((entrada: Record<string, unknown>) => {
      if (entrada.q === undefined && entrada.rol === undefined) {
        return Promise.resolve({
          status: "ok",
          items: [ITEM],
          page: 1,
          pageSize: 25,
          total: 1,
        });
      }
      filtradaEnVuelo = true;
      return new Promise(() => {});
    });

    renderModule(<UsuariosModule initialData={INITIAL} />);
    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
    expect(resumenPaginacion()).toBe("1-1 de 1");

    await user.type(buscador(), "zzz");
    await waitFor(() => expect(ultimaEntrada()).toHaveProperty("q", "zzz"), ESPERA);

    // El TOTAL del servidor ya no manda: la búsqueda de "zzz" no tiene todavía un total
    // propio, así que no se le presta el del listado completo. Se mide aquí y no en las
    // filas porque `isLoading` de SWR es `true` incluso habiendo `fallbackData` —medido—,
    // y `DataTable` pinta esqueletos en ese estado: las filas darían el mismo resultado
    // con el fallo y sin él, y el caso no probaría nada.
    await waitFor(() => expect(resumenPaginacion()).toBe("Sin resultados"), ESPERA);
    expect(filtradaEnVuelo).toBe(true);
  });

  it("sin filtros el `fallbackData` SIGUE aplicando: la precarga del servidor no se pierde", async () => {
    // La otra mitad, para que arreglar T-C4 no se convierta en quitar el fallback a secas:
    // sin filtros, el total precargado se enseña sin esperar a la consulta.
    listarUsuariosMock.mockImplementation(() => new Promise(() => {}));
    renderModule(
      <UsuariosModule initialData={{ items: [ITEM], total: 42, pageSize: 25 }} />,
    );

    expect(resumenPaginacion()).toBe("1-25 de 42");
  });
});

describe("UsuariosModule — el vacío no puede mentir (T-C5, R20)", () => {
  it("T-C5/R20: con filtros y cero filas dice que ninguno COINCIDE y no ofrece crear", async () => {
    const user = userEvent.setup();
    listarUsuariosMock.mockImplementation((entrada: Record<string, unknown>) => {
      const filtrada = entrada.q !== undefined || entrada.rol !== undefined;
      return Promise.resolve({
        status: "ok",
        items: filtrada ? [] : [ITEM],
        page: 1,
        pageSize: 25,
        total: filtrada ? 0 : 1,
      });
    });
    renderModule(<UsuariosModule initialData={INITIAL} />);
    await screen.findByRole("searchbox", { name: "Buscar" });

    await user.type(buscador(), "zzz");

    const tabla = screen.getByRole("table", { name: "Usuarios" });
    await waitFor(
      () =>
        expect(
          within(tabla).getByText("Ningún usuario coincide con los filtros"),
        ).toBeInTheDocument(),
      ESPERA,
    );
    // "Crea el primer usuario" es FALSO aquí: sí hay usuarios, y ofrecer crear una cuenta
    // a quien tiene una escondida detrás del filtro es el peor consejo posible.
    expect(within(tabla).queryByText(/Crea el primer usuario/)).toBeNull();
    expect(
      within(tabla).queryByRole("button", { name: "Crear usuario" }),
    ).toBeNull();
  });

  it("T-C5/R20: SIN filtros, el estado vacío sigue siendo el de hoy, con su CTA", async () => {
    listarUsuariosMock.mockResolvedValue({
      status: "ok",
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
    });
    renderModule(
      <UsuariosModule initialData={{ items: [], total: 0, pageSize: 25 }} />,
    );

    // `findBy`: mientras la revalidación de montaje está en vuelo la tabla pinta
    // esqueletos, y el estado vacío no se decide hasta que la respuesta llega.
    expect(await screen.findByText("No hay usuarios")).toBeInTheDocument();
    const tabla = screen.getByRole("table", { name: "Usuarios" });
    expect(
      within(tabla).getByText("Crea el primer usuario para dar acceso al sistema."),
    ).toBeInTheDocument();
    expect(
      within(tabla).getByRole("button", { name: "Crear usuario" }),
    ).toBeInTheDocument();
  });
});

describe("UsuariosModule — Limpiar todo (T-C6, R21)", () => {
  it("T-C6/R21: deja la barra como recién abierta y vuelve a pedir TODOS los usuarios", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);
    await ponerFiltro(user, "Rol");
    await marcar(user, "Rol", "Mensajero");
    await user.type(buscador(), "ana");
    await waitFor(
      () =>
        expect(ultimaEntrada()).toEqual({
          page: 1,
          pageSize: 25,
          rol: ["mensajero"],
          q: "ana",
        }),
      ESPERA,
    );

    await user.click(screen.getByRole("button", { name: "Limpiar todo" }));

    await waitFor(
      () => expect(ultimaEntrada()).toEqual({ page: 1, pageSize: 25 }),
      ESPERA,
    );
    // El campo vacío Y el control retirado de la barra: "limpiar todo" es volver al punto
    // de partida, no quedarse con un control vacío puesto.
    expect(buscador()).toHaveValue("");
    expect(screen.queryByRole("button", { name: /^Rol:/ })).toBeNull();
  });
});

describe("UsuariosModule — la descarga va acotada a los filtros (T-C7, R22/R23)", () => {
  it("T-C7/R22: con filtros activos, el dataset completo se pide CON `q` y `rol`", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);
    await ponerFiltro(user, "Rol");
    await marcar(user, "Rol", "Mensajero");
    await user.type(buscador(), "ana");
    await waitFor(() => expect(ultimaEntrada()).toHaveProperty("q", "ana"), ESPERA);

    await user.click(screen.getByRole("button", { name: "Descargar Usuarios" }));

    await waitFor(() => expect(listarUsuariosCompletoMock).toHaveBeenCalled(), ESPERA);
    // Ni `page` ni `pageSize`: el schema del modo completo es `.strict()` y los rechaza.
    expect(listarUsuariosCompletoMock).toHaveBeenLastCalledWith({
      rol: ["mensajero"],
      q: "ana",
    });
  });

  it("T-C7/R23: sin filtros, la descarga pide `{}` — la petición de hoy, byte a byte", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);
    await screen.findByRole("searchbox", { name: "Buscar" });

    await user.click(screen.getByRole("button", { name: "Descargar Usuarios" }));

    await waitFor(() => expect(listarUsuariosCompletoMock).toHaveBeenCalled(), ESPERA);
    expect(listarUsuariosCompletoMock).toHaveBeenLastCalledWith({});
  });
});

describe("UsuariosModule — un solo origen para el mínimo (T-C8, R29/R7)", () => {
  it("T-C8/R7: por debajo del mínimo no se consulta, y el aviso dice cuántos faltan", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);
    await screen.findByRole("searchbox", { name: "Buscar" });
    const previas = await llamadasTrasElMontaje();

    await user.type(buscador(), "x".repeat(USUARIO_BUSQUEDA_MIN_CHARS - 1));
    await new Promise((r) => setTimeout(r, 700)); // más que la espera de la barra

    expect(listarUsuariosMock.mock.calls.length).toBe(previas);
    // El número del aviso sale de la CONSTANTE del borde: si alguien escribiera el mínimo
    // a mano en el componente y la constante cambiara, este texto diría otro número.
    expect(screen.getByRole("status")).toHaveTextContent(
      avisoMinimoCaracteres(USUARIO_BUSQUEDA_MIN_CHARS),
    );

    // Y justo EN el mínimo sí se consulta: el aviso no es un tope, es un umbral.
    await user.type(buscador(), "x");
    await waitFor(
      () =>
        expect(ultimaEntrada()).toEqual({
          page: 1,
          pageSize: 25,
          q: "x".repeat(USUARIO_BUSQUEDA_MIN_CHARS),
        }),
      ESPERA,
    );
  });

  it("T-C8/R29: el `minChars` del campo ES la constante importada, no un número escrito a mano", async () => {
    // La comprobación de comportamiento de arriba no puede distinguir un `2` literal de la
    // constante MIENTRAS la constante valga 2 — y ése es justo el error que R29 prohíbe.
    // Así que se mira el prop tal como se pasa: debe ser la constante, y no puede haber
    // ningún `minChars` numérico en el módulo.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const fuente = readFileSync(
      resolve(
        __dirname,
        "../../../app/(app)/configuracion/_components/UsuariosModule.tsx",
      ),
      "utf8",
    );
    const usos = [...fuente.matchAll(/minChars=\{([^}]+)\}/g)].map((m) =>
      (m[1] ?? "").trim(),
    );
    expect(usos).toEqual(["USUARIO_BUSQUEDA_MIN_CHARS"]);
    expect(fuente).toMatch(
      /import\s*\{[^}]*USUARIO_BUSQUEDA_MIN_CHARS[^}]*\}\s*from\s*"@\/lib\/types\/usuario"/,
    );
  });
});

describe("UsuariosModule — la clave del filtro es la que espera el borde", () => {
  it("la clave del filtro de rol coincide con la que viaja a `listarUsuarios`", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);
    await ponerFiltro(user, "Rol");
    await marcar(user, "Rol", "Administrador");

    await waitFor(
      () => expect(ultimaEntrada()).toHaveProperty(CLAVE_ROL, ["admin"]),
      ESPERA,
    );
  });
});
