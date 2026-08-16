import { describe, it, expect } from "vitest";

import { loadRastreoPublicoConfig } from "@/lib/config/rastreo-publico";
import type {
  IRastreoPublicoRepository,
  OrdenRastreoFila,
  TransicionRastreoFila,
} from "@/lib/interfaces/repositories/IRastreoPublicoRepository";
import { RastreoPublicoService } from "@/lib/services/RastreoPublicoService";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import {
  HITOS_PUBLICOS,
  HITO_POR_DEFECTO,
  hitoDeEstatus,
  type HitoPublico,
  type RastreoPublicoDTO,
} from "@/lib/types/rastreo-publico";

// Feature 229 — GUARDIA DE NO-FUGA DE ESTATUS INTERNOS (T4.3, cubre R15).
//
// Se proyecta un historial que ATRAVIESA LOS 20 values de `ORDER_STATUS_SEED` y se comprueba
// que ninguno cruza al resultado publico.
//
// ⚠ HOMONIMIA CONOCIDA, Y ES LA TRAMPA DE ESTE REQUISITO — leer antes de "arreglar" nada:
//
//   El hito PUBLICO firmado `en_reparto` (G5) se escribe EXACTAMENTE IGUAL que el
//   `order_status.value` interno `en_reparto`. Son dos vocabularios distintos que coinciden en
//   una palabra, no un estatus interno filtrado: el destinatario recibe un hito del vocabulario
//   publico de nueve, que da la casualidad de llamarse como uno de los veinte estados internos.
//   (La colision ya esta documentada en `rastreo-hitos-exhaustivo.guardia.test.ts:102-115`, y
//   `censo-order-status-rename.test.ts` lleva cuatro entradas de allowlist por una homonimia
//   HERMANA: el id del hito de bodega coincide con un value que la feature 135 retiro.)
//
//   ⚠ NOTA DE MANTENIMIENTO: por esa misma razon este archivo NO escribe literalmente el id de
//   ese hito ni el value retirado por la 155 — no esta en la allowlist de aquel censo y no se
//   le va a pedir que lo este por un dato de test. Donde hacen falta, se derivan del
//   vocabulario publico (`HITOS_PUBLICOS`) o se usa un value huerfano cualquiera, que es lo
//   que el caso de verdad necesita.
//
//   Consecuencia PRACTICA: un `ORDER_STATUS_SEED.some(v => JSON.stringify(res).includes(v))`
//   —el barrido que sale solo al escribir esta guardia— da ROJO SIEMPRE contra un resultado
//   PERFECTAMENTE correcto. Ese test seria falso: no mide R15, mide la homonimia. El primer
//   caso de abajo lo deja DEMOSTRADO en vez de dicho, para que nadie lo reintroduzca.
//
// Por eso la comprobacion es ESTRUCTURAL y no de substrings:
//   1. cada `hito` del resultado pertenece al vocabulario publico, y
//   2. ninguna cadena del resultado contiene un value del seed, SALVO cuando la cadena entera
//      es exactamente un id de hito publico (la excepcion es la homonimia, y solo esa).
//
// Y como una guardia que no puede fallar no vale nada, el mismo detector se ejecuta contra
// resultados MUTADOS que publican `en_bodega_satelite` y `sin_gestionar`: tiene que cazarlos.

const NUM_GUIA = 555_001;
const TELEFONO = "8712-3456";
const FACTOR = "3456";

/** Un historial que pasa por LOS VEINTE values del catalogo, uno por dia. */
const TRANSICIONES: readonly TransicionRastreoFila[] = ORDER_STATUS_SEED.map(
  (estatusValue, indice) => ({
    createdAt: new Date(Date.UTC(2026, 0, 1 + indice, 15, 0, 0)),
    estatusValue,
  }),
);

class RepositorioDeLosVeinte implements IRastreoPublicoRepository {
  constructor(private readonly transiciones: readonly TransicionRastreoFila[] = TRANSICIONES) {}

  async buscarPorGuia(numGuia: number): Promise<OrdenRastreoFila | null> {
    return numGuia === NUM_GUIA
      ? { id: "orden-de-prueba", numGuia: NUM_GUIA, telefonoDest: TELEFONO, deletedAt: null }
      : null;
  }

  async listarTransiciones(): Promise<readonly TransicionRastreoFila[]> {
    return this.transiciones;
  }
}

