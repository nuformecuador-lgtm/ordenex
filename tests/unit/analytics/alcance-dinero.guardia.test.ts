import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import * as adaptadores from "@/lib/analytics/alcance-columnas";
import { ALCANCE_PRODUCTOS, ALCANCE_PRODUCTOS_DINERO, METRICAS } from "@/lib/analytics/metrics";
import type { Metrica, TablaAnalitica } from "@/lib/analytics/types";
import { ROLES_ANALITICA } from "@/lib/analytics/types";
import { resolverAlcance } from "@/lib/analytics/alcance";
import { quitarComentarios } from "../../fixtures/sin-comentarios";

// Feature 122 / T3.3 — GUARDIA del DINERO SIN RECORTE (R25).
//
// La 122 NO ofrece adaptador de alcance para las cinco tablas de dinero, y eso no es un
// olvido: para toda metrica financiera el alcance es `total` o `prohibido`
// (`lib/analytics/metrics.ts`), nunca `acotado`. El guardia vigila LOS DOS LADOS de esa
// equivalencia, porque romper cualquiera de ellos abre un agujero distinto:
//   - si aparece un adaptador de dinero, alguien esta recortando ledgers con un criterio
//     que nadie diseno;
//   - si una metrica financiera pasa a `acotado`, existe un recorte de dinero SIN
//     adaptador que lo aplique, o sea un `where` que alguien escribira a mano.
//
// Si esto se pone rojo, la respuesta no es aflojar el guardia: es disenar el recorte del
// dinero ANTES de tocar la metrica (aviso dirigido a la 127).

const TABLAS_DEL_DINERO: readonly TablaAnalitica[] = [
  "wallet_movimiento",
  "wallet_tienda_movimiento",
  "pago_mensajero_movimiento",
  "cierre_dia",
  "cierre_bodega",
];

const FINANCIERAS = METRICAS.filter((m) => m.dominio === "financiera");

/** Nombre de adaptador que delataria un recorte de dinero: `whereWalletMovimiento`, etc. */
function nombreDeAdaptador(tabla: string): string {
  return "where" + tabla.split("_").map((p) => p[0].toUpperCase() + p.slice(1)).join("");
}

describe("R25 · no hay adaptador de alcance para las tablas de dinero", () => {
  it("el modulo de adaptadores exporta exactamente los tres de la operativa", () => {
    expect(Object.keys(adaptadores).sort()).toEqual([
      "whereGestionOrden",
      "whereOrden",
      "whereRollup",
    ]);
  });

  it("no exporta adaptador para wallet, pago al mensajero ni cierres", () => {
    const exportados = Object.keys(adaptadores);
    for (const tabla of TABLAS_DEL_DINERO) {
      expect(exportados, tabla).not.toContain(nombreDeAdaptador(tabla));
      expect(exportados.some((e) => e.toLowerCase().includes(tabla.replace(/_/g, "")))).toBe(false);
    }
  });

  it("autocomprobacion: el censo de nombres reconoceria un adaptador de dinero", () => {
    expect(nombreDeAdaptador("wallet_movimiento")).toBe("whereWalletMovimiento");
    expect(nombreDeAdaptador("cierre_dia")).toBe("whereCierreDia");
    const exportadosFalsos = ["whereOrden", "whereWalletMovimiento"];
    expect(exportadosFalsos).toContain(nombreDeAdaptador("wallet_movimiento"));
  });
});

