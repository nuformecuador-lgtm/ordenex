import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { listarMetricas } from "@/lib/analytics/metrics";
import { resolverAlcance } from "@/lib/analytics/alcance";
import { ROLES_ANALITICA } from "@/lib/analytics/types";
import type { AlcanceMetrica, Metrica, RolAnalitica } from "@/lib/analytics/types";
import * as adaptadores from "@/lib/analytics/alcance-columnas";

// Feature 127 / T B.2 y T B.4 — GUARDIA DE ALCANCE DEL DINERO: R8, R9, R35.
//
// La 122 dejo escrito (su R25) que la ausencia de adaptador de alcance para las tablas de
// dinero NO es un olvido: para toda metrica financiera el alcance es `total` o `prohibido`,
// nunca `acotado`, asi que no hay recorte que aplicar. Este guardia vigila que la 127 no
// rompa esa equivalencia por ninguno de sus TRES lados:
//
//   1. el catalogo — si una financiera pasara a `acotado`, existiria un recorte de dinero sin
//      adaptador que lo aplique, o sea un `where` que alguien escribira a mano;
//   2. los adaptadores — si apareciera `whereWalletTienda`, alguien estaria recortando
//      ledgers con un criterio que nadie diseño;
//   3. los archivos de la 127 — si un repositorio o el servicio leyera `alcance.tiendaId`,
//      seria una rama de recorte que hoy es INALCANZABLE (financiera concedida ⇒ alcance
//      global) y que anuncia un recorte que no existe. Codigo muerto que promete privacidad.
//
// Si esto se pone rojo, la respuesta NO es aflojar el guardia ni añadir una exencion nominal:
// es diseñar el recorte del dinero ANTES de tocar la metrica.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const FINANCIERAS = listarMetricas({ dominio: "financiera" });

/* -------------------------------------------------------------------------- */
/* 1. El catalogo: total para los dos de acceso total, prohibido para el resto */
/* -------------------------------------------------------------------------- */

describe("R35 · las ocho financieras siguen siendo total/prohibido, sin medias tintas", () => {
  it("el mapa de alcance de cada financiera es exactamente el esperado", () => {
    // Escrito A MANO y no derivado de `ALCANCE_FINANCIERA`: si se leyera la misma constante
    // que se juzga, cambiarla seguiria pareciendo correcto y este guardia no diria nada.
    const esperado: Readonly<Record<RolAnalitica, AlcanceMetrica>> = {
      maestro: "total",
      admin: "total",
      adminSatelite: "prohibido",
      adminTienda: "prohibido",
      mensajero: "prohibido",
    };

    expect(FINANCIERAS.length).toBe(8);
    for (const metrica of FINANCIERAS) {
      expect({ ...metrica.alcance }, metrica.id).toEqual(esperado);
    }
  });

  it("ninguna declara `acotado` para ningun rol", () => {
    expect(FINANCIERAS.filter((m) => rolesAcotados(m).length > 0).map((m) => m.id)).toEqual([]);
  });

  it("y por eso el resolutor nunca emite un alcance recortado sobre una de ellas", () => {
    for (const metrica of FINANCIERAS) {
      for (const rol of ROLES_ANALITICA) {
        const r = resolverAlcance({ usuarioId: "u1", rol, zonaId: "z1" }, metrica.id);
        if (r.estado === "ok") expect(r.alcance.tipo, `${metrica.id}/${rol}`).toBe("global");
      }
    }
  });

  it("autocomprobacion: el detector reconoce una financiera acotada", () => {
    const infractora: Metrica = {
      id: "cuenta_por_pagar_de_mi_tienda",
      etiqueta: "Cuenta por pagar (mal)",
      descripcion: "Fixture: abre el dinero recortado al adminTienda, que es lo que R35 prohibe.",
      dominio: "financiera",
      clase: "live",
      unidad: "moneda",
      unidadDeConteo: "moneda",
      estadoProduccion: "declarada",
      granos: ["fecha", "tienda"],
      fuente: { tipo: "ledger", tablas: ["wallet_tienda_movimiento"] },
      alcance: {
        maestro: "total",
        admin: "total",
        adminSatelite: "prohibido",
        adminTienda: "acotado",
        mensajero: "prohibido",
      },
      definicion: {},
    };
    expect(rolesAcotados(infractora)).toEqual(["adminTienda"]);
  });
});

function rolesAcotados(metrica: Metrica): RolAnalitica[] {
  return ROLES_ANALITICA.filter((rol) => metrica.alcance[rol] === "acotado");
}

/* -------------------------------------------------------------------------- */
/* 2. R8 — sigue sin haber adaptador de alcance para las cinco tablas          */
/* -------------------------------------------------------------------------- */

const TABLAS_DEL_DINERO = [
  "wallet_movimiento",
  "wallet_tienda_movimiento",
  "pago_mensajero_movimiento",
  "cierre_dia",
  "cierre_bodega",
];

function nombreDeAdaptador(tabla: string): string {
  return "where" + tabla.split("_").map((p) => p[0].toUpperCase() + p.slice(1)).join("");
}

