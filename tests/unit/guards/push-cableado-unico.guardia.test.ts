import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";

import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";
import { eventoPuedeEmpujar } from "@/lib/notificaciones/push-elegibles";

// FICHA 410 (T3.5 / T3.5b, R51) — GUARDIA DEL PUNTO UNICO DE CABLEADO DEL CANAL DE PUSH.
//
// ---------------------------------------------------------------------------------------------
// POR QUE EXISTE, Y NO ES TEORICO
// ---------------------------------------------------------------------------------------------
// El 2026-08-23 se midio en este mismo arbol que de SIETE notificadores reales, DOS no los pasaba
// nadie —incluido el aviso nocturno del corte, el que mas se emite— y la suite entera estaba verde.
// Un productor que se olvida de cablear su canal NO ROMPE NADA: simplemente no avisa.
//
// El canal de push evita eso cableandose UNA vez, decorando el repositorio en `repoReal()`. Esta
// guardia defiende esa unica linea en TRES direcciones:
//
//   1. que `repoReal()` DEVUELVE un repositorio DECORADO (no solo que importe el decorador);
//   2. que NINGUN binding de produccion de `notificadores.ts` construye su repositorio por su
//      cuenta, saltandose `repoReal()`;
//   3. que NINGUN ARCHIVO de `lib/` ni de `app/` construye uno fuera de las tres entradas
//      declaradas —el CENSO de mas abajo—.
//
// ⚠️ EL PUNTO 3 NO ES DECORACION, Y SE MIDIO. La revision de esta misma ficha (2026-09-11,
// `progress/review_410.md` B2) escribio el productor decimotercero en OTRO archivo
// —`lib/notificaciones/notificador-satelite.ts`, emitiendo `cierre_dia_por_aprobar`, que SI es
// elegible— y `pnpm run test:guardias` dio **213 archivos y 3.124 tests EN VERDE** con el canal
// saltado. Los puntos 1 y 2 leian UN SOLO ARCHIVO (`RUTA_NOTIFICADORES`), asi que el intruso vivia
// fuera de su alcance. Es, linea por linea, el fallo que esta ficha existe para cerrar.
//
// ⚠️ VIVE EN `tests/unit/guards/` A PROPOSITO: lo que vigila es la FORMA de un archivo, no un
// comportamiento que un grafo de imports seleccione. Las guardias corren SIEMPRE, tambien en el
// modo rapido.

const RAIZ = path.resolve(__dirname, "..", "..", "..");
const RUTA_NOTIFICADORES = path.join(RAIZ, "lib", "notificaciones", "notificadores.ts");
const FUENTE = fs.readFileSync(RUTA_NOTIFICADORES, "utf8");
/** El fuente SIN comentarios: un cableado escrito en la prosa no es un cableado. */
const CODIGO = quitarComentarios(FUENTE);

describe("410 · autocomprobacion de la guardia", () => {
  it("lee un fuente con contenido y encuentra `repoReal`", () => {
    // Sin esto, un archivo que no se leyera dejaria TODA la guardia verde y muda. Ya paso en este
    // repo: una guardia salio verde con su detector roto porque no encontraba nada.
    expect(FUENTE.length).toBeGreaterThan(2000);
    expect(CODIGO).toContain("function repoReal()");
  });
});

