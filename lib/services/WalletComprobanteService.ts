import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { walletComprobanteConfig, type WalletComprobanteConfig } from "@/lib/config/wallet-comprobante";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type {
  CaminoConComprobanteLateral,
  ComprobanteGuardado,
  DestinoLateral,
  DuenoDeDestino,
  IWalletComprobanteRepository,
  ObjetoComprobante,
  WalletComprobanteTxClient,
} from "@/lib/interfaces/repositories/IWalletComprobanteRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IWalletAnulacionService } from "@/lib/interfaces/services/IWalletAnulacionService";
import type {
  AdjuntarComprobanteServiceResult,
  CarpetaLateral,
  ComprobanteRecibido,
  IWalletComprobanteService,
  SubidaComprobante,
  VerComprobanteServiceResult,
  WalletComprobanteTxRunner,
} from "@/lib/interfaces/services/IWalletComprobanteService";
import { compensarEvidencias } from "@/lib/services/evidencias-compensadas";
import type { CaminoAnulacion, DestinoMovimiento } from "@/lib/types/wallet-anulacion";
import type { RotuloComprobanteDTO } from "@/lib/types/wallet-comprobante-lateral";
import { problemaDeComprobante, rutaDeComprobante } from "@/lib/utils/comprobante";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

const ROL_TIENDA = "adminTienda";

type Fuente =
  | { tipo: "lateral"; libro: "caja" | "tienda" | "pago"; camino: CaminoConComprobanteLateral }
  | { tipo: "documento"; documento: "pago_por_cuenta_tienda" | "aporte_capital" | "abono_tienda" }
  | { tipo: "ninguna" };

/**
 * DONDE vive el comprobante de cada camino (design §4.1). La MISMA clasificacion que la anulacion
 * (`WalletAnulacionService.clasificar`): un `Record` total, asi que un camino nuevo sin decidir su
 * comprobante no compila. Los documentos de la 459/457 lo guardan en SU fila (y se adjunta al
 * registrarlos); el cobro por rechazo y el premio no llevan comprobante.
 */
const FUENTE_POR_CAMINO: Record<CaminoAnulacion, Fuente> = {
  egreso_caja: { tipo: "lateral", libro: "caja", camino: "egreso_caja" },
  ajuste_caja: { tipo: "lateral", libro: "caja", camino: "ajuste_caja" },
  cobro_tienda: { tipo: "lateral", libro: "tienda", camino: "cobro_tienda" },
  liquidacion_pago: { tipo: "lateral", libro: "pago", camino: "liquidacion_pago" },
  pago_por_cuenta_tienda: { tipo: "documento", documento: "pago_por_cuenta_tienda" },
  aporte_capital: { tipo: "documento", documento: "aporte_capital" },
  abono_tienda: { tipo: "documento", documento: "abono_tienda" },
  rechazo_tienda_cobro: { tipo: "ninguna" },
  premio_del_ranking: { tipo: "ninguna" },
};

const CARPETA_POR_LIBRO: Record<"caja" | "tienda" | "pago", CarpetaLateral> = {
  caja: "wallet_movimiento",
  tienda: "wallet_tienda_movimiento",
  pago: "liquidacion_pago",
};

/** Lo que una TIENDA puede pedir (R78): filas de SU libro y los documentos que la nombran. */
const DOCUMENTOS_DE_LA_TIENDA: ReadonlySet<string> = new Set(["liquidacion_pago", "pago_por_cuenta_tienda", "abono_tienda"]);

function lateral(libro: "caja" | "tienda" | "pago", id: string): DestinoLateral {
  if (libro === "caja") return { caja: id };
  if (libro === "tienda") return { tienda: id };
  return { pago: id };
}

/** R80 — el rotulo: la fila se fecha en CR; el documento es un `@db.Date` (medianoche UTC). */
function rotulo(fuente: RotuloComprobanteDTO["fuente"], dueno: DuenoDeDestino): RotuloComprobanteDTO {
  const fecha = fuente === "documento" ? dueno.fecha.toISOString().slice(0, 10) : fechaCalendarioCR(dueno.fecha);
  return { fuente, categoria: dueno.categoria, fecha };
}

/**
 * FICHA 458-B (design §4.1, D6/D12, R74–R80) — el COMPROBANTE de los caminos sin documento propio.
 *
 * Reglas:
 *  - Subir ANTES de escribir; si la subida falla, nada se registra (R76). Si el registro no se escribe,
 *    el objeto se retira (R76).
 *  - Una sola vez: el UNIQUE del destino decide (R79); ni reemplazar ni borrar.
 *  - Ver: SOLO por enlace temporal, tras decidir el alcance en el servidor (R77). La tienda ve lo de SU
 *    libro y sus documentos (R78); lo ajeno o inexistente es `no_encontrado`, sin distinguir (R77).
 *  - La ruta del objeto no sale de aqui (R80).
 */
export class WalletComprobanteService implements IWalletComprobanteService {
  constructor(
    private readonly repo: IWalletComprobanteRepository,
    private readonly clasificador: Pick<IWalletAnulacionService, "clasificar">,
    private readonly storage: IFileStorage,
    private readonly urls: ISignedUrlProvider,
    private readonly runTransaction: WalletComprobanteTxRunner,
    private readonly config: Pick<WalletComprobanteConfig, "MAX_BYTES" | "SIGNED_URL_TTL_SECONDS"> = walletComprobanteConfig,
  ) {}

