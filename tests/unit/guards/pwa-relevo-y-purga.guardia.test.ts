import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  MENSAJE_PAGINA_LISTA,
  MENSAJE_RELEVO_AHORA,
} from "@/lib/pwa/actualizacion";
import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";

// Feature 284 — GUARDIA DEL SERVICE WORKER: relevo, purga, tope y rescate.
//
// `public/sw.js` no lo importa nadie y no se puede `import`: usa `self`, `addEventListener`,
// `caches` y `clients`. Asi que esta guardia lo EJECUTA de verdad: lee el fuente, lo envuelve
// en un `new Function` cuyos PARAMETROS TAPAN los globales (el SW no puede tocar nada real) y
// dispara los eventos contra dobles en memoria, esperando siempre las promesas de
// `waitUntil`/`respondWith`. Nada de `setTimeout`: es determinista.
//
// POR QUE VIVE EN `tests/unit/guards/`: un cambio en `public/**` no lo selecciona ningun grafo
// de imports, asi que fuera de aqui el gate rapido saldria verde sin ejecutar ni un caso (R24).

const RAIZ = path.resolve(__dirname, "..", "..", "..");
const RUTA_SW = path.join(RAIZ, "public/sw.js");
const FUENTE = fs.readFileSync(RUTA_SW, "utf8");

/* -------------------------------------------------------------------------- */
/* El arnes                                                                    */
/* -------------------------------------------------------------------------- */

interface PeticionFalsa {
  url: string;
  mode?: string;
}

interface RespuestaFalsa {
  ok: boolean;
  status: number;
  cuerpo: string;
  clone: () => RespuestaFalsa;
}

function respuesta(cuerpo: string, status = 200): RespuestaFalsa {
  const r: RespuestaFalsa = {
    ok: status >= 200 && status < 300,
    status,
    cuerpo,
    clone: () => respuesta(cuerpo, status),
  };
  return r;
}

function urlDe(peticion: PeticionFalsa | string): string {
  return typeof peticion === "string" ? peticion : peticion.url;
}

/** Cache en memoria que CONSERVA EL ORDEN DE INSERCION, que es lo que explota el FIFO. */
class CacheFalsa {
  readonly entradas = new Map<string, { peticion: PeticionFalsa; respuesta: RespuestaFalsa }>();

  async put(peticion: PeticionFalsa | string, res: RespuestaFalsa) {
    const clave = urlDe(peticion);
    this.entradas.delete(clave);
    this.entradas.set(clave, {
      peticion: typeof peticion === "string" ? { url: peticion } : peticion,
      respuesta: res,
    });
  }

  async match(peticion: PeticionFalsa | string) {
    return this.entradas.get(urlDe(peticion))?.respuesta;
  }

  async keys() {
    return [...this.entradas.values()].map((e) => e.peticion);
  }

  async delete(peticion: PeticionFalsa | string) {
    return this.entradas.delete(urlDe(peticion));
  }

  async addAll(urls: string[]) {
    for (const url of urls) await this.put({ url }, respuesta(`precache:${url}`));
  }
}

class CachesFalsas {
  readonly mapa = new Map<string, CacheFalsa>();

  async open(nombre: string) {
    let cache = this.mapa.get(nombre);
    if (!cache) {
      cache = new CacheFalsa();
      this.mapa.set(nombre, cache);
    }
    return cache;
  }

  async keys() {
    return [...this.mapa.keys()];
  }

  async delete(nombre: string) {
    return this.mapa.delete(nombre);
  }

  /** Como el CacheStorage real: busca en TODAS las caches del origen. */
  async match(peticion: PeticionFalsa | string) {
    for (const cache of this.mapa.values()) {
      const encontrada = await cache.match(peticion);
      if (encontrada) return encontrada;
    }
    return undefined;
  }
}

interface Ventana {
  id: string;
  url: string;
  navigate: ReturnType<typeof vi.fn>;
}

