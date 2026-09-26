import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CATEGORIA_LABEL,
  DOCUMENTO_CAJA_NOMBRE,
  DUENO_LABEL,
  ORIGEN_LABEL,
  TIPO_EGRESO_MANUAL_LABEL,
} from "@/app/(app)/wallet/_components/wallet-labels";
import { EGRESO_NOMBRADO_LABEL } from "@/app/(app)/wallet/_components/composicion-detalle-labels";
import {
  CONCEPTOS_MANUALES,
  FRASE_DEL_EFECTO,
  GRUPO_CONCEPTO_LABEL,
} from "@/app/(app)/wallet/_components/wallet-conceptos-manuales";
import {
  CATEGORIA_TIENDA_LABEL,
  DESGLOSE_TIENDA_LABEL,
} from "@/app/(app)/wallet/tiendas/_components/desglose-tienda-labels";
import {
  CATEGORIA_MI_WALLET_LABEL,
  DESGLOSE_MI_WALLET_LABEL,
  ORIGEN_TIENDA_LABEL,
} from "@/app/(app)/mi-wallet/_components/mi-wallet-labels";
import { ACCION_LABELS, ENTIDAD_LABELS } from "@/lib/types/historial-accion";
import { ORIGEN_PAGO_LABEL } from "@/app/(app)/wallet/mensajeros/_components/wallet-mensajeros-labels";

// =================================================================================================
// GUARDIA — FICHA 461 (T C.6, design §7.8/§7.9/§14.3; R47/R48/R50) — LOS NOMBRES RETIRADOS NO VUELVEN
// Y LOS RESERVADOS NO SE TOMAN
// =================================================================================================
//
// HD3: todos los conceptos de la wallet se dicen desde Ordenex y diciendo quién le paga a quién. Los
// nombres que esa decisión sustituye quedan RETIRADOS (§7.9) y los del pago de la tienda a Ordenex
// quedan RESERVADOS para la 457 (§7.8). Esta guardia mira tres cosas:
//
//  1. Los DICCIONARIOS de la wallet y del historial: ningún valor es un nombre retirado ni uno
//     reservado, y ninguno contiene una frase retirada.
//  2. Los ARCHIVOS de `app/(app)/wallet/**`, `app/(app)/mi-wallet/**` y `lib/types/historial-accion*.ts`
//     (fuente CRUDO, comentarios incluidos, como la guardia `caja-textos-459`): ninguna frase retirada;
//     ningún nombre retirado o reservado como literal de cadena entero ni citado entre «».
//  3. Los documentos de `docs/ayuda/**`: ninguna frase retirada; ningún nombre retirado o reservado
//     citado entre «», **, comillas o backticks (la misma forma con la que la guardia de la 455 lee los
//     nombres de estado en la ayuda).
//
// Cada detector tiene su CONTRAPRUEBA (la fuente de antes de la ficha lo pone rojo) y un control de
// NO-VACUIDAD (número mínimo de archivos y de claves): una guardia que no se ha visto roja no prueba
// nada.
//
// ⏳ LO PENDIENTE, con el número exacto: el libro del mensajero (`wallet/mensajeros/**`) no es una
// superficie de esta ficha (R42–R44 nombran la caja, las tiendas y Mi wallet) y su origen «Manual»
// sigue ahí. Vive en `PENDIENTES` para que la guardia sirva desde hoy sin fingir verde: una aparición
// más es una infracción nueva; una menos deja la entrada caducada y la guardia pide retirarla (458).

const RAIZ = path.resolve(__dirname, "../../..");

