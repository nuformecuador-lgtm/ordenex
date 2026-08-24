import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * FEATURE 274 (T3.4) — GUARDIA DE DOS DIENTES sobre el arbol, no sobre un diff.
 *
 * Es branch-agnostica a proposito: recorre los directorios del repo, asi que NO caduca al
 * mergear (a diferencia de una guardia que mide `git diff` contra `dev`, que en cuanto se
 * mergea pasa a juzgar toda rama posterior).
 *
 * Diente (a) — R13: la columna `tarifas.status` y su tipo `estado_tarifa` se fueron con la
 * migracion `20260825120000_drop_tarifa_status`. Reintroducir el identificador en CODIGO de
 * `lib/`, `app/` o `db/schema.prisma` significa una de dos cosas, las dos malas: o alguien
 * revivio un filtro `status: "activo"` sobre una columna que ya no existe (la base responde
 * con un error de runtime, no con un typecheck rojo, si llega por SQL crudo), o alguien esta
 * volviendo a partir el resolver en dos reglas (`resolveTarifa` frente a la difunta
 * `resolveTarifaCotizablePorTienda`), que es de donde venia la deuda (g) de la feature 69.
 *
 * Diente (b) — R17: el resolver dejo de llamarse «por tienda» porque dejo de resolver por
 * tienda: resuelve por el par (tienda, zona) con la cascada de `lib/utils/cascada-tarifa.ts`.
 * Un `TarifaVigentePorTiendaRepository` de vuelta en el arbol es un nombre que MIENTE sobre
 * la regla, y esta feature existe justamente porque un nombre que mentia sobrevivio a la
 * regla que describia.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE `db/migrations/` NO SE RECORRE, y no es un descuido:
 *
 * `db/migrations/20260715140000_cierre_detail/migration.sql:135` nombra
 * `TarifaVigentePorTiendaRepository` en un COMENTARIO. Esa migracion esta APLICADA, y Prisma
 * guarda el checksum del archivo en `_prisma_migrations`: editarla —aunque sea el comentario—
 * hace fallar `prisma migrate deploy` con «migration was modified after it was applied» en
 * toda base que ya la tenga, y `pnpm build` encadena un migrate-deploy. El historico de
 * migraciones es INMUTABLE por diseno; una guardia que obligase a reescribirlo estaria
 * pidiendo romper el despliegue para dejar contento a un grep. Lo que se protege aqui es el
 * codigo VIVO.
 *
 * POR QUE LAS LINEAS DE COMENTARIO SI PUEDEN NOMBRARLOS:
 *
 * Los cuatro sitios que hoy citan `tarifas.status` / `estado_tarifa` en `lib/` son parrafos
 * que DOCUMENTAN la retirada («se fue con la columna `tarifas.status`») y estan puestos donde
 * vivia el codigo borrado, para que nadie lo reintroduzca sin leer por que se fue. Prohibir
 * la cadena tambien en los comentarios convertiria la guardia en algo que se satisface
 * BORRANDO la explicacion —justo el conocimiento que hay que conservar—. Lo que se censa es
 * codigo: una linea cuyo contenido efectivo no es un comentario.
 */

const REPO_ROOT = path.join(__dirname, "..", "..");
const DIRS_IGNORADOS = new Set(["node_modules", ".next", "dist", "coverage", ".turbo"]);
const EXTENSIONES = [".ts", ".tsx"];

interface Hallazgo {
  archivo: string;
  linea: number;
  contenido: string;
}

