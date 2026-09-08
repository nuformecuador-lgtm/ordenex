// @vitest-environment jsdom
//
// ⭑ FICHA 392 — EL AVISO DEL NOMBRE DE TIENDA QUE LA ETIQUETA NO PUEDE IMPRIMIR.
//
// El nombre de la tienda SE IMPRIME en la etiqueta (`etiqueta.tiendaNombre`, que sale de
// `usuario.nombre`). Desde la mitad de servidor de esta ficha, crear o editar un usuario con un
// carácter que la fuente no cubre termina en `validation_error` con el motivo YA REDACTADO
// colgando de `fieldErrors.nombre`.
//
// Lo que se mide aquí es el aviso, y son dos mitades:
//
//   1. que el motivo del SERVIDOR llegue ENTERO al toast, en lugar del genérico. El genérico
//      —«Revisa los datos e inténtalo de nuevo.»— manda a revisar unos datos que están bien: el
//      formulario está COMPLETO y lo que falla es un carácter que ni siquiera se distingue a
//      simple vista;
//   2. y que el genérico SIGA saliendo cuando el rechazo lo produjo la validación de CLIENTE, que
//      viaja con la misma forma (`validation_error` + `fieldErrors.nombre`) pero cuyos mensajes
//      los redacta zod en inglés. Cambiar un mensaje pobre por uno peor no es arreglarlo.
//
// Esa segunda mitad es la que obliga a que el formulario diga de dónde viene el motivo
// (`motivoDelNombreDelServidor`) en vez de que el anfitrión lo adivine mirando el texto.
//
// **LOS TEXTOS SON LITERALES ESCRITOS A MANO**, copiados del mensaje que produce el servidor y no
// importados de él: compararlos contra la función que los genera estaría siempre verde, porque
// recortar la frase cambiaría las dos mitades a la vez.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import type { UsuarioListItemDTO } from "@/lib/types/usuario";
import type { UsuarioPublico } from "@/lib/interfaces/repositories/IUserRepository";

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

const listarZonasMock = vi.fn();
vi.mock("@/lib/actions/zonas", () => ({
  listarZonas: (...a: unknown[]) => listarZonasMock(...a),
}));
const listarVehiculosMock = vi.fn();
vi.mock("@/lib/actions/vehiculos", () => ({
  listarVehiculos: (...a: unknown[]) => listarVehiculosMock(...a),
}));

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));

