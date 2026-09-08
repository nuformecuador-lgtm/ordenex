// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GestionarOrdenPanel } from "@/app/(app)/mis-asignaciones/_components/GestionarOrdenPanel";
import { gestionar } from "@/lib/actions/mis-asignaciones";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 399 — el aviso de ubicacion denegada, EN LA PANTALLA del mensajero.
//
// Lo que protege este archivo y no protege el test del modulo puro: que el panel lea el
// contexto de verdad y pinte el texto que sirve en ESA pantalla. El fallo de campo del
// 2026-09-08 fue exactamente eso: Ordenex abierta desde su icono (sin barra de direcciones ni
// candado) y el aviso mandando a tocar el candado. La mensajera se quedo parada en la calle.
//
// Los textos se afirman contra LITERALES escritos a mano. Compararlos contra la constante que
// los genera saldria verde con el bug puesto.

vi.mock("@/lib/actions/mis-asignaciones", () => ({ gestionar: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
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

const gestionarMock = vi.mocked(gestionar);

function makeOrden(): MiAsignacionDTO {
  return {
    id: "g1",
    numGuia: 1001,
    numRemision: "REM-001",
    estatusValue: "en_reparto",
    destinatario: "Ana Pérez",
    telefonoDest: "88880000",
    direccion: "Calle 1, casa 2",
    producto: "Caja mediana",
    peso: 1.5,
    montoCobrar: 150,
    latitud: 9.9281244,
    longitud: -84.0907246,
    notas: null,
    tiendaNombre: "Tienda X",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    secuenciaRuta: 1,
  } as MiAsignacionDTO;
}

/** El permiso DENEGADO (codigo 1), que es el unico desenlace que muestra este aviso. */
function instalarGeolocationDenegada() {
  Object.defineProperty(navigator, "geolocation", {
    value: {
      getCurrentPosition: vi.fn(
        (_ok: unknown, err: (e: { code: number }) => void) => err({ code: 1 }),
      ),
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
    writable: true,
  });
}

const matchMediaOriginal = Object.getOwnPropertyDescriptor(window, "matchMedia");
const permissionsOriginal = Object.getOwnPropertyDescriptor(
  navigator,
  "permissions",
);

/** `matchMedia` que dice que si a las consultas indicadas y que no al resto. */
function instalarMatchMedia(consultasQueCoinciden: string[]) {
  Object.defineProperty(window, "matchMedia", {
    value: (consulta: string) =>
      ({
        matches: consultasQueCoinciden.includes(consulta),
        media: consulta,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
    configurable: true,
    writable: true,
  });
}

function instalarPermissions(state: PermissionState | null) {
  Object.defineProperty(navigator, "permissions", {
    value: state === null ? undefined : { query: vi.fn().mockResolvedValue({ state }) },
    configurable: true,
    writable: true,
  });
}

function montar() {
  render(
    <GestionarOrdenPanel
      orden={makeOrden()}
      yaActiva
      onGestionarPedido={vi.fn().mockResolvedValue(true)}
      onCancelarGestion={vi.fn()}
      onSuccess={vi.fn()}
      onAbrirChat={vi.fn()}
      count={1}
    />,
  );
}

/** Abre la rama `reprogramada` (la unica sin foto obligatoria), la rellena y confirma. */
async function intentarGuardar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Reprogramar" }));
  fireEvent.change(screen.getByLabelText("Motivo"), {
    target: { value: "cliente ausente" },
  });
  await user.click(
    screen.getByRole("button", { name: /Guardar gestión|Obteniendo ubicación/ }),
  );
}

/**
 * El bloque de pasos que queda en pantalla (el toast se va solo; esto no). Se busca por su
 * NOMBRE ACCESIBLE —el titulo— porque esta pantalla pinta varios `role="alert"` a la vez (los
 * errores por campo, el fallo del hilo de notas), y porque ese nombre es justo lo que un
 * lector de pantalla anuncia.
 */
async function avisoEnPantalla(titulo: string): Promise<HTMLElement> {
  return await screen.findByRole("alert", { name: titulo });
}

const TITULO_APP_INSTALADA = "Activá la ubicación desde los Ajustes del teléfono";
const TITULO_NAVEGADOR = "Activá la ubicación para este sitio";

function ultimoToastDeError(): string {
  return String(errorMock.mock.calls.at(-1)?.[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  gestionarMock.mockResolvedValue({ status: "ok", estado: "reprogramada" } as never);
  instalarGeolocationDenegada();
  instalarPermissions(null); // sin Permissions API, como en la mayoria de los casos reales
});

afterEach(() => {
  cleanup();
  if (matchMediaOriginal) {
    Object.defineProperty(window, "matchMedia", matchMediaOriginal);
  } else {
    Reflect.deleteProperty(window, "matchMedia");
  }
  if (permissionsOriginal) {
    Object.defineProperty(navigator, "permissions", permissionsOriginal);
  } else {
    Reflect.deleteProperty(navigator, "permissions");
  }
});

describe("Feature 399 — con Ordenex instalada como app", () => {
  beforeEach(() => {
    instalarMatchMedia(["(display-mode: standalone)"]);
  });

  it("manda a los Ajustes del teléfono, con la ruta completa", async () => {
    const user = userEvent.setup();
    montar();
    await intentarGuardar(user);

    const aviso = await avisoEnPantalla(TITULO_APP_INSTALADA);
    expect(aviso).toHaveTextContent(
      "Activá la ubicación desde los Ajustes del teléfono",
    );
    expect(aviso).toHaveTextContent("Entrá en Aplicaciones y buscá Ordenex.");
    expect(aviso).toHaveTextContent("Tocá Permisos y después Ubicación.");
    expect(aviso).toHaveTextContent(
      "Elegí «Permitir solo mientras usás la app» y dejá activado «Usar ubicación precisa».",
    );
  });

  it("NO manda al candado: en esa pantalla no hay barra de direcciones", async () => {
    const user = userEvent.setup();
    montar();
    await intentarGuardar(user);

    const aviso = await avisoEnPantalla(TITULO_APP_INSTALADA);
    expect(aviso.textContent ?? "").not.toMatch(/candado/i);
    expect(aviso.textContent ?? "").not.toMatch(/barra de direcciones/i);
    expect(ultimoToastDeError()).not.toMatch(/candado/i);
    expect(ultimoToastDeError()).toBe(
      "Para registrar la gestión hace falta tu ubicación. Abriste Ordenex desde su ícono, así que el permiso se activa en los Ajustes del teléfono.",
    );
  });

  it("sigue bloqueando la gestión: el aviso no la deja pasar", async () => {
    const user = userEvent.setup();
    montar();
    await intentarGuardar(user);

    await waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(gestionarMock).not.toHaveBeenCalled();
  });
});

describe("Feature 399 — en un navegador normal", () => {
  beforeEach(() => {
    instalarMatchMedia([]); // ninguna consulta de display-mode coincide
  });

  it("manda al candado, que ahí sí existe, y conserva el texto de siempre", async () => {
    const user = userEvent.setup();
    montar();
    await intentarGuardar(user);

    expect(ultimoToastDeError()).toBe(
      "Para registrar la gestión hace falta tu ubicación. Activá el permiso desde el candado de la barra de direcciones (Permisos del sitio → Ubicación) y volvé a intentarlo.",
    );
    const aviso = await avisoEnPantalla(TITULO_NAVEGADOR);
    expect(aviso).toHaveTextContent(
      "Tocá el candado que está al lado de la dirección web, arriba.",
    );
    expect(aviso).toHaveTextContent(
      "Entrá en Permisos del sitio y activá Ubicación.",
    );
  });

  it("NO manda a los Ajustes de Android, que aquí no arreglan nada", async () => {
    const user = userEvent.setup();
    montar();
    await intentarGuardar(user);

    const aviso = await avisoEnPantalla(TITULO_NAVEGADOR);
    expect(aviso.textContent ?? "").not.toMatch(/ajustes/i);
    expect(aviso.textContent ?? "").not.toMatch(/aplicaciones/i);
    expect(ultimoToastDeError()).not.toMatch(/ajustes/i);
  });

  it("da la salida del navegador embebido de WhatsApp", async () => {
    const user = userEvent.setup();
    montar();
    await intentarGuardar(user);

    expect(await avisoEnPantalla(TITULO_NAVEGADOR)).toHaveTextContent(
      "Si abriste Ordenex desde un enlace de WhatsApp y no ves el candado, tocá los tres puntos y elegí «Abrir en Chrome».",
    );
  });
});

describe("Feature 399 — sin señal que leer", () => {
  it("sin matchMedia cae del lado del navegador, no del de la app instalada", async () => {
    // Es el default de la deteccion, y va en esta direccion a proposito: `matchMedia` lo tiene
    // cualquier navegador capaz de instalar la PWA, asi que si falta NO es una app instalada.
    Object.defineProperty(window, "matchMedia", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const user = userEvent.setup();
    montar();
    await intentarGuardar(user);

    expect(await avisoEnPantalla(TITULO_NAVEGADOR)).toHaveTextContent(
      "Tocá el candado que está al lado de la dirección web, arriba.",
    );
    expect(ultimoToastDeError()).not.toMatch(/ajustes/i);
  });
});

describe("Feature 399 — lo que aporta la Permissions API", () => {
  it("con el aviso sin contestar (prompt) pide reintentar, no manda a ningún ajuste", async () => {
    instalarMatchMedia([]);
    instalarPermissions("prompt");
    const user = userEvent.setup();
    montar();
    await intentarGuardar(user);

    const aviso = await avisoEnPantalla("Falta que aceptes el aviso de ubicación");
    expect(aviso).toHaveTextContent("Falta que aceptes el aviso de ubicación");
    expect(aviso).toHaveTextContent(
      "Cuando el teléfono te pregunte por la ubicación, elegí «Permitir».",
    );
  });

  it("con el sitio ya concedido, el bloqueo es del teléfono y no del candado", async () => {
    instalarMatchMedia([]);
    instalarPermissions("granted");
    const user = userEvent.setup();
    montar();
    await intentarGuardar(user);

    const aviso = await avisoEnPantalla("El permiso lo tiene que dar el teléfono");
    expect(aviso).toHaveTextContent("El permiso lo tiene que dar el teléfono");
    expect(aviso).toHaveTextContent(
      "Entrá en Aplicaciones y buscá el navegador que estás usando: Chrome, Samsung Internet…",
    );
    expect(aviso.textContent ?? "").not.toMatch(/candado/i);
  });

  it("con el sitio denegado en el navegador, sigue siendo el candado", async () => {
    instalarMatchMedia([]);
    instalarPermissions("denied");
    const user = userEvent.setup();
    montar();
    await intentarGuardar(user);

    expect(await avisoEnPantalla(TITULO_NAVEGADOR)).toHaveTextContent(
      "Tocá el candado que está al lado de la dirección web, arriba.",
    );
  });

  it("el permiso de la app instalada manda sobre lo que diga la Permissions API", async () => {
    instalarMatchMedia(["(display-mode: standalone)"]);
    instalarPermissions("denied");
    const user = userEvent.setup();
    montar();
    await intentarGuardar(user);

    expect(await avisoEnPantalla(TITULO_APP_INSTALADA)).toHaveTextContent(
      "Entrá en Aplicaciones y buscá Ordenex.",
    );
  });
});

describe("Feature 399 — el aviso no se queda pegado", () => {
  it("al volver a intentarlo con el permiso ya dado, el aviso desaparece", async () => {
    instalarMatchMedia(["(display-mode: standalone)"]);
    const user = userEvent.setup();
    montar();
    await intentarGuardar(user);
    expect(await avisoEnPantalla(TITULO_APP_INSTALADA)).toBeInTheDocument();

    // El mensajero fue a Ajustes, dio el permiso y vuelve: ahora la captura sale bien.
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: vi.fn(
          (ok: (p: { coords: { latitude: number; longitude: number } }) => void) =>
            ok({ coords: { latitude: 9.9281, longitude: -84.0907 } }),
        ),
      },
      configurable: true,
      writable: true,
    });
    await user.click(screen.getByRole("button", { name: /Guardar gestión/ }));

    await waitFor(() => expect(gestionarMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert", { name: TITULO_APP_INSTALADA })).toBeNull();
  });
});
