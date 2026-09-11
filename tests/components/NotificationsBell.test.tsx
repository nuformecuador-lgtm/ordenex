// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ComponentProps, ReactNode } from "react";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { quitarComentarios } from "../fixtures/sin-comentarios";

import {
  NotificationsBell,
  type NotificationItem,
} from "@/components/shared/NotificationsBell";
import { notificacionesConfig } from "@/lib/config/notificaciones";
import type { NotificacionDTO } from "@/lib/types/notificacion";

// ---------------------------------------------------------------------------
// Mocks — las 5 operaciones son Server Actions (R38): se espían, no se llaman.
// ---------------------------------------------------------------------------

const { listarMock, marcarTodasMock, descartarMock, reproducirTonoMock, navegoA } =
  vi.hoisted(() => ({
    listarMock: vi.fn(),
    marcarTodasMock: vi.fn(),
    descartarMock: vi.fn(),
    // Feature 161: jsdom no tiene Web Audio API; el generador se espía.
    reproducirTonoMock: vi.fn(),
    // FICHA 409 (R21): el destino al que el atajo manda. jsdom no navega, así que se registra.
    navegoA: vi.fn(),
  }));

// FICHA 409 (R21) — el atajo es un `Link` dentro de un `Popover.Close`: navega Y cierra el panel.
// `next/link` se sustituye por un ancla que registra el destino y corta la navegación, que jsdom
// no implementa. Lo que se afirma NO es el mock: es el `href` que el componente le pasa —el que
// declara el catálogo para ese par (evento, rol)— y que el panel desaparece al pulsarlo.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...rest
  }: { children: ReactNode; href: string } & ComponentProps<"a">) => (
    <a
      href={href}
      {...rest}
      onClick={(evento) => {
        rest.onClick?.(evento);
        evento.preventDefault();
        navegoA(href);
      }}
    >
      {children}
    </a>
  ),
}));

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

/**
 * ⚠️ FICHA 409 — EL RESULTADO DE LISTAR GANA `porHacer`, Y NO ES `noLeidas` CON OTRO NOMBRE.
 * Lo cuenta el SERVIDOR sobre lo accionable y vigente, sin mirar la lectura (R8/R9). Aquí se
 * deriva de `accionable` para que cada caso lo declare en sus propios datos.
 */
function ok(items: NotificacionDTO[]) {
  return {
    status: "ok" as const,
    items,
    noLeidas: items.filter((n) => !n.read).length,
    porHacer: items.filter((n) => n.accionable === true).length,
  };
}

/** Un aviso ACCIONABLE con atajo, tal y como lo sirve el servidor tras la 409. */
function accionable(overrides: Partial<NotificacionDTO> = {}): NotificacionDTO {
  return dto({
    id: "acc-1",
    notification_type: "alert",
    accionable: true,
    titulo: "5 novedades esperan tu decisión",
    detalle: "La más antigua lleva 3 días en bodega.",
    cuando: "hace 2 h",
    atajo: {
      href: "/novedades?superficie=devolucion",
      etiqueta: "Gestionar novedades",
    },
    ...overrides,
  });
}

/** Un aviso INFORMATIVO: sin atajo y sin nada que hacer con él. */
function informativa(overrides: Partial<NotificacionDTO> = {}): NotificacionDTO {
  return dto({
    id: "info-1",
    notification_type: "box",
    accionable: false,
    titulo: "Carga masiva terminada · 120 órdenes, 3 con error",
    detalle: null,
    cuando: "hace 3 h",
    atajo: null,
    ...overrides,
  });
}

/** Los dos bloques del panel, por su nombre accesible (`section` con encabezado = `region`). */
const bloqueAccion = () =>
  screen.getByRole("region", { name: "Requieren tu acción" });
const bloqueInfo = () =>
  screen.getByRole("region", { name: "Para tu información" });

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

/**
 * Quita comentarios: las guardias de código no deben disparar con la prosa.
 *
 * Feature 209 — quitador COMPARTIDO. La copia local (a) dejaba vivo el comentario de cola y
 * (b) pasaba el barrido de JSX DESPUÉS del de bloque, cuando el de bloque ya se había comido
 * el `/* … *\/` de dentro y dejado las llaves sueltas. Medido sobre los dos archivos que lee:
 * los cuatro patrones de R47 dan lo mismo antes y después.
 */
