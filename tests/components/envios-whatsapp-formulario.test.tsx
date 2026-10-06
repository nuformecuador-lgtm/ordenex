// @vitest-environment jsdom
//
// Ficha 474 (T10.3) — el FORMULARIO de un envío automático, sobre la maqueta aprobada. Cada caso
// nombra el requisito que vigila. Las actions se sustituyen: lo que se afirma es lo que la pantalla
// MANDA y lo que ENSEÑA, no la regla del servidor (esa la vigilan los tests del service).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type {
  DestinatarioPreviewDTO,
  EnvioDetalleDTO,
  EventoDisponibleDTO,
  InformeDTO,
} from "@/lib/types/envios-whatsapp";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const a = {
  crearEnvio: vi.fn(),
  actualizarEnvio: vi.fn(),
  encenderEnvio: vi.fn(),
  apagarEnvio: vi.fn(),
  borrarEnvio: vi.fn(),
  previsualizarDestinatarios: vi.fn(),
  probarEnvioWhatsapp: vi.fn(),
};
vi.mock("@/lib/actions/envios-whatsapp", () => ({
  crearEnvio: (...x: unknown[]) => a.crearEnvio(...x),
  actualizarEnvio: (...x: unknown[]) => a.actualizarEnvio(...x),
  encenderEnvio: (...x: unknown[]) => a.encenderEnvio(...x),
  apagarEnvio: (...x: unknown[]) => a.apagarEnvio(...x),
  borrarEnvio: (...x: unknown[]) => a.borrarEnvio(...x),
  previsualizarDestinatarios: (...x: unknown[]) => a.previsualizarDestinatarios(...x),
  probarEnvioWhatsapp: (...x: unknown[]) => a.probarEnvioWhatsapp(...x),
}));

import {
  EnvioForm,
  type PlantillaDeInformeOpcion,
} from "@/app/(app)/configuracion/envios-whatsapp/_components/EnvioForm";

const NOMBRE_DEST = { clave: "destinatario_nombre", nombre: "Nombre del destinatario", descripcion: "", ejemplo: "Daniel" };

const INFORMES: InformeDTO[] = [
  {
    clave: "prueba_envio",
    nombre: "Prueba de envío",
    descripcion: "Manda la fecha y la hora.",
    generaDocumento: true,
    aptoParaAdminTienda: true,
    soloPorEvento: false,
    eventos: [],
    parametrosPorDefecto: { simularVacio: false },
    descriptores: [{ campo: "simularVacio", etiqueta: "Simular vacío", tipo: "booleano" }],
    variables: [
      { clave: "fecha", nombre: "Fecha", descripcion: "", ejemplo: "05/10/2026" },
      { clave: "hora", nombre: "Hora", descripcion: "", ejemplo: "05:00" },
      NOMBRE_DEST,
    ],
  },
  {
    clave: "aviso_interno",
    nombre: "Aviso de la app",
    descripcion: "Reenvía un aviso de la campana.",
    generaDocumento: false,
    aptoParaAdminTienda: false,
    soloPorEvento: true,
    eventos: ["geocodificacion_caida", "cierre_dia_por_aprobar"],
    parametrosPorDefecto: {},
    descriptores: [],
    variables: [
      { clave: "titulo", nombre: "Qué pasó", descripcion: "", ejemplo: "Cierre del día por aprobar" },
      { clave: "texto", nombre: "Texto del aviso", descripcion: "", ejemplo: "Hay un cierre esperando" },
      NOMBRE_DEST,
    ],
  },
];

const EVENTOS: EventoDisponibleDTO[] = [
  { clave: "geocodificacion_caida", nombre: "El servicio de mapas rechaza las peticiones", descripcion: "Uno por día." },
  { clave: "cierre_dia_por_aprobar", nombre: "Cierre del día por aprobar", descripcion: "Uno por cierre." },
  // Disponible en el catálogo, pero el informe «Aviso de la app» de este test NO lo ofrece.
  { clave: "webhook_suscripcion_pausada", nombre: "Un webhook lleva fallando", descripcion: "Uno por racha." },
];

const PLANTILLAS: PlantillaDeInformeOpcion[] = [
  {
    id: "p_doc",
    nombre: "prueba_con_pdf",
    cuerpo: "Buenos días {{destinatario_nombre}}. Prueba del {{fecha}} a las {{hora}}.",
    informeClave: "prueba_envio",
    llevaDocumento: true,
  },
  { id: "p_sin", nombre: "prueba_sin_pdf", cuerpo: "Hola {{fecha}}", informeClave: "prueba_envio", llevaDocumento: false },
  { id: "p_aviso", nombre: "aviso_app", cuerpo: "{{titulo}}: {{texto}}", informeClave: "aviso_interno", llevaDocumento: false },
];