/** design §7.9 — nombres completos retirados de un concepto, origen, grupo o acción. */
export const NOMBRES_RETIRADOS_461: readonly string[] = [
  "Cobrar un costo a una tienda",
  "Cobro de Ordenex",
  "Cobro de un costo",
  "Pago por cuenta de una tienda",
  "Pago por cuenta de la tienda",
  "Pago por cuenta anulado",
  "Pago por cuenta de tienda",
  "Gasto variable",
  "Saldo inicial o aporte de capital",
  "Saldo inicial o aporte",
  "Saldo inicial o aporte anulado",
  "Ajuste que suma dinero",
  "Ajuste que resta dinero",
  "Ajuste (ingreso)",
  "Ajuste (egreso)",
  "Ajuste (crédito)",
  "Ajuste (débito)",
  "Comisión COD",
  "COD recaudado",
  "Contra-entrega cobrado",
  "Pago a tienda",
  "Pago a mensajero",
  "Pago a la tienda",
  "Manual",
  "Gasto",
  "No mueve la caja",
  "Cobro reclasificado como pago por cuenta",
];

/**
 * design §7.8 de la 461 → TOMADOS por la 457 (design §2, R53): cada nombre reservado es el valor de
 * EXACTAMENTE la clave de este mapa y de ninguna otra. El quinto reservado («Pago a Ordenex anulado»)
 * quedó sin uso (D10 de la 457: `/mi-wallet` dice «Ordenex anuló el pago que le hiciste», que dice
 * QUIÉN anuló) y sale de la lista.
 */
export const NOMBRES_TOMADOS_457: ReadonlyArray<{
  nombre: string;
  diccionario: string;
  clave: string;
  /**
   * Frontend 457 (T6.3): las OTRAS posiciones que `design.md` §2 le asigna al mismo nombre, y solo
   * esas. «Una tienda le paga a Ordenex» es también el nombre del concepto en el diálogo (fila
   * «Diálogo: concepto», `CONCEPTOS_MANUALES[].label`, clave `abono_tienda`), igual que «Ordenex le
   * cobra a una tienda» es a la vez categoría de caja y concepto.
   */
  tambien?: readonly string[];
}> = [
  {
    nombre: "Una tienda le paga a Ordenex",
    diccionario: "CATEGORIA_LABEL",
    clave: "ingreso_abono_tienda",
    tambien: ["CONCEPTOS_MANUALES.label.abono_tienda"],
  },
  {
    nombre: "Pago de una tienda a Ordenex anulado",
    diccionario: "CATEGORIA_LABEL",
    clave: "egreso_reverso_abono_tienda",
  },
  { nombre: "La tienda le paga a Ordenex", diccionario: "CATEGORIA_TIENDA_LABEL", clave: "abono_tienda" },
  { nombre: "Le pagaste a Ordenex", diccionario: "CATEGORIA_MI_WALLET_LABEL", clave: "abono_tienda" },
];

/** Un reservado FICTICIO para las contrapruebas: ningún concepto de hoy lo toma. */
const RESERVADO_FICTICIO = "Nombre reservado para una ficha futura";

/** design §7.9 — las frases que afirmaban que el cobro no pasaba por la caja. */
export const FRASES_RETIRADAS_461: readonly string[] = [
  "bajan su saldo sin pasar por la caja",
  "no mueve la caja",
  "La caja y la ganancia no cambian",
];

const PROHIBIDOS = new Set<string>([...NOMBRES_RETIRADOS_461, RESERVADO_FICTICIO]);
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ALTERNATIVA = [...PROHIBIDOS].map(escapar).join("|");
/** En código: el nombre como literal de cadena ENTERO (`"X"` / `'X'`) o citado entre «». */
const EN_CODIGO = new RegExp(`(?:"(${ALTERNATIVA})"|'(${ALTERNATIVA})'|«(${ALTERNATIVA})»)`, "g");
/** En un documento: citado entre «», **, comillas o backticks. */
const EN_DOC = new RegExp(`(?:«|\\*\\*|"|“|\`)(${ALTERNATIVA})(?:»|\\*\\*|"|”|\`)`, "g");

