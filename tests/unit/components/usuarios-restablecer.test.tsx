// @vitest-environment jsdom
//
// FEATURE 287 (T10) — la accion «Restablecer contrasena» de una fila, de punta a punta.
//
// Requisitos que se afirman aqui: **R25, R26, R27, R28, R29, R30, R31**, mas **R19** (el numero
// de sesiones cerradas llega a la pantalla) y la mitad de cliente de **R24**.
//
// Lo que este archivo vigila y ningun test de backend puede vigilar: que entre pulsar el boton y
// que algo cambie haya una CONFIRMACION de por medio (R26/R27), que el claro se pinte UNA vez y
// desaparezca al cerrar (R28/R29), y que ninguna rama de error acabe pintando una contrasena
// (R30). El backend garantiza que el tipo no la lleva; aqui se garantiza que la pantalla tampoco.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { codigoSinComentarios } from "../../fixtures/sin-comentarios";
import { ToastProvider } from "@/providers/ToastProvider";
import type { UsuarioListItemDTO } from "@/lib/types/usuario";
import type { UsuarioPublico } from "@/lib/interfaces/repositories/IUserRepository";

const listarUsuariosMock = vi.fn();
const cambiarEstadoUsuarioMock = vi.fn();
const obtenerUsuarioMock = vi.fn();
const crearUsuarioMock = vi.fn();
const actualizarUsuarioMock = vi.fn();
const listarTiposIdentificacionMock = vi.fn();
const listarRolesMock = vi.fn();
const restablecerContrasenaUsuarioMock = vi.fn();
vi.mock("@/lib/actions/usuarios", () => ({
  listarUsuarios: (...a: unknown[]) => listarUsuariosMock(...a),
  cambiarEstadoUsuario: (...a: unknown[]) => cambiarEstadoUsuarioMock(...a),
  obtenerUsuario: (...a: unknown[]) => obtenerUsuarioMock(...a),
  crearUsuario: (...a: unknown[]) => crearUsuarioMock(...a),
  actualizarUsuario: (...a: unknown[]) => actualizarUsuarioMock(...a),
  listarTiposIdentificacion: (...a: unknown[]) => listarTiposIdentificacionMock(...a),
  listarRoles: (...a: unknown[]) => listarRolesMock(...a),
  restablecerContrasenaUsuario: (...a: unknown[]) =>
    restablecerContrasenaUsuarioMock(...a),
}));

import { UsuariosModule } from "@/app/(app)/configuracion/_components/UsuariosModule";

const CLARO = "Xk7#mQp2Lz9!";

