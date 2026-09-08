// @vitest-environment jsdom
//
// FICHA 379 (T11) — EL AVISO EN LA PANTALLA: «esta zona se queda sin Admin satélite».
//
// Requisitos que se afirman aquí: **R9, R10, R11, R12, R13, R15, R20, R21 y R23**, más la
// mitad de pantalla de **R19** (el importe se pinta desde el STRING del servidor, sin pasar
// por coma flotante).
//
// ⚠️ LO QUE ESTE ARCHIVO **NO** ES: una guarda. La decisión del humano del 2026-09-08 fue
// «no, no quiero daños»: **nada puede impedirle al maestro** cambiar el rol, la zona o el
// estado de un usuario (R14). Por eso todos los casos de aquí terminan en «y el cambio se
// puede aplicar igual»; si alguno acabara demostrando que la pantalla bloquea algo, sería el
// caso el que está mal escrito.
//
// Lo que sí vigila, y ningún test de backend puede vigilar:
//   · que la consulta previa salga ANTES que la escritura, no «también» (R9/R21);
//   · que mientras el diálogo está en pantalla NO se haya escrito nada (R11);
//   · que confirmar aplique EL MISMO cambio que se aplicaría sin aviso (R12);
//   · que cancelar no deje rastro (R13);
//   · que sin impacto no aparezca nada: los mismos clics de hoy (R15);
//   · que un fallo de la consulta se DIGA y deje continuar, en vez de callar o bloquear (R20);
//   · y que el rol se nombre como lo nombra el resto de la app, no con el id del enum (R23).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { UsuarioListItemDTO } from "@/lib/types/usuario";
import type { UsuarioPublico } from "@/lib/interfaces/repositories/IUserRepository";
import type { ImpactoSalidaAdminSatelite } from "@/lib/interfaces/services/IUsuarioService";

const listarUsuariosMock = vi.fn();
const listarUsuariosCompletoMock = vi.fn();
const cambiarEstadoUsuarioMock = vi.fn();
const consultarImpactoCambioUsuarioMock = vi.fn();
const obtenerUsuarioMock = vi.fn();
const crearUsuarioMock = vi.fn();
const actualizarUsuarioMock = vi.fn();
const listarTiposIdentificacionMock = vi.fn();
const listarRolesMock = vi.fn();
const restablecerContrasenaUsuarioMock = vi.fn();
vi.mock("@/lib/actions/usuarios", () => ({
  listarUsuarios: (...a: unknown[]) => listarUsuariosMock(...a),
  listarUsuariosCompleto: (...a: unknown[]) => listarUsuariosCompletoMock(...a),
  cambiarEstadoUsuario: (...a: unknown[]) => cambiarEstadoUsuarioMock(...a),
  consultarImpactoCambioUsuario: (...a: unknown[]) =>
    consultarImpactoCambioUsuarioMock(...a),
  obtenerUsuario: (...a: unknown[]) => obtenerUsuarioMock(...a),
  crearUsuario: (...a: unknown[]) => crearUsuarioMock(...a),
  actualizarUsuario: (...a: unknown[]) => actualizarUsuarioMock(...a),
  listarTiposIdentificacion: (...a: unknown[]) => listarTiposIdentificacionMock(...a),
  listarRoles: (...a: unknown[]) => listarRolesMock(...a),
  restablecerContrasenaUsuario: (...a: unknown[]) =>
    restablecerContrasenaUsuarioMock(...a),
}));

// Los dos catálogos que el formulario de edición pide por su cuenta. Se doblan para que el
// select de zona esté poblado y el rol resuelva a `adminSatelite` sin viajes reales.
const listarZonasMock = vi.fn();
vi.mock("@/lib/actions/zonas", () => ({
  listarZonas: (...a: unknown[]) => listarZonasMock(...a),
}));
const listarVehiculosMock = vi.fn();
vi.mock("@/lib/actions/vehiculos", () => ({
  listarVehiculos: (...a: unknown[]) => listarVehiculosMock(...a),
}));

import { UsuariosModule } from "@/app/(app)/configuracion/_components/UsuariosModule";

