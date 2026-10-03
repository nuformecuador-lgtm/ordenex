import { gzipSync } from "node:zlib";
import type { DescargaConfigEnv } from "@/lib/config/descarga";
import type { IAlmacenDescargas } from "@/lib/interfaces/external/IAlmacenDescargas";
import type { IEntregaDescargaService } from "@/lib/interfaces/services/IEntregaDescargaService";
import type { ResultadoPreparado } from "@/lib/types/descarga-preparada";
import { serializarDescarga } from "@/lib/utils/codec-descarga";

/** Compresor inyectable (tests). Por defecto, gzip de `node:zlib`. */
export type Comprimir = (texto: string) => Uint8Array;

const gzip: Comprimir = (texto) => gzipSync(Buffer.from(texto, "utf8"));

/**
 * Ficha 470 (design §3.4, R5/R6/R10/R11/R15) — el transporte del conjunto de una descarga.
 *
 * Vercel corta las respuestas de funcion a 4,5 MB, y el cuerpo de una Server Action lleva el
 * sobrecoste del formato de React: por encima de `UMBRAL_ALMACEN_BYTES` (2 MB por defecto) el conjunto
 * no viaja en la respuesta sino como objeto temporal comprimido, leido por el navegador con una URL
 * firmada de vida corta. Por debajo, la respuesta es exactamente la de hoy.
 *
 * Los resultados de ERROR de una accion (sin sesion, prohibido, entrada invalida, limite de Excel)
 * son pequeños por naturaleza (conteos, sin filas): caen en la rama directa sin tocar el almacen
 * (R11). Se afirma con test, no se supone.
 */
export class EntregaDescargaService implements IEntregaDescargaService {
  constructor(
    private readonly almacen: IAlmacenDescargas,
    private readonly config: Pick<DescargaConfigEnv, "UMBRAL_ALMACEN_BYTES" | "TTL_URL_SEGUNDOS">,
    private readonly comprimir: Comprimir = gzip,
  ) {}

  async entregar<R>(resultado: R): Promise<ResultadoPreparado<R>> {
    const texto = serializarDescarga(resultado);
    if (Buffer.byteLength(texto, "utf8") <= this.config.UMBRAL_ALMACEN_BYTES) {
      // R6: el objeto ORIGINAL, no el texto: la respuesta es la de hoy.
      return { modo: "directo", resultado };
    }
    const { ruta } = await this.almacen.guardar(this.comprimir(texto));
    const url = await this.almacen.firmar(ruta, this.config.TTL_URL_SEGUNDOS);
    return { modo: "almacen", url };
  }
}