function ventana(id: string): Ventana {
  return { id, url: `https://ordenex.app/${id}`, navigate: vi.fn() };
}

interface OpcionesArnes {
  hostname?: string;
  fuente?: string;
  cachesIniciales?: Record<string, string[]>;
  ventanas?: Ventana[];
  red?: (peticion: PeticionFalsa) => RespuestaFalsa | Promise<RespuestaFalsa>;
}

function cargarSw(opciones: OpcionesArnes = {}) {
  const {
    hostname = "ordenex.app",
    fuente = FUENTE,
    cachesIniciales = {},
    ventanas = [],
    red = () => respuesta("de la red"),
  } = opciones;

  const manejadores: Record<string, ((evento: unknown) => void)[]> = {};
  const cachesFalsas = new CachesFalsas();
  const ventanasVivas = [...ventanas];

  const yo = {
    location: { hostname },
    addEventListener: (tipo: string, fn: (evento: unknown) => void) => {
      (manejadores[tipo] ??= []).push(fn);
    },
    skipWaiting: vi.fn(),
    registration: { unregister: vi.fn(async () => true) },
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => [...ventanasVivas]),
    },
  };

  const red_ = vi.fn(async (peticion: PeticionFalsa) => red(peticion));

  // Los parametros TAPAN los globales: el SW no ve el `caches`, el `fetch` ni el `self` reales.
  const ejecutar = new Function("self", "caches", "fetch", "URL", "Response", fuente);
  ejecutar(yo, cachesFalsas, red_, URL, class {});

  /** Espera las promesas de un evento hasta que no aparezcan mas (sin temporizadores). */
  async function agotar(promesas: Promise<unknown>[]) {
    let vistas = 0;
    while (vistas < promesas.length) {
      const pendientes = promesas.slice(vistas);
      vistas = promesas.length;
      await Promise.all(pendientes);
    }
  }

  async function disparar(tipo: string, extra: Record<string, unknown> = {}) {
    const promesas: Promise<unknown>[] = [];
    const respuestas: Promise<unknown>[] = [];
    const evento = {
      ...extra,
      waitUntil: (p: Promise<unknown>) => promesas.push(Promise.resolve(p)),
      respondWith: (p: Promise<unknown>) => respuestas.push(Promise.resolve(p)),
    };
    for (const fn of manejadores[tipo] ?? []) fn(evento);
    const resueltas = await Promise.all(respuestas);
    await agotar(promesas);
    return { respondio: respuestas.length > 0, resultado: resueltas[0] };
  }

  async function sembrar() {
    for (const [nombre, urls] of Object.entries(cachesIniciales)) {
      const cache = await cachesFalsas.open(nombre);
      for (const url of urls) await cache.put({ url }, respuesta(`vieja:${url}`));
    }
  }

  return {
    yo,
    manejadores,
    caches: cachesFalsas,
    red: red_,
    ventanasVivas,
    disparar,
    sembrar,
    async instalar() {
      return disparar("install");
    },
    async activar() {
      return disparar("activate");
    },
    async pedir(peticion: PeticionFalsa) {
      return disparar("fetch", { request: peticion });
    },
    async mensaje(tipo: string) {
      return disparar("message", { data: { tipo } });
    },
    async nombresDeCache() {
      return (await cachesFalsas.keys()).sort();
    },
  };
}

const CHUNK = (n: number) => ({ url: `https://ordenex.app/_next/static/chunks/${n}.js` });

/* -------------------------------------------------------------------------- */
/* 0 · Autocomprobacion del arnes                                              */
/* -------------------------------------------------------------------------- */