/** La fila del caso: el ÚNICO Admin satélite activo de Puntarenas. */
const SATELITE: UsuarioListItemDTO = {
  id: "u-sat",
  nombre: "Rosa Vargas",
  email: "rosa@example.com",
  rolValue: "adminSatelite",
  estado: "activo",
  zonaNombre: "Puntarenas",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const USUARIO_SATELITE: UsuarioPublico = {
  id: "u-sat",
  nombre: "Rosa Vargas",
  email: "rosa@example.com",
  telefono: "0999999999",
  estado: "activo",
  cedula: "1712345678",
  tipoIdentificacionId: "t1",
  rolId: "rol-admin-satelite",
  fulfillment: false,
  zonaId: "z-puntarenas",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const INITIAL = { items: [SATELITE], total: 1, pageSize: 25 };

/**
 * El impacto que devuelve el servidor cuando el cambio deja la zona sin nadie. El importe
 * viaja como STRING de escala 2 y así se pinta (R19): once dígitos con céntimos, que es el
 * tamaño en el que un `number` ya no es exacto.
 */
const IMPACTO: ImpactoSalidaAdminSatelite = {
  zonaNombre: "Puntarenas",
  cierresSinConsolidar: 4,
  totalSinConsolidar: "9999999999.99",
  adminSatelitesActivosRestantes: 0,
};

function renderModule(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

/**
 * El diálogo del aviso, y no cualquier diálogo: por la puerta del formulario quedan DOS
 * abiertos a la vez (el editor debajo, el aviso encima), y el aviso es el que ofrece
 * «Continuar».
 */
async function dialogoAviso(): Promise<HTMLElement> {
  const boton = await screen.findByRole("button", { name: "Continuar" });
  const dialogo = boton.closest('[role="dialog"]');
  expect(dialogo, "el botón Continuar no está dentro de un diálogo").not.toBeNull();
  return dialogo as HTMLElement;
}

/** ¿Hay algún aviso en pantalla? (sin esperar: para afirmar que NO lo hay). */
function hayAviso(): boolean {
  return screen.queryByRole("button", { name: "Continuar" }) !== null;
}

beforeEach(() => {
  vi.clearAllMocks();
  listarUsuariosMock.mockResolvedValue({
    status: "ok",
    items: [SATELITE],
    page: 1,
    pageSize: 25,
    total: 1,
  });
  listarUsuariosCompletoMock.mockResolvedValue({
    status: "ok",
    items: [SATELITE],
    total: 1,
  });
  listarTiposIdentificacionMock.mockResolvedValue({
    status: "ok",
    tipos: [{ id: "t1", value: "cedula" }],
  });
  listarRolesMock.mockResolvedValue({
    status: "ok",
    roles: [
      { id: "rol-admin-satelite", value: "adminSatelite" },
      { id: "rol-maestro", value: "maestro" },
    ],
  });
  listarZonasMock.mockResolvedValue({
    status: "ok",
    items: [{ id: "z-puntarenas", nombre: "Puntarenas" }],
    page: 1,
    pageSize: 100,
    total: 1,
  });
  listarVehiculosMock.mockResolvedValue({ status: "ok", items: [] });
  obtenerUsuarioMock.mockResolvedValue({ status: "ok", usuario: USUARIO_SATELITE });
  cambiarEstadoUsuarioMock.mockResolvedValue({
    status: "ok",
    usuario: { ...USUARIO_SATELITE, estado: "inactivo" },
  });
  actualizarUsuarioMock.mockResolvedValue({
    status: "ok",
    usuario: { ...USUARIO_SATELITE },
  });
  // Por defecto, el caso que dispara el aviso.
  consultarImpactoCambioUsuarioMock.mockResolvedValue({
    status: "ok",
    impacto: IMPACTO,
  });
});

afterEach(() => {
  cleanup();
});

/* ========================================================================== */
/* R9 / R21 — se EVALÚA antes de escribir, y se afirma el ORDEN                */
/* ========================================================================== */

describe("R9/R21 — la consulta previa sale ANTES que la escritura, no «también»", () => {
  it("R9/R21: inactivar consulta el impacto antes de llamar a cambiarEstadoUsuario", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Inactivar" }));
    const dialogo = await dialogoAviso();
    await user.click(within(dialogo).getByRole("button", { name: "Continuar" }));

    await waitFor(() => expect(cambiarEstadoUsuarioMock).toHaveBeenCalled());
    expect(consultarImpactoCambioUsuarioMock).toHaveBeenCalledWith("u-sat", {
      estado: "inactivo",
    });
    // El orden, no solo la presencia: una consulta que sale DESPUÉS de la escritura sería
    // un cambio aplicado sin evaluar, que es lo que R21 llama fallo aunque el resultado
    // visible sea correcto.
    expect(
      consultarImpactoCambioUsuarioMock.mock.invocationCallOrder[0],
    ).toBeLessThan(cambiarEstadoUsuarioMock.mock.invocationCallOrder[0]);
  }, 20000);

  it("R9/R21: guardar la edición consulta el impacto antes de llamar a actualizarUsuario", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Editar" }));
    await screen.findByRole("combobox", { name: "Zona" });
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    const dialogo = await dialogoAviso();
    await user.click(within(dialogo).getByRole("button", { name: "Continuar" }));

    await waitFor(() => expect(actualizarUsuarioMock).toHaveBeenCalled());
    // Y lo que se evalúa es el cambio que se va a enviar, no una aproximación.
    expect(consultarImpactoCambioUsuarioMock).toHaveBeenCalledWith("u-sat", {
      rolId: "rol-admin-satelite",
      zonaId: "z-puntarenas",
    });
    expect(
      consultarImpactoCambioUsuarioMock.mock.invocationCallOrder[0],
    ).toBeLessThan(actualizarUsuarioMock.mock.invocationCallOrder[0]);
  }, 25000);
});

/* ========================================================================== */
/* R10 / R19 / R23 — QUÉ dice el aviso                                        */
/* ========================================================================== */

describe("R10/R19/R23 — el aviso dice la zona, cuántos cierres y por cuánto", () => {
  it("R10: nombra la zona, el número de cierres aprobados y el importe formateado", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Inactivar" }));
    const dialogo = await dialogoAviso();
    const texto = dialogo.textContent ?? "";

    expect(texto).toContain("Puntarenas");
    expect(texto).toContain("4 cierres aprobados sin consolidar");
    // R19: el importe se pinta DESDE EL STRING. Once dígitos con céntimos: si alguien lo
    // hiciera pasar por `Number`, esta cola dejaría de ser exacta.
    expect(texto).toContain("₡9.999.999.999,99");
    // Y la razón, que es lo que hace accionable el aviso.
    expect(texto).toContain(
      "ni el Maestro ni un Administrador pueden hacerlo desde otra zona",
    );
  }, 20000);

  it("R10: con un solo cierre el texto va en singular", async () => {
    const user = userEvent.setup();
    consultarImpactoCambioUsuarioMock.mockResolvedValue({
      status: "ok",
      impacto: { ...IMPACTO, cierresSinConsolidar: 1, totalSinConsolidar: "1234567.89" },
    });
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Inactivar" }));
    const texto = (await dialogoAviso()).textContent ?? "";

    expect(texto).toContain("1 cierre aprobado sin consolidar");
    expect(texto).not.toContain("1 cierres");
    expect(texto).toContain("₡1.234.567,89");
  }, 20000);

  it("R10 (AS1): sin un céntimo pendiente el aviso SIGUE saliendo, con la frase de cero", async () => {
    const user = userEvent.setup();
    consultarImpactoCambioUsuarioMock.mockResolvedValue({
      status: "ok",
      impacto: { ...IMPACTO, cierresSinConsolidar: 0, totalSinConsolidar: "0.00" },
    });
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Inactivar" }));
    const texto = (await dialogoAviso()).textContent ?? "";

    // El daño no es el dinero de hoy: es que la zona se queda sin nadie que pueda cerrarla,
    // así que lo que entre después queda retenido.
    expect(texto).toContain("Ahora mismo no hay cierres pendientes");
    expect(texto).toContain("quedarán retenidos");
    expect(texto).not.toContain("cierres aprobados sin consolidar");
  }, 20000);

  it("R23: los TRES roles se nombran con su etiqueta, y ninguno con el identificador del enum", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Inactivar" }));
    const texto = (await dialogoAviso()).textContent ?? "";

    // Las etiquetas, escritas a mano: son el contrato de lo que lee una persona.
    expect(texto).toContain("Admin satélite");
    expect(texto).toContain("Maestro");
    expect(texto).toContain("Administrador");

    // Y ningún `RolValue` en crudo. Los límites de palabra importan: `adminSatelite` no
    // dispara `\badmin\b` (no hay frontera entre «n» y «S»), y «Administrador» tampoco
    // (empieza por mayúscula), así que estas dos aserciones cazan exactamente el
    // identificador técnico suelto y nada más.
    expect(texto).not.toContain("adminSatelite");
    expect(texto).not.toMatch(/\badmin\b/);
    expect(texto).not.toMatch(/\bmaestro\b/);
  }, 20000);

  it("R10: el texto cuelga de aria-describedby, así que un lector de pantalla lo oye al abrirse", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Inactivar" }));
    const dialogo = await dialogoAviso();

    const id = dialogo.getAttribute("aria-describedby");
    expect(id, "el aviso no está asociado como descripción del diálogo").toBeTruthy();
    const descripcion = document.getElementById(id as string);
    expect(descripcion?.textContent ?? "").toContain("Puntarenas");
  }, 20000);
});

