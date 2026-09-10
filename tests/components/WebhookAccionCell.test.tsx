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
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";

// Feature 105/T4 — celda orquestadora del modal de gestión de la suscripción.
// Se mockean las 4 Server Actions del contrato de la 104.
const obtenerWebhookMock = vi.fn();
const registrarWebhookMock = vi.fn();
const desactivarWebhookMock = vi.fn();
const rotarSecretoWebhookMock = vi.fn();
vi.mock("@/lib/actions/webhooks", () => ({
  obtenerWebhook: (...a: unknown[]) => obtenerWebhookMock(...a),
  registrarWebhook: (...a: unknown[]) => registrarWebhookMock(...a),
  desactivarWebhook: (...a: unknown[]) => desactivarWebhookMock(...a),
  rotarSecretoWebhook: (...a: unknown[]) => rotarSecretoWebhookMock(...a),
}));

import { WebhookAccionCell } from "@/app/(app)/configuracion/api/_components/WebhookAccionCell";

const OWNER = "u1";
const IDENT = "integracion-erp";
const URL_ACTIVA = "https://hook.example.com/callback";
const NUEVA_URL = "https://nueva.example.com/hook";
const SECRET = "whk_9f8e7d6c5b4a3210FEDCBA9876543210deadbeefcafef00d";

const OK_ACTIVA = {
  status: "ok" as const,
  webhook: { url: URL_ACTIVA, activa: true },
};
const OK_VACIO = { status: "ok" as const, webhook: null };

// ---------------------------------------------------------------------------------------
// FICHA 403 (T14) — la suscripción cuyos envíos están espaciados. `pausada` llega YA
// calculada del servidor (es un valor derivado que se reevalúa en cada `obtenerWebhook`):
// la pantalla no la deduce ni la recalcula, solo la cuenta.
// ---------------------------------------------------------------------------------------
const SIN_EXITO_ISO = "2026-09-09T13:05:00.000Z";
const OK_PAUSADA = {
  status: "ok" as const,
  webhook: {
    url: URL_ACTIVA,
    activa: true,
    pausada: true,
    sinExitoDesde: SIN_EXITO_ISO,
  },
};
const OK_NO_PAUSADA = {
  status: "ok" as const,
  webhook: {
    url: URL_ACTIVA,
    activa: true,
    pausada: false,
    sinExitoDesde: SIN_EXITO_ISO,
  },
};

// Mismo formato que la pantalla (es-EC, fecha corta + hora corta), construido aparte y NO
// importado de `fecha-legible`: compararlo contra su propia fuente estaría siempre verde.
const FECHA_HORA_ES_EC = new Intl.DateTimeFormat("es-EC", {
  dateStyle: "short",
  timeStyle: "short",
});

/** Los formateadores meten espacios finos/duros (U+202F, U+00A0) que el DOM conserva. */
function normalizar(texto: string): string {
  return texto.replace(/[\s  ]+/g, " ").trim();
}

/** El texto del aviso de envíos espaciados, tal como lo LEE una persona. */
function avisoDeEspaciado(): string {
  return normalizar(
    screen.getByText(/se están espaciando/i).textContent ?? "",
  );
}

function renderCell(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

/** Abre el modal de gestión y espera a que el estado cargue. */
async function abrir(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: `Editar webhook de ${IDENT}` }),
  );
  await screen.findByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  obtenerWebhookMock.mockResolvedValue(OK_VACIO);
  registrarWebhookMock.mockResolvedValue({ status: "actualizada" });
  desactivarWebhookMock.mockResolvedValue({ status: "ok" });
  rotarSecretoWebhookMock.mockResolvedValue({ status: "ok", secret: SECRET });
});

afterEach(() => {
  cleanup();
});

describe("WebhookAccionCell — rótulo del botón (feature 108: R15, R16)", () => {
  it("R15: el botón de la fila se rotula 'Editar' (no 'Webhook')", () => {
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    const boton = screen.getByRole("button", {
      name: `Editar webhook de ${IDENT}`,
    });
    expect(boton).toHaveTextContent("Editar");
    expect(
      screen.queryByRole("button", { name: `Gestionar webhook de ${IDENT}` }),
    ).toBeNull();
  });

  it("R16: 'Editar' abre el modal y lee el estado con obtenerWebhook", async () => {
    obtenerWebhookMock.mockResolvedValue(OK_ACTIVA);
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await user.click(
      screen.getByRole("button", { name: `Editar webhook de ${IDENT}` }),
    );

    await screen.findByRole("dialog");
    expect(obtenerWebhookMock).toHaveBeenCalledWith({ ownerUsuarioId: OWNER });
  });
});

