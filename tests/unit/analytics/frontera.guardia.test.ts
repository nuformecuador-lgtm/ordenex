import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

// Feature 135 / T2.2 — GUARDIA de R25: esta feature NO toca la base de datos, ni la UI,
// ni las acciones, ni los servicios, ni los repositorios.
//
// Por que existe: la 135 es fundacional y da mucha tentacion de "ya que estoy" —
// crear la tabla `analytics_daily` (es de la 123), un endpoint de prueba, un widget,
// un servicio que consuma el catalogo. Cada uno de esos archivos convertiria una
// feature de contrato puro en una feature con migracion y con superficie de producto,
// y se colaria en un PR que el reviewer aprueba por el nombre. El guardia lo mide
// sobre el DIFF REAL de la rama, no sobre la buena voluntad.
//
// ---------------------------------------------------------------------------
// QUE SE COMPARA, Y QUE PASA SI LA BASE NO EXISTE (decision documentada)
// ---------------------------------------------------------------------------
// La rama `feature/135-analitica-catalogo-kpis-rangos` salio de `origin/dev` en
// `664840f3`. La base se busca EN ESTE ORDEN y se usa la primera que resuelva:
//   1. el `merge-base` con `origin/dev` — lo correcto cuando el remoto esta al dia;
//   2. el `merge-base` con `dev` local — para un checkout sin remoto configurado;
//   3. el commit fijado `664840f3` — el punto de corte real de esta rama, que existe
//      en cualquier clon con historia.
//
// Si NINGUNA resuelve, el guardia NO se queda en verde en silencio ni revienta con un
// error opaco de `git`: se distingue el unico caso tolerable (no hay repositorio git en
// absoluto: un tarball, un `npm pack`, una imagen de CI sin `.git`) del caso que SI es
// un fallo (hay repositorio pero ninguna referencia base resuelve, p. ej. un clon
// `--depth 1` sin la historia). El primero salta con motivo escrito; el segundo FALLA.
// Esa distincion la hace el primer test, que corre SIEMPRE.
//
// ---------------------------------------------------------------------------
// EL DIFF INCLUYE LO NO COMMITEADO — A PROPOSITO
// ---------------------------------------------------------------------------
// `git diff <base>...HEAD` solo ve lo commiteado, y durante la implementacion los
// archivos nuevos son UNTRACKED: el guardia pasaria por vacio justo cuando mas falta
// hace. Por eso el conjunto censado es la union de tres fuentes:
//   - `git diff --name-only <base>`      (arbol de trabajo contra la base: commiteado
//                                         y sin commitear, de archivos ya rastreados)
//   - `git ls-files --others --exclude-standard`  (archivos NUEVOS sin rastrear)
//   - `git diff --name-only --cached`    (lo puesto en el indice)

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

/** Punto de corte real de la rama respecto de `origin/dev` (ver cabecera). */
const COMMIT_BASE_FIJADO = "664840f39fd017a23817cbb920b1524e2e32024a";

function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function gitOpcional(...args: string[]): string | null {
  try {
    return git(...args);
  } catch {
    return null;
  }
}

const HAY_REPOSITORIO_GIT =
  fs.existsSync(path.join(REPO_ROOT, ".git")) && gitOpcional("rev-parse", "--git-dir") !== null;

interface Base {
  readonly sha: string;
  readonly origen: string;
}

function resolverBase(): Base | null {
  if (!HAY_REPOSITORIO_GIT) return null;

  for (const ref of ["origin/dev", "dev"]) {
    const mergeBase = gitOpcional("merge-base", "HEAD", ref);
    if (mergeBase) return { sha: mergeBase, origen: `merge-base con ${ref}` };
  }
  const fijado = gitOpcional("rev-parse", "--verify", `${COMMIT_BASE_FIJADO}^{commit}`);
  if (fijado) return { sha: fijado, origen: `commit fijado ${COMMIT_BASE_FIJADO.slice(0, 8)}` };

  return null;
}

const BASE = resolverBase();

