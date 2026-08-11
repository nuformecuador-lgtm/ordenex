import type { IConteosPublicosCache } from "@/lib/interfaces/external/IConteosPublicosCache";

// Feature 198 — la cache que NO cachea. Para los tests y para cualquier entorno sin runtime
// de Next. Espejo de `tablero-dia-cache-nula.ts` (feature 192).
//
// Existe para que un test pueda afirmar el CONTEO —lo que la feature promete— sin que una
// entrada viva de 6 h le devuelva el resultado de otro caso. Un test que cachea entre casos
// pasa por los motivos equivocados.

export class ConteosPublicosCacheNula implements IConteosPublicosCache {
  async envolver<T>(_clave: string, producir: () => Promise<T>): Promise<T> {
    return producir();
  }
}
