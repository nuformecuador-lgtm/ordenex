import fs from "fs";
import path from "path";

import { describe, it, expect } from "vitest";

import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

// GUARDIA DEL ARNÉS — LAS LISTAS QUE DICEN «QUÉ OCUPA A ESTE MENSAJERO» Y «A QUIÉN HAY QUE BARRER».
//
// ⚠️ ESTA GUARDIA NACE DE UN FALLO REAL, MEDIDO EN REVISIÓN Y NO POR LA SUITE (feature 235,
// 2026-08-19). La ficha movió la solicitud de ayuda de un BOOLEANO (`orden.ayuda`, con la orden
// quieta en `en_reparto`) a un ESTATUS PROPIO (`ayuda_tienda`). Barrió las listas que **ofrecen
// órdenes** —optimizador, mapa, asignación, ruteo, recolección, novedades— y se dejó **otra
// familia entera**: las listas que describen la **ocupación del mensajero** o **a quién barre el
// corte de la noche**. Resultado, dos agujeros que costaban dinero y operación:
//
//   1. `CorteDiarioRepository` seguía seleccionando por `en_reparto`, así que un mensajero que
//      acababa el día con TODO en ayuda no entraba en el bucle del corte: ni cierre `vencido`, ni
//      barrido. Nunca. (Y pedir ayuda no crea `gestion_orden`, así que la otra rama tampoco lo
//      pescaba.)
//   2. `GuiaAsignacionService` leía a ese mensajero como «sin carga» y el maestro podía mandarlo a
//      recolectar a una tienda, contra la regla de dedicación de la 157.
//
// **Qué protege esta guardia, dicho como propiedad y no como lista:** que TODA lista de esta
// familia declare **explícitamente** su decisión sobre cada estatus «en la mano del mensajero», y
// que los **gemelos** (las que dicen la misma verdad en dos capas) no puedan separarse. Un estatus
// nuevo del catálogo —la ficha 237 abre aristas desde `ayuda_tienda`— obliga a pasar por aquí.
//
// **Por qué se lee del FUENTE y no se importan las constantes.** Tres de las seis son `const`
// privadas de módulo, y las otras tres son literales en el sitio de la llamada. Copiarlas aquí
// convertiría la guardia en un espejo de sí misma: seguiría verde después de que alguien moviera la
// de verdad, que es EXACTAMENTE el fallo que vino a cerrar. Cada extracción **revienta con nombre y
// apellido** si su patrón deja de casar; ninguna devuelve «no encontré nada» como si fuera «no hay
// infracciones».
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

/** Corta en seco: si la guardia no puede leer lo que vigila, se detiene en ROJO. */
function reventar(que: string): never {
  throw new Error(
    `guardia carga-del-mensajero: ${que}. La guardia NO pudo leer lo que vigila; se detiene en ` +
      `ROJO en vez de dar por buena una lectura vacía. Si el código se reorganizó, actualiza la ` +
      `extracción — no borres la comprobación.`,
  );
}

/**
 * El VALOR de una expresión que, en estos módulos, es o un literal de texto o el nombre de un
 * `const` de módulo declarado con uno (`const ESTADO_AYUDA = "ayuda_tienda";`). Cualquier otra cosa
 * —una expresión calculada, un import— REVIENTA: preferimos que alguien tenga que venir a enseñarle
 * a la guardia a leer su refactor antes que dejarla adivinando.
 *
 * Hace falta porque estas listas se escriben de las DOS formas en el árbol: unas con literales
 * (`["por_recoger", "en_reparto"]`) y otras con constantes (`[ORIGEN_RECOGER, ESTADO_EN_REPARTO]`).
 * Aceptar solo una de las dos dejaría media familia sin vigilar.
 */
function valorDe(fuenteModulo: string, ruta: string, expresion: string): string {
  const literal = /^["\'`]([^"\'`]*)["\'`]$/.exec(expresion.trim());
  if (literal) return literal[1];

  const identificador = expresion.trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(identificador)) {
    reventar(`${ruta}: \`${identificador}\` no es ni un literal ni un identificador simple`);
  }
  const decl = new RegExp(
    `\\b(?:const|let|var)\\s+${identificador}\\s*(?::[^=]*)?=\\s*["\'\`]([^"\'\`]+)["\'\`]`,
  ).exec(fuenteModulo);
  if (!decl) {
    reventar(`${ruta}: \`${identificador}\` no se declara con un literal de texto en este módulo`);
  }
  return decl[1];
}