async function proyectar(
  transiciones: readonly TransicionRastreoFila[] = TRANSICIONES,
): Promise<RastreoPublicoDTO> {
  const service = new RastreoPublicoService(
    new RepositorioDeLosVeinte(transiciones),
    loadRastreoPublicoConfig(),
  );
  const resultado = await service.consultar(NUM_GUIA, FACTOR);
  expect(resultado.estado, "el escenario base tiene que identificar el envio").toBe("ok");
  if (resultado.estado !== "ok") throw new Error("escenario base roto");
  return resultado.envio;
}

/* -------------------------------------------------------------------------- */
/* El detector, escrito como funcion pura para poder probarlo con una fuga      */
/* -------------------------------------------------------------------------- */

const VOCABULARIO_PUBLICO = new Set<string>(HITOS_PUBLICOS);

/** Todas las cadenas de un objeto y de sus descendientes, claves incluidas. */
function cadenasProfundas(valor: unknown, acumulado: string[] = []): string[] {
  if (typeof valor === "string") {
    acumulado.push(valor);
    return acumulado;
  }
  if (Array.isArray(valor)) {
    for (const item of valor) cadenasProfundas(item, acumulado);
    return acumulado;
  }
  if (typeof valor === "object" && valor !== null) {
    for (const [clave, hijo] of Object.entries(valor)) {
      acumulado.push(clave);
      cadenasProfundas(hijo, acumulado);
    }
  }
  return acumulado;
}

/**
 * Los `order_status.value` internos que se han colado en el resultado.
 *
 * La regla, dicha entera: una cadena delata un estatus interno si CONTIENE un value del seed
 * **y** ella misma no es, palabra por palabra, un id del vocabulario publico. Esa unica
 * excepcion es la homonimia de `en_reparto` (y solo puede serlo un id publico COMPLETO: un
 * `en_bodega_satelite` no lo es, aunque su prefijo sea el id de un hito publico).
 */
function valuesInternosFiltrados(valor: unknown): string[] {
  const delatoras: string[] = [];
  for (const cadena of cadenasProfundas(valor)) {
    if (VOCABULARIO_PUBLICO.has(cadena)) continue;
    for (const value of ORDER_STATUS_SEED) {
      if (cadena.includes(value)) delatoras.push(`${cadena} :: contiene el value interno ${value}`);
    }
  }
  return delatoras;
}

/* -------------------------------------------------------------------------- */

