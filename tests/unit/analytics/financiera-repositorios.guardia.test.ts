import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { prepararConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ActorAnalitica } from "@/lib/analytics/alcance";
import { IngresosAnaliticaRepository } from "@/lib/repositories/IngresosAnaliticaRepository";
import { RecaudoAnaliticaRepository } from "@/lib/repositories/RecaudoAnaliticaRepository";
import { CuentasPorPagarAnaliticaRepository } from "@/lib/repositories/CuentasPorPagarAnaliticaRepository";
import { ConciliacionCierresAnaliticaRepository } from "@/lib/repositories/ConciliacionCierresAnaliticaRepository";
import { fakePrismaQueFalla } from "./_fake-prisma-dinero";

// Feature 127 / T C.5 — GUARDIA TRANSVERSAL DE LOS REPOSITORIOS: R30 y R32.
//
// Dos cosas que un repositorio de dinero no puede hacer, y que ninguna de las dos se ve en el
// resultado si nadie las vigila:
//
//  1. **Derivar** (R30). Si la resta `creditos − debitos` se hace aqui, nace una SEGUNDA
//     definicion de "saldo" al lado de la que `/mi-wallet` le enseña a la tienda, y las dos
//     pueden divergir. Dos cifras del mismo dinero es el bug caro de esta feature, y no se
//     manifiesta como un error: se manifiesta como una discusion.
//  2. **Silenciar** (R32). Un `try { ... } catch { return "0.00" }` convierte una base caida en
//     un tablero que dice que hoy no hubo ingresos. Es la peor mentira posible en dinero, y es
//     exactamente el atajo que uno escribe cuando quiere que el tablero "no se rompa".
//
// El censo es de TEXTO porque los tipos no expresan "aqui no se resta". La parte de ejecucion
// —el error de base se propaga— va debajo y cubre los CINCO metodos, uno a uno: un guardia de
// texto no ve un `catch` escrito en un helper importado.
//
// La TANDA C esta COMPLETA desde C.4 (⟨D10⟩ cerro la contradiccion R4 ↔ R23): el censo mira los
// CUATRO repositorios y exige que esten los cuatro, para que no pueda quedarse mudo por una
// ausencia que ya no es legitima. La lista de propagacion pasa de cinco metodos a OCHO.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

const REPOSITORIOS_DE_LA_127 = [
  "lib/repositories/IngresosAnaliticaRepository.ts",
  "lib/repositories/RecaudoAnaliticaRepository.ts",
  "lib/repositories/CuentasPorPagarAnaliticaRepository.ts",
  "lib/repositories/ConciliacionCierresAnaliticaRepository.ts",
];

function existentes(): readonly string[] {
  return REPOSITORIOS_DE_LA_127.filter((rel) => fs.existsSync(path.join(REPO_ROOT, rel)));
}

function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

/* -------------------------------------------------------------------------- */
/* Los dos detectores                                                          */
/* -------------------------------------------------------------------------- */

