import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { handleAsistente } from "@/app/api/asistente/route";
import { leerCatalogoAyuda } from "@/lib/ayuda/catalogo";
import { AsistenteService } from "@/lib/services/AsistenteService";
import { partirNdjson } from "@/lib/asistente/protocolo";
import type { EventoAsistente } from "@/lib/asistente/protocolo";
import type { IAsistenteUsoRepository } from "@/lib/interfaces/repositories/IAsistenteUsoRepository";
import type { IAsistenteService } from "@/lib/interfaces/services/IAsistenteService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { DobleProveedor, compuerta } from "../unit/asistente/_doble-proveedor";

/**
 * ⭑ FICHA 436 · R7, R8, R12, R13, R18, R19 — EL BORDE HTTP, CON EL SERVICIO REAL.
 *
 * ⚠️ POR QUÉ EL SERVICIO ES EL DE VERDAD Y NO UN DOBLE. Lo que hay que demostrar es que **el rol
 * sale de la sesión y de ningún otro sitio**, y eso sólo se ve mirando qué documentos acaban en la
 * petición. Con un servicio doblado, el caso afirmaría que la ruta llama a una función — que es
 * exactamente lo que seguiría siendo cierto si el rol viniera del cuerpo.
 *
 * Lo único doblado es el PROVEEDOR (nada de red) y el CONTADOR (nada de base).
 */

const MENSAJERO: Actor = { usuarioId: "u-mensajero", rol: "mensajero", zonaId: null };
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro", zonaId: null };
const MAQUINA: Actor = { usuarioId: "u-api", rol: "apiKey", zonaId: null };

const usoQueDevuelve = (consultas: number): IAsistenteUsoRepository => ({
  consumirUnaConsulta: async () => consultas,
  contarNoLoSe: async () => undefined,
});

function servicioReal(proveedor: DobleProveedor, consultasHoy = 1, maxConsultasDia = 30) {
  return new AsistenteService({
    proveedor,
    usoRepo: usoQueDevuelve(consultasHoy),
    leerCatalogo: leerCatalogoAyuda,
    maxConsultasDia,
  });
}

