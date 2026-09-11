import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { MENSAJE_PUSH_RECIBIDO } from "@/lib/pwa/actualizacion";

// FICHA 410 (T4.1-T4.4) — GUARDIA DEL PUSH EN EL SERVICE WORKER.
//
// `public/sw.js` no lo importa nadie y no se puede `import`: usa `self`, `addEventListener`,
// `caches` y `clients`. Asi que esta guardia lo EJECUTA de verdad —mismo arnes que
// `pwa-relevo-y-purga.guardia.test.ts`, ampliado con `showNotification`, `openWindow` y
// `postMessage`— y dispara eventos `push` y `notificationclick` contra dobles en memoria.
//
// POR QUE VIVE EN `tests/unit/guards/`: un cambio en `public/**` NO lo selecciona ningun grafo de
// imports, asi que fuera de aqui el gate rapido saldria verde sin ejecutar ni un caso.
//
// Cubre R37 (se muestra la notificacion), R38 (payload ilegible -> texto de reserva, nunca
// silencio), R39/R40 (enfocar la ventana existente o abrir una), R41 (etiqueta por evento, para que
// reemplace en vez de apilar), R42 (nada de esto vive en la rama de desarrollo) y R43 (un solo
// sonido).

const RAIZ = path.resolve(__dirname, "..", "..", "..");
const RUTA_SW = path.join(RAIZ, "public/sw.js");
const FUENTE = fs.readFileSync(RUTA_SW, "utf8");

/* -------------------------------------------------------------------------- */
/* El arnes                                                                    */
/* -------------------------------------------------------------------------- */

interface NotificacionMostrada {
  titulo: string;
  opciones: {
    body?: string;
    icon?: string;
    badge?: string;
    tag?: string;
    renotify?: boolean;
    data?: { destino?: string };
  };
}

interface VentanaFalsa {
  id: string;
  url: string;
  visibilityState: string;
  focus: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
}

function ventana(id: string, visibilityState = "hidden", url = "https://ordenex.co/ordenes"): VentanaFalsa {
  return {
    id,
    url,
    visibilityState,
    focus: vi.fn(async () => undefined),
    navigate: vi.fn(async () => undefined),
    postMessage: vi.fn(),
  };
}

class CacheFalsa {
  entradas = new Map<string, unknown>();
  async put() {}
  async match() {
    return undefined;
  }
  async keys() {
    return [];
  }
  async delete() {
    return true;
  }
  async addAll() {}
}

const cachesFalsas = {
  async open() {
    return new CacheFalsa();
  },
  async keys() {
    return [] as string[];
  },
  async delete() {
    return true;
  },
  async match() {
    return undefined;
  },
};

function cargarSw(opciones: { hostname?: string; ventanas?: VentanaFalsa[] } = {}) {
  const { hostname = "ordenex.co", ventanas = [] } = opciones;
  const manejadores: Record<string, ((evento: unknown) => void)[]> = {};
  const mostradas: NotificacionMostrada[] = [];
  const abiertas: string[] = [];
  const vivas = [...ventanas];

  const yo = {
    location: { hostname, origin: `https://${hostname}` },
    addEventListener: (tipo: string, fn: (evento: unknown) => void) => {
      (manejadores[tipo] ??= []).push(fn);
    },
    skipWaiting: vi.fn(),
    registration: {
      unregister: vi.fn(async () => true),
      showNotification: vi.fn(async (titulo: string, opts: NotificacionMostrada["opciones"]) => {
        mostradas.push({ titulo, opciones: opts });
      }),
    },
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => [...vivas]),
      openWindow: vi.fn(async (url: string) => {
        abiertas.push(url);
        return null;
      }),
    },
  };

  // Los parametros TAPAN los globales: el SW no ve el `caches`, el `fetch` ni el `self` reales.
  const ejecutar = new Function("self", "caches", "fetch", "URL", "Response", FUENTE);
  ejecutar(yo, cachesFalsas, vi.fn(), URL, class {});

  async function disparar(tipo: string, extra: Record<string, unknown> = {}) {
    const promesas: Promise<unknown>[] = [];
    const evento = { ...extra, waitUntil: (p: Promise<unknown>) => promesas.push(Promise.resolve(p)) };
    for (const fn of manejadores[tipo] ?? []) fn(evento);
    await Promise.all(promesas);
  }

  return {
    yo,
    manejadores,
    mostradas,
    abiertas,
    vivas,
    /** Dispara un `push` con un payload que `event.data.json()` devuelve tal cual. */
    async push(datos: unknown) {
      await disparar("push", { data: { json: () => datos } });
    },
    /** Dispara un `push` cuyo `json()` LANZA: es el caso del contenido ilegible (R38). */
    async pushIlegible() {
      await disparar("push", {
        data: {
          json: () => {
            throw new SyntaxError("no es JSON");
          },
        },
      });
    },
    /** Dispara un `push` SIN cuerpo, que es lo que manda un emisor mal configurado. */
    async pushVacio() {
      await disparar("push", { data: null });
    },
    async click(data: unknown) {
      const notification = { close: vi.fn(), data };
      await disparar("notificationclick", { notification });
      return notification;
    },
  };
}

