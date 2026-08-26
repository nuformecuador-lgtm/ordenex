// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { hayTrabajoEnCurso, MENSAJE_RELEVO_AHORA } from "@/lib/pwa/actualizacion";
import {
  declararTrabajo,
  hayTrabajoDeclarado,
  reiniciarTrabajoDeclarado,
  trabajoDeclarado,
} from "@/lib/pwa/trabajo-en-curso";
import { RESCATE_INLINE } from "@/lib/pwa/rescate-inline";
import { useActualizacionPwa } from "@/hooks/useActualizacionPwa";
import { AvisoVersionNueva } from "@/components/shared/AvisoVersionNueva";
import { GestionarOrdenPanel } from "@/app/(app)/mis-asignaciones/_components/GestionarOrdenPanel";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 284 — GUARDIA DEL AVISO DE VERSION NUEVA Y DEL CAMINO DE RESCATE.
//
// La decision del humano (2026-08-25) fue avisar con un boton en vez de esperar callado. Eso
// paga un precio que hay que cobrar aqui: **la recarga no puede llevarse una gestion a medio
// hacer**. Tres reglas:
//
//   G1 · solo se recarga la pestaña que lo pidio. `controllerchange` se dispara en TODAS las
//        pestañas: si cualquiera recargara, el mensajero perderia lo que estaba llenando en
//        otra ventana.
//   G2 · el aviso NO se pinta mientras haya trabajo en curso, y se vuelve a comprobar AL PULSAR.
//   G3 · el aviso no comparte sitio con la accion principal de la pantalla.
//
// ## Por que esta guardia se reescribio (B1 de la revision, 2026-08-25)
//
// La version anterior estaba VERDE Y MENTIA. Afirmaba G2 asignando `.value` a un `<input>`
// suelto del `document`, que es el unico caso que la heuristica de entonces detectaba. Sobre la
// app real —inputs CONTROLADOS de React— la heuristica respondia `false` y el aviso se pintaba
// encima del panel de gestion con el dinero tecleado. Era un test que se probaba a si mismo.
//
// Ahora hay dos capas de prueba y las dos son sobre codigo real:
//   (a) la SONDA de React que reprodujo el defecto (input controlado con texto tecleado);
//   (b) EL PANEL DE GESTION DE VERDAD, montado, con el recaudo tecleado y la foto elegida.

const RAIZ = path.resolve(__dirname, "..", "..", "..");
const LAYOUT = fs.readFileSync(path.join(RAIZ, "app/layout.tsx"), "utf8");
const LAYOUT_PORTAL = fs.readFileSync(path.join(RAIZ, "app/(app)/layout.tsx"), "utf8");