const ITEM: UsuarioListItemDTO = {
  id: "u1",
  nombre: "Ana Pérez",
  email: "ana@example.com",
  rolValue: "mensajero",
  estado: "activo",
  // Campo añadido al DTO por el merge de la feature de WhatsApp (PR #512) sin actualizar este
  // fixture, que quedó rojo en `dev`. Se completa aquí para desbloquear el typecheck.
  zonaNombre: null,
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

/** Pulsa «Restablecer contraseña» en la fila y devuelve el dialogo de confirmacion. */
async function abrirConfirmacion(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", { name: "Restablecer contraseña" }),
  );
  return screen.findByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  listarUsuariosMock.mockResolvedValue({
    status: "ok",
    items: [ITEM],
    page: 1,
    pageSize: 25,
    total: 1,
  });
  listarTiposIdentificacionMock.mockResolvedValue({ status: "ok", tipos: [] });
  listarRolesMock.mockResolvedValue({
    status: "ok",
    roles: [{ id: "rol-mensajero", value: "mensajero" }],
  });
  obtenerUsuarioMock.mockResolvedValue({ status: "ok", usuario: USUARIO });
  restablecerContrasenaUsuarioMock.mockResolvedValue({
    status: "ok",
    usuarioId: "u1",
    generatedPassword: CLARO,
    sesionesRevocadas: 3,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* ========================================================================== */
/* R25 — la accion existe en la fila, y no hay donde escribir una contrasena   */
/* ========================================================================== */

describe("R25 — la fila ofrece restablecer, y en ningun punto se ESCRIBE una contrasena", () => {
  it("cada fila del listado ofrece la accion del maestro (R25)", async () => {
    renderModule(<UsuariosModule initialData={INITIAL} />);

    const fila = await screen.findByRole("row", { name: /Ana Pérez/ });
    expect(
      within(fila).getByRole("button", { name: "Restablecer contraseña" }),
    ).toBeInTheDocument();
  });

  it("la confirmacion no tiene ningun campo: solo texto y dos botones (R25)", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    const dialog = await abrirConfirmacion(user);

    expect(within(dialog).queryAllByRole("textbox")).toHaveLength(0);
    expect(dialog.querySelectorAll("input")).toHaveLength(0);
  });

  it("el panel del resultado tiene UN campo y es de solo lectura (R25)", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    const confirmacion = await abrirConfirmacion(user);
    await user.click(within(confirmacion).getByRole("button", { name: "Restablecer" }));

    const panel = await screen.findByTestId("contrasena-generada-panel");
    const inputs = [...panel.querySelectorAll("input")];
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toHaveAttribute("readonly");
    expect(inputs[0]!.type).not.toBe("password");
    // Y en TODO el documento no hay ni un solo campo de tipo password durante el flujo.
    expect(document.querySelectorAll("input[type='password']")).toHaveLength(0);
  });
});

/* ========================================================================== */
/* R26/R27 — la confirmacion, y que nada pase antes de ella                    */
/* ========================================================================== */

describe("R26/R27 — sin confirmar no pasa nada", () => {
  it("el boton de la fila NO ejecuta el restablecimiento: solo pide confirmacion (R26/R27)", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await abrirConfirmacion(user);

    expect(restablecerContrasenaUsuarioMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("contrasena-generada-panel")).not.toBeInTheDocument();
  });

  it("la confirmacion NOMBRA al usuario y advierte de las DOS consecuencias (R26)", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    const dialog = await abrirConfirmacion(user);
    const texto = dialog.textContent ?? "";

    expect(texto).toContain("Ana Pérez"); // a quien
    expect(texto).toContain("La actual dejará de servir"); // su contrasena deja de servir
    expect(texto).toContain("se cerrarán sus sesiones abiertas"); // y pierde las sesiones
    expect(texto).toContain("La verás una sola vez"); // y el claro no se repite
  });

  it("la advertencia esta ASOCIADA al dialogo, no solo escrita (R26, a11y)", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    const dialog = await abrirConfirmacion(user);
    const descrito = dialog.getAttribute("aria-describedby");
    expect(descrito, "la advertencia no la oye quien no la ve").toBeTruthy();
    expect(document.getElementById(descrito!)?.textContent).toContain("Ana Pérez");
  });

  it("Cancelar cierra sin ejecutar nada (R27)", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    const dialog = await abrirConfirmacion(user);
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(restablecerContrasenaUsuarioMock).not.toHaveBeenCalled();
  });

  it("Escape tambien cancela sin ejecutar nada (R27)", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await abrirConfirmacion(user);
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(restablecerContrasenaUsuarioMock).not.toHaveBeenCalled();
  });

  it("al confirmar llama a la accion UNA sola vez y SOLO con el id de la fila (R26/R6/R10)", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    const dialog = await abrirConfirmacion(user);
    await user.click(within(dialog).getByRole("button", { name: "Restablecer" }));

    await waitFor(() => expect(restablecerContrasenaUsuarioMock).toHaveBeenCalledTimes(1));
    // ⭑ La forma de la llamada es el requisito: UN argumento, el id. Si alguien le anade un
    // objeto de entrada —por donde entraria una contrasena elegida por el maestro— esto cae.
    expect(restablecerContrasenaUsuarioMock.mock.calls[0]).toEqual(["u1"]);
  });
});

/* ========================================================================== */
/* R19/R28 — el claro una vez, y cuantas sesiones se cerraron                   */
/* ========================================================================== */

