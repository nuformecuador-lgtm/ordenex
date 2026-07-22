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
import type { ApiKeyListItemDTO } from "@/lib/types/api-key";

// Feature 82 (R14–R31) — módulo cliente de gestión de API keys. Se mockean las
// Server Actions (listar/generar); SWR y el Modal/Toast reales para ejercitar la
// composición sin DB ni sesión.
const listarApiKeysMock = vi.fn();
const generarApiKeyMock = vi.fn();
const rotarApiKeyMock = vi.fn();
const activarApiKeyMock = vi.fn();
const desactivarApiKeyMock = vi.fn();
vi.mock("@/lib/actions/api-keys", () => ({
  listarApiKeys: (...a: unknown[]) => listarApiKeysMock(...a),
  generarApiKey: (...a: unknown[]) => generarApiKeyMock(...a),
  rotarApiKey: (...a: unknown[]) => rotarApiKeyMock(...a),
  activarApiKey: (...a: unknown[]) => activarApiKeyMock(...a),
  desactivarApiKey: (...a: unknown[]) => desactivarApiKeyMock(...a),
}));

// Feature 105/R2 + 108: la columna "Webhook" renderiza `WebhookAccionCell` y el
// alta encadena `registrarWebhook`. Se mockean para no arrastrar el backend.
const obtenerWebhookMock = vi.fn();
const registrarWebhookMock = vi.fn();
vi.mock("@/lib/actions/webhooks", () => ({
  obtenerWebhook: (...a: unknown[]) => obtenerWebhookMock(...a),
  registrarWebhook: (...a: unknown[]) => registrarWebhookMock(...a),
  desactivarWebhook: vi.fn(),
  rotarSecretoWebhook: vi.fn(),
}));

import { ApiKeysModule } from "@/app/(app)/configuracion/api/_components/ApiKeysModule";

const ITEM: ApiKeyListItemDTO = {
  id: "k1",
  identificador: "integracion-erp",
  keyPrefix: "ordx_ab12cd3",
  estado: "activa",
  usuarioId: "u1",
  usuarioEmail: "apikey+integracion-erp@apikey.invalid",
  createdAt: new Date("2026-01-01T12:00:00Z"),
};

// Secreto en claro que `generarApiKey` devuelve UNA sola vez. Longitud/forma de
// un secreto real: se usa para la aserción negativa (nunca debe aparecer en el
// listado ni filtrarse a console/storage).
const PLAIN_KEY = "ordx_ab12cd3EF456ghIJ789klMN012opQR345stUV678wx";

const INITIAL = { items: [ITEM], total: 1, pageSize: 25 };

function renderModule(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

/** Abre el modal de creación, escribe el identificador y confirma. */
async function generar(
  user: ReturnType<typeof userEvent.setup>,
  identificador = "nueva-integracion",
) {
  await user.click(screen.getByRole("button", { name: "Generar API key" }));
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByLabelText("Identificador"), identificador);
  await user.click(within(dialog).getByRole("button", { name: "Generar" }));
}

function okGeneracion(identificador = "nueva-integracion") {
  return {
    status: "ok" as const,
    apiKey: {
      id: "k2",
      identificador,
      keyPrefix: "ordx_zz99yy8",
      usuarioId: "u2",
      createdAt: new Date("2026-02-02T10:00:00Z"),
    },
    plainKey: PLAIN_KEY,
  };
}

// Secreto de webhook devuelto UNA vez por `registrarWebhook` → creada.
const WEBHOOK_SECRET = "whk_9f8e7d6c5b4a3210FEDCBA9876543210deadbeefcafef00d";
const WEBHOOK_URL = "https://hook.example.com/callback";