vi.mock("@/lib/actions/mis-asignaciones", () => ({ gestionar: vi.fn() }));
vi.mock("@/lib/actions/orden-notas", () => ({
  listarNotasOrden: vi.fn().mockResolvedValue({ status: "ok", notas: [], puedeEscribir: false }),
  publicarNotaOrden: vi.fn(),
  borrarNotaOrden: vi.fn(),
}));
vi.mock("@/lib/actions/orden-ayuda", () => ({ solicitarAyudaOrden: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  reiniciarTrabajoDeclarado();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* 1 · La sonda que reprodujo el defecto: React mantiene value === defaultValue */
/* -------------------------------------------------------------------------- */

function CampoControlado() {
  const [valor, setValor] = React.useState("");
  return React.createElement("input", {
    "aria-label": "monto",
    value: valor,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValor(e.target.value),
  });
}

describe("pwa · la regla de la gestion a medias — la sonda de React", () => {
  it("un input CONTROLADO con texto tecleado cuenta como trabajo", () => {
    // ESTE es el caso que la version anterior daba por `false`. Se deja como sonda permanente:
    // si alguien vuelve a comparar `value` con `defaultValue`, este caso se pone rojo.
    render(React.createElement(CampoControlado));
    const input = screen.getByLabelText("monto") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "45000" } });

    expect(input.value).toBe("45000");
    // La medida que explica por que la heuristica vieja fallaba, afirmada aqui para que no se
    // lea como folclore: React 19 deja el `defaultValue` IGUAL que el `value`.
    expect(input.defaultValue).toBe(input.value);
    expect(hayTrabajoEnCurso(document)).toBe(true);
  });

  it("una pantalla en reposo no cuenta como trabajo", () => {
    document.body.innerHTML = `
      <main><h1>Órdenes</h1><table><tr><td>ORD-1</td></tr></table>
      <input type="search" value="" /><input type="checkbox" /></main>`;
    expect(hayTrabajoEnCurso(document)).toBe(false);
  });

  it("un buscador con texto NO cuenta: filtrar un listado no es trabajo que se pierda", () => {
    // Y es deliberado: los campos de busqueda son los que mas a menudo tienen contenido en
    // reposo, y dejarlos dentro haria que el aviso no apareciera JAMAS en los listados.
    document.body.innerHTML = '<input type="search" />';
    (document.querySelector("input") as HTMLInputElement).value = "ORD-1";
    expect(hayTrabajoEnCurso(document)).toBe(false);
  });

  it.each([
    ["un dialogo abierto", '<div role="dialog">Confirmar entrega</div>'],
    ["una mutacion en vuelo", '<form aria-busy="true"><button>Guardar</button></form>'],
    ["el escaner con la camara abierta", "<video></video>"],
  ])("%s si cuenta", (_caso, html) => {
    document.body.innerHTML = html;
    expect(hayTrabajoEnCurso(document)).toBe(true);
  });

  it("el registro explicito manda por si solo, sin nada en el DOM", () => {
    expect(hayTrabajoEnCurso(document)).toBe(false);
    declararTrabajo("gestion:g1", true);
    expect(trabajoDeclarado()).toEqual(["gestion:g1"]);
    expect(hayTrabajoEnCurso(document)).toBe(true);
    declararTrabajo("gestion:g1", false);
    expect(hayTrabajoDeclarado()).toBe(false);
    expect(hayTrabajoEnCurso(document)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 2 · EL CASO REAL: el panel de gestion del mensajero                          */
/* -------------------------------------------------------------------------- */

function ordenDePrueba(over: Partial<MiAsignacionDTO> = {}): MiAsignacionDTO {
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
    montoCobrar: 45000,
    latitud: 9.9281244,
    longitud: -84.0907246,
    notas: "Dejar en portería",
    tiendaNombre: "Tienda X",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    secuenciaRuta: 1,
    ...over,
  } as MiAsignacionDTO;
}

function montarPanel() {
  return render(
    React.createElement(GestionarOrdenPanel, {
      orden: ordenDePrueba(),
      yaActiva: true,
      onGestionarPedido: vi.fn().mockResolvedValue(true),
      onCancelarGestion: vi.fn(),
      onSuccess: vi.fn(),
      onAbrirChat: vi.fn(),
      count: 1,
    }),
  );
}

describe("pwa · el caso real: el panel de gestion con el recaudo tecleado", () => {
  it("con la rama de entrega abierta y el monto tecleado, hay trabajo en curso", async () => {
    const user = userEvent.setup();
    montarPanel();

    await user.click(await screen.findByRole("button", { name: "Entregar" }));
    const monto = screen.getByRole("textbox", { name: "Monto línea 1" }) as HTMLInputElement;
    fireEvent.change(monto, { target: { value: "45000" } });

    await waitFor(() => expect(monto.value).toBe("45000"));
    // La prueba de que la heuristica VIEJA no habria visto nada: el input es controlado.
    expect(monto.defaultValue).toBe(monto.value);
    expect(hayTrabajoEnCurso(document)).toBe(true);
    expect(trabajoDeclarado()).toEqual(["gestion:g1"]);
  });

  it("y con eso, el aviso de version nueva NO se pinta sobre el panel", async () => {
    // El daño concreto que la revision midio: el aviso caia encima de "Guardar gestion" y un
    // toque se llevaba el desglose y las evidencias.
    montarServiceWorkerFalso();
    const user = userEvent.setup();
    montarPanel();
    render(React.createElement(AvisoVersionNueva));

    await user.click(await screen.findByRole("button", { name: "Entregar" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Monto línea 1" }), {
      target: { value: "45000" },
    });

    // Se le da tiempo de sobra al aviso para aparecer: no debe aparecer.
    await new Promise((r) => setTimeout(r, 60));
    expect(screen.queryByRole("button", { name: "Actualizar ahora" })).toBeNull();
    expect(screen.getByRole("button", { name: "Guardar gestión" })).toBeInTheDocument();
  });

  it("al desmontar el panel, la declaracion se retira sola", async () => {
    const user = userEvent.setup();
    const { unmount } = montarPanel();
    await user.click(await screen.findByRole("button", { name: "Entregar" }));
    expect(hayTrabajoDeclarado()).toBe(true);

    unmount();
    expect(hayTrabajoDeclarado()).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 3 · El aviso no recarga a nadie por su cuenta                               */
/* -------------------------------------------------------------------------- */

class Emisor {
  private oyentes: Record<string, ((evento: unknown) => void)[]> = {};
  addEventListener(tipo: string, fn: (evento: unknown) => void) {
    (this.oyentes[tipo] ??= []).push(fn);
  }
  removeEventListener(tipo: string, fn: (evento: unknown) => void) {
    this.oyentes[tipo] = (this.oyentes[tipo] ?? []).filter((f) => f !== fn);
  }
  emitir(tipo: string) {
    for (const fn of [...(this.oyentes[tipo] ?? [])]) fn({ type: tipo });
  }
}

function montarServiceWorkerFalso() {
  const esperando = { postMessage: vi.fn(), state: "installed" };
  const registro = Object.assign(new Emisor(), { waiting: esperando, installing: null });
  const contenedor = Object.assign(new Emisor(), {
    controller: { postMessage: vi.fn() },
    getRegistration: async () => registro,
  });
  Object.defineProperty(navigator, "serviceWorker", {
    value: contenedor,
    configurable: true,
    writable: true,
  });
  return { esperando, registro, contenedor };
}

describe("pwa · el aviso de version nueva", () => {
  it("se ofrece cuando hay version esperando y la pantalla esta en reposo", async () => {
    montarServiceWorkerFalso();
    const recargar = vi.fn();
    const { result } = renderHook(() => useActualizacionPwa({ recargar, intervaloMs: 10 }));

    await waitFor(() => expect(result.current.hayVersionNueva).toBe(true));
    expect(result.current.seAvisa).toBe(true);
    expect(recargar).not.toHaveBeenCalled();
  });

  it("con trabajo declarado el aviso espera, y aparece cuando el usuario termina", async () => {
    declararTrabajo("gestion:g1", true);
    montarServiceWorkerFalso();
    const { result } = renderHook(() =>
      useActualizacionPwa({ recargar: vi.fn(), intervaloMs: 10 }),
    );

    await waitFor(() => expect(result.current.hayVersionNueva).toBe(true));
    expect(result.current.seAvisa).toBe(false);

    declararTrabajo("gestion:g1", false);
    await waitFor(() => expect(result.current.seAvisa).toBe(true));
  });

  it("G1: si el relevo lo pidio OTRA pestaña, esta no se recarga", async () => {
    // El caso que justifica todo el mecanismo. `controllerchange` llega a todas las pestañas;
    // recargar aqui seria llevarse por delante lo que el usuario tenga a medias en esta.
    const { contenedor } = montarServiceWorkerFalso();
    const recargar = vi.fn();
    const { result } = renderHook(() => useActualizacionPwa({ recargar, intervaloMs: 10 }));
    await waitFor(() => expect(result.current.hayVersionNueva).toBe(true));

    contenedor.emitir("controllerchange");

    expect(recargar).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.hayVersionNueva).toBe(true));
  });

  it("al pulsar, pide el relevo y recarga UNA vez cuando el SW nuevo toma el control", async () => {
    const { contenedor, esperando } = montarServiceWorkerFalso();
    const recargar = vi.fn();
    const { result } = renderHook(() => useActualizacionPwa({ recargar, intervaloMs: 10 }));
    await waitFor(() => expect(result.current.seAvisa).toBe(true));

    result.current.actualizar();
    expect(esperando.postMessage).toHaveBeenCalledWith({ tipo: MENSAJE_RELEVO_AHORA });
    // Pedirlo NO recarga: la recarga la hace el navegador cuando el SW nuevo manda.
    expect(recargar).not.toHaveBeenCalled();

    contenedor.emitir("controllerchange");
    contenedor.emitir("controllerchange");
    expect(recargar).toHaveBeenCalledTimes(1);
  });

  it("G2: si el usuario empieza algo entre el aviso y el clic, no se pide el relevo", async () => {
    const { esperando } = montarServiceWorkerFalso();
    const recargar = vi.fn();
    const { result } = renderHook(() => useActualizacionPwa({ recargar, intervaloMs: 10 }));
    await waitFor(() => expect(result.current.seAvisa).toBe(true));

    declararTrabajo("gestion:g1", true);
    result.current.actualizar();

    expect(esperando.postMessage).not.toHaveBeenCalled();
    expect(recargar).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.seAvisa).toBe(false));
  });

  it("sin service worker en el navegador no hay aviso ni error", async () => {
    Object.defineProperty(navigator, "serviceWorker", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const { result } = renderHook(() => useActualizacionPwa({ recargar: vi.fn() }));
    await waitFor(() => expect(result.current.hayVersionNueva).toBe(false));
  });

  it("G3: el banner va ARRIBA y se puede quitar, y su texto no promete nada", async () => {
    // Va arriba porque en esta app la accion principal vive ABAJO: `fixed bottom-0` ponia
    // "Actualizar ahora" justo encima de "Guardar gestion".
    montarServiceWorkerFalso();
    const user = userEvent.setup();
    render(React.createElement(AvisoVersionNueva));

    const aviso = await screen.findByRole("status");
    expect(aviso).toHaveTextContent("Hay una versión nueva");
    expect(aviso.getAttribute("aria-live")).toBe("polite");
    expect(aviso.textContent ?? "").not.toMatch(/no se pierde|no pierdes/i);

    const contenedor = aviso.parentElement as HTMLElement;
    expect(contenedor.className).toContain("top-0");
    expect(contenedor.className).not.toContain("bottom-0");

    await user.click(screen.getByRole("button", { name: "Ahora no" }));
    expect(screen.queryByRole("button", { name: "Actualizar ahora" })).toBeNull();
  });

  it("el aviso esta montado en el portal", () => {
    // La leccion del composition root: que el componente exista no sirve de nada si nadie lo
    // pinta. Aqui se comprueba que ALGUIEN lo monta.
    expect(LAYOUT_PORTAL).toContain("<AvisoVersionNueva />");
    expect(LAYOUT_PORTAL).toContain(
      'import { AvisoVersionNueva } from "@/components/shared/AvisoVersionNueva"',
    );
  });

  it("el panel de gestion declara su trabajo (y no por accidente)", () => {
    const panel = fs.readFileSync(
      path.join(RAIZ, "app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx"),
      "utf8",
    );
    expect(panel).toContain("useDeclararTrabajo(");
    expect(panel).toContain('import { useDeclararTrabajo } from "@/hooks/useDeclararTrabajo"');
  });
});

/* -------------------------------------------------------------------------- */
/* 4 · El camino de rescate del documento                                      */
/* -------------------------------------------------------------------------- */

function ejecutarRescate(busqueda: string) {
  const registro = { unregister: vi.fn(async () => true) };
  const nombres = ["next-static-v2", "pages-cache-v2"];
  const borradas: string[] = [];
  const ventana = {
    location: {
      search: busqueda,
      pathname: "/mis-asignaciones/reparto",
      replace: vi.fn(),
    },
    caches: undefined as unknown,
  };
  const cachesFalsas = {
    keys: async () => nombres,
    delete: async (nombre: string) => {
      borradas.push(nombre);
      return true;
    },
  };
  ventana.caches = cachesFalsas;
  const navegador = {
    serviceWorker: { getRegistrations: async () => [registro] },
  };

  new Function("window", "navigator", "caches", RESCATE_INLINE)(
    ventana,
    navegador,
    cachesFalsas,
  );

  return { registro, borradas, ventana };
}

describe("pwa · el camino de rescate", () => {
  it("sin el parametro no hace absolutamente nada", async () => {
    const { registro, borradas, ventana } = ejecutarRescate("?pagina=2");
    await Promise.resolve();
    await Promise.resolve();
    expect(registro.unregister).not.toHaveBeenCalled();
    expect(borradas).toEqual([]);
    expect(ventana.location.replace).not.toHaveBeenCalled();
  });

  it("con ?rescate=sw desaloja el service worker, borra las caches y vuelve limpio", async () => {
    // Es la mitad que sobrevive aunque los chunks de JavaScript esten rotos: viaja dentro del
    // HTML. Si un dia un SW deja la app inservible, esta URL es la salida SIN que el usuario
    // tenga que borrar los datos del sitio a mano.
    const { registro, borradas, ventana } = ejecutarRescate("?rescate=sw");
    await vi.waitFor(() => expect(ventana.location.replace).toHaveBeenCalled());
    expect(registro.unregister).toHaveBeenCalledTimes(1);
    expect(borradas).toEqual(["next-static-v2", "pages-cache-v2"]);
    expect(ventana.location.replace).toHaveBeenCalledWith("/mis-asignaciones/reparto");
  });

  it("va INLINE en el head y no dentro de un chunk", () => {
    // Si esto acabara dentro de un `<Script strategy="afterInteractive">`, dependeria del
    // runtime de Next -o sea, de los chunks-, que es exactamente lo que puede estar roto.
    expect(LAYOUT).toContain('import { RESCATE_INLINE } from "@/lib/pwa/rescate-inline"');
    expect(LAYOUT).toContain("<script dangerouslySetInnerHTML={{ __html: RESCATE_INLINE }} />");
    const cabeza = LAYOUT.slice(LAYOUT.indexOf("<head>"), LAYOUT.indexOf("</head>"));
    expect(cabeza).toContain("RESCATE_INLINE");
  });
});
