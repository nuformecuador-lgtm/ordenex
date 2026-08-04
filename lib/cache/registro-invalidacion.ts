// Feature 128 (R23) — REGISTRO DE LAS INVALIDACIONES.
//
// DESVIACION DECLARADA de `design.md §1`, que listaba 11 archivos nuevos y no este.
// Motivo: R23 exige que TODA invalidacion deje registro de QUIEN la disparo y de QUE tags
// invalido. El adaptador de Next no es testeable en unitario (`design.md §11`), asi que meter
// el registro dentro de el habria dejado R23 cubierto solo por un formateador de cadenas. Como
// decorador del PUERTO, el registro se ejerce con el codigo de produccion real y su mutacion
// —emitirlo sin el origen— mata un test de verdad. Es un archivo mas, no una pieza distinta.
//
// POR QUE EXISTE ESTE REGISTRO. Es la unica senal que distingue «la cifra no cambio porque no
// hubo movimiento» de «la cifra no cambio porque la invalidacion no llego». Sin el, el modo de
// fallo de esta feature es mudo: nada se rompe, el numero se queda quieto.
//
// R23 tambien acota lo que se registra: origen y tags, y NADA MAS. Sin PII y sin ids de
// dominio. Por eso el registro se construye aqui campo a campo y no se serializa un objeto
// ajeno que alguien pueda ampliar sin darse cuenta.

import type { IAnaliticaCache, OrigenInvalidacion } from "@/lib/interfaces/external/IAnaliticaCache";

/** Lo que se emite por invalidacion. Dos campos. No hay un tercero y no debe haberlo. */
export interface RegistroInvalidacion {
  readonly origen: OrigenInvalidacion;
  readonly tags: readonly string[];
}

/** Sumidero del registro, inyectable. Por defecto, la consola (patron `RollupJobLogger`). */
export interface SumideroInvalidacion {
  registrar(registro: RegistroInvalidacion): void;
}

const sumideroPorDefecto: SumideroInvalidacion = {
  registrar: (r) => console.log(`[analitica_cache_invalidacion] ${JSON.stringify(r)}`),
};

/**
 * Envuelve un puerto de cache para que cada `invalidar` deje su rastro.
 *
 * El registro se emite DESPUES de que la invalidacion resuelva: si `invalidar` lanza (R11), no
 * se registra un exito que no ocurrio y el error se propaga tal cual.
 */
export function conRegistroDeInvalidacion(
  cache: IAnaliticaCache,
  sumidero: SumideroInvalidacion = sumideroPorDefecto,
): IAnaliticaCache {
  return {
    envolver: (clave, tags, producir) => cache.envolver(clave, tags, producir),
    async invalidar(origen, tags) {
      await cache.invalidar(origen, tags);
      sumidero.registrar({ origen, tags: [...tags] });
    },
  };
}
