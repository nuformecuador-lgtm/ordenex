import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import {
  avisoReservaParaOtroDia,
  fechaLegible,
  ETIQUETA_PARA_MANANA,
  RESERVA_MOTIVO_SERVIDOR,
} from "@/lib/utils/dia-reparto-textos";

// FEATURE 261 (F5, R11/R14/R15) — EL TEXTO DEL BLOQUEO POR RESERVA: SU CONTENIDO, SU RELOJ
// AUSENTE Y SU FUENTE ÚNICA.
//
// Tres cosas distintas, y ninguna la cubre otra:
//
//   (1) QUÉ DICE (R11). Con palabras, sin siglas y sin nombres de columna, y nombrando el DÍA
//       desde el que se podrá. Los literales van escritos A MANO, nunca comparados contra la
//       función que los produce: un test que compare un texto con su propia fuente está siempre
//       verde, y en este repo eso ya dejó pasar un tope que la app rechazaba.
//
//   (2) QUE NO HAY RELOJ (R14). El módulo no puede importar `Date` ni `Intl`: construir un
//       `Date` a partir de `YYYY-MM-DD` lo interpreta en la zona del NAVEGADOR, y un portátil con
//       la hora corrida diría un día que no es. La fecha llega ya resuelta desde el servidor.
//
//   (3) QUE LA FUENTE ES UNA (R15). Cinco superficies pintan esta frase —las tres cards del
//       mensajero, el rechazo del escáner, el botón del pie de «Reparto»— y el SERVIDOR la
//       devuelve en el motivo de sus rechazos, incluido el de la tienda. Si una la copiara en un
//       literal propio, divergirían a la primera corrección de estilo y la app diría dos cosas
//       sobre la misma regla. Ese caso es el que mata la mutación M-l.

/* -------------------------------------------------------------------------- */
/* (1) Lo que dice                                                             */
/* -------------------------------------------------------------------------- */

/** Escrito a mano, letra por letra. Es el contrato visible. */
const AVISO_CON_FECHA =
  "Esta orden es para el reparto del 22 de agosto. Ese día podrás recogerla y gestionarla.";
const AVISO_SIN_FECHA =
  "Esta orden es para un día de reparto posterior. Podrás recogerla y gestionarla ese día.";

