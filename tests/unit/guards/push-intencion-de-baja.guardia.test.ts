import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";

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

const RAIZ = path.resolve(__dirname, "..", "..", "..");

/** Donde puede vivir una superficie que se de de baja: cliente y servidor del portal. */
const RAICES_DEL_CENSO = ["app", "components", "hooks", "lib"];

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
 * proposito en la prosa lo que el codigo tiene prohibido —la cabecera de `baja-push.ts` escribe
 * `darDeBajaDeEsteDispositivo()` para explicar que asi NO compila— y un censo sobre el texto crudo
 * denunciaria la explicacion.
 *
 * El atajo del `includes` sobre el crudo NO cambia ningun veredicto (si el nombre no esta en el
 * texto entero, tampoco esta despues de quitar comentarios) y ahorra la pasada a los archivos que
 * no lo mencionan.
 */
function textoCensable(rel: string): string {
  const crudo = fs.readFileSync(path.join(RAIZ, rel), "utf8");
  return crudo.includes("darDeBajaDeEsteDispositivo") ? quitarComentarios(crudo) : "";
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

interface Infraccion {
  readonly ruta: string;
  readonly llamadas: number;
  readonly autorizadas: number;
  readonly motivos: (string | null)[];
}

/**
 * El censo, sobre un mapa de fuentes que se le PASA — no sobre el disco. Es lo que permite
 * inyectarle un archivo intruso y comprobar que lo caza (autocomprobacion), en vez de escribir
 * basura en el arbol.
 */
function censar(fuentes: ReadonlyMap<string, string>): Infraccion[] {
  const autorizadas = new Map(LISTA_BLANCA.map((e) => [e.ruta, e] as const));
  const infracciones: Infraccion[] = [];
  for (const [ruta, codigo] of fuentes) {
    const llamadas = llamadasEn(codigo);
    const permitida = autorizadas.get(ruta);
    const cuenta = permitida?.llamadas ?? 0;
    const motivos = llamadas.map((l) => l.argumento);
    // Distinto, no «mayor»: una entrada de la lista blanca que deja de ser cierta tambien tiene
    // que volver a leerse. Una lista blanca que se desvia de la realidad ya no vigila nada.
    const cuentaMal = llamadas.length !== cuenta;
    // Y el MOTIVO declarado tiene que ser el que la lista dice: la mutacion que esta ficha exige
    // por nombre —cambiar el motivo del `LogoutButton`— muere justo aqui.
    const motivoMal = permitida
      ? motivos.some((m) => m !== permitida.motivo)
      : motivos.length > 0;
    if (cuentaMal || motivoMal) {
      infracciones.push({ ruta, llamadas: llamadas.length, autorizadas: cuenta, motivos });
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
  const clave = (i: Infraccion) => `${i.ruta}:${i.llamadas}:${i.motivos.join(",")}`;
  const yaHabia = new Set(censar(FUENTES).map(clave));
  return censar(fuentes).filter((i) => !yaHabia.has(clave(i)));
}

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

  it("control positivo: las dos entradas de la lista blanca SI llaman, con la cuenta y el motivo declarados", () => {
    for (const entrada of LISTA_BLANCA) {
      const llamadas = llamadasEn(FUENTES.get(entrada.ruta) ?? "");
      expect(llamadas, `${entrada.ruta} no llama las ${entrada.llamadas} veces declaradas`).toHaveLength(
        entrada.llamadas,
      );
      for (const l of llamadas) {
        expect(l.argumento, `${entrada.ruta} no declara el motivo esperado`).toBe(entrada.motivo);
      }
    }
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
  it("⭑ ningun archivo de `app/`, `components/`, `hooks/` ni `lib/` se sale de la lista blanca", () => {
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
      'export function BotonPanico() {\n  void darDeBajaDeEsteDispositivo("cierre-de-sesion");\n}\n',
    );

    expect(nuevasInfracciones(conIntruso)).toEqual([
      { ruta: intruso, llamadas: 1, autorizadas: 0, motivos: ["cierre-de-sesion"] },
    ]);
  });

  it("⭑ AUTOCOMPROBACION: una SEGUNDA llamada dentro de un archivo YA autorizado tambien se caza", () => {
    // La leccion medida dos veces en este repo: una guardia que mide POR ARCHIVO se queda verde
    // cuando la llamada de mas se esconde al lado de una legitima.
    const ruta = "app/_components/LogoutButton.tsx";
    const conDos = new Map(FUENTES);
    conDos.set(
      ruta,
      (FUENTES.get(ruta) ?? "") + '\nvoid darDeBajaDeEsteDispositivo("cierre-de-sesion");\n',
    );

    expect(nuevasInfracciones(conDos)).toEqual([
      {
        ruta,
        llamadas: 2,
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
        llamadas: 1,
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
      { ruta, llamadas: 1, autorizadas: 1, motivos: [null] },
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
