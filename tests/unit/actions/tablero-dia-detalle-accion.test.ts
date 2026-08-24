import { describe, expect, it } from "vitest";

import { leerDetalleMensajeroDia } from "@/lib/actions/tablero-dia";
import { TableroDiaService } from "@/lib/services/TableroDiaService";
import type { ResultadoDetalleDia } from "@/lib/types/tablero-dia";

import { ordenDeListado } from "@/tests/fixtures/orden-detalle-dia";

import { HistorialDoble, OrdenesDoble, RepositorioDoble } from "../services/_doble-tablero-dia";

// Feature 192 (B7.7) — R42, R62, R63.
//
// LOS TRES CASOS MALOS SON INDISTINGUIBLES, y ese es todo el punto de este archivo:
//   (a) el mensajero no existe,
//   (b) existe pero cae fuera del alcance del actor,
//   (c) existe, esta dentro del alcance y no tiene ordenes hoy.
//
// Si (b) respondiera distinto de (a), cualquiera podria enumerar los mensajeros de otra zona
// pidiendo detalles: la respuesta seria el oraculo. Por eso los tres recorren el MISMO camino
// —resolver alcance, una consulta acotada, cero filas— y devuelven la misma forma.
//
// El "ni por tiempo de respuesta" de R42 no se mide con un cronometro (seria un test flaky):
// se mide comprobando que los tres hacen EXACTAMENTE el mismo trabajo, una sola consulta con
// los mismos parametros. Un caso que respondiera antes seria un caso con una rama propia.

const ZONA_X = "11111111-1111-4111-8111-111111111111";
const ZONA_Y = "22222222-2222-4222-8222-222222222222";
const AHORA = new Date("2026-08-08T19:00:00.000Z");

const INEXISTENTE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DE_OTRA_ZONA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SIN_ORDENES_HOY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const SATELITE_X = { usuarioId: "u-sat", rol: "adminSatelite", zonaId: ZONA_X };

/**
 * Un mundo donde `DE_OTRA_ZONA` SI tiene ordenes, pero de la zona Y. El recorte del `WHERE`
 * es lo que hace que el satelite de X no vea ninguna: el doble lo reproduce devolviendo filas
 * solo cuando el filtro coincide con la zona de esas ordenes.
 */
function montar(): { repo: RepositorioDoble; service: TableroDiaService } {
  const repo = new RepositorioDoble(
    () => [],
    (filtro, mensajeroId) =>
      mensajeroId === DE_OTRA_ZONA && filtro.tipo === "zona" && filtro.zonaId === ZONA_Y
        ? {
            filas: [
              { ordenId: "o1", resultadoDelDia: null, asignadoAt: AHORA.toISOString() },
            ],
            total: 1,
          }
        : { filas: [], total: 0 },
  );
  // FEATURE 260 (B7) — el detalle ahora HIDRATA. El hidratador sabe resolver esa unica orden,
  // asi que el caso "el mensajero de otra zona SI existe" sigue devolviendo una fila de verdad
  // y no un vacio que pareceria confirmar lo contrario.
  const ordenes = new OrdenesDoble(new Map([["o1", ordenDeListado({ id: "o1" })]]));
  return { repo, service: new TableroDiaService(repo, ordenes, new HistorialDoble()) };
}

/** La respuesta con el id pedido normalizado: lo unico que legitimamente varia es el eco. */
function normalizar(r: ResultadoDetalleDia): unknown {
  if (r.estado !== "ok") return r;
  return { ...r, detalle: { ...r.detalle, mensajeroId: "<el que se pidio>" } };
}

async function pedir(mensajeroId: unknown, service: TableroDiaService) {
  return leerDetalleMensajeroDia(
    { mensajeroId },
    { service, getActor: async () => SATELITE_X, now: () => AHORA },
  );
}

