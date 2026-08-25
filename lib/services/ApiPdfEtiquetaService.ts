import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { IEtiquetasLotePdfService } from "@/lib/interfaces/services/IEtiquetasLotePdfService";
import type {
  IApiPdfEtiquetaService,
  PdfEtiquetaResult,
} from "@/lib/interfaces/services/IApiPdfEtiquetaService";
import { EtiquetasLoteExcedeTopeError } from "@/lib/services/EtiquetasLotePdfService";

// Feature 177 (design §4.3/§6) — reuso-o-genera del PDF de etiquetas para el canal
// integrador. Logica de negocio pura (sin HTTP): el borde traduce el `status`.
//
// Invariante de seguridad (R4/R7/R12/R29): `IEtiquetaGuiaService.generarEtiquetas`
// declara que NO filtra por visibilidad de la orden (`IEtiquetaGuiaService.ts:38`), asi
// que el aislamiento por dueño lo impone ESTE service: el recurso se resuelve SIEMPRE
// contra el repositorio con `ownerId = actor.usuarioId` ANTES de pasarle un solo id al
// generador. Sin ese orden, conocer un id ajeno bastaria para imprimir su etiqueta.
//
// Invariante de datos (R23/R37/R38): "el PDF existe" se decide UNICAMENTE por
// `download_storage_path`; `download_url` (URL firmada caducable de las features
// 136/141) ni se lee ni se escribe aqui, y la URL devuelta se firma SIEMPRE en esta
// misma llamada con `createSignedUrl`.

/** Subconjunto del repo que consume este service (DI ligera para tests). */
type PdfEtiquetaRepo = Pick<
  IOrdenRepository,
  | "findDownloadStoragePathByOrdenForOwner"
  | "findDetalleByOrdenIdForOwner"
  | "setOrdenDownloadStoragePath"
  | "findCargaConOrdenesForOwner"
  | "setCargaDownloadStoragePath"
>;

export class ApiPdfEtiquetaService implements IApiPdfEtiquetaService {
  constructor(
    private readonly repo: PdfEtiquetaRepo,
    private readonly lotePdf: IEtiquetasLotePdfService,
    private readonly signedUrls: ISignedUrlProvider,
    /** `etiquetasConfig.API_SIGNED_URL_TTL_SECONDS` (300 s por defecto, R24/R43). */
    private readonly ttlSeg: number,
  ) {}

  async porOrden(actor: Actor, ordenId: string): Promise<PdfEtiquetaResult> {
    const ownerId = actor.usuarioId; // R4: owner SIEMPRE del actor, nunca de la peticion.

    // 1. Referencia persistida, leida con el owner FORZADO en el WHERE (R7). Que venga con
    //    valor implica a la vez "es propia y viva" y "el PDF existe" (R37): se re-firma y
    //    se sale sin construir, sin subir y sin reescribir la referencia (R21).
    const pathPersistido = await this.repo.findDownloadStoragePathByOrdenForOwner(ordenId, ownerId);
    if (pathPersistido !== null) return this.firmar(pathPersistido);

    // 2. `null` es ambiguo por contrato del repo: puede ser "propia sin PDF" o
    //    "ajena/borrada/inexistente". Se desambigua con otra lectura owner-forzada ANTES de
    //    tocar el generador (R12): una orden ajena no puede llegar a `generarYAlmacenar*`.
    //    Aqui entran tambien las filas heredadas de la 136/141 (`download_url` poblada y
    //    esta columna a NULL): se tratan como "sin PDF" y se regeneran (R38).
    const orden = await this.repo.findDetalleByOrdenIdForOwner(ordenId, ownerId);
    if (!orden) return { status: "not_found" };

    // 3. Generar + subir. El tope se corta dentro del generador ANTES de construir (R34).
    let resultados;
    try {
      resultados = await this.lotePdf.generarYAlmacenarPorOrden([ordenId], actor);
    } catch (err) {
      if (err instanceof EtiquetasLoteExcedeTopeError) return { status: "excede_tope" };
      throw err;
    }
    // Lista vacia O sin resultado para ESTE `ordenId` = nada imprimible (R25): ni se persiste
    // referencia ni se firma URL. No hay fallback al primer resultado a proposito: persistir en
    // esta orden el path del PDF de otra seria peor que fallar (fuga de datos entre ordenes).
    const generado = resultados.find((r) => r.ordenId === ordenId);
    if (!generado) return { status: "sin_etiqueta" };

    // 4. Persistir DESPUES del upload y SOLO la ruta devuelta por el generador (R20/R26/R36):
    //    si el UPDATE falla queda un objeto huerfano, nunca una referencia rota (design §6).
    await this.repo.setOrdenDownloadStoragePath(ordenId, generado.path);
    return this.firmar(generado.path);
  }

  async porCarga(actor: Actor, cargaId: string): Promise<PdfEtiquetaResult> {
    const ownerId = actor.usuarioId; // R4

    // 1. Carga propia (`usuario_carga = ownerId`) + ids de sus ordenes vivas del owner
    //    (R29/R32). `null` = inexistente o ajena: 404 identico, sin tocar el generador.
    const carga = await this.repo.findCargaConOrdenesForOwner(cargaId, ownerId);
    if (!carga) return { status: "not_found" };

    // 2. Reuso del consolidado (R31): solo re-firma.
    if (carga.downloadStoragePath !== null) return this.firmar(carga.downloadStoragePath);

    // 3. Lote sin ordenes propias vivas: no hay nada imprimible (R33) y no hace falta
    //    preguntarselo al generador.
    if (carga.ordenIds.length === 0) return { status: "sin_etiqueta" };

    let resultado;
    try {
      // Solo ids ya verificados como propios por el repositorio (R32).
      resultado = await this.lotePdf.generarYAlmacenar(carga.ordenIds, actor);
    } catch (err) {
      if (err instanceof EtiquetasLoteExcedeTopeError) return { status: "excede_tope" };
      throw err;
    }
    if (!resultado) return { status: "sin_etiqueta" }; // R33: ninguna orden con etiqueta

    await this.repo.setCargaDownloadStoragePath(cargaId, resultado.path); // R30/R35
    return this.firmar(resultado.path);
  }

  /**
   * R22/R23/R24: la URL SIEMPRE se emite en esta llamada a partir de la RUTA del objeto,
   * nunca se lee de la persistencia, y caduca a los `ttlSeg` segundos.
   *
   * Ya no recibe el testigo `generado`: el contrato dejo de exponerlo (2026-08-25). Las dos
   * ramas —reuso y construccion— convergen en la MISMA salida, que es justo lo que el campo
   * hacia visible y ya no hace falta distinguir desde fuera.
   */
  private async firmar(path: string): Promise<PdfEtiquetaResult> {
    const url = await this.signedUrls.createSignedUrl(path, this.ttlSeg);
    return { status: "ok", url, expiraEnSegundos: this.ttlSeg };
  }
}