/** Abre el modal, escribe identificador y una URL de webhook, y confirma. */
async function generarConWebhook(
  user: ReturnType<typeof userEvent.setup>,
  url = WEBHOOK_URL,
  identificador = "nueva-integracion",
) {
  await user.click(screen.getByRole("button", { name: "Generar API key" }));
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByLabelText("Identificador"), identificador);
  await user.type(
    within(dialog).getByLabelText("URL de webhook (callback)"),
    url,
  );
  await user.click(within(dialog).getByRole("button", { name: "Generar" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  listarApiKeysMock.mockImplementation(
    async ({ page, pageSize }: { page: number; pageSize: number }) => ({
      status: "ok",
      items: page === 1 ? [ITEM] : [],
      page,
      pageSize,
      total: 1,
    }),
  );
  generarApiKeyMock.mockResolvedValue(okGeneracion());
  obtenerWebhookMock.mockResolvedValue({ status: "ok", webhook: null });
  registrarWebhookMock.mockResolvedValue({
    status: "creada",
    secret: WEBHOOK_SECRET,
  });
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Listado (R14–R19)
// ---------------------------------------------------------------------------
describe("ApiKeysModule — listado (R14–R19)", () => {
  it("R14: muestra la tabla con las columnas identificador, prefijo, usuario y fecha", async () => {
    renderModule(<ApiKeysModule initialData={INITIAL} />);

    const table = screen.getByRole("table", { name: "API keys" });
    for (const header of [
      "Identificador",
      "Prefijo",
      "Usuario dedicado",
      "Fecha de creación",
    ]) {
      expect(
        within(table).getByRole("columnheader", { name: header }),
      ).toBeInTheDocument();
    }
    expect(await within(table).findByText("integracion-erp")).toBeInTheDocument();
    // [D1]: la columna de usuario muestra el email sintético, no el uuid.
    expect(
      within(table).getByText("apikey+integracion-erp@apikey.invalid"),
    ).toBeInTheDocument();
    expect(within(table).queryByText("u1")).toBeNull();
  });

  it("estado y acciones: pinta el badge de estado y los botones de acción por fila", async () => {
    renderModule(<ApiKeysModule initialData={INITIAL} />);

    const table = screen.getByRole("table", { name: "API keys" });
    for (const header of ["Estado", "Acciones"]) {
      expect(
        within(table).getByRole("columnheader", { name: header }),
      ).toBeInTheDocument();
    }
    // Estado legible por texto (no solo color), accesible.
    expect(await within(table).findByText("Activa")).toBeInTheDocument();
    // Acciones por fila: rotar y (por estar activa) desactivar.
    expect(
      within(table).getByRole("button", {
        name: "Rotar la API key integracion-erp",
      }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("button", {
        name: "Desactivar la API key integracion-erp",
      }),
    ).toBeInTheDocument();
  });

  it("R2 (105/108): cada fila de API key expone la acción 'Editar' de webhook", async () => {
    renderModule(<ApiKeysModule initialData={INITIAL} />);

    const table = screen.getByRole("table", { name: "API keys" });
    expect(
      within(table).getByRole("columnheader", { name: "Webhook" }),
    ).toBeInTheDocument();
    expect(
      await within(table).findByRole("button", {
        name: "Editar webhook de integracion-erp",
      }),
    ).toBeInTheDocument();
  });

  it("R15: muestra el prefijo con elipsis y NUNCA la key completa ni el hash", async () => {
    renderModule(<ApiKeysModule initialData={INITIAL} />);

    expect(await screen.findByText("ordx_ab12cd3…")).toBeInTheDocument();
    // Aserción negativa: el DOM no contiene la key completa ni la palabra hash.
    expect(document.body.textContent).not.toContain(PLAIN_KEY);
    expect(document.body.textContent?.toLowerCase()).not.toContain("keyhash");
  });

  it("R16: sin registros muestra un mensaje de vacío explícito", async () => {
    listarApiKeysMock.mockResolvedValue({
      status: "ok",
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
    });
    renderModule(
      <ApiKeysModule initialData={{ items: [], total: 0, pageSize: 25 }} />,
    );

    expect(await screen.findByText("No hay API keys")).toBeInTheDocument();
  });

  it("R17: si la carga en el cliente falla, muestra un error en la tabla", async () => {
    // Navegar a la página 2 fuerza un fetch cliente (sin fallback del servidor).
    listarApiKeysMock.mockImplementation(async ({ page }: { page: number }) => {
      if (page !== 1) throw new Error("boom");
      return { status: "ok", items: [ITEM], page, pageSize: 25, total: 30 };
    });
    const user = userEvent.setup();
    renderModule(
      <ApiKeysModule initialData={{ items: [ITEM], total: 30, pageSize: 25 }} />,
    );

    await user.click(screen.getByRole("button", { name: "Página siguiente" }));

    expect(
      await screen.findByText("No se pudieron cargar las API keys"),
    ).toBeInTheDocument();
  });

  it("R18: cambiar de página recarga con los nuevos parámetros y refleja el resultado", async () => {
    const OTRA: ApiKeyListItemDTO = {
      ...ITEM,
      id: "k9",
      identificador: "pagina-dos",
      usuarioEmail: "apikey+pagina-dos@apikey.invalid",
    };
    listarApiKeysMock.mockImplementation(
      async ({ page, pageSize }: { page: number; pageSize: number }) => ({
        status: "ok",
        items: page === 2 ? [OTRA] : [ITEM],
        page,
        pageSize,
        total: 30,
      }),
    );
    const user = userEvent.setup();
    renderModule(
      <ApiKeysModule initialData={{ items: [ITEM], total: 30, pageSize: 25 }} />,
    );

    // Esperar a que la primera página asiente antes de navegar.
    await screen.findByText("integracion-erp");

    await user.click(screen.getByRole("button", { name: "Página siguiente" }));

    await waitFor(() =>
      expect(listarApiKeysMock).toHaveBeenCalledWith({ page: 2, pageSize: 25 }),
    );
    expect(await screen.findByText("pagina-dos")).toBeInTheDocument();
  });

  it("R19: cambiar el tamaño de página vuelve a la página 1", async () => {
    listarApiKeysMock.mockImplementation(
      async ({ page, pageSize }: { page: number; pageSize: number }) => ({
        status: "ok",
        items: page === 1 ? [ITEM] : [],
        page,
        pageSize,
        total: 30,
      }),
    );
    const user = userEvent.setup();
    renderModule(
      <ApiKeysModule initialData={{ items: [ITEM], total: 30, pageSize: 25 }} />,
    );

    // Esperar a que la primera página asiente antes de navegar.
    await screen.findByText("integracion-erp");

    // Ir a la página 2 primero, luego cambiar el tamaño de página.
    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    await waitFor(() =>
      expect(listarApiKeysMock).toHaveBeenCalledWith({ page: 2, pageSize: 25 }),
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Elementos por página" }),
      "10",
    );

    await waitFor(() =>
      expect(listarApiKeysMock).toHaveBeenCalledWith({ page: 1, pageSize: 10 }),
    );
  });
});

// ---------------------------------------------------------------------------
// Generación (R20–R23, R31)
// ---------------------------------------------------------------------------
describe("ApiKeysModule — generación (R20–R23, R31)", () => {
  it("R20: 'Generar API key' abre un modal con el campo obligatorio y (108) la URL opcional", async () => {
    const user = userEvent.setup();
    renderModule(<ApiKeysModule initialData={INITIAL} />);

    await user.click(screen.getByRole("button", { name: "Generar API key" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Identificador")).toBeInTheDocument();
    // Feature 108/R1: además del identificador obligatorio, un campo opcional de
    // URL de webhook. Dos textboxes en total.
    expect(
      within(dialog).getByLabelText("URL de webhook (callback)"),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByRole("textbox")).toHaveLength(2);
  });

  it("R21: validation_error del backend muestra el error del campo y NO cierra el modal", async () => {
    generarApiKeyMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { identificador: ["El identificador ya está en uso interno"] },
    });
    const user = userEvent.setup();
    renderModule(<ApiKeysModule initialData={INITIAL} />);

    await generar(user);

    expect(
      await screen.findByText("El identificador ya está en uso interno"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("R22: conflict informa que ya existe una key para ese identificador y NO cierra el modal", async () => {
    generarApiKeyMock.mockResolvedValue({ status: "conflict", campo: "email" });
    const user = userEvent.setup();
    renderModule(<ApiKeysModule initialData={INITIAL} />);

    await generar(user);

    expect(
      await screen.findByText("Ya existe una API key para ese identificador"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("R23: forbidden muestra feedback y NO cierra el modal", async () => {
    generarApiKeyMock.mockResolvedValue({ status: "forbidden" });
    const user = userEvent.setup();
    renderModule(<ApiKeysModule initialData={INITIAL} />);

    await generar(user);

    expect(
      (await screen.findAllByText("No tienes permiso para esta acción.")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("R31: mientras la generación está en curso, un segundo envío no dispara otra llamada", async () => {
    let resolver!: (v: ReturnType<typeof okGeneracion>) => void;
    generarApiKeyMock.mockImplementation(
      () => new Promise((res) => (resolver = res)),
    );
    const user = userEvent.setup();
    renderModule(<ApiKeysModule initialData={INITIAL} />);

    await user.click(screen.getByRole("button", { name: "Generar API key" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Identificador"),
      "una-sola-vez",
    );
    const generarBtn = within(dialog).getByRole("button", { name: "Generar" });
    await user.click(generarBtn);
    await user.click(generarBtn);

    expect(generarApiKeyMock).toHaveBeenCalledTimes(1);
    resolver(okGeneracion());
    await screen.findByRole("button", { name: "Cerrar" });
  });
});

// ---------------------------------------------------------------------------
// Revelado del secreto (R24–R29) — la UX central [D5]
// ---------------------------------------------------------------------------
describe("ApiKeysModule — revelado del secreto (R24–R29)", () => {
  function setClipboard(writeText: ((t: string) => Promise<void>) | undefined) {
    Object.defineProperty(navigator, "clipboard", {
      value: writeText ? { writeText } : undefined,
      configurable: true,
    });
  }

  it("R24: tras ok muestra el secreto en claro y un aviso de que es la única vez", async () => {
    const user = userEvent.setup();
    renderModule(<ApiKeysModule initialData={INITIAL} />);

    await generar(user);

    const secreto = await screen.findByLabelText("Clave de API generada");
    expect(secreto).toHaveValue(PLAIN_KEY);
    expect(
      screen.getByText(/única vez que verás estas credenciales/i),
    ).toBeInTheDocument();
  });

  it("R25/R26: copiar con clipboard disponible confirma con toast de éxito", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    // Después de `setup()`: userEvent instala su propio stub de clipboard, así que
    // el nuestro debe imponerse a continuación.
    setClipboard(writeText);
    renderModule(<ApiKeysModule initialData={INITIAL} />);

    await generar(user);
    await screen.findByLabelText("Clave de API generada");
    await user.click(screen.getByRole("button", { name: "Copiar clave de API" }));

    expect(writeText).toHaveBeenCalledWith(PLAIN_KEY);
    expect(
      await screen.findByText("Clave copiada al portapapeles"),
    ).toBeInTheDocument();
  });

  it("R26/D6: si el clipboard no existe, toast de error y el secreto sigue visible", async () => {
    const user = userEvent.setup();
    setClipboard(undefined);
    renderModule(<ApiKeysModule initialData={INITIAL} />);

    await generar(user);
    await screen.findByLabelText("Clave de API generada");
    await user.click(screen.getByRole("button", { name: "Copiar clave de API" }));

    expect(
      (await screen.findAllByText(/No se pudo copiar; selecciona el texto/i))
        .length,
    ).toBeGreaterThan(0);
    // Nunca un fallo duro: el secreto sigue seleccionable en pantalla.
    expect(screen.getByLabelText("Clave de API generada")).toHaveValue(PLAIN_KEY);
  });

  it("R27: el botón Cerrar está deshabilitado sin el checkbox y Escape no cierra", async () => {
    const user = userEvent.setup();
    renderModule(<ApiKeysModule initialData={INITIAL} />);

    await generar(user);
    await screen.findByLabelText("Clave de API generada");

    const cerrar = screen.getByRole("button", { name: "Cerrar" });
    expect(cerrar).toBeDisabled();

    // Escape no cierra mientras el secreto está visible.
    await user.keyboard("{Escape}");
    expect(screen.getByLabelText("Clave de API generada")).toBeInTheDocument();

    // Marcar el checkbox habilita el ÚNICO botón de cierre.
    await user.click(
      await screen.findByRole("checkbox", {
        name: "Ya guardé mis credenciales en un lugar seguro",
      }),
    );
    expect(cerrar).toBeEnabled();
  });

  it("R28: tras cerrar, el secreto desaparece del DOM y no hay acción para reabrirlo", async () => {
    const user = userEvent.setup();
    renderModule(<ApiKeysModule initialData={INITIAL} />);

    await generar(user);
    await screen.findByLabelText("Clave de API generada");
    await user.click(
      await screen.findByRole("checkbox", {
        name: "Ya guardé mis credenciales en un lugar seguro",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Cerrar" }));

    await waitFor(() =>
      expect(screen.queryByLabelText("Clave de API generada")).toBeNull(),
    );
    expect(document.body.textContent).not.toContain(PLAIN_KEY);
    // No existe ninguna acción para volver a mostrar el secreto.
    expect(
      screen.queryByRole("button", { name: "Copiar clave de API" }),
    ).toBeNull();
  });

  it("R29: una generación ok refresca el listado (re-consulta listarApiKeys)", async () => {
    const user = userEvent.setup();
    renderModule(<ApiKeysModule initialData={INITIAL} />);

    // En el montaje NO se consulta (hay fallback del servidor): cualquier llamada
    // posterior prueba el `mutate` disparado por la generación ok.
    listarApiKeysMock.mockClear();
    await generar(user);
    await screen.findByLabelText("Clave de API generada");

    await waitFor(() => expect(listarApiKeysMock).toHaveBeenCalled());
  });
});

// ---------------------------------------------------------------------------
// R30 — el secreto no se filtra a console ni a storage
// ---------------------------------------------------------------------------
describe("ApiKeysModule — el secreto no se filtra (R30)", () => {
  it("R30: durante generar → copiar → cerrar, el plainKey no llega a console ni a storage", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "debug").mockImplementation(() => {}),
    ];
    const localSet = vi.spyOn(Storage.prototype, "setItem");

    const user = userEvent.setup();
    // Tras `setup()`: imponer nuestro stub de clipboard sobre el de userEvent.
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    renderModule(<ApiKeysModule initialData={INITIAL} />);

    await generar(user);
    await screen.findByLabelText("Clave de API generada");
    await user.click(screen.getByRole("button", { name: "Copiar clave de API" }));
    await user.click(
      await screen.findByRole("checkbox", {
        name: "Ya guardé mis credenciales en un lugar seguro",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Cerrar" }));

    const containsSecret = (calls: unknown[][]) =>
      calls.some((args) =>
        args.some((a) => typeof a === "string" && a.includes(PLAIN_KEY)),
      );

    for (const spy of spies) {
      expect(containsSecret(spy.mock.calls)).toBe(false);
    }
    expect(containsSecret(localSet.mock.calls)).toBe(false);

    for (const spy of spies) spy.mockRestore();
    localSet.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Feature 108 — alta con webhook opcional + encadenado (R2, R4, R5, R6, R7,
// R11, R12, R13, R14)
// ---------------------------------------------------------------------------
describe("ApiKeysModule — alta con webhook (feature 108)", () => {
  it("R2: con URL vacía genera la key y NO llama a registrarWebhook", async () => {
    const user = userEvent.setup();
    renderModule(<ApiKeysModule initialData={INITIAL} />);

    await generar(user); // sin URL de webhook

    await screen.findByLabelText("Clave de API generada");
    expect(registrarWebhookMock).not.toHaveBeenCalled();
    // Sin webhook: la sección de secreto de webhook no existe.
    expect(
      screen.queryByLabelText("Secreto de webhook generado"),
    ).toBeNull();
  });

  it("R7: sin webhook, revela solo el secreto de la key una vez", async () => {
    const user = userEvent.setup();
    renderModule(<ApiKeysModule initialData={INITIAL} />);

    await generar(user);

    expect(await screen.findByLabelText("Clave de API generada")).toHaveValue(
      PLAIN_KEY,
    );
    expect(
      screen.queryByLabelText("Secreto de webhook generado"),
    ).toBeNull();
  });

  it("R4: con URL no-https marca error de campo y no invoca generarApiKey ni registrarWebhook", async () => {
    const user = userEvent.setup();
    renderModule(<ApiKeysModule initialData={INITIAL} />);

    await generarConWebhook(user, "http://inseguro.example.com/hook");

    expect(
      await screen.findByText(/URL de callback debe ser una URL https/i),
    ).toBeInTheDocument();
    expect(generarApiKeyMock).not.toHaveBeenCalled();
    expect(registrarWebhookMock).not.toHaveBeenCalled();
    // El modal de alta sigue abierto (no se creó nada).
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("R5: tras ok encadena registrarWebhook con ownerUsuarioId = apiKey.usuarioId y la URL", async () => {
    const user = userEvent.setup();
    renderModule(<ApiKeysModule initialData={INITIAL} />);

    await generarConWebhook(user);

    await screen.findByLabelText("Clave de API generada");
    expect(registrarWebhookMock).toHaveBeenCalledWith({
      ownerUsuarioId: "u2", // usuarioId que trae `apiKey` en okGeneracion()
      url: WEBHOOK_URL,
    });
  });

  it("R8 (módulo): con webhook creado revela clave y secreto en un solo modal", async () => {
    const user = userEvent.setup();
    renderModule(<ApiKeysModule initialData={INITIAL} />);

    await generarConWebhook(user);

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByLabelText("Clave de API generada"),
    ).toHaveValue(PLAIN_KEY);
    expect(
      within(dialog).getByLabelText("Secreto de webhook generado"),
    ).toHaveValue(WEBHOOK_SECRET);
  });

  it("R6: bloquea el segundo submit mientras corren las dos acciones encadenadas", async () => {
    // `registrarWebhook` queda pendiente para mantener la fase pending del Modal.
    let resolver!: (v: { status: "creada"; secret: string }) => void;
    registrarWebhookMock.mockImplementation(
      () => new Promise((res) => (resolver = res)),
    );
    const user = userEvent.setup();
    renderModule(<ApiKeysModule initialData={INITIAL} />);

    await user.click(screen.getByRole("button", { name: "Generar API key" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Identificador"),
      "una-sola-vez",
    );
    await user.type(
      within(dialog).getByLabelText("URL de webhook (callback)"),
      WEBHOOK_URL,
    );
    const generarBtn = within(dialog).getByRole("button", { name: "Generar" });
    await user.click(generarBtn);
    await user.click(generarBtn);

    // Aunque se pulsó dos veces, cada acción encadenada corrió una sola vez.
    expect(generarApiKeyMock).toHaveBeenCalledTimes(1);
    expect(registrarWebhookMock).toHaveBeenCalledTimes(1);

    resolver({ status: "creada", secret: WEBHOOK_SECRET });
    await screen.findByLabelText("Secreto de webhook generado");
  });

  it("R11/R12: key ok pero registrarWebhook falla → revela igual el secreto de la key y avisa sin internals", async () => {
    registrarWebhookMock.mockResolvedValue({ status: "config_error" });
    const user = userEvent.setup();
    renderModule(<ApiKeysModule initialData={INITIAL} />);

    await generarConWebhook(user);

    // R11: la clave se revela igual (su secreto no se pierde).
    expect(await screen.findByLabelText("Clave de API generada")).toHaveValue(
      PLAIN_KEY,
    );
    // R11: NO hay secreto de webhook.
    expect(
      screen.queryByLabelText("Secreto de webhook generado"),
    ).toBeNull();
    // R12: aviso claro, sin nombrar variables ni internals del servidor.
    expect(
      screen.getAllByText(/el webhook no quedó registrado/i).length,
    ).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("config_error");
    expect(document.body.textContent).not.toContain("WEBHOOK_SECRET_ENC_KEY");
  });

  it("R13: en fallo parcial la key queda listada y reintentar el webhook es por el botón Editar", async () => {
    registrarWebhookMock.mockResolvedValue({ status: "forbidden" });
    const user = userEvent.setup();
    renderModule(<ApiKeysModule initialData={INITIAL} />);

    await generarConWebhook(user);
    await screen.findByLabelText("Clave de API generada");

    // Cierra el revelado: la key sigue en el listado y su fila ofrece "Editar".
    await user.click(
      screen.getByRole("checkbox", {
        name: "Ya guardé mis credenciales en un lugar seguro",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Cerrar" }));

    const table = screen.getByRole("table", { name: "API keys" });
    expect(
      await within(table).findByRole("button", {
        name: "Editar webhook de integracion-erp",
      }),
    ).toBeInTheDocument();
  });

  it("R14: refresca el listado antes de mostrar el revelado", async () => {
    const user = userEvent.setup();
    renderModule(<ApiKeysModule initialData={INITIAL} />);

    // El montaje usa el fallback del servidor (no llama a listar). Cualquier
    // llamada posterior es el `mutate` disparado por el alta.
    listarApiKeysMock.mockClear();
    await generarConWebhook(user);
    await screen.findByLabelText("Clave de API generada");

    await waitFor(() => expect(listarApiKeysMock).toHaveBeenCalled());
  });
});
