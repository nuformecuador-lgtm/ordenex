import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 135 / T4.3 — GUARDIA de R14: `lib/analytics` REUTILIZA `lib/utils/fecha-cr.ts`,
// no reimplementa la aritmetica de fecha de Costa Rica.
//
// Por que existe este guardia, con todas las letras: el repo tiene DOS convenciones
// vivas para "el dia de Costa Rica" y una de ellas es una TRAMPA si se usa contra
// columnas `timestamp`.
//
//   - `startOfDayCR(now)` devuelve la MEDIANOCHE UTC de la fecha calendario CR
//     (convencion `@db.Date` de la feature 46). Esta 6 h POR DEBAJO del inicio real
//     del dia en Costa Rica.
//   - `inicioDelDiaCREnUtc(fecha)` devuelve `${fecha}T06:00:00.000Z`, que es el
//     instante real de las 00:00 de pared en CR (feature 144). Es la que usa la
//     analitica (decision D6 / R31).
//
// La TRAMPA sigue viva: `startOfDayCR` se conserva exportada porque es la funcion
// CORRECTA para columnas `@db.Date`, y usarla como cota contra un `timestamp`
// produce la ventana `[00:00Z, 24:00Z)` = 18:00-18:00 hora CR, NO el dia natural.
// Lo que ya NO existe es la divergencia con el ranking: `RankingService` compara
// `timestamp` y desde la feature **166** usa esta misma convencion, asi que
// analitica y ranking resuelven "hoy" con cotas identicas (el ticket de
// saneamiento D6 / T0.3 quedo cerrado ahi). Si alguien "arregla" la analitica
// importando `startOfDayCR`, este guardia cae — y esa es su razon de ser.
//
// Se censa el CODIGO, no los comentarios: nombrar la trampa en la documentacion es
// obligatorio (tasks T4.1(c)); usarla es lo prohibido. Por eso se quitan comentarios
// antes de censar, y ademas se exige que la cabecera de `ranges.ts` SI cite el caso.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const DIR_ANALYTICS = path.join(REPO_ROOT, "lib", "analytics");
const RANGES_PATH = path.join(DIR_ANALYTICS, "ranges.ts");

function archivosDeAnalytics(): string[] {
  return fs
    .readdirSync(DIR_ANALYTICS)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.join(DIR_ANALYTICS, f));
}

/** Quita comentarios de bloque, de linea y trailing, para censar solo el codigo. */
function soloCodigo(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

/** Normaliza espacios para que el censo no dependa del formato del literal. */
function sinEspacios(fuente: string): string {
  return fuente.replace(/\s+/g, "");
}

describe("lib/analytics · reutiliza fecha-cr, no lo reimplementa (R14)", () => {
  it("ranges.ts importa los helpers de @/lib/utils/fecha-cr", () => {
    const fuente = fs.readFileSync(RANGES_PATH, "utf8");
    const codigo = soloCodigo(fuente);

    expect(codigo).toMatch(/from\s+["']@\/lib\/utils\/fecha-cr["']/);
    for (const helper of [
      "fechaCalendarioCR",
      "inicioDelDiaCREnUtc",
      "inicioDelDiaSiguienteCREnUtc",
    ]) {
      expect(codigo, `ranges.ts deberia usar ${helper}`).toContain(helper);
    }
  });

  it("no reimplementa el desfase UTC-6 en ningun archivo de lib/analytics", () => {
    for (const archivo of archivosDeAnalytics()) {
      const codigo = sinEspacios(soloCodigo(fs.readFileSync(archivo, "utf8")));
      expect(codigo, `${path.basename(archivo)} escribe el offset de CR a mano`).not.toContain(
        "6*60*60*1000",
      );
      expect(codigo, `${path.basename(archivo)} escribe el offset de CR a mano`).not.toContain(
        "21600000",
      );
    }
  });

  it("no construye fechas con toISOString().slice en lib/analytics", () => {
    // `toISOString()` emite la fecha en UTC: despues de las 18:00 de CR ya devuelve
    // el dia SIGUIENTE (off-by-one). Para eso esta `fechaCalendarioCR`.
    for (const archivo of archivosDeAnalytics()) {
      const codigo = sinEspacios(soloCodigo(fs.readFileSync(archivo, "utf8")));
      expect(codigo, `${path.basename(archivo)} usa toISOString().slice`).not.toContain(
        "toISOString().slice",
      );
    }
  });

  it("no usa startOfDayCR como cota en lib/analytics (la trampa del ranking)", () => {
    for (const archivo of archivosDeAnalytics()) {
      const codigo = soloCodigo(fs.readFileSync(archivo, "utf8"));
      expect(codigo, `${path.basename(archivo)} usa startOfDayCR`).not.toContain("startOfDayCR");
    }
  });

  it("documenta la trampa `startOfDayCR` y la divergencia YA CERRADA con el ranking (166)", () => {
    // El contrapeso del censo de arriba: la trampa debe estar NOMBRADA en la
    // documentacion de `ranges.ts` para que nadie la "corrija" copiandola. Se siguen
    // exigiendo TRES coincidencias simultaneas —no basta nombrarla de pasada—: la
    // funcion trampa, la ventana que produce y la ficha que cerro la divergencia.
    const fuente = fs.readFileSync(RANGES_PATH, "utf8");

    expect(fuente).toContain("startOfDayCR");
    expect(fuente).toMatch(/18:00/);
    expect(fuente).toMatch(/166/);
  });

  it("el censo detecta el offset escrito a mano (autocomprobacion del guardia)", () => {
    // Si el guardia se rompiera y dejara de detectar nada, este caso lo revela.
    const sospechoso = "const CR_OFFSET_MS = 6 * 60 * 60 * 1000;";
    expect(sinEspacios(soloCodigo(sospechoso))).toContain("6*60*60*1000");
    // ...y no confunde la duracion de un DIA con un offset.
    expect(sinEspacios(soloCodigo("const UN_DIA = 24 * 60 * 60 * 1000;"))).not.toContain(
      "6*60*60*1000",
    );
  });
});