describe("leerDetalleMensajeroDia — los tres casos malos", () => {
  it("mensajero inexistente, de otra zona y sin ordenes hoy devuelven la MISMA respuesta (R42/R63)", async () => {
    const { service } = montar();

    const inexistente = await pedir(INEXISTENTE, service);
    const otraZona = await pedir(DE_OTRA_ZONA, service);
    const sinOrdenes = await pedir(SIN_ORDENES_HOY, service);

    const esperado = {
      estado: "ok",
      detalle: {
        mensajeroId: "<el que se pidio>",
        fecha: "2026-08-08",
        ordenes: [],
        total: 0,
        pagina: 1,
        pageSize: 25,
        // FEATURE 260 (R12) — el alcance viaja tambien en el vacio, y es el MISMO en los tres:
        // es el del ACTOR, no el del mensajero pedido, asi que no puede delatar nada.
        alcance: "zona",
      },
    };

    expect(normalizar(inexistente)).toEqual(esperado);
    expect(normalizar(otraZona)).toEqual(esperado);
    expect(normalizar(sinOrdenes)).toEqual(esperado);
  });

  it("FEATURE 260 (B7) — las tres respuestas son BYTE A BYTE la misma, ya serializadas", async () => {
    // `toEqual` compara valores; esto compara el JSON que de verdad cruza la frontera. Un campo
    // nuevo que solo apareciera en uno de los tres casos —o un `undefined` frente a una clave
    // ausente— se ve aqui y no arriba.
    const { service } = montar();
    const textos = await Promise.all(
      [INEXISTENTE, DE_OTRA_ZONA, SIN_ORDENES_HOY].map(async (id) =>
        JSON.stringify(normalizar(await pedir(id, service))),
      ),
    );

    expect(new Set(textos).size, `las tres respuestas no son identicas: ${textos.join(" | ")}`).toBe(
      1,
    );
  });

  it("FEATURE 260 (B7) — ningun caso malo llega a la hidratacion: no hay camino nuevo que delate", async () => {
    const repo = new RepositorioDoble(
      () => [],
      () => ({ filas: [], total: 0 }),
    );
    const ordenes = new OrdenesDoble();
    const historial = new HistorialDoble();
    const service = new TableroDiaService(repo, ordenes, historial);

    for (const id of [INEXISTENTE, DE_OTRA_ZONA, SIN_ORDENES_HOY]) await pedir(id, service);

    expect(repo.detalles).toHaveLength(3);
    expect(ordenes.llamadas).toEqual([]);
    expect(historial.llamadas).toEqual([]);
  });

  it("los tres hacen el mismo trabajo: una consulta con los mismos parametros (R42, tiempo)", async () => {
    const { repo, service } = montar();

    await pedir(INEXISTENTE, service);
    await pedir(DE_OTRA_ZONA, service);
    await pedir(SIN_ORDENES_HOY, service);

    expect(repo.detalles).toHaveLength(3);
    for (const llamada of repo.detalles) {
      expect(llamada.filtro).toEqual({ tipo: "zona", zonaId: ZONA_X });
      expect(llamada.pagina).toEqual({ pagina: 1, pageSize: 25 });
    }
  });

  it("el mensajero de otra zona SI existe: el mismo id con el alcance de su zona devuelve sus ordenes", async () => {
    const { service } = montar();
    const dueño = await leerDetalleMensajeroDia(
      { mensajeroId: DE_OTRA_ZONA },
      {
        service,
        getActor: async () => ({ usuarioId: "u-y", rol: "adminSatelite", zonaId: ZONA_Y }),
        now: () => AHORA,
      },
    );

    // Es decir: la respuesta vacia del caso anterior NO era "no existe", era el recorte.
    if (dueño.estado !== "ok") throw new Error("se esperaba ok");
    expect(dueño.detalle.total).toBe(1);
  });

  it("un mensajeroId que no es uuid recibe el mismo detalle vacio, sin eco del valor recibido (R42)", async () => {
    const { service } = montar();
    const resultado = await pedir("' OR 1=1 --", service);

    if (resultado.estado !== "ok") throw new Error("se esperaba ok");
    expect(resultado.detalle.ordenes).toEqual([]);
    expect(resultado.detalle.total).toBe(0);
    expect(resultado.detalle.mensajeroId).toBe("");
    expect(JSON.stringify(resultado)).not.toContain("OR 1=1");
  });

  it("una entrada sin mensajeroId tampoco lanza: es entrada externa y se valida en el borde", async () => {
    const { service } = montar();
    const resultado = await leerDetalleMensajeroDia(
      { pagina: 2 },
      { service, getActor: async () => SATELITE_X, now: () => AHORA },
    );

    if (resultado.estado !== "ok") throw new Error("se esperaba ok");
    expect(resultado.detalle.total).toBe(0);
  });

  it("una pagina fuera de rango se rechaza en el borde, sin llegar a la base con un OFFSET gigante", async () => {
    const { repo, service } = montar();
    await leerDetalleMensajeroDia(
      { mensajeroId: SIN_ORDENES_HOY, pagina: 10_000_000 },
      { service, getActor: async () => SATELITE_X, now: () => AHORA },
    );

    expect(repo.detalles[0].pagina.pagina).toBe(1);
    expect(repo.detalles[0].mensajeroId).toBe("");
  });

  it("un actor no autorizado sigue recibiendo denegado, tambien con un id valido (R62)", async () => {
    const { repo, service } = montar();
    const resultado = await leerDetalleMensajeroDia(
      { mensajeroId: SIN_ORDENES_HOY },
      {
        service,
        getActor: async () => ({ usuarioId: "u-t", rol: "adminTienda", zonaId: null }),
        now: () => AHORA,
      },
    );

    expect(resultado).toEqual({ estado: "denegado", motivo: "rol_no_autorizado" });
    expect(repo.detalles).toHaveLength(0);
  });

  it("sin sesion, el parametro de la URL no autoriza nada (R62)", async () => {
    const { service } = montar();
    const resultado = await leerDetalleMensajeroDia(
      { mensajeroId: SIN_ORDENES_HOY },
      { service, getActor: async () => null, now: () => AHORA },
    );

    expect(resultado).toEqual({ estado: "denegado", motivo: "sin_sesion" });
  });
});
