import type { IAnaliticaCache, OrigenInvalidacion } from "@/lib/interfaces/external/IAnaliticaCache";

// Feature 128 — LA CACHE FALSA, con SEMANTICA DE TAGS REAL.
//
// NO acaba en `.test.ts`: vitest no la recoge como suite.
//
// ⚠ POR QUE NO ES UN MOCK QUE CUENTE LLAMADAS. Un test que espia `revalidateTag` solo prueba
// que alguien escribio la llamada. La prueba de esta feature es el patron de CINCO PASOS de
// `design.md §11`, y su asercion es siempre sobre el DATO SERVIDO:
//
//   1. consultar            -> V1
//   2. cambiar el origen    -> el repositorio interno pasa a devolver V2
//   3. consultar            -> V1     ← si esto falla, la cache no cachea y el resto es vacuo
//   4. correr el INVALIDADOR DE PRODUCCION REAL
//   5. consultar            -> V2     ← si esto devuelve V1, la invalidacion NO llego
//
// Para que los pasos 3 y 5 sean afirmaciones sobre cifras hace falta una cache que de verdad
// guarde por clave y de verdad borre por tag. Esto es eso.
//
// ⚠ Y SERIALIZA COMO `unstable_cache`. En Next el valor se guarda con `JSON.stringify`
// (`unstable-cache.js:23`) y se recupera con `JSON.parse` (`:168`, `:247`); en un FALLO de
// cache devuelve el resultado CRUDO (`:222`, `:257`). Aqui se replica exactamente ese
// comportamiento asimetrico: si el decorador dejara de codificar, la escritura lanzaria
// `TypeError: Do not know how to serialize a BigInt` igual que en produccion, y si dejara de
// rehidratar, el `bigint` volveria como `string` en el HIT. Una cache falsa que guardara el
// objeto por referencia haria pasar las dos mutaciones.

export interface CacheFalsa extends IAnaliticaCache {
  /** Cuantas entradas vivas hay. Cero tras invalidar el tag que las cubre. */
  readonly tamano: () => number;
  /** Origen y tags de cada invalidacion, por si un test quiere afirmar sobre el rastro. */
  readonly invalidaciones: { origen: OrigenInvalidacion; tags: readonly string[] }[];
  /** Claves con las que se escribio, en orden. Util para R5-R8. */
  readonly claves: string[];
}

export function cacheFalsa(): CacheFalsa {
  const entradas = new Map<string, { tags: readonly string[]; json: string }>();
  const invalidaciones: { origen: OrigenInvalidacion; tags: readonly string[] }[] = [];
  const claves: string[] = [];

  return {
    tamano: () => entradas.size,
    invalidaciones,
    claves,
    async envolver<T>(
      clave: string,
      tags: readonly string[],
      producir: () => Promise<T>,
    ): Promise<T> {
      const guardada = entradas.get(clave);
      // HIT: como Next, se devuelve lo deserializado. Un `bigint` guardado sin codec ya
      // habria hecho fallar la ESCRITURA, asi que aqui nunca llega uno.
      if (guardada !== undefined) return JSON.parse(guardada.json) as T;
      const valor = await producir();
      // ESCRITURA: `JSON.stringify` LANZA con `BigInt`. Es el punto exacto en el que la
      // mutacion «quitar el codec» rompe la consulta entera.
      entradas.set(clave, { tags: [...tags], json: JSON.stringify(valor) });
      claves.push(clave);
      // FALLO de cache: Next devuelve el resultado crudo, no el round-trip.
      return valor;
    },
    async invalidar(origen: OrigenInvalidacion, tags: readonly string[]): Promise<void> {
      invalidaciones.push({ origen, tags: [...tags] });
      const objetivo = new Set(tags);
      for (const [clave, entrada] of entradas) {
        if (entrada.tags.some((t) => objetivo.has(t))) entradas.delete(clave);
      }
    },
  };
}

/** Cache que LANZA al invalidar. Para R11: el error tiene que llegar al `JobQueueService`. */
export function cacheQueFallaAlInvalidar(mensaje = "revalidateTag exploto"): IAnaliticaCache {
  return {
    async envolver<T>(_c: string, _t: readonly string[], producir: () => Promise<T>): Promise<T> {
      return producir();
    },
    async invalidar(): Promise<void> {
      throw new Error(mensaje);
    },
  };
}