/** ⏳ Lo que hoy sigue fuera del alcance de la ficha, archivo por archivo y con su número exacto. */
const PENDIENTES: Record<string, number> = {
  // Ficha 458-A (TA.2): el origen «Manual» del libro del mensajero —la unica entrada que habia— se
  // renombro «Registrado a mano» (461 §7.3) al volver total `ORIGEN_PAGO_LABEL`. Sin pendientes.
};

// ── Detectores (exportados para las contrapruebas) ─────────────────────────────────────────────

/** Los valores de un diccionario que son un nombre prohibido o contienen una frase retirada. */
export function hallazgosEnDiccionario(nombre: string, valores: readonly string[]): string[] {
  const out: string[] = [];
  for (const v of valores) {
    if (PROHIBIDOS.has(v)) out.push(`${nombre}: «${v}» es un nombre retirado o reservado`);
    for (const f of FRASES_RETIRADAS_461) {
      if (v.toLowerCase().includes(f.toLowerCase())) out.push(`${nombre}: «${v}» contiene «${f}»`);
    }
  }
  return out;
}

/** Frases retiradas y nombres prohibidos (literal entero o entre «») en un archivo de código. */
export function hallazgosEnCodigo(fuente: string, archivo = "fuente.ts"): string[] {
  const out: string[] = [];
  for (const f of FRASES_RETIRADAS_461) {
    if (fuente.toLowerCase().includes(f.toLowerCase())) out.push(`${archivo}: frase «${f}»`);
  }
  for (const m of fuente.matchAll(EN_CODIGO)) {
    out.push(`${archivo}: nombre «${m[1] ?? m[2] ?? m[3]}»`);
  }
  return out;
}

/** Frases retiradas y nombres prohibidos citados en un documento de ayuda. */
export function hallazgosEnDocumento(texto: string, archivo = "doc.md"): string[] {
  const out: string[] = [];
  for (const f of FRASES_RETIRADAS_461) {
    if (texto.toLowerCase().includes(f.toLowerCase())) out.push(`${archivo}: frase «${f}»`);
  }
  for (const m of texto.matchAll(EN_DOC)) out.push(`${archivo}: nombre «${m[1]}»`);
  return out;
}

function listar(dir: string, patron: RegExp, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const c = path.join(dir, e);
    if (statSync(c).isDirectory()) listar(c, patron, acc);
    else if (patron.test(e)) acc.push(c);
  }
  return acc;
}

const rel = (f: string) => path.relative(RAIZ, f).split(path.sep).join("/");

/**
 * Ficha 458 (TA.6, R97): las carpetas compartidas que nacen en 458-C/458-D. Hoy pueden no existir o
 * estar vacias: el control de no-vacuidad de ESTAS es «≥ 0 archivos hoy» y la guardia falla en
 * cuanto aparezca un nombre retirado en cualquiera de ellas (contraprueba abajo).
 */
export const CARPETAS_COMPARTIDAS_458 = [
  path.join("components", "shared", "estado-cuenta"),
  path.join("components", "shared", "wallet"),
] as const;

function archivosCompartidos458(): string[] {
  return CARPETAS_COMPARTIDAS_458.map((c) => path.join(RAIZ, c))
    .filter((c) => existsSync(c))
    .flatMap((c) => listar(c, /\.tsx?$/));
}

function archivosDeCodigo(): string[] {
  return [
    ...listar(path.join(RAIZ, "app", "(app)", "wallet"), /\.tsx?$/),
    ...listar(path.join(RAIZ, "app", "(app)", "mi-wallet"), /\.tsx?$/),
    ...archivosCompartidos458(),
    ...listar(path.join(RAIZ, "lib", "types"), /^historial-accion.*\.ts$/),
    // Revision 458-A (m2): los rotulos que lee el servidor se mudaron a `lib/constants/`.
    ...listar(path.join(RAIZ, "lib", "constants"), /^(wallet-rotulos|origen-legible-rotulos)\.ts$/),
  ];
}

