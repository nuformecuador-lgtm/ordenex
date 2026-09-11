import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  avisoRepartoMananaConfig,
  esHoraNocturnaCR,
  horaUtcDeHoraCR,
  OFFSET_CR_HORAS,
} from "@/lib/config/aviso-reparto-manana";

// GUARDIA DEL ARNÉS — FICHA 413 (T5.4, R9/R10/R11) — LA HORA DEL CRON, VERIFICADA SIN EJECUTARLO.
//
// `vercel.json` va en **UTC**. Costa Rica es **UTC−6 fijo, sin horario de verano**. Por tanto:
//
//     19:00 CR = 01:00 UTC DEL DÍA SIGUIENTE  ⇒  "0 1 * * *"
//
// Escribir `0 19 * * *` pondría el aviso a LA 1:00 DE LA MADRUGADA CR. No es una molestia teórica:
// este aviso llega también al teléfono (410), y R11 prohíbe explícitamente la franja 22:00–06:00
// CR. Los crons vecinos de este mismo fichero usan `0 6 * * *`, que **no es «las seis»: es
// MEDIANOCHE CR** — o sea que la confusión ya está escrita en el archivo que se vigila.
//
// ---------------------------------------------------------------------------------------------
// LA DIRECCIÓN DE LA COMPROBACIÓN IMPORTA
// ---------------------------------------------------------------------------------------------
// La hora CR es la FUENTE y vive en `lib/config/aviso-reparto-manana.ts`, con su medición al lado
// (89 % del volumen asignado antes de las 11:00; ~4 % después de las 19:00). `vercel.json` es lo
// que se VERIFICA contra ella: se lee su expresión cron, se convierte a hora CR y se compara.
//
// Dos sitios que dicen la misma hora en unidades distintas es justo como se acaba con dos
// verdades. Aquí uno manda y el otro se comprueba.
//
// ⚠️ LA CONVERSIÓN SE ESCRIBE A MANO EN ESTE ARCHIVO (`(utc + 24 − 6) % 24`) y NO se llama a
// `horaUtcDeHoraCR` para el aserto central: comparar la expresión contra la función que la genera
// estaría siempre verde, y ya dejó pasar un tope que la app rechazaba. `horaUtcDeHoraCR` sí se
// ejercita aparte, como la unidad que es.
//
// SE DECLARA COMO GUARDIA PORQUE LEE UN FICHERO DE CONFIGURACIÓN: `vercel.json` no lo importa
// nadie, así que ningún grafo de imports seleccionaría este test en el modo rápido.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

interface EntradaCron {
  path: string;
  schedule: string;
}

function crons(): EntradaCron[] {
  const crudo = readFileSync(path.join(REPO_ROOT, "vercel.json"), "utf8");
  const json = JSON.parse(crudo) as { crons?: EntradaCron[] };
  if (!json.crons || json.crons.length === 0) {
    throw new Error(
      "guardia cron-hora-cr: `vercel.json` no tiene `crons`. La guardia NO pudo leer lo que " +
        "vigila; se detiene en ROJO en vez de dar por buena una lectura vacía.",
    );
  }
  return json.crons;
}

/**
 * La hora UTC de una expresión cron `m h * * *`. Revienta con cualquier otra forma: esta ficha
 * declara UNA corrida diaria a una hora fija, y una expresión con lista (`0 1,3 * * *`)
 * con paso sería otra cosa que nadie ha decidido.
 */
function horaUtcDelSchedule(schedule: string): number {
  const m = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/.exec(schedule.trim());
  if (!m) {
    throw new Error(
      `guardia cron-hora-cr: la expresión "${schedule}" no es "m h * * *". Una corrida diaria a ` +
        `hora fija es el requisito (R9); cualquier otra forma hay que decidirla, no colarla.`,
    );
  }
  return Number(m[2]);
}

/** UTC → hora de pared CR. ESCRITA A MANO aquí, sin llamar a la conversión de producción. */
function horaCrDeHoraUtc(horaUtc: number): number {
  return (horaUtc + 24 - 6) % 24;
}

