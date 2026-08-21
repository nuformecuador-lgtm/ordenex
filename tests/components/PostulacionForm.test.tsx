// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PostulacionForm } from "@/app/postulacion/_components/PostulacionForm";
import { postularMensajero } from "@/lib/actions/postulacion-mensajero";
import type { SelectOption } from "@/components/ui/select";
import type { PostularMensajeroActionResult } from "@/lib/types/postulacion-mensajero";

// Se mockea SOLO la Server Action (nunca se toca su implementacion). El
// componente sigue importando el schema real (postulacionSchema) de
// "@/lib/types/postulacion-mensajero", asi que la validacion de cliente que se
// ejercita es la real, no una reimplementada.
vi.mock("@/lib/actions/postulacion-mensajero", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/types/postulacion-mensajero")>();
  return {
    ...actual,
    postularMensajero: vi.fn(),
  };
});

// `comprimirImagen` SI se mockea aqui (a diferencia de
// GestionarOrdenPanelEvidencias.test.tsx, que la deja real porque sus File son
// <1 MB y el compresor los devuelve tal cual sin tocar canvas). Aqui hace falta
// el doble por dos razones: (1) para AFIRMAR que la postulacion la llama —era
// la unica superficie de subida que no la habia adoptado— y (2) porque los
// casos de tamano usan File con `size` falseado a megabytes, y el compresor
// real intentaria decodificarlos con createImageBitmap, que jsdom no tiene.
// Por defecto es la IDENTIDAD, que es justo lo que hace el compresor real ante
// un fallo: devolver el archivo ORIGINAL.
const { comprimirImagenMock } = vi.hoisted(() => ({
  comprimirImagenMock: vi.fn(async (file: File): Promise<File> => file),
}));
vi.mock("@/lib/utils/comprimir-imagen", () => ({
  comprimirImagen: comprimirImagenMock,
}));

// Este formulario es grande: llenarlo ejercita 8 inputs de texto, dos Select
// (portal base-ui) y 5 uploads por test. Bajo la suite completa (112 archivos
// en paralelo) el default de 5s se queda corto y provoca timeouts flaky, aunque
// aislado corre en ~2s. Se amplia el timeout del archivo; no cambia la logica.
vi.setConfig({ testTimeout: 25000 });

const mockedPostular = vi.mocked(postularMensajero);

const TIPOS: SelectOption[] = [
  { value: "tipo-cedula", label: "Cédula" },
  { value: "tipo-pasaporte", label: "Pasaporte" },
];
const VEHICULOS: SelectOption[] = [
  { value: "veh-moto", label: "Moto" },
  { value: "veh-carro", label: "Carro" },
];

function renderForm() {
  return render(
    <PostulacionForm tiposIdentificacion={TIPOS} vehiculos={VEHICULOS} />,
  );
}

// delay:null elimina los retardos de tecleo de userEvent: el formulario tiene
// muchos campos + dos Select (portal base-ui) + 5 uploads, y con retardos el
// llenado se vuelve lento y flaky bajo carga paralela. La validacion real no
// depende del tiempo entre teclas.
function setupUser() {
  return userEvent.setup({ delay: null });
}

/** Abre un Select base-ui por su nombre accesible y elige la opcion indicada. */
async function selectOption(
  user: ReturnType<typeof userEvent.setup>,
  comboboxName: string,
  optionName: string,
) {
  await user.click(screen.getByRole("combobox", { name: comboboxName }));
  const listbox = await screen.findByRole("listbox", {}, { timeout: 3000 });
  await user.click(within(listbox).getByRole("option", { name: optionName }));
}

function imagen(nombre: string): File {
  return new File(["contenido-binario"], nombre, { type: "image/jpeg" });
}

/**
 * Imagen con un `size` FALSEADO. El caso real de produccion son 5 fotos de
 * 2,16 MB (~10,8 MB en total); materializar esos bytes en jsdom es caro y no
 * aporta nada, porque tanto el schema como la validacion del total solo leen
 * `.size`.
 */
function imagenDe(nombre: string, bytes: number): File {
  const file = imagen(nombre);
  Object.defineProperty(file, "size", { value: bytes });
  return file;
}

/** 2,16 MB: el tamano REAL de cada documento del caso de produccion. */
const BYTES_FOTO_REAL = Math.round(2.16 * 1024 * 1024); // 2.264.924 B