/** Una linea es «solo comentario» si su contenido efectivo empieza por `//`, `*` o `/*`. */
function esLineaDeComentario(linea: string): boolean {
  const t = linea.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

/**
 * Ocurrencias de `patron` en `fuente` que NO viven en una linea de comentario.
 * Se trabaja linea a linea (y no con un quitador de comentarios) por una razon medida en
 * esta misma feature: un quitador ingenuo se traga desde un `/*` que aparece dentro de un
 * comentario de linea hasta el primer cierre de bloque, y deja fuera del censo tramos enteros
 * de codigo REAL. Una guardia que no ve el codigo pasa en verde sin mirar nada.
 */
function hallazgosEnFuente(fuente: string, archivo: string, patron: RegExp): Hallazgo[] {
  const out: Hallazgo[] = [];
  fuente.split(/\r?\n/).forEach((linea, i) => {
    if (esLineaDeComentario(linea)) return;
    if (new RegExp(patron.source, patron.flags.replace("g", "")).test(linea)) {
      out.push({ archivo, linea: i + 1, contenido: linea.trim() });
    }
  });
  return out;
}

function archivosDeCodigo(raiz: string): string[] {
  if (!fs.existsSync(raiz)) return [];
  const encontrados: string[] = [];
  for (const entrada of fs.readdirSync(raiz, { withFileTypes: true })) {
    const completa = path.join(raiz, entrada.name);
    if (entrada.isDirectory()) {
      if (DIRS_IGNORADOS.has(entrada.name)) continue;
      encontrados.push(...archivosDeCodigo(completa));
    } else if (EXTENSIONES.some((ext) => entrada.name.endsWith(ext))) {
      encontrados.push(completa);
    }
  }
  return encontrados;
}

function relativa(archivo: string): string {
  return path.relative(REPO_ROOT, archivo).split(path.sep).join("/");
}

/**
 * ESTE archivo se excluye del censo, y es la unica exclusion. Vive bajo `tests/`, que el
 * diente (b) si recorre, y contiene los identificadores prohibidos a proposito: en los
 * patrones y en las autocomprobaciones que verifican que la guardia MUERDE. Sin esta linea la
 * guardia se acusaria a si misma —y, peor, la unica forma de ponerla verde seria borrar las
 * autocomprobaciones, que es lo que la hace valer algo.
 */
const ARCHIVO_GUARDIA = path.resolve(__filename);

/** Censa `patron` sobre una lista de rutas (directorios o archivos sueltos). */
function censar(rutas: readonly string[], patron: RegExp): Hallazgo[] {
  const archivos = rutas
    .flatMap((r) => {
      const abs = path.join(REPO_ROOT, r);
      if (!fs.existsSync(abs)) return [];
      return fs.statSync(abs).isDirectory() ? archivosDeCodigo(abs) : [abs];
    })
    .filter((a) => path.resolve(a) !== ARCHIVO_GUARDIA);
  return archivos.flatMap((a) =>
    hallazgosEnFuente(fs.readFileSync(a, "utf8"), relativa(a), patron),
  );
}

// Diente (a): el enum y la columna muertos, en cualquiera de sus grafias
// (`EstadoTarifa`, `estadoTarifaSchema`, `estado_tarifa`) y la referencia `tarifa(s).status`.
const RE_STATUS_TARIFA = /estado_?tarifa|\btarifas?\.status\b/i;
const RAICES_STATUS = ["lib", "app", "db/schema.prisma"] as const;

// Diente (b): el nombre viejo del resolver, en produccion Y en tests (un test que lo nombre
// significa que alguien lo reintrodujo o que quedo un doble huerfano de la interfaz muerta).
const RE_NOMBRE_VIEJO = /TarifaVigentePorTienda/;
const RAICES_NOMBRE_VIEJO = ["lib", "app", "tests"] as const;

describe("274/T3.4 diente (a) — `tarifas.status` / `estado_tarifa` no vuelven al codigo (R13)", () => {
  it("ningun archivo de lib/, app/ ni db/schema.prisma los nombra fuera de un comentario", () => {
    const infractores = censar(RAICES_STATUS, RE_STATUS_TARIFA).map(
      (h) => `${h.archivo}:${h.linea} -> ${h.contenido}`,
    );
    expect(
      infractores,
      "la columna `tarifas.status` y el tipo `estado_tarifa` se dropearon en " +
        "20260825120000_drop_tarifa_status: no puede haber codigo que los nombre",
    ).toEqual([]);
  });

  it("el censo LLEGA de verdad a esos tres sitios (contraprueba: no esta vacio por error)", () => {
    // Un censo que no encuentra ningun archivo daria verde para siempre sin mirar nada. Se
    // afirma que los tres arboles aportan codigo y que dentro hay ficheros conocidos.
    const archivos = [
      ...archivosDeCodigo(path.join(REPO_ROOT, "lib")),
      ...archivosDeCodigo(path.join(REPO_ROOT, "app")),
    ].map(relativa);
    expect(archivos.length).toBeGreaterThan(100);
    expect(archivos).toContain("lib/repositories/TarifaVigenteRepository.ts");
    expect(archivos).toContain("lib/utils/cascada-tarifa.ts");
    expect(fs.existsSync(path.join(REPO_ROOT, "db", "schema.prisma"))).toBe(true);
  });

  it("autocomprobacion: detecta las tres grafias si alguien las reintroduce como CODIGO", () => {
    const reintroducciones = [
      `import { EstadoTarifa } from "@prisma/client";`,
      `export const estadoTarifaSchema = z.enum(["activo", "inactivo"]);`,
      `await prisma.$queryRaw\`SELECT * FROM tarifas WHERE status::estado_tarifa = 'activo'\`;`,
      `const vigentes = filas.filter((f) => tarifa.status === "activo");`,
    ];
    for (const linea of reintroducciones) {
      expect(hallazgosEnFuente(linea, "falso.ts", RE_STATUS_TARIFA), linea).toHaveLength(1);
    }
  });

  it("autocomprobacion: NO se dispara por el parrafo que documenta la retirada", () => {
    const documentacion = [
      "// 274/R11: `status` YA NO es un campo de entrada (la columna `tarifas.status` y el",
      "// tipo `estado_tarifa` se fueron con `20260825120000_drop_tarifa_status`).",
      " * Se fue con la columna `tarifas.status`.",
    ].join("\n");
    expect(hallazgosEnFuente(documentacion, "falso.ts", RE_STATUS_TARIFA)).toEqual([]);
  });
});

describe("274/T3.4 diente (b) — el nombre viejo del resolver no vuelve (R17)", () => {
  it("ningun archivo de lib/, app/ ni tests/ menciona `TarifaVigentePorTienda`", () => {
    const infractores = censar(RAICES_NOMBRE_VIEJO, RE_NOMBRE_VIEJO).map(
      (h) => `${h.archivo}:${h.linea} -> ${h.contenido}`,
    );
    expect(
      infractores,
      "el resolver se llama `TarifaVigenteRepository` / `ITarifaVigenteRepository`: " +
        "ya no resuelve «por tienda», sino por el par (tienda, zona)",
    ).toEqual([]);
  });

  it("el nombre NUEVO si existe, con sus dos archivos (el renombrado no se deshizo)", () => {
    // Sin esto, borrar el resolver entero dejaria el diente (b) en verde.
    for (const ruta of [
      "lib/repositories/TarifaVigenteRepository.ts",
      "lib/interfaces/repositories/ITarifaVigenteRepository.ts",
    ]) {
      expect(fs.existsSync(path.join(REPO_ROOT, ruta)), ruta).toBe(true);
    }
    expect(fs.existsSync(path.join(REPO_ROOT, "lib/repositories/TarifaVigentePorTiendaRepository.ts"))).toBe(false);
    expect(
      fs.existsSync(
        path.join(REPO_ROOT, "lib/interfaces/repositories/ITarifaVigentePorTiendaRepository.ts"),
      ),
    ).toBe(false);
  });

  it("autocomprobacion: detecta el nombre viejo en un import, un tipo y un `new`", () => {
    const reintroducciones = [
      `import { TarifaVigentePorTiendaRepository } from "@/lib/repositories/TarifaVigentePorTiendaRepository";`,
      `let repo: ITarifaVigentePorTiendaRepository;`,
      `const repo = new TarifaVigentePorTiendaRepository(prisma);`,
    ];
    for (const linea of reintroducciones) {
      expect(hallazgosEnFuente(linea, "falso.ts", RE_NOMBRE_VIEJO), linea).toHaveLength(1);
    }
  });

  it("`db/migrations/` queda FUERA del censo, y la cita historica sigue ahi intacta", () => {
    // Este test no es decorativo: fija por que el diente (b) no recorre el historico. Si
    // alguien "arregla" esa cita editando la migracion aplicada, `prisma migrate deploy`
    // empieza a fallar por checksum en toda base que ya la tenga. La cita se conserva; lo que
    // se protege es el codigo vivo.
    const migracion = path.join(
      REPO_ROOT,
      "db/migrations/20260715140000_cierre_detail/migration.sql",
    );
    expect(fs.existsSync(migracion)).toBe(true);
    expect(fs.readFileSync(migracion, "utf8")).toContain("TarifaVigentePorTiendaRepository");
    // Y el censo, aun asi, esta vacio: prueba de que el historico NO entra.
    expect(censar(RAICES_NOMBRE_VIEJO, RE_NOMBRE_VIEJO)).toEqual([]);
    expect((RAICES_NOMBRE_VIEJO as readonly string[]).some((r) => r.includes("migrations"))).toBe(
      false,
    );
  });
});