describe("WebhookAccionCell — lectura del estado (R3, R4, R5)", () => {
  it("R3: owner con suscripción activa muestra la URL y el estado activa (vía obtenerWebhook)", async () => {
    obtenerWebhookMock.mockResolvedValue(OK_ACTIVA);
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);

    expect(obtenerWebhookMock).toHaveBeenCalledWith({ ownerUsuarioId: OWNER });
    expect(await screen.findByText(URL_ACTIVA)).toBeInTheDocument();
    expect(screen.getByText(/activa/i)).toBeInTheDocument();
  });

  it("R4: owner sin suscripción indica 'sin webhook' y ofrece registrar", async () => {
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);

    expect(
      await screen.findByText(/No hay webhook registrado/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar" })).toBeInTheDocument();
  });

  it("R5: la lectura del estado (obtenerWebhook) nunca renderiza el secreto", async () => {
    obtenerWebhookMock.mockResolvedValue(OK_ACTIVA);
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(URL_ACTIVA);

    expect(document.body.textContent).not.toContain(SECRET);
    expect(
      screen.queryByLabelText("Secreto de webhook generado"),
    ).toBeNull();
  });
});

describe("WebhookAccionCell — registrar / editar (R7b, R12, R16, R18)", () => {
  it("R7b: registrar con resultado 'actualizada' NO abre el modal de secreto; confirma y refresca", async () => {
    obtenerWebhookMock.mockResolvedValue(OK_ACTIVA);
    registrarWebhookMock.mockResolvedValue({ status: "actualizada" });
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(URL_ACTIVA);

    await user.click(screen.getByRole("button", { name: "Guardar URL" }));

    await waitFor(() =>
      expect(obtenerWebhookMock).toHaveBeenCalledTimes(2),
    ); // R18: re-lectura tras la mutación
    expect(
      screen.queryByLabelText("Secreto de webhook generado"),
    ).toBeNull(); // R7b: sin secreto al editar la URL
  });

  it("R12: forbidden muestra mensaje claro y no cierra destructivamente", async () => {
    registrarWebhookMock.mockResolvedValue({ status: "forbidden" });
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(/No hay webhook registrado/i);

    await user.type(screen.getByLabelText("URL de callback"), NUEVA_URL);
    await user.click(screen.getByRole("button", { name: "Registrar" }));

    expect(
      await screen.findByText(/No tienes permiso para esta acción/i),
    ).toBeInTheDocument();
    // El modal de gestión sigue abierto (no se pierde lo ingresado).
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("URL de callback")).toHaveValue(NUEVA_URL);
  });

  it("R16: mientras registrar está en curso, un segundo envío no dispara otra llamada", async () => {
    let resolver!: (v: { status: "actualizada" }) => void;
    registrarWebhookMock.mockImplementation(
      () => new Promise((res) => (resolver = res)),
    );
    obtenerWebhookMock.mockResolvedValue(OK_VACIO);
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(/No hay webhook registrado/i);

    await user.type(screen.getByLabelText("URL de callback"), NUEVA_URL);
    const btn = screen.getByRole("button", { name: "Registrar" });
    await user.click(btn);
    await user.click(btn);

    expect(registrarWebhookMock).toHaveBeenCalledTimes(1);
    resolver({ status: "actualizada" });
  });

  it("R18: registrar 'creada' abre el revelado y re-lee el estado del owner", async () => {
    registrarWebhookMock.mockResolvedValue({ status: "creada", secret: SECRET });
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(/No hay webhook registrado/i);

    await user.type(screen.getByLabelText("URL de callback"), NUEVA_URL);
    await user.click(screen.getByRole("button", { name: "Registrar" }));

    // R7: revela el secreto de la ALTA una vez.
    expect(
      await screen.findByLabelText("Secreto de webhook generado"),
    ).toHaveValue(SECRET);
    // R18: re-lectura del estado tras la mutación.
    await waitFor(() => expect(obtenerWebhookMock).toHaveBeenCalledTimes(2));
  });
});

