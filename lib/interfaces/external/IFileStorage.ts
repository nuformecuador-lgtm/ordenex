// Feature 21 — contrato de almacenamiento de archivos (A2/R16/R18/R24). Abstrae
// el backend concreto (Supabase Storage) para que el servicio de postulacion sea
// testeable con un doble sin red. El binario nunca es publico (R18): la lectura
// futura (feature 22) usa URL firmada del service role.

export interface UploadInput {
  /** Ruta destino dentro del bucket privado, p. ej. `{usuarioId}/{tipo}.jpg`. */
  path: string;
  /** Contenido binario del documento. */
  bytes: Uint8Array;
  /** Tipo MIME (image/jpeg | image/png | image/webp). */
  contentType: string;
}

export interface IFileStorage {
  /** Sube un objeto al bucket privado. Lanza si falla. Devuelve el path final. */
  upload(input: UploadInput): Promise<string>;
  /**
   * Borra objetos por path (best-effort para la limpieza atomica R24). No debe
   * lanzar ante paths inexistentes.
   */
  remove(paths: string[]): Promise<void>;
}
