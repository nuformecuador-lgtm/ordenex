import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { columnasDetalle } from "@/app/(app)/monitoreo/_components/detalle-columnas";
import { DataTable } from "@/components/shared/DataTable";
import { monedaConfig } from "@/lib/config/moneda";
import type { PaginaOrdenesDelDia } from "@/lib/interfaces/repositories/ITableroDiaRepository";
import { TableroDiaService } from "@/lib/services/TableroDiaService";
import {
  recortarPorAlcance,
  type AlcanceTableroDia,
  type OrdenDetalleDia,
} from "@/lib/types/tablero-dia";
import {
  CENTINELAS,
  TODOS_LOS_CENTINELAS,
  ordenDeListado,
  ordenDelDetalle,
} from "@/tests/fixtures/orden-detalle-dia";

import { HistorialDoble, OrdenesDoble, RepositorioDoble } from "../services/_doble-tablero-dia";

// FEATURE 260 (V1) — LA GUARDIA QUE ATA LAS DOS MITADES DEL RECORTE POR ALCANCE. R44.
//
// ─── QUE PROBLEMA RESUELVE, Y POR QUE HACIA FALTA UNA GUARDIA APARTE ───────────────────────
//
// El recorte por alcance de esta feature tiene DOS mitades y necesita las dos:
//
//   · la del DATO (R13): `recortarPorAlcance` retira flete, comision, tarifa y contacto de la
//     tienda antes de que el detalle salga del servidor. Sin ella el dato viaja al navegador
//     aunque no se pinte, y se lee con un `View source`.
//   · la de la COLUMNA (R14): la pantalla no monta las columnas que leen esos campos. Sin ella,
//     `PriceLabel` convierte el hueco en `₡0`, que se lee como «esta orden no paga flete» — una
//     afirmacion FALSA, y eso es PEOR que enseñar la cifra (R15).
//
// Cualquiera de las dos puede desaparecer sola sin romper un test de las otras: la pantalla
// seguiria pintandose, el typecheck seguiria verde y el lint no tendria nada que decir. Es la
// familia de fallo que este repo llama «el sistema no falla, aparenta», y por eso R44 exige que
// la verificacion se ponga roja si desaparece CUALQUIERA de las dos.
//
// ─── POR QUE CENTINELAS Y NO NOMBRES DE CAMPO ──────────────────────────────────────────────
//
// Las dos mitades hablan vocabularios distintos —una lista campos del DTO (`fleteConIva`), la
// otra ids de columna (`flete`)— y ninguna puede validar a la otra por comparacion directa. Se
// atan por SALIDA OBSERVABLE: un puñado de valores irrepetibles metidos en un DTO completamente
// poblado, que se buscan en el JSON del payload Y en el marcado renderizado. Serializar y
// renderizar es lo que caza un campo ANIDADO que nadie listo, que es la forma que tendria la
// fuga de verdad.
//
// ─── LAS TRES MUTACIONES ───────────────────────────────────────────────────────────────────
//
// Estas cuatro clausulas no valen nada si no pueden ponerse rojas. Se ejecutaron, una a una,
// y su salida real esta pegada en `progress/impl_260_frontend.md`:
//
//   1. `recortarPorAlcance` devuelve la orden sin tocar        ⇒ (a) y (b) rojas
//   2. el servicio deja de llamarla para alcance `zona`        ⇒ (b) roja
//   3. `columnasDetalle` deja de filtrar las restringidas      ⇒ (c) roja
//
// No se afirma que se hicieran: se pegan. Este repo ya pago por un arnes de mutaciones que
// reporto nueve supervivientes sin haber ejecutado un solo test.

const ZONA: AlcanceTableroDia = "zona";
const GLOBAL: AlcanceTableroDia = "global";

const ZONA_X = "11111111-1111-4111-8111-111111111111";
const MENSAJERO = "33333333-3333-4333-8333-333333333333";
const AHORA = new Date("2026-08-08T19:00:00.000Z");

const ACTOR_GLOBAL = { usuarioId: "u-1", rol: "maestro", zonaId: null };
const ACTOR_DE_ZONA = { usuarioId: "u-2", rol: "adminSatelite", zonaId: ZONA_X };

/* -------------------------------------------------------------------------- */
/* Los detectores                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Los centinelas presentes en un texto. Devuelve la LISTA y no un booleano a proposito: cuando
 * una clausula se pone roja, el mensaje dice CUAL sobrevivio, que es la mitad del diagnostico.
 */
function centinelasEn(texto: string, buscados: readonly string[] = TODOS_LOS_CENTINELAS): string[] {
  return buscados.filter((centinela) => texto.includes(centinela));
}

/** El detalle serializado. Es el payload tal como cruza la frontera hacia el navegador. */
function comoJson(valor: unknown): string {
  return JSON.stringify(valor);
}

