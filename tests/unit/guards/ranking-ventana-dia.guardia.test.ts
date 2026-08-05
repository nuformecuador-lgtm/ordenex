import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 166 (design §6) — GUARDIA de la ventana de dia del ranking.
//
// El repo tiene DOS convenciones vivas para "el dia de Costa Rica" y una de ellas es una
// TRAMPA si se usa contra columnas `timestamp`:
//
//   - `startOfDayCR(now)` devuelve la MEDIANOCHE UTC de la fecha calendario CR (convencion
//     `@db.Date` de la feature 46). Esta 6 h POR DEBAJO del inicio real del dia en CR.
//   - `inicioDelDiaCREnUtc(fecha)` devuelve `${fecha}T06:00:00.000Z`, el instante real de
//     las 00:00 de pared en CR (feature 144). Es la que usa la analitica.
//
// `RankingService` compara `gestion_orden.created_at` y `orden.asignado_at` —ambas
// `timestamp`, ninguna `@db.Date`— asi que le corresponde la SEGUNDA. Este guardia impide
// que alguien "revierta" el arreglo de la 166 volviendo a `startOfDayCR` (por parecer mas
// consistente con el resto del repo) o parcheandolo con aritmetica de offset a mano.
//
// Se censa el CODIGO, no los comentarios: nombrar la trampa en la documentacion es
// obligatorio (R15); usarla es lo prohibido. Por eso se quitan comentarios antes de censar
// el codigo, y aparte se exige que la prosa cite la convencion y la ficha.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const SERVICE_PATH = path.join(REPO_ROOT, "lib", "services", "RankingService.ts");
const REPO_PATH = path.join(REPO_ROOT, "lib", "repositories", "RankingRepository.ts");
const DIR_MIGRACIONES = path.join(REPO_ROOT, "db", "migrations");
const SCHEMA_PATH = path.join(REPO_ROOT, "db", "schema.prisma");

const FUENTES: { nombre: string; ruta: string }[] = [
  { nombre: "RankingService.ts", ruta: SERVICE_PATH },
  { nombre: "RankingRepository.ts", ruta: REPO_PATH },
];

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

/**
 * UNICA excepcion permitida al censo de relojes (R7): el DEFAULT del parametro `now` en la
 * firma `obtenerRanking(actor, now: Date = new Date())`. Ese `new Date()` no resuelve la
 * ventana: es la costura de inyeccion de reloj de la feature 76, y quitarlo romperia
 * `obtenerRankingAction()`, que llama sin `now`. Lo prohibido es leer el reloj DENTRO del
 * calculo, asi que se neutraliza el patron exacto del default antes de censar.
 */
function sinDefaultDeNow(codigo: string): string {
  return codigo.replace(/now\s*:\s*Date\s*=\s*new\s+Date\(\)/g, "now: Date");
}

const LITERALES_PROHIBIDOS = [
  "startOfDayCR",
  "getTimezoneOffset",
  "toISOString().slice",
  "6*60*60*1000",
  "21600000",
  "24*60*60*1000",
  "86400000",
  "T18:00",
  "T00:00",
];

describe("RankingService · ventana del dia natural CR (166)", () => {
  it("no usa startOfDayCR, offsets a mano ni literales horarios (R6)", () => {
    for (const { nombre, ruta } of FUENTES) {
      const codigo = sinEspacios(soloCodigo(fs.readFileSync(ruta, "utf8")));
      for (const literal of LITERALES_PROHIBIDOS) {
        expect(codigo, `${nombre} contiene el literal prohibido ${literal}`).not.toContain(
          sinEspacios(literal),
        );
      }
    }
  });

  it("no lee el reloj sin argumento en la ruta de resolucion de la ventana (R7)", () => {
    for (const { nombre, ruta } of FUENTES) {
      const codigo = sinDefaultDeNow(soloCodigo(fs.readFileSync(ruta, "utf8")));
      expect(codigo, `${nombre} usa new Date() en el cuerpo`).not.toMatch(/new\s+Date\s*\(\s*\)/);
      expect(codigo, `${nombre} usa Date.now()`).not.toMatch(/Date\.now\s*\(\s*\)/);
    }
  });

  it("la fuente del service cita inicioDelDiaCREnUtc y la ficha 166 (R15)", () => {
    const fuente = fs.readFileSync(SERVICE_PATH, "utf8");
    expect(fuente).toContain("inicioDelDiaCREnUtc");
    expect(fuente).toContain("inicioDelDiaSiguienteCREnUtc");
    expect(fuente).toMatch(/166/);
  });

  it("el censo detecta lo que dice detectar (autocomprobacion del guardia)", () => {
    // Si el censo dejara de medir, este caso lo revela.
    const sospechoso = "const desde = startOfDayCR(now); const OFF = 6 * 60 * 60 * 1000;";
    expect(sinEspacios(soloCodigo(sospechoso))).toContain("startOfDayCR");
    expect(sinEspacios(soloCodigo(sospechoso))).toContain("6*60*60*1000");
    // ...y no confunde la duracion de un DIA con un offset de 6 h.
    expect(sinEspacios(soloCodigo("const UN_DIA = 24 * 60 * 60 * 1000;"))).not.toContain(
      "6*60*60*1000",
    );
    // La neutralizacion del default de `now` es QUIRURGICA: solo perdona la firma.
    expect(sinDefaultDeNow("async f(now: Date = new Date()) {}")).not.toMatch(
      /new\s+Date\s*\(\s*\)/,
    );
    expect(sinDefaultDeNow("const ahora = new Date();")).toMatch(/new\s+Date\s*\(\s*\)/);
  });

  it("no hay migracion nueva de ranking/premio y premio_ranking no cambia (R16)", () => {
    const migracionesDelModulo = fs
      .readdirSync(DIR_MIGRACIONES)
      .filter((d) => /ranking|premio/i.test(d))
      .sort();
    // La unica es la que creo la tabla en la feature 76: la 166 no migra nada.
    expect(migracionesDelModulo).toEqual(["20260716130000_premio_ranking"]);

    const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
    const modelo = /model PremioRanking \{[\s\S]*?\n\}/.exec(schema)?.[0] ?? "";
    expect(modelo).not.toBe("");
    expect(sinEspacios(modelo)).toContain('@@map("premio_ranking")');
    expect(sinEspacios(modelo)).toContain("posicionInt@unique");
    expect(sinEspacios(modelo)).toContain("montoDecimal?@db.Decimal(12,2)");
    expect(sinEspacios(modelo)).toContain('descripcionString?@map("descripcion")');
  });
});