function lineas(salida: string | null): string[] {
  if (!salida) return [];
  return salida
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Rutas relativas al repo (con `/`) que la rama anade o modifica respecto de la base. */
function archivosDeLaRama(base: Base): string[] {
  const tocados = [
    ...lineas(gitOpcional("diff", "--name-only", base.sha)),
    ...lineas(gitOpcional("diff", "--name-only", "--cached", base.sha)),
    ...lineas(gitOpcional("ls-files", "--others", "--exclude-standard")),
  ];
  return [...new Set(tocados)].sort();
}

/** Prefijos que R25 declara PROHIBIDOS para esta feature. */
const PREFIJOS_PROHIBIDOS = [
  "db/migrations/",
  "app/",
  "components/",
  "lib/actions/",
  "lib/services/",
  "lib/repositories/",
];

/** El unico CODIGO que la rama puede tocar (`tasks.md`, encabezado). */
const PREFIJOS_DE_CODIGO_PERMITIDOS = ["lib/analytics/", "tests/unit/analytics/"];

/**
 * ---------------------------------------------------------------------------
 * LA UNICA EXCEPCION, Y POR QUE NO AFLOJA R25
 * ---------------------------------------------------------------------------
 * R25 dice, en su letra: la 135 «NO DEBE crear rutas, Server Actions, repositorios,
 * servicios ni componentes; y los archivos tocados DEBEN limitarse a `lib/analytics/**`
 * mas sus tests en `tests/unit/**`». El requisito abre TODO `tests/unit/**`. La linea 5
 * de `tasks.md` («ningun archivo fuera de `lib/analytics/**` y `tests/unit/analytics/**`»)
 * es una CONVENCION del plan de tareas, mas estrecha que el requisito que el reviewer
 * verifica. Aqui se mantiene la convencion como norma —es la que atrapa el helper en
 * `lib/utils/` o el mock en `tests/setup/`— y se admite una sola salida, la que R25 ya
 * autorizaba de antemano.
 *
 * Esa salida es el registro OBLIGATORIO en la allowlist del censo repo-wide de la 155
 * (`tests/unit/guards/censo-order-status-rename.test.ts`). T3.4/R8 obliga a la 135 a
 * afirmar en `tests/unit/analytics/definiciones-catalogo.guardia.test.ts` que el catalogo
 * de KPIs NO cita el value que la 155 retiro sin sucesor (el septimo de `OLD_VALUES` en
 * ese censo). Afirmar la ausencia exige escribir el literal, y escribirlo dispara el
 * censo; el mecanismo que el propio censo documenta para el caso legitimo es darse de
 * alta en su ALLOWLIST. No hay forma de cumplir T3.4/R8 sin tocar ese archivo, y hacerlo
 * NO crea superficie de producto.
 *
 * Este comentario nombra ese value por descripcion y no por su literal a proposito: si lo
 * citara, ESTE archivo tambien tendria que darse de alta en la allowlist del censo, y la
 * excepcion se duplicaria sin necesidad.
 *
 * Por diseno esto es una lista de ARCHIVOS EXACTOS, no de prefijos: cualquier OTRO
 * archivo bajo `tests/unit/guards/` sigue siendo infraccion. La excepcion es una
 * rendija nominal, no una puerta abierta a la carpeta.
 *
 * La lista negra de R25 (`PREFIJOS_PROHIBIDOS`) queda INTACTA: nada de lo de aqui la
 * toca ni la puede eludir.
 */
const ARCHIVOS_DE_CODIGO_PERMITIDOS = ["tests/unit/guards/censo-order-status-rename.test.ts"];

/** Censo positivo: prefijos del alcance + los archivos exactos exceptuados. */
function codigoPermitido(ruta: string): boolean {
  return (
    PREFIJOS_DE_CODIGO_PERMITIDOS.some((p) => ruta.startsWith(p)) ||
    ARCHIVOS_DE_CODIGO_PERMITIDOS.includes(ruta)
  );
}

/**
 * El censo positivo se aplica solo a CODIGO. Se excluyen a proposito el papeleo del
 * arnes (`specs/`, `progress/`, `docs/`, `feature_list.json`) y cualquier `.md`/`.json`
 * de configuracion: no son codigo de producto y R25 no los prohibe.
 *
 * La exclusion no es cosmetica. Este checkout lo comparten varias sesiones del arnes a
 * la vez y `git ls-files --others` devuelve tambien los archivos sin commitear de las
 * OTRAS (durante esta misma tarea aparecio `specs/129-.../requirements.md`, ajeno a la
 * 135). Culpar a la 135 de un spec ajeno seria un falso positivo cronico. Lo que no se
 * afloja es la lista negra de `PREFIJOS_PROHIBIDOS`: esa es la letra de R25 y ahi si se
 * prefiere un falso positivo ruidoso —obliga a mirar quien creo el archivo— antes que
 * dejar pasar una migracion o una pagina.
 */
const EXTENSIONES_DE_CODIGO = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql", ".prisma"];

function esCodigo(ruta: string): boolean {
  return EXTENSIONES_DE_CODIGO.some((ext) => ruta.endsWith(ext));
}

describe("R25 · la rama de la 135 no cruza su frontera", () => {
  it("encuentra la base de comparacion o declara por que no hay repositorio git", () => {
    if (!HAY_REPOSITORIO_GIT) {
      // Unico caso tolerado: no hay historia que comparar (tarball / CI sin `.git`).
      // Se deja escrito para que el `skip` de abajo no parezca un verde gratis.
      expect(BASE).toBeNull();
      return;
    }
    expect(
      BASE,
      `hay repositorio git pero ninguna base resuelve (origin/dev, dev, ${COMMIT_BASE_FIJADO.slice(0, 8)}): ` +
        "probablemente sea un clon superficial. El guardia de R25 no puede medir nada asi.",
    ).not.toBeNull();
  });
});

describe.skipIf(BASE === null)("R25 · frontera medida sobre el diff de la rama", () => {
  const base = BASE as Base;

  it("el guardia mide un diff no vacio y sabe contra que compara", () => {
    // Sin esto, cualquier fallo de calculo (base mal resuelta, `git` mudo) dejaria los
    // censos de abajo en verde por vacio en lugar de por limpio.
    const tocados = archivosDeLaRama(base);
    expect(base.sha, `base resuelta por: ${base.origen}`).toMatch(/^[0-9a-f]{40}$/);
    expect(tocados.length, "el diff contra la base salio vacio: el censo no mide nada").toBeGreaterThan(
      0,
    );
    expect(
      tocados.some((f) => f.startsWith("lib/analytics/")),
      "el diff no contiene el propio modulo de la feature: la base no es la de esta rama",
    ).toBe(true);
  });

  it("no anade ni modifica carpetas de migracion en db/migrations", () => {
    const infractores = archivosDeLaRama(base).filter((f) => f.startsWith("db/migrations/"));
    expect(infractores, "la 135 no crea migraciones: analytics_daily es de la 123").toEqual([]);
  });

  it("no toca db/schema.prisma", () => {
    const infractores = archivosDeLaRama(base).filter((f) => f === "db/schema.prisma");
    expect(infractores, "la 135 no modifica el esquema: solo lo LEE en sus guardias").toEqual([]);
  });

  it("no anade rutas, paginas ni componentes en app o components", () => {
    const infractores = archivosDeLaRama(base).filter(
      (f) => f.startsWith("app/") || f.startsWith("components/"),
    );
    expect(infractores, "la 135 no tiene superficie de producto: la UI es de la 129-133").toEqual([]);
  });

  it("no anade acciones, servicios ni repositorios", () => {
    const infractores = archivosDeLaRama(base).filter(
      (f) =>
        f.startsWith("lib/actions/") ||
        f.startsWith("lib/services/") ||
        f.startsWith("lib/repositories/"),
    );
    expect(infractores, "la 135 declara el contrato; consumirlo es de la 122/126/127").toEqual([]);
  });

  it("todo el codigo tocado vive en lib/analytics, en sus tests o en la excepcion nominal", () => {
    // Censo POSITIVO: la lista negra de arriba es la letra de R25, pero `tasks.md` es
    // mas fuerte ("ningun archivo fuera de lib/analytics/** y tests/unit/analytics/**").
    // Esto atrapa lo que ninguna lista negra prevee: un helper en `lib/utils/`, un seed
    // en `db/`, un mock global en `tests/setup/`. La unica salida es la excepcion
    // nominal de `ARCHIVOS_DE_CODIGO_PERMITIDOS`, que R25 ya cubre (`tests/unit/**`).
    const infractores = archivosDeLaRama(base).filter(esCodigo).filter((f) => !codigoPermitido(f));
    expect(infractores, "codigo fuera del alcance declarado de la 135 (R25)").toEqual([]);
  });

  it("el censo de prefijos detecta un archivo prohibido escrito a mano (autocomprobacion)", () => {
    // Si el filtro se rompiera, los censos de arriba pasarian siempre. Estos son los
    // archivos que la tentacion crearia; el censo debe marcarlos todos.
    const sospechosos = [
      "db/migrations/20260801000000_analytics_daily/migration.sql",
      "app/(app)/analitica/page.tsx",
      "components/analitica/TarjetaKpi.tsx",
      "lib/actions/analitica.ts",
      "lib/services/AnaliticaService.ts",
      "lib/repositories/AnaliticaRepository.ts",
    ];
    for (const ruta of sospechosos) {
      expect(
        PREFIJOS_PROHIBIDOS.some((p) => ruta.startsWith(p)),
        `${ruta} deberia estar prohibido por R25`,
      ).toBe(true);
      expect(codigoPermitido(ruta), `${ruta} no deberia estar en la lista de permitidos`).toBe(
        false,
      );
    }
    // ...y el censo positivo tambien los marca, aunque no fuesen de la lista negra.
    for (const ruta of ["lib/utils/kpi.ts", "db/seed.ts", "tests/setup/analitica.ts"]) {
      expect(
        esCodigo(ruta) && !codigoPermitido(ruta),
        `${ruta} deberia caer en el censo positivo`,
      ).toBe(true);
    }
    // ...y no marca lo que si pertenece a la feature (ni la excepcion nominal, que R25
    // cubre por `tests/unit/**` y que existe solo por el alta obligatoria en la
    // allowlist del censo de la 155).
    for (const ruta of [
      "lib/analytics/metrics.ts",
      "tests/unit/analytics/frontera.guardia.test.ts",
      "tests/unit/guards/censo-order-status-rename.test.ts",
      "feature_list.json",
    ]) {
      expect(
        PREFIJOS_PROHIBIDOS.some((p) => ruta.startsWith(p)),
        `${ruta} es legitimo y el censo lo marca`,
      ).toBe(false);
      expect(
        esCodigo(ruta) && !codigoPermitido(ruta),
        `${ruta} es legitimo y el censo positivo lo marca`,
      ).toBe(false);
    }
  });

  it("la excepcion es nominal: otro archivo de tests/unit/guards SI es infraccion", () => {
    // La rendija no puede degenerar en permiso de carpeta. Si alguien convirtiera
    // `ARCHIVOS_DE_CODIGO_PERMITIDOS` en prefijos —o anadiera "tests/unit/guards/"—
    // este test se pone rojo y obliga a justificarlo requisito en mano.
    for (const ruta of [
      "tests/unit/guards/censo-inventado.test.ts",
      "tests/unit/guards/censo-order-status-rename.helpers.ts",
      "tests/unit/guards/otro/censo-order-status-rename.test.ts",
    ]) {
      expect(
        esCodigo(ruta) && !codigoPermitido(ruta),
        `${ruta} no esta exceptuado nominalmente: deberia caer en el censo positivo`,
      ).toBe(true);
    }
    // Y la excepcion es exactamente un archivo, no una familia.
    expect(ARCHIVOS_DE_CODIGO_PERMITIDOS).toEqual([
      "tests/unit/guards/censo-order-status-rename.test.ts",
    ]);
    expect(
      ARCHIVOS_DE_CODIGO_PERMITIDOS.every((f) => !f.endsWith("/")),
      "ARCHIVOS_DE_CODIGO_PERMITIDOS son rutas exactas, nunca prefijos de carpeta",
    ).toBe(true);
  });
});
