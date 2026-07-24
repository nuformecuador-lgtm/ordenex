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

// Feature 112 (T2.2) — Orquestador del PDF consolidado de etiquetas del lote.
// Pide los DTOs de etiqueta (feature 32), arma el PDF server-side (lib/pdf),
// lo sube al bucket privado (feature 21) y firma su URL (feature 22). DI por
// constructor: testeable sin red ni DOM. NO captura errores internamente; la
// politica best-effort (try/catch) vive en el borde (design.md §5/§6, R12).

export class EtiquetasLotePdfService implements IEtiquetasLotePdfService {
  constructor(
    private readonly etiquetaService: IEtiquetaGuiaService,
    private readonly storage: IFileStorage,
    private readonly signedUrls: ISignedUrlProvider,
    private readonly ttlSeg: number,
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