describe("R19/R28 — con `ok`, la contrasena una vez y el numero de sesiones", () => {
  it("muestra el claro en el panel y dice cuantas sesiones cerro (R19/R28)", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    const dialog = await abrirConfirmacion(user);
    await user.click(within(dialog).getByRole("button", { name: "Restablecer" }));

    const panel = await screen.findByTestId("contrasena-generada-panel");
    expect(within(panel).getByLabelText("Contraseña generada")).toHaveValue(CLARO);
    expect(within(panel).getByRole("alert")).toHaveTextContent(
      "no se volverá a mostrar",
    );
    expect(panel.textContent).toContain("Ana Pérez");

    // ⭑ R19: el numero viene del backend. Un `0` fijo o un texto sin numero cae aqui.
    expect(
      (await screen.findAllByText("Contraseña restablecida. Se cerraron 3 sesiones abiertas."))
        .length,
    ).toBeGreaterThan(0);
  });

  it("el numero se dice tal cual llega, tambien en 1 y en 0 (R19)", async () => {
    for (const [sesiones, esperado] of [
      [1, "Contraseña restablecida. Se cerró 1 sesión abierta."],
      [0, "Contraseña restablecida. No había sesiones abiertas."],
    ] as const) {
      restablecerContrasenaUsuarioMock.mockResolvedValue({
        status: "ok",
        usuarioId: "u1",
        generatedPassword: CLARO,
        sesionesRevocadas: sesiones,
      });
      const user = userEvent.setup();
      renderModule(<UsuariosModule initialData={INITIAL} />);

      const dialog = await abrirConfirmacion(user);
      await user.click(within(dialog).getByRole("button", { name: "Restablecer" }));

      expect((await screen.findAllByText(esperado)).length).toBeGreaterThan(0);
      cleanup();
    }
  });

  it("no guarda el claro en ningun almacen del navegador (R24, mitad de cliente)", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    const dialog = await abrirConfirmacion(user);
    await user.click(within(dialog).getByRole("button", { name: "Restablecer" }));
    await screen.findByTestId("contrasena-generada-panel");

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).toBe("");
  });
});

/* ========================================================================== */
/* R29 — al cerrar, no queda via de volver a verla                             */
/* ========================================================================== */

/** Nombres de control que, si existieran, serian una via de volver a ver el claro (R29). */
const REPONER = /ver contraseña|mostrar contraseña|volver a ver|revelar|reenviar|copiar de nuevo/i;

describe("R29 — cerrado el panel, la contrasena no vuelve", () => {
  it("en NINGUN momento del flujo existe un control de «volver a mostrarla» (R29)", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    // Antes, durante y despues: el detector se aplica en los tres momentos, porque un control
    // asi puede estar puesto desde el principio y no aparecer solo al cerrar.
    await screen.findByRole("row", { name: /Ana Pérez/ });
    expect(screen.queryByRole("button", { name: REPONER })).not.toBeInTheDocument();

    const dialog = await abrirConfirmacion(user);
    await user.click(within(dialog).getByRole("button", { name: "Restablecer" }));
    await screen.findByTestId("contrasena-generada-panel");
    expect(screen.queryByRole("button", { name: REPONER })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cerrar" }));
    await waitFor(() =>
      expect(screen.queryByTestId("contrasena-generada-panel")).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: REPONER })).not.toBeInTheDocument();

    // Autocomprobacion del detector: sobre los nombres que SI son una via, encaja.
    for (const nombre of ["Ver contraseña de nuevo", "Volver a ver", "Reenviar"]) {
      expect(REPONER.test(nombre), `el detector no caza «${nombre}»`).toBe(true);
    }
    expect(REPONER.test("Restablecer contraseña")).toBe(false);
  });

  it("cerrar con Escape tambien descarta el claro (R29)", async () => {
    // ⭑ La otra puerta de salida. Si solo el boton «Cerrar» descartara el estado, salir por
    // Escape dejaria el claro vivo en el cliente — que es justo lo que R29 prohibe.
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    const dialog = await abrirConfirmacion(user);
    await user.click(within(dialog).getByRole("button", { name: "Restablecer" }));
    await screen.findByTestId("contrasena-generada-panel");

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByTestId("contrasena-generada-panel")).not.toBeInTheDocument(),
    );
    expect(screen.queryByDisplayValue(CLARO)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(CLARO);
  });

  it("al cerrar desaparece del DOM y NO queda ningun control nuevo que la reponga (R29)", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await screen.findByRole("row", { name: /Ana Pérez/ });
    const botonesAntes = screen
      .getAllByRole("button")
      .map((b) => b.textContent?.trim())
      .sort();

    const dialog = await abrirConfirmacion(user);
    await user.click(within(dialog).getByRole("button", { name: "Restablecer" }));
    await screen.findByTestId("contrasena-generada-panel");

    await user.click(screen.getByRole("button", { name: "Cerrar" }));

    await waitFor(() =>
      expect(screen.queryByTestId("contrasena-generada-panel")).not.toBeInTheDocument(),
    );
    expect(screen.queryByDisplayValue(CLARO)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(CLARO);

    // ⭑ El conjunto de controles vuelve a ser EXACTAMENTE el de antes: si alguien deja un
    // «volver a mostrar», un «reenviar» o un panel colgando, esta comparacion lo dice.
    const botonesDespues = screen
      .getAllByRole("button")
      .map((b) => b.textContent?.trim())
      .sort();
    expect(botonesDespues).toEqual(botonesAntes);
  });
});

