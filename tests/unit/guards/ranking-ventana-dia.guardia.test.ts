import { describe, it, expect } from "vitest";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
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
  return quitarComentarios(fuente);
}

/**
 * Deja de un `.sql` solo las sentencias que CAMBIAN el esquema: fuera los comentarios `--` y
 * fuera los `COMMENT ON ... IS '...'`, que son documentacion escrita EN la base. Las dos
 * cosas nombran tablas de las que la migracion habla sin tocarlas (`premio_ranking`, y de eso
 * va justo este censo), y exigirles silencio obligaria a migraciones mudas.
 */
function soloSentenciasDdl(sql: string): string {
  return sql.replace(/^\s*--.*$/gm, "").replace(/COMMENT\s+ON[\s\S]*?'[\s\S]*?';/g, "");
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

  it("las migraciones del modulo son las censadas y ninguna toca premio_ranking (R16)", () => {
    const migracionesDelModulo = fs
      .readdirSync(DIR_MIGRACIONES)
      .filter((d) => /ranking|premio/i.test(d))
      .sort();
    // Lista ACTUALIZADA el 2026-08-10 por la feature 196 (snapshot diario del ranking), que
    // añade la segunda migracion del modulo: dos tablas NUEVAS de historico congelado.
    //
    // Lo que este caso protege NO es "que no haya migraciones" —eso era cierto mientras la
    // 166 fue la ultima, y no es lo que importa—, sino lo de siempre: que la tabla
    // `premio_ranking` de la feature 76 siga intacta y que nadie mueva la ventana del dia CR
    // por la puerta de una migracion. Por eso, ademas de la lista, se censa lo que TOCA cada
    // migracion nueva. Una tercera entrada aqui exige mirarla a mano antes de ampliarla.
    expect(migracionesDelModulo).toEqual([
      "20260716130000_premio_ranking",
      "20260811120000_ranking_snapshot",
    ]);

    // La migracion de la 196 es ADITIVA: solo crea/altera sus dos tablas propias. Se mide el
    // codigo, no la prosa: el `.sql` explica por escrito de que tabla NO habla, y un censo
    // que leyera esa frase como infraccion obligaria a borrar la explicacion.
    const sql = soloSentenciasDdl(
      fs.readFileSync(
        path.join(DIR_MIGRACIONES, "20260811120000_ranking_snapshot", "migration.sql"),
        "utf8",
      ),
    );
    expect(sql).not.toMatch(/premio_ranking/);
    expect(sql).not.toMatch(/\bDROP\b/i);
    for (const [, tabla] of sql.matchAll(/(?:CREATE|ALTER)\s+TABLE\s+"([a-z_]+)"/gi)) {
      expect(["ranking_snapshot_dia", "ranking_snapshot_fila"]).toContain(tabla);
    }

    const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
    const modelo = /model PremioRanking \{[\s\S]*?\n\}/.exec(schema)?.[0] ?? "";
    expect(modelo).not.toBe("");
    expect(sinEspacios(modelo)).toContain('@@map("premio_ranking")');
    expect(sinEspacios(modelo)).toContain("posicionInt@unique");
    expect(sinEspacios(modelo)).toContain("montoDecimal?@db.Decimal(12,2)");
    expect(sinEspacios(modelo)).toContain('descripcionString?@map("descripcion")');
  });
});

