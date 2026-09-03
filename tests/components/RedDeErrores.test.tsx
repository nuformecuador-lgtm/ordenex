// @vitest-environment jsdom
//
// Feature 365 — LAS CUATRO GARANTIAS DE LA RED, sobre las FRONTERAS REALES.
//
// No se prueba un componente de mentira: se monta el `export default` de cada `error.tsx` del
// arbol, que es exactamente lo que Next monta cuando algo revienta. Lo unico doblado es el
// borde (router y Server Actions del encabezado), porque lo verificado es la red, no la sesion.
//
// Las garantias, y por que cada una tiene test propio:
//   1. SE VE QUE ALGO FALLO — una red que finja «no hay datos» es peor que no tenerla.
//   2. SE PUEDE SALIR — reintentar (y que el reintento pida datos de verdad) y volver al inicio.
//   3. EL ERROR SIGUE LLEGANDO AL REGISTRO — la que impide que la red sea una mordaza.
//   4. NO SE ENSENA EL DETALLE TECNICO — un mensaje interno puede llevar datos.
import type { ReactElement } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { refreshMock, pushMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/ordenes",
  useSearchParams: () => new URLSearchParams(),
}));

// Bordes del encabezado (`AppPage` -> `PageHeader`): son Server Actions, no la red de errores.
vi.mock("@/lib/actions/notificaciones", () => ({
  listarNotificaciones: vi.fn(async () => ({ status: "ok", items: [], noLeidas: 0 })),
  descartarNotificacion: vi.fn(async () => ({ status: "ok" })),
  marcarTodasLeidas: vi.fn(async () => ({ status: "ok" })),
}));
vi.mock("@/lib/actions/auth", () => ({
  logout: vi.fn(async () => ({ status: "ok" })),
}));

import { ToastProvider } from "@/providers/ToastProvider";
import { TemaProvider } from "@/providers/TemaProvider";
import ErrorDelPortal from "@/app/(app)/error";
import ErrorDeCierres from "@/app/(app)/cierres-admin/error";
import ErrorDeLaRaiz from "@/app/error";
// La frontera global se monta por su CONTENIDO: su `export default` trae `<html>`/`<body>`,
// que React aplica al documento real y cuyos hijos descarta al montarlos en un contenedor.
// Ver la nota en `app/global-error.tsx`.
import { ContenidoErrorGlobal as GlobalError } from "@/app/global-error";

/**
 * Los MISMOS proveedores que monta `app/(app)/layout.tsx`, y no un doble.
 *
 * No es decorado del test: `app/(app)/error.tsx` usa `AppPage` -> `PageHeader` -> `LogoutButton`,
 * que llama a `useToast()` y LANZA fuera de un `ToastProvider`. En la app eso no puede pasar
 * —la frontera se renderiza DENTRO del layout del portal, que ya trae los dos proveedores—, y
 * montarlos aqui reproduce esa condicion en vez de esconderla tras un mock.
 */
function montar(elemento: ReactElement) {
  return render(
    <TemaProvider temaInicial={null}>
      <ToastProvider>{elemento}</ToastProvider>
    </TemaProvider>,
  );
}

type ConReportError = { reportError?: (error: unknown) => void };
const reportErrorOriginal = (globalThis as ConReportError).reportError;

let reportError: ReturnType<typeof vi.fn<(error: unknown) => void>>;

/**
 * Un error con la forma EXACTA que Next entrega en produccion cuando el fallo fue del servidor:
 * el mensaje viene ya redactado por Next y el unico dato util es el `digest`. Se le pone un
 * mensaje reconocible para poder afirmar que NO aparece en pantalla.
 */
function errorDeServidor(mensaje = "PGRST116: column ordenes.guia_secreta does not exist") {
  const error = new Error(mensaje) as Error & { digest?: string };
  error.digest = "3820574192";
  return error;
}

beforeEach(() => {
  refreshMock.mockClear();
  pushMock.mockClear();
  reportError = vi.fn();
  (globalThis as ConReportError).reportError = reportError;
});

afterEach(() => {
  cleanup();
  if (reportErrorOriginal === undefined) {
    delete (globalThis as ConReportError).reportError;
  } else {
    (globalThis as ConReportError).reportError = reportErrorOriginal;
  }
});

/* ── GARANTIA 1: se ve que algo fallo ─────────────────────────────────────────────────────── */