/* ========================================================================== */
/* R11 — con el diálogo abierto NO se ha escrito nada                         */
/* ========================================================================== */

describe("R11 — mientras el aviso está en pantalla, el cambio NO se ha aplicado", () => {
  it("R11: abrir el aviso desde la fila no llama a cambiarEstadoUsuario", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Inactivar" }));
    await dialogoAviso();

    expect(cambiarEstadoUsuarioMock).not.toHaveBeenCalled();
  }, 20000);

  it("R11: abrir el aviso desde el formulario no llama a actualizarUsuario", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Editar" }));
    await screen.findByRole("combobox", { name: "Zona" });
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await dialogoAviso();

    expect(actualizarUsuarioMock).not.toHaveBeenCalled();
  }, 25000);
});

/* ========================================================================== */
/* R12 — confirmar aplica EXACTAMENTE el mismo cambio que sin aviso           */
/* ========================================================================== */

describe("R12 — confirmar da el mismo resultado que tendría si el aviso no existiera", () => {
  /** Inactiva la fila y devuelve los argumentos con que se llamó a la escritura. */
  async function argumentosDeInactivar(conAviso: boolean): Promise<unknown[]> {
    consultarImpactoCambioUsuarioMock.mockResolvedValue({
      status: "ok",
      impacto: conAviso ? IMPACTO : null,
    });
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Inactivar" }));
    if (conAviso) {
      const dialogo = await dialogoAviso();
      await user.click(within(dialogo).getByRole("button", { name: "Continuar" }));
    }
    await waitFor(() => expect(cambiarEstadoUsuarioMock).toHaveBeenCalled());
    return cambiarEstadoUsuarioMock.mock.calls[0];
  }

  it("R12: los argumentos de la escritura son los MISMOS con aviso y sin aviso", async () => {
    const sinAviso = await argumentosDeInactivar(false);
    cleanup();
    cambiarEstadoUsuarioMock.mockClear();
    const conAviso = await argumentosDeInactivar(true);

    // El contrato, escrito a mano…
    expect(sinAviso).toEqual(["u-sat", { estado: "inactivo" }]);
    // …y la cruz: el aviso no cambia una coma de lo que se aplica.
    expect(conAviso).toEqual(sinAviso);
  }, 30000);

  it("R12: confirmar desde el formulario envía el mismo payload y avisa del éxito", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Editar" }));
    await screen.findByRole("combobox", { name: "Zona" });
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    const dialogo = await dialogoAviso();
    await user.click(within(dialogo).getByRole("button", { name: "Continuar" }));

    await waitFor(() => expect(actualizarUsuarioMock).toHaveBeenCalledTimes(1));
    expect(actualizarUsuarioMock.mock.calls[0][0]).toBe("u-sat");
    const enviado = actualizarUsuarioMock.mock.calls[0][1] as Record<string, unknown>;
    expect(enviado.rolId).toBe("rol-admin-satelite");
    expect(enviado.zonaId).toBe("z-puntarenas");
    expect(await screen.findByText("Usuario actualizado")).toBeInTheDocument();
  }, 25000);
});