describe("413/R9 — hay UNA entrada de cron para esta ruta, y una sola", () => {
  it("⭑ exactamente una, y su ruta es la que declara la configuración", () => {
    const delAviso = crons().filter((c) => c.path === avisoRepartoMananaConfig.RUTA_CRON);

    // AUTOCOMPROBACIÓN: si el filtro no encontrara nada, los asertos de abajo pasarían en verde
    // sobre una lista vacía. Este repo ya midió lo que cuesta un test que reporta `passed` sin
    // ejercitar nada.
    expect(delAviso.length, "no hay entrada de cron para el aviso de reparto de mañana").toBe(1);
    // Y la ruta escrita a mano, para que renombrarla en la configuración no arrastre a la guardia
    // sin que nadie lo vea.
    expect(delAviso[0].path).toBe("/api/cron/aviso-reparto-manana");
  });

  it("la ruta del cron coincide con el route handler que existe en el árbol", () => {
    // Un cron que apunta a una ruta inexistente es un 404 diario que nadie mira.
    const handler = path.join(REPO_ROOT, "app", "api", "cron", "aviso-reparto-manana", "route.ts");
    expect(readFileSync(handler, "utf8").length).toBeGreaterThan(0);
  });

  it("⭑ SEGUNDA CORRIDA DESCARTADA: no hay una segunda entrada para esta ruta (design §4.3)", () => {
    // La segunda corrida de las 21:00 CR quedó DESCARTADA con el número delante (decisión del
    // humano, 2026-09-11): compraría ~10 asignaciones tardías al día entre 18 mensajeros —el 4 %—
    // y pagaría la regla que más importa de la 409: UNO AL DÍA POR TIPO. Si alguien la añade, este
    // aserto y el de arriba se ponen rojos y obligan a releer el umbral que la reabriría.
    const todas = crons().filter((c) => c.path.includes("aviso-reparto-manana"));
    expect(todas).toHaveLength(1);
  });
});

describe("413/R10 — la expresión UTC corresponde a la hora CR DECLARADA", () => {
  it("⭑ convertida a hora de pared CR, la expresión da exactamente `HORA_CR`", () => {
    const entrada = crons().find((c) => c.path === avisoRepartoMananaConfig.RUTA_CRON);
    if (!entrada) throw new Error("guardia cron-hora-cr: sin entrada que convertir");

    const horaUtc = horaUtcDelSchedule(entrada.schedule);
    const horaCr = horaCrDeHoraUtc(horaUtc);

    // ⭑ EL ASERTO. MUTACIÓN OBLIGATORIA (design §13.7): poner la hora CR directamente en el cron
    // (`0 19 * * *`) ⇒ `horaCr` sale 13 y esto se pone ROJO.
    expect(horaCr, `"${entrada.schedule}" son las ${horaCr}:00 CR, no las ${avisoRepartoMananaConfig.HORA_CR}:00`).toBe(
      avisoRepartoMananaConfig.HORA_CR,
    );
    // Y la hora CR declarada es la decidida, escrita a mano: mover `HORA_CR` sin venir aquí
    // tampoco cuela.
    expect(avisoRepartoMananaConfig.HORA_CR).toBe(19);
    // La expresión UTC, escrita a mano. Es la otra dirección de la misma comprobación.
    expect(entrada.schedule).toBe("0 1 * * *");
  });

  it("el minuto es 0: la corrida es en punto, no a una hora «casi»", () => {
    const entrada = crons().find((c) => c.path === avisoRepartoMananaConfig.RUTA_CRON);
    expect(entrada?.schedule.startsWith("0 ")).toBe(true);
  });

  it("la conversión de producción coincide con la escrita a mano aquí (unidad)", () => {
    // `horaUtcDeHoraCR` es la función de producción; arriba NO se usa a propósito. Aquí sí se
    // ejercita, con casos escritos a mano, incluido el que cruza medianoche —que es exactamente el
    // de esta ficha—.
    expect(OFFSET_CR_HORAS).toBe(6);
    expect(horaUtcDeHoraCR(19)).toBe(1); // 19:00 CR → 01:00 UTC del día siguiente
    expect(horaUtcDeHoraCR(0)).toBe(6); // medianoche CR → 06:00 UTC (los crons vecinos)
    expect(horaUtcDeHoraCR(7)).toBe(13); // 07:00 CR → 13:00 UTC (`avisos-diarios`, 409)
    expect(horaUtcDeHoraCR(18)).toBe(0); // 18:00 CR → 00:00 UTC
  });
});