/** Los elementos de un array `[...]`, resueltos a su valor. `[]` nunca se acepta como respuesta. */
function elementosDe(fuente: string, arreglo: string, ruta: string, que: string): string[] {
  const piezas = arreglo
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  if (piezas.length === 0) reventar(`${ruta}: ${que} salió vacía`);
  return piezas.map((e) => valorDe(fuente, ruta, e));
}

/** El array asignado a `const NOMBRE = [ ... ];`. */
function listaConstante(fuente: string, ruta: string, nombre: string): string[] {
  const re = new RegExp(`\\bconst\\s+${nombre}\\s*(?::[^=]*)?=\\s*\\[([^\\]]*)\\]`);
  const m = re.exec(fuente);
  if (!m) reventar(`${ruta}: no se encontró \`const ${nombre} = [...]\``);
  return elementosDe(fuente, m[1], ruta, `\`${nombre}\``);
}

/** El array literal que recibe la primera llamada a `nombre(`. */
function listaEnLlamada(fuente: string, ruta: string, nombre: string, ocurrencia = 0): string[] {
  const llamadas = [...fuente.matchAll(new RegExp(`\\b${nombre}\\s*\\(([^)]*)\\)`, "g"))];
  if (llamadas.length <= ocurrencia) {
    reventar(`${ruta}: no se encontró la llamada #${ocurrencia + 1} a \`${nombre}(…)\``);
  }
  const args = llamadas[ocurrencia][1];
  const arreglo = /\[([^\]]*)\]/.exec(args);
  if (!arreglo) reventar(`${ruta}: \`${nombre}(…)\` ya no recibe una lista literal de estatus`);
  return elementosDe(fuente, arreglo[1], ruta, `la lista de \`${nombre}(…)\``);
}

/** Los `findEstatusIdByValue(CONST)` de un módulo, resueltos a sus literales. */
function estatusResueltos(fuente: string, ruta: string): string[] {
  const nombres = [...fuente.matchAll(/findEstatusIdByValue\(\s*([A-Z_][A-Z0-9_]*)\s*\)/g)].map(
    (m) => m[1],
  );
  if (nombres.length === 0) reventar(`${ruta}: no se encontró ningún \`findEstatusIdByValue(CONST)\``);
  return nombres.map((n) => {
    const decl = new RegExp(`\\bconst\\s+${n}\\s*(?::[^=]*)?=\\s*["'\`]([^"'\`]+)["'\`]`).exec(fuente);
    if (!decl) reventar(`${ruta}: \`${n}\` no se declara con un literal de texto en este módulo`);
    return decl[1];
  });
}

function leer(rel: string): string {
  const abs = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(abs)) reventar(`${rel}: el archivo no existe`);
  return codigoSinComentarios(rel);
}

// =============================================================================================
// EL CENSO — la familia entera, con su decisión declarada una por una
// =============================================================================================

/** El estatus que esta guardia nació vigilando. Es «el paquete sigue con él, en la calle» (R1). */
const AYUDA = "ayuda_tienda";

const RUTA_CIERRE_SERVICE = "lib/services/CierreDiaService.ts";
const RUTA_GUIA_SERVICE = "lib/services/GuiaAsignacionService.ts";
const RUTA_GUIA_ACTION = "lib/actions/ordenes-guia.ts";
const RUTA_CORTE_REPO = "lib/repositories/CorteDiarioRepository.ts";
const RUTA_CORTE_SERVICE = "lib/services/CorteDiarioService.ts";
const RUTA_PORTAL = "lib/services/MisAsignacionesService.ts";
const RUTA_KPI_REPO = "lib/repositories/GestionOrdenRepository.ts";
// Feature 262 (B10): la lista de estados sobre los que se ofrece corregir el día de reparto.
const RUTA_CORRECCION_DIA = "lib/services/CorreccionDiaRepartoService.ts";