function persona(o: Partial<DestinatarioPreviewDTO> & Pick<DestinatarioPreviewDTO, "usuarioId" | "nombre" | "rol">): DestinatarioPreviewDTO {
  return { telefonoEnmascarado: "•••• 3344", telefonoValido: true, telefonoCompartido: false, ...o };
}
const PERSONAS: DestinatarioPreviewDTO[] = [
  persona({ usuarioId: "u_daniel", nombre: "Daniel Mora", rol: "maestro" }),
  persona({ usuarioId: "u_karla", nombre: "Karla Méndez", rol: "admin", telefonoEnmascarado: "—", telefonoValido: false }),
  persona({ usuarioId: "u_ana", nombre: "Ana Tienda", rol: "adminTienda" }),
];

const ENVIO: EnvioDetalleDTO = {
  id: "e1",
  nombre: "Prueba diaria",
  informeClave: "prueba_envio",
  informeNombre: "Prueba de envío",
  plantillaId: "p_doc",
  plantillaNombre: "prueba_con_pdf",
  disparo: "hora_fija",
  diasSemana: [1, 2, 3],
  hora: "05:00",
  eventoClave: null,
  eventoNombre: null,
  activo: false,
  proximaEjecucion: null,
  avisoSinProxima: false,
  ultimaEjecucion: null,
  parametros: { simularVacio: false },
  destinatarios: { roles: ["maestro"], usuarioIds: [] },
};

function preview(dest: DestinatarioPreviewDTO[]) {
  return {
    status: "ok",
    preview: { destinatarios: dest, total: dest.length, avisos: [], excedeTope: dest.length > 50, tope: 50 },
  };
}