function documentosDeAyuda(): string[] {
  return listar(path.join(RAIZ, "docs", "ayuda"), /\.md$/);
}

// ── 1. Los diccionarios ──────────────────────────────────────────────────────────────────────────

const DICCIONARIOS: ReadonlyArray<readonly [nombre: string, valores: readonly string[]]> = [
  ["CATEGORIA_LABEL", Object.values(CATEGORIA_LABEL)],
  ["ORIGEN_LABEL", Object.values(ORIGEN_LABEL)],
  ["DUENO_LABEL", Object.values(DUENO_LABEL)],
  ["TIPO_EGRESO_MANUAL_LABEL", Object.values(TIPO_EGRESO_MANUAL_LABEL)],
  ["DOCUMENTO_CAJA_NOMBRE", Object.values(DOCUMENTO_CAJA_NOMBRE)],
  ["EGRESO_NOMBRADO_LABEL", Object.values(EGRESO_NOMBRADO_LABEL)],
  ["CONCEPTOS_MANUALES.label", CONCEPTOS_MANUALES.map((c) => c.label)],
  ["GRUPO_CONCEPTO_LABEL", Object.values(GRUPO_CONCEPTO_LABEL)],
  ["FRASE_DEL_EFECTO", Object.values(FRASE_DEL_EFECTO)],
  ["CATEGORIA_TIENDA_LABEL", Object.values(CATEGORIA_TIENDA_LABEL)],
  ["DESGLOSE_TIENDA_LABEL", Object.values(DESGLOSE_TIENDA_LABEL)],
  ["CATEGORIA_MI_WALLET_LABEL", Object.values(CATEGORIA_MI_WALLET_LABEL)],
  ["DESGLOSE_MI_WALLET_LABEL", Object.values(DESGLOSE_MI_WALLET_LABEL)],
  ["ORIGEN_TIENDA_LABEL", Object.values(ORIGEN_TIENDA_LABEL)],
  // Ficha 458-A (TA.2): total desde la 458-A y ya sin «Manual»; entra en el barrido de diccionarios.
  ["ORIGEN_PAGO_LABEL", Object.values(ORIGEN_PAGO_LABEL)],
  ["ACCION_LABELS", Object.values(ACCION_LABELS)],
  ["ENTIDAD_LABELS", Object.values(ENTIDAD_LABELS)],
];

describe("461/R47/R48 — ningún diccionario de la wallet ni del historial usa un nombre retirado o reservado", () => {
  it("el barrido mira algo: diecisiete diccionarios y más de 150 valores", () => {
    // Ficha 458-A: 16 → 17 (+ `ORIGEN_PAGO_LABEL`).
    expect(DICCIONARIOS).toHaveLength(17);
    const total = DICCIONARIOS.reduce((n, [, v]) => n + v.length, 0);
    expect(total).toBeGreaterThan(150);
  });

  it.each(DICCIONARIOS)("%s: sin nombres retirados, sin reservados y sin frases retiradas", (nombre, valores) => {
    expect(hallazgosEnDiccionario(nombre, valores)).toEqual([]);
  });

  it("CONTRAPRUEBA: los diccionarios de la 459 la ponen roja (mutación 11 de design §14.2)", () => {
    expect(
      hallazgosEnDiccionario("CATEGORIA_LABEL (459)", ["Flete", "Pago por cuenta de una tienda", "Gasto variable"]),
    ).toEqual([
      "CATEGORIA_LABEL (459): «Pago por cuenta de una tienda» es un nombre retirado o reservado",
      "CATEGORIA_LABEL (459): «Gasto variable» es un nombre retirado o reservado",
    ]);
    expect(hallazgosEnDiccionario("ORIGEN_LABEL (459)", ["Manual", "Gasto", "Cierre del día"])).toHaveLength(2);
    expect(hallazgosEnDiccionario("DUENO_LABEL (mutado)", ["Ordenex", "Cobro de Ordenex"])).toHaveLength(1);
    // Un nombre reservado para una ficha futura tampoco puede colarse en ningún concepto de hoy (R48).
    expect(hallazgosEnDiccionario("CATEGORIA_LABEL (mutado)", [RESERVADO_FICTICIO])).toHaveLength(1);
    // La frase de la 459 dentro de una frase de efecto (mutación 13).
    expect(
      hallazgosEnDiccionario("FRASE_DEL_EFECTO (459)", [
        "No sale ni entra dinero: es un cobro de Ordenex a la tienda que baja su saldo. La caja y la ganancia no cambian.",
      ]),
    ).toHaveLength(1);
  });
});

