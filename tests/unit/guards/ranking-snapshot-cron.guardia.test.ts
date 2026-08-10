import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { RankingSnapshotService } from "@/lib/services/RankingSnapshotService";

// Feature 196 (design §8) — GUARDIA del cron del snapshot y del ALCANCE del historico.
// Tres invariantes que ningun test de comportamiento puede sostener porque no viven en una
// funcion, sino en la FORMA del sistema:
//
//   R23 — el cron esta declarado en `vercel.json` y su programacion es INDEPENDIENTE de la
//         del corte diario (decision humana 2): si el corte falla, este corre igual, y nadie
//         puede "simplificar" fundiendo las dos entradas en una.
//   R15 — NO existe forma de pedir otra fecha. Se mide la ARIDAD de `congelar` (1 parametro:
//         `now`) y se censa que ni el service ni la ruta lean una fecha de fuera. Un test de
//         comportamiento no puede probar la ausencia de una puerta que aun no existe; un
//         censo de la firma, si.
//   R29 — el historico es de SOLO LECTURA: ninguna superficie bajo `app/` o `lib/actions/`
//         escribe en las dos tablas del snapshot. El unico escritor es
//         `RankingSnapshotRepository`, y el unico que lo invoca es el congelado.
//
// La lectura es ESTATICA. La selecciona `pnpm exec vitest run guard` por el nombre del
// archivo, sin estar registrada en ninguna lista.

const RAIZ = path.resolve(__dirname, "..", "..", "..");
const VERCEL_JSON = path.join(RAIZ, "vercel.json");
const RUTA_CRON = path.join(RAIZ, "app", "api", "cron", "snapshot-ranking", "route.ts");
const SERVICE = path.join(RAIZ, "lib", "services", "RankingSnapshotService.ts");
const REPO_SNAPSHOT = path.join(RAIZ, "lib", "repositories", "RankingSnapshotRepository.ts");

const PATH_CRON = "/api/cron/snapshot-ranking";
const PATH_CORTE = "/api/cron/corte-diario";

interface VercelConfig {
  crons: { path: string; schedule: string }[];
}

function leerVercel(): VercelConfig {
  return JSON.parse(readFileSync(VERCEL_JSON, "utf8")) as VercelConfig;
}

/** Quita comentarios de bloque y de linea: se censa el CODIGO, no la prosa que lo explica. */
function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

/** Arboles de PRODUCCION donde vive toda superficie de usuario (paginas + Server Actions). */
const ARBOLES_DE_SUPERFICIE = [path.join(RAIZ, "app"), path.join(RAIZ, "lib", "actions")];

function listarFuentes(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listarFuentes(completo, acc);
    else if (/\.(tsx?|mts)$/.test(entrada.name)) acc.push(completo);
  }
  return acc;
}

function relativa(archivo: string): string {
  return path.relative(RAIZ, archivo).split(path.sep).join("/");
}

/** Modelos Prisma del historico congelado, tal como los nombra el cliente generado. */
const MODELOS_SNAPSHOT = ["rankingSnapshotDia", "rankingSnapshotFila"];
const METODOS_DE_ESCRITURA = [
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
];

/** `<algo>.rankingSnapshotFila.createMany(` y variantes, en una sola pasada. */
const ESCRITURA_SOBRE_SNAPSHOT = new RegExp(
  `\\.(${MODELOS_SNAPSHOT.join("|")})\\s*\\.\\s*(${METODOS_DE_ESCRITURA.join("|")})\\s*\\(`,
  "g",
);

describe("196 · el cron del snapshot esta programado y es independiente (R23)", () => {
  it("vercel.json declara /api/cron/snapshot-ranking a las 08:00 UTC (02:00 CR)", () => {
    const cron = leerVercel().crons.find((c) => c.path === PATH_CRON);
    expect(cron, `falta la entrada ${PATH_CRON} en vercel.json`).toBeDefined();
    // 08:00 UTC = 02:00 America/Costa_Rica (UTC−6 fijo, sin horario de verano): dos horas
    // DESPUES del cambio de fecha CR, asi que el dia que congela ya esta cerrado (R23).
    expect(cron?.schedule).toBe("0 8 * * *");
  });

  it("su programacion DIFIERE de la del corte diario (decision humana 2)", () => {
    const crons = leerVercel().crons;
    const snapshot = crons.find((c) => c.path === PATH_CRON);
    const corte = crons.find((c) => c.path === PATH_CORTE);
    expect(corte, "desaparecio el cron del corte diario").toBeDefined();
    expect(snapshot?.schedule).not.toBe(corte?.schedule);
    // Y son DOS entradas distintas: el congelado no cuelga del corte (design §9.D).
    expect(crons.filter((c) => c.path === PATH_CRON)).toHaveLength(1);
  });

  it("el endpoint del cron existe y no encadena el congelado a otro cron", () => {
    expect(existsSync(RUTA_CRON)).toBe(true);
    const codigo = soloCodigo(readFileSync(RUTA_CRON, "utf8"));
    expect(codigo).not.toMatch(/corte-diario|CorteDiarioService|procesar-jobs|jobsCola/);
  });
});