interface MiembroDeLaFamilia {
  /** Cómo se llama en la conversación, no cómo se llama la constante. */
  nombre: string;
  ruta: string;
  /**
   * La pregunta que esta lista responde.
   *
   * ⚠️ TERCER VALOR AÑADIDO POR LA FEATURE 262 (B10), Y **DECLARADO** EN VEZ DE COLADO. La lista de
   * la corrección del día pertenece a esta familia —decide sobre «lo que el mensajero lleva
   * encima»— pero NO responde ninguna de las dos preguntas anteriores: no dice quién está ocupado
   * ni a quién barre el corte, dice **dónde vive todavía el día de reparto**. Meterla como si
   * respondiera otra dejaría el censo diciendo una cosa por otra, que es exactamente el defecto que
   * esta guardia vino a cerrar.
   */
  pregunta:
    | "que ocupa al mensajero"
    | "a quien barre el corte"
    | "donde vive el dia de reparto";
  estatus: () => string[];
  /** `true` si `ayuda_tienda` DEBE estar. La razón va en el mensaje del test. */
  incluyeAyuda: boolean;
  razon: string;
}

const FAMILIA: readonly MiembroDeLaFamilia[] = [
  {
    nombre: "el bloqueo de la solicitud de cierre (`ESTADOS_PENDIENTES`)",
    ruta: RUTA_CIERRE_SERVICE,
    pregunta: "que ocupa al mensajero",
    estatus: () => listaConstante(leer(RUTA_CIERRE_SERVICE), RUTA_CIERRE_SERVICE, "ESTADOS_PENDIENTES"),
    incluyeAyuda: true,
    razon:
      "235/R22-R23: el paquete sigue en su mano, así que cerrar el día lo dejaría fuera de todo " +
      "cuadre. Hasta la 235 bloqueaba POR ACCIDENTE (la orden seguía en `en_reparto`)",
  },
  {
    nombre: "la regla de dedicación de la 157 (`ESTADOS_REPARTO_PENDIENTE`)",
    ruta: RUTA_GUIA_SERVICE,
    pregunta: "que ocupa al mensajero",
    estatus: () =>
      listaConstante(leer(RUTA_GUIA_SERVICE), RUTA_GUIA_SERVICE, "ESTADOS_REPARTO_PENDIENTE"),
    incluyeAyuda: true,
    razon:
      "157 + 235/R1: quien va a una tienda a recolectar sale con el vehículo VACÍO. Un mensajero " +
      "con una orden en ayuda lleva el paquete encima",
  },
  {
    nombre: "el marcador del selector del maestro (`conRepartoIds`)",
    ruta: RUTA_GUIA_ACTION,
    pregunta: "que ocupa al mensajero",
    estatus: () => listaEnLlamada(leer(RUTA_GUIA_ACTION), RUTA_GUIA_ACTION, "findMensajerosConOrdenesEn"),
    incluyeAyuda: true,
    razon:
      "es el GEMELO DE INTERFAZ de la regla de dedicación: si dice menos que el servicio, el " +
      "selector deja elegir a quien el servidor va a rechazar al confirmar",
  },
  {
    nombre: "la selección del corte de la noche (`ESTADOS_A_BARRER`)",
    ruta: RUTA_CORTE_REPO,
    pregunta: "a quien barre el corte",
    estatus: () => listaConstante(leer(RUTA_CORTE_REPO), RUTA_CORTE_REPO, "ESTADOS_A_BARRER"),
    incluyeAyuda: true,
    razon:
      "235/R26: es la lista que decide QUIÉN entra en el bucle de `ejecutarCorte`. Sin el estatus " +
      "de ayuda, el mensajero que acaba el día con todo ahí no recibe cierre ni barrido NUNCA",
  },
  {
    nombre: "los estatus que el corte resuelve para escribir (`CorteDiarioService`)",
    ruta: RUTA_CORTE_SERVICE,
    pregunta: "a quien barre el corte",
    estatus: () => estatusResueltos(leer(RUTA_CORTE_SERVICE), RUTA_CORTE_SERVICE),
    incluyeAyuda: true,
    razon:
      "235/R26: es el GEMELO de la selección, un piso más arriba. Si dicen cosas distintas, el " +
      "barrido queda correcto de `crearCierre` hacia dentro y roto desde la selección hacia fuera",
  },
  {
    nombre: "el corte del portal del mensajero (`listarMisAsignaciones`)",
    ruta: RUTA_PORTAL,
    pregunta: "que ocupa al mensajero",
    estatus: () => listaEnLlamada(leer(RUTA_PORTAL), RUTA_PORTAL, "findMisAsignaciones"),
    incluyeAyuda: true,
    razon:
      "235/R18-R19: es lo que el mensajero VE como suyo. Si la orden no viaja, desaparece de su " +
      "pantalla con el paquete todavía en la moto",
  },
  {
    nombre: "la red de disjunción del `totalACobrar` (`ESTADOS_EN_MANO_DEL_MENSAJERO`)",
    ruta: RUTA_KPI_REPO,
    pregunta: "que ocupa al mensajero",
    estatus: () =>
      listaConstante(leer(RUTA_KPI_REPO), RUTA_KPI_REPO, "ESTADOS_EN_MANO_DEL_MENSAJERO"),
    incluyeAyuda: true,
    razon:
      "235/R21: es la EXCLUSIÓN que mantiene disjuntos los dos sumandos del total del día. El otro " +
      "sumando se calcula sobre `porGestionar ∪ conAyuda`, así que esta red tiene que cubrir lo mismo",
  },
  {
    nombre: "los estados donde el día de reparto todavía decide (`ESTADOS_CON_DIA_DE_REPARTO_VIVO`)",
    ruta: RUTA_CORRECCION_DIA,
    pregunta: "donde vive el dia de reparto",
    estatus: () =>
      listaConstante(
        leer(RUTA_CORRECCION_DIA),
        RUTA_CORRECCION_DIA,
        "ESTADOS_CON_DIA_DE_REPARTO_VIVO",
      ),
    incluyeAyuda: true,
    razon:
      "262/R6 + 235/R1: es la lista que decide SOBRE QUÉ ÓRDENES se puede corregir el día. Con " +
      "`ayuda_tienda` fuera, la orden bloqueada por la otra puerta —261/R28 impide que la tienda " +
      "la resuelva mientras esté reservada, y el paquete SIGUE con el mensajero— se queda sin " +
      "forma de rescatarse, que es precisamente el agujero que esta ficha viene a cerrar",
  },
];