// ── 1b. Ficha 457 (R53): los reservados, TOMADOS ─────────────────────────────────────────────────

const DICCIONARIOS_POR_NOMBRE: Record<string, Record<string, string>> = {
  CATEGORIA_LABEL,
  CATEGORIA_TIENDA_LABEL,
  CATEGORIA_MI_WALLET_LABEL,
  // Frontend 457: el catálogo del diálogo, por id de concepto (para decir QUÉ concepto lo dice).
  "CONCEPTOS_MANUALES.label": Object.fromEntries(CONCEPTOS_MANUALES.map((c) => [c.id, c.label])),
};

/** Las claves de TODOS los diccionarios de la wallet y del historial cuyo valor es `nombre`. */
function quienesDicen(nombre: string): string[] {
  return DICCIONARIOS.flatMap(([dic, valores]) => {
    const fuente = DICCIONARIOS_POR_NOMBRE[dic];
    if (fuente !== undefined) {
      return Object.entries(fuente)
        .filter(([, v]) => v === nombre)
        .map(([k]) => `${dic}.${k}`);
    }
    return valores.filter((v) => v === nombre).map(() => `${dic}.?`);
  });
}

describe("457/R53 — los nombres que la 461 reservó quedan tomados EXACTAMENTE por sus conceptos", () => {
  it("el barrido mira algo: cuatro nombres tomados, en tres diccionarios distintos", () => {
    expect(NOMBRES_TOMADOS_457).toHaveLength(4);
    expect(new Set(NOMBRES_TOMADOS_457.map((t) => t.diccionario)).size).toBe(3);
  });

  it.each(NOMBRES_TOMADOS_457)("«$nombre» es el valor de $diccionario.$clave y de ninguna otra clave", (t) => {
    expect(DICCIONARIOS_POR_NOMBRE[t.diccionario][t.clave]).toBe(t.nombre);
    expect(quienesDicen(t.nombre).sort()).toEqual([`${t.diccionario}.${t.clave}`, ...(t.tambien ?? [])].sort());
  });

  it("⭑ frontend 457: el concepto del diálogo que dice «Una tienda le paga a Ordenex» es EXACTAMENTE el `abono_tienda`", () => {
    expect(DICCIONARIOS_POR_NOMBRE["CONCEPTOS_MANUALES.label"].abono_tienda).toBe("Una tienda le paga a Ordenex");
    // Los otros tres tomados NO son nombre de ningún concepto del diálogo.
    for (const t of NOMBRES_TOMADOS_457.filter((x) => x.tambien === undefined)) {
      expect(quienesDicen(t.nombre).filter((q) => q.startsWith("CONCEPTOS_MANUALES")), t.nombre).toEqual([]);
    }
  });

  it("el quinto reservado («Pago a Ordenex anulado») quedó sin uso: nadie lo dice (D10 de la 457)", () => {
    expect(quienesDicen("Pago a Ordenex anulado")).toEqual([]);
  });

  it("CONTRAPRUEBA: un tomado puesto ADEMÁS en otra clave se detecta (dos claves lo dirían)", () => {
    const mutado = { ...CATEGORIA_TIENDA_LABEL, cobro_manual: "La tienda le paga a Ordenex" };
    const claves = Object.entries(mutado)
      .filter(([, v]) => v === "La tienda le paga a Ordenex")
      .map(([k]) => k)
      .sort();
    expect(claves).toEqual(["abono_tienda", "cobro_manual"]);
    expect(claves).not.toEqual(["abono_tienda"]);
  });
});