/* ========================================================================== */
/* R13 — descartar no aplica nada y no deja rastro                            */
/* ========================================================================== */

describe("R13 — cancelar, Escape o clic fuera descartan el cambio", () => {
  it("R13: Cancelar cierra el aviso y no escribe nada", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Inactivar" }));
    const dialogo = await dialogoAviso();
    await user.click(within(dialogo).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(hayAviso()).toBe(false));
    expect(cambiarEstadoUsuarioMock).not.toHaveBeenCalled();
  }, 20000);

  it("R13: Escape también lo descarta, y el botón de la fila vuelve a estar disponible", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Inactivar" }));
    await dialogoAviso();
    await user.keyboard("{Escape}");

    await waitFor(() => expect(hayAviso()).toBe(false));
    expect(cambiarEstadoUsuarioMock).not.toHaveBeenCalled();
    // R14: descartar no deja al maestro sin salida — el cambio sigue a un clic.
    expect(
      await screen.findByRole("button", { name: "Inactivar" }),
    ).not.toBeDisabled();
  }, 20000);
});

/* ========================================================================== */
/* R15 — sin impacto, los mismos clics de hoy                                 */
/* ========================================================================== */

describe("R15 — sin impacto no aparece nada", () => {
  it("R15: con `impacto: null` el cambio de estado se aplica directo, sin diálogo", async () => {
    const user = userEvent.setup();
    consultarImpactoCambioUsuarioMock.mockResolvedValue({
      status: "ok",
      impacto: null,
    });
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Inactivar" }));

    await waitFor(() =>
      expect(cambiarEstadoUsuarioMock).toHaveBeenCalledWith("u-sat", {
        estado: "inactivo",
      }),
    );
    expect(await screen.findByText("Usuario inactivado")).toBeInTheDocument();
    expect(hayAviso()).toBe(false);
  }, 20000);

  it("R15: con `impacto: null` la edición se guarda sin ningún paso extra", async () => {
    const user = userEvent.setup();
    consultarImpactoCambioUsuarioMock.mockResolvedValue({
      status: "ok",
      impacto: null,
    });
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Editar" }));
    await screen.findByRole("combobox", { name: "Zona" });
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(actualizarUsuarioMock).toHaveBeenCalledTimes(1));
    expect(hayAviso()).toBe(false);
  }, 25000);
});