describe("0 — el censo de esta guardia no está vacío ni miente", () => {
  it("la familia tiene los OCHO miembros conocidos, y cada uno responde una de las TRES preguntas", () => {
    // Censo CERRADO. Si aparece una lista nueva de esta familia, hay que declararla aquí con su
    // decisión: eso es justo lo que no pasó con las dos que se rompieron.
    //
    // ⚠️ ERA SIETE hasta el 2026-08-22. La feature 262 añade
    // `ESTADOS_CON_DIA_DE_REPARTO_VIVO` con su TERCERA pregunta declarada: la lista pertenece a
    // esta familia pero no dice ni quién está ocupado ni a quién barre el corte.
    expect(FAMILIA).toHaveLength(8);
    for (const m of FAMILIA) {
      expect(
        ["que ocupa al mensajero", "a quien barre el corte", "donde vive el dia de reparto"],
        `${m.nombre}: pregunta desconocida`,
      ).toContain(m.pregunta);
    }
    // Y las tres preguntas tienen AL MENOS un miembro: una pregunta declarada y sin lista que la
    // responda sería una categoría vacía que da la impresión de estar vigilando algo.
    for (const pregunta of [
      "que ocupa al mensajero",
      "a quien barre el corte",
      "donde vive el dia de reparto",
    ]) {
      expect(
        FAMILIA.some((m) => m.pregunta === pregunta),
        `nadie responde «${pregunta}»`,
      ).toBe(true);
    }
  });

  it("lo extraído son ESTATUS REALES del catálogo, no texto cualquiera", () => {
    // Non-vacuidad fuerte: si una extracción devolviera basura (un nombre de variable, un trozo de
    // sintaxis), esto la caza antes de que ninguna decisión diga nada.
    const catalogo = ORDER_STATUS_SEED as readonly string[];
    for (const m of FAMILIA) {
      const lista = m.estatus();
      expect(lista.length, `${m.nombre}: lista vacía`).toBeGreaterThan(0);
      for (const valor of lista) {
        expect(catalogo, `${m.nombre}: \`${valor}\` no es un estatus del catálogo`).toContain(valor);
      }
    }
  });

  it("la extracción REVIENTA si el patrón deja de encontrarse (nunca «nada → verde»)", () => {
    expect(() => listaConstante("export const OTRA = [];", "falso.ts", "ESTADOS_PENDIENTES")).toThrow(
      /no se encontró `const ESTADOS_PENDIENTES/,
    );
    expect(() => listaConstante("const X = [];", "falso.ts", "X")).toThrow(/salió vacía/);
    expect(() => listaConstante("const X = [DESCONOCIDO];", "falso.ts", "X")).toThrow(
      /no se declara con un literal/,
    );
    expect(() => listaEnLlamada("const a = 1;", "falso.ts", "findMisAsignaciones")).toThrow(
      /no se encontró la llamada/,
    );
    expect(() =>
      listaEnLlamada("f(); findMisAsignaciones(id, estados);", "falso.ts", "findMisAsignaciones"),
    ).toThrow(/ya no recibe una lista literal/);
    expect(() => estatusResueltos("const a = 1;", "falso.ts")).toThrow(
      /no se encontró ningún `findEstatusIdByValue/,
    );
    expect(() => estatusResueltos("findEstatusIdByValue(DESCONOCIDO)", "falso.ts")).toThrow(
      /no se declara con un literal/,
    );
  });

  it("CONTRAPRUEBA: sobre un fuente MUTADO, el detector devuelve lo mutado", () => {
    // Lo que prueba que la extracción LEE el archivo en vez de repetir una respuesta fija.
    expect(
      listaConstante('const ESTADOS_PENDIENTES = ["a", "b"];', "falso.ts", "ESTADOS_PENDIENTES"),
    ).toEqual(["a", "b"]);
    expect(
      listaEnLlamada('repo.findMisAsignaciones(id, ["x", "y", "z"]);', "falso.ts", "findMisAsignaciones"),
    ).toEqual(["x", "y", "z"]);
    // Y la forma con CONSTANTES, que es como está escrito el portal del mensajero.
    expect(
      listaEnLlamada(
        'const A = "uno";\nconst B = "dos";\nrepo.findMisAsignaciones(id, [A, B]);',
        "falso.ts",
        "findMisAsignaciones",
      ),
    ).toEqual(["uno", "dos"]);
    expect(
      estatusResueltos('const A = "uno";\nawait r.findEstatusIdByValue(A);', "falso.ts"),
    ).toEqual(["uno"]);
  });
});

