import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { CachedAnaliticaOperativaRollupRepository } from "@/lib/repositories/CachedAnaliticaOperativaRollupRepository";
import type {
  CubosDelDiaEnCurso,
  IAnaliticaOperativaVivaRepository,
} from "@/lib/interfaces/repositories/IAnaliticaOperativaVivaRepository";
import { cacheFalsa } from "./_cache-falsa";
import { AHORA, HOY_CR, consultaDe, cubo, MAESTRO, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 128 / T4.3 — R3. EL DIA EN CURSO NO SE CACHEA, Y NO POR POLITICA.
//
// El punto del dia en curso —el que la 126 marca `parcial: true` con su `corteAt`— se sirve
// desde `IAnaliticaOperativaVivaRepository`, que lee las tablas VIVAS (`orden`,
// `gestion_orden`, `orden_historial_estado`). Ese repositorio NO se decora: no hay una regla
// que alguien pueda olvidar, no hay camino.
//
// El test tiene DOS mitades a proposito:
//   (a) COMPORTAMIENTO — con el rollup decorado y el vivo desnudo, una gestion posterior se ve
//       en la segunda consulta aunque la parte cerrada venga de cache;
//   (b) ESTRUCTURA — el composition root real (`lib/actions/analitica-operativa.ts`) decora el
//       repositorio de rollup y NO el vivo. Sin (b), la mutacion nombrada en el spec —decorar
//       tambien el vivo en el composition root— no mataria nada: (a) construye su propio
//       cableado y seguiria verde.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

/** Repositorio vivo cuyo resultado CAMBIA entre consultas, como la operacion de verdad. */
function vivaMutable(inicial: number): {
  repo: IAnaliticaOperativaVivaRepository;
  fijar: (entregas: number) => void;
  llamadas: () => number;
} {
  let entregas = inicial;
  let llamadas = 0;
  const repo: IAnaliticaOperativaVivaRepository = {
    async agingPorEstado() {
      return [];
    },
    async cubosDelDiaEnCurso(): Promise<CubosDelDiaEnCurso> {
      llamadas += 1;
      return { cubos: [cubo({ fecha: HOY_CR, entregas })], entregasVigentes: [] };
    },
  };
  return { repo, fijar: (n) => (entregas = n), llamadas: () => llamadas };
}

describe("R3 · el punto parcial de hoy refleja una gestion posterior aunque la parte cerrada venga de cache", () => {
  it("el dia en curso se recalcula en cada consulta", async () => {
    const vivo = vivaMutable(2);
    const cerrado = rollupFalso([cubo({ fecha: "2026-08-01", entregas: 10 })]);
    const servicio = servicioCon(
      new CachedAnaliticaOperativaRollupRepository(cerrado, cacheFalsa()),
      vivo.repo,
    );
    // Rango que cruza dias cerrados Y el dia en curso.
    const consulta = consultaDe(
      "entregas",
      MAESTRO,
      { rango: "personalizado", desde: "2026-08-01", hasta: HOY_CR },
      AHORA,
    );

    const primera = await servicio.consultar(consulta);
    const puntoHoy = (s: typeof primera) => s.puntos.find((p) => p.fecha === HOY_CR);
    expect(puntoHoy(primera)?.valor).toBe(2);
    expect(puntoHoy(primera)?.parcial).toBe(true);

    // Llega una gestion mas. NADIE invalida: el dia en curso no depende de la invalidacion.
    vivo.fijar(5);
    const segunda = await servicio.consultar(consulta);

    expect(puntoHoy(segunda)?.valor).toBe(5);
    expect(puntoHoy(segunda)?.corteAt).toBeDefined();
    // Y la parte CERRADA si vino de cache: el rollup se consulto una sola vez.
    expect(cerrado.llamadasAgregar).toHaveLength(1);
    // El vivo, las dos.
    expect(vivo.llamadas()).toBe(2);
  });
});

describe("R3 · el composition root decora el rollup y NO el repositorio vivo", () => {
  const fuente = fs.readFileSync(
    path.join(REPO_ROOT, "lib", "actions", "analitica-operativa.ts"),
    "utf8",
  );

  it("`AnaliticaOperativaRollupRepository` va dentro de `decorarRollupConCache`", () => {
    expect(fuente).toMatch(
      /decorarRollupConCache\(\s*new AnaliticaOperativaRollupRepository\(prisma\)/,
    );
  });

  it("`AnaliticaOperativaVivaRepository` se pasa DESNUDO", () => {
    // Si alguien lo envolviera, el dia en curso se serviria congelado y el `corteAt` mentiria.
    expect(fuente).toMatch(/^\s*new AnaliticaOperativaVivaRepository\(prisma\),\s*$/m);
    expect(fuente).not.toMatch(/decorar\w*\([^)]*AnaliticaOperativaVivaRepository/);
    expect(fuente).not.toMatch(/AnaliticaOperativaVivaRepository\(prisma\)\s*\)/);
  });

  it("y la cache se cablea UNA sola vez en el arbol operativo", () => {
    expect(fuente.match(/decorarRollupConCache\(/g)).toHaveLength(1);
  });
});