describe("R25 · ninguna metrica financiera declara alcance acotado", () => {
  it("las 10 financieras solo declaran total o prohibido", () => {
    // 8 de la 135 + `dinero_en_caja` y `ganancia_ordenex` de la 173 (P4).
    expect(FINANCIERAS.length).toBe(10);
    for (const metrica of FINANCIERAS) {
      for (const rol of ROLES_ANALITICA) {
        expect(["total", "prohibido"], `${metrica.id}/${rol}`).toContain(metrica.alcance[rol]);
      }
    }
  });

  it("por eso el resolutor nunca emite un alcance recortado sobre una metrica financiera", () => {
    for (const metrica of FINANCIERAS) {
      for (const rol of ROLES_ANALITICA) {
        const r = resolverAlcance(
          { usuarioId: "u1", rol, zonaId: "z1" },
          metrica.id,
        );
        if (r.estado === "ok") expect(r.alcance.tipo, `${metrica.id}/${rol}`).toBe("global");
      }
    }
  });

  it("autocomprobacion: detecta una metrica financiera acotada inyectada a mano", () => {
    const infractora: Metrica = {
      id: "cuenta_por_pagar_para_la_tienda",
      etiqueta: "Cuenta por pagar (mal)",
      descripcion: "Fixture: abre el dinero recortado al adminTienda, que es lo que R25 prohibe.",
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

    const acotadas = ROLES_ANALITICA.filter((rol) => infractora.alcance[rol] === "acotado");
    expect(acotadas).toEqual(["adminTienda"]);
    // La misma afirmacion que protege el catalogo, aplicada al fixture, falla:
    expect(Object.values(infractora.alcance)).toContain("acotado");
  });
});

// ============================================================================================
// FICHA 347 (2026-09-01) — EL BLOQUE NUEVO. Esta guardia sale de aqui afirmando MAS que antes.
//
// ⚠ NO ES UNA EXCEPCION Y NO ES UNA ALLOWLIST. Los dos bloques de arriba NO se tocan:
// `alcance-columnas.ts` sigue exportando exactamente tres adaptadores y las metricas financieras
// del catalogo siguen sin `acotado`.
//
// EL CHOQUE, DICHO EN VEZ DE ESCONDIDO DETRAS DEL VERDE. La ficha 347 sirve DINERO por producto y
// declara `acotado` para `adminTienda`. No rompe este test —`ALCANCE_PRODUCTOS_DINERO` no es una
// `Metrica`, no lleva `dominio`, asi que `FINANCIERAS` no la ve— pero choca con su DOCTRINA: es
// una lectura que emite dinero recortado, colandose por la puerta de que esa vertical vive fuera
// del catalogo de 25 metricas.
//
// POR QUE SE APRUEBA. No es un permiso nuevo: `DetalleMovimientoService` (`ROL_TIENDA =
// "adminTienda"`) YA le entrega a la tienda su propio libro y el detalle por orden de sus
// movimientos en `/mi-wallet`, con `tiendaId` en el `WHERE`. La 347 es de la misma naturaleza —
// la tienda ve SU dinero— y no lee ningun ledger como universo: parte de `orden`, con el MISMO
// `where` y el MISMO alcance del analisis de productos, y DERIVA el dinero de las entradas que
// esas ordenes ya congelaron. `cierre_dia` solo se une para leer su `estado`, y `cierre_detail`
// para leer las entradas de la formula.
//
// LO QUE ESTE BLOQUE ATORNILLA, y es lo que cierra el agujero que la guardia teme:
//
//   (1) R2 — `ALCANCE_PRODUCTOS_DINERO[rol]` solo puede ser `prohibido` o EXACTAMENTE
//       `ALCANCE_PRODUCTOS[rol]`. Consecuencia: es IMPOSIBLE que el dinero se sirva con un
//       recorte que el volumen no tenga ya, asi que nunca hara falta un `where` de dinero nuevo.
//       Quien quisiera uno tendria que ensanchar antes el alcance del VOLUMEN, que es una
//       decision visible y con su propio guardia.
//   (2) El repositorio de dinero NO ESCRIBE NINGUNA CONDICION DE RECORTE PROPIA: importa
//       `condicionesDeConsulta` y no compara ninguna columna de recorte por su cuenta.
//
// Las dos, con AUTOCOMPROBACION: sin ella una guardia esta verde por vacio, que es el modo de
// fallo que este arbol ha visto tres veces.
// ============================================================================================

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const FUENTE_DINERO = path.join(REPO_ROOT, "lib", "repositories", "DineroProductosRepository.ts");

/**
 * Las columnas CANONICAS de recorte que `lib/analytics/alcance-columnas.ts` declara sobre
 * `orden`. Comparar una de ellas es RECORTAR; proyectarla (`o."tienda_id" AS tienda_id`) no.
 */
const COLUMNAS_DE_RECORTE = ["tienda_id", "zona_id", "mensajero_asignado_id"];

/**
 * Una comparacion SOBRE una columna de recorte de `orden`: la columna seguida de un operador.
 * Es lo que distingue un `where` escrito a mano de una proyeccion o de un `JOIN` por FK.
 */
function recortesEscritosAMano(codigo: string): string[] {
  const encontrados: string[] = [];
  for (const columna of COLUMNAS_DE_RECORTE) {
    const patron = new RegExp(`o\\."${columna}"\\s*(=|<>|!=|<|>|IN\\b|LIKE\\b)`, "gi");
    for (const m of codigo.matchAll(patron)) encontrados.push(`${columna}${m[1]}`);
  }
  return encontrados;
}

describe("FICHA 347 · el dinero por producto NO se recorta con un criterio propio", () => {
  it("(1) R2 · para los CINCO roles: prohibido, o EXACTAMENTE el alcance del volumen", () => {
    // Se recorre `ROLES_ANALITICA`, no una lista escrita: un sexto rol entra aqui solo.
    expect(ROLES_ANALITICA.length).toBe(5);
    for (const rol of ROLES_ANALITICA) {
      const dinero = ALCANCE_PRODUCTOS_DINERO[rol];
      const volumen = ALCANCE_PRODUCTOS[rol];
      expect(
        dinero === "prohibido" || dinero === volumen,
        `${rol}: el dinero (${dinero}) tiene un recorte que el volumen (${volumen}) no tiene. ` +
          "Ensancha primero el alcance del VOLUMEN, que es la decision visible.",
      ).toBe(true);
    }
  });

  it("(1 bis) y ningun rol tiene el dinero MAS ancho que el volumen", () => {
    // El caso concreto que R2 impide: `prohibido` en volumen y algo en dinero.
    for (const rol of ROLES_ANALITICA) {
      if (ALCANCE_PRODUCTOS[rol] === "prohibido") {
        expect(ALCANCE_PRODUCTOS_DINERO[rol], rol).toBe("prohibido");
      }
    }
  });

  it("(1 ter) AUTOCOMPROBACION · una tabla sintetica que viola R2 se detecta", () => {
    const infractora: Record<string, string> = {
      ...ALCANCE_PRODUCTOS_DINERO,
      // Dinero acotado para un rol que NO ve productos: el agujero exacto.
      adminSatelite: "acotado",
    };
    const violaciones = ROLES_ANALITICA.filter(
      (rol) =>
        infractora[rol] !== "prohibido" && infractora[rol] !== (ALCANCE_PRODUCTOS[rol] as string),
    );
    expect(violaciones).toEqual(["adminSatelite"]);

    // Y la variante contraria: un recorte PROPIO donde el volumen es total.
    const otra: Record<string, string> = { ...ALCANCE_PRODUCTOS_DINERO, maestro: "acotado" };
    expect(
      ROLES_ANALITICA.filter(
        (rol) => otra[rol] !== "prohibido" && otra[rol] !== (ALCANCE_PRODUCTOS[rol] as string),
      ),
    ).toEqual(["maestro"]);
  });

  it("(2) el repositorio de dinero IMPORTA `condicionesDeConsulta` y la usa", () => {
    const codigo = quitarComentarios(fs.readFileSync(FUENTE_DINERO, "utf8"));
    expect(codigo).toContain("@/lib/repositories/ConteoPorStatusRepository");
    expect(codigo).toContain("condicionesDeConsulta(consulta)");
  });

  it("(2 bis) y NO escribe ninguna condicion de recorte propia", () => {
    // Se lee el codigo SIN comentarios: la prosa de este arbol nombra las columnas a proposito
    // (la cabecera de ese mismo archivo lo hace), y sin quitarlos el censo leeria la prosa.
    const codigo = quitarComentarios(fs.readFileSync(FUENTE_DINERO, "utf8"));
    expect(
      recortesEscritosAMano(codigo),
      "el repositorio de dinero compara una columna de recorte por su cuenta: eso es un `where` " +
        "de dinero escrito a mano, que es exactamente lo que esta guardia existe para impedir.",
    ).toEqual([]);
  });

  it("(2 ter) AUTOCOMPROBACION · una fuente sintetica con `tienda_id` propio SI se detecta", () => {
    const sintetica = [
      'const where = Prisma.join(condicionesDeConsulta(consulta), " AND ");',
      'SELECT o."tienda_id" AS tienda_id FROM "orden" o',
      'WHERE ${where} AND o."tienda_id" = ${algo}',
    ].join("\n");
    expect(recortesEscritosAMano(sintetica)).toEqual(["tienda_id="]);

    // Y las variantes: `IN`, y la columna de zona.
    expect(recortesEscritosAMano('o."zona_id" IN (1,2)')).toEqual(["zona_idIN"]);
    // La PROYECCION sola no cuenta: no recorta nada.
    expect(recortesEscritosAMano('SELECT o."tienda_id" AS tienda_id FROM "orden" o')).toEqual([]);
    // Ni el JOIN por FK, que tampoco filtra.
    expect(recortesEscritosAMano('JOIN "usuario" t ON t."id" = o."tienda_id"')).toEqual([]);
  });

  it("(3) los DOS bloques anteriores siguen en pie: nada se relajo", () => {
    // Se re-afirma aqui, en el bloque nuevo, para que quede escrito que esta ficha NO toca
    // ninguna de las dos garantias de la 122.
    expect(Object.keys(adaptadores).sort()).toEqual([
      "whereGestionOrden",
      "whereOrden",
      "whereRollup",
    ]);
    for (const metrica of FINANCIERAS) {
      for (const rol of ROLES_ANALITICA) {
        expect(metrica.alcance[rol], `${metrica.id}/${rol}`).not.toBe("acotado");
      }
    }
    // Y `ALCANCE_PRODUCTOS_DINERO` NO es una metrica del catalogo: `METRICAS` sigue en 25.
    expect(METRICAS.length).toBe(25);
    expect(METRICAS.some((m) => m.id.includes("productos"))).toBe(false);
  });
});