// =============================================================================================
// 235 — la decisión sobre `ayuda_tienda`, declarada miembro a miembro
// =============================================================================================

describe("235 — el estatus de ayuda OCUPA al mensajero, y las siete listas lo dicen", () => {
  it.each(FAMILIA.map((m) => [m.nombre, m] as const))(
    "%s incluye `ayuda_tienda`",
    (_nombre, miembro) => {
      const lista = miembro.estatus();
      expect(
        lista.includes(AYUDA),
        `${miembro.nombre} (${miembro.ruta}) NO nombra \`${AYUDA}\`.\n\n` +
          `Razón por la que debe: ${miembro.razon}.\n\n` +
          `Si de verdad la decisión es que NO ocupe, no basta con quitarlo de la lista: hay que ` +
          `cambiar \`incluyeAyuda\` en esta guardia y escribir aquí POR QUÉ, igual que se hizo con ` +
          `los cuatro mapas parciales de la 235 (exclude-por-rol, webhook, bodega satélite, ` +
          `tablero). Una ausencia sin razón escrita es un olvido, y esta guardia existe porque ` +
          `dos de estas siete listas se quedaron atrás en silencio.`,
      ).toBe(miembro.incluyeAyuda);
    },
  );

  it("`por_recoger` NO entra en el corte: el mensajero ni siquiera llegó a recogerla (109/R5)", () => {
    // El caso negativo de la familia «a quién barre el corte». Sin él, «incluye ayuda_tienda»
    // pasaría igual con una lista que trajera todo el catálogo.
    for (const m of FAMILIA.filter((x) => x.pregunta === "a quien barre el corte")) {
      expect(m.estatus(), `${m.nombre} no debe barrer \`por_recoger\``).not.toContain("por_recoger");
    }
    // Y en la otra mitad de la familia SÍ está: `por_recoger` ocupa al mensajero aunque no lo haya
    // recogido todavía —es trabajo suyo— pero no es trabajo que el corte deba dar por perdido.
    const ocupacion = FAMILIA.filter((x) => x.pregunta === "que ocupa al mensajero");
    expect(ocupacion.some((m) => m.estatus().includes("por_recoger"))).toBe(true);
  });

  it("ningún miembro barre un DESENLACE: lo cerrado no ocupa a nadie", () => {
    for (const m of FAMILIA) {
      for (const cerrado of ["entregada", "rechazada", "devuelta_a_tienda", "incidente"]) {
        expect(m.estatus(), `${m.nombre} no debe contar \`${cerrado}\``).not.toContain(cerrado);
      }
    }
  });
});

