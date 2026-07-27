import { randomUUID } from "crypto";

import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IEtiquetaGuiaService } from "@/lib/interfaces/services/IEtiquetaGuiaService";
import type {
  EtiquetasLotePdfResultado,
  IEtiquetasLotePdfService,
} from "@/lib/interfaces/services/IEtiquetasLotePdfService";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";
import { buildEtiquetasLotePdf } from "@/lib/pdf/etiquetas-pdf-lote";

// Feature 136 (T2.2) — Orquestador del PDF consolidado de etiquetas del lote.
// Pide los DTOs de etiqueta (feature 32), arma el PDF server-side (lib/pdf),
// lo sube al bucket privado (feature 21) y firma su URL (feature 22). DI por
// constructor: testeable sin red ni DOM. NO captura errores internamente; la
// politica best-effort (try/catch) vive en el borde (design.md §5/§6, R12).

/**
 * El lote pide mas etiquetas de las que un solo PDF puede rendir dentro del
 * presupuesto de tiempo/memoria de la function (BLOQ-1 del review de la 136).
 * Es una condicion ESPERADA, no un fallo de infraestructura: se lanza ANTES de
 * construir nada para que el borde la degrade a `etiquetasPdf: { error }` (R12)
 * en vez de arriesgar un OOM/timeout no capturable. El mensaje solo lleva
 * numeros (sin PII ni secretos), por lo que es seguro loguearlo.
 */
export class EtiquetasLoteExcedeTopeError extends Error {
  constructor(
    readonly etiquetas: number,
    readonly tope: number,
  ) {
    super(`el lote tiene ${etiquetas} etiquetas y supera el tope de ${tope} por PDF`);
    this.name = "EtiquetasLoteExcedeTopeError";
  }
}

export class EtiquetasLotePdfService implements IEtiquetasLotePdfService {
  constructor(
    private readonly etiquetaService: IEtiquetaGuiaService,
    private readonly storage: IFileStorage,
    private readonly signedUrls: ISignedUrlProvider,
    private readonly ttlSeg: number,
    /** Tope de etiquetas por PDF (`etiquetasConfig.MAX_ETIQUETAS_POR_PDF`). */
    private readonly maxEtiquetas: number,
    private readonly build: (dtos: EtiquetaGuiaDTO[]) => Promise<Uint8Array> = buildEtiquetasLotePdf,
  ) {}

  async generarYAlmacenar(
    ordenIds: string[],
    actor: Actor,
  ): Promise<EtiquetasLotePdfResultado | null> {
    // 1. Etiquetas imprimibles del lote. `forbidden` o cero etiquetas -> no hay
    //    nada que generar (R14): el borde lo traduce a `etiquetasPdf: null`.
    const res = await this.etiquetaService.generarEtiquetas({ ordenIds }, actor);
    if (res.status !== "ok" || res.etiquetas.length === 0) return null;

    // 1b. Tope duro (BLOQ-1). Defensa en profundidad: el borde ya descarta el
    //     lote por el numero de ordenes creadas (cota superior de las etiquetas)
    //     antes de llegar aqui, pero este servicio tambien debe ser seguro para
    //     cualquier otro llamador. Se corta ANTES de `build`: el trabajo que no
    //     se empieza no puede tumbar la function.
    if (res.etiquetas.length > this.maxEtiquetas) {
      throw new EtiquetasLoteExcedeTopeError(res.etiquetas.length, this.maxEtiquetas);
    }

    // 2. PDF consolidado (R1-R6).
    const bytes = await this.build(res.etiquetas);

    // 3. Path aislado por dueño y unico por lote (R11).
    const path = `${actor.usuarioId}/${randomUUID()}.pdf`;

    // 4. Subida al bucket privado (R8).
    await this.storage.upload({ path, bytes, contentType: "application/pdf" });

    // 5. URL firmada con TTL (R10).
    const signedUrl = await this.signedUrls.createSignedUrl(path, this.ttlSeg);

    return { path, signedUrl, expiraEnSegundos: this.ttlSeg };
  }
}