describe("pwa · el arnes ejecuta el service worker de verdad", () => {
  it("lee un fuente con contenido y registra los tres manejadores", () => {
    // Sin esto, un `sw.js` que no cargue dejaria TODA la guardia verde y muda. Ya paso en este
    // repo: una guardia salio verde con su detector roto porque no encontraba nada.
    expect(FUENTE.length).toBeGreaterThan(1000);
    const sw = cargarSw();
    expect(Object.keys(sw.manejadores).sort()).toEqual([
      "activate",
      "fetch",
      "install",
      "message",
    ]);
  });

  it("el doble de cache conserva el orden de insercion", async () => {
    const sw = cargarSw();
    const cache = await sw.caches.open("prueba");
    await cache.put({ url: "a" }, respuesta("a"));
    await cache.put({ url: "b" }, respuesta("b"));
    await cache.put({ url: "c" }, respuesta("c"));
    expect((await cache.keys()).map((p) => p.url)).toEqual(["a", "b", "c"]);
  });
});

/* -------------------------------------------------------------------------- */
/* 1 · El relevo (R3, R4, R5, R12)                                             */
/* -------------------------------------------------------------------------- */

describe("pwa · el relevo espera al usuario", () => {
  it("install no llama skipWaiting", async () => {
    const sw = cargarSw();
    await sw.instalar();
    expect(sw.yo.skipWaiting).not.toHaveBeenCalled();
  });

  it("install precachea exactamente dos urls", async () => {
    const sw = cargarSw();
    await sw.instalar();
    const cache = await sw.caches.open("pages-cache-v2");
    expect((await cache.keys()).map((p) => p.url)).toEqual(["/", "/offline.html"]);
  });

  it("instalar no toca las caches existentes", async () => {
    const sw = cargarSw({
      cachesIniciales: { "next-static-v1": ["chunk-viejo.js"], "pages-cache-v1": ["/"] },
    });
    await sw.sembrar();
    await sw.instalar();
    expect(await sw.nombresDeCache()).toEqual(
      ["next-static-v1", "pages-cache-v1", "pages-cache-v2"].sort(),
    );
    const vieja = await sw.caches.open("next-static-v1");
    expect((await vieja.keys()).length).toBe(1);
  });

  it("solo el mensaje del usuario pide el relevo", async () => {
    const sw = cargarSw();
    await sw.mensaje("ordenex:cualquier-otra-cosa");
    expect(sw.yo.skipWaiting).not.toHaveBeenCalled();
    await sw.mensaje(MENSAJE_RELEVO_AHORA);
    expect(sw.yo.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it("los mensajes que acepta el SW son los mismos que declara el bundle", () => {
    // El literal esta duplicado porque el SW no puede importar del bundle. Aqui se comprueba
    // que no divergen: la fuente de verdad es `lib/pwa/actualizacion.ts` y el fuente del SW se
    // lee, no se copia.
    expect(FUENTE).toContain(`"${MENSAJE_RELEVO_AHORA}"`);
    expect(FUENTE).toContain(`"${MENSAJE_PAGINA_LISTA}"`);
  });

  it("la rama de produccion no renavega a nadie", async () => {
    const ventanas = [ventana("uno"), ventana("dos")];
    const sw = cargarSw({ ventanas });
    await sw.instalar();
    await sw.activar();
    await sw.pedir({ url: "https://ordenex.app/ordenes", mode: "navigate" });
    for (const v of ventanas) expect(v.navigate).not.toHaveBeenCalled();

    // R5 es una PROHIBICION universal ("en ninguna circunstancia") y una prohibicion no se
    // demuestra ejecutando un puñado de caminos: se lee el fuente. El unico `navigate` del
    // archivo esta dentro del bloque `if (ES_DEV)` del kill-switch.
    const navegaciones = [...FUENTE.matchAll(/client\.navigate|location\.reload/g)];
    expect(navegaciones.length).toBe(1);
    const bloqueDev = FUENTE.slice(
      FUENTE.indexOf("if (ES_DEV || RESCATE_FORZOSO)"),
      FUENTE.indexOf("} else {"),
    );
    expect(bloqueDev).toContain("client.navigate(client.url)");
    expect(bloqueDev).toContain("if (ES_DEV)");
  });
});

/* -------------------------------------------------------------------------- */
/* 2 · La purga (R7, R8) y su condicion: nadie vivo usando la cache            */
/* -------------------------------------------------------------------------- */

describe("pwa · la purga solo corre con la casa vacia", () => {
  it("activate purga las caches fuera de lista", async () => {
    const sw = cargarSw({
      cachesIniciales: { "next-static-v1": ["a.js"], "una-cache-ajena": ["b.js"] },
    });
    await sw.sembrar();
    await sw.instalar();
    await sw.activar();
    expect(await sw.nombresDeCache()).toEqual(["pages-cache-v2"]);
  });

  it("las caches v1 desaparecen y las v2 quedan", async () => {
    const sw = cargarSw({
      cachesIniciales: {
        "next-static-v1": ["a.js", "b.js"],
        "pages-cache-v1": ["/"],
        "next-static-v2": ["c.js"],
      },
    });
    await sw.sembrar();
    await sw.activar();
    expect(await sw.nombresDeCache()).toEqual(["next-static-v2"]);
    expect(sw.yo.clients.claim).toHaveBeenCalled();
  });

  it("con una pagina de la build anterior viva NO se borra nada", async () => {
    // Es la mitad que el relevo consentido obliga a pagar: si el usuario pulsa "actualizar"
    // con otra pestaña a medio trabajo, `activate` corre CON esa pagina viva. Barrer entonces
    // `next-static-v1` seria romperla.
    const sw = cargarSw({
      ventanas: [ventana("pestaña-vieja")],
      cachesIniciales: { "next-static-v1": ["a.js"], "una-cache-ajena": ["b.js"] },
    });
    await sw.sembrar();
    await sw.activar();
    expect(await sw.nombresDeCache()).toEqual(["next-static-v1", "una-cache-ajena"]);
  });

  it("la purga aplazada corre en cuanto esa pagina desaparece", async () => {
    const sw = cargarSw({
      ventanas: [ventana("pestaña-vieja")],
      cachesIniciales: { "next-static-v1": ["a.js"] },
    });
    await sw.sembrar();
    await sw.activar();
    expect(await sw.nombresDeCache()).toContain("next-static-v1");

    // La pestaña vieja se recarga: su cliente muere y nace otro con id distinto.
    sw.ventanasVivas.splice(0, sw.ventanasVivas.length, ventana("pestaña-nueva"));
    await sw.mensaje(MENSAJE_PAGINA_LISTA);
    expect(await sw.nombresDeCache()).not.toContain("next-static-v1");
  });

  it("mientras la cache vieja siga ahi, la pagina vieja encuentra sus chunks", async () => {
    // El otro lado de la misma decision: no basta con NO borrarla, hay que seguir leyendola.
    // `caches.match` mira todas las caches del origen, no solo la vigente.
    const sw = cargarSw({
      ventanas: [ventana("pestaña-vieja")],
      cachesIniciales: { "next-static-v1": [CHUNK(1).url] },
      red: () => respuesta("404 del despliegue", 404),
    });
    await sw.sembrar();
    await sw.activar();
    const { resultado } = await sw.pedir(CHUNK(1));
    expect((resultado as RespuestaFalsa).cuerpo).toBe(`vieja:${CHUNK(1).url}`);
    expect(sw.red).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* 3 · El tope de la cache de estaticos (R9, R10, R11, R13)                    */
/* -------------------------------------------------------------------------- */

const TOPE_DECLARADO = Number(/const TOPE_ESTATICOS = (\d+);/.exec(FUENTE)?.[1]);

describe("pwa · el tope de la cache de estaticos", () => {
  it("el tope vive en una sola constante, declarada y entera", () => {
    const declaraciones = [...FUENTE.matchAll(/const TOPE_ESTATICOS = /g)];
    expect(declaraciones.length).toBe(1);
    expect(Number.isInteger(TOPE_DECLARADO)).toBe(true);
    expect(TOPE_DECLARADO).toBeGreaterThan(0);
    expect(TOPE_DECLARADO).toBeLessThan(100000);
    // R13: o esta medido, o dice con todas las letras que no lo esta.
    expect(FUENTE).toMatch(/SIN CALIBRAR/);
    // Y el numero no se repite suelto en el `fetch`: un segundo literal cumpliendo su papel
    // seria una bifurcacion silenciosa. Se cuenta sobre el CODIGO, con el quitador de
    // comentarios del repo: la prosa que explica el tope tambien lo nombra.
    const codigo = quitarComentarios(FUENTE);
    expect([...codigo.matchAll(/TOPE_ESTATICOS/g)].length).toBe(2);
    expect(codigo.split(String(TOPE_DECLARADO)).length - 1).toBe(1);
  });

  it("el tope recorta las entradas mas antiguas", async () => {
    const previas = Object.fromEntries([
      ["next-static-v2", Array.from({ length: TOPE_DECLARADO }, (_, i) => CHUNK(i).url)],
    ]);
    const sw = cargarSw({ cachesIniciales: previas });
    await sw.sembrar();
    const nuevo = CHUNK(9999);
    await sw.pedir(nuevo);

    const cache = await sw.caches.open("next-static-v2");
    const claves = (await cache.keys()).map((p) => p.url);
    expect(claves.length).toBe(TOPE_DECLARADO);
    expect(claves).not.toContain(CHUNK(0).url); // se fue la MAS ANTIGUA
    expect(claves).toContain(CHUNK(1).url); // la siguiente sigue
  });

  it("la entrada recien guardada sobrevive al recorte", async () => {
    const sw = cargarSw({
      cachesIniciales: {
        "next-static-v2": Array.from({ length: TOPE_DECLARADO + 5 }, (_, i) => CHUNK(i).url),
      },
    });
    await sw.sembrar();
    const nuevo = CHUNK(9999);
    await sw.pedir(nuevo);

    const cache = await sw.caches.open("next-static-v2");
    const claves = (await cache.keys()).map((p) => p.url);
    expect(claves.length).toBe(TOPE_DECLARADO);
    expect(claves.at(-1)).toBe(nuevo.url);
    expect(claves).toContain(nuevo.url);
  });

  it("un 404 no entra en la cache", async () => {
    const sw = cargarSw({ red: () => respuesta("no existe", 404) });
    const { resultado } = await sw.pedir(CHUNK(7));
    // La respuesta se devuelve igual: quien la pidio se entera del 404.
    expect((resultado as RespuestaFalsa).status).toBe(404);
    const cache = await sw.caches.open("next-static-v2");
    expect((await cache.keys()).length).toBe(0);
  });

  it("una respuesta buena si entra, y se sirve desde la cache la segunda vez", async () => {
    const sw = cargarSw({ red: () => respuesta("el chunk") });
    await sw.pedir(CHUNK(3));
    await sw.pedir(CHUNK(3));
    expect(sw.red).toHaveBeenCalledTimes(1);
    const cache = await sw.caches.open("next-static-v2");
    expect((await cache.keys()).map((p) => p.url)).toEqual([CHUNK(3).url]);
  });

  it("las paginas que no son 2xx tampoco se graban", async () => {
    const sw = cargarSw({ red: () => respuesta("500", 500) });
    await sw.pedir({ url: "https://ordenex.app/ordenes", mode: "navigate" });
    const cache = await sw.caches.open("pages-cache-v2");
    expect((await cache.keys()).length).toBe(0);
  });

  it("ni /api/ ni supabase pasan por el service worker", async () => {
    const sw = cargarSw();
    const api = await sw.pedir({ url: "https://ordenex.app/api/ordenes" });
    const supabase = await sw.pedir({ url: "https://abc.supabase.co/rest/v1/orden" });
    expect(api.respondio).toBe(false);
    expect(supabase.respondio).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 4 · El kill-switch de desarrollo (R6) y el de rescate                       */
/* -------------------------------------------------------------------------- */

describe("pwa · los dos kill-switch", () => {
  it("en localhost limpia, se desregistra y renavega", async () => {
    const ventanas = [ventana("dev")];
    const sw = cargarSw({
      hostname: "localhost",
      ventanas,
      cachesIniciales: { "next-static-v2": ["a.js"], "pages-cache-v2": ["/"] },
    });
    await sw.sembrar();
    await sw.instalar();
    expect(sw.yo.skipWaiting).toHaveBeenCalled();
    await sw.activar();
    expect(await sw.nombresDeCache()).toEqual([]);
    expect(sw.yo.registration.unregister).toHaveBeenCalled();
    expect(ventanas[0].navigate).toHaveBeenCalledWith(ventanas[0].url);
  });

  it("127.0.0.1 tambien es desarrollo", async () => {
    const sw = cargarSw({ hostname: "127.0.0.1" });
    await sw.instalar();
    expect(sw.yo.skipWaiting).toHaveBeenCalled();
  });

  it("la bandera de rescate va en false en el arbol", () => {
    // Si esto se queda en `true`, el despliegue siguiente deja a TODOS los usuarios sin
    // service worker y sin cache. Es una palanca de emergencia, no un estado.
    expect(FUENTE).toContain("const RESCATE_FORZOSO = false;");
  });

  it("con la bandera en false, el SW de produccion no se desregistra ni renavega", async () => {
    // El par anti-vacuidad del caso de abajo: sin esto, "el rescate funciona" podria estar
    // verde porque el SW siempre se desaloja, que es justo lo contrario de lo que se quiere.
    const ventanas = [ventana("uno")];
    const sw = cargarSw({ ventanas, cachesIniciales: { "next-static-v2": ["a.js"] } });
    await sw.sembrar();
    await sw.instalar();
    await sw.activar();
    expect(sw.yo.registration.unregister).not.toHaveBeenCalled();
    expect(ventanas[0].navigate).not.toHaveBeenCalled();
    expect(await sw.nombresDeCache()).toContain("next-static-v2");
  });

  it("con la bandera en true desaloja al service worker anterior, aunque su relevo este roto", async () => {
    // EL CAMINO DE RESCATE, EJECUTADO. Se enciende la bandera sobre el fuente real (misma
    // mecanica que una mutacion) y se comprueba lo unico que importa el dia que haga falta:
    //   (1) pide el relevo sin esperar a nadie -- si esperara, un SW roto no se iria nunca;
    //   (2) borra TODAS las caches, tambien las vigentes;
    //   (3) se des-registra: el origen se queda sin service worker.
    const fuente = FUENTE.replace(
      "const RESCATE_FORZOSO = false;",
      "const RESCATE_FORZOSO = true;",
    );
    expect(fuente).not.toBe(FUENTE);

    const ventanas = [ventana("telefono-atascado")];
    const sw = cargarSw({
      fuente,
      hostname: "ordenex.app",
      ventanas,
      cachesIniciales: {
        "next-static-v1": ["viejo.js"],
        "next-static-v2": ["nuevo.js"],
        "pages-cache-v2": ["/"],
      },
    });
    await sw.sembrar();
    await sw.instalar();
    expect(sw.yo.skipWaiting).toHaveBeenCalledTimes(1);

    await sw.activar();
    expect(await sw.nombresDeCache()).toEqual([]);
    expect(sw.yo.registration.unregister).toHaveBeenCalledTimes(1);
    // Y ni siquiera en el rescate se le recarga la pagina a nadie en produccion (R5).
    expect(ventanas[0].navigate).not.toHaveBeenCalled();
  });
});
