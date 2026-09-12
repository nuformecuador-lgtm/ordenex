import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";
import {
  INVENTARIO_DE_RAICES,
  RAIZ_DEL_REPO,
  archivosDeCodigoCensados,
  fallosDelInventario,
  raicesCensadas,
  raicesDelArbol,
} from "@/tests/fixtures/raices-de-codigo";

// FICHA 422 (T3.3, design §9 · R10) — GUARDIA DE LA INTENCION DECLARADA EN TODA BAJA DE PUSH.
//
// ---------------------------------------------------------------------------------------------
// QUE VIGILA, Y POR QUE EL TIPO NO BASTA
// ---------------------------------------------------------------------------------------------
// `darDeBajaDeEsteDispositivo(motivo)` pide su motivo como parametro OBLIGATORIO de una union
// CERRADA. Con `strict: true` eso ya impide dos cosas por si solo, y son la primera linea de
// defensa: una superficie nueva que llame sin motivo NO COMPILA, y un motivo nuevo sin tratar en el
// `switch` TAMPOCO (el `never` del `default`).
//
// Lo que el compilador NO puede exigir es que alguien haya PENSADO cual de los dos motivos
// corresponde. Un tercer llamante compila perfectamente escribiendo `"cierre-de-sesion"` por
// copiar-pegar, y el desenlace es mudo: la preferencia sobrevive a un gesto que queria borrarla, o
// se borra en un camino que solo queria irse. Nada falla, nada se pone rojo, y la persona
// descubre meses despues que la aplicacion no la obedece.
//
// Esta guardia es la segunda linea: CENSA las llamadas del arbol contra una lista blanca donde cada
// entrada declara SU CUENTA, SU MOTIVO y SU PORQUE. Anadir una tercera superficie obliga a escribir
// aqui por que ese motivo y no el otro. Ese es todo el mecanismo.
//
// ⚠️ CUENTA APARICIONES, NO ARCHIVOS. Es la leccion medida DOS VECES en este repo: una guardia que
// decide «este archivo si/no» se queda VERDE cuando borras UNA de varias apariciones del mismo
// sitio. Molde: `push-cableado-unico.guardia.test.ts`.
//
// ⚠️ VIVE EN `tests/unit/guards/` A PROPOSITO: lo que vigila es la FORMA del arbol, no un
// comportamiento que un grafo de imports seleccione. Las guardias corren SIEMPRE.

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ REVISION 2026-09-11 (B1 y B2 de `progress/review_422.md`) — DOS AGUJEROS MEDIDOS, CERRADOS
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// La primera version decia «en todo el arbol» y hacia DOS cosas mal. Las dos se midieron con el
// typecheck verde y 145 archivos de guardia / 2.091 casos verdes:
//
//   B1 · EL CENSO LEIA 4 DE LAS 8 RAICES. `["app","components","hooks","lib"]` dejaba fuera
//        `providers/`, donde vive el `ToastProvider` que ENVUELVE al componente de reactivacion de
//        esta misma ficha. Una baja escrita ahi no la veia nadie.
//        → Arreglado en `tests/fixtures/raices-de-codigo.ts`: las raices se DERIVAN del disco y se
//          comparan contra un inventario declarado. Una raiz nueva pone esta guardia roja.
//
//   B2 · EL DETECTOR ERA CIEGO AL ALIAS. Buscaba `darDeBajaDeEsteDispositivo\s*\(`, asi que
//        `import { darDeBajaDeEsteDispositivo as bajar } from "@/lib/pwa/baja-push"` + `bajar(...)`
//        pasaba limpio: en la clausula `import` al nombre no le sigue un `(`, y la llamada se
//        escribe con otro nombre.
//        → Arreglado INVIRTIENDO LA PREGUNTA. El censo ya no persigue la LLAMADA: persigue el
//          **ESPECIFICADOR DEL MODULO**. Para llamar a esta funcion hay que traerla, y traerla deja
//          `lib/pwa/baja-push` escrito LITERAL — con alias, con re-export, con `import()` dinamico
//          y con ruta relativa. El detector de llamadas se conserva, pero solo se aplica DENTRO de
//          los dos archivos autorizados, para leer su motivo.

const RAIZ = RAIZ_DEL_REPO;

/**
 * LA AGUJA DEL CENSO: el modulo que hay que importar para poder darse de baja.
 *
 * Se acepta cualquier prefijo (`@/`, `../../`, `./`) y la extension opcional: lo que se persigue es
 * EL MODULO, no una forma concreta de nombrarlo. Cubre `import`, `export ... from`, `import()`
 * dinamico y `require()`, porque los cuatro llevan el especificador como literal de cadena.
 */
