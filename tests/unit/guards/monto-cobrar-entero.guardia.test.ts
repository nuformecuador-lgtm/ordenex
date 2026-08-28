// FEATURE 299 — GUARDIA: «un monto con centimos no puede volver a entrar por ninguna puerta».
//
// QUE PASO Y POR QUE HACE FALTA UNA GUARDIA Y NO SOLO UN ARREGLO
// --------------------------------------------------------------
// El desglose de pago de la entrega SOLO admite enteros: `components/shared/DesglosePagoField`
// filtra el input a digitos a proposito, y el guard de la gestion exige que el desglose sume
// EXACTAMENTE el monto. La carga, en cambio, aceptaba cualquier `Number(value)` finito >= 0.
// Resultado medido el 2026-08-27: una orden con `11898.81` no se podia entregar NUNCA —la
// pantalla decia «Diferencia 0» y a la vez que no cuadraba— y hubo que redondear 14 ordenes A
// MANO en la base para desbloquear a los mensajeros.
//
// El arreglo (redondear al entrar, en `filaCargaSchema`) cierra las dos vias de alta de hoy
// porque las dos comparten ese schema. Esta guardia existe para el MAÑANA: que aparezca una
// tercera puerta —otro schema, otro servicio que construya un `CreateOrdenData`, un camino de
// edicion del monto— y se cuele un decimal sin que nadie lo note, porque el sintoma no aparece
// en la carga sino semanas despues, en la mano de un mensajero que no puede cerrar la entrega.
//
// LOS CUATRO DIENTES
// ------------------
//  1. CENSO DE PUERTAS: todo schema zod del arbol que declare `monto_cobrar` esta en la lista
//     de abajo, marcado como «normaliza» o exceptuado CON MOTIVO. Una puerta nueva lo rompe.
//  2. EN EJECUCION: cada puerta marcada «normaliza» se PARSEA aqui con montos de verdad y
//     tiene que emitir un entero (o `null`). No es un barrido de texto: es comportamiento.
//  3. CENSO DE CONSTRUCTORES: quien arma el payload de creacion de una orden (`CreateOrdenData`
//     con su `montoCobrar`) esta en la lista. Un servicio nuevo que persista ordenes por su
//     cuenta cae aqui aunque no traiga schema propio.
//  4. NO HAY CAMINO DE EDICION: `UpdateOrdenData` no declara `montoCobrar`, asi que la columna
//     no se puede reescribir despues del alta; si alguien abre esa puerta, este diente lo dice.
//
// LO QUE ESTA GUARDIA NO CUBRE, declarado y no tapado:
//  - un `UPDATE` en SQL crudo sobre `orden.monto_cobrar` (no hay ninguno hoy; el barrido de
//    dientes 3/4 mira TypeScript, no cadenas SQL);
//  - la base no tiene un `CHECK (monto_cobrar = trunc(monto_cobrar))`. Seria la unica defensa
//    verdaderamente universal —cubre incluso lo que se escriba a mano en la base, que es
//    justamente como se desbloquearon las 14 ordenes— pero exige una migracion y esta ficha se
//    implemento con la orden explicita de no tocar la base. Queda como la vuelta pendiente.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { filaCargaSchema } from "@/lib/types/carga-masiva";

const RAIZ = path.resolve(__dirname, "..", "..", "..");

/** Este archivo queda fuera de los censos: un guardia nombra por fuerza lo que persigue. */
const ESTE_GUARDIA = "tests/unit/guards/monto-cobrar-entero.guardia.test.ts";

function recorrer(dir: string): string[] {
  return readdirSync(dir).flatMap((entrada) => {
    const completo = path.join(dir, entrada);
    if (statSync(completo).isDirectory()) return recorrer(completo);
    return [".ts", ".tsx"].includes(path.extname(completo)) ? [completo] : [];
  });
}

function relativa(absoluta: string): string {
  return path.relative(RAIZ, absoluta).split(path.sep).join("/");
}

/** Los arboles de codigo de servidor donde puede nacer una orden. */
const ARBOLES = ["lib", "app"];

function fuentes(): { ruta: string; codigo: string }[] {
  return ARBOLES.flatMap((dir) => recorrer(path.join(RAIZ, dir))).map((absoluta) => ({
    ruta: relativa(absoluta),
    codigo: readFileSync(absoluta, "utf8"),
  }));
}

/* -------------------------------------------------------------------------- */
/* Diente 1 + 2 — el censo de PUERTAS y su comprobacion en ejecucion           */
/* -------------------------------------------------------------------------- */

/**
 * Una clave `monto_cobrar` declarada dentro de un schema zod. El `z` puede quedarse solo al
 * final de la linea (`monto_cobrar: z` y la cadena de `.string().trim()...` debajo), que es
 * como lo escriben las dos puertas de hoy: por eso `z\b` y no `z\.`.
 */
