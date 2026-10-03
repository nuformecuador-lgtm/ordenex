// Ficha 470 (design §3.3, R9/R10/R14/R17) — contrato del almacen de los OBJETOS TEMPORALES de las
// descargas grandes: el conjunto serializado y comprimido que el navegador lee una sola vez por URL
// firmada. Abstrae Supabase Storage para que la entrega y la purga se prueben con dobles, sin red
// (el `.env` local apunta Storage a PRODUCCION: ningun test debe tocar el real).

export interface IAlmacenDescargas {
  /**
   * Sube los bytes a `tmp/<uuid v4>.json.gz` en el bucket privado (R9). Si el bucket no existe lo crea
   * PRIVADO y reintenta la subida una sola vez (R14). Lanza si falla.
   */
  guardar(bytes: Uint8Array): Promise<{ ruta: string }>;
  /** URL firmada de lectura con caducidad `ttlSegundos` (R10). Nunca una URL publica. Lanza si falla. */
  firmar(ruta: string, ttlSegundos: number): Promise<string>;
  /**
   * Borra los objetos de `tmp/` creados ANTES de `corte`, hasta `maximo` por llamada (R17). Bucket
   * inexistente ⇒ `{ borrados: 0, quedaPendiente: false }`. Un error del SDK LANZA (la purga falla
   * ruidosa, no en silencio).
   */
  purgarAnterioresA(corte: Date, maximo: number): Promise<{ borrados: number; quedaPendiente: boolean }>;
}