describe("413/R11 — la hora NO cae en la franja nocturna 22:00–06:00 CR", () => {
  it("⭑ la hora CR resultante de la expresión está fuera de esa franja", () => {
    const entrada = crons().find((c) => c.path === avisoRepartoMananaConfig.RUTA_CRON);
    if (!entrada) throw new Error("guardia cron-hora-cr: sin entrada que evaluar");
    const horaCr = horaCrDeHoraUtc(horaUtcDelSchedule(entrada.schedule));

    // ⭑ MUTACIÓN OBLIGATORIA (design §13.7, segunda vía): `0 5 * * *` = 23:00 CR ⇒ ROJO AQUÍ.
    // Y comprobado con la condición escrita a mano, no sólo con el helper: si alguien tocara
    // `esHoraNocturnaCR` para «arreglar» el rojo, este aserto seguiría estando.
    expect(horaCr >= 22 || horaCr < 6, `las ${horaCr}:00 CR caen en la franja nocturna`).toBe(false);
    expect(esHoraNocturnaCR(horaCr)).toBe(false);
  });

  it("`esHoraNocturnaCR` sabe decir que sí — si no, el aserto de arriba sería vacío", () => {
    // ANTI-VACUIDAD: una función que devolviera `false` siempre dejaría el caso anterior verde
    // pasara lo que pasara.
    expect(esHoraNocturnaCR(23)).toBe(true); // la mutación `0 5 * * *`
    expect(esHoraNocturnaCR(22)).toBe(true); // el borde inferior, incluido
    expect(esHoraNocturnaCR(0)).toBe(true); // medianoche: donde corre el corte diario
    expect(esHoraNocturnaCR(5)).toBe(true); // el borde superior, incluido
    expect(esHoraNocturnaCR(6)).toBe(false); // 06:00 ya NO es noche
    expect(esHoraNocturnaCR(21)).toBe(false); // 21:00 tampoco
  });
});

describe("413 — el resto de los crons no se ha tocado (R40)", () => {
  it("los nueve anteriores siguen ahí, con su ruta y su expresión", () => {
    const porRuta = new Map(crons().map((c) => [c.path, c.schedule]));
    // Literales a mano: es un censo, no un espejo del fichero.
    expect(porRuta.get("/api/cron/corte-diario")).toBe("0 6 * * *");
    expect(porRuta.get("/api/cron/generar-gastos-fijos")).toBe("0 6 * * *");
    expect(porRuta.get("/api/cron/procesar-jobs")).toBe("* * * * *");
    expect(porRuta.get("/api/cron/procesar-devueltas-sla")).toBe("0 * * * *");
    expect(porRuta.get("/api/cron/sync-plantillas-whatsapp")).toBe("0 3 * * *");
    expect(porRuta.get("/api/cron/purga-pdf-cargas")).toBe("0 9 * * *");
    expect(porRuta.get("/api/cron/snapshot-ranking")).toBe("0 8 * * *");
    expect(porRuta.get("/api/cron/purga-postulaciones-recurso")).toBe("30 9 * * *");
    expect(porRuta.get("/api/cron/avisos-diarios")).toBe("0 13 * * *");
    // Y el nuevo hace diez.
    expect(crons()).toHaveLength(10);
  });

  it("⭑ la corrida de esta ficha NO choca con el corte diario ni con el de gastos fijos", () => {
    // No es una comprobación estética: el corte (`0 6 * * *` = 00:00 CR) no toca las órdenes
    // reservadas para un día futuro (246), pero emitir DESPUÉS del corte habría dejado el aviso
    // llegando de madrugada. Cinco horas de separación, dichas en el test.
    const aviso = crons().find((c) => c.path === avisoRepartoMananaConfig.RUTA_CRON)!;
    expect(aviso.schedule).not.toBe("0 6 * * *");
    expect(horaCrDeHoraUtc(horaUtcDelSchedule(aviso.schedule))).toBeLessThan(22);
    expect(horaCrDeHoraUtc(horaUtcDelSchedule(aviso.schedule))).toBeGreaterThan(12);
  });
});