describe("WebhookAccionCell — dar de baja (R13, R14, R15)", () => {
  it("R13: dar de baja pide confirmación antes de invocar desactivarWebhook", async () => {
    obtenerWebhookMock.mockResolvedValue(OK_ACTIVA);
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(URL_ACTIVA);

    await user.click(screen.getByRole("button", { name: "Dar de baja" }));

    expect(
      await screen.findByText("Dar de baja el webhook"),
    ).toBeInTheDocument();
    expect(desactivarWebhookMock).not.toHaveBeenCalled();
  });

  it("R14: desactivar ok refleja 'sin webhook activo' sin recargar la página", async () => {
    obtenerWebhookMock
      .mockResolvedValueOnce(OK_ACTIVA)
      .mockResolvedValue(OK_VACIO);
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(URL_ACTIVA);

    await user.click(screen.getByRole("button", { name: "Dar de baja" }));
    await user.click(screen.getByRole("button", { name: "Sí, dar de baja" }));

    expect(desactivarWebhookMock).toHaveBeenCalledWith({ ownerUsuarioId: OWNER });
    expect(
      await screen.findByText(/No hay webhook registrado/i),
    ).toBeInTheDocument();
  });

  it("R15: sin suscripción activa NO se ofrece la acción de dar de baja", async () => {
    obtenerWebhookMock.mockResolvedValue(OK_VACIO);
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(/No hay webhook registrado/i);

    expect(
      screen.queryByRole("button", { name: "Dar de baja" }),
    ).toBeNull();
  });
});

describe("WebhookAccionCell — rotar secreto (R19, R20, R21)", () => {
  it("R19: 'Rotar secreto' solo se ofrece con suscripción activa", async () => {
    const user = userEvent.setup();

    // Sin suscripción: no se ofrece.
    obtenerWebhookMock.mockResolvedValue(OK_VACIO);
    const { unmount } = renderCell(
      <WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />,
    );
    await abrir(user);
    await screen.findByText(/No hay webhook registrado/i);
    expect(
      screen.queryByRole("button", { name: "Rotar secreto" }),
    ).toBeNull();
    unmount();
    cleanup();

    // Con suscripción activa: se ofrece.
    obtenerWebhookMock.mockResolvedValue(OK_ACTIVA);
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);
    await abrir(user);
    await screen.findByText(URL_ACTIVA);
    expect(
      screen.getByRole("button", { name: "Rotar secreto" }),
    ).toBeInTheDocument();
  });

  it("R20: rotar pide confirmación advirtiendo que invalida el secreto anterior", async () => {
    obtenerWebhookMock.mockResolvedValue(OK_ACTIVA);
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(URL_ACTIVA);

    await user.click(screen.getByRole("button", { name: "Rotar secreto" }));

    const confirm = await screen.findByText("Rotar el secreto del webhook");
    expect(confirm).toBeInTheDocument();
    expect(
      screen.getByText(/invalida el secreto anterior/i),
    ).toBeInTheDocument();
    expect(rotarSecretoWebhookMock).not.toHaveBeenCalled();
  });

  it("R21: rotarSecretoWebhook ok abre el revelado con el secreto NUEVO una sola vez", async () => {
    obtenerWebhookMock.mockResolvedValue(OK_ACTIVA);
    rotarSecretoWebhookMock.mockResolvedValue({ status: "ok", secret: SECRET });
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(URL_ACTIVA);

    await user.click(screen.getByRole("button", { name: "Rotar secreto" }));
    await user.click(screen.getByRole("button", { name: "Sí, rotar secreto" }));

    expect(rotarSecretoWebhookMock).toHaveBeenCalledWith({
      ownerUsuarioId: OWNER,
    });
    expect(
      await screen.findByLabelText("Secreto de webhook generado"),
    ).toHaveValue(SECRET);
  });
});