/**
 * El marcado que produce la tabla del detalle con esas columnas y esa fila.
 *
 * Se renderiza la primitiva REAL (`DataTable`) y no una reimplementacion de sus celdas: una
 * copia del `resolveCell` de la tabla podria divergir de la de verdad y dejar esta clausula
 * midiendo algo que no es lo que ve el usuario.
 *
 * El separador de miles se retira del resultado —y sale de `monedaConfig`, no escrito a mano—
 * porque los importes se pintan agrupados (`₡9.999.991`) y un centinela numerico no aparece
 * literal en el marcado. Sin este paso, la clausula (c) seria verde por vacio SIEMPRE.
 */
function marcadoDe(alcance: AlcanceTableroDia, fila: OrdenDetalleDia): string {
  const html = renderToStaticMarkup(
    createElement(DataTable<OrdenDetalleDia>, {
      columns: columnasDetalle(alcance),
      data: [fila],
      rowKey: "id",
      ariaLabel: "Órdenes del día",
    }),
  );
  return html.split(monedaConfig.separadorMiles).join("");
}

/**
 * Los centinelas que UNA COLUMNA puede llegar a pintar, y por tanto los unicos con los que la
 * clausula (c) puede hablar: los tres de dinero.
 *
 * El correo y el telefono de la tienda NO estan aqui, y no es un olvido: NINGUNA columna del
 * listado de ordenes los lee, ni siquiera en alcance global. Su unica defensa es la mitad DATO
 * —clausulas (a) y (b)—, y decirlo aqui es lo que impide que alguien lea (c) como si los
 * cubriera. Que de verdad no se pintan se afirma abajo, en los dos alcances.
 */
const CENTINELAS_QUE_UNA_COLUMNA_PINTA: readonly string[] = [
  CENTINELAS.flete,
  CENTINELAS.comision,
  String(CENTINELAS.tarifa),
];

/** Los que ninguna columna pinta: si aparecieran en el marcado, alguien monto una columna nueva. */
const CENTINELAS_QUE_NINGUNA_COLUMNA_PINTA: readonly string[] = [
  CENTINELAS.email,
  CENTINELAS.telefono,
];

/* -------------------------------------------------------------------------- */
/* (a) LA MITAD DATO, unitaria: la funcion pura                                */
/* -------------------------------------------------------------------------- */

describe("(a) R13/R46 · el dato — `recortarPorAlcance` sobre un DTO poblado", () => {
  it("alcance `zona`: no sobrevive NI UN centinela al serializar la orden", () => {
    const recortada = recortarPorAlcance(ordenDelDetalle({ id: "o1" }), ZONA);
    expect(
      centinelasEn(comoJson(recortada)),
      "un campo restringido sobrevivio al recorte de alcance `zona`",
    ).toEqual([]);
  });

  it("alcance `global`: sobreviven LOS CINCO, o la clausula de arriba seria verde por vacio", () => {
    const intacta = recortarPorAlcance(ordenDelDetalle({ id: "o1" }), GLOBAL);
    expect(
      centinelasEn(comoJson(intacta)).sort(),
      "el alcance global perdio un campo: R46 prohibe recortar nada ahi",
    ).toEqual([...TODOS_LOS_CENTINELAS].sort());
  });
});

/* -------------------------------------------------------------------------- */
/* (b) LA MITAD DATO, de extremo a extremo: el SERVICIO REAL                   */
/* -------------------------------------------------------------------------- */

/** El servicio de verdad, con el repositorio del dia y el hidratador de mentira. */
function servicioConUnaOrden() {
  const pagina: PaginaOrdenesDelDia = {
    filas: [{ ordenId: "o1", resultadoDelDia: null, asignadoAt: "2026-08-08T13:00:00.000Z" }],
    total: 1,
  };
  const repo = new RepositorioDoble(
    () => [],
    () => pagina,
  );
  const ordenes = new OrdenesDoble(new Map([["o1", ordenDeListado({ id: "o1" })]]));
  return new TableroDiaService(repo, ordenes, new HistorialDoble());
}

async function payloadDelServicio(actor: {
  usuarioId: string;
  rol: string;
  zonaId: string | null;
}): Promise<string> {
  const resultado = await servicioConUnaOrden().detalle(actor, AHORA, MENSAJERO, 1);
  if (resultado.estado !== "ok") throw new Error(`se esperaba ok, llego ${resultado.motivo}`);
  // Se serializa el DETALLE ENTERO, no las ordenes: si algun dia el recorte se saltara un nivel
  // y el campo acabara colgando de otra parte de la respuesta, esto lo ve igual.
  return comoJson(resultado.detalle);
}