  async subir(carpeta: CarpetaLateral, comprobante: ComprobanteRecibido): Promise<SubidaComprobante> {
    const problema = problemaDeComprobante(
      { type: comprobante.contentType, size: comprobante.bytes.byteLength },
      this.config,
    );
    if (problema !== null) return { status: "invalido", problema }; // R75: nada se sube
    try {
      const storagePath = await this.storage.upload({
        path: rutaDeComprobante(carpeta, comprobante.contentType),
        bytes: comprobante.bytes,
        contentType: comprobante.contentType,
      });
      return { status: "ok", guardado: { storagePath, contentType: comprobante.contentType } };
    } catch {
      return { status: "no_guardado" }; // R76
    }
  }

  async registrarEnTx(
    tx: WalletComprobanteTxClient,
    destino: DestinoLateral,
    guardado: ComprobanteGuardado,
    subidoPor: string,
  ): Promise<"creado" | "ya_tiene"> {
    return this.repo.crear(tx, destino, { ...guardado, subidoPor });
  }

  async retirar(guardado: ComprobanteGuardado): Promise<void> {
    try {
      await compensarEvidencias(this.storage, [guardado.storagePath]);
    } catch {
      // Best-effort: el objeto huerfano no pertenece a nada y no se puede ver (la unica via es la fila).
    }
  }

  /**
   * D6/R79 — adjuntar DESPUES, una sola vez. Orden: rol (antes de leer) → destino y su fuente → que
   * exista y no tenga ya uno (ahorra subir un archivo que no va a servir) → validar y subir → la fila
   * (el UNIQUE decide de verdad) → si no quedo, retirar el objeto.
   */
  async adjuntar(
    destino: DestinoMovimiento,
    comprobante: ComprobanteRecibido,
    actor: Actor,
  ): Promise<AdjuntarComprobanteServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R79/R82: antes de leer

    const clase = await this.clasificador.clasificar(destino);
    if (clase.status === "no_encontrado") return { status: "no_encontrado" };
    if (clase.status === "no_anulable") return { status: "no_admite", motivo: "no_admite" };
    const fuente = FUENTE_POR_CAMINO[clase.camino];
    if (fuente.tipo === "documento") return { status: "no_admite", motivo: "en_su_documento" };
    if (fuente.tipo === "ninguna") return { status: "no_admite", motivo: "no_admite" };

    const objetivo = lateral(fuente.libro, clase.id);
    if ((await this.repo.duenoDeLateral(objetivo)) === null) return { status: "no_encontrado" };
    // FICHA 458-B (revision m6): R79 admite adjuntar a un movimiento ANULABLE; uno ya anulado no.
    if (await this.repo.estaAnulado(fuente.camino, clase.id)) {
      return { status: "no_admite", motivo: "anulado" };
    }
    if ((await this.repo.lateralDe(objetivo)) !== null) return { status: "ya_tiene" };

    const subida = await this.subir(CARPETA_POR_LIBRO[fuente.libro], comprobante);
    if (subida.status === "invalido") {
      return { status: "validation_error", fieldErrors: { comprobante: [subida.problema] } };
    }
    if (subida.status === "no_guardado") return { status: "comprobante_no_guardado" };

    let creado = false;
    try {
      const r = await this.runTransaction((tx) =>
        this.repo.crear(tx, objetivo, { ...subida.guardado, subidoPor: actor.usuarioId }),
      );
      creado = r === "creado";
      return creado ? { status: "ok" } : { status: "ya_tiene" };
    } finally {
      if (!creado) await this.retirar(subida.guardado); // R76/R79: el objeto no pertenece a nada
    }
  }

  /** R77/R78/R80 — el enlace temporal, tras decidir el alcance. */
  async ver(destino: DestinoMovimiento, actor: Actor): Promise<VerComprobanteServiceResult> {
    const esTienda = actor.rol === ROL_TIENDA;
    if (!esAccesoTotal(actor.rol) && !esTienda) return { status: "forbidden" };

    if (esTienda) {
      // R78: la tienda NO ve la caja ni los mensajeros; de su libro, solo SUS filas.
      if ("libro" in destino) {
        if (destino.libro !== "tienda") return { status: "no_encontrado" };
        if ((await this.repo.tiendaDeFila(destino.movimientoId)) !== actor.usuarioId) return { status: "no_encontrado" };
      } else if (!DOCUMENTOS_DE_LA_TIENDA.has(destino.documento)) {
        return { status: "no_encontrado" };
      }
    }

    const clase = await this.clasificador.clasificar(destino);
    if (clase.status === "no_encontrado") return { status: "no_encontrado" };
    if (clase.status === "no_anulable") return { status: "sin_comprobante" };
    const fuente = FUENTE_POR_CAMINO[clase.camino];
    if (fuente.tipo === "ninguna") return { status: "sin_comprobante" };

    let dueno: DuenoDeDestino | null;
    let objeto: ObjetoComprobante | null;
    let fuenteRotulo: RotuloComprobanteDTO["fuente"];
    if (fuente.tipo === "documento") {
      const doc = await this.repo.documento(fuente.documento, clase.id);
      dueno = doc;
      objeto = doc?.comprobante ?? null;
      fuenteRotulo = "documento";
    } else {
      const objetivo = lateral(fuente.libro, clase.id);
      dueno = await this.repo.duenoDeLateral(objetivo);
      objeto = dueno === null ? null : await this.repo.lateralDe(objetivo);
      fuenteRotulo = fuente.libro === "pago" ? "documento" : fuente.libro;
    }
    if (dueno === null) return { status: "no_encontrado" };
    // R77: lo ajeno se responde IGUAL que lo inexistente.
    if (esTienda && dueno.tiendaId !== actor.usuarioId) return { status: "no_encontrado" };
    if (objeto === null) return { status: "sin_comprobante" };

    const url = await this.urls.createSignedUrl(objeto.storagePath, this.config.SIGNED_URL_TTL_SECONDS);
    return { status: "ok", url, contentType: objeto.contentType, rotulo: rotulo(fuenteRotulo, dueno) };
  }
}
