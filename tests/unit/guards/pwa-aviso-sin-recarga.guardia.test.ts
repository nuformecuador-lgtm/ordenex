// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";

import { hayTrabajoEnCurso, MENSAJE_RELEVO_AHORA } from "@/lib/pwa/actualizacion";
import { RESCATE_INLINE } from "@/lib/pwa/rescate-inline";
import { useActualizacionPwa } from "@/hooks/useActualizacionPwa";
import { AvisoVersionNueva } from "@/components/shared/AvisoVersionNueva";

// Feature 284 — GUARDIA DEL AVISO DE VERSION NUEVA Y DEL CAMINO DE RESCATE.
//
// La decision del humano (2026-08-25) fue avisar con un boton en vez de esperar callado. Eso
// paga un precio que hay que cobrar aqui, porque no lo cobra ningun otro test: **la recarga no
// puede llevarse una gestion a medio hacer**. Dos reglas, y las dos se prueban abajo:
//
//   G1 · solo se recarga la pestaña que lo pidio. `controllerchange` se dispara en TODAS las
//        pestañas cuando el SW nuevo toma el control: si cualquiera de ellas recargara, el
//        mensajero perderia el formulario que estaba llenando en otra ventana.
//   G2 · el aviso NO se pinta mientras haya trabajo en curso, y se vuelve a comprobar AL
//        PULSAR por si algo empezo entre el pintado y el clic.
//
// Vive en `guards/` porque estas dos reglas no las selecciona el grafo de imports desde un
// cambio en `public/sw.js`, que es justo donde vive la otra mitad del mecanismo.

const RAIZ = path.resolve(__dirname, "..", "..", "..");
const LAYOUT = fs.readFileSync(path.join(RAIZ, "app/layout.tsx"), "utf8");
const LAYOUT_PORTAL = fs.readFileSync(path.join(RAIZ, "app/(app)/layout.tsx"), "utf8");

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* 1 · "Hay una gestion a medias"                                              */
/* -------------------------------------------------------------------------- */

describe("pwa · la regla de la gestion a medias", () => {
  it("una pantalla en reposo no cuenta como trabajo", () => {
    document.body.innerHTML = `
      <main><h1>Órdenes</h1><table><tr><td>ORD-1</td></tr></table>
      <input type="search" value="" /><input type="checkbox" /></main>`;
    expect(hayTrabajoEnCurso(document)).toBe(false);
  });

  it.each([
    ["un formulario empezado", '<form><input name="guia" /></form>', (d: Document) => {
      (d.querySelector("input") as HTMLInputElement).value = "ORD-77";
    }],
    ["un dialogo abierto", '<div role="dialog">Confirmar entrega</div>', () => {}],
    ["una mutacion en vuelo", '<form aria-busy="true"><button>Guardar</button></form>', () => {}],
    ["el escaner con la camara abierta", "<video></video>", () => {}],
    ["una casilla que el usuario marco", '<input type="checkbox" />', (d: Document) => {
      (d.querySelector("input") as HTMLInputElement).checked = true;
    }],
  ])("%s si cuenta", (_caso, html, preparar) => {
    document.body.innerHTML = html;
    preparar(document);
    expect(hayTrabajoEnCurso(document)).toBe(true);
  });

  it("una foto ya elegida y aun sin subir cuenta", () => {
    document.body.innerHTML = '<input type="file" />';
    const input = document.querySelector("input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [{ name: "comprobante.jpg" }] });
    expect(hayTrabajoEnCurso(document)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* 2 · El aviso no recarga a nadie por su cuenta                               */
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
  get oyentesDe() {
    return this.oyentes;
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

  it("con una gestion a medias el aviso espera, y aparece cuando el usuario termina", async () => {
    document.body.innerHTML = '<div role="dialog">Registrar entrega</div>';
    montarServiceWorkerFalso();
    const { result } = renderHook(() => useActualizacionPwa({ recargar: vi.fn(), intervaloMs: 10 }));

    await waitFor(() => expect(result.current.hayVersionNueva).toBe(true));
    expect(result.current.seAvisa).toBe(false);

    document.body.innerHTML = "";
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

    document.body.innerHTML = '<form><input name="guia" /></form>';
    (document.querySelector("input") as HTMLInputElement).value = "ORD-99";

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

  it("el banner se pinta con nombre accesible y un boton, y calla si hay trabajo", async () => {
    montarServiceWorkerFalso();
    const { unmount } = render(React.createElement(AvisoVersionNueva));
    const aviso = await screen.findByRole("status");
    expect(aviso).toHaveTextContent("Hay una versión nueva");
    // `status` y no `alert`: es una oferta que puede esperar al siguiente hueco del lector de
    // pantalla, no una urgencia que deba interrumpir a mitad de frase.
    expect(aviso.getAttribute("aria-live")).toBe("polite");
    expect(screen.getByRole("button", { name: "Actualizar ahora" })).toBeInTheDocument();
    unmount();

    document.body.innerHTML = '<div role="dialog">Registrar entrega</div>';
    render(React.createElement(AvisoVersionNueva));
    await new Promise((r) => setTimeout(r, 20));
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
});

/* -------------------------------------------------------------------------- */
/* 3 · El camino de rescate del documento                                      */
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