// ── 2. Los archivos de las superficies ──────────────────────────────────────────────────────────

describe("461/R47/R48 — los archivos de la wallet y del historial no citan un nombre retirado ni una frase retirada", () => {
  const archivos = archivosDeCodigo();

  it("el barrido mira algo: más de 60 archivos, entre ellos los cuatro diccionarios", () => {
    expect(archivos.length).toBeGreaterThan(60);
    for (const esperado of [
      "app/(app)/wallet/_components/wallet-labels.ts",
      "app/(app)/wallet/_components/wallet-conceptos-manuales.ts",
      "app/(app)/wallet/tiendas/_components/desglose-tienda-labels.ts",
      "app/(app)/mi-wallet/_components/mi-wallet-labels.ts",
      "lib/types/historial-accion.ts",
      "lib/constants/wallet-rotulos.ts",
      "lib/constants/origen-legible-rotulos.ts",
    ]) {
      expect(archivos.map(rel)).toContain(esperado);
    }
  });

  it("458-A R97: las carpetas compartidas de la 458 entran en el barrido (≥ 0 archivos hoy)", () => {
    expect(CARPETAS_COMPARTIDAS_458.map((c) => c.split(path.sep).join("/"))).toEqual([
      "components/shared/estado-cuenta",
      "components/shared/wallet",
    ]);
    const compartidos = archivosCompartidos458().map(rel);
    expect(compartidos.length).toBeGreaterThanOrEqual(0);
    for (const f of compartidos) expect(archivos.map(rel)).toContain(f);
  });

  it("458-A R97 CONTRAPRUEBA: un archivo nuevo de esas carpetas con un nombre retirado la pone roja", () => {
    const falso = `export const X = { a: "Manual" };`;
    expect(hallazgosEnCodigo(falso, "components/shared/wallet/Nuevo.tsx").length).toBeGreaterThan(0);
  });

  it("ninguno, salvo lo declarado como pendiente con su número exacto", () => {
    const censo = new Map<string, string[]>();
    for (const f of archivos) {
      const h = hallazgosEnCodigo(readFileSync(f, "utf8"), rel(f));
      if (h.length > 0) censo.set(rel(f), h);
    }
    const inesperados = [...censo.entries()]
      .filter(([archivo, h]) => PENDIENTES[archivo] !== h.length)
      .flatMap(([, h]) => h);
    expect(inesperados).toEqual([]);
    // Y lo pendiente sigue exactamente como se declaró: si alguien lo arregla, esta entrada caduca.
    for (const [archivo, n] of Object.entries(PENDIENTES)) {
      expect(censo.get(archivo)?.length, `${archivo}: la entrada pendiente caducó o cambió`).toBe(n);
    }
  });

  it("CONTRAPRUEBA: la fuente de la 459 la pone roja", () => {
    const conceptosDe459 = `
export const GRUPO_CONCEPTO_LABEL = { sale: "Sale dinero de la caja", entra: "Entra dinero a la caja", no_mueve: "No mueve la caja" };
export const FRASE_DEL_EFECTO = {
  cobro_tienda: "No sale ni entra dinero: es un cobro de Ordenex a la tienda que baja su saldo. La caja y la ganancia no cambian.",
};
const label = "Cobrar un costo a una tienda"; // «Cobro de Ordenex» es el rótulo de la tienda
`;
    const h = hallazgosEnCodigo(conceptosDe459, "conceptos-459.ts");
    expect(h).toContain("conceptos-459.ts: frase «no mueve la caja»");
    expect(h).toContain("conceptos-459.ts: frase «La caja y la ganancia no cambian»");
    expect(h).toContain("conceptos-459.ts: nombre «No mueve la caja»");
    expect(h).toContain("conceptos-459.ts: nombre «Cobrar un costo a una tienda»");
    expect(h).toContain("conceptos-459.ts: nombre «Cobro de Ordenex»");
    expect(hallazgosEnCodigo(`manual: "Manual", gasto: "Gasto",`)).toHaveLength(2);
    expect(hallazgosEnCodigo(`x: "${RESERVADO_FICTICIO}"`)).toHaveLength(1);
  });

  it("y NO ladra ante los nombres nuevos ni ante la prosa que los rodea", () => {
    const sano = `
export const CATEGORIA_LABEL = { ingreso_cobro_tienda: "Ordenex le cobra a una tienda", manual: "Registrado a mano", gasto: "Gasto o sueldo registrado a mano" };
// el cobro de un costo de la 381 pasó a ser el cobro de Ordenex a una tienda; un gasto variable es un gasto de Ordenex
const pista = "Fletes, comisión, IVA y lo que Ordenex te cobró";
`;
    expect(hallazgosEnCodigo(sano)).toEqual([]);
  });
});