// =================================================================================================
// FEATURE 246 (T6.6, D7 firmada el 2026-08-20) — LA GUARDIA APRENDE A LEER LAS *DOS* CONVENCIONES.
//
// ⚠️ ESTE BLOQUE AMPLIA LA GUARDIA, NO LA RELAJA, y la diferencia importa: si acabara aceptando
// cualquier fecha, dejaria de proteger del off-by-one de la 166 — que es todo su motivo de existir.
//
// QUE CAMBIO. Hasta la 246, el ranking usaba UNA sola convencion de fecha: cotas `timestamp`
// (`...T06:00:00.000Z`, `inicioDelDiaCREnUtc`) contra `gestion_orden.created_at` y
// `orden.asignado_at`. Con D7 firmada, el denominador pasa a contar por DIA DE REPARTO, y
// `orden.fecha_reparto` es `@db.Date`: su convencion es la MEDIANOCHE UTC de la fecha calendario CR.
//
// AHORA CONVIVEN LAS DOS EN LA MISMA CONSULTA. La prohibicion de `startOfDayCR` en estos dos
// archivos SIGUE EN PIE —y por eso los literales prohibidos de arriba NO se tocan—: el tercer valor
// se calcula con `fechaComoDate`, que es LITERALMENTE la misma funcion que usa el snapshot
// congelado. Eso hace dos cosas a la vez: mantiene la guardia entera y hace que R41 («el vivo y el
// congelado cuentan igual») se cumpla por construccion en vez de por disciplina.
//
// LO QUE ESTE BLOQUE IMPIDE, dicho como propiedad: que alguien cruce las convenciones. Que use una
// cota `timestamp` como valor de la columna `DATE`, o el valor `DATE` como cota de un `timestamp`.
// =================================================================================================
describe("RankingRepository · las DOS convenciones de fecha, cada una en su sitio (246/T6.6)", () => {
  const codigoRepo = () => sinEspacios(soloCodigo(fs.readFileSync(REPO_PATH, "utf8")));
  const codigoService = () => sinEspacios(soloCodigo(fs.readFileSync(SERVICE_PATH, "utf8")));

  it("el denominador compara `fechaReparto` contra el parametro `diaReparto`, y nada mas", () => {
    const codigo = codigoRepo();
    // La rama principal: la columna `DATE` contra el valor `DATE`.
    expect(codigo).toContain("fechaReparto:diaReparto");
    // La rama de respaldo: la columna `DATE` a NULL + la ventana `timestamp`. Las dos cosas EN LA
    // MISMA rama es lo que la hace disjunta de la primera.
    expect(codigo).toContain("fechaReparto:null,asignadoAt:{gte:desde,lt:hasta}");
  });

  it("NO cruza las convenciones: `diaReparto` nunca es cota de `asignadoAt` ni al reves", () => {
    const codigo = codigoRepo();
    // Si alguien escribiera `asignadoAt: { gte: diaReparto }`, la ventana empezaria seis horas
    // antes de lo debido y arrastraria las 18:00-24:00 CR del dia ANTERIOR: el defecto de la 166.
    expect(codigo).not.toContain("asignadoAt:{gte:diaReparto");
    expect(codigo).not.toContain("asignadoAt:diaReparto");
    // Y al reves: la columna `DATE` comparada contra una cota `timestamp` se iria un dia entero.
    expect(codigo).not.toContain("fechaReparto:desde");
    expect(codigo).not.toContain("fechaReparto:hasta");
    expect(codigo).not.toContain("fechaReparto:{gte:desde");
  });

  it("el repositorio NO deriva una fecha de la otra: las tres llegan del llamador", () => {
    const codigo = codigoRepo();
    // Derivar `diaReparto` restandole 6 h a `desde` seria una SEGUNDA definicion del dia, metida
    // en el peor sitio posible: dentro de la consulta, donde nadie la busca.
    expect(codigo).not.toContain("6*60*60*1000");
    expect(codigo).not.toContain("21600000");
    expect(codigo).not.toMatch(/newDate\(desde/);
    expect(codigo).not.toMatch(/newDate\(hasta/);
    // Y sigue sin leer el reloj (ya cubierto arriba, se reafirma con el parametro nuevo delante).
    expect(codigo).not.toMatch(/newDate\(\)/);
  });

  it("R39: el NUMERADOR no gana ninguna fecha nueva — sigue con `createdAt` y sus dos cotas", () => {
    const codigo = codigoRepo();
    expect(codigo).toContain("createdAt:{gte:desde,lt:hasta}");
    // El numerador tiene que seguir anclado a algo que no reciba escrituras tardias: el snapshot
    // se congela a las 02:00 CR del dia siguiente y es inmutable (design §10-F).
    const numerador =
      codigo.slice(
        codigo.indexOf("contarEntregadasPorMensajero"),
        codigo.indexOf("contarAsignadasPorMensajero"),
      ) || "";
    expect(numerador).not.toBe("");
    expect(numerador).not.toContain("fechaReparto");
  });

  it("el SERVICE calcula el valor `DATE` con `fechaComoDate`, el MISMO helper que el congelado", () => {
    // R41 por construccion: si el vivo usara un helper propio, el vivo y el snapshot podrian
    // divergir en la convencion de esta fecha sin que ningun test lo notara.
    const fuente = fs.readFileSync(SERVICE_PATH, "utf8");
    expect(fuente).toContain("fechaComoDate");
    expect(fuente).toContain("@/lib/ranking/snapshot-dia");
    expect(codigoService()).toContain("fechaComoDate(hoyCR)");
  });

  it("y el service SIGUE sin usar `startOfDayCR`: la prohibicion de la 166 no se relaja", () => {
    // Es el punto de esta ampliacion. `startOfDayCR` devolveria EL MISMO valor que
    // `fechaComoDate(hoyCR)` —no es que el valor este mal—, pero tenerla escrita en este archivo
    // reabre la puerta a usarla tambien como cota de un `timestamp`, que es lo prohibido. La
    // guardia se queda entera.
    expect(codigoService()).not.toContain("startOfDayCR");
    expect(codigoRepo()).not.toContain("startOfDayCR");
  });

  it("el censo detecta lo que dice detectar (autocomprobacion del bloque nuevo)", () => {
    // Las dos formas de cruzar las convenciones, escritas a mano: si el censo dejara de verlas,
    // los `not.toContain` de arriba pasarian con el codigo roto.
    expect(sinEspacios(soloCodigo("where: { asignadoAt: { gte: diaReparto, lt: hasta } }"))).toContain(
      "asignadoAt:{gte:diaReparto",
    );
    expect(sinEspacios(soloCodigo("where: { fechaReparto: desde }"))).toContain(
      "fechaReparto:desde",
    );
    // Y no confunde la forma CORRECTA con una infraccion.
    expect(sinEspacios(soloCodigo("where: { fechaReparto: diaReparto }"))).not.toContain(
      "fechaReparto:desde",
    );
  });
});