describe("196 · no hay forma de congelar una fecha distinta de D−1 (R15)", () => {
  it("`congelar` recibe UN solo parametro (`now`) y ninguna fecha", () => {
    expect(RankingSnapshotService.prototype.congelar.length).toBe(1);
  });

  it("el service no admite fecha por parametro en la firma de `congelar`", () => {
    const codigo = soloCodigo(readFileSync(SERVICE, "utf8"));
    const firma = /async\s+congelar\s*\(([^)]*)\)/.exec(codigo)?.[1] ?? null;
    expect(firma, "no se encontro la firma de congelar()").not.toBeNull();
    expect(firma?.replace(/\s+/g, "")).toBe("now:Date");
  });

  it("la ruta del cron no lee ninguna fecha de la peticion (ni query, ni body, ni header)", () => {
    const codigo = soloCodigo(readFileSync(RUTA_CRON, "utf8"));
    for (const puerta of [
      "searchParams",
      "nextUrl",
      "req.json",
      "req.text",
      "formData",
      "new URL(",
    ]) {
      expect(codigo, `la ruta del cron abre la puerta ${puerta}`).not.toContain(puerta);
    }
    // El unico dato variable que entra al service es el reloj.
    expect(codigo).toMatch(/service\.congelar\(\s*\w+\s*\)/);
    expect(codigo).not.toMatch(/congelar\(\s*["'`]/); // ni una fecha literal
  });

  it("el censo detecta lo que dice detectar (autocomprobacion del guardia)", () => {
    const sospechoso = soloCodigo(`
      // congelar(fecha) esto es prosa y no debe contar
      const { searchParams } = new URL(req.url);
    `);
    expect(sospechoso).toContain("searchParams");
    expect(sospechoso).not.toContain("prosa");
    expect("x.rankingSnapshotFila.createMany(").toMatch(ESCRITURA_SOBRE_SNAPSHOT);
    expect("x.rankingSnapshotDia.findUnique(").not.toMatch(ESCRITURA_SOBRE_SNAPSHOT);
  });
});

describe("196 · el historico congelado es de SOLO LECTURA (R29)", () => {
  it("ninguna pagina ni Server Action escribe en las tablas del snapshot", () => {
    const infractores: string[] = [];
    for (const arbol of ARBOLES_DE_SUPERFICIE) {
      for (const archivo of listarFuentes(arbol)) {
        const codigo = soloCodigo(readFileSync(archivo, "utf8"));
        ESCRITURA_SOBRE_SNAPSHOT.lastIndex = 0;
        if (ESCRITURA_SOBRE_SNAPSHOT.test(codigo)) infractores.push(relativa(archivo));
      }
    }
    expect(infractores, `escriben en el historico congelado: ${infractores.join(", ")}`).toEqual(
      [],
    );
  });

  it("el UNICO escritor del historico es RankingSnapshotRepository", () => {
    const escritores: string[] = [];
    for (const arbol of [path.join(RAIZ, "lib"), path.join(RAIZ, "app")]) {
      for (const archivo of listarFuentes(arbol)) {
        const codigo = soloCodigo(readFileSync(archivo, "utf8"));
        ESCRITURA_SOBRE_SNAPSHOT.lastIndex = 0;
        if (ESCRITURA_SOBRE_SNAPSHOT.test(codigo)) escritores.push(relativa(archivo));
      }
    }
    expect(escritores).toEqual([relativa(REPO_SNAPSHOT)]);
  });

  it("el contrato del service no expone metodo de escritura fuera de `congelar`", () => {
    const contrato = readFileSync(
      path.join(RAIZ, "lib", "interfaces", "services", "IRankingSnapshotService.ts"),
      "utf8",
    );
    const codigo = soloCodigo(contrato);
    for (const verbo of ["editar", "actualizar", "borrar", "eliminar", "recongelar", "rehacer"]) {
      expect(codigo.toLowerCase(), `el contrato expone ${verbo}`).not.toContain(`${verbo}(`);
    }
  });
});