function peticion(cuerpo: unknown): Request {
  return new Request("https://app.test/api/asistente", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
}

const CUERPO_VALIDO = { mensajes: [{ autor: "usuario", texto: "¿cómo funciona la caja?" }] };

/** Lee el cuerpo NDJSON entero y devuelve sus eventos. */
async function eventosDe(res: Response): Promise<EventoAsistente[]> {
  const { eventos } = partirNdjson(await res.text());
  return eventos;
}

async function llamar(
  actor: Actor | null,
  cuerpo: unknown,
  opciones: { proveedor?: DobleProveedor; service?: IAsistenteService; consultasHoy?: number } = {},
) {
  const proveedor = opciones.proveedor ?? new DobleProveedor();
  const res = await handleAsistente(peticion(cuerpo), {
    getActor: async () => actor,
    service: opciones.service ?? servicioReal(proveedor, opciones.consultasHoy ?? 1),
  });
  return { res, proveedor };
}

describe("R12 — sin sesión: 401 con JSON y sin `Location`", () => {
  it("⭑ el handler rechaza por su cuenta, no sólo el middleware", async () => {
    const { res } = await llamar(null, CUERPO_VALIDO);

    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect((await res.json()).code).toBe("UNAUTHORIZED");
  });
});

describe("R7 — el rol sale de la SESIÓN", () => {
  it("⭑⭑ un mensajero recibe SUS ocho documentos, y ni uno de la oficina", async () => {
    const { res, proveedor } = await llamar(MENSAJERO, CUERPO_VALIDO);

    expect(res.status).toBe(200);
    expect(proveedor.llamadas[0].documentos).toHaveLength(8);
    expect(proveedor.textoEnviado).not.toContain("oficina/wallet-caja");
    expect(proveedor.textoEnviado).not.toContain("Wallet · Caja");
  });

  it("⭑ y un maestro, con EL MISMO cuerpo, recibe los 33", async () => {
    // Las dos mitades del mismo hecho: lo único que cambia entre esta llamada y la de arriba es
    // quién devuelve `getActor`. Si el rol saliera del cuerpo, las dos darían lo mismo.
    const { proveedor } = await llamar(MAESTRO, CUERPO_VALIDO);
    expect(proveedor.llamadas[0].documentos).toHaveLength(33);
    expect(proveedor.textoEnviado).toContain("oficina/wallet-caja");
  });

  it("el `inicio` del stream anuncia ese mismo conjunto, con su href", async () => {
    const { res } = await llamar(MENSAJERO, CUERPO_VALIDO);
    const [primero] = await eventosDe(res);

    expect(primero.tipo).toBe("inicio");
    if (primero.tipo !== "inicio") return;
    expect(primero.documentos).toHaveLength(8);
    expect(primero.documentos.map((d) => d.slug)).toContain("mensajero/reparto");
    expect(primero.documentos.find((d) => d.slug === "mensajero/reparto")?.href).toBe(
      "/ayuda/mensajero/reparto",
    );
    expect(primero.documentos.map((d) => d.slug)).not.toContain("oficina/wallet-caja");
  });

  it("R27 — con `rutaActual`, el `inicio` señala el documento de partida", async () => {
    const { res } = await llamar(MENSAJERO, {
      ...CUERPO_VALIDO,
      rutaActual: "/mis-asignaciones/reparto",
    });
    const [primero] = await eventosDe(res);
    expect(primero.tipo === "inicio" && primero.partida).toBe("mensajero/reparto");
  });
});

describe("R32 — el modelo sabe CON QUIÉN habla, y lo dice la misma sesión que acotó los documentos", () => {
  it("⭑⭑ el mismo cuerpo, dos sesiones: las instrucciones que se envían nombran a cada uno", async () => {
    // ⚠️ POR QUÉ AQUÍ Y NO SÓLO EN `instrucciones.test.ts`. Ese archivo mide la FUNCIÓN; esto mide
    // lo que de verdad sale hacia el proveedor, que es lo que el modelo lee. Con la función bien y
    // el servicio llamándola sin rol —que es exactamente como estaba antes de la revisión— aquel
    // archivo seguiría verde y éste no.
    const { proveedor: deMensajero } = await llamar(MENSAJERO, CUERPO_VALIDO);
    const { proveedor: deMaestro } = await llamar(MAESTRO, CUERPO_VALIDO);

    expect(deMensajero.llamadas[0].instrucciones).toContain(
      "Esta persona entra a Ordenex como Mensajero",
    );
    expect(deMaestro.llamadas[0].instrucciones).toContain(
      "Esta persona entra a Ordenex como Maestro",
    );
    // Y ninguno lleva la frase del otro: lo único que cambia entre las dos llamadas es `getActor`.
    expect(deMensajero.llamadas[0].instrucciones).not.toContain("como Maestro");
    expect(deMaestro.llamadas[0].instrucciones).not.toContain("como Mensajero");
  });

  it("⭑ y un `rol` en el cuerpo no puede cambiarlo (es 422 antes de llegar a nadie)", async () => {
    // La otra mitad de R7/R8 aplicada al rol que viaja en el texto: no hay forma de que el cliente
    // le diga al modelo que es otra persona.
    const { res, proveedor } = await llamar(MENSAJERO, { ...CUERPO_VALIDO, rol: "maestro" });
    expect(res.status).toBe(422);
    expect(proveedor.llamadas).toEqual([]);
  });
});

describe("R8 — lo que mande el cliente sobre el rol o los documentos NO decide nada", () => {
  it("⭑⭑ un mensajero que manda `rol: \"maestro\"` y una lista de slugs recibe 422", async () => {
    const { res, proveedor } = await llamar(MENSAJERO, {
      ...CUERPO_VALIDO,
      rol: "maestro",
      slugs: ["oficina/wallet-caja", "oficina/cierres"],
    });

    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("VALIDATION_ERROR");
    // Y no se llamó a nadie: el rechazo es antes del proveedor.
    expect(proveedor.llamadas).toEqual([]);
  });

  it("⭑ también con `documentos` metidos a mano en el cuerpo", async () => {
    const { res } = await llamar(MENSAJERO, {
      ...CUERPO_VALIDO,
      documentos: [{ slug: "oficina/wallet-caja", titulo: "x", cuerpo: "la caja funciona así" }],
    });
    expect(res.status).toBe(422);
  });

  it("⭑ y con el cuerpo LIMPIO, el contexto sigue siendo el suyo", async () => {
    // La otra mitad de R8: no basta con rechazar los cuerpos sucios; hay que demostrar que el
    // camino bueno tampoco lee nada del cliente para decidir el contexto.
    const { proveedor } = await llamar(MENSAJERO, CUERPO_VALIDO);
    expect(proveedor.llamadas[0].documentos.map((d) => d.slug)).toEqual([
      "mensajero/cierre-del-dia",
      "mensajero/por-recoger",
      "mensajero/ranking",
      "mensajero/recoleccion",
      "mensajero/reparto",
      "publico/entrar-y-recuperar-contrasena",
      "publico/postulacion",
      "publico/rastreo-de-paquete",
    ]);
  });

  it("un cuerpo sin mensajes, o con un mensaje vacío, es 422", async () => {
    expect((await llamar(MENSAJERO, { mensajes: [] })).res.status).toBe(422);
    expect(
      (await llamar(MENSAJERO, { mensajes: [{ autor: "usuario", texto: "   " }] })).res.status,
    ).toBe(422);
  });

  it("un cuerpo que no es JSON es 422 y no un 500", async () => {
    const res = await handleAsistente(
      new Request("https://app.test/api/asistente", { method: "POST", body: "{no json" }),
      { getActor: async () => MENSAJERO, service: servicioReal(new DobleProveedor()) },
    );
    expect(res.status).toBe(422);
  });

  it("⭑⭑ ESTRUCTURAL — en el borde, `rol` sólo se asigna UNA vez y desde el actor de sesión", () => {
    // ⚠️ POR QUÉ ADEMÁS DE LOS CASOS DE ARRIBA. Los de arriba matan la mutación por el camino
    // largo: leer el rol del cuerpo obliga primero a quitar el `.strict()`, y eso ya se pone rojo.
    // Pero el rojo dice «esperaba 422, recibí 200», que no nombra el problema. Este caso mira el
    // archivo y afirma la propiedad directamente: en todo el borde hay UNA sola asignación de
    // `rol`, y su valor es `actor.rol`. Un `leido.data.rol ?? actor.rol` se pone rojo AQUÍ y el
    // mensaje enseña la línea culpable.
    const codigo = readFileSync(
      path.resolve(__dirname, "../../app/api/asistente/route.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");

    const asignaciones = [...codigo.matchAll(/\brol:\s*([^,}\n]+)/g)].map((m) => m[1].trim());
    expect(asignaciones).toEqual(["actor.rol"]);
    // Y el actor viene del resolutor de sesión, no de otro sitio.
    expect(codigo).toContain("deps.getActor ?? resolveActorFromSession");
  });
});

describe("R18 — el cliente no puede decidir su propio conteo", () => {
  it("⭑ `consultasHoy: 0` estando en el tope: el rechazo se mantiene", async () => {
    const proveedor = new DobleProveedor();
    const { res } = await llamar(
      MENSAJERO,
      { ...CUERPO_VALIDO, consultasHoy: 0 },
      { proveedor, consultasHoy: 31 },
    );

    // El `.strict()` lo caza antes incluso de mirar el tope: la clave de más es un rechazo, no un
    // campo ignorado. Las dos cosas son ciertas y las dos hacen falta.
    expect(res.status).toBe(422);
    expect(proveedor.llamadas).toEqual([]);
  });

  it("⭑ y sin mandar nada raro, el tope se aplica igual: 409 con su mensaje", async () => {
    const proveedor = new DobleProveedor();
    const { res } = await llamar(MENSAJERO, CUERPO_VALIDO, { proveedor, consultasHoy: 31 });

    expect(res.status).toBe(409);
    const cuerpo = await res.json();
    expect(cuerpo.code).toBe("CONFLICT");
    expect(cuerpo.message).toBe("Llegaste a las 30 preguntas de hoy. Mañana volvés a tener.");
    expect(proveedor.llamadas).toEqual([]);
  });
});

describe("R13 — una cuenta de máquina no pregunta", () => {
  it("⭑ `apiKey`: 403 y el proveedor NO se llamó", async () => {
    const proveedor = new DobleProveedor();
    const { res } = await llamar(MAQUINA, CUERPO_VALIDO, { proveedor });

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("FORBIDDEN");
    expect(proveedor.llamadas).toEqual([]);
  });
});

describe("R19 — la respuesta llega POR TROZOS, a medida que el proveedor escribe", () => {
  it("⭑⭑ el test lee los tres trozos ANTES de que el proveedor haya terminado", async () => {
    // ⚠️ ESTO ES LO QUE DE VERDAD MIDE R19. Un test que junte el cuerpo entero con `await
    // res.text()` pasaría igual si la ruta acumulara toda la respuesta y la soltara de golpe: la
    // promesa de «la pantalla no se queda quieta» se habría roto sin un solo rojo.
    //
    // Aquí el doble EMITE los tres textos y luego se queda esperando una compuerta que sólo se
    // abre cuando el test ya ha leído los tres. Si la ruta juntara la respuesta, este caso moriría
    // por timeout —un rojo ruidoso— en vez de pasar.
    const puerta = compuerta();
    const proveedor = new DobleProveedor({
      textos: ["Para cerrar el día", " tenés que", " ir a Mi bodega."],
      esperarAntesDelFin: puerta.promesa,
      pausaMs: 5,
    });

    const { res } = await llamar(MENSAJERO, CUERPO_VALIDO, { proveedor });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    expect(res.body).not.toBeNull();

    const lector = res.body!.getReader();
    const decodificador = new TextDecoder();
    const recibidos: EventoAsistente[] = [];
    let resto = "";

    // Se lee hasta tener los TRES trozos de texto. La compuerta sigue cerrada todo este rato.
    while (recibidos.filter((e) => e.tipo === "texto").length < 3) {
      const { done, value } = await lector.read();
      expect(done, "el stream se cerró antes de los tres trozos").toBe(false);
      const partido = partirNdjson(resto + decodificador.decode(value, { stream: true }));
      resto = partido.resto;
      recibidos.push(...partido.eventos);
    }

    expect(recibidos[0].tipo).toBe("inicio");
    expect(
      recibidos.filter((e) => e.tipo === "texto").map((e) => (e as { texto: string }).texto),
    ).toEqual(["Para cerrar el día", " tenés que", " ir a Mi bodega."]);
    // Y el `fin` TODAVÍA NO ha llegado: es la prueba de que lo leído salió antes de terminar.
    expect(recibidos.some((e) => e.tipo === "fin")).toBe(false);

    puerta.abrir();
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      const partido = partirNdjson(resto + decodificador.decode(value, { stream: true }));
      resto = partido.resto;
      recibidos.push(...partido.eventos);
    }
    expect(recibidos[recibidos.length - 1]).toEqual({ tipo: "fin" });
  });

  it("el `inicio` sale ANTES de que el proveedor haya emitido una sola letra", async () => {
    // La pantalla tiene algo que pintar desde el primer instante: el conjunto de documentos con el
    // que va a validar las citas y cuál es el de partida.
    const puerta = compuerta();
    const proveedor = new DobleProveedor({ textos: [], esperarAntesDelFin: puerta.promesa });
    const { res } = await llamar(MENSAJERO, CUERPO_VALIDO, { proveedor });

    const lector = res.body!.getReader();
    const { value } = await lector.read();
    const { eventos } = partirNdjson(new TextDecoder().decode(value));
    expect(eventos[0].tipo).toBe("inicio");

    puerta.abrir();
    await lector.cancel();
  });
});

describe("R20 / R21 en el borde — el usuario no ve un 500 mudo ni nada del proveedor", () => {
  it("sin credencial: 500 con un mensaje propio que dice qué pasa y qué hacer", async () => {
    const proveedor = new DobleProveedor({ desenlace: "sin_credencial" });
    const { res } = await llamar(MENSAJERO, CUERPO_VALIDO, { proveedor });

    expect(res.status).toBe(500);
    const cuerpo = await res.json();
    expect(cuerpo.message).toContain("todavía no está configurado");
    // NO es el mensaje genérico: un 500 mudo es exactamente lo que R20 prohíbe.
    expect(cuerpo.message).not.toBe("Error interno del servidor.");
  });

  it("⭑ proveedor caído: el cuerpo NO contiene el detalle del proveedor", async () => {
    const proveedor = new DobleProveedor({ desenlace: "transitorio" });
    const { res } = await llamar(MENSAJERO, CUERPO_VALIDO, { proveedor });

    expect(res.status).toBe(500);
    const texto = await res.text();
    expect(texto).not.toContain("doble: caido");
    expect(texto).toContain("no está disponible en este momento");
  });
});