/** Aritmetica de derivacion: la que produce un saldo, un neto o una diferencia. */
const DERIVACION = /\.\s*(sub|minus|add|plus|times|mul|div|dividedBy|negated)\s*\(/;

export function derivaEnElRepositorio(nombre: string, fuente: string): string | null {
  const codigo = soloCodigo(fuente);
  const m = codigo.match(DERIVACION);
  if (m) {
    return `${nombre}: hace aritmetica de derivacion (${m[1]}) dentro del repositorio; eso es del servicio (R30)`;
  }
  if (/\bparseFloat\s*\(|\.\s*toNumber\s*\(/.test(codigo)) {
    return `${nombre}: convierte dinero a number, que R27 prohibe en toda frontera`;
  }
  return null;
}

export function silenciaErrores(nombre: string, fuente: string): string | null {
  const codigo = soloCodigo(fuente);
  if (/\bcatch\s*[({]/.test(codigo) || /\btry\s*\{/.test(codigo)) {
    return `${nombre}: contiene try/catch; un fallo de consulta tiene que propagarse (R32)`;
  }
  if (/["']0\.00["']/.test(codigo)) {
    return `${nombre}: escribe el literal "0.00"; el cero legitimo sale de formatear un Decimal, no de un valor por defecto`;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* 1. El censo real                                                            */
/* -------------------------------------------------------------------------- */

describe("R30/R32 · censo sobre los repositorios de la 127", () => {
  it("el censo mira archivos de verdad: los CUATRO de las tareas C.1-C.4 existen", () => {
    const hay = existentes();
    expect([...hay].sort()).toEqual([...REPOSITORIOS_DE_LA_127].sort());
    for (const rel of hay) {
      expect(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8").length, rel).toBeGreaterThan(500);
    }
  });

  it("ninguno deriva: la resta con signo vive en el servicio", () => {
    const infractores = existentes()
      .map((rel) => derivaEnElRepositorio(rel, fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")))
      .filter((v): v is string => v !== null);
    expect(infractores).toEqual([]);
  });

  it("ninguno silencia un fallo de base ni devuelve ceros por defecto", () => {
    const infractores = existentes()
      .map((rel) => silenciaErrores(rel, fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")))
      .filter((v): v is string => v !== null);
    expect(infractores).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Autocomprobacion: los detectores discriminan                             */
/* -------------------------------------------------------------------------- */

const FIXTURE_LEGITIMO = `
export class IngresosAnaliticaRepository {
  async sumarPorCategoria(consulta) {
    const grupos = await this.prisma.walletMovimiento.groupBy({ by: ["categoria"], _sum: { monto: true } });
    return grupos.map((g) => ({ categoria: g.categoria, suma: (g._sum.monto ?? new Prisma.Decimal(0)).toFixed(2) }));
  }
}
`;

describe("autocomprobacion de los dos detectores", () => {
  it("acepta el repositorio que solo consulta y formatea", () => {
    expect(derivaEnElRepositorio("legitimo.ts", FIXTURE_LEGITIMO)).toBeNull();
    expect(silenciaErrores("legitimo.ts", FIXTURE_LEGITIMO)).toBeNull();
  });

  it("rechaza el que resta el saldo dentro del repositorio", () => {
    const infractor = FIXTURE_LEGITIMO.replace(
      "return grupos.map",
      "const saldo = creditos.sub(debitos);\n    return grupos.map",
    );
    expect(derivaEnElRepositorio("resta.ts", infractor)).toContain("sub");
  });

  it("rechaza el que devuelve ceros cuando la base falla", () => {
    const infractor = `
      export class X {
        async sumar(consulta) {
          try {
            return await this.prisma.walletMovimiento.groupBy({ by: ["categoria"] });
          } catch {
            return [{ categoria: "ingreso_flete", suma: "0.00" }];
          }
        }
      }
    `;
    expect(silenciaErrores("cero.ts", infractor)).toContain("try/catch");
  });

  it("rechaza el que pasa el dinero por number", () => {
    const infractor = FIXTURE_LEGITIMO.replace(".toFixed(2)", ".toNumber()");
    expect(derivaEnElRepositorio("number.ts", infractor)).toContain("number");
  });

  it("no marca la prosa que EXPLICA por que no se resta aqui", () => {
    const conProsa = `// Aqui no se hace creditos.sub(debitos) ni un try { } catch { return "0.00" }.\n${FIXTURE_LEGITIMO}`;
    expect(derivaEnElRepositorio("prosa.ts", conProsa)).toBeNull();
    expect(silenciaErrores("prosa.ts", conProsa)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 3. R32 en ejecucion: el error de base SE PROPAGA, en los cinco metodos      */
/* -------------------------------------------------------------------------- */

const MAESTRO: ActorAnalitica = { usuarioId: "u-maestro", rol: "maestro" };
const AHORA = new Date("2026-08-02T15:00:00.000Z");

function consultaDe(metricaId: string): ConsultaAnalitica {
  const r = prepararConsultaAnalitica({ rango: "dia" }, MAESTRO, metricaId, AHORA);
  if (r.status !== "ok") throw new Error(`no se pudo preparar la consulta de ${metricaId}`);
  return r.consulta;
}

describe("R32 · un fallo de la base se propaga; nunca se convierte en un cero", () => {
  const caida = new Error("could not connect to server: Connection refused");
  const cliente = fakePrismaQueFalla(caida);

  const casos: readonly { readonly nombre: string; readonly ejecutar: () => Promise<unknown> }[] = [
    {
      nombre: "IngresosAnaliticaRepository.sumarPorCategoria",
      ejecutar: () =>
        new IngresosAnaliticaRepository(cliente).sumarPorCategoria(consultaDe("ingreso_flete")),
    },
    {
      nombre: "RecaudoAnaliticaRepository.porMetodoDeCierresResueltos",
      ejecutar: () =>
        new RecaudoAnaliticaRepository(cliente).porMetodoDeCierresResueltos(
          consultaDe("cod_recaudado"),
        ),
    },
    {
      nombre: "RecaudoAnaliticaRepository.porTiendaDeLedger",
      ejecutar: () =>
        new RecaudoAnaliticaRepository(cliente).porTiendaDeLedger(consultaDe("cod_recaudado")),
    },
    {
      nombre: "CuentasPorPagarAnaliticaRepository.saldoPorTiendaAlCorte",
      ejecutar: () =>
        new CuentasPorPagarAnaliticaRepository(cliente).saldoPorTiendaAlCorte(
          consultaDe("cuenta_por_pagar_tienda"),
        ),
    },
    {
      nombre: "CuentasPorPagarAnaliticaRepository.cuentaPorPagarMensajerosAlCorte",
      ejecutar: () =>
        new CuentasPorPagarAnaliticaRepository(cliente).cuentaPorPagarMensajerosAlCorte(
          consultaDe("cuenta_por_pagar_mensajero"),
        ),
    },
    {
      nombre: "ConciliacionCierresAnaliticaRepository.contarCierresPorEstado",
      ejecutar: () =>
        new ConciliacionCierresAnaliticaRepository(cliente).contarCierresPorEstado(
          consultaDe("conciliacion_cierres"),
        ),
    },
    {
      nombre: "ConciliacionCierresAnaliticaRepository.totalesDeCierresAprobados",
      ejecutar: () =>
        new ConciliacionCierresAnaliticaRepository(cliente).totalesDeCierresAprobados(
          consultaDe("conciliacion_cierres"),
        ),
    },
    {
      nombre: "ConciliacionCierresAnaliticaRepository.sumarLedgerPorOrigenDeCierre",
      ejecutar: () =>
        // Con la lista VACIA el metodo no consulta y no puede fallar: se le pasan ids para que
        // el error de base tenga por donde subir.
        new ConciliacionCierresAnaliticaRepository(cliente).sumarLedgerPorOrigenDeCierre(
          consultaDe("conciliacion_cierres"),
          ["c1"],
        ),
    },
  ];

  it("los OCHO metodos publicos de la TANDA C estan cubiertos", () => {
    // El numero es a proposito: cuando un repositorio gane un metodo, este caso obliga a mirar
    // la lista en vez de dejarlo sin cubrir en silencio.
    expect(casos).toHaveLength(8);
  });

  for (const caso of casos) {
    it(`${caso.nombre} deja subir el error tal cual`, async () => {
      await expect(caso.ejecutar()).rejects.toBe(caida);
    });
  }
});