const CLAVE_EN_SCHEMA_ZOD = /^[ \t]*monto_cobrar\s*:\s*z\b/m;

interface Puerta {
  ruta: string;
  /**
   * Que hace esa puerta con el monto. `null` = no normaliza, y entonces `porque` tiene que
   * explicar por que no hace falta (spoiler: porque no da de alta nada).
   */
  normaliza: ((monto: string) => number | null) | null;
  porque: string;
}

const PUERTAS: readonly Puerta[] = [
  {
    ruta: "lib/types/carga-masiva.ts",
    // `filaCargaSchema` es la puerta de alta COMPARTIDA por las dos vias: `cargarMasiva`
    // (pantalla) y `cargarViaApi` (canal por API key, feature 88). Normalizar aqui las cierra
    // a las dos con un solo redondeo.
    normaliza: (monto) =>
      filaCargaSchema.parse({
        num_remision: "REM-1",
        destinatario: "Ana",
        telefono: "88887777",
        producto: "Caja",
        provincia: "Cartago",
        canton_distrito: "Cartago (Occidental)",
        direccion: "Frente a X",
        notas: "",
        monto_cobrar: monto,
      }).monto_cobrar,
    porque: "puerta de alta de las DOS vias (carga masiva por pantalla y canal por API key)",
  },
  {
    ruta: "lib/types/cotizacion.ts",
    normaliza: null,
    porque:
      "COTIZAR NO DA DE ALTA NADA (feature 255, lectura pura: ni orden, ni lote, ni historial). " +
      "Ademas su monto viaja como STRING de punta a punta a proposito —es la base de la " +
      "comision COD y `derivarIngresoOrden` lo mete tal cual en un `Prisma.Decimal`—, asi que " +
      "redondearlo aqui cambiaria un precio publicado sin crear ninguna orden. La diferencia " +
      "que eso deja (el precio se cotiza sobre el monto exacto y se cobra sobre el redondeado) " +
      "esta declarada en el informe de la ficha 299 y es de centimos sobre la comision.",
  },
];

/** Montos de prueba: los bordes que importan y una tanda ancha de decimales. */
function montosDePrueba(): string[] {
  const fijos = ["11898.81", "11898.5", "11898.49", "0.5", "0.49", "0", "11899", ""];
  const barridos: string[] = [];
  for (let entero = 0; entero < 40; entero++) {
    for (let centimos = 0; centimos < 100; centimos += 7) {
      barridos.push(`${entero}.${String(centimos).padStart(2, "0")}`);
    }
  }
  return [...fijos, ...barridos];
}

describe("guardia 299 · diente 1 — el censo de puertas de alta esta completo", () => {
  it("todo schema zod que declare `monto_cobrar` esta censado", () => {
    const censadas = new Set(PUERTAS.map((p) => p.ruta));
    const halladas = fuentes()
      .filter(({ ruta, codigo }) => ruta !== ESTE_GUARDIA && CLAVE_EN_SCHEMA_ZOD.test(codigo))
      .map(({ ruta }) => ruta)
      .filter((ruta) => !censadas.has(ruta));
    expect(
      halladas,
      "un schema nuevo acepta `monto_cobrar` y nadie ha dicho si redondea; si es una puerta de alta, tiene que redondear",
    ).toEqual([]);
  });

  it("el censo no se pudre: cada puerta existe y sigue declarando `monto_cobrar`", () => {
    for (const puerta of PUERTAS) {
      const codigo = readFileSync(path.join(RAIZ, puerta.ruta), "utf8");
      expect(CLAVE_EN_SCHEMA_ZOD.test(codigo), `${puerta.ruta} ya no declara monto_cobrar`).toBe(
        true,
      );
      expect(puerta.porque.length, `${puerta.ruta} sin motivo`).toBeGreaterThan(20);
    }
  });
});

describe("guardia 299 · diente 2 — la puerta que dice redondear, redondea (en ejecucion)", () => {
  const queNormalizan = PUERTAS.filter((p) => p.normaliza !== null);

  it("hay al menos una puerta normalizadora que medir", () => {
    // Sin esto, borrar el `normaliza` de la unica entrada dejaria el `it.each` de abajo sin
    // casos y el diente pasaria sin comprobar nada.
    expect(queNormalizan.length).toBeGreaterThan(0);
  });

  it.each(queNormalizan.map((p) => [p.ruta, p] as const))(
    "%s: NINGUN monto aceptado sale con decimales",
    (_ruta, puerta) => {
      const normaliza = puerta.normaliza;
      if (normaliza === null) throw new Error("filtrado arriba");
      const conCola: string[] = [];
      for (const monto of montosDePrueba()) {
        const salida = normaliza(monto);
        if (salida !== null && !Number.isInteger(salida)) conCola.push(`${monto} -> ${salida}`);
      }
      expect(conCola, "un monto con centimos cruzo la puerta de alta").toEqual([]);
    },
  );

  it("y el caso real de la captura sale con el numero exacto que el humano redondeo a mano", () => {
    const normaliza = queNormalizan[0].normaliza;
    if (normaliza === null) throw new Error("filtrado arriba");
    expect(normaliza("11898.81")).toBe(11899);
  });
});