/** Sube los 5 documentos con el tamano indicado, sobre un formulario ya montado. */
async function subirDocumentos(
  user: ReturnType<typeof userEvent.setup>,
  build: (slug: string) => File,
) {
  await user.upload(screen.getByLabelText("Cédula (anverso)"), build("ca"));
  await user.upload(screen.getByLabelText("Cédula (reverso)"), build("cr"));
  await user.upload(
    screen.getByLabelText("Tarjeta de propiedad (anverso)"),
    build("pa"),
  );
  await user.upload(
    screen.getByLabelText("Tarjeta de propiedad (reverso)"),
    build("pr"),
  );
  await user.upload(screen.getByLabelText("Foto de rostro"), build("fr"));
}

/** Rellena todos los campos con valores validos para pasar la validacion zod. */
async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Nombres"), "Juan");
  await user.type(screen.getByLabelText("Primer apellido"), "Pérez");
  await user.type(screen.getByLabelText("Correo electrónico"), "juan@example.com");
  await user.type(screen.getByLabelText("Teléfono"), "0987654321");
  await user.type(screen.getByLabelText("Número de documento"), "1712345678");
  await user.type(screen.getByLabelText("Placa"), "abc123");
  await user.type(screen.getByLabelText("Contraseña"), "Passw0rd!");
  await user.type(screen.getByLabelText("Confirmar contraseña"), "Passw0rd!");

  // Selects (base-ui combobox): abrir y elegir opcion.
  await selectOption(user, "Tipo de documento", "Cédula");
  await selectOption(user, "Vehículo", "Moto");

  // Los 5 documentos.
  await user.upload(screen.getByLabelText("Cédula (anverso)"), imagen("ca.jpg"));
  await user.upload(screen.getByLabelText("Cédula (reverso)"), imagen("cr.jpg"));
  await user.upload(
    screen.getByLabelText("Tarjeta de propiedad (anverso)"),
    imagen("pa.jpg"),
  );
  await user.upload(
    screen.getByLabelText("Tarjeta de propiedad (reverso)"),
    imagen("pr.jpg"),
  );
  await user.upload(screen.getByLabelText("Foto de rostro"), imagen("fr.jpg"));
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks borra las llamadas, no las implementaciones; se reafirma la
  // identidad por si un caso anterior la cambio.
  comprimirImagenMock.mockImplementation(async (file: File) => file);
  cleanup();
});