describe("261/R11 — la frase que explica por qué la orden todavía no se puede trabajar", () => {
  it("con la fecha del servidor, dice el DÍA en palabras", () => {
    expect(avisoReservaParaOtroDia("2026-08-22")).toBe(AVISO_CON_FECHA);
  });

  it("sin fecha que mostrar, la frase SIGUE SIENDO CIERTA: sólo pierde precisión", () => {
    // `null` y `undefined` son el mismo caso: no hay día que nombrar. Que la frase sobreviva sin
    // él es lo que permite usarla en los rechazos del servidor que no llevan la fecha consigo.
    expect(avisoReservaParaOtroDia(null)).toBe(AVISO_SIN_FECHA);
    expect(avisoReservaParaOtroDia(undefined)).toBe(AVISO_SIN_FECHA);
  });

  it("NO dice «mañana»: un día de reparto puede estar a más de uno de distancia", () => {
    // El alcance del producto tope a «mañana» (246/D2), pero la columna es una fecha libre y un
    // `UPDATE` a mano puede dejar +2 — pasó en producción el 2026-08-21, en esta misma ficha. Si
    // el texto dijera «mañana», la app mentiría justo en el caso en que un humano tocó la fila.
    expect(avisoReservaParaOtroDia("2026-08-23")).toContain("23 de agosto");
    expect(avisoReservaParaOtroDia("2026-08-23")).not.toContain("mañana");
  });

  it("R11: sin siglas, sin jerga y sin nombres de columna, con fecha y sin ella", () => {
    // La misma regla con la que el repo retiró «SLA» del frontend. `YYYY-MM-DD` entra en la lista
    // porque una fecha cruda a la vista es tan jerga como el nombre de la columna.
    for (const frase of [avisoReservaParaOtroDia("2026-08-22"), RESERVA_MOTIVO_SERVIDOR]) {
      expect(frase).not.toMatch(/fecha_reparto|fechaReparto/);
      expect(frase).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(frase).not.toMatch(/\bSLA\b|\bCRON\b|\bcron\b|\bDTO\b/i);
      expect(frase).not.toMatch(/reserva|corte/i);
    }
  });

  it("R15: el motivo que devuelve el SERVIDOR es esta misma función sin fecha, no un segundo literal", () => {
    // Si fueran dos literales, el día que alguien corrigiera uno la pantalla y el servidor
    // dirían cosas distintas sobre el mismo rechazo — y nadie compara los dos a mano.
    expect(RESERVA_MOTIVO_SERVIDOR).toBe(AVISO_SIN_FECHA);
  });

  it("compone el día con `fechaLegible`, que ya existía y es puro", () => {
    // No se reescribió la conversión de mes: es la misma que ponen en palabras el selector y la
    // confirmación de la 246. Dos tablas de meses acabarían diciendo dos cosas.
    expect(avisoReservaParaOtroDia("2026-01-05")).toContain(fechaLegible("2026-01-05"));
    expect(fechaLegible("2026-01-05")).toBe("5 de enero");
  });

  it("lo que NO es una fecha calendario no se recorta a ciegas", () => {
    // Mismo criterio que `fecha-dia-iso`: partir algo que no es una fecha produce basura con
    // pinta de dato. Aquí la frase se compone igual, con lo que haya, en vez de inventar un día.
    expect(avisoReservaParaOtroDia("mañana")).toContain("mañana");
    expect(avisoReservaParaOtroDia("")).toBe(AVISO_SIN_FECHA);
  });

  it("246/R22: la etiqueta «Para mañana» NO se tocó — el badge y el aviso son cosas distintas", () => {
    // El badge dice QUÉ es la orden; el aviso dice por qué no se puede trabajar y desde cuándo.
    expect(ETIQUETA_PARA_MANANA).toBe("Para mañana");
  });
});

/* -------------------------------------------------------------------------- */
/* (2) R14 — aquí no entra ningún reloj                                        */
/* -------------------------------------------------------------------------- */

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const MODULO_TEXTOS = "lib/utils/dia-reparto-textos.ts";

function leer(rel: string): string {
  const ruta = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(ruta)) {
    throw new Error(
      `261/F5: falta el archivo censado \`${rel}\`. Este test se detiene en ROJO en vez de dar ` +
        `por buena una lectura vacía: si el código se reorganizó, actualiza el censo — no borres ` +
        `la comprobación.`,
    );
  }
  return fs.readFileSync(ruta, "utf8");
}

/**
 * El código SIN comentarios. Hace falta porque el propio módulo EXPLICA en su cabecera que no
 * importa `Date` ni `Intl`: un detector que mirase el archivo entero se pondría rojo por la
 * frase que documenta la regla, que es el peor falso positivo posible.
 */
export function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

describe("261/R14 — el módulo de textos no puede leer el reloj del navegador", () => {
  it("no nombra `Date`, `Intl` ni `toLocale*` en su CÓDIGO", () => {
    const codigo = soloCodigo(leer(MODULO_TEXTOS));

    // `new Date("2026-08-22")` lo interpreta en la zona del navegador; `Intl` necesita un `Date`
    // para empezar. Por eso los meses van en una tabla a mano: la conversión es una operación de
    // TEXTO y el resultado es el mismo en cualquier máquina.
    expect(codigo, "el módulo empezó a construir fechas: R14 se rompe por ahí").not.toMatch(
      /\bDate\b/,
    );
    expect(codigo).not.toMatch(/\bIntl\b/);
    expect(codigo).not.toMatch(/toLocale/);
  });

  it("autocomprobación: el detector caza el código y NO caza el comentario que lo documenta", () => {
    // Sin esto, el caso de arriba estaría verde por vacío en cuanto el stripper dejara de encajar.
    expect(soloCodigo("// aquí no se importa Date\nconst a = 1;")).not.toMatch(/\bDate\b/);
    expect(soloCodigo("/* ni Intl */\nconst a = 1;")).not.toMatch(/\bIntl\b/);
    expect(soloCodigo("const hoy = new Date();")).toMatch(/\bDate\b/);
    expect(soloCodigo("const m = new Intl.DateTimeFormat();")).toMatch(/\bIntl\b/);
    // Y no confunde un identificador que CONTIENE la palabra con la palabra.
    expect(soloCodigo("const fechaRepartoDateless = 1;")).not.toMatch(/\bDate\b/);
  });
});