const ESPECIFICADOR_DE_LA_BAJA = /["'`][^"'`]*lib\/pwa\/baja-push(\.ts)?["'`]/g;

/** El archivo donde la funcion VIVE. Su declaracion no es una llamada, y el detector lo distingue. */
const RUTA_DEFINICION = "lib/pwa/baja-push.ts";

/** Los dos unicos motivos que existen. Copiados del tipo; si alguien anade un tercero, ver abajo. */
const MOTIVOS = ["la-persona-apago-el-interruptor", "cierre-de-sesion"] as const;
type Motivo = (typeof MOTIVOS)[number];

/** Una llamada AUTORIZADA, con su cuenta exacta, su motivo y el porque de ESE motivo. */
interface EntradaAutorizada {
  readonly ruta: string;
  readonly llamadas: number;
  readonly motivo: Motivo;
  readonly porque: string;
}

/**
 * LA LISTA BLANCA. Dos entradas. Si manana aparece una tercera superficie, tiene que escribir la
 * suya —y escribirla obliga a decidir si esa superficie esta DICIENDO QUE NO o SOLO YENDOSE—.
 */
const LISTA_BLANCA: readonly EntradaAutorizada[] = [
  {
    ruta: "hooks/usePushSuscripcion.ts",
    llamadas: 1,
    motivo: "la-persona-apago-el-interruptor",
    porque:
      "EL INTERRUPTOR EN OFF. Es un gesto explicito sobre el control de avisos: la persona esta " +
      "DICIENDO QUE NO, no yendose. Por eso este motivo borra la preferencia (R7). Con el otro, " +
      "apagar aqui y volver a entrar manana resucitaria los avisos que acaba de apagar — la " +
      "aplicacion la habria contradicho, en silencio y sin que nada fallara.",
  },
  {
    ruta: "app/_components/LogoutButton.tsx",
    llamadas: 1,
    motivo: "cierre-de-sesion",
    porque:
      "EL BOTON DE SALIR. Cerrar sesion NO es decir que no: es irse. La baja del dispositivo se " +
      "hace igual (410/R19: este telefono deja de recibir, y solo este), pero la decision de la " +
      "persona SOBREVIVE (R8) y es lo que permite reactivar los avisos sin volver a pedirle nada " +
      "cuando entre otra vez. Con el otro motivo, cada cierre de sesion borraria la preferencia y " +
      "la ficha 422 entera dejaria de tener efecto.",
  },
];

const ARCHIVOS_DEL_CENSO = archivosDeCodigoCensados();

/**
 * El texto de un archivo tal y como lo lee el censo: SIN COMENTARIOS, porque este arbol nombra a
 * proposito en la prosa lo que el codigo tiene prohibido —la cabecera de `baja-push.ts` escribe
 * `darDeBajaDeEsteDispositivo()` para explicar que asi NO compila, y cuatro archivos mas citan
 * `lib/pwa/baja-push.ts` en su documentacion— y un censo sobre el texto crudo denunciaria la
 * explicacion.
 *
 * El atajo del `includes` sobre el crudo NO cambia ningun veredicto (si ninguna de las dos agujas
 * esta en el texto entero, tampoco esta despues de quitar comentarios) y ahorra la pasada a los
 * ~1.400 archivos que no las mencionan.
 */
function textoCensable(rel: string): string {
  const crudo = fs.readFileSync(path.join(RAIZ, rel), "utf8");
  const interesa = crudo.includes("darDeBajaDeEsteDispositivo") || crudo.includes("baja-push");
  return interesa ? quitarComentarios(crudo) : "";
}

const FUENTES: ReadonlyMap<string, string> = new Map(
  ARCHIVOS_DEL_CENSO.map((rel) => [rel, textoCensable(rel)] as const),
);

/** Una llamada encontrada: su posicion y el texto literal del primer argumento, si lo hay. */
interface Llamada {
  readonly indice: number;
  readonly argumento: string | null;
}

/**
 * LAS LLAMADAS a `darDeBajaDeEsteDispositivo` en este codigo, con su argumento literal.
 *
 * ⚠️ LA DECLARACION NO ES UNA LLAMADA. `export async function darDeBajaDeEsteDispositivo(` aparece
 * en el archivo donde la funcion vive, y contarla ahi convertiria a su propio hogar en infractor.
 * Se distingue mirando el token anterior, no excluyendo el archivo: excluir el archivo dejaria
 * pasar una llamada de verdad escondida dentro de el.
 */
export function llamadasEn(codigo: string): Llamada[] {
  const llamadas: Llamada[] = [];
  const patron = /darDeBajaDeEsteDispositivo\s*\(/g;
  for (const m of codigo.matchAll(patron)) {
    const indice = m.index ?? 0;
    const previo = codigo.slice(Math.max(0, indice - 40), indice);
    if (/\bfunction\s+$/.test(previo)) continue; // es la declaracion
    const tras = codigo.slice(indice + m[0].length, indice + m[0].length + 120);
    const arg = /^\s*"([^"]*)"/.exec(tras) ?? /^\s*'([^']*)'/.exec(tras);
    llamadas.push({ indice, argumento: arg ? arg[1] : null });
  }
  return llamadas;
}

/**
 * ⭑ EL DETECTOR QUE CIERRA B2: CUANTAS VECES ESTE CODIGO TRAE EL MODULO DE LA BAJA.
 *
 * Para llamar a `darDeBajaDeEsteDispositivo` hay que traerla, y traerla deja el especificador
 * `lib/pwa/baja-push` escrito LITERAL. Da igual como se llame despues la funcion en el archivo:
 * el alias cambia el nombre de la variable, no el del modulo.
 */
export function importacionesDeLaBaja(codigo: string): number {
  return [...codigo.matchAll(new RegExp(ESPECIFICADOR_DE_LA_BAJA.source, "g"))].length;
}

/**
 * ⭑ ¿El archivo trae la funcion CON SU NOMBRE, sin renombrarla?
 *
 * Los dos archivos autorizados tienen que importarla sin alias, y no es capricho: el censo lee su
 * MOTIVO del texto de la llamada, asi que un alias ahi dejaria la lectura del motivo ciega justo en
 * los dos sitios donde importa. Exigirlo mantiene alineados los dos detectores.
 */
export function importaSinAlias(codigo: string): boolean {
  // El nombre, seguido de lo que NO sea ` as `: ni renombrado en la clausula, ni desestructurado
  // desde un `import()` dinamico con `: otroNombre`.
  const menciones = [...codigo.matchAll(/\bdarDeBajaDeEsteDispositivo\s*(as|:)?/g)];
  return menciones.some((m) => m[1] === undefined);
}

interface Infraccion {
  readonly ruta: string;
  readonly importa: number;
  readonly autorizadas: number;
  readonly motivos: (string | null)[];
}

/**
 * EL CENSO, sobre un mapa de fuentes que se le PASA — no sobre el disco. Es lo que permite
 * inyectarle un archivo intruso y comprobar que lo caza (autocomprobacion), en vez de escribir
 * basura en el arbol.
 *
 * ⚠️ LA PREGUNTA ES «¿QUIEN TRAE EL MODULO?», NO «¿QUIEN LLAMA?». Esa inversion es todo el arreglo
 * de B2: la llamada se puede renombrar, el modulo no. Para los archivos AUTORIZADOS se sigue
 * mirando ademas la cuenta de llamadas y su motivo literal, que es lo que la lista blanca aporta
 * sobre el tipo.
 */
function censar(fuentes: ReadonlyMap<string, string>): Infraccion[] {
  const autorizadas = new Map(LISTA_BLANCA.map((e) => [e.ruta, e] as const));
  const infracciones: Infraccion[] = [];
  for (const [ruta, codigo] of fuentes) {
    // El archivo donde la funcion VIVE no se importa a si mismo; y si algun dia lo hiciera, seria
    // un ciclo que ya se veria en otro sitio.
    if (ruta === RUTA_DEFINICION) continue;

    const importa = importacionesDeLaBaja(codigo);
    const permitida = autorizadas.get(ruta);
    const cuenta = permitida ? 1 : 0;
    const llamadas = llamadasEn(codigo);
    const motivos = llamadas.map((l) => l.argumento);

    // (a) TRAER EL MODULO. Distinto, no «mayor»: una entrada de la lista blanca que deja de ser
    // cierta tambien tiene que volver a leerse. Una lista blanca que se desvia de la realidad ya
    // no vigila nada.
    const importaMal = importa !== cuenta;

    // (b) Y, si esta autorizado, la CUENTA de llamadas, que se importe SIN ALIAS —si no, el motivo
    // no se puede leer— y que cada motivo sea EL DECLARADO.
    const llamadasMal = permitida ? llamadas.length !== permitida.llamadas : llamadas.length > 0;
    const aliasMal = permitida !== undefined && importa > 0 && !importaSinAlias(codigo);
    const motivoMal = permitida
      ? motivos.some((m) => m !== permitida.motivo)
      : motivos.length > 0;

    if (importaMal || llamadasMal || aliasMal || motivoMal) {
      infracciones.push({ ruta, importa, autorizadas: cuenta, motivos });
    }
  }
  return infracciones;
}

/**
 * Lo que el censo denuncia DE MAS al inyectarle algo, respecto de lo que ya denunciaba sobre el
 * arbol real. Las autocomprobaciones usan esto y no `censar` a pelo A PROPOSITO: el dia que el
 * censo se ponga rojo por un intruso REAL, tienen que seguir midiendo LO SUYO en vez de enrojecer
 * en cadena. Un rojo que arrastra a otros tres esconde cual de los cuatro es la noticia.
 */
function nuevasInfracciones(fuentes: ReadonlyMap<string, string>): Infraccion[] {
  const clave = (i: Infraccion) => `${i.ruta}:${i.importa}:${i.motivos.join(",")}`;
  const yaHabia = new Set(censar(FUENTES).map(clave));
  return censar(fuentes).filter((i) => !yaHabia.has(clave(i)));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// B1 · EL INVENTARIO DE RAICES: lo que «todo el arbol» significa, comparado con el disco
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("422/B1 · «todo el arbol» se deriva del disco, no de una lista escrita a mano", () => {
  it("⭑ toda raiz de codigo del repositorio esta clasificada, con su motivo", () => {
    // ESTE es el caso que impide que B1 se repita. La lista vieja
    // (`["app","components","hooks","lib"]`) envejecio en silencio: `providers/` aparecio y nadie
    // se entero. Ahora las raices se LEEN DEL DISCO y se comparan contra el inventario; una raiz
    // nueva —o una que desaparezca— pone esto rojo y obliga a decidir y a escribir el porque.
    expect(fallosDelInventario()).toEqual([]);
  });

  it("⭑ y `providers/` —la que faltaba— esta DENTRO del censo", () => {
    // El canario concreto de B1, escrito con nombre y apellido para que quitarlo se note.
    expect(raicesCensadas()).toContain("providers");
    expect(ARCHIVOS_DEL_CENSO).toContain("providers/ToastProvider.tsx");
  });

  it("⭑ B3: `public/sw.js` esta DENTRO del censo, y es un `.js`", () => {
    // El canario concreto de B3. `sw.js` es el unico archivo DESPLEGADO donde un segundo
    // `pushManager.subscribe()` seria idiomatico —el manejador de `pushsubscriptionchange`— y hasta
    // este arreglo la guardia ni siquiera lo leia: `public/` no llegaba a ser «raiz de codigo».
    expect(raicesCensadas()).toContain("public");
    expect(ARCHIVOS_DEL_CENSO).toContain("public/sw.js");
    // Y las otras dos extensiones que B3 destapo, para que ampliar la aguja no sea solo `.js`.
    expect(ARCHIVOS_DEL_CENSO).toContain("scripts/validar-feature-list.mjs");
    expect(ARCHIVOS_DEL_CENSO).toContain("eslint.config.mjs");
  });

  it("⭑ B3: el censo LEE el contenido de un `.js`, no solo lo lista", () => {
    // Sin esto, `public/sw.js` podria estar en la lista y leerse como cadena vacia: la guardia
    // seguiria siendo ciega y nadie se enteraria. Es la leccion del detector apagado.
    const codigoDelServiceWorker = fs.readFileSync(path.join(RAIZ, "public", "sw.js"), "utf8");
    expect(codigoDelServiceWorker.length).toBeGreaterThan(3000);
    expect(codigoDelServiceWorker).toContain("addEventListener");
    // Y hoy no trae la aguja: el defecto era la CEGUERA, no un incumplimiento vivo.
    expect(importacionesDeLaBaja(quitarComentarios(codigoDelServiceWorker))).toBe(0);
  });

  it("⭑ el censo llega a las NUEVE raices que el arbol tiene hoy", () => {
    // Anti-vacuidad: si el recorrido del disco se rompiera, el inventario cuadraria contra una
    // lista vacia y todo lo de arriba pasaria por vacio en vez de por limpio.
    //
    // ⚠️ ERAN OCHO HASTA B3. `public/` no aparecia porque la aguja de extension era `\.(ts|tsx)$` y
    // ahi solo hay un `.js` — el service worker DESPLEGADO. Con la aguja ampliada la raiz aparece
    // sola y el inventario le reclama su motivo, que era justo el desenlace que faltaba.
    expect(raicesDelArbol()).toEqual([
      "(raiz)",
      "app",
      "components",
      "e2e",
      "hooks",
      "lib",
      "providers",
      "public",
      "scripts",
      "tests",
    ]);
  });

  // ⚠️ LAS TRES AUTOCOMPROBACIONES DE ABAJO CORREN SOBRE UN MUNDO SINTETICO, no sobre el disco.
  // Es deliberado y es la misma leccion que `nuevasInfracciones`: el dia que aparezca una raiz sin
  // clasificar de VERDAD, el caso de arriba se pone rojo —esa es la noticia— y estos tienen que
  // seguir midiendo LO SUYO en vez de enrojecer en cadena. Medido: con una carpeta `widgets/`
  // inyectada en el arbol real, la version anterior arrastraba dos rojos de mas.
  const INVENTARIO_DE_JUGUETE = [
    { ruta: "app", censada: true, motivo: "un motivo suficientemente largo para pasar el umbral del detector de motivos" },
  ];

  it("⭑ AUTOCOMPROBACION: una raiz NUEVA sin clasificar pone el inventario rojo", () => {
    const fallos = fallosDelInventario(["app", "widgets"], INVENTARIO_DE_JUGUETE);
    expect(fallos).toHaveLength(1);
    expect(fallos[0]).toContain("`widgets/`");
    expect(fallos[0]).toContain("NO esta en INVENTARIO_DE_RAICES");
  });

  it("⭑ AUTOCOMPROBACION: una entrada del inventario que ya no existe tambien se caza", () => {
    const fallos = fallosDelInventario(["app"], [
      ...INVENTARIO_DE_JUGUETE,
      { ruta: "fantasma", censada: true, motivo: "un motivo suficientemente largo para pasar el umbral del detector" },
    ]);
    expect(fallos).toHaveLength(1);
    expect(fallos[0]).toContain("ya no tiene codigo en el arbol");
  });

  it("control positivo: un mundo sintetico BIEN clasificado no produce ningun fallo", () => {
    // Sin esto, los dos casos de arriba pasarian con un `fallosDelInventario` que devolviera
    // siempre exactamente un fallo.
    expect(fallosDelInventario(["app"], INVENTARIO_DE_JUGUETE)).toEqual([]);
  });

  it("⭑ AUTOCOMPROBACION: una raiz clasificada SIN motivo escrito se detecta", () => {
    const fallos = fallosDelInventario(["app"], [
      { ruta: "app", censada: true, motivo: "porque si" },
    ]);
    expect(fallos).toEqual(["la raiz `app` esta clasificada sin motivo escrito"]);
  });

  it("la unica raiz FUERA del censo es `tests/`, y su motivo dice por que", () => {
    const fuera = INVENTARIO_DE_RAICES.filter((r) => !r.censada).map((r) => r.ruta);
    expect(fuera).toEqual(["tests"]);
    const tests = INVENTARIO_DE_RAICES.find((r) => r.ruta === "tests")!;
    // El limite, declarado: es el unico sitio con una razon legitima para nombrar lo prohibido.
    expect(tests.motivo).toContain("LIMITE DECLARADO");
  });
});

describe("422/R10 · autocomprobacion del detector", () => {
  it("el detector CUENTA, y no se conforma con decir si/no", () => {
    expect(llamadasEn('await darDeBajaDeEsteDispositivo("cierre-de-sesion");')).toHaveLength(1);
    expect(
      llamadasEn(
        'darDeBajaDeEsteDispositivo("cierre-de-sesion"); darDeBajaDeEsteDispositivo("cierre-de-sesion");',
      ),
    ).toHaveLength(2);
  });

  it("⭑ el detector lee el MOTIVO del texto de la llamada", () => {
    expect(llamadasEn('darDeBajaDeEsteDispositivo("cierre-de-sesion")')[0].argumento).toBe(
      "cierre-de-sesion",
    );
    expect(
      llamadasEn('darDeBajaDeEsteDispositivo( "la-persona-apago-el-interruptor" )')[0].argumento,
    ).toBe("la-persona-apago-el-interruptor");
    // Un motivo que no es un literal —una variable— tampoco pasa por declarado.
    expect(llamadasEn("darDeBajaDeEsteDispositivo(motivo)")[0].argumento).toBeNull();
  });

  it("⭑ el detector NO cuenta la DECLARACION de la funcion", () => {
    expect(
      llamadasEn("export async function darDeBajaDeEsteDispositivo(\n  motivo: MotivoDeLaBaja,\n)"),
    ).toEqual([]);
    expect(llamadasEn("async function darDeBajaDeEsteDispositivo(motivo) {}")).toEqual([]);
  });

  it("el detector NO se dispara con un import ni con una anotacion de tipo", () => {
    expect(
      llamadasEn('import { darDeBajaDeEsteDispositivo } from "@/lib/pwa/baja-push";'),
    ).toEqual([]);
    expect(llamadasEn("let f: typeof darDeBajaDeEsteDispositivo;")).toEqual([]);
  });

  it("el barrido lee un arbol GRANDE y de verdad", () => {
    // Sin esto, un recorrido roto dejaria el censo verde y mudo, que es como ya salio verde una
    // guardia de este repo con su detector apagado.
    expect(ARCHIVOS_DEL_CENSO.length).toBeGreaterThan(800);
    for (const entrada of LISTA_BLANCA) {
      expect(ARCHIVOS_DEL_CENSO, `el censo no llega a ${entrada.ruta}`).toContain(entrada.ruta);
    }
    expect(ARCHIVOS_DEL_CENSO).toContain(RUTA_DEFINICION);
  });

  it("control positivo: las dos entradas de la lista blanca SI importan y SI llaman, con su cuenta y su motivo", () => {
    for (const entrada of LISTA_BLANCA) {
      const codigo = FUENTES.get(entrada.ruta) ?? "";
      // (a) traen el modulo UNA vez, y sin renombrarlo —de eso depende que el motivo sea legible—.
      expect(
        importacionesDeLaBaja(codigo),
        `${entrada.ruta} no trae el modulo de la baja exactamente una vez`,
      ).toBe(1);
      expect(importaSinAlias(codigo), `${entrada.ruta} importa la baja con alias`).toBe(true);
      // (b) y llaman las veces declaradas, con el motivo declarado.
      const llamadas = llamadasEn(codigo);
      expect(llamadas, `${entrada.ruta} no llama las ${entrada.llamadas} veces declaradas`).toHaveLength(
        entrada.llamadas,
      );
      for (const l of llamadas) {
        expect(l.argumento, `${entrada.ruta} no declara el motivo esperado`).toBe(entrada.motivo);
      }
    }
  });

  it("⭑ y NADIE MAS del arbol censado trae ese modulo", () => {
    // La afirmacion central, dicha como lista para que el fallo nombre al culpable.
    const quienesLoTraen = [...FUENTES]
      .filter(([ruta]) => ruta !== RUTA_DEFINICION)
      .filter(([, codigo]) => importacionesDeLaBaja(codigo) > 0)
      .map(([ruta]) => ruta)
      .sort();
    expect(quienesLoTraen).toEqual(LISTA_BLANCA.map((e) => e.ruta).sort());
  });

  it("⭑ el archivo donde la funcion VIVE no cuenta como llamante", () => {
    // Control del caso borde: `lib/pwa/baja-push.ts` menciona el nombre tres veces (la
    // declaracion, y dos en la prosa que el quitador de comentarios ya retira).
    const codigo = FUENTES.get(RUTA_DEFINICION) ?? "";
    expect(codigo.length, "no se leyo el archivo de la definicion").toBeGreaterThan(1000);
    expect(codigo).toContain("function darDeBajaDeEsteDispositivo(");
    expect(llamadasEn(codigo)).toEqual([]);
  });

  it("cada entrada de la lista blanca lleva su PORQUE escrito", () => {
    // Una lista blanca sin porques se convierte en una lista de excepciones que nadie relee.
    for (const entrada of LISTA_BLANCA) {
      expect(entrada.porque.length, `${entrada.ruta} sin porque`).toBeGreaterThan(120);
    }
  });

  it("los motivos declarados existen de verdad en el tipo", () => {
    // Si un dia se anade un tercer motivo, esta lista hay que releerla — y releerla es el punto.
    for (const entrada of LISTA_BLANCA) {
      expect(MOTIVOS).toContain(entrada.motivo);
    }
    const fuenteDelTipo = fs.readFileSync(path.join(RAIZ, RUTA_DEFINICION), "utf8");
    for (const motivo of MOTIVOS) {
      expect(fuenteDelTipo, `el motivo ${motivo} no esta en el tipo`).toContain(`"${motivo}"`);
    }
  });
});

describe("422/R10 · EL CENSO: nadie se da de baja sin declarar por que", () => {
  it("⭑ ningun archivo de NINGUNA raiz censada se sale de la lista blanca", () => {
    const infracciones = censar(FUENTES);
    expect(
      infracciones,
      "una superficie que se de de baja sin declarar su motivo —o declarando uno distinto del " +
        "que la lista blanca dice— rompe la unica distincion que esta ficha existe para hacer: " +
        "«dijo que no» frente a «solo se fue». Si la llamada es legitima, declarala en " +
        "`LISTA_BLANCA` CON SU MOTIVO Y SU PORQUE; y si el motivo que has puesto es el correcto, " +
        "actualiza la entrada y explica el cambio.",
    ).toEqual([]);
  });

  it("⭑ AUTOCOMPROBACION: una TERCERA superficie sin declarar se caza", () => {
    // Se inyecta en el RECORRIDO, no en el arbol: el archivo no llega a existir.
    const intruso = "components/shared/BotonPanico.tsx";
    expect(FUENTES.has(intruso), "el intruso no puede existir de verdad en el arbol").toBe(false);

    const conIntruso = new Map(FUENTES);
    conIntruso.set(
      intruso,
      'import { darDeBajaDeEsteDispositivo } from "@/lib/pwa/baja-push";\n' +
        'export function BotonPanico() {\n  void darDeBajaDeEsteDispositivo("cierre-de-sesion");\n}\n',
    );

    expect(nuevasInfracciones(conIntruso)).toEqual([
      { ruta: intruso, importa: 1, autorizadas: 0, motivos: ["cierre-de-sesion"] },
    ]);
  });

  it("⭑ AUTOCOMPROBACION: una SEGUNDA llamada dentro de un archivo YA autorizado tambien se caza", () => {
    // La leccion medida dos veces en este repo: una guardia que mide POR ARCHIVO se queda verde
    // cuando la llamada de mas se esconde al lado de una legitima. El import sigue siendo UNO, asi
    // que este caso lo caza la mitad (b) del censo —la cuenta de llamadas—, no la del modulo.
    const ruta = "app/_components/LogoutButton.tsx";
    const conDos = new Map(FUENTES);
    conDos.set(
      ruta,
      (FUENTES.get(ruta) ?? "") + '\nvoid darDeBajaDeEsteDispositivo("cierre-de-sesion");\n',
    );

    expect(nuevasInfracciones(conDos)).toEqual([
      {
        ruta,
        importa: 1,
        autorizadas: 1,
        motivos: ["cierre-de-sesion", "cierre-de-sesion"],
      },
    ]);
  });

  it("⭑ AUTOCOMPROBACION: cambiar el MOTIVO de una entrada autorizada se caza (mutacion M1)", () => {
    // ÉSTA es la mutacion que la ficha exige por nombre: quitar la distincion entre «salir» y
    // «apagar». El compilador no la ve —los dos motivos son validos— y la cuenta sigue siendo 1.
    // Lo unico que cambia es el literal, y es justo lo que este censo compara.
    const ruta = "app/_components/LogoutButton.tsx";
    const mutado = new Map(FUENTES);
    mutado.set(
      ruta,
      (FUENTES.get(ruta) ?? "").replace(
        '"cierre-de-sesion"',
        '"la-persona-apago-el-interruptor"',
      ),
    );

    expect(nuevasInfracciones(mutado)).toEqual([
      {
        ruta,
        importa: 1,
        autorizadas: 1,
        motivos: ["la-persona-apago-el-interruptor"],
      },
    ]);
  });

  it("⭑ AUTOCOMPROBACION: un motivo que NO es literal tampoco pasa por declarado", () => {
    // Pasar el motivo por variable compila, pero deja el censo sin nada que leer: si se admitiera,
    // bastaria con `darDeBajaDeEsteDispositivo(motivo)` para saltarse esta guardia entera.
    const ruta = "hooks/usePushSuscripcion.ts";
    const mutado = new Map(FUENTES);
    mutado.set(
      ruta,
      (FUENTES.get(ruta) ?? "").replace(
        '"la-persona-apago-el-interruptor"',
        "motivoElegido",
      ),
    );

    expect(nuevasInfracciones(mutado)).toEqual([
      { ruta, importa: 1, autorizadas: 1, motivos: [null] },
    ]);
  });

  it("⭑ AUTOCOMPROBACION: el censo NO se dispara con una MENCION en un comentario", () => {
    // Si se disparara, la unica salida seria borrar la explicacion para pasar la guardia, y este
    // arbol explica en la prosa justo lo que el codigo tiene prohibido.
    const conProsa = new Map(FUENTES);
    conProsa.set(
      "lib/inventado/solo-prosa.ts",
      quitarComentarios(
        "// ojo: aqui NO se llama a `darDeBajaDeEsteDispositivo(\"cierre-de-sesion\")`\nexport const x = 1;\n",
      ),
    );
    expect(nuevasInfracciones(conProsa)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// B2 · LAS CUATRO FORMAS DE TRAERSE LA BAJA CON OTRO NOMBRE, Y LO QUE NO SE CIERRA
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// La revision colo una tercera superficie con un ALIAS. Arreglar SOLO el alias seria atornillar el
// sintoma: hay cuatro maneras de escribir «traeme esa funcion» y el censo tiene que cazarlas todas
// por la misma razon —el ESPECIFICADOR del modulo es lo unico que ninguna de ellas puede evitar—.
// Cada una va con su caso, y el limite que queda abierto va escrito abajo en vez de tapado.

describe("422/B2 · el censo persigue el MODULO, asi que el nombre local da igual", () => {
  it("⭑ el detector cuenta el especificador en sus cuatro formas", () => {
    expect(importacionesDeLaBaja('import { darDeBajaDeEsteDispositivo } from "@/lib/pwa/baja-push";')).toBe(1);
    expect(importacionesDeLaBaja('import { darDeBajaDeEsteDispositivo as bajar } from "@/lib/pwa/baja-push";')).toBe(1);
    expect(importacionesDeLaBaja('export { darDeBajaDeEsteDispositivo } from "@/lib/pwa/baja-push";')).toBe(1);
    expect(importacionesDeLaBaja('const m = await import("@/lib/pwa/baja-push");')).toBe(1);
    // Y con ruta RELATIVA, que es la via que un `@/` mal configurado dejaria abierta.
    expect(importacionesDeLaBaja('import { x } from "../../lib/pwa/baja-push";')).toBe(1);
    expect(importacionesDeLaBaja('import { x } from "./lib/pwa/baja-push.ts";')).toBe(1);
    // Control negativo: un modulo que solo se PARECE no cuenta.
    expect(importacionesDeLaBaja('import { x } from "@/lib/pwa/alta-push";')).toBe(0);
    expect(importacionesDeLaBaja("const baja = 1;")).toBe(0);
  });

  it("⭑ EL CASO DE LA REVISION: alias en un componente YA montado", () => {
    // Reproducido tal cual: la revision uso `components/shared/AvisoVersionNueva.tsx`, que el
    // layout del portal MONTA —asi que la guardia de «superficie inalcanzable» tampoco lo cazaba—.
    // Antes pasaba con typecheck verde y 145 guardias verdes; ahora el censo lo ve por el import.
    //
    // EL HECHO va sobre el archivo REAL (existe, esta censado y es alcanzable); LA MEDICION va
    // sobre un lienzo sintetico a su lado (m3): si alguien escribe un infractor de verdad en ese
    // componente, la noticia tiene que ser el censo, no este caso enrojeciendo en cadena.
    expect(
      FUENTES.has("components/shared/AvisoVersionNueva.tsx"),
      "el componente del caso tiene que existir y estar censado",
    ).toBe(true);

    const ruta = "components/shared/__lienzo-alias__.tsx";
    expect(FUENTES.has(ruta), "el lienzo no puede existir de verdad en el arbol").toBe(false);
    const conAlias = new Map(FUENTES);
    conAlias.set(
      ruta,
      'import { darDeBajaDeEsteDispositivo as bajar } from "@/lib/pwa/baja-push";\n' +
        'export function Aviso() {\n  void bajar("cierre-de-sesion");\n}\n',
    );

    const nuevas = nuevasInfracciones(conAlias);
    expect(nuevas).toHaveLength(1);
    expect(nuevas[0].ruta).toBe(ruta);
    expect(nuevas[0].importa).toBe(1);
    expect(nuevas[0].autorizadas).toBe(0);
    // ⚠️ Y NO HAY NINGUNA LLAMADA LEGIBLE: el motivo no se puede leer porque la llamada se escribe
    // `bajar(...)`. Por eso el censo NO puede apoyarse en la llamada — es exactamente B2.
    expect(nuevas[0].motivos).toEqual([]);
  });

  it("⭑ un RE-EXPORT tambien se caza, en el archivo que re-exporta", () => {
    // La via «legal»: un barril que reexporta y luego todos importan del barril. El barril queda
    // denunciado, que es donde hay que decidir.
    const barril = "components/shared/index.ts";
    const conBarril = new Map(FUENTES);
    conBarril.set(barril, 'export { darDeBajaDeEsteDispositivo } from "@/lib/pwa/baja-push";\n');

    expect(nuevasInfracciones(conBarril)).toEqual([
      { ruta: barril, importa: 1, autorizadas: 0, motivos: [] },
    ]);
  });

  it("⭑ un `import()` DINAMICO tambien se caza", () => {
    // Lienzo sintetico, por lo mismo que arriba (m3).
    const ruta = "providers/__lienzo-dinamico__.tsx";
    expect(FUENTES.has(ruta)).toBe(false);
    const conDinamico = new Map(FUENTES);
    conDinamico.set(
      ruta,
      'export async function irseDeAqui() {\n' +
        '  const { darDeBajaDeEsteDispositivo: irse } = await import("@/lib/pwa/baja-push");\n' +
        '  void irse("cierre-de-sesion");\n}\n',
    );

    const nuevas = nuevasInfracciones(conDinamico);
    expect(nuevas).toHaveLength(1);
    expect(nuevas[0]).toMatchObject({ ruta, importa: 1, autorizadas: 0 });
  });

  it("⭑ y una RUTA RELATIVA no lo esquiva", () => {
    // ⚠️ LIENZO SINTETICO, no un archivo real (m3 de `review_422_fix.md`). Con un infractor de
    // verdad viviendo en `providers/ToastProvider.tsx`, `nuevasInfracciones` RESTABA la infraccion
    // real —la clave coincidia— y este caso se quedaba sin su noticia, enrojeciendo en cadena. Es
    // la misma leccion que ya se aplico al inventario: el lienzo no puede ser un sitio que alguien
    // pueda ocupar.
    const ruta = "providers/__lienzo-ruta-relativa__.tsx";
    expect(FUENTES.has(ruta), "el lienzo no puede existir de verdad en el arbol").toBe(false);
    const conRelativa = new Map(FUENTES);
    conRelativa.set(
      ruta,
      'import { darDeBajaDeEsteDispositivo } from "../../lib/pwa/baja-push";\n' +
        'void darDeBajaDeEsteDispositivo("cierre-de-sesion");\n',
    );

    expect(nuevasInfracciones(conRelativa)).toEqual([
      { ruta, importa: 1, autorizadas: 0, motivos: ["cierre-de-sesion"] },
    ]);
  });

  it("⭑ B3: un modulo `.js` dentro de una raiz censada tampoco se escapa", () => {
    // EL CASO DE LA RE-REVISION, reproducido sobre el detector: `components/shared/adios-legacy.js`
    // con la llamada SIN NINGUN MOTIVO —que en `.js` compila, porque `allowJs` va sin `checkJs`—.
    // Antes ni se leia el archivo; ahora entra en el censo por la extension y cae por el import.
    const ruta = "components/shared/adios-legacy.js";
    expect(FUENTES.has(ruta), "el intruso no puede existir de verdad en el arbol").toBe(false);
    const conJs = new Map(FUENTES);
    conJs.set(
      ruta,
      'import { darDeBajaDeEsteDispositivo } from "@/lib/pwa/baja-push";\n' +
        "export async function adiosLegacy() {\n  await darDeBajaDeEsteDispositivo();\n}\n",
    );

    // `motivos: [null]` es la parte que mas dice: la llamada no declara NADA, y en un `.js` el
    // typecheck tampoco lo exige. Las dos lineas de defensa caian a la vez.
    expect(nuevasInfracciones(conJs)).toEqual([
      { ruta, importa: 1, autorizadas: 0, motivos: [null] },
    ]);
  });

  it("⭑ B3: y lo mismo con un `.mjs`, que es la otra extension viva del repo", () => {
    const ruta = "scripts/adios-legacy.mjs";
    expect(FUENTES.has(ruta)).toBe(false);
    const conMjs = new Map(FUENTES);
    conMjs.set(ruta, 'import { darDeBajaDeEsteDispositivo as x } from "@/lib/pwa/baja-push";\nx();\n');

    expect(nuevasInfracciones(conMjs)).toEqual([
      { ruta, importa: 1, autorizadas: 0, motivos: [] },
    ]);
  });

  it("⭑ un ALIAS en uno de los DOS archivos autorizados tambien se caza", () => {
    // No basta con que el import exista: en los dos sitios de la lista blanca tiene que venir SIN
    // renombrar, porque el motivo se lee del texto de la llamada. Con alias, la cuenta del modulo
    // seguiria siendo 1 y el motivo dejaria de ser legible — o sea, la guardia se quedaria muda
    // justo donde mas afirma.
    const ruta = "app/_components/LogoutButton.tsx";
    const conAlias = new Map(FUENTES);
    conAlias.set(
      ruta,
      (FUENTES.get(ruta) ?? "")
        .replace(
          "import { darDeBajaDeEsteDispositivo }",
          "import { darDeBajaDeEsteDispositivo as bajar }",
        )
        .replace('darDeBajaDeEsteDispositivo("cierre-de-sesion")', 'bajar("cierre-de-sesion")'),
    );

    const nuevas = nuevasInfracciones(conAlias);
    expect(nuevas).toHaveLength(1);
    expect(nuevas[0]).toMatchObject({ ruta, importa: 1, autorizadas: 1, motivos: [] });
  });

  it("control positivo: `importaSinAlias` distingue de verdad", () => {
    // Sin esto, el caso de arriba pasaria en verde con un detector que dijera «hay alias» siempre.
    expect(importaSinAlias('import { darDeBajaDeEsteDispositivo } from "@/lib/pwa/baja-push";')).toBe(true);
    expect(importaSinAlias('import { darDeBajaDeEsteDispositivo as bajar } from "@/lib/pwa/baja-push";')).toBe(false);
    expect(importaSinAlias("const { darDeBajaDeEsteDispositivo: irse } = await import('x');")).toBe(false);
  });

  it("⭑ EL LIMITE, DECLARADO: un especificador COMPUESTO en tiempo de ejecucion no se caza", () => {
    // `await import("@/lib/pwa/" + "baja-push")` no deja el especificador literal en ningun sitio,
    // asi que ninguna guardia de texto puede verlo. Se escribe aqui en vez de fingir que no existe:
    //
    //   · lo que SI queda cerrado por el tipo: el motivo sigue siendo obligatorio y la union sigue
    //     cerrada, asi que esa superficie tiene que declarar UNO de los dos motivos igualmente
    //     (R10 conserva su mitad fuerte, la que no depende de ninguna guardia);
    //   · y una cadena partida a proposito para esquivar un censo no es un descuido: es un acto
    //     deliberado, que es justo lo contrario del fallo que estas guardias existen para cazar
    //     —el de quien se olvida—.
    const compuesto = 'const m = await import("@/lib/pwa/" + "baja-push");';
    expect(importacionesDeLaBaja(compuesto)).toBe(0);
  });
});

describe("422/R10 · y el TIPO, que es la primera linea de defensa", () => {
  const fuente = fs.readFileSync(path.join(RAIZ, RUTA_DEFINICION), "utf8");
  const codigo = quitarComentarios(fuente);

  it("⭑ el motivo es un parametro OBLIGATORIO: sin valor por defecto y sin `?`", () => {
    // Un defecto convertiria «no dijo por que» en «se asume que solo se va», que es exactamente la
    // mitad que se olvida. La firma se lee del archivo para que quitarlo se note aqui tambien, no
    // solo en el typecheck.
    expect(codigo).toMatch(/darDeBajaDeEsteDispositivo\(\s*motivo:\s*MotivoDeLaBaja,?\s*\)/);
    expect(codigo).not.toMatch(/motivo\?\s*:\s*MotivoDeLaBaja/);
    expect(codigo).not.toMatch(/motivo:\s*MotivoDeLaBaja\s*=/);
  });

  it("⭑ el `switch` de la intencion es EXHAUSTIVO: un motivo nuevo sin tratar no compila", () => {
    expect(codigo).toContain("switch (motivo)");
    expect(codigo).toMatch(/const _exhaustivo:\s*never\s*=\s*motivo/);
    // Los dos motivos tienen su `case`: si alguien borrara uno, el `never` lo cazaria en el
    // typecheck, y esto lo dice aqui con nombre y apellido.
    for (const motivo of MOTIVOS) {
      expect(codigo, `falta el case de ${motivo}`).toContain(`case "${motivo}"`);
    }
  });

  it("⭑ la intencion se resuelve ANTES del corte por «sin suscripcion» (R11)", () => {
    // El orden es una decision, no un detalle: invertirlo deja la preferencia puesta cuando la
    // suscripcion se evaporo entre el render y el clic. La mutacion M4 lo mueve; aqui se ve.
    const iIntencion = codigo.indexOf("await resolverLaIntencion(motivo)");
    const iCorte = codigo.indexOf("contenedorDeServiceWorker()");
    expect(iIntencion, "no se encontro la resolucion de la intencion").toBeGreaterThan(-1);
    expect(iCorte, "no se encontro el corte por soporte").toBeGreaterThan(-1);
    expect(iIntencion).toBeLessThan(iCorte);
  });
});