// El toast se dobla —en vez de montar el proveedor real— porque aquí se afirma el texto EXACTO
// con el que se llama. El mismo mensaje se pinta además junto al campo, así que buscarlo por
// pantalla no distinguiría el aviso del error de campo.
const { successMock, errorMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { UsuariosModule } from "@/app/(app)/configuracion/_components/UsuariosModule";

/** El genérico de esta pantalla, que NO es el de las otras dos y por eso se escribe aquí entero. */
const GENERICO = "Revisa los datos e inténtalo de nuevo.";

/** Irreparable: ninguna normalización lo arregla, así que el mensaje NO manda reintentar. */
const MOTIVO_IRREPARABLE =
  "«nombre» lleva un carácter que la etiqueta no puede imprimir: «⁨🙂⁩» (U+1F642). " +
  "Reintentar no lo cambia: escríbelo con letras y números normales.";

/**
 * El largo: una «ñ» escrita como «n» + tilde suelta. Se PINTA igual que la de siempre, así que el
 * mensaje no puede limitarse a sugerir un texto idéntico al tecleado — tiene que explicar lo que
 * no se ve. Es el que más tienta a resumir y el que menos se puede resumir.
 */
const MOTIVO_DESCOMPUESTO =
  "«nombre» lleva un carácter que la etiqueta no puede imprimir: «⁨̃⁩» (U+0303). " +
  "Aquí no hay nada que se vea mal: ese carácter se ve igual que el de siempre pero está " +
  "escrito de otra forma —lo normal es que la letra y su acento vayan por separado—, y así no " +
  "se puede imprimir. Bórralo y vuelve a teclearlo; copiar y pegar el mismo texto lo trae otra " +
  "vez igual.";

/** La fila del caso: una TIENDA, que es de quien la etiqueta imprime el nombre. */
const TIENDA: UsuarioListItemDTO = {
  id: "u-tienda",
  nombre: "Tienda Feliz",
  email: "tienda@example.com",
  rolValue: "adminTienda",
  estado: "activo",
  zonaNombre: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const USUARIO_TIENDA: UsuarioPublico = {
  id: "u-tienda",
  nombre: "Tienda Feliz",
  email: "tienda@example.com",
  telefono: "0999999999",
  estado: "activo",
  cedula: "1712345678",
  tipoIdentificacionId: "t1",
  rolId: "rol-tienda",
  fulfillment: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const INITIAL = { items: [TIENDA], total: 1, pageSize: 25 };

function renderModule(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {ui}
    </SWRConfig>,
  );
}

/** Abre el editor de la tienda y espera a que el formulario esté montado. */
async function abrirEdicion(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Editar" }));
  await waitFor(() => expect(obtenerUsuarioMock).toHaveBeenCalledWith("u-tienda"));
  await screen.findByLabelText("Nombre");
}

beforeEach(() => {
  vi.clearAllMocks();
  listarUsuariosMock.mockResolvedValue({
    status: "ok",
    items: [TIENDA],
    page: 1,
    pageSize: 25,
    total: 1,
  });
  listarUsuariosCompletoMock.mockResolvedValue({
    status: "ok",
    items: [TIENDA],
    total: 1,
  });
  listarTiposIdentificacionMock.mockResolvedValue({
    status: "ok",
    tipos: [{ id: "t1", value: "cedula" }],
  });
  listarRolesMock.mockResolvedValue({
    status: "ok",
    roles: [{ id: "rol-tienda", value: "adminTienda" }],
  });
  listarZonasMock.mockResolvedValue({
    status: "ok",
    items: [],
    page: 1,
    pageSize: 100,
    total: 0,
  });
  listarVehiculosMock.mockResolvedValue({ status: "ok", items: [] });
  obtenerUsuarioMock.mockResolvedValue({ status: "ok", usuario: USUARIO_TIENDA });
  // Una tienda no deja ninguna zona sin nadie: el servidor no tiene nada que avisar y el
  // guardado sale por los mismos clics de siempre (FICHA 379/R15).
  consultarImpactoCambioUsuarioMock.mockResolvedValue({ status: "ok", impacto: null });
});

afterEach(() => {
  cleanup();
});

describe("392 — el aviso del nombre de tienda que la etiqueta no puede imprimir", () => {
  it("el toast repite el motivo del SERVIDOR, no «Revisa los datos e inténtalo de nuevo»", async () => {
    actualizarUsuarioMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { nombre: [MOTIVO_IRREPARABLE] },
    });
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await abrirEdicion(user);
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(errorMock).toHaveBeenCalledWith(MOTIVO_IRREPARABLE));
    expect(errorMock).not.toHaveBeenCalledWith(GENERICO);
    expect(successMock).not.toHaveBeenCalled();
  }, 25000);

  it("el motivo LARGO viaja entero: ni recortado ni resumido", async () => {
    actualizarUsuarioMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { nombre: [MOTIVO_DESCOMPUESTO] },
    });
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await abrirEdicion(user);
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    // Igualdad EXACTA contra el literal: cualquier recorte, cualquier «…» y cualquier
    // reescritura de la explicación rompen aquí.
    await waitFor(() => expect(errorMock).toHaveBeenCalledWith(MOTIVO_DESCOMPUESTO));
    // Y también junto al campo: el toast se va solo, el error de campo se queda mientras se
    // corrige. Los dos, no uno.
    expect(await screen.findByText(MOTIVO_DESCOMPUESTO)).toBeInTheDocument();
  }, 25000);

  it("un validation_error del servidor en OTRO campo conserva el genérico", async () => {
    // La ficha no borra el genérico: lo aparta cuando hay un motivo del nombre.
    actualizarUsuarioMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { telefono: ["El teléfono no es válido"] },
    });
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await abrirEdicion(user);
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(errorMock).toHaveBeenCalledWith(GENERICO));
  }, 25000);

  it("⭑ un rechazo de la validación de CLIENTE conserva el genérico: su texto no es del servidor", async () => {
    // Dejar el nombre en blanco lo rechaza el zod del navegador, sin llegar a la acción, y su
    // mensaje está en inglés («Too small: expected string to have >=1 characters»). Reenviarlo al
    // toast sería cambiar un mensaje pobre por uno peor, así que aquí manda el genérico.
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await abrirEdicion(user);
    await user.clear(screen.getByLabelText("Nombre"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(errorMock).toHaveBeenCalledWith(GENERICO));
    expect(actualizarUsuarioMock).not.toHaveBeenCalled();
    // Ni una sola llamada al toast lleva el texto de zod, ni entero ni por dentro.
    for (const [texto] of errorMock.mock.calls as [string][]) {
      expect(texto).not.toContain("Too small");
    }
  }, 25000);
});