describe("la red dice que algo fallo (no finge que no hay datos)", () => {
  it("el portal titula el fallo y lo anuncia como region viva", () => {
    montar(<ErrorDelPortal error={errorDeServidor()} reset={vi.fn()} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "No pudimos cargar esta pantalla" }),
    ).toBeInTheDocument();
    // `role="alert"`: la pantalla sustituye al contenido SIN navegacion, asi que sin region
    // viva un lector de pantalla no anuncia nada y la persona sigue esperando datos.
    const aviso = screen.getByRole("alert");
    expect(aviso).toHaveTextContent("La pantalla no llegó a mostrarse");
  });

  it("NO usa el vocabulario de «no hay nada»: habla de un fallo", () => {
    const { container } = montar(<ErrorDelPortal error={errorDeServidor()} reset={vi.fn()} />);

    const texto = container.textContent ?? "";
    expect(texto).toMatch(/fall(a|ó|ar)/i);
    expect(texto).not.toMatch(/no hay (datos|resultados|registros|elementos)/i);
    expect(texto).not.toMatch(/sin resultados/i);
  });
});

/* ── GARANTIA 2: se puede salir ───────────────────────────────────────────────────────────── */

describe("la red deja salir", () => {
  it("el reintento PIDE LOS DATOS DE NUEVO y vacía el estado de error", async () => {
    // `reset()` a secas volveria a renderizar la misma carga rota: el boton pareceria muerto.
    // Por eso el reintento es `router.refresh()` + `reset()`, y el test exige LAS DOS.
    const reset = vi.fn();
    montar(<ErrorDelPortal error={errorDeServidor()} reset={reset} />);

    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("ofrece una salida al inicio del portal", () => {
    montar(<ErrorDelPortal error={errorDeServidor()} reset={vi.fn()} />);

    expect(screen.getByRole("link", { name: "Ir al inicio" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });

  it("la frontera de la raíz sale a `/`, que sirve con sesión y sin ella", () => {
    montar(<ErrorDeLaRaiz error={errorDeServidor()} reset={vi.fn()} />);

    expect(screen.getByRole("link", { name: "Volver al inicio" })).toHaveAttribute("href", "/");
  });
});

/* ── GARANTIA 3: el error SIGUE llegando al registro ──────────────────────────────────────── */

describe("la red no amordaza el error", () => {
  it("el portal RE-EMITE el error capturado, con el objeto entero", async () => {
    const error = errorDeServidor();
    montar(<ErrorDelPortal error={error} reset={vi.fn()} />);

    await waitFor(() => expect(reportError).toHaveBeenCalledTimes(1));
    expect(reportError).toHaveBeenCalledWith(error);
  });

  it("la frontera de los cierres RE-EMITE el error", async () => {
    const error = errorDeServidor("liquidacion: monto negativo en el cierre 91");
    montar(<ErrorDeCierres error={error} reset={vi.fn()} />);

    await waitFor(() => expect(reportError).toHaveBeenCalledWith(error));
  });

  it("la frontera de la raíz RE-EMITE el error", async () => {
    const error = errorDeServidor("layout: sesión ilegible");
    montar(<ErrorDeLaRaiz error={error} reset={vi.fn()} />);

    await waitFor(() => expect(reportError).toHaveBeenCalledWith(error));
  });

  it("la frontera global RE-EMITE el error", async () => {
    const error = errorDeServidor("metadataBase: Invalid URL");
    montar(<GlobalError error={error} reset={vi.fn()} />);

    await waitFor(() => expect(reportError).toHaveBeenCalledWith(error));
  });

  it("un re-render NO multiplica la línea del registro", async () => {
    const error = errorDeServidor();
    const { rerender } = montar(<ErrorDelPortal error={error} reset={vi.fn()} />);

    await waitFor(() => expect(reportError).toHaveBeenCalledTimes(1));
    const otraVez = (
      <TemaProvider temaInicial={null}>
        <ToastProvider>
          <ErrorDelPortal error={error} reset={vi.fn()} />
        </ToastProvider>
      </TemaProvider>
    );
    rerender(otraVez);
    rerender(otraVez);

    expect(reportError).toHaveBeenCalledTimes(1);
  });
});

/* ── GARANTIA 4: nada de detalle tecnico en pantalla ──────────────────────────────────────── */

type PropsDeFrontera = { error: Error & { digest?: string }; reset: () => void };

const CADA_FRONTERA: ReadonlyArray<[string, (props: PropsDeFrontera) => ReactElement]> = [
  ["portal", (p) => <ErrorDelPortal {...p} />],
  ["cierres", (p) => <ErrorDeCierres {...p} />],
  ["raiz", (p) => <ErrorDeLaRaiz {...p} />],
  ["global", (p) => <GlobalError {...p} />],
];

describe("la red no le ensena el detalle tecnico al usuario", () => {
  for (const [nombre, Frontera] of CADA_FRONTERA) {
    it(`la frontera «${nombre}» no pinta el mensaje ni el stack del error`, () => {
      const error = errorDeServidor(
        "PGRST116: relation ordenes.telefono_cliente does not exist en 200.9.180.7",
      );
      const { container } = montar(<Frontera error={error} reset={vi.fn()} />);

      const texto = container.textContent ?? "";
      expect(texto).not.toContain("PGRST116");
      expect(texto).not.toContain("telefono_cliente");
      expect(texto).not.toContain("200.9.180.7");
      expect(texto).not.toContain(error.message);
      expect(texto).not.toContain("at Object");
      expect(texto).not.toContain(".tsx:");
    });

    it(`la frontera «${nombre}» SÍ ensena el identificador con el que se localiza el fallo`, () => {
      const error = errorDeServidor();
      const { container } = montar(<Frontera error={error} reset={vi.fn()} />);

      // El `digest` es un hash del mensaje + el stack calculado por Next: no lleva datos, y es
      // la clave literal con la que se encuentra la linea en el registro del servidor.
      expect(container.textContent).toContain("3820574192");
    });

    it(`la frontera «${nombre}» calla el identificador cuando no hay ninguno`, () => {
      // Fallo de CLIENTE: Next no genera `digest`. Inventarse un codigo, o pintar un hueco con
      // dos puntos y nada detras, es ruido que el usuario no puede usar.
      const error = new Error("fallo de cliente") as Error & { digest?: string };
      const { container } = montar(<Frontera error={error} reset={vi.fn()} />);

      expect(container.textContent).not.toContain("Código del error");
    });
  }
});

/* ── LA FRONTERA DEL DINERO DICE ALGO DISTINTO ────────────────────────────────────────────── */

describe("la frontera de los cierres (donde se mueve el dinero)", () => {
  it("avisa de VERIFICAR antes de repetir, en vez de invitar a reintentar a ciegas", () => {
    montar(<ErrorDeCierres error={errorDeServidor()} reset={vi.fn()} />);

    const texto = screen.getByRole("alert").textContent ?? "";
    expect(texto).toContain("Antes de repetir una aprobación, mirá cómo quedó");
    expect(texto).toMatch(/revisá el estado/i);
  });

  it("NO promete que no se guardó nada: el fallo puede ocurrir DESPUÉS de guardar", () => {
    // El render se dispara tambien con el `router.refresh()` posterior a una aprobacion
    // correcta. Una frase tranquilizadora que no podemos sostener es peor que ninguna.
    const { container } = montar(<ErrorDeCierres error={errorDeServidor()} reset={vi.fn()} />);

    const texto = container.textContent ?? "";
    expect(texto).not.toMatch(/no se (guardó|guardo|registró|registro|aprobó|aprobo)/i);
    expect(texto).not.toMatch(/nada se (perdió|perdio|guardó|guardo)/i);
  });

  it("su botón de reintento nombra lo que hace: recargar los cierres", async () => {
    const reset = vi.fn();
    montar(<ErrorDeCierres error={errorDeServidor()} reset={reset} />);

    await userEvent.click(screen.getByRole("button", { name: "Volver a cargar los cierres" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

/* ── LA FRONTERA GLOBAL ES AUTOSUFICIENTE ─────────────────────────────────────────────────── */

describe("la frontera global (el layout raíz caído)", () => {
  it("anuncia el fallo sin depender de ningún layout", () => {
    montar(<GlobalError error={errorDeServidor()} reset={vi.fn()} />);

    expect(screen.getByRole("alert").textContent).toContain("No pudimos cargar la aplicación");
  });

  it("ofrece recargar y una salida al inicio", () => {
    montar(<GlobalError error={errorDeServidor()} reset={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Recargar la página" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver al inicio" })).toHaveAttribute("href", "/");
  });
});