const sinComentarios = quitarComentarios;

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
describe("NotificationsBell — distintivo (146/R41–R43 ⇒ 409/R10–R13)", () => {
  // ⚠️ ESTOS DOS CASOS CAMBIAN DE CONTRATO, Y NO ES UNA RELAJACIÓN: es la ficha entera.
  //
  // 146/R41 fijaba «el distintivo cuenta las NO LEÍDAS» y 409/R11+R13 lo sustituyen por «cuenta
  // lo que hay POR HACER, y lo dice con palabras». Medido en producción el 2026-09-10: 1.214
  // avisos emitidos y 26 de 39 personas sin abrir ninguno. Un 7 rojo que puede ser siete cosas
  // por hacer o siete avisos ya resueltos que nadie marcó se aprende a ignorar.
  //
  // Los literales van A MANO, nunca contra la constante que los genera.
  it("409/R11+R13: el distintivo cuenta lo ACCIONABLE y lo dice con palabras", async () => {
    // Dos accionables YA LEÍDOS y una informativa sin leer: si el distintivo siguiera contando
    // lecturas diría «1», y si contara filas diría «3».
    listarMock.mockResolvedValue(
      ok([
        accionable({ id: "a", read: true }),
        accionable({ id: "b", read: true }),
        informativa({ id: "c", read: false }),
      ]),
    );
    renderBell();

    expect(await screen.findByText("2 por hacer")).toBeInTheDocument();
    expect(trigger()).toHaveAttribute("aria-label", "Notificaciones, 2 por hacer");
    // R13: el nombre accesible NO puede volver a hablar de mensajes sin leer.
    expect(trigger().getAttribute("aria-label")).not.toContain("sin leer");
  });

  it("409/R12: por encima del tope el distintivo muestra la forma abreviada", async () => {
    listarMock.mockResolvedValue({
      status: "ok",
      items: [accionable({ id: "a", read: false })],
      noLeidas: 1,
      porHacer: 120,
    });
    renderBell();

    expect(await screen.findByText("+99 por hacer")).toBeInTheDocument();
    expect(screen.queryByText("120 por hacer")).not.toBeInTheDocument();
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
describe("NotificationsBell — presentación de cada notificación (146/R49 ⇒ 409/R17+R20)", () => {
  // ⚠️ LA MITAD DEL «Anexo:» CAMBIA DE CONTRATO A PROPÓSITO: 409/R20 prohíbe esa palabra en el
  // panel. Sigue siendo la MISMA información —la línea de contexto bajo el título—, ahora en el
  // campo `detalle` del DTO y sin la etiqueta de jerga. Lo que NO cambia y se sigue afirmando: el
  // icono de cada tipo con su nombre accesible, y que sin contexto no se pinta una segunda línea.
  it("409/R17: icono de su tipo, título, contexto e instante, sin la palabra «Anexo:»", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue(
      ok([
        accionable({
          id: "a",
          notification_type: "alert",
          titulo: "Orden rechazada.",
          detalle: "REM-1",
        }),
        accionable({
          id: "b",
          notification_type: "box",
          titulo: "Carga masiva terminada.",
          detalle: "Lote 9",
        }),
        accionable({
          id: "c",
          notification_type: "warning",
          titulo: "Cierre por aprobar.",
          detalle: null,
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
    expect(screen.getByText("REM-1")).toBeInTheDocument();
    expect(screen.getByText("Lote 9")).toBeInTheDocument();
    // R20: la etiqueta de jerga NO vuelve, ni con el prefijo ni suelta.
    expect(screen.queryByText(/Anexo:/)).not.toBeInTheDocument();
    // Sin contexto no se pinta una segunda línea.
    const sinDetalle = screen.getByText("Cierre por aprobar.").closest("li")!;
    expect(sinDetalle.querySelectorAll("p")).toHaveLength(1);
  });

  it("409/R20: una fila que TRAE anexo tampoco lo pinta con la etiqueta", async () => {
    // El anexo sigue viajando en el DTO (R34: nada se retira), pero el panel ya no lo enseña con
    // su nombre de jerga. Sin este caso, el aserto de arriba pasaría por no haber anexo ninguno.
    const user = userEvent.setup();
    listarMock.mockResolvedValue(
      ok([informativa({ id: "x", titulo: "Aviso con anexo.", anexo: "REM-99" })]),
    );
    renderBell();

    await abrir(user);
    await screen.findByText("Aviso con anexo.");
    expect(screen.queryByText(/Anexo:/)).not.toBeInTheDocument();
    expect(screen.queryByText("REM-99")).not.toBeInTheDocument();
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
      notifications: [accionable({ id: "f1", titulo: "Desde props." })],
    });

    await abrir(user);
    expect(screen.getByText("Desde props.")).toBeInTheDocument();
    // El distintivo sale de los datos iniciales. ⚠️ 409/R13: dice lo que hay POR HACER, no lo
    // que hay sin leer -- y la cifra de los datos iniciales se deriva del mismo campo
    // `accionable` que usa el servidor, no de un segundo criterio del cliente.
    expect(trigger()).toHaveAttribute("aria-label", "Notificaciones, 1 por hacer");
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

  // ⚠️ 409/R30 (decisión Q8) — EL TONO CAMBIA DE CRITERIO, NO DE COMPORTAMIENTO: suena cuando
  // sube LO ACCIONABLE, no las no leídas. Dos criterios para el mismo número acaban en dos
  // verdades sobre el mismo hecho: la campana diría «2 por hacer» y el tono habría sonado por un
  // acuse de recibo que nadie tiene que atender.
  it("161/R19 ⇒ 409/R30: suena cuando lo POR HACER aumenta entre revalidaciones", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue(ok([accionable({ id: "a", read: true })]));
    renderBell();

    await waitFor(() => expect(listarMock).toHaveBeenCalled());
    expect(reproducirTonoMock).not.toHaveBeenCalled();

    // Llega un aviso accionable nuevo; abrir la campana revalida (R47 de la 146).
    listarMock.mockResolvedValue(
      ok([accionable({ id: "a", read: true }), accionable({ id: "b", read: false })]),
    );
    await user.click(trigger());

    await waitFor(() => expect(reproducirTonoMock).toHaveBeenCalledTimes(1));
  });

  it("R11/R24: no suena al montar, aunque el servidor devuelva cosas por hacer", async () => {
    listarMock.mockResolvedValue(
      ok([accionable({ id: "a", read: false }), accionable({ id: "b", read: false })]),
    );
    renderBell();

    await waitFor(() =>
      expect(screen.getByText("2 por hacer")).toBeInTheDocument(),
    );
    expect(reproducirTonoMock).not.toHaveBeenCalled();
  });

  it("R11/R24: tampoco suena al montar con avisos en los datos iniciales", async () => {
    listarMock.mockImplementation(() => new Promise(() => {}));
    renderBell({ notifications: [accionable({ id: "a", read: false })] });

    await waitFor(() =>
      expect(trigger()).toHaveAttribute("aria-label", "Notificaciones, 1 por hacer"),
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
      ok([accionable({ id: "a", read: false }), accionable({ id: "b", read: false })]),
    );
    renderBell();

    await waitFor(() => expect(screen.getByText("2 por hacer")).toBeInTheDocument());
    reproducirTonoMock.mockClear(); // se descuenta la subida inicial (R19)

    await abrir(user);

    // Tras marcar todas, SWR revalida: el servidor ya las devuelve leídas. Sin esto el
    // doble contradiría al servidor real y el contador volvería a subir. Se cambia DESPUÉS
    // de abrir porque abrir ya revalida (R47) y dejaría el control deshabilitado.
    listarMock.mockResolvedValue(
      ok([accionable({ id: "a", read: true }), accionable({ id: "b", read: true })]),
    );

    await user.click(screen.getByText("Marcar todas como leídas"));

    await waitFor(() => expect(marcarTodasMock).toHaveBeenCalled());
    expect(reproducirTonoMock).not.toHaveBeenCalled();
  });

  it("R20: descartar una notificación no suena", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue(
      ok([accionable({ id: "a", read: false }), accionable({ id: "b", read: false })]),
    );
    renderBell();

    await waitFor(() => expect(screen.getByText("2 por hacer")).toBeInTheDocument());
    reproducirTonoMock.mockClear();

    await abrir(user);

    // Tras descartar, el servidor ya no devuelve la descartada: el contador BAJA a 1.
    listarMock.mockResolvedValue(ok([accionable({ id: "b", read: false })]));

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

  it("R14: con el sonido silenciado la subida de lo por hacer no suena", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("ordenex:sonido-notificaciones", "off");
    listarMock.mockResolvedValue(ok([informativa({ id: "a", read: true })]));
    renderBell();

    await waitFor(() => expect(listarMock).toHaveBeenCalled());

    // Misma subida que hace sonar en el test de R19, pero con el tono silenciado.
    listarMock.mockResolvedValue(
      ok([informativa({ id: "a", read: true }), accionable({ id: "b", read: false })]),
    );
    await user.click(trigger());

    await waitFor(() => expect(screen.getByText("1 por hacer")).toBeInTheDocument());
    expect(reproducirTonoMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ⚠️ FICHA 409 — DE BUZÓN A COLA DE TRABAJO (R10–R30)
//
// Medido en producción el 2026-09-10: 1.214 avisos emitidos y 26 de 39 personas no habían abierto
// ninguno; 1 de 5 tiendas y 1 de 4 admins. La campana contaba MENSAJES SIN LEER, que no es lo
// mismo que COSAS POR HACER, y por eso se aprendía a ignorarla.
//
// LOS LITERALES SE AFIRMAN A MANO —«2 por hacer», «Requieren tu acción», «Para tu información»,
// «Gestionar novedades»—, nunca contra la constante que los genera: comparar un texto con su
// propia fuente está siempre verde y ya dejó pasar en este repo un tope que la app rechazaba.
// ---------------------------------------------------------------------------
describe("NotificationsBell — el distintivo cuenta trabajo, no mensajes (409/R10–R15)", () => {
  it("R10: con cero por hacer no se pinta distintivo alguno, aunque haya sin leer", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue(
      ok([
        informativa({ id: "a", read: false }),
        informativa({ id: "b", read: false, titulo: "Otra informativa." }),
      ]),
    );
    renderBell();

    await waitFor(() =>
      expect(trigger()).toHaveAttribute("aria-label", "Notificaciones"),
    );
    await abrir(user);
    expect(screen.queryByText(/por hacer/i)).not.toBeInTheDocument();
    // Ni el punto rojo de antes por otra vía: el disparador no lleva NADA.
    expect(trigger().textContent).toBe("");
  });

  it("R14: «Marcar leídas» NO cambia el conteo de lo por hacer", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue(
      ok([accionable({ id: "a", read: false }), accionable({ id: "b", read: false })]),
    );
    renderBell();

    const marcar = await abrir(user);
    await waitFor(() => expect(marcar).toBeEnabled());
    expect(screen.getByText("2 por hacer")).toBeInTheDocument();

    // El servidor devuelve LAS MISMAS dos filas, ya leídas: el trabajo sigue ahí.
    listarMock.mockResolvedValue(
      ok([accionable({ id: "a", read: true }), accionable({ id: "b", read: true })]),
    );
    await user.click(marcar);

    await waitFor(() => expect(marcarTodasMock).toHaveBeenCalledTimes(1));
    // Antes de la 409 esto habría dejado el distintivo en cero. Marcar leídas no hace el trabajo.
    expect(screen.getByText("2 por hacer")).toBeInTheDocument();
    expect(trigger()).toHaveAttribute("aria-label", "Notificaciones, 2 por hacer");
  });

  it("R15: descartar un accionable baja el conteo en uno, sin recargar la página", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue(
      ok([
        accionable({ id: "a", titulo: "Lo primero por hacer." }),
        accionable({ id: "b", titulo: "Lo segundo por hacer." }),
      ]),
    );
    renderBell();

    await abrir(user);
    await screen.findByText("Lo primero por hacer.");
    expect(screen.getByText("2 por hacer")).toBeInTheDocument();

    listarMock.mockResolvedValue(
      ok([accionable({ id: "b", titulo: "Lo segundo por hacer." })]),
    );
    const primera = screen.getByText("Lo primero por hacer.").closest("li") as HTMLElement;
    await user.click(
      within(primera).getByRole("button", { name: "Descartar notificación" }),
    );

    await waitFor(() => expect(descartarMock).toHaveBeenCalledWith("a"));
    await waitFor(() =>
      expect(screen.getByText("1 por hacer")).toBeInTheDocument(),
    );
  });
});

describe("NotificationsBell — el panel separa lo que hay que hacer (409/R16–R26)", () => {
  it("R16: dos bloques, con sus encabezados y en ese ORDEN", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue(
      ok([informativa({ id: "i1" }), accionable({ id: "a1" })]),
    );
    renderBell();

    await abrir(user);
    await screen.findByText("5 novedades esperan tu decisión");

    // El orden se afirma por POSICIÓN EN EL DOM: el servidor puede mandar la informativa primera
    // —aquí lo hace— y lo accionable tiene que seguir saliendo arriba.
    const regiones = screen.getAllByRole("region");
    expect(
      regiones.map((r) => within(r).getByRole("heading", { level: 3 }).textContent),
    ).toEqual(["Requieren tu acción", "Para tu información"]);
  });

  it("R17: el accionable con atajo lleva título, contexto, instante y su botón", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue(ok([accionable({ id: "a1" })]));
    renderBell();

    await abrir(user);
    const item = (await screen.findByText("5 novedades esperan tu decisión")).closest(
      "li",
    ) as HTMLElement;

    expect(
      within(item).getByText("La más antigua lleva 3 días en bodega."),
    ).toBeInTheDocument();
    // El instante llega YA RESUELTO del servidor (R31/R32): la campana no lo calcula.
    expect(within(item).getByText("hace 2 h")).toBeInTheDocument();
    expect(
      within(item).getByRole("link", { name: "Gestionar novedades" }),
    ).toBeInTheDocument();
  });

  it("R18: el accionable SIN atajo se pinta en el bloque de acción y sin botón", async () => {
    // `geocodificacion_caida` es el ÚNICO del catálogo: la credencial se arregla en la consola del
    // proveedor y ninguna pantalla de la app acerca a resolverlo. Un botón sería una promesa
    // falsa, y una promesa falsa enseña a ignorar los atajos que sí resuelven algo.
    const user = userEvent.setup();
    listarMock.mockResolvedValue(
      ok([
        accionable({
          id: "geo",
          titulo: "El servicio de mapas lleva 2 h rechazando peticiones",
          detalle: "43 direcciones sin ubicar. Es nuestra credencial, no las direcciones.",
          atajo: null,
        }),
      ]),
    );
    renderBell();

    await abrir(user);
    const item = (
      await screen.findByText("El servicio de mapas lleva 2 h rechazando peticiones")
    ).closest("li") as HTMLElement;

    // Está en el bloque de acción...
    expect(bloqueAccion()).toContainElement(item);
    // ...y no tiene NI enlace NI más botón que el de descartar.
    expect(within(item).queryByRole("link")).not.toBeInTheDocument();
    expect(
      within(item).getAllByRole("button").map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Descartar notificación"]);
  });

  it("R19: en el bloque informativo no hay botón de acción, sólo el de descartar", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue(
      ok([
        accionable({ id: "a1" }),
        informativa({ id: "i1" }),
        informativa({ id: "i2", titulo: "18 órdenes salieron a reparto hoy" }),
      ]),
    );
    renderBell();

    await abrir(user);
    await screen.findByText("18 órdenes salieron a reparto hoy");

    const info = bloqueInfo();
    expect(within(info).queryAllByRole("link")).toHaveLength(0);
    expect(
      within(info).getAllByRole("button").map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Descartar notificación", "Descartar notificación"]);
    // Control positivo: el atajo SÍ existe, pero en el otro bloque.
    expect(
      within(bloqueAccion()).getByRole("link", { name: "Gestionar novedades" }),
    ).toBeInTheDocument();
  });

  it("R21: el atajo navega a su destino declarado y cierra el panel", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue(ok([accionable({ id: "a1" })]));
    renderBell();

    await abrir(user);
    const enlace = await screen.findByRole("link", { name: "Gestionar novedades" });
    // El destino es el que declara el catálogo para ese par (evento, rol): la campana no lo
    // compone ni conoce rutas por evento.
    expect(enlace).toHaveAttribute("href", "/novedades?superficie=devolucion");

    await user.click(enlace);

    expect(navegoA).toHaveBeenCalledWith("/novedades?superficie=devolucion");
    await waitFor(() =>
      expect(screen.queryByText("Marcar todas como leídas")).not.toBeInTheDocument(),
    );
  });

  it("R23: un bloque sin avisos no pinta ni su encabezado ni su contenedor", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue(ok([informativa({ id: "i1" })]));
    renderBell();

    await abrir(user);
    await screen.findByText("Carga masiva terminada · 120 órdenes, 3 con error");

    expect(
      screen.queryByRole("region", { name: "Requieren tu acción" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Requieren tu acción")).not.toBeInTheDocument();
    // El bloque que SÍ tiene avisos sigue ahí: sin esto, un panel vacío pasaría el caso.
    expect(bloqueInfo()).toBeInTheDocument();
  });

  it("R25: el filtro oculta el bloque informativo y «Todas» lo devuelve", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue(
      ok([accionable({ id: "a1" }), accionable({ id: "a2" }), informativa({ id: "i1" })]),
    );
    renderBell();

    await abrir(user);
    await screen.findByText("Carga masiva terminada · 120 órdenes, 3 con error");
    // Por defecto se ven los dos bloques, que es lo que pinta el contrato visual.
    expect(bloqueInfo()).toBeInTheDocument();

    // Las dos píldoras llevan SU cifra: la de R8 y el total del listado.
    await user.click(screen.getByRole("button", { name: "Requieren tu acción · 2" }));
    expect(
      screen.queryByRole("region", { name: "Para tu información" }),
    ).not.toBeInTheDocument();
    expect(bloqueAccion()).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Todas · 3" }));
    expect(bloqueInfo()).toBeInTheDocument();
  });

  it("R26: hay un «Descartar notificación» por aviso en los DOS bloques", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue(
      ok([accionable({ id: "a1" }), informativa({ id: "i1" })]),
    );
    renderBell();

    await abrir(user);
    await screen.findByText("5 novedades esperan tu decisión");

    expect(
      within(bloqueAccion()).getAllByRole("button", { name: "Descartar notificación" }),
    ).toHaveLength(1);
    expect(
      within(bloqueInfo()).getAllByRole("button", { name: "Descartar notificación" }),
    ).toHaveLength(1);
  });

  it("R29: no hay pie «Ver todas las notificaciones» — esa pantalla no existe", async () => {
    // Decisión Q7 del humano: el mockup la dibujaba y se retira. Un aserto, no un comentario.
    const user = userEvent.setup();
    listarMock.mockResolvedValue(
      ok([accionable({ id: "a1" }), informativa({ id: "i1" })]),
    );
    renderBell();

    await abrir(user);
    await screen.findByText("5 novedades esperan tu decisión");

    expect(screen.queryByText(/Ver todas las notificaciones/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Ver todas/ })).not.toBeInTheDocument();
  });
});

describe("NotificationsBell — el tono sigue el mismo criterio que la campana (409/R30)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("R30: subir las NO LEÍDAS sin subir lo por hacer NO suena", async () => {
    // ⚠️ ESTE ES EL CASO QUE MATA LA MUTACIÓN «volver a pasarle `noLeidas` al hook del tono»:
    // las no leídas pasan de 0 a 2 y el tono tiene que quedarse callado.
    const user = userEvent.setup();
    listarMock.mockResolvedValue(ok([informativa({ id: "i1", read: true })]));
    renderBell();

    await waitFor(() => expect(listarMock).toHaveBeenCalled());
    expect(reproducirTonoMock).not.toHaveBeenCalled();

    listarMock.mockResolvedValue(
      ok([
        informativa({ id: "i1", read: false }),
        informativa({ id: "i2", read: false, titulo: "Otra informativa." }),
      ]),
    );
    await user.click(trigger());

    await waitFor(() => expect(listarMock).toHaveBeenCalledTimes(2));
    expect(reproducirTonoMock).not.toHaveBeenCalled();
  });

  it("R30: subir lo POR HACER sí suena, una sola vez", async () => {
    // El par positivo del caso de arriba: sin él, un hook desconectado pasaría los dos.
    const user = userEvent.setup();
    listarMock.mockResolvedValue(ok([informativa({ id: "i1", read: true })]));
    renderBell();

    await waitFor(() => expect(listarMock).toHaveBeenCalled());

    listarMock.mockResolvedValue(
      ok([
        informativa({ id: "i1", read: true }),
        accionable({ id: "a1", read: true }),
        accionable({ id: "a2", read: true }),
      ]),
    );
    await user.click(trigger());

    // Dos avisos accionables nuevos y de golpe: suena UNA vez, no una por unidad (161/R13).
    await waitFor(() => expect(reproducirTonoMock).toHaveBeenCalledTimes(1));
    // Y son accionables aunque estén LEÍDOS: la lectura no entra en este número (R9).
    expect(screen.getByText("2 por hacer")).toBeInTheDocument();
  });
});