/* ========================================================================== */
/* R20 — la consulta falla: se DICE, y se puede continuar                     */
/* ========================================================================== */

describe("R20 — si la consulta previa no se puede resolver, ni silencio ni bloqueo", () => {
  it("R20: un error de la consulta abre el diálogo diciendo que no se pudo comprobar", async () => {
    const user = userEvent.setup();
    consultarImpactoCambioUsuarioMock.mockResolvedValue({ status: "unauthenticated" });
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Inactivar" }));
    const texto = (await dialogoAviso()).textContent ?? "";

    expect(texto).toContain("No se pudo comprobar");
    expect(texto).toContain("Puedes continuar de todas formas");
    // Nombra la zona con lo único que la pantalla sabe con certeza: lo que la fila pinta.
    expect(texto).toContain("Puntarenas");
    // Y no se inventa ningún número: no hay cifra que decir.
    expect(texto).not.toContain("cierres aprobados");
    // R11 vale igual aquí: todavía no se ha escrito nada.
    expect(cambiarEstadoUsuarioMock).not.toHaveBeenCalled();
  }, 20000);

  it("R20/R14: confirmar tras el fallo APLICA el cambio — el maestro no queda bloqueado", async () => {
    const user = userEvent.setup();
    consultarImpactoCambioUsuarioMock.mockResolvedValue({ status: "not_found" });
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Inactivar" }));
    const dialogo = await dialogoAviso();
    await user.click(within(dialogo).getByRole("button", { name: "Continuar" }));

    await waitFor(() =>
      expect(cambiarEstadoUsuarioMock).toHaveBeenCalledWith("u-sat", {
        estado: "inactivo",
      }),
    );
    expect(await screen.findByText("Usuario inactivado")).toBeInTheDocument();
  }, 20000);

  it("R20: si la acción REVIENTA, el aviso aparece igual y deja continuar", async () => {
    const user = userEvent.setup();
    consultarImpactoCambioUsuarioMock.mockRejectedValue(new Error("caída de red"));
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Inactivar" }));
    const dialogo = await dialogoAviso();
    expect(dialogo.textContent ?? "").toContain("No se pudo comprobar");

    await user.click(within(dialogo).getByRole("button", { name: "Continuar" }));
    await waitFor(() => expect(cambiarEstadoUsuarioMock).toHaveBeenCalled());
  }, 20000);
});