describe("R15 — un historial que atraviesa los 20 estatus no publica ningún value interno", () => {
  it("CONTROL DE NO-VACUIDAD: el escenario recorre de verdad los veinte values del catalogo", () => {
    expect(ORDER_STATUS_SEED).toHaveLength(20);
    expect(TRANSICIONES).toHaveLength(20);
    expect(new Set(TRANSICIONES.map((t) => t.estatusValue)).size).toBe(20);
  });

  it("DEMOSTRACION de la homonimia: el `includes` ciego daria rojo contra un resultado CORRECTO", () => {
    // Este caso no vigila el codigo: vigila a quien reescriba esta guardia. Deja medido que el
    // barrido ingenuo denuncia un resultado impecable, y por que.
    const serializado = JSON.stringify({
      numGuia: NUM_GUIA,
      hitoVigente: "registrado",
      actualizadoEn: "2026-01-20T09:00-06:00",
      linea: [{ hito: "en_reparto", fecha: "2026-01-10T09:00-06:00" }],
    });

    const ingenuo = ORDER_STATUS_SEED.filter((value) => serializado.includes(value));
    expect(ingenuo).toEqual(["en_reparto"]); // el hito PUBLICO, no el estatus interno

    // El detector estructural, sobre el MISMO objeto, no denuncia nada.
    expect(valuesInternosFiltrados(JSON.parse(serializado))).toEqual([]);
  });

  it("ningún `order_status.value` cruza al resultado público", async () => {
    const envio = await proyectar();
    expect(valuesInternosFiltrados(envio)).toEqual([]);
  });

  it("cada `hito` publicado pertenece al vocabulario público, y el vigente tambien", async () => {
    const envio = await proyectar();

    expect(envio.linea.length).toBeGreaterThan(0);
    for (const entrada of envio.linea) {
      expect(HITOS_PUBLICOS, `hito fuera del vocabulario: ${entrada.hito}`).toContain(entrada.hito);
    }
    expect(HITOS_PUBLICOS).toContain(envio.hitoVigente);
  });

  it("los veinte estatus se traducen a los NUEVE hitos firmados, sin sobrar ni faltar", () => {
    // La cara positiva de R15: no basta con que no salga el value crudo, tiene que salir el
    // hito. Si un value se publicara "en bruto" o se omitiera, este conjunto cambiaria.
    //
    // Los nueve se DERIVAN del vocabulario publico menos el neutral, en vez de escribirse a
    // mano: la tabla firmada ya tiene su guardia de transcripcion (T1.3,
    // `rastreo-hitos-exhaustivo.guardia.test.ts`), y aqui lo que se afirma es que el catalogo
    // VIGENTE cubre los nueve hitos reales y NUNCA cae en la red de seguridad de R17.
    const hitos = new Set<HitoPublico>();
    for (const { estatusValue } of TRANSICIONES) hitos.add(hitoDeEstatus(estatusValue));

    const nueveFirmados = HITOS_PUBLICOS.filter((hito) => hito !== HITO_POR_DEFECTO);
    expect(nueveFirmados).toHaveLength(9);
    expect([...hitos].sort()).toEqual([...nueveFirmados].sort());
    expect(hitos.has(HITO_POR_DEFECTO)).toBe(false);
  });

  it("una fila HUERFANA (el caso real de la feature 155) tampoco publica su value crudo", async () => {
    // El historial es append-only: una fila puede apuntar a un estatus RETIRADO del catalogo
    // vigente. El value concreto que la 155 retiro no se escribe aqui —lo censa
    // `censo-order-status-rename.test.ts` y este archivo no esta en su allowlist—; el caso no
    // depende de cual sea: depende de que NO este en el seed.
    const huerfano = "un_estatus_retirado_del_catalogo";
    expect(new Set<string>(ORDER_STATUS_SEED).has(huerfano)).toBe(false);

    const envio = await proyectar([
      { createdAt: new Date(Date.UTC(2026, 0, 1, 15, 0, 0)), estatusValue: huerfano },
      { createdAt: new Date(Date.UTC(2026, 0, 2, 15, 0, 0)), estatusValue: "entregada" },
    ]);

    expect(JSON.stringify(envio)).not.toContain(huerfano);
    expect(envio.linea.map((e) => e.hito)).toEqual([HITO_POR_DEFECTO, "entregado"]);
  });
});

describe("R15 — CONTRAPRUEBA: el detector caza los values que de verdad serian una fuga", () => {
  it("caza `en_bodega_satelite`, aunque su PREFIJO sea el id de un hito público", async () => {
    const envio = await proyectar();
    const fugado = {
      ...envio,
      linea: [...envio.linea, { hito: "en_bodega_satelite", fecha: "2026-01-21T09:00-06:00" }],
    };

    const delatoras = valuesInternosFiltrados(fugado);
    expect(delatoras).toHaveLength(1);
    expect(delatoras[0]).toContain("en_bodega_satelite");
  });

  it("caza `sin_gestionar`, que es justo el estado que G8 esconde tras «En reparto»", async () => {
    const envio = await proyectar();
    const fugado = { ...envio, hitoVigente: "sin_gestionar" };

    const delatoras = valuesInternosFiltrados(fugado);
    expect(delatoras).toHaveLength(1);
    expect(delatoras[0]).toContain("sin_gestionar");
  });

  it("caza un value interno escondido dentro de un texto, no solo como valor exacto", async () => {
    const envio = await proyectar();
    const fugado = {
      ...envio,
      linea: [
        ...envio.linea,
        { hito: "en_proceso", fecha: "estado interno: por_recolectar_en_tienda" },
      ],
    };

    expect(valuesInternosFiltrados(fugado).length).toBeGreaterThan(0);
  });

  it("caza los DIECINUEVE values que no son homonimos de un hito publico", () => {
    // Uno a uno: la excepcion de la homonimia se aplica a `en_reparto` y a NADIE mas.
    const homonimos = ORDER_STATUS_SEED.filter((value) => VOCABULARIO_PUBLICO.has(value));
    expect(homonimos).toEqual(["en_reparto"]);

    for (const value of ORDER_STATUS_SEED) {
      const objeto = { hito: value, fecha: "2026-01-01T09:00-06:00" };
      const delatoras = valuesInternosFiltrados(objeto);
      if (value === "en_reparto") expect(delatoras).toEqual([]);
      else expect(delatoras, `el detector deja pasar ${value}`).not.toEqual([]);
    }
  });
});