/* -------------------------------------------------------------------------- */
/* Diente 3 — el censo de CONSTRUCTORES del payload de creacion               */
/* -------------------------------------------------------------------------- */

/** Quien nombra el payload de creacion de una orden Y escribe su `montoCobrar`. */
const NOMBRA_PAYLOAD = /\bCreateOrdenData\b/;
const ESCRIBE_MONTO = /\bmontoCobrar\??\s*:/;

const CONSTRUCTORES: readonly { ruta: string; porque: string }[] = [
  {
    ruta: "lib/interfaces/repositories/IOrdenRepository.ts",
    porque: "declara el tipo `CreateOrdenData`; no construye ninguno",
  },
  {
    ruta: "lib/repositories/OrdenRepository.ts",
    porque:
      "la ULTIMA MILLA: `toCreateManyInput` mete el `number` en un `Prisma.Decimal`. No decide " +
      "el valor, lo copia — por eso el redondeo vive en la puerta y no aqui",
  },
  {
    ruta: "lib/services/BulkOrdenService.ts",
    porque:
      "las dos vias de alta. El `montoCobrar` que escribe sale de `filaCargaSchema`, que ya lo " +
      "redondeo; el servicio ademas transporta el aviso a la fila del resumen",
  },
];

describe("guardia 299 · diente 3 — nadie mas construye el payload de creacion", () => {
  it("todo fuente que arma un `CreateOrdenData` con monto esta censado", () => {
    const censados = new Set(CONSTRUCTORES.map((c) => c.ruta));
    const halladas = fuentes()
      .filter(
        ({ ruta, codigo }) =>
          ruta !== ESTE_GUARDIA && NOMBRA_PAYLOAD.test(codigo) && ESCRIBE_MONTO.test(codigo),
      )
      .map(({ ruta }) => ruta)
      .filter((ruta) => !censados.has(ruta));
    expect(
      halladas,
      "alguien nuevo da de alta ordenes con monto: comproba que el valor venga ya redondeado de una puerta censada",
    ).toEqual([]);
  });

  it("el censo no se pudre: cada constructor existe y sigue cumpliendo las dos condiciones", () => {
    for (const constructor of CONSTRUCTORES) {
      const codigo = readFileSync(path.join(RAIZ, constructor.ruta), "utf8");
      expect(NOMBRA_PAYLOAD.test(codigo), `${constructor.ruta} ya no nombra CreateOrdenData`).toBe(
        true,
      );
      expect(ESCRIBE_MONTO.test(codigo), `${constructor.ruta} ya no escribe montoCobrar`).toBe(
        true,
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Diente 4 — la columna no se puede reescribir despues del alta              */
/* -------------------------------------------------------------------------- */

describe("guardia 299 · diente 4 — no hay camino de EDICION del monto", () => {
  it("`UpdateOrdenData` no declara `montoCobrar`", () => {
    // Si mañana se abre la edicion del monto, esa puerta tambien tiene que redondear: sin este
    // diente entraria por un camino que ningun schema de alta vigila.
    const codigo = readFileSync(
      path.join(RAIZ, "lib/interfaces/repositories/IOrdenRepository.ts"),
      "utf8",
    );
    const bloque = /export interface UpdateOrdenData \{([\s\S]*?)\n\}/.exec(codigo);
    expect(bloque, "no se encontro `UpdateOrdenData` (¿se renombro?)").not.toBeNull();
    expect(ESCRIBE_MONTO.test(bloque?.[1] ?? "")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Autocomprobacion del barrido                                               */
/* -------------------------------------------------------------------------- */

describe("guardia 299 · el barrido mira algo", () => {
  it("los dos arboles existen y aportan cientos de fuentes", () => {
    // Sin esto, un `recorrer` roto dejaria los dientes 1 y 3 en verde por no mirar nada.
    for (const dir of ARBOLES) {
      expect(recorrer(path.join(RAIZ, dir)).length, `el arbol \`${dir}\` no aporta nada`)
        .toBeGreaterThan(50);
    }
  });

  it("el barrido SI encuentra las puertas y los constructores censados", () => {
    // La otra mitad de la autocomprobacion: que el filtro no sea tan estrecho que no case ni
    // con lo que sabemos que esta ahi.
    const rutas = new Set(fuentes().map((f) => f.ruta));
    for (const puerta of PUERTAS) expect(rutas.has(puerta.ruta), puerta.ruta).toBe(true);
    for (const c of CONSTRUCTORES) expect(rutas.has(c.ruta), c.ruta).toBe(true);
  });
});