/* -------------------------------------------------------------------------- */
/* (3) R15 — una sola fuente: quien pinta la frase la IMPORTA, no la copia      */
/* -------------------------------------------------------------------------- */

/**
 * Las superficies que muestran el aviso. No es una lista de conveniencia: son exactamente los
 * archivos donde la frase aparece delante de una persona, más el servicio de la tienda, que la
 * devuelve en su motivo (261/R32).
 */
const SUPERFICIES: readonly string[] = [
  "app/(app)/mis-asignaciones/_components/pos-card/PosOrderCard.tsx",
  "app/(app)/mis-asignaciones/_components/pos-card/PosOrderCardMosaico.tsx",
  "app/(app)/mis-asignaciones/_components/pos-card/PosOrderCardDetalle.tsx",
  "app/(app)/mis-asignaciones/_components/useRecogerPorGuia.ts",
  "app/(app)/mis-asignaciones/_components/RepartoModule.tsx",
  "lib/services/GestionDesdeAyudaService.ts",
];

/**
 * Trozos que SÓLO pueden vivir en el módulo de textos. Si aparecen en otro archivo es que
 * alguien devolvió el literal a la superficie, que es la mutación M-l.
 */
const TROZOS_DEL_AVISO: readonly string[] = [
  "es para el reparto del",
  "recogerla y gestionarla",
  "día de reparto posterior",
];

function trozosCopiados(fuente: string): string[] {
  return TROZOS_DEL_AVISO.filter((trozo) => fuente.includes(trozo));
}

describe("261/R15 — el aviso se importa; ninguna superficie lo escribe", () => {
  it("el detector NO es vacío: los tres trozos están, verbatim, en el módulo de textos", () => {
    // La mitad que se olvida. Sin ella, un rename del texto dejaría los `filter` de abajo
    // buscando cadenas que ya no existen y la guardia pasaría por estar mirando al vacío.
    expect(trozosCopiados(leer(MODULO_TEXTOS)).sort()).toEqual([...TROZOS_DEL_AVISO].sort());
  });

  for (const rel of SUPERFICIES) {
    it(`${rel} importa la frase de la fuente única y no la copia`, () => {
      const fuente = leer(rel);

      expect(
        fuente,
        `261/R15: ${rel} pinta el aviso de la reserva, así que tiene que sacarlo de ` +
          `\`lib/utils/dia-reparto-textos\`. Si lo escribe por su cuenta, el día que alguien ` +
          `corrija el texto esta pantalla dirá otra cosa que las demás.`,
      ).toContain("dia-reparto-textos");
      expect(fuente).toMatch(/avisoReservaParaOtroDia/);

      expect(
        trozosCopiados(fuente),
        `261/R15 (mutación M-l): ${rel} tiene el literal del aviso ESCRITO DENTRO. Una regla ` +
          `con dos redacciones son dos reglas: divergen a la primera corrección de estilo y ` +
          `nadie compara los dos textos a mano.`,
      ).toEqual([]);
    });
  }

  it("autocomprobación: el detector caza una copia y deja pasar una importación", () => {
    expect(trozosCopiados('const t = "Esta orden es para el reparto del 22 de agosto.";')).toEqual([
      "es para el reparto del",
    ]);
    expect(
      trozosCopiados('import { avisoReservaParaOtroDia } from "@/lib/utils/dia-reparto-textos";'),
    ).toEqual([]);
  });
});