describe("R8 · la 127 no abre un adaptador de alcance para las tablas de dinero", () => {
  it("el modulo de adaptadores sigue exportando exactamente los tres de la operativa", () => {
    expect(Object.keys(adaptadores).sort()).toEqual(["whereGestionOrden", "whereOrden", "whereRollup"]);
  });

  it("no existe adaptador para ninguna de las cinco tablas del dinero", () => {
    const exportados = Object.keys(adaptadores);
    for (const tabla of TABLAS_DEL_DINERO) {
      expect(exportados, tabla).not.toContain(nombreDeAdaptador(tabla));
      expect(
        exportados.some((e) => e.toLowerCase().includes(tabla.replace(/_/g, ""))),
        tabla,
      ).toBe(false);
    }
  });

  it("autocomprobacion: el censo de nombres reconoceria un adaptador de dinero", () => {
    expect(nombreDeAdaptador("wallet_tienda_movimiento")).toBe("whereWalletTiendaMovimiento");
    const exportadosFalsos = ["whereOrden", "whereWalletTiendaMovimiento"];
    expect(exportadosFalsos).toContain(nombreDeAdaptador("wallet_tienda_movimiento"));
    expect(exportadosFalsos.some((e) => e.toLowerCase().includes("wallettiendamovimiento"))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. R9 — ningun archivo de la 127 recorta una cifra por el alcance del actor */
/* -------------------------------------------------------------------------- */

/**
 * Los modulos que design.md §3 declara, existan ya o no. Se repite la lista (y no se importa
 * del guardia de fuente) a proposito: importar de otro archivo de test arrastraria su suite
 * entera dentro de esta, y cada guardia tiene que poder leerse de arriba abajo.
 */
const ARCHIVOS_DECLARADOS = [
  "lib/types/analitica-financiera.ts",
  "lib/config/analitica-financiera.ts",
  "lib/interfaces/repositories/IIngresosAnaliticaRepository.ts",
  "lib/interfaces/repositories/IRecaudoAnaliticaRepository.ts",
  "lib/interfaces/repositories/ICuentasPorPagarAnaliticaRepository.ts",
  "lib/interfaces/repositories/IConciliacionCierresAnaliticaRepository.ts",
  "lib/interfaces/services/IAnaliticaFinancieraService.ts",
  "lib/repositories/IngresosAnaliticaRepository.ts",
  "lib/repositories/RecaudoAnaliticaRepository.ts",
  "lib/repositories/CuentasPorPagarAnaliticaRepository.ts",
  "lib/repositories/ConciliacionCierresAnaliticaRepository.ts",
  "lib/services/AnaliticaFinancieraService.ts",
  "lib/actions/analitica-financiera.ts",
];

function archivosDeLaFeature(): readonly string[] {
  return ARCHIVOS_DECLARADOS.filter((rel) => fs.existsSync(path.join(REPO_ROOT, rel)));
}

function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

/** Devuelve el motivo si el archivo contiene una rama que recorta por el alcance del actor. */
export function recorteDeDinero(nombre: string, fuente: string): string | null {
  const codigo = soloCodigo(fuente);
  const campo = codigo.match(/\balcance\s*\.\s*(tiendaId|zonaId|mensajeroId)\b/);
  if (campo) {
    return `${nombre}: lee alcance.${campo[1]} para recortar una cifra financiera; con el catalogo vigente esa rama es inalcanzable (R9)`;
  }
  const rama = codigo.match(/\balcance\s*\.\s*tipo\s*[!=]==?\s*["'](tienda|zona|mensajero)["']/);
  if (rama) {
    return `${nombre}: ramifica por alcance.tipo === "${rama[1]}" sobre dinero, un recorte que nadie diseño (R9)`;
  }
  return null;
}

describe("R9 · ninguna cifra financiera se recorta por zona, tienda ni mensajero del actor", () => {
  it("ningun archivo de la feature contiene una rama de recorte", () => {
    const infractores = archivosDeLaFeature()
      .map((rel) => recorteDeDinero(rel, fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")))
      .filter((v): v is string => v !== null);
    expect(infractores).toEqual([]);
  });

  it("el censo mira los TRECE archivos declarados, todos: no pasa por conjunto vacio ni recortado", () => {
    // Cierre del menor 1 del review (2026-08-02). El ancla era `>= 3` mas un `toContain`: se
    // podian borrar diez de los trece modulos y este censo seguia verde juzgando tres. Aqui el
    // censo tiene UN solo brazo —la lista declarada, sin descubrimiento por import— asi que la
    // igualdad exacta si se sostiene y no hay nada que mantener a mano de mas: la lista ya
    // estaba escrita, lo unico que cambia es que ahora se exige entera.
    const censados = archivosDeLaFeature();
    expect([...censados].sort()).toEqual([...ARCHIVOS_DECLARADOS].sort());
    for (const rel of censados) {
      expect(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8").length, rel).toBeGreaterThan(0);
    }
  });

  it("autocomprobacion: detecta el recorte por tienda que R9 declara como mutacion", () => {
    const infractor = `
      import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
      export class CuentasPorPagarAnaliticaRepository {
        async saldo(consulta: ConsultaAnalitica) {
          const alcance = consulta.alcance;
          const where = alcance.tipo === "global" ? {} : { tiendaId: alcance.tiendaId };
          return this.prisma.walletTiendaMovimiento.groupBy({ by: ["tipo"], where });
        }
      }
    `;
    const v = recorteDeDinero("infractor.ts", infractor);
    expect(v).not.toBeNull();
    expect(v).toContain("tiendaId");
  });

  it("autocomprobacion: detecta tambien la rama por alcance.tipo", () => {
    const infractor = `
      export function recorta(consulta) {
        if (consulta.alcance.tipo === "mensajero") return { mensajeroId: "x" };
        return {};
      }
    `;
    expect(recorteDeDinero("rama.ts", infractor)).not.toBeNull();
  });

  it("no marca la prosa que EXPLICA por que no se usa el alcance", () => {
    const legitimo = `
      // No se usa consulta.alcance (R9): con el catalogo vigente el alcance de una
      // financiera concedida es siempre global. Nada de alcance.tiendaId aqui.
      export const nada = 1;
    `;
    expect(recorteDeDinero("prosa.ts", legitimo)).toBeNull();
  });
});