const CARGA_BUENA = {
  titulo: "5 novedades esperan tu decisión",
  cuerpo: "La más antigua lleva 3 días en bodega.",
  destino: "/novedades?superficie=devolucion",
  evento: "novedades_sin_gestionar",
};

/* -------------------------------------------------------------------------- */
/* 0 · Autocomprobacion del arnes                                              */
/* -------------------------------------------------------------------------- */

describe("410 · el arnes ejecuta el service worker de verdad", () => {
  it("lee un fuente con contenido y registra los DOS manejadores nuevos", () => {
    // Sin esto, un `sw.js` que no cargara dejaria TODA la guardia verde y muda.
    expect(FUENTE.length).toBeGreaterThan(1000);
    const sw = cargarSw();
    expect(Object.keys(sw.manejadores)).toContain("push");
    expect(Object.keys(sw.manejadores)).toContain("notificationclick");
  });
});

/* -------------------------------------------------------------------------- */
/* 1 · El `push` (R37, R38, R41)                                               */
/* -------------------------------------------------------------------------- */

describe("410/R37 · un push bueno se muestra con su titulo, su cuerpo y su icono", () => {
  it("⭑ la notificacion lleva EXACTAMENTE lo que vino en el payload", async () => {
    const sw = cargarSw();
    await sw.push(CARGA_BUENA);

    expect(sw.mostradas).toHaveLength(1);
    const n = sw.mostradas[0];
    expect(n.titulo).toBe("5 novedades esperan tu decisión");
    expect(n.opciones.body).toBe("La más antigua lleva 3 días en bodega.");
    expect(n.opciones.icon).toBe("/icons/icon-192.png");
    // R37: el destino se CONSERVA para el `notificationclick`. Es lo unico que sobrevive.
    expect(n.opciones.data).toEqual({ destino: "/novedades?superficie=devolucion" });
  });

  it("⭑ R41: la etiqueta se deriva del evento y `renotify` es false (reemplaza, no apila)", async () => {
    const sw = cargarSw();
    await sw.push(CARGA_BUENA);
    expect(sw.mostradas[0].opciones.tag).toBe("ordenex:novedades_sin_gestionar");
    expect(sw.mostradas[0].opciones.renotify).toBe(false);

    // Dos push del MISMO tipo comparten etiqueta; uno de otro tipo, no.
    await sw.push({ ...CARGA_BUENA, evento: "cierre_dia_vencido" });
    expect(sw.mostradas.map((m) => m.opciones.tag)).toEqual([
      "ordenex:novedades_sin_gestionar",
      "ordenex:cierre_dia_vencido",
    ]);
  });
});