// =========================================================================================
// FICHA 403 (T14) — «SUS ENVÍOS ESTÁN ESPACIADOS», DICHO PARA QUIEN NO SABE DE COLAS
//
// El servidor ya decide y sirve el estado (`pausada`, `sinExitoDesde`); esta pantalla solo
// tiene que CONTARLO bien. Lo que se vigila aquí es exactamente lo que puede salir mal en la
// capa de presentación:
//   1. que el aviso APAREZCA cuando el servidor dice `pausada: true`;
//   2. que NO aparezca cuando dice `false` (un aviso permanente es tan inútil como ninguno);
//   3. que el texto NO suene a corte ni a baja —el dueño no tiene que hacer nada— y no
//      arrastre jerga («reintentos», «circuito», «backoff», «429») ni el timestamp crudo;
//   4. que tras «Guardar URL» se apague solo, sin recargar la página (R19).
// Los textos se afirman como LITERALES de lo que una persona lee: son el contrato de esta
// task, no un detalle de implementación.
// =========================================================================================
describe("WebhookAccionCell — envíos espaciados (ficha 403: R18, R19)", () => {
  it("R18: con `pausada: true` la pantalla avisa de que los envíos se están espaciando y desde cuándo", async () => {
    obtenerWebhookMock.mockResolvedValue(OK_PAUSADA);
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(URL_ACTIVA);

    const aviso = avisoDeEspaciado();
    const desde = normalizar(FECHA_HORA_ES_EC.format(new Date(SIN_EXITO_ISO)));
    expect(aviso).toBe(
      `Los envíos a este webhook se están espaciando: desde el ${desde} el ` +
        `destino no acepta ninguno. No hay que hacer nada: vuelven a su ritmo ` +
        `normal en cuanto el destino acepte un envío. Si ya está resuelto, ` +
        `guarda la URL de nuevo para reintentarlo ahora.`,
    );
  });

  it("R18: la fecha se lee como fecha, no como el timestamp crudo que llega de la acción", async () => {
    obtenerWebhookMock.mockResolvedValue(OK_PAUSADA);
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(URL_ACTIVA);

    const aviso = avisoDeEspaciado();
    expect(aviso).not.toContain(SIN_EXITO_ISO);
    expect(aviso).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/); // ISO-8601 en pantalla
    expect(aviso).toContain(
      normalizar(FECHA_HORA_ES_EC.format(new Date(SIN_EXITO_ISO))),
    );
  });

  it("PUNTUACIÓN: la fecha va EN MEDIO de la frase, y el aviso nunca se lee con un punto doble", async () => {
    // Esto no es quisquillosidad: `dateStyle: "short"` de es-EC devuelve «9/9/26, 8:05 a. m.»
    // -abreviatura CON punto-, así que dejar la fecha cerrando la frase producía «a. m..» en
    // producción. Solo se ve mirando el render, y ningún test anterior lo habría cazado.
    // Se vigilan las DOS causas: el punto doble (el síntoma) y la fecha al final de su frase
    // (la causa), para que tampoco vuelva por un ICU distinto -en formato 24 h no hay
    // abreviatura y el síntoma desaparecería aunque el orden volviera a estar mal-.
    obtenerWebhookMock.mockResolvedValue(OK_PAUSADA);
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(URL_ACTIVA);

    const aviso = avisoDeEspaciado();
    const desde = normalizar(FECHA_HORA_ES_EC.format(new Date(SIN_EXITO_ISO)));

    expect(aviso).not.toContain(".."); // el síntoma
    // La causa: tras la fecha SIGUE la frase, no la cierra un punto.
    expect(aviso).toContain(`desde el ${desde} el destino`);
    expect(aviso).not.toMatch(
      new RegExp(`${desde.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\.`),
    );
  });

  it("R18/R9: el aviso NO dice que se desactivó, ni que se dio de baja, ni suena a jerga técnica", async () => {
    obtenerWebhookMock.mockResolvedValue(OK_PAUSADA);
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(URL_ACTIVA);

    const aviso = avisoDeEspaciado().toLowerCase();
    // La suscripción sigue viva: nada de "te hemos cortado".
    for (const prohibida of [
      "desactiv",
      "dado de baja",
      "dio de baja",
      "cancel",
      "suspend",
      "bloquead",
      "error",
      "fall", // "fallos", "falló": el dueño no tiene que interpretar fallos
    ]) {
      expect(aviso).not.toContain(prohibida);
    }
    // Jerga que el dueño de la integración no tiene por qué conocer.
    for (const jerga of [
      "circuito",
      "backoff",
      "429",
      "cola",
      "job",
      "http",
      "pausad", // el vocabulario interno del servidor no se filtra a la pantalla
    ]) {
      expect(aviso).not.toContain(jerga);
    }
  });

  it("R13: el aviso no filtra la URL del webhook ni el secreto", async () => {
    obtenerWebhookMock.mockResolvedValue(OK_PAUSADA);
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(URL_ACTIVA);

    const aviso = avisoDeEspaciado();
    expect(aviso).not.toContain(URL_ACTIVA);
    expect(aviso).not.toContain(SECRET);
  });

  it("R18: sin `sinExitoDesde` el aviso sigue apareciendo, sin hueco ni fecha inventada", async () => {
    obtenerWebhookMock.mockResolvedValue({
      status: "ok" as const,
      webhook: {
        url: URL_ACTIVA,
        activa: true,
        pausada: true,
        sinExitoDesde: null,
      },
    });
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(URL_ACTIVA);

    const aviso = avisoDeEspaciado();
    expect(aviso).toBe(
      "Los envíos a este webhook se están espaciando: el destino lleva un rato " +
        "sin aceptar ninguno. No hay que hacer nada: vuelven a su ritmo normal " +
        "en cuanto el destino acepte un envío. Si ya está resuelto, guarda la " +
        "URL de nuevo para reintentarlo ahora.",
    );
    // La otra variante del texto también se lee entera y bien puntuada: ni hueco donde iba
    // la fecha, ni punto doble, ni un «desde el» huérfano.
    expect(aviso).not.toContain("..");
    expect(aviso).not.toContain("desde el");
    expect(aviso).not.toContain("null");
  });

  it("R18: con `pausada: false` NO hay aviso — una suscripción sana no alarma a nadie", async () => {
    obtenerWebhookMock.mockResolvedValue(OK_NO_PAUSADA);
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(URL_ACTIVA);

    expect(screen.queryByText(/se están espaciando/i)).toBeNull();
    // Y el estado normal se sigue leyendo igual que siempre.
    expect(screen.getByText(/activa/i)).toBeInTheDocument();
  });

  it("R18: sin suscripción (webhook: null) tampoco hay aviso", async () => {
    obtenerWebhookMock.mockResolvedValue(OK_VACIO);
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(/No hay webhook registrado/i);

    expect(screen.queryByText(/se están espaciando/i)).toBeNull();
  });

  it("H-2: con la suscripción dada de baja no se muestra el aviso de espaciado, aunque venga `pausada: true`", async () => {
    // Camino REAL, reproducido en la revisión: el dueño da de baja una suscripción que estaba
    // en racha de fallos. `desactivarByOwner` pone `activa=false` y NO reinicia el circuito, y
    // `findByOwner` no filtra por `activa`, así que el servidor sigue diciendo `pausada: true`.
    // La pantalla NO puede pintar las dos frases a la vez: «No hay webhook registrado» y «sus
    // envíos se están espaciando» se contradicen, y la segunda es falsa —una suscripción de
    // baja no recibe entregas, así que no hay nada que espaciar—.
    obtenerWebhookMock.mockResolvedValue({
      status: "ok" as const,
      webhook: {
        url: URL_ACTIVA,
        activa: false,
        pausada: true,
        sinExitoDesde: SIN_EXITO_ISO,
      },
    });
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(/No hay webhook registrado/i);

    expect(screen.queryByText(/se están espaciando/i)).toBeNull();
    // Y la frase que SÍ vale se sigue leyendo sola, sin nada que la contradiga.
    expect(
      normalizar(screen.getByRole("status").textContent ?? ""),
    ).toBe("No hay webhook registrado para este owner.");
  });

  it("R19: tras 'Guardar URL' el aviso desaparece sin recargar la página", async () => {
    // El reinicio lo hace el SERVIDOR al guardar la URL; la pantalla solo vuelve a leer con
    // el `refrescar()` que ya existía, y la segunda lectura ya viene sin pausa.
    obtenerWebhookMock
      .mockResolvedValueOnce(OK_PAUSADA)
      .mockResolvedValue(OK_NO_PAUSADA);
    registrarWebhookMock.mockResolvedValue({ status: "actualizada" });
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(URL_ACTIVA);
    expect(avisoDeEspaciado()).toContain("se están espaciando");

    await user.click(screen.getByRole("button", { name: "Guardar URL" }));

    await waitFor(() =>
      expect(screen.queryByText(/se están espaciando/i)).toBeNull(),
    );
    expect(obtenerWebhookMock).toHaveBeenCalledTimes(2); // re-lectura, no recarga
    expect(screen.getByRole("dialog")).toBeInTheDocument(); // el modal sigue en pie
  });
});