describe("PostulacionForm — render de campos (R2, R3)", () => {
  it("renderiza los campos de texto, selects y los 5 documentos con labels asociadas", () => {
    renderForm();

    expect(screen.getByLabelText("Nombres")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Primer apellido")).toBeInTheDocument();
    expect(screen.getByLabelText("Segundo apellido (opcional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Correo electrónico")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Teléfono")).toBeInTheDocument();
    expect(screen.getByLabelText("Número de documento")).toBeInTheDocument();
    expect(screen.getByLabelText("Placa")).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Confirmar contraseña")).toHaveAttribute(
      "type",
      "password",
    );

    expect(
      screen.getByRole("combobox", { name: "Tipo de documento" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Vehículo" })).toBeInTheDocument();

    for (const label of [
      "Cédula (anverso)",
      "Cédula (reverso)",
      "Tarjeta de propiedad (anverso)",
      "Tarjeta de propiedad (reverso)",
      "Foto de rostro",
    ]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("type", "file");
    }

    expect(
      screen.getByRole("button", { name: "Enviar postulación" }),
    ).toHaveAttribute("type", "submit");
  });
});

describe("PostulacionForm — validacion de cliente (R2, R5, R10)", () => {
  it("bloquea el envio y muestra errores por campo cuando faltan datos, sin invocar la action", async () => {
    const user = setupUser();
    renderForm();

    await user.click(screen.getByRole("button", { name: "Enviar postulación" }));

    // El campo email muestra su error asociado por aria-describedby.
    await waitFor(() => {
      const email = screen.getByLabelText("Correo electrónico");
      expect(email).toHaveAttribute("aria-invalid", "true");
    });
    expect(mockedPostular).not.toHaveBeenCalled();
  });

  it("R5: email invalido produce error en el campo email y no invoca la action", async () => {
    const user = setupUser();
    renderForm();

    await user.type(screen.getByLabelText("Correo electrónico"), "no-es-correo");
    await user.click(screen.getByRole("button", { name: "Enviar postulación" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Correo electrónico")).toHaveAttribute(
        "aria-invalid",
        "true",
      ),
    );
    expect(mockedPostular).not.toHaveBeenCalled();
  });

  it("R7: password y confirmacion distintas producen error de confirmacion y no invoca la action", async () => {
    const user = setupUser();
    renderForm();

    await fillValid(user);
    // Sobrescribir la confirmacion para que no coincida.
    const confirm = screen.getByLabelText("Confirmar contraseña");
    await user.clear(confirm);
    await user.type(confirm, "Otra0Clave!");

    await user.click(screen.getByRole("button", { name: "Enviar postulación" }));

    expect(
      await screen.findByText("las contrasenas no coinciden"),
    ).toBeInTheDocument();
    expect(mockedPostular).not.toHaveBeenCalled();
  });
});

describe("PostulacionForm — envio exitoso (R26)", () => {
  it("con datos validos invoca postularMensajero con FormData y muestra la confirmacion", async () => {
    mockedPostular.mockResolvedValue({ status: "ok" });
    const user = setupUser();
    renderForm();

    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Enviar postulación" }));

    await waitFor(() => expect(mockedPostular).toHaveBeenCalledTimes(1));
    const formData = mockedPostular.mock.calls[0][0] as FormData;
    expect(formData).toBeInstanceOf(FormData);
    expect(formData.get("email")).toBe("juan@example.com");
    expect(formData.get("tipo_identificacion_id")).toBe("tipo-cedula");
    expect(formData.get("vehiculo_id")).toBe("veh-moto");
    expect(formData.get("cedula_anverso")).toBeInstanceOf(File);

    // R26: confirmacion visible, sin redireccion a zona autenticada.
    expect(await screen.findByText("Postulación enviada")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Enviar postulación" }),
    ).not.toBeInTheDocument();
  });
});

describe("PostulacionForm — conflicto de duplicado (A3, R19, R20)", () => {
  it("conflict('email') pinta el error especifico en el campo email", async () => {
    mockedPostular.mockResolvedValue({ status: "conflict", field: "email" });
    const user = setupUser();
    renderForm();

    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Enviar postulación" }));

    const error = await screen.findByText("Este correo ya está registrado");
    const container = error.closest('[role="alert"]');
    expect(container).not.toBeNull();
    expect(screen.getByLabelText("Correo electrónico")).toHaveAttribute(
      "aria-describedby",
      container!.id,
    );
  });

  it("conflict('cedula') pinta el error especifico en el campo numero de documento", async () => {
    mockedPostular.mockResolvedValue({ status: "conflict", field: "cedula" });
    const user = setupUser();
    renderForm();

    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Enviar postulación" }));

    const error = await screen.findByText(
      "Este número de documento ya está registrado",
    );
    const container = error.closest('[role="alert"]');
    expect(container).not.toBeNull();
    expect(screen.getByLabelText("Número de documento")).toHaveAttribute(
      "aria-describedby",
      container!.id,
    );
  });
});

describe("PostulacionForm — errores del servidor por campo y globales", () => {
  it("validation_error del servidor muestra el error bajo el campo correspondiente", async () => {
    mockedPostular.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { placa: ["placa rechazada por el servidor"] },
    } satisfies PostularMensajeroActionResult);
    const user = setupUser();
    renderForm();

    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Enviar postulación" }));

    const error = await screen.findByText("placa rechazada por el servidor");
    expect(error.closest('[role="alert"]')).not.toBeNull();
  });

  it("rate_limited muestra un aviso global sin marcar campos", async () => {
    mockedPostular.mockResolvedValue({ status: "rate_limited" });
    const user = setupUser();
    renderForm();

    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Enviar postulación" }));

    expect(await screen.findByText(/demasiadas postulaciones/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// El defecto de produccion: 5 documentos de 2,16 MB pasan la validacion POR
// DOCUMENTO (5 MB) y revientan el techo del transporte
// (`serverActions.bodySizeLimit`, 5 MB para TODA la peticion). Next rechaza la
// peticion ANTES del codigo de la app: sin log, sin 4xx, sin 5xx, y la persona
// pierde todo lo escrito viendo "This page couldn't load".
// ---------------------------------------------------------------------------

describe("PostulacionForm — compresion en el cliente (capa 1)", () => {
  it("comprime CADA documento al elegirlo y es la version comprimida la que viaja", async () => {
    // El doble devuelve un archivo DISTINGUIBLE: asi el test no se conforma con
    // "se llamo", sino que exige que el resultado se USE. Un componente que
    // llamara a comprimirImagen y tirara el resultado seguiria roto en
    // produccion, y aqui saldria rojo.
    comprimirImagenMock.mockImplementation(
      async (file: File) =>
        new File(["comprimido"], file.name.replace(".jpg", "-comprimida.jpg"), {
          type: "image/jpeg",
        }),
    );
    mockedPostular.mockResolvedValue({ status: "ok" });
    const user = setupUser();
    renderForm();

    await fillValid(user);

    // Se llamo una vez por documento, con el archivo ORIGINAL.
    expect(comprimirImagenMock).toHaveBeenCalledTimes(5);
    expect(
      comprimirImagenMock.mock.calls.map(([f]) => (f as File).name),
    ).toEqual(["ca.jpg", "cr.jpg", "pa.jpg", "pr.jpg", "fr.jpg"]);

    await user.click(screen.getByRole("button", { name: "Enviar postulación" }));

    await waitFor(() => expect(mockedPostular).toHaveBeenCalledTimes(1));
    const formData = mockedPostular.mock.calls[0][0] as FormData;
    for (const [campo, esperado] of [
      ["cedula_anverso", "ca-comprimida.jpg"],
      ["cedula_reverso", "cr-comprimida.jpg"],
      ["propiedad_anverso", "pa-comprimida.jpg"],
      ["propiedad_reverso", "pr-comprimida.jpg"],
      ["foto_rostro", "fr-comprimida.jpg"],
    ] as const) {
      expect((formData.get(campo) as File).name).toBe(esperado);
    }
  });
});

describe("PostulacionForm — presupuesto del cuerpo de la peticion (capa 2)", () => {
  it("el caso real (5 x 2,16 MB) NO se envia y el aviso nombra el peso y el maximo", async () => {
    // La identidad del doble reproduce el peor caso honesto: `comprimirImagen`
    // devuelve el ORIGINAL ante cualquier fallo, asi que el total sigue siendo
    // el de las fotos crudas. Por eso la capa 2 tiene que existir.
    mockedPostular.mockResolvedValue({ status: "ok" });
    const user = setupUser();
    renderForm();

    await fillValid(user);
    await subirDocumentos(user, (slug) =>
      imagenDe(`${slug}.jpg`, BYTES_FOTO_REAL),
    );

    await user.click(screen.getByRole("button", { name: "Enviar postulación" }));

    // Lo primero, y lo que mas importa: NO se envio. Esto es lo que en
    // produccion se iba al transporte y moria sin log, sin 4xx y sin 5xx. Se
    // afirma ANTES que el mensaje: si el envio siguiera adelante, la pantalla
    // pasaria a la confirmacion y el aviso ni llegaria a pintarse, con lo que
    // el fallo se leeria como "falta el texto" en vez de "envio lo que no
    // debia".
    expect(mockedPostular).not.toHaveBeenCalled();
    expect(screen.queryByText("Postulación enviada")).not.toBeInTheDocument();

    // 5 x 2.264.924 B = 11.324.620 B = 10,8 MB, contra el presupuesto de 4 MB.
    // El aviso NOMBRA los dos numeros: sin ellos es un "error" generico y la
    // persona no sabe cuanto tiene que bajar.
    const aviso = await screen.findByText(/Los documentos pesan/);
    expect(aviso).toHaveTextContent("pesan 10.8 MB en total");
    expect(aviso).toHaveTextContent("máximo permitido es 4 MB");
    expect(aviso.closest('[role="alert"]')).not.toBeNull();
  });

  it("justo por debajo del presupuesto (5 x 800 KB) SI se envia", async () => {
    // Contraprueba: el tope no puede ser un muro que bloquee lo que si cabe.
    mockedPostular.mockResolvedValue({ status: "ok" });
    const user = setupUser();
    renderForm();

    await fillValid(user);
    await subirDocumentos(user, (slug) => imagenDe(`${slug}.jpg`, 800 * 1024));

    await user.click(screen.getByRole("button", { name: "Enviar postulación" }));

    await waitFor(() => expect(mockedPostular).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Los documentos pesan/)).not.toBeInTheDocument();
  });
});

describe("PostulacionForm — el fallo del envio nunca sale mudo (capa 3)", () => {
  it("si la action REVIENTA (red caida, 413 del transporte) se pinta un aviso en pantalla", async () => {
    mockedPostular.mockRejectedValue(new Error("Failed to fetch"));
    const user = setupUser();
    renderForm();

    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Enviar postulación" }));

    const aviso = await screen.findByText(/No se pudo enviar la postulación/);
    expect(aviso.closest('[role="alert"]')).not.toBeNull();
    // Y dice QUE HACER, que es la diferencia entre un aviso y un ruido.
    expect(aviso).toHaveTextContent(/imágenes más livianas/);

    // Sigue en el formulario con sus datos: no perdio lo que escribio, y el
    // boton vuelve a estar disponible para reintentar (un CTA que se queda en
    // "Enviando..." para siempre es otra forma de dejarlo tirado).
    expect(screen.getByLabelText("Correo electrónico")).toHaveValue(
      "juan@example.com",
    );
    const reintentar = await screen.findByRole("button", {
      name: "Enviar postulación",
    });
    expect(reintentar).toBeEnabled();
  });
});