/* ========================================================================== */
/* R30 — un fallo se informa, y NUNCA pinta contrasena                          */
/* ========================================================================== */

describe("R30 — con error, toast y ninguna contrasena", () => {
  it.each([
    ["not_found", "El usuario no existe."],
    ["forbidden", "No tienes permiso para esta acción."],
    ["unauthenticated", "Tu sesión expiró. Vuelve a iniciar sesión."],
    ["validation_error", "Revisa los datos e inténtalo de nuevo."],
    ["self_reset_forbidden", "No puedes restablecer tu propia contraseña desde aquí."],
  ])("`%s` -> toast con su mensaje y sin panel (R30/R5)", async (status, mensaje) => {
    restablecerContrasenaUsuarioMock.mockResolvedValue({ status });
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    const dialog = await abrirConfirmacion(user);
    await user.click(within(dialog).getByRole("button", { name: "Restablecer" }));

    expect((await screen.findAllByText(mensaje)).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("contrasena-generada-panel")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(CLARO);
  });

  it("`self_reset_forbidden` NO se confunde con `forbidden` (R5)", async () => {
    // Dos negativas distintas: una es «no tienes permiso», la otra es «no a ti mismo».
    // Si alguien las colapsa en el mismo mensaje, este test lo dice.
    const user = userEvent.setup();
    restablecerContrasenaUsuarioMock.mockResolvedValue({ status: "self_reset_forbidden" });
    renderModule(<UsuariosModule initialData={INITIAL} />);

    const dialog = await abrirConfirmacion(user);
    await user.click(within(dialog).getByRole("button", { name: "Restablecer" }));

    await screen.findAllByText("No puedes restablecer tu propia contraseña desde aquí.");
    expect(screen.queryByText("No tienes permiso para esta acción.")).not.toBeInTheDocument();
  });
});

/* ========================================================================== */
/* R31 — ni el alta ni la edicion exponen el restablecimiento                   */
/* ========================================================================== */

describe("R31 — el restablecimiento no se expone desde el formulario", () => {
  it("el modal de Crear usuario no ofrece la accion (R31)", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(screen.getByRole("button", { name: "Crear usuario" }));
    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).queryByRole("button", { name: /restablecer/i }),
    ).not.toBeInTheDocument();
  });

  it("el modal de Editar usuario tampoco (R31)", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Editar" }));
    await waitFor(() => expect(obtenerUsuarioMock).toHaveBeenCalledWith("u1"));
    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).queryByRole("button", { name: /restablecer/i }),
    ).not.toBeInTheDocument();
  });

  it("el CODIGO del formulario no conoce la accion: no la importa ni la llama (R31)", () => {
    // Sin comentarios: R31 habla de EXPONER la operacion, no de mencionarla en prosa. Un
    // comentario del alta que diga «el restablecimiento va por otra via» no la expone.
    const codigo = codigoSinComentarios(
      "app/(app)/configuracion/_components/UsuarioForm.tsx",
    );

    // Anti-vacuidad: es el archivo del alta/edicion y sigue siendo el que muestra el claro
    // del ALTA (feature 25/R33), que es otra cosa y no se toca aqui.
    expect(codigo.trim().length).toBeGreaterThan(200);
    expect(codigo).toContain("generatedPassword");
    expect(codigo).not.toContain("restablecerContrasena");
  });
});
