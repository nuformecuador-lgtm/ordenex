// Ficha 474 (design §5.3, R43/R44) — almacen PRIVADO de los PDFs de las ejecuciones.

export interface IAlmacenEnviosWhatsapp {
  /**
   * Guarda el PDF en `<envioId>/<ejecucionId>.pdf` SIN sobrescribir nunca (R43: `upsert: false`).
   * Crea el bucket privado en el primer uso. Lanza si falla.
   */
  guardar(envioId: string, ejecucionId: string, bytes: Uint8Array): Promise<{ ruta: string }>;
  /** Lee el PDF guardado (reintento de una ejecucion: R35 reutiliza el contenido fijado). */
  leer(ruta: string): Promise<Uint8Array>;
  /** Enlace firmado de corta duracion (R43). Lanza si falla. */
  firmar(ruta: string, ttlSegundos: number): Promise<string>;
  /** Borra objetos (R44). PROPAGA el error del SDK: una purga muda deja crecer el bucket. */
  borrar(rutas: string[]): Promise<void>;
}