function montar(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

function formulario(envio: EnvioDetalleDTO | null = null) {
  return montar(
    <EnvioForm envio={envio} informes={INFORMES} eventos={EVENTOS} plantillas={PLANTILLAS} personas={PERSONAS} />,
  );
}

async function elegir(user: ReturnType<typeof userEvent.setup>, combo: string, opcion: string) {
  await user.click(screen.getByRole("combobox", { name: combo }));
  const lista = await screen.findByRole("listbox", {}, { timeout: 3000 });
  await user.click(within(lista).getByRole("option", { name: opcion }));
}

beforeEach(() => {
  vi.clearAllMocks();
  a.previsualizarDestinatarios.mockImplementation(async (sel: { roles: string[]; usuarioIds: string[] }) =>
    preview(PERSONAS.filter((p) => sel.roles.includes(p.rol) || sel.usuarioIds.includes(p.usuarioId))),
  );
  a.crearEnvio.mockImplementation(async (input: unknown) => ({ status: "ok", envio: { ...ENVIO, id: "nuevo", ...(input as object) } }));
  a.actualizarEnvio.mockImplementation(async (_id: string, input: unknown) => ({ status: "ok", envio: { ...ENVIO, ...(input as object) } }));
});

afterEach(() => cleanup());

describe("R11/R13/R15 — crear un envío", () => {
  it("nace apagado: dice «Se guarda apagado», guarda con lo elegido y NO enciende", async () => {
    const user = userEvent.setup();
    formulario();
    expect(screen.getByText("Se guarda apagado")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Nombre del envío"), "Prueba diaria");
    await elegir(user, "Plantilla", "prueba_con_pdf · lleva documento");
    await user.click(screen.getByRole("checkbox", { name: /^Maestro,/ }));
    for (const dia of ["Lunes", "Martes", "Miércoles"]) await user.click(screen.getByRole("button", { name: dia }));
    await user.type(screen.getByLabelText("A las (hora de Costa Rica)"), "05:00");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(a.crearEnvio).toHaveBeenCalledTimes(1));
    expect(a.crearEnvio).toHaveBeenCalledWith({
      nombre: "Prueba diaria",
      informeClave: "prueba_envio",
      plantillaId: "p_doc",
      // R13: los valores por defecto del informe, precargados.
      parametros: { simularVacio: false },
      disparo: "hora_fija",
      diasSemana: [1, 2, 3],
      hora: "05:00",
      eventoClave: null,
      destinatarios: { roles: ["maestro"], usuarioIds: [] },
    });
    expect(a.encenderEnvio).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith("/configuracion/envios-whatsapp");
  });

  it("R13: pinta los parámetros desde los descriptores y el error por campo del servidor", async () => {
    const user = userEvent.setup();
    a.crearEnvio.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { "parametros.simularVacio": ["Tiene que ser sí o no"], nombre: ["El nombre es obligatorio"] },
    });
    formulario();
    expect(screen.getByRole("switch", { name: "Simular vacío" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Tiene que ser sí o no")).toBeInTheDocument();
    expect(screen.getByText("El nombre es obligatorio")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("R11: un nombre repetido se dice en el campo nombre", async () => {
    const user = userEvent.setup();
    a.crearEnvio.mockResolvedValue({ status: "conflict", campo: "nombre" });
    formulario();
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Ya hay otro envío con ese nombre.")).toBeInTheDocument();
  });
});

describe("R12 + maqueta — la plantilla manda sobre el PDF", () => {
  it("solo ofrece las plantillas del informe elegido", async () => {
    const user = userEvent.setup();
    formulario();
    await user.click(screen.getByRole("combobox", { name: "Plantilla" }));
    const lista = await screen.findByRole("listbox", {}, { timeout: 3000 });
    const opciones = within(lista).getAllByRole("option").map((o) => o.textContent);
    expect(opciones).toEqual(["prueba_con_pdf · lleva documento", "prueba_sin_pdf"]);
  });

  it("informe que genera PDF + plantilla SIN documento: avisa y no deja guardar ni probar", async () => {
    const user = userEvent.setup();
    formulario();
    await elegir(user, "Plantilla", "prueba_sin_pdf");
    expect(screen.getByRole("alert")).toHaveTextContent("Esta plantilla no lleva documento");
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Probar ahora (solo a mí)" })).toBeDisabled();

    await elegir(user, "Plantilla", "prueba_con_pdf · lleva documento");
    expect(screen.queryByText("Esta plantilla no lleva documento")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
  });
});

describe("R14/R49 — «Cuando pase algo»", () => {
  it("cambia a «Aviso de la app» y ofrece SOLO los eventos disponibles que ese informe da, con su nombre", async () => {
    const user = userEvent.setup();
    formulario();
    await user.click(screen.getByRole("radio", { name: "Cuando pase algo" }));

    expect(screen.getByRole("button", { name: "Aviso de la app" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("combobox", { name: "Qué tiene que pasar" }));
    const lista = await screen.findByRole("listbox", {}, { timeout: 3000 });
    const opciones = within(lista).getAllByRole("option").map((o) => o.textContent);
    expect(opciones).toEqual(["El servicio de mapas rechaza las peticiones", "Cierre del día por aprobar"]);
    // Nunca la sigla: lenguaje claro en toda la pantalla.
    expect(document.body.textContent).not.toMatch(/\bSLA\b/);
  });

  it("guarda el evento elegido sin días ni hora", async () => {
    const user = userEvent.setup();
    formulario();
    await user.type(screen.getByLabelText("Nombre del envío"), "Aviso mapas");
    await user.click(screen.getByRole("radio", { name: "Cuando pase algo" }));
    await elegir(user, "Plantilla", "aviso_app");
    await elegir(user, "Qué tiene que pasar", "El servicio de mapas rechaza las peticiones");
    await user.click(screen.getByRole("checkbox", { name: /^Maestro,/ }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(a.crearEnvio).toHaveBeenCalled());
    expect(a.crearEnvio.mock.calls[0][0]).toMatchObject({
      informeClave: "aviso_interno",
      plantillaId: "p_aviso",
      disparo: "evento",
      eventoClave: "geocodificacion_caida",
      diasSemana: [],
      hora: null,
      parametros: {},
    });
  });
});

describe("R16/R17 — a quién", () => {
  it("R16: ofrece «Admin de tienda» con su conteo; con un informe no apto lo dice en claro y enseña el rechazo del servidor", async () => {
    const user = userEvent.setup();
    a.crearEnvio.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { destinatarios: ["Este informe no se puede enviar a un admin de tienda"] },
    });
    formulario();
    // El conteo va en el nombre accesible: una persona con ese rol en el catálogo.
    expect(screen.getByRole("checkbox", { name: "Admin de tienda, 1 persona" })).toBeInTheDocument();

    // «Prueba de envío» SÍ es apto: sin aviso.
    await user.click(screen.getByRole("checkbox", { name: /^Admin de tienda,/ }));
    expect(screen.queryByText(/no se puede enviar a un admin de tienda: lleva datos/)).not.toBeInTheDocument();

    // «Aviso de la app» NO lo es.
    await user.click(screen.getByRole("radio", { name: "Cuando pase algo" }));
    expect(screen.getByText(/Este informe no se puede enviar a un admin de tienda: lleva datos/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Este informe no se puede enviar a un admin de tienda")).toBeInTheDocument();
  });

  it("R17: muestra la lista resuelta y avisa de los teléfonos que no sirven, SIN impedir guardar", async () => {
    const user = userEvent.setup();
    formulario();
    await user.click(screen.getByRole("checkbox", { name: /^Admin,/ }));
    await user.click(screen.getByRole("checkbox", { name: /^Maestro,/ }));

    const lista = await screen.findByRole("list", { name: "Quiénes lo recibirán" });
    expect(within(lista).getAllByRole("listitem").map((l) => l.textContent)).toEqual([
      expect.stringContaining("Daniel Mora"),
      expect.stringContaining("Karla Méndez"),
    ]);
    expect(
      screen.getByText((_, el) => el?.tagName === "P" && (el.textContent ?? "").startsWith("Lo recibirán")),
    ).toHaveTextContent("Lo recibirán 2 personas");
    const aviso = screen.getByText("1 persona no lo va a recibir: su teléfono no sirve para WhatsApp").parentElement as HTMLElement;
    expect(aviso).toHaveTextContent("Karla Méndez");
    expect(aviso).toHaveTextContent("Se puede guardar igual");

    await elegir(user, "Plantilla", "prueba_con_pdf · lleva documento");
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(a.crearEnvio).toHaveBeenCalledTimes(1));
  });

  it("R17: avisa del teléfono compartido entre dos destinatarios", async () => {
    a.previsualizarDestinatarios.mockResolvedValue(
      preview([
        persona({ usuarioId: "x1", nombre: "Uno", rol: "admin", telefonoCompartido: true }),
        persona({ usuarioId: "x2", nombre: "Dos", rol: "admin", telefonoCompartido: true }),
      ]),
    );
    formulario({ ...ENVIO, destinatarios: { roles: ["admin"], usuarioIds: [] } });
    expect(
      await screen.findByText("Estas personas comparten teléfono: ese número recibirá un mensaje por cada una"),
    ).toBeInTheDocument();
  });

  it("añade y quita personas sueltas buscando por nombre", async () => {
    const user = userEvent.setup();
    formulario();
    await user.type(screen.getByLabelText("Además, estas personas"), "dani");
    await user.click(within(screen.getByRole("list", { name: "Personas que coinciden" })).getByRole("button", { name: /Daniel Mora/ }));
    const elegidas = screen.getByRole("list", { name: "Personas elegidas" });
    expect(elegidas).toHaveTextContent("Daniel Mora");
    await waitFor(() =>
      expect(a.previsualizarDestinatarios).toHaveBeenLastCalledWith({ roles: [], usuarioIds: ["u_daniel"] }),
    );
    await user.click(screen.getByRole("button", { name: "Quitar a Daniel Mora" }));
    expect(screen.queryByRole("list", { name: "Personas elegidas" })).not.toBeInTheDocument();
  });
});

describe("R4/R53 — vista previa", () => {
  it("rellena con los ejemplos del informe y el nombre del primer destinatario, y dice de dónde sale cada dato", async () => {
    formulario(ENVIO);
    const texto = await screen.findByTestId("vista-previa-texto");
    await waitFor(() => expect(texto).toHaveTextContent("Buenos días Daniel. Prueba del 05/10/2026 a las 05:00."));
    expect(await screen.findByText("Lo que va a leer Daniel Mora")).toBeInTheDocument();
    const tabla = screen.getByRole("table", { name: "Variables de la plantilla y su valor de ejemplo" });
    const filas = within(tabla).getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(filas).toEqual(["{{1}}Nombre del destinatarioDaniel", "{{2}}Fecha05/10/2026", "{{3}}Hora05:00"]);
    expect(screen.getByText("Documento PDF del informe")).toBeInTheDocument();
  });
});

describe("R39–R41 — «Probar ahora», solo a quien pulsa", () => {
  it("sin cambios, prueba lo guardado sin volver a guardar y dice el resultado", async () => {
    const user = userEvent.setup();
    a.probarEnvioWhatsapp.mockResolvedValue({
      status: "ok",
      ejecucionId: "x",
      estado: "completada",
      motivo: null,
      entrega: { estado: "aceptada", motivo: null },
    });
    formulario(ENVIO);
    await user.click(screen.getByRole("button", { name: "Probar ahora (solo a mí)" }));
    await waitFor(() => expect(a.probarEnvioWhatsapp).toHaveBeenCalledWith("e1"));
    expect(a.actualizarEnvio).not.toHaveBeenCalled();
    // El resultado se pinta EN la pantalla (además del aviso flotante): la misma respuesta (R39).
    const enLinea = (await screen.findAllByText("Prueba enviada a tu WhatsApp: aceptado por whatsapp.")).filter(
      (el) => el.tagName === "P",
    );
    expect(enLinea).toHaveLength(1);
  });

  it("con cambios sin guardar, guarda antes y luego prueba", async () => {
    const user = userEvent.setup();
    a.probarEnvioWhatsapp.mockResolvedValue({ status: "demasiado_pronto", segundosRestantes: 12 });
    formulario(ENVIO);
    await user.type(screen.getByLabelText("Nombre del envío"), " 2");
    await user.click(screen.getByRole("button", { name: "Probar ahora (solo a mí)" }));
    await waitFor(() => expect(a.probarEnvioWhatsapp).toHaveBeenCalled());
    expect(a.actualizarEnvio).toHaveBeenCalledTimes(1);
    expect(a.actualizarEnvio.mock.invocationCallOrder[0]).toBeLessThan(a.probarEnvioWhatsapp.mock.invocationCallOrder[0]);
    // R41
    expect(
      (await screen.findAllByText("Acabas de probar este envío. Espera 12 segundos para volver a probarlo.")).length,
    ).toBeGreaterThan(0);
  });

  it("R40: teléfono de quien pulsa inválido: lo dice", async () => {
    const user = userEvent.setup();
    a.probarEnvioWhatsapp.mockResolvedValue({ status: "telefono_invalido", mensaje: "Tu teléfono no sirve para WhatsApp." });
    formulario(ENVIO);
    await user.click(screen.getByRole("button", { name: "Probar ahora (solo a mí)" }));
    expect((await screen.findAllByText("Tu teléfono no sirve para WhatsApp.")).length).toBeGreaterThan(0);
  });

  it("un envío NUEVO se guarda (apagado) antes de probar y la dirección pasa a la de edición", async () => {
    const user = userEvent.setup();
    a.probarEnvioWhatsapp.mockResolvedValue({ status: "ok", ejecucionId: "x", estado: "error", motivo: "WhatsApp no está configurado", entrega: null });
    formulario();
    await elegir(user, "Plantilla", "prueba_con_pdf · lleva documento");
    await user.click(screen.getByRole("button", { name: "Probar ahora (solo a mí)" }));
    await waitFor(() => expect(a.probarEnvioWhatsapp).toHaveBeenCalledWith("nuevo"));
    expect(a.crearEnvio).toHaveBeenCalledTimes(1);
    expect(a.encenderEnvio).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/configuracion/envios-whatsapp/nuevo");
    expect((await screen.findAllByText("La prueba no salió: error — WhatsApp no está configurado.")).length).toBeGreaterThan(0);
  });
});

describe("R18/R21 — encender y borrar desde la edición", () => {
  it("R18: si no se puede encender, dice por qué y el interruptor sigue apagado", async () => {
    const user = userEvent.setup();
    a.encenderEnvio.mockResolvedValue({ status: "no_encendible", motivos: ["Ningún destinatario activo tiene un teléfono válido"] });
    formulario(ENVIO);
    const sw = screen.getByRole("switch", { name: "Envío encendido" });
    await user.click(sw);
    expect(await screen.findByText("Ningún destinatario activo tiene un teléfono válido")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Envío encendido" })).not.toBeChecked();
  });

  it("R21: borrar pide confirmación y avisa de que el historial se conserva", async () => {
    const user = userEvent.setup();
    a.borrarEnvio.mockResolvedValue({ status: "ok" });
    formulario(ENVIO);
    await user.click(screen.getByRole("button", { name: "Borrar envío" }));
    const dialogo = await screen.findByRole("dialog");
    expect(dialogo).toHaveTextContent("Su historial se conserva.");
    await user.click(within(dialogo).getByRole("button", { name: "Borrar" }));
    await waitFor(() => expect(a.borrarEnvio).toHaveBeenCalledWith("e1"));
    expect(router.push).toHaveBeenCalledWith("/configuracion/envios-whatsapp");
  });
});