describe("410/R38 · un contenido ilegible NO deja el push en silencio", () => {
  it("⭑ `json()` que lanza -> titulo y cuerpo de reserva, destino a la portada", async () => {
    const sw = cargarSw();
    await sw.pushIlegible();

    expect(sw.mostradas).toHaveLength(1);
    // LITERALES ESCRITOS A MANO: es lo que la persona va a leer el dia que algo se rompa, y un
    // push que no muestra nada hace que el navegador pinte su propio «este sitio se actualizo en
    // segundo plano», que dice menos y asusta igual.
    expect(sw.mostradas[0].titulo).toBe("Ordenex");
    expect(sw.mostradas[0].opciones.body).toBe("Tenés un aviso nuevo. Abrí la app para verlo.");
    expect(sw.mostradas[0].opciones.data).toEqual({ destino: "/" });
  });

  it("un push SIN cuerpo tampoco se queda callado", async () => {
    const sw = cargarSw();
    await sw.pushVacio();
    expect(sw.mostradas).toHaveLength(1);
    expect(sw.mostradas[0].titulo).toBe("Ordenex");
  });

  it("un payload SIN titulo cae tambien en la reserva", async () => {
    const sw = cargarSw();
    await sw.push({ cuerpo: "solo cuerpo", destino: "/ordenes" });
    expect(sw.mostradas[0].titulo).toBe("Ordenex");
  });

  it("⭑ un destino que no es una ruta de la app se sustituye por la portada", async () => {
    // Un `destino` absoluto («https://otro-sitio») convertiria un push en un redirector a
    // cualquier parte. Solo se aceptan rutas que empiecen por `/`.
    const sw = cargarSw();
    await sw.push({ ...CARGA_BUENA, destino: "https://sitio-ajeno.example/phishing" });
    expect(sw.mostradas[0].opciones.data).toEqual({ destino: "/" });
  });
});

/* -------------------------------------------------------------------------- */
/* 2 · El `notificationclick` (R39, R40)                                       */
/* -------------------------------------------------------------------------- */

describe("410/R39 · con una ventana abierta, se ENFOCA y se lleva al destino", () => {
  it("⭑ `focus()` y `navigate(destino)`, y NO se abre una segunda pestaña", async () => {
    const abierta = ventana("v-1");
    const sw = cargarSw({ ventanas: [abierta] });

    const notificacion = await sw.click({ destino: "/cierre-dia" });

    expect(notificacion.close).toHaveBeenCalledTimes(1);
    // `focus()` PRIMERO: es lo que trae la app al frente. Sin el, `navigate` cambia la ruta de una
    // ventana que la persona no ve, y el toque parece no hacer nada.
    expect(abierta.focus).toHaveBeenCalledTimes(1);
    expect(abierta.navigate).toHaveBeenCalledWith("/cierre-dia");
    expect(sw.yo.clients.openWindow).not.toHaveBeenCalled();
  });

  it("⭑ MUTACION R39: sin `focus()` en el fuente, esto se pondria rojo", () => {
    // Mutacion 7 del design §15. Se comprueba sobre el FUENTE porque la prohibicion es universal:
    // quitar la llamada dejaria el `navigate` en pie y el caso de arriba tambien rojo, pero esto
    // nombra la causa exacta.
    expect(FUENTE).toMatch(/cliente\.focus\(\)/);
  });

  it("con VARIAS ventanas se usa la primera del mismo origen y nada mas", async () => {
    const a = ventana("v-1");
    const b = ventana("v-2");
    const sw = cargarSw({ ventanas: [a, b] });
    await sw.click({ destino: "/ordenes" });
    expect(a.focus).toHaveBeenCalledTimes(1);
    expect(b.focus).not.toHaveBeenCalled();
    expect(sw.yo.clients.openWindow).not.toHaveBeenCalled();
  });

  it("una ventana de OTRO origen no cuenta: se abre una nueva", async () => {
    const ajena = ventana("v-ajena", "hidden", "https://otro-sitio.example/loquesea");
    const sw = cargarSw({ ventanas: [ajena] });
    await sw.click({ destino: "/ordenes" });
    expect(ajena.focus).not.toHaveBeenCalled();
    expect(sw.abiertas).toEqual(["/ordenes"]);
  });
});

describe("410/R40 · sin ninguna ventana, se abre una en el destino", () => {
  it("⭑ `openWindow(destino)`", async () => {
    const sw = cargarSw({ ventanas: [] });
    await sw.click({ destino: "/mis-asignaciones" });
    expect(sw.abiertas).toEqual(["/mis-asignaciones"]);
  });

  it("sin `data` (notificacion de reserva), se abre la portada", async () => {
    const sw = cargarSw({ ventanas: [] });
    await sw.click(undefined);
    expect(sw.abiertas).toEqual(["/"]);
  });
});

/* -------------------------------------------------------------------------- */
/* 3 · Un solo sonido (R43)                                                    */
/* -------------------------------------------------------------------------- */