// =============================================================================================
// LOS GEMELOS — dos capas que dicen la misma verdad no pueden separarse
// =============================================================================================

describe("235 — los gemelos dicen lo mismo (es donde vivieron los dos agujeros)", () => {
  it("regla de dedicación: el SERVICIO y el MARCADOR del selector piden los mismos estatus", () => {
    // Si el marcador dice menos, el maestro elige a alguien a quien el servidor rechazará al
    // confirmar — el «toparse con un rechazo del servidor» que ese marcador existe para evitar.
    const servicio = listaConstante(
      leer(RUTA_GUIA_SERVICE),
      RUTA_GUIA_SERVICE,
      "ESTADOS_REPARTO_PENDIENTE",
    );
    const selector = listaEnLlamada(leer(RUTA_GUIA_ACTION), RUTA_GUIA_ACTION, "findMensajerosConOrdenesEn");
    expect([...selector].sort()).toEqual([...servicio].sort());
  });

  it("corte de la noche: la SELECCIÓN y lo que el service RESUELVE para escribir coinciden", () => {
    // Este es el cruce exacto del bloqueante: la escritura ya barría los dos estados y la
    // selección seguía mirando uno. El resultado fue un barrido correcto que no le llegaba a nadie.
    const seleccion = listaConstante(leer(RUTA_CORTE_REPO), RUTA_CORTE_REPO, "ESTADOS_A_BARRER");
    const resueltos = estatusResueltos(leer(RUTA_CORTE_SERVICE), RUTA_CORTE_SERVICE);
    // El service resuelve además el DESTINO (`sin_gestionar`), que no es un origen a barrer.
    const origenes = resueltos.filter((v) => v !== "sin_gestionar");
    expect([...origenes].sort()).toEqual([...seleccion].sort());
    // Y el destino sigue estando: sin él no hay a dónde mover nada.
    expect(resueltos).toContain("sin_gestionar");
  });

  it("el portal del mensajero y el bloqueo del cierre coinciden en lo que «está en su mano»", () => {
    // No tienen por qué ser iguales —el portal lista, el cierre bloquea— pero TODO lo que el
    // portal le muestra como suyo tiene que bloquearle el cierre: si no, podría cerrar el día con
    // órdenes visibles en su propia pantalla.
    const portal = listaEnLlamada(leer(RUTA_PORTAL), RUTA_PORTAL, "findMisAsignaciones");
    const bloqueo = listaConstante(
      leer(RUTA_CIERRE_SERVICE),
      RUTA_CIERRE_SERVICE,
      "ESTADOS_PENDIENTES",
    );
    for (const estatus of portal) {
      expect(bloqueo, `el portal muestra \`${estatus}\` pero el cierre no lo bloquea`).toContain(
        estatus,
      );
    }
  });
});