// ── 3. La ayuda ─────────────────────────────────────────────────────────────────────────────────

describe("461/R47/R56 — la ayuda no cita ningún nombre retirado ni afirma que el cobro no pasa por la caja", () => {
  const documentos = documentosDeAyuda();

  it("el barrido mira algo: más de 30 documentos, entre ellos los tres de la wallet", () => {
    expect(documentos.length).toBeGreaterThan(30);
    for (const esperado of [
      "docs/ayuda/oficina/wallet-caja.md",
      "docs/ayuda/oficina/wallet-tiendas.md",
      "docs/ayuda/tienda/mi-wallet.md",
    ]) {
      expect(documentos.map(rel)).toContain(esperado);
    }
  });

  it("ningún documento cita un nombre retirado o reservado ni contiene una frase retirada", () => {
    const hallazgos = documentos.flatMap((f) => hallazgosEnDocumento(readFileSync(f, "utf8"), rel(f)));
    expect(hallazgos).toEqual([]);
  });

  it("CONTRAPRUEBA: la ayuda de la 459 la pone roja", () => {
    const de459 = [
      "| **Pago por cuenta de la tienda** | Ordenex le pagó a un tercero | **Sí** |",
      "| **Cobro de Ordenex** | Un cargo de Ordenex a la tienda | **No** |",
      "Los **cobros de un costo a una tienda** bajan el saldo de la tienda **sin pasar por la caja**.",
      "| **No mueve la caja** | Cobrar un costo a una tienda |",
    ].join("\n");
    const h = hallazgosEnDocumento(de459);
    expect(h).toContain("doc.md: nombre «Pago por cuenta de la tienda»");
    expect(h).toContain("doc.md: nombre «Cobro de Ordenex»");
    expect(h).toContain("doc.md: nombre «No mueve la caja»");
    expect(h).toContain("doc.md: frase «no mueve la caja»");
    // La frase de «sin pasar por la caja» se caza aunque el documento la partiera con negritas: se
    // afirma sobre la forma que tenía en `wallet-caja.md` de la 459.
    expect(hallazgosEnDocumento("Los cobros de un costo a una tienda bajan su saldo sin pasar por la caja.")).toEqual([
      "doc.md: frase «bajan su saldo sin pasar por la caja»",
    ]);
    expect(hallazgosEnDocumento(`Lo ves como «${RESERVADO_FICTICIO}».`)).toHaveLength(1);
  });

  it("y NO ladra ante los nombres nuevos", () => {
    expect(
      hallazgosEnDocumento(
        "| **Ordenex le cobra a la tienda** | **Ordenex te cobró** | «Ordenex paga un gasto de una tienda» | `Registrado a mano` |",
      ),
    ).toEqual([]);
  });
});
