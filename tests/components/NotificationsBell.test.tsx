// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import {
  NotificationsBell,
  type NotificationItem,
} from "@/components/shared/NotificationsBell";
import { notificacionesConfig } from "@/lib/config/notificaciones";
import type { NotificacionDTO } from "@/lib/types/notificacion";

// ---------------------------------------------------------------------------
// Mocks — las 5 operaciones son Server Actions (R38): se espían, no se llaman.
// ---------------------------------------------------------------------------

const { listarMock, marcarTodasMock, descartarMock, reproducirTonoMock } = vi.hoisted(
  () => ({
    listarMock: vi.fn(),
    marcarTodasMock: vi.fn(),
    descartarMock: vi.fn(),
    // Feature 161: jsdom no tiene Web Audio API; el generador se espía.
    reproducirTonoMock: vi.fn(),
  }),
);

vi.mock("@/lib/audio/tono-notificacion", () => ({
  reproducirTono: reproducirTonoMock,
  prepararAudio: vi.fn(),
  reiniciarAudioParaTests: vi.fn(),
}));

vi.mock("@/lib/actions/notificaciones", () => ({
  listarNotificaciones: listarMock,
  marcarTodasLeidas: marcarTodasMock,
  descartarNotificacion: descartarMock,
  notificarCargaMasivaTerminada: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dto(overrides: Partial<NotificacionDTO> = {}): NotificacionDTO {
  return {
    id: "n1",
    notification_type: "alert",
    description: "Una orden fue rechazada por el destinatario.",
    read: false,
    createdAt: "2026-07-27T10:00:00.000Z",
    ...overrides,
  };
}

function ok(items: NotificacionDTO[]) {
  return {
    status: "ok" as const,
    items,
    noLeidas: items.filter((n) => !n.read).length,
  };
}

/** Cache aislada por test + sin dedupe: cada montaje refetchea de verdad. */
function renderBell(props: { notifications?: NotificationItem[] } = {}) {
  return render(
    <SWRConfig
      value={{
        provider: () => new Map(),
        dedupingInterval: 0,
      }}
    >
      <NotificationsBell {...props} />
    </SWRConfig>,
  );
}

const trigger = () => screen.getByRole("button", { name: /^Notificaciones/ });

async function abrir(user: ReturnType<typeof userEvent.setup>) {
  await user.click(trigger());
  return screen.findByText("Marcar todas como leídas");
}

/** Quita comentarios: las guardias de código no deben disparar con la prosa. */
function sinComentarios(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

const FUENTE_CAMPANA = readFileSync(
  path.join(process.cwd(), "components/shared/NotificationsBell.tsx"),
  "utf8",
);
const FUENTE_HOOK = readFileSync(
  path.join(process.cwd(), "hooks/useNotificaciones.ts"),
  "utf8",
);

beforeEach(() => {
  vi.clearAllMocks();
  listarMock.mockResolvedValue(ok([]));
  marcarTodasMock.mockResolvedValue({ status: "ok", marcadas: 0 });
  descartarMock.mockResolvedValue({ status: "ok" });
});

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// R40 — sin datos quemados
// ---------------------------------------------------------------------------
describe("NotificationsBell — origen de los datos (R40)", () => {
  it("R40: no queda ninguna notificación de ejemplo quemada en el componente", () => {
    expect(FUENTE_CAMPANA).not.toContain("EXAMPLE_NOTIFICATIONS");
    expect(FUENTE_CAMPANA).not.toContain("REM-0042");
    expect(FUENTE_CAMPANA).not.toContain("Lote #128");
  });

  it("R40: se puebla exclusivamente con el resultado de la acción de listar", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue(
      ok([dto({ id: "srv-1", description: "Aviso que viene del servidor." })]),
    );
    renderBell();

    await abrir(user);

    expect(
      await screen.findByText("Aviso que viene del servidor."),
    ).toBeInTheDocument();
    expect(listarMock).toHaveBeenCalled();
  });

  it("R40: sin llamada resuelta la lista no inventa contenido (estado vacío por defecto)", async () => {
    renderBell();
    expect(screen.queryByText("REM-0042")).not.toBeInTheDocument();
    await waitFor(() => expect(listarMock).toHaveBeenCalled());
  });
});

// ---------------------------------------------------------------------------
// R41 / R42 / R43 — distintivo
// ---------------------------------------------------------------------------
describe("NotificationsBell — distintivo de no leídas (R41–R43)", () => {
  it("R41: muestra el distintivo con la cantidad de no leídas", async () => {
    listarMock.mockResolvedValue(
      ok([
        dto({ id: "a", read: false }),
        dto({ id: "b", read: false }),
        dto({ id: "c", read: true }),
      ]),
    );
    renderBell();

    expect(await screen.findByText("2")).toBeInTheDocument();
    expect(trigger()).toHaveAttribute(
      "aria-label",
      "Notificaciones, 2 sin leer",
    );
  });

  it("R42: con más de 99 no leídas el distintivo muestra +99", async () => {
    listarMock.mockResolvedValue({
      status: "ok",
      items: [dto({ id: "a", read: false })],
      noLeidas: 137,
    });
    renderBell();

    expect(await screen.findByText("+99")).toBeInTheDocument();
    expect(screen.queryByText("137")).not.toBeInTheDocument();
  });

  it("R43: sin no leídas no se muestra ningún distintivo", async () => {
    listarMock.mockResolvedValue(ok([dto({ id: "a", read: true })]));
    renderBell();

    await waitFor(() => expect(listarMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(trigger()).toHaveAttribute("aria-label", "Notificaciones"),
    );
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// R44 — estado vacío
// ---------------------------------------------------------------------------
describe("NotificationsBell — estado vacío (R44)", () => {
  it("R44: listado vacío → muestra 'No tienes notificaciones.' en lugar de la lista", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue(ok([]));
    renderBell();

    await abrir(user);

    expect(
      await screen.findByText("No tienes notificaciones."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// R45 — marcar todas como leídas
// ---------------------------------------------------------------------------
describe("NotificationsBell — marcar todas como leídas (R45)", () => {
  it("R45: sin no leídas el control está deshabilitado", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue(ok([dto({ id: "a", read: true })]));
    renderBell();

    const boton = await abrir(user);
    await waitFor(() => expect(boton).toBeDisabled());
  });

  it("R45: invoca la acción y deja el contador en cero sin recargar la página", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue(
      ok([dto({ id: "a", read: false }), dto({ id: "b", read: false })]),
    );
    renderBell();

    const boton = await abrir(user);
    await waitFor(() => expect(boton).toBeEnabled());

    listarMock.mockResolvedValue(
      ok([dto({ id: "a", read: true }), dto({ id: "b", read: true })]),
    );
    await user.click(boton);

    await waitFor(() => expect(marcarTodasMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(trigger()).toHaveAttribute("aria-label", "Notificaciones"),
    );
    // Los elementos siguen en la lista: marcar leídas no los retira.
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// R46 — descartar
// ---------------------------------------------------------------------------
describe("NotificationsBell — descartar (R46)", () => {
  it("R46: la X invoca descartarNotificacion y retira el elemento de la lista", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue(
      ok([
        dto({ id: "a", description: "Primera." }),
        dto({ id: "b", description: "Segunda." }),
      ]),
    );
    renderBell();

    await abrir(user);
    await screen.findByText("Primera.");

    listarMock.mockResolvedValue(ok([dto({ id: "b", description: "Segunda." })]));

    const primera = screen.getByText("Primera.").closest("li") as HTMLElement;
    await user.click(
      within(primera).getByRole("button", { name: "Descartar notificación" }),
    );

    await waitFor(() => expect(descartarMock).toHaveBeenCalledWith("a"));
    // Las dos condiciones en el MISMO `waitFor`, presencia primero: la lista se
    // recarga del servidor, así que hay un instante en que "Primera." ya no está y
    // la página nueva (con "Segunda.") aún no ha llegado. Anclar solo a la ausencia
    // se satisfacía ahí y el `getByText` síncrono fallaba. Se afirma lo mismo.
    await waitFor(() => {
      expect(screen.getByText("Segunda.")).toBeInTheDocument();
      expect(screen.queryByText("Primera.")).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// R47 — refresco
// ---------------------------------------------------------------------------
describe("NotificationsBell — refresco (R47)", () => {
  it("R47: abrir el popover revalida el listado", async () => {
    const user = userEvent.setup();
    renderBell();
    await waitFor(() => expect(listarMock).toHaveBeenCalled());
    const antes = listarMock.mock.calls.length;

    await abrir(user);

    await waitFor(() =>
      expect(listarMock.mock.calls.length).toBeGreaterThan(antes),
    );
  });

  it("R47: el polling usa refreshInterval de la config (60 s), no un literal suelto", () => {
    expect(notificacionesConfig.REFRESH_INTERVAL_MS).toBe(60_000);
    expect(FUENTE_HOOK).toContain(
      "refreshInterval: notificacionesConfig.REFRESH_INTERVAL_MS",
    );
  });

  it("R47: no hay Supabase Realtime ni canal de suscripción en vivo en la campana", () => {
    for (const fuente of [FUENTE_CAMPANA, FUENTE_HOOK]) {
      const codigo = sinComentarios(fuente);
      expect(codigo).not.toMatch(/realtime/i);
      expect(codigo).not.toMatch(/supabase/i);
      expect(codigo).not.toMatch(/\.channel\(/);
      expect(codigo).not.toMatch(/subscribe\(/);
    }
  });
});

// ---------------------------------------------------------------------------
// R48 — degradación limpia
// ---------------------------------------------------------------------------
describe("NotificationsBell — degradación ante fallo (R48)", () => {
  it("R48: unauthenticated → la campana renderiza sin distintivo y sin romper", async () => {
    listarMock.mockResolvedValue({ status: "unauthenticated" });
    renderBell();

    await waitFor(() => expect(listarMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(trigger()).toHaveAttribute("aria-label", "Notificaciones"),
    );
    expect(trigger()).toBeInTheDocument();
  });

  it("R48: la acción lanza → la campana sigue en pie, sin distintivo", async () => {
    const user = userEvent.setup();
    listarMock.mockRejectedValue(new Error("caída del servidor"));
    renderBell();

    await waitFor(() => expect(listarMock).toHaveBeenCalled());
    expect(trigger()).toBeInTheDocument();
    await abrir(user);
    expect(
      await screen.findByText("No tienes notificaciones."),
    ).toBeInTheDocument();
  });

  it("R48: un fallo del listado no impide seguir mostrando el resto de la cabecera", async () => {
    listarMock.mockResolvedValue({ status: "unexpected_error" });
    renderBell();

    await waitFor(() => expect(listarMock).toHaveBeenCalled());
    expect(trigger()).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// R49 — icono por tipo, descripción y anexo
// ---------------------------------------------------------------------------
describe("NotificationsBell — presentación de cada notificación (R49)", () => {
  it("R49: muestra el icono de su tipo, la descripción y el anexo", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue(
      ok([
        dto({
          id: "a",
          notification_type: "alert",
          description: "Orden rechazada.",
          anexo: "REM-1",
        }),
        dto({
          id: "b",
          notification_type: "box",
          description: "Carga masiva terminada.",
          anexo: "Lote 9",
        }),
        dto({
          id: "c",
          notification_type: "warning",
          description: "Cierre por aprobar.",
        }),
      ]),
    );
    renderBell();

    await abrir(user);
    await screen.findByText("Orden rechazada.");

    expect(screen.getByLabelText("Alerta")).toBeInTheDocument();
    expect(screen.getByLabelText("Paquete")).toBeInTheDocument();
    expect(screen.getByLabelText("Advertencia")).toBeInTheDocument();

    expect(screen.getByText("Carga masiva terminada.")).toBeInTheDocument();
    expect(screen.getByText("Anexo: REM-1")).toBeInTheDocument();
    expect(screen.getByText("Anexo: Lote 9")).toBeInTheDocument();
    // Sin anexo no se pinta la línea de anexo.
    const sinAnexo = screen.getByText("Cierre por aprobar.").closest("li")!;
    expect(within(sinAnexo).queryByText(/^Anexo:/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// R50 — NotificationItem sigue siendo el tipo público
// ---------------------------------------------------------------------------
describe("NotificationsBell — contrato de tipos (R50)", () => {
  it("R50: NotificationItem es alias de NotificacionDTO y es asignable en ambos sentidos", () => {
    const desdeDto: NotificationItem = dto({ id: "x" });
    const haciaDto: NotificacionDTO = desdeDto;
    expect(haciaDto.id).toBe("x");
    // El componente sigue aceptando `notifications?: NotificationItem[]`.
    const props: { notifications?: NotificationItem[] } = {
      notifications: [desdeDto],
    };
    expect(props.notifications).toHaveLength(1);
    expect(FUENTE_CAMPANA).toContain("export type NotificationItem");
  });

  it("R50: `notifications` se usa como datos iniciales y la campana renderiza con ellos", async () => {
    const user = userEvent.setup();
    listarMock.mockImplementation(
      () => new Promise(() => {}), // nunca resuelve: sólo queda el fallback
    );
    renderBell({
      notifications: [dto({ id: "f1", description: "Desde props." })],
    });

    await abrir(user);
    expect(screen.getByText("Desde props.")).toBeInTheDocument();
    // El distintivo sale de los datos iniciales: 1 no leída.
    expect(trigger()).toHaveAttribute("aria-label", "Notificaciones, 1 sin leer");
  });
});

// ---------------------------------------------------------------------------
// Feature 161 — tono de aviso y preferencia de sonido (R18–R20)
// ---------------------------------------------------------------------------
describe("NotificationsBell — tono de aviso (feature 161, R18–R20)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("R19: suena cuando el total sin leer aumenta entre revalidaciones", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue(ok([dto({ id: "a", read: true })]));
    renderBell();

    await waitFor(() => expect(listarMock).toHaveBeenCalled());
    expect(reproducirTonoMock).not.toHaveBeenCalled();

    // Llega una notificación nueva; abrir la campana revalida (R47 de la 146).
    listarMock.mockResolvedValue(
      ok([dto({ id: "a", read: true }), dto({ id: "b", read: false })]),
    );
    await user.click(trigger());

    await waitFor(() => expect(reproducirTonoMock).toHaveBeenCalledTimes(1));
  });

  it("R11/R24: no suena al montar, aunque el servidor devuelva no leídas", async () => {
    listarMock.mockResolvedValue(
      ok([dto({ id: "a", read: false }), dto({ id: "b", read: false })]),
    );
    renderBell();

    await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());
    expect(reproducirTonoMock).not.toHaveBeenCalled();
  });

  it("R11/R24: tampoco suena al montar con no leídas en los datos iniciales", async () => {
    listarMock.mockImplementation(() => new Promise(() => {}));
    renderBell({ notifications: [dto({ id: "a", read: false })] });

    await waitFor(() =>
      expect(trigger()).toHaveAttribute("aria-label", "Notificaciones, 1 sin leer"),
    );
    expect(reproducirTonoMock).not.toHaveBeenCalled();
  });

  it("R24: si la lectura falla y luego se recupera, el regreso a un conteo real no suena", async () => {
    listarMock.mockResolvedValue({ status: "unauthenticated" });
    renderBell();

    await waitFor(() => expect(listarMock).toHaveBeenCalled());

    listarMock.mockResolvedValue(ok([dto({ id: "a", read: false })]));
    await waitFor(() => expect(listarMock).toHaveBeenCalled());

    expect(reproducirTonoMock).not.toHaveBeenCalled();
  });

  it("R20: marcar todas como leídas no suena", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue(
      ok([dto({ id: "a", read: false }), dto({ id: "b", read: false })]),
    );
    renderBell();

    await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());
    reproducirTonoMock.mockClear(); // se descuenta la subida inicial (R19)

    await abrir(user);

    // Tras marcar todas, SWR revalida: el servidor ya las devuelve leídas. Sin esto el
    // doble contradiría al servidor real y el contador volvería a subir. Se cambia DESPUÉS
    // de abrir porque abrir ya revalida (R47) y dejaría el control deshabilitado.
    listarMock.mockResolvedValue(
      ok([dto({ id: "a", read: true }), dto({ id: "b", read: true })]),
    );

    await user.click(screen.getByText("Marcar todas como leídas"));

    await waitFor(() => expect(marcarTodasMock).toHaveBeenCalled());
    expect(reproducirTonoMock).not.toHaveBeenCalled();
  });

  it("R20: descartar una notificación no suena", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue(
      ok([dto({ id: "a", read: false }), dto({ id: "b", read: false })]),
    );
    renderBell();

    await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());
    reproducirTonoMock.mockClear();

    await abrir(user);

    // Tras descartar, el servidor ya no devuelve la descartada: el contador BAJA a 1.
    listarMock.mockResolvedValue(ok([dto({ id: "b", read: false })]));

    await user.click(screen.getAllByLabelText("Descartar notificación")[0]);

    await waitFor(() => expect(descartarMock).toHaveBeenCalled());
    expect(reproducirTonoMock).not.toHaveBeenCalled();
  });

  it("R18: el control de sonido expone su estado en el nombre accesible", async () => {
    const user = userEvent.setup();
    renderBell();

    await abrir(user);
    const silenciar = screen.getByLabelText("Silenciar el sonido de las notificaciones");
    expect(silenciar).toHaveAttribute("aria-pressed", "false");

    await user.click(silenciar);

    const activar = await screen.findByLabelText(
      "Activar el sonido de las notificaciones",
    );
    expect(activar).toHaveAttribute("aria-pressed", "true");
  });

  it("R16/R18: la preferencia silenciada se conserva al volver a montar", async () => {
    const user = userEvent.setup();
    renderBell();
    await abrir(user);
    await user.click(screen.getByLabelText("Silenciar el sonido de las notificaciones"));

    cleanup();
    renderBell();
    await abrir(user);

    expect(
      await screen.findByLabelText("Activar el sonido de las notificaciones"),
    ).toBeInTheDocument();
  });

  it("R14: con el sonido silenciado la subida de no leídas no suena", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("ordenex:sonido-notificaciones", "off");
    listarMock.mockResolvedValue(ok([dto({ id: "a", read: true })]));
    renderBell();

    await waitFor(() => expect(listarMock).toHaveBeenCalled());

    // Misma subida que hace sonar en el test de R19, pero con el tono silenciado.
    listarMock.mockResolvedValue(
      ok([dto({ id: "a", read: true }), dto({ id: "b", read: false })]),
    );
    await user.click(trigger());

    await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());
    expect(reproducirTonoMock).not.toHaveBeenCalled();
  });
});