describe("(b) R13/R46 · el dato — el payload que devuelve el SERVICIO REAL", () => {
  it("un actor de alcance `zona` recibe un detalle SIN ningun centinela", async () => {
    expect(
      centinelasEn(await payloadDelServicio(ACTOR_DE_ZONA)),
      "un campo restringido viajo al navegador: no basta con no pintarlo, se lee con un View source",
    ).toEqual([]);
  });

  it("un actor de alcance `global` los recibe TODOS: si no, la de arriba no probaria nada", async () => {
    expect(centinelasEn(await payloadDelServicio(ACTOR_GLOBAL)).sort()).toEqual(
      [...TODOS_LOS_CENTINELAS].sort(),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* (c) LA MITAD COLUMNA: la pantalla, sobre el DTO SIN RECORTAR                */
/* -------------------------------------------------------------------------- */

describe("(c) R14/R15/R16 · la columna — la pantalla sobre un DTO SIN recortar", () => {
  // Se renderiza a proposito la fila SIN RECORTAR, «como si el servidor se hubiera olvidado».
  // Es la unica forma de medir esta mitad AISLADA: con la fila ya recortada, no montar la
  // columna y montarla dan resultados parecidos —uno pinta `₡0`— y el detector no distinguiria
  // cual de las dos mitades esta viva.
  const SIN_RECORTAR = ordenDelDetalle({ id: "o1" });

  it("alcance `zona`: la tabla no pinta NI UN centinela, aunque la fila los traiga todos", () => {
    expect(
      centinelasEn(marcadoDe(ZONA, SIN_RECORTAR), CENTINELAS_QUE_UNA_COLUMNA_PINTA),
      "una columna restringida sigue montada en alcance `zona`",
    ).toEqual([]);
  });

  it("alcance `global`: la tabla SI los pinta, o la clausula de arriba seria verde por vacio", () => {
    expect(
      centinelasEn(marcadoDe(GLOBAL, SIN_RECORTAR), CENTINELAS_QUE_UNA_COLUMNA_PINTA).sort(),
      "el alcance global dejo de pintar un importe que R16 le exige",
    ).toEqual([...CENTINELAS_QUE_UNA_COLUMNA_PINTA].sort());
  });

  it("el correo y el telefono de la tienda no los pinta NINGUNA columna, en ningun alcance", () => {
    for (const alcance of [ZONA, GLOBAL]) {
      expect(
        centinelasEn(marcadoDe(alcance, SIN_RECORTAR), CENTINELAS_QUE_NINGUNA_COLUMNA_PINTA),
        `alguien monto una columna que lee el contacto de la tienda (alcance ${alcance})`,
      ).toEqual([]);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* (d) NO VACIA: cada detector se demuestra capaz de encontrar lo que busca    */
/* -------------------------------------------------------------------------- */

describe("(d) R44 · los detectores NO son decorado", () => {
  it("el detector de JSON encuentra los cinco centinelas cuando SI estan", () => {
    // Es la forma exacta que tendria la mutacion 1: `recortarPorAlcance` devuelve la orden sin
    // tocar. Si este `expect` no encontrara nada, las clausulas (a) y (b) estarian verdes por
    // que el detector es ciego, no porque el recorte funcione.
    const sinRecortar = comoJson(ordenDelDetalle({ id: "o1" }));
    expect(centinelasEn(sinRecortar).sort()).toEqual([...TODOS_LOS_CENTINELAS].sort());
  });

  it("el detector de marcado encuentra los de dinero cuando la columna SI esta montada", () => {
    // Y esta es la forma de la mutacion 3: `columnasDetalle` deja de filtrar. Montar el juego
    // completo sobre la fila sin recortar es exactamente lo que pasaria, y el detector lo ve.
    const marcado = marcadoDe(GLOBAL, ordenDelDetalle({ id: "o1" }));
    expect(centinelasEn(marcado, CENTINELAS_QUE_UNA_COLUMNA_PINTA).sort()).toEqual(
      [...CENTINELAS_QUE_UNA_COLUMNA_PINTA].sort(),
    );
  });

  it("los centinelas de dinero SOBREVIVEN al formateo: si no, (c) no podria ponerse roja nunca", () => {
    // El motivo de que los tres sean numeros y no cadenas. `PriceLabel` hace `toValidNumber` y
    // pinta `₡0` ante cualquier cosa que no sea un numero: con un centinela de texto, la
    // columna del flete pintaria `₡0` TAMBIEN en alcance global y la clausula de no-vacuidad
    // de (c) seria imposible de satisfacer. Se afirma aqui para que nadie los "limpie".
    for (const centinela of CENTINELAS_QUE_UNA_COLUMNA_PINTA) {
      expect(Number.isFinite(Number(centinela)), `\`${centinela}\` no es un importe`).toBe(true);
    }
    expect(new Set(CENTINELAS_QUE_UNA_COLUMNA_PINTA).size).toBe(3);
  });

  it("el censo mira algo: hay columnas restringidas que quitar y centinelas que buscar", () => {
    expect(TODOS_LOS_CENTINELAS.length).toBe(5);
    expect(columnasDetalle(GLOBAL).length - columnasDetalle(ZONA).length).toBe(3);
  });
});
