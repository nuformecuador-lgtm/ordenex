// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ProvinciaArbolDTO } from "@/lib/actions/geografia";

/**
 * ⭑ FICHA 392 — EL FORMULARIO DE ZONAS AVISA DE UN NOMBRE QUE LA ETIQUETA NO PUEDE IMPRIMIR.
 *
 * El nombre de la zona SE IMPRIME en la etiqueta: es la primera parte de `ubicacion`
 * (`zona / provincia / cantón / distrito`). Desde la mitad de servidor de esta ficha, crear o
 * actualizar una zona con un carácter que la fuente no cubre termina en `validation_error` con el
 * motivo YA REDACTADO colgando de `fieldErrors.nombre`.
 *
 * Lo que se mide aquí es una sola cosa: que ese motivo llegue ENTERO al toast, en lugar del
 * genérico. El genérico —«Revisa los campos: el formulario está incompleto.»— manda a buscar un
 * campo vacío que no existe: el formulario está COMPLETO y lo que falla es un carácter que ni
 * siquiera se distingue a simple vista.
 *
 * Es la MISMA forma que la 376/R23 estrenó en este archivo de componente para la marca de zona
 * central: reenviar el motivo del servidor tal cual en vez de un texto propio.
 *
 * **LOS TEXTOS SON LITERALES ESCRITOS A MANO**, copiados del mensaje que produce el servidor y no
 * importados de él: compararlos contra la función que los genera estaría siempre verde, porque
 * recortar la frase cambiaría las dos mitades a la vez.
 */

const crearZonaMock = vi.fn();
const actualizarZonaMock = vi.fn();
const impactoZonaCentralMock = vi.fn();
vi.mock("@/lib/actions/zonas", () => ({
  crearZona: (...a: unknown[]) => crearZonaMock(...a),
  actualizarZona: (...a: unknown[]) => actualizarZonaMock(...a),
  impactoZonaCentral: (...a: unknown[]) => impactoZonaCentralMock(...a),
}));

vi.mock("@/lib/actions/tarifas", () => ({
  crearTarifa: vi.fn(),
  actualizarTarifa: vi.fn(),
}));

vi.mock("@/lib/actions/geografia", () => ({
  actualizarDistritosEspeciales: vi.fn().mockResolvedValue({ status: "ok" }),
  listarArbolGeografico: vi.fn(),
}));

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

const { CrearZonaForm, cobroVacio } = await import(
  "@/app/(app)/configuracion/tarifas/_components/CrearZonaForm"
);

/** El genérico que esta ficha aparta cuando el motivo es del nombre. */
const GENERICO = "Revisa los campos: el formulario está incompleto.";

/** Reparable, y la sugerencia SE DISTINGUE de lo tecleado: el mensaje la enseña. */
const MOTIVO_CON_SUGERENCIA =
  "«nombre» lleva un carácter que la etiqueta no puede imprimir: «⁨𝕋⁩» (U+1D54B). " +
  "Escríbelo así: «Tienda Feliz».";

/**
 * El largo: una «ñ» escrita como «n» + tilde suelta. Se PINTA igual que la de siempre, así que el
 * mensaje no puede limitarse a sugerir un texto idéntico al tecleado — tiene que explicar lo que no
 * se ve. Es el que más tienta a resumir y el que menos se puede resumir.
 */
const MOTIVO_DESCOMPUESTO =
  "«nombre» lleva un carácter que la etiqueta no puede imprimir: «⁨̃⁩» (U+0303). " +
  "Aquí no hay nada que se vea mal: ese carácter se ve igual que el de siempre pero está " +
  "escrito de otra forma —lo normal es que la letra y su acento vayan por separado—, y así no " +
  "se puede imprimir. Bórralo y vuelve a teclearlo; copiar y pegar el mismo texto lo trae otra " +
  "vez igual.";

/** Árbol mínimo con un solo distrito, suficiente para montar el selector. */
function arbol(): ProvinciaArbolDTO[] {
  return [
    {
      id: "p1",
      nombre: "San José",
      activo: true,
      cantones: [
        {
          id: "c1",
          nombre: "Central",
          activo: true,
          distritos: [
            {
              id: "d1",
              nombre: "Carmen",
              zonaId: null,
              zonaNombre: null,
              zonaEspecial: false,
              activo: true,
            },
          ],
        },
      ],
    },
  ];
}

/** Formulario ya con nombre y distrito precargados: aquí sólo se mide el aviso del rechazo. */
function renderForm(opts: { mode: "crear" | "editar"; zonaId?: string }) {
  return render(
    <CrearZonaForm
      mode={opts.mode}
      provincias={arbol()}
      vehiculos={[]}
      zonas={[]}
      initial={{
        zonaId: opts.zonaId,
        nombre: "Zona Feliz",
        distritoIds: ["d1"],
        cobro: cobroVacio(),
      }}
      onSaved={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

const botonGuardar = () => screen.getByRole("button", { name: "Guardar" });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("392 — el aviso del nombre que la etiqueta no puede imprimir", () => {
  it("al CREAR, el toast repite el motivo del servidor y no el genérico", async () => {
    crearZonaMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { nombre: [MOTIVO_CON_SUGERENCIA] },
    });
    const user = userEvent.setup();
    renderForm({ mode: "crear" });

    await user.click(botonGuardar());

    await waitFor(() => expect(errorMock).toHaveBeenCalledWith(MOTIVO_CON_SUGERENCIA));
    expect(errorMock).not.toHaveBeenCalledWith(GENERICO);
    expect(successMock).not.toHaveBeenCalled();
  });

  it("al CREAR, el motivo se pinta TAMBIÉN junto al campo del nombre", async () => {
    // El toast se va solo; el error de campo se queda mientras se corrige. Los dos, no uno.
    crearZonaMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { nombre: [MOTIVO_CON_SUGERENCIA] },
    });
    const user = userEvent.setup();
    renderForm({ mode: "crear" });

    await user.click(botonGuardar());

    expect(await screen.findByText(MOTIVO_CON_SUGERENCIA)).toBeInTheDocument();
  });

  it("al ACTUALIZAR, el motivo LARGO viaja entero: ni recortado ni resumido", async () => {
    actualizarZonaMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { nombre: [MOTIVO_DESCOMPUESTO] },
    });
    const user = userEvent.setup();
    renderForm({ mode: "editar", zonaId: "z-1" });

    await user.click(botonGuardar());

    // Igualdad EXACTA contra el literal: cualquier recorte, cualquier «…» y cualquier reescritura
    // de la explicación rompen aquí.
    await waitFor(() => expect(errorMock).toHaveBeenCalledWith(MOTIVO_DESCOMPUESTO));
    expect(errorMock).not.toHaveBeenCalledWith(GENERICO);
    expect(await screen.findByText(MOTIVO_DESCOMPUESTO)).toBeInTheDocument();
  });

  it("un validation_error de OTRO campo conserva el mensaje genérico", async () => {
    // La ficha no borra el genérico: lo aparta cuando hay un motivo del nombre.
    crearZonaMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { distritoIds: ["uno o mas distritoIds no existen"] },
    });
    const user = userEvent.setup();
    renderForm({ mode: "crear" });

    await user.click(botonGuardar());

    await waitFor(() => expect(errorMock).toHaveBeenCalledWith(GENERICO));
  });
});