describe("410/R51 · `repoReal()` devuelve el repositorio DECORADO", () => {
  /** El cuerpo de `repoReal()`, sin comentarios. */
  function cuerpoDeRepoReal(): string {
    const i = CODIGO.indexOf("function repoReal()");
    expect(i, "no se encontro `repoReal` en el fuente").toBeGreaterThan(-1);
    const abre = CODIGO.indexOf("{", i);
    let nivel = 0;
    for (let j = abre; j < CODIGO.length; j++) {
      if (CODIGO[j] === "{") nivel += 1;
      if (CODIGO[j] === "}") {
        nivel -= 1;
        if (nivel === 0) return CODIGO.slice(abre, j + 1);
      }
    }
    throw new Error("no se cerro el cuerpo de `repoReal`");
  }

  it("⭑ el `return` PASA el repositorio por `conPushWeb(...)`, no solo lo importa", () => {
    // «PASARLO» NO ES «IMPORTARLO», y esa distincion es todo el test: el fallo de 2026-08-23 se
    // reprodujo con una mutacion que dejaba el import intacto y quitaba solo el argumento.
    const cuerpo = cuerpoDeRepoReal();
    expect(cuerpo).toContain("conPushWeb(");
    expect(cuerpo).toMatch(/return\s+conPushWeb\(/);
    // Y el repositorio de verdad va DENTRO de la llamada, no al lado.
    expect(cuerpo).toMatch(/conPushWeb\(\s*new NotificacionRepository\(/);
  });

  it("⭑ MUTACION: devolver `new NotificacionRepository(prisma)` a secas pondria esto ROJO", () => {
    // La mutacion 6 del design §15, reproducida sobre el detector —no sobre el archivo— para que
    // este caso demuestre que el detector DISTINGUE en vez de afirmar sobre el mundo.
    const mutado = "{\n  const prisma = getPrismaClient();\n  return new NotificacionRepository(prisma);\n}";
    expect(/return\s+conPushWeb\(/.test(mutado)).toBe(false);
  });

  it("las cuatro piezas del canal se PASAN al decorador", () => {
    const cuerpo = cuerpoDeRepoReal();
    // Sin cualquiera de las cuatro, el decorador no compila — pero escribirlas aqui deja dicho
    // QUE se cablea, que es lo que alguien tiene que replicar si un dia esto se mueve de sitio.
    for (const pieza of [
      "new PushNotificacionReader(",
      "new PushSuscripcionRepository(",
      "new JobRepository(",
      "pushConfigurado",
    ]) {
      expect(cuerpo, `falta ${pieza} en el cableado`).toContain(pieza);
    }
  });
});

describe("410/R51 · NINGUN productor se salta `repoReal()`", () => {
  /** Los `notificar<X>Real` exportados, leidos DEL ARBOL y no de una lista escrita a mano. */
  const reales = [...FUENTE.matchAll(/^export const (notificar\w+Real)\b/gm)].map((m) => m[1]);

  it("⭑ hay doce bindings de produccion, y el recorrido los encuentra", () => {
    // AUTOCOMPROBACION: si la extraccion se rompiera, el barrido de abajo pasaria sobre una lista
    // vacia. El canario es el notificador que ESTUVO muerto en 2026-08-23.
    expect(reales.length).toBeGreaterThanOrEqual(12);
    expect(reales).toContain("notificarCierreDiaVencidoReal");
    expect(reales).toContain("notificarNovedadesSinGestionarReal");
  });

  it("⭑ los doce resuelven su repositorio por `repoReal()`", () => {
    const sinRepoReal: string[] = [];
    for (const nombre of reales) {
      // El cuerpo del binding: desde su `export const` hasta el `export` siguiente (o el final).
      const i = CODIGO.indexOf(`export const ${nombre}`);
      expect(i, `no se encontro el cuerpo de ${nombre}`).toBeGreaterThan(-1);
      const siguiente = CODIGO.indexOf("\nexport const ", i + 1);
      const cuerpo = CODIGO.slice(i, siguiente === -1 ? CODIGO.length : siguiente);
      if (!cuerpo.includes("repoReal()")) sinRepoReal.push(nombre);
    }
    expect(sinRepoReal).toEqual([]);
  });

  it("⭑ y NINGUNO construye `new NotificacionRepository(` por su cuenta", () => {
    // ESTE es el caso del productor FUTURO (R51). Un decimotercer `notificarXReal` que escriba
    // `new NotificacionRepository(getPrismaClient())` funcionaria perfectamente para la campana y
    // se quedaria SIN PUSH para siempre, sin que nada fallara. Aqui se pone rojo.
    const porSuCuenta: string[] = [];
    for (const nombre of reales) {
      const i = CODIGO.indexOf(`export const ${nombre}`);
      const siguiente = CODIGO.indexOf("\nexport const ", i + 1);
      const cuerpo = CODIGO.slice(i, siguiente === -1 ? CODIGO.length : siguiente);
      if (cuerpo.includes("new NotificacionRepository(")) porSuCuenta.push(nombre);
    }
    expect(porSuCuenta).toEqual([]);
  });

  it("⭑ `new NotificacionRepository(` aparece UNA sola vez en el archivo: dentro de `repoReal()`", () => {
    const apariciones = [...CODIGO.matchAll(/new NotificacionRepository\(/g)].length;
    expect(apariciones).toBe(1);
    const i = CODIGO.indexOf("function repoReal()");
    const j = CODIGO.indexOf("new NotificacionRepository(");
    expect(j).toBeGreaterThan(i);
  });

  it("⭑ MUTACION T3.5b: un productor nuevo que se salte `repoReal()` se detecta", () => {
    // Se inyecta el productor decimotercero EN EL FUENTE LEIDO (no en el archivo) y se comprueba
    // que el MISMO detector lo caza. Sin esto, las tres aserciones de arriba podrian estar
    // afirmando sobre un recorrido que no mira nada.
    const mutado =
      CODIGO +
      "\nexport const notificarAlgoNuevoReal: CierreNotificador = async (ctx) =>\n" +
      "  notificarCierreDiaPorAprobarCon(new NotificacionRepository(getPrismaClient()))(ctx);\n";
    const nuevos = [...mutado.matchAll(/^export const (notificar\w+Real)\b/gm)].map((m) => m[1]);
    expect(nuevos).toContain("notificarAlgoNuevoReal");

    const porSuCuenta = nuevos.filter((nombre) => {
      const i = mutado.indexOf(`export const ${nombre}`);
      const siguiente = mutado.indexOf("\nexport const ", i + 1);
      const cuerpo = mutado.slice(i, siguiente === -1 ? mutado.length : siguiente);
      return cuerpo.includes("new NotificacionRepository(");
    });
    expect(porSuCuenta).toEqual(["notificarAlgoNuevoReal"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// EL CENSO — R51 sobre TODO `lib/` y `app/`, con lista blanca
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Los tres `describe` de arriba leen UN archivo. Este recorre el arbol.
//
// ⚠️ CUENTA APARICIONES, NO SIMBOLOS NI ARCHIVOS, y eso es deliberado: en este repo ya se midio DOS
// VECES que una guardia que decide «este archivo, si o no» se queda VERDE cuando borras UNA de
// varias apariciones del mismo sitio. Por eso cada entrada de la lista blanca declara CUANTAS, y
// una aparicion de mas —o de menos— es una infraccion.

/** Las carpetas que se barren: donde vive el codigo de servidor que podria emitir un aviso. */
const RAICES_DEL_CENSO = ["lib", "app"];

/** Una construccion AUTORIZADA del repositorio, con su cuenta exacta y su porque. */
interface EntradaAutorizada {
  readonly ruta: string;
  readonly apariciones: number;
  readonly motivo: string;
}

/**
 * LA LISTA BLANCA. Tres entradas, cada una con el motivo escrito: si manana alguien anade una
 * cuarta, tiene que escribir el suyo, y escribirlo obliga a pensar si ese repositorio necesita el
 * canal. Ese es todo el mecanismo.
 */
const LISTA_BLANCA: readonly EntradaAutorizada[] = [
  {
    ruta: "lib/notificaciones/notificadores.ts",
    apariciones: 1,
    motivo:
      "EL PUNTO UNICO (R51). Va dentro de `repoReal()` y ENVUELTA en `conPushWeb(...)`, que es lo " +
      "que afirman los tres describe de arriba. Los doce `notificar*Real` pasan por aqui.",
  },
  {
    ruta: "lib/notificaciones/emitir.ts",
    apariciones: 1,
    motivo:
      "`emisorNotificacionReal` construye el suyo con `tx` para emitir DENTRO de la transaccion " +
      "del cambio de estado. HOY ES INOFENSIVO POR DOS RAZONES INDEPENDIENTES, y ninguna es " +
      "'nadie se acuerda': (a) el unico evento que emite es `orden_rechazada`, que NO es elegible " +
      "para push; y (b) el decorador se retira solo cuando hay `tx` (R27), asi que aunque pasara " +
      "por `repoReal()` tampoco empujaria. ⚠️ LO QUE ESTO SIGNIFICA PARA MANANA: el dia que un " +
      "evento ELEGIBLE se emita dentro de una transaccion por esta via, no habra push y no fallara " +
      "nada. La mitad (a) queda afirmada abajo y se pone roja sola; la (b) es la decision R27 y " +
      "vive en `notificacion-repo-con-push`.",
  },
  {
    ruta: "lib/actions/notificaciones.ts",
    apariciones: 1,
    motivo:
      "Composition root del PANEL (ficha 409). Casi todo lo que hace es leer —listar, marcar " +
      "leidas, descartar—, pero NO es solo lectura y conviene no repetirlo mal: por " +
      "`notificarCargaTerminada` llega a CREAR un aviso, y ese aviso es `carga_masiva_terminada`, " +
      "que NO es elegible para push ('quien lanzo la carga esta mirando la pantalla'). Afirmado " +
      "abajo.",
  },
];

function archivosDe(dir: string, acc: string[] = []): string[] {
  const abs = path.join(RAIZ, dir);
  for (const entrada of fs.readdirSync(abs)) {
    const rel = path.join(dir, entrada).replace(/\\/g, "/");
    if (fs.statSync(path.join(RAIZ, rel)).isDirectory()) archivosDe(rel, acc);
    else if (/\.(ts|tsx)$/.test(rel)) acc.push(rel);
  }
  return acc;
}

const ARCHIVOS_DEL_CENSO = RAICES_DEL_CENSO.flatMap((r) => archivosDe(r));

/**
 * El texto de un archivo tal y como lo lee el censo: SIN COMENTARIOS, porque este arbol nombra a
 * proposito en la prosa lo que el codigo tiene prohibido, y un censo sobre el texto crudo
 * denunciaria la explicacion.
 *
 * El atajo del `includes` sobre el crudo NO cambia ningun veredicto —si el nombre no esta en el
 * texto entero, tampoco puede estar despues de quitar comentarios— y ahorra la pasada a los ~1.380
 * archivos que no lo mencionan.
 */
function textoCensable(rel: string): string {
  const crudo = fs.readFileSync(path.join(RAIZ, rel), "utf8");
  return crudo.includes("NotificacionRepository") ? quitarComentarios(crudo) : "";
}

const FUENTES: ReadonlyMap<string, string> = new Map(
  ARCHIVOS_DEL_CENSO.map((rel) => [rel, textoCensable(rel)] as const),
);

/** CUANTAS veces se construye el repositorio en este codigo. El numero, no un booleano. */
export function aparicionesDeConstruccion(codigo: string): number {
  return [...codigo.matchAll(/new\s+NotificacionRepository\s*\(/g)].length;
}

interface Infraccion {
  readonly ruta: string;
  readonly apariciones: number;
  readonly autorizadas: number;
}

/**
 * El censo, sobre un mapa de fuentes que se le PASA — no sobre el disco. Es lo que permite
 * inyectarle un archivo intruso y comprobar que lo caza (autocomprobacion), en vez de escribir
 * basura en el arbol.
 */
function censar(fuentes: ReadonlyMap<string, string>): Infraccion[] {
  const autorizadas = new Map(LISTA_BLANCA.map((e) => [e.ruta, e.apariciones] as const));
  const infracciones: Infraccion[] = [];
  for (const [ruta, codigo] of fuentes) {
    const apariciones = aparicionesDeConstruccion(codigo);
    const permitidas = autorizadas.get(ruta) ?? 0;
    // Distinto, no «mayor»: una entrada de la lista blanca que deja de ser cierta tambien tiene que
    // volver a leerse. Una lista blanca que se desvia de la realidad es una lista que ya no vigila.
    if (apariciones !== permitidas) {
      infracciones.push({ ruta, apariciones, autorizadas: permitidas });
    }
  }
  return infracciones;
}

/**
 * Lo que el censo denuncia DE MAS al inyectarle algo, respecto de lo que ya denunciaba sobre el
 * arbol de verdad.
 *
 * Las autocomprobaciones usan esto y no `censar` a pelo A PROPOSITO: el dia que el censo se ponga
 * rojo por un intruso REAL, las autocomprobaciones tienen que seguir midiendo LO SUYO en vez de
 * enrojecer en cadena. Un rojo que arrastra a otros tres esconde cual de los cuatro es la noticia.
 */
function nuevasInfracciones(fuentes: ReadonlyMap<string, string>): Infraccion[] {
  const clave = (i: Infraccion) => `${i.ruta}:${i.apariciones}`;
  const yaHabia = new Set(censar(FUENTES).map(clave));
  return censar(fuentes).filter((i) => !yaHabia.has(clave(i)));
}

describe("410/R51 · autocomprobacion DEL CENSO", () => {
  it("el detector CUENTA, y no se conforma con decir si/no", () => {
    expect(aparicionesDeConstruccion("const r = new NotificacionRepository(prisma);")).toBe(1);
    expect(aparicionesDeConstruccion("new  NotificacionRepository (tx); new NotificacionRepository(p);")).toBe(2);
  });

  it("el detector NO se dispara con un import ni con una anotacion de tipo", () => {
    expect(
      aparicionesDeConstruccion('import { NotificacionRepository } from "@/lib/repositories/x";'),
    ).toBe(0);
    expect(aparicionesDeConstruccion("let repo: NotificacionRepository;")).toBe(0);
  });

  it("el barrido lee un arbol GRANDE y de verdad", () => {
    // Sin esto, un recorrido roto dejaria el censo verde y mudo, que es como ya salio verde una
    // guardia de este repo con su detector apagado.
    expect(ARCHIVOS_DEL_CENSO.length).toBeGreaterThan(800);
    for (const entrada of LISTA_BLANCA) {
      expect(ARCHIVOS_DEL_CENSO, `el censo no llega a ${entrada.ruta}`).toContain(entrada.ruta);
    }
  });

  it("control positivo: las tres entradas de la lista blanca SI construyen, y la cuenta declarada es la real", () => {
    for (const entrada of LISTA_BLANCA) {
      const codigo = FUENTES.get(entrada.ruta) ?? "";
      expect(
        aparicionesDeConstruccion(codigo),
        `${entrada.ruta} no construye las ${entrada.apariciones} veces declaradas`,
      ).toBe(entrada.apariciones);
    }
  });

  it("cada entrada de la lista blanca lleva su MOTIVO escrito", () => {
    // Una lista blanca sin porques se convierte en una lista de excepciones que nadie relee.
    for (const entrada of LISTA_BLANCA) {
      expect(entrada.motivo.length, `${entrada.ruta} sin motivo`).toBeGreaterThan(80);
    }
  });
});

describe("410/R51 · EL CENSO: nadie construye `NotificacionRepository` fuera de las tres entradas", () => {
  it("⭑ ningun archivo de `lib/` ni de `app/` se sale de la lista blanca", () => {
    const infracciones = censar(FUENTES);
    expect(
      infracciones,
      "un productor que construya su propio `NotificacionRepository` NO pasa por `repoReal()` y " +
        "por tanto NO lleva el decorador del canal: avisaria en la campana y no empujaria NUNCA, " +
        "sin que nada fallara. Si la construccion es legitima, declarala en `LISTA_BLANCA` CON SU " +
        "MOTIVO; si no, resuelvela por `repoReal()`.",
    ).toEqual([]);
  });

  it("⭑ AUTOCOMPROBACION: el productor en OTRO ARCHIVO —el que hoy se colaba— se caza", () => {
    // Es EXACTAMENTE el caso que la revision escribio y que dejo 213 archivos de guardias en verde.
    // Se inyecta en el RECORRIDO, no en el arbol: el archivo no llega a existir.
    const intruso = "lib/notificaciones/notificador-satelite.ts";
    expect(FUENTES.has(intruso), "el intruso no puede existir de verdad en el arbol").toBe(false);

    const conIntruso = new Map(FUENTES);
    conIntruso.set(
      intruso,
      "export const notificarCierreDiaPorAprobarSateliteReal: CierreNotificador = async (ctx) =>\n" +
        "  notificarCierreDiaPorAprobarCon(new NotificacionRepository(getPrismaClient()))(ctx);\n",
    );

    expect(nuevasInfracciones(conIntruso)).toEqual([
      { ruta: intruso, apariciones: 1, autorizadas: 0 },
    ]);
  });

  it("⭑ AUTOCOMPROBACION: una SEGUNDA aparicion dentro de un archivo YA autorizado tambien se caza", () => {
    // La leccion medida dos veces en este repo: una guardia que mide POR ARCHIVO se queda verde
    // cuando el intruso se esconde al lado de una construccion legitima.
    const ruta = "lib/notificaciones/notificadores.ts";
    const conDos = new Map(FUENTES);
    conDos.set(
      ruta,
      (FUENTES.get(ruta) ?? "") +
        "\nexport const notificarAlgoNuevoReal: CierreNotificador = async (ctx) =>\n" +
        "  notificarCierreDiaPorAprobarCon(new NotificacionRepository(getPrismaClient()))(ctx);\n",
    );

    expect(nuevasInfracciones(conDos)).toEqual([{ ruta, apariciones: 2, autorizadas: 1 }]);
  });

  it("⭑ AUTOCOMPROBACION: el censo NO se dispara con una MENCION en un comentario", () => {
    // Si se disparara, la unica salida seria borrar la explicacion para pasar la guardia, y este
    // arbol explica en la prosa justo lo que el codigo tiene prohibido.
    const conProsa = new Map(FUENTES);
    conProsa.set(
      "lib/inventado/solo-prosa.ts",
      quitarComentarios("// ojo: aqui NO se escribe `new NotificacionRepository(prisma)`\nexport const x = 1;\n"),
    );
    expect(nuevasInfracciones(conProsa)).toEqual([]);
  });
});

describe("410/R51 · los motivos de la lista blanca, AFIRMADOS y no solo escritos", () => {
  it("⭑ `emitir.ts` es inofensivo porque `orden_rechazada` NO es elegible para push", () => {
    // El dia que alguien haga elegible este evento, esta guardia se pone roja y manda releer el
    // motivo de la entrada — que es donde esta escrito que ese repositorio NO lleva el canal.
    expect(eventoPuedeEmpujar("orden_rechazada")).toBe(false);
  });

  it("⭑ `lib/actions/notificaciones.ts` es inofensivo porque `carga_masiva_terminada` tampoco lo es", () => {
    expect(eventoPuedeEmpujar("carga_masiva_terminada")).toBe(false);
  });

  it("control positivo: el predicado distingue de verdad", () => {
    // Sin esto, los dos casos de arriba pasarian igual con un `eventoPuedeEmpujar` que devolviera
    // `false` siempre.
    expect(eventoPuedeEmpujar("cierre_dia_por_aprobar")).toBe(true);
    expect(eventoPuedeEmpujar("cierre_dia_vencido")).toBe(true);
  });
});

describe("410/R51 · y el camino REAL: `repoReal()` ejecutado de verdad devuelve el decorado", () => {
  it("⭑ el repositorio que sale de `notificadores.ts` es un `NotificacionRepositoryConPush`", async () => {
    // Leer el fuente demuestra la FORMA; esto demuestra el HECHO. `getPrismaClient()` es un
    // singleton PEREZOSO, asi que construir el repositorio no abre conexion: esto corre sin base.
    vi.resetModules();
    const modulo = await import("@/lib/notificaciones/notificadores");
    const { NotificacionRepositoryConPush } = await import(
      "@/lib/notificaciones/notificacion-repo-con-push"
    );

    // `repoReal` no se exporta a proposito (es detalle interno), asi que se ejercita por el camino
    // que la produccion usa: un binding real con un contexto que NO llega a escribir nada. Lo que
    // interesa es el TIPO del repositorio que el binding construye, y para verlo se espia la clase
    // decoradora.
    //
    // Los DOS metodos se doblan porque el emisor consulta la dedupe ANTES de crear: sin doblar
    // `existeNoLeidaPara`, la llamada moriria contra una base que aqui no existe y `emitirBestEffort`
    // se la tragaria, dejando este caso rojo por una razon ajena.
    const espiaGuardia = vi
      .spyOn(NotificacionRepositoryConPush.prototype, "existeNoLeidaPara")
      .mockResolvedValue(false);
    const espiaCrear = vi
      .spyOn(NotificacionRepositoryConPush.prototype, "crear")
      .mockResolvedValue(null);

    await modulo.notificarGeocodificacionCaidaReal({ afectados: 1, diaCR: "2026-09-12" });

    // Si `repoReal()` devolviera el repositorio SIN decorar, estos espias no se habrian llamado
    // NUNCA: el emisor habria ido directo a `NotificacionRepository`.
    expect(espiaGuardia).toHaveBeenCalled();
    expect(espiaCrear).toHaveBeenCalled();
    espiaGuardia.mockRestore();
    espiaCrear.mockRestore();
  });
});