describe("410/R43 · con una ventana VISIBLE se avisa a la pagina para que no suene dos veces", () => {
  it("⭑ `postMessage` con el mensaje acordado, solo a la ventana visible", async () => {
    const visible = ventana("v-visible", "visible");
    const oculta = ventana("v-oculta", "hidden");
    const sw = cargarSw({ ventanas: [visible, oculta] });

    await sw.push(CARGA_BUENA);

    expect(visible.postMessage).toHaveBeenCalledWith({
      tipo: MENSAJE_PUSH_RECIBIDO,
      destino: "/novedades?superficie=devolucion",
    });
    expect(oculta.postMessage).not.toHaveBeenCalled();
    // Y la notificacion del sistema SE MUESTRA IGUAL: el navegador lo exige (`userVisibleOnly`).
    expect(sw.mostradas).toHaveLength(1);
  });

  it("sin ninguna ventana visible no se avisa a nadie", async () => {
    const oculta = ventana("v-oculta", "hidden");
    const sw = cargarSw({ ventanas: [oculta] });
    await sw.push(CARGA_BUENA);
    expect(oculta.postMessage).not.toHaveBeenCalled();
  });

  it("⭑ el literal del mensaje NO diverge entre el bundle y el service worker", () => {
    // El SW no puede importar del bundle, asi que el texto esta duplicado a mano. La fuente de
    // verdad es `lib/pwa/actualizacion.ts` y aqui se LEE el fuente del SW, no se copia. Mismo
    // precedente que `ordenex:relevo-ahora`.
    expect(FUENTE).toContain(`"${MENSAJE_PUSH_RECIBIDO}"`);
  });
});

/* -------------------------------------------------------------------------- */
/* 4 · R42 — nada de esto vive en la rama de desarrollo                        */
/* -------------------------------------------------------------------------- */

describe("410/R42 · el push NO se activa en desarrollo ni en el rescate forzoso", () => {
  it("⭑ en `localhost` el SW se autodestruye y NO registra `push`", async () => {
    const sw = cargarSw({ hostname: "localhost" });
    expect(Object.keys(sw.manejadores).sort()).toEqual(["activate", "install"]);
    expect(sw.manejadores.push).toBeUndefined();
    expect(sw.manejadores.notificationclick).toBeUndefined();
  });

  it("los dos manejadores estan DENTRO del `else` de produccion, no antes", () => {
    // Lectura del fuente, porque la propiedad es de UBICACION: un `addEventListener("push")` fuera
    // del `else` se registraria tambien en la rama que se des-registra, y un manejador en un SW
    // que se autodestruye no es codigo muerto: es codigo que confunde.
    const inicioElse = FUENTE.indexOf("} else {");
    expect(inicioElse).toBeGreaterThan(0);
    expect(FUENTE.indexOf('addEventListener("push"')).toBeGreaterThan(inicioElse);
    expect(FUENTE.indexOf('addEventListener("notificationclick"')).toBeGreaterThan(inicioElse);
  });
});

/* -------------------------------------------------------------------------- */
/* 5 · D8 — el icono pequeño existe de verdad                                  */
/* -------------------------------------------------------------------------- */

describe("410/D8 · el `badge` apunta a un archivo que existe en el arbol", () => {
  it("⭑ la ruta del badge del `push` es un PNG real y con canal alfa", async () => {
    const sw = cargarSw();
    await sw.push(CARGA_BUENA);
    const badge = sw.mostradas[0].opciones.badge;
    // Si el asset no se hubiera producido, la regla es OMITIR el campo — nunca dejarlo apuntando
    // a un 404, que en Android se ve como un hueco.
    expect(badge, "el push declara un badge: tiene que existir").toBeDefined();
    const ruta = path.join(RAIZ, "public", String(badge));
    expect(fs.existsSync(ruta), `no existe ${badge}`).toBe(true);

    const bytes = fs.readFileSync(ruta);
    // Cabecera PNG + el tipo de color 6 (RGBA) del chunk IHDR: Android SOLO usa el canal alfa, y
    // un PNG sin alfa se ve como una mancha blanca.
    expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(bytes[25]).toBe(6);
  });

  it("el icono grande tambien existe", () => {
    expect(fs.existsSync(path.join(RAIZ, "public", "icons", "icon-192.png"))).toBe(true);
  });
});
