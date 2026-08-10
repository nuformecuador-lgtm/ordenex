import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { MetodoPago } from "@/lib/types/metodo-pago";
import type { CausaDevolucion } from "@/lib/types/causa-devolucion";
import type { CausaIncidente } from "@/lib/types/causa-incidente";
import type { GestionUbicacionAusenciaValue } from "@/lib/types/gestion-orden";

// Feature 36 — contrato del servicio del flujo del mensajero: listar mis
// asignaciones, recoger (una o varias), escoger una para gestionar (bloqueo
// 1-a-1) y gestionar (4 resultados). Logica de negocio pura (sin HTTP ni Prisma);
// el borde (Server Action) la traduce a resultado tipado.

// DTO de una asignacion con el detalle completo para la UI (R11). Los nombres ya
// resueltos (no IDs de catalogo); `montoCobrar` serializado a number|null.
export interface MiAsignacionDTO {
  id: string;
  numGuia: number | null;
  numRemision: string;
  estatusValue: string;
  destinatario: string;
  telefonoDest: string;
  direccion: string | null;
  producto: string;
  peso: number | null;
  montoCobrar: number | null;
  /** Feature 97: coordenadas geocodificadas de la parada (feature 91). `null` si aun no se geocodifico. Para dibujar el mapa de ruta. */
  latitud: number | null;
  longitud: number | null;
  notas: string | null;
  tiendaNombre: string;
  zonaNombre: string;
  provinciaNombre: string;
  cantonNombre: string;
  distritoNombre: string | null;
  /**
   * Feature 92 (R28): posicion 1-based de esta orden en la ruta optimizada del mensajero.
   * `null` = la orden entro a la ruta DESPUES de la ultima optimizacion y todavia no tiene
   * posicion (se muestra al final, marcada como pendiente de optimizar).
   *
   * Siempre `null` en las ordenes de "Por recoger": no estan en reparto, no son paradas.
   */
  secuenciaRuta: number | null;
  /**
   * Feature 115 (R17): marca PRIVADA "gestionar mas tarde" del mensajero actual sobre esta
   * orden. `true` si el propio actor la marco (`false` cuando no existe fila para la pareja,
   * R17). Solo informativa: no cambia el estatus ni la ruta de la orden (R15/R16).
   *
   * Opcional (`?`) por el patron aditivo ya usado por `OrdenDTO.mensajeroAsignadoId?`/
   * `prioridad?`: no rompe los fixtures que construyen `MiAsignacionDTO` sin el; `toDTO`
   * SIEMPRE lo envia (boolean, `false` por defecto). La UI del mensajero (feature 115/T8) lo
   * consume para el badge y el reordenado de presentacion.
   */
  marcarLuego?: boolean;
  /**
   * Feature 116 (R6/R8): nota PRIVADA del mensajero actual sobre esta orden. `string` con el
   * texto de su nota, o `null` si el propio actor no tiene nota para la orden. DISTINTA de
   * `notas` (nota de la TIENDA, `orden.notas`): esta viaja SOLO por (usuario_id, orden_id) de
   * `orden_mensajero_meta.nota`, se resuelve con `findNotasByMensajero(actor.usuarioId)` y NUNCA
   * expone la nota de otro mensajero para la misma orden (R8).
   *
   * Opcional (`?`) por el mismo patron aditivo que `marcarLuego?`: no rompe los fixtures que
   * construyen `MiAsignacionDTO` sin el; `toDTO` SIEMPRE lo envia (`null` por defecto y el
   * llamador lo sobreescribe con la nota real del actor). La UI del mensajero (feature 116/
   * Bloque F) lo consume para el editor del detalle y el indicador de la card.
   */
  notaPrivada?: string | null;
  /**
   * Feature 160 (R11/R14/R16/R24): intentos de entrega VIGENTES de la orden, derivados del
   * historial en el MISMO lote de la lectura (criterio unico de `OrdenHistorialService`,
   * design §1.1: destino `devuelta`, o destino `reprogramada` con familia `gestion`).
   *
   * Opcional (`?`) por el mismo patron aditivo que `marcarLuego?`/`notaPrivada?`: no rompe los
   * fixtures que construyen `MiAsignacionDTO` sin el; el servicio SIEMPRE lo envia, `0`
   * incluido (R14). La UI del mensajero lo pinta con `?? 0` como un dato mas de la orden (R19).
   */
  intentosEntrega?: number;
  /**
   * Feature 157 (R15): telefono de la TIENDA dueña de la orden, para que el mensajero pueda
   * llamarla o escribirle antes de ir a recolectar. Distinto de `telefonoDest` (el del
   * destinatario final). El modelo no tiene direccion de la tienda, asi que el contacto es lo
   * unico que se puede ofrecer para llegar a ella (pregunta abierta 2 de requirements.md).
   *
   * Opcional (`?`) por el mismo patron aditivo que `marcarLuego?`/`notaPrivada?`: no rompe los
   * fixtures que construyen `MiAsignacionDTO` sin el; el repo SIEMPRE lo emite (`null` cuando
   * la tienda no tiene telefono registrado).
   *
   * DEUDA DECLARADA (feature 167, P1). Este campo entro con la 157 EXCLUSIVAMENTE para el panel
   * de recoleccion que vivia dentro de Entregas. La 167 retiro ese panel (R33), asi que hoy
   * NINGUN consumidor de Entregas lee este campo: el apartado de recoleccion usa su propio
   * `RecoleccionOrdenDTO`. No se retira porque `design.md §2.3` no lo lista entre las retiradas y
   * hacerlo tocaria fixtures de varios tests de Entregas, ampliando el alcance sin que nadie lo
   * pidiera (decision del leader, 2026-07-31). OJO: el campo homonimo de `MiAsignacionRow` SI
   * sigue siendo necesario — de ahi lo lee `listarRecoleccion` para construir su DTO.
   */
  tiendaTelefono?: string | null;
}

/**
 * Feature 92 (R27/R28/R30) — estado de la ruta optimizada del mensajero, que acompana al
 * listado. Es el bloque que la UI (feature 93) necesita para decidir si muestra el aviso
 * de "el orden no esta actualizado" y desde que clase de punto se calculo la ruta.
 */
export interface RutaResumenDTO {
  /**
   * `desactualizada` = la ultima llamada al proveedor fallo y lo que se muestra es el
   * ULTIMO ORDEN VALIDO conservado (R27), no un orden recien calculado. NUNCA significa
   * "se cayo a createdAt desc": eso no ocurre jamas.
   */
  estado: "vigente" | "desactualizada";
  /** Instante de la ultima optimizacion exitosa. `null` = nunca se calculo. */
  calculadaAt: Date | null;
  /**
   * Desde que clase de punto se calculo (R24). `centroide` y `ultima_conocida` significan
   * que el punto de partida es aproximado y la UI debe poder decirlo.
   */
  origenFuente: "gps" | "ultima_conocida" | "centroide" | null;
  /** R28: cuantas ordenes en reparto NO tienen posicion todavia. */
  paradasSinOptimizar: number;
}

// Feature 61: KPIs del portal del mensajero, calculados SERVER-SIDE (autoritativos).
export interface MisAsignacionesKpis {
  /** # de ordenes en `en_reparto` (aceptadas/recogidas, en camino). */
  pendientes: number;
  /** # de ordenes `entregada` del mensajero. */
  entregadas: number;
  /** Suma de `montoCobrar` (COD) de las ordenes en `en_reparto`; null cuenta 0. */
  porCobrar: number;
  /**
   * Total a cobrar ACUMULADO: COD de las ordenes `en_reparto` + `entregada`. No baja al
   * ENTREGAR (la orden sale de reparto pero sigue sumando como entregada); se descuenta
   * cuando se gestiona como reprogramada/devuelta/rechazada (no entra en ningun set).
   */
  totalACobrar: number;
}

// R9/R10/R20: dos grupos separados (por recoger vs por gestionar) + el puntero de
// bloqueo del actor (para que la UI marque la orden activa y bloquee las demas).
// Feature 61: + `kpis` para la fila de indicadores del portal.
//
// Feature 167 (R34): DOS grupos, no tres. La recoleccion en tienda tiene contrato propio
// (`ListarRecoleccionResult`) y service propio; este contrato NO transporta ordenes en estado
// de recoleccion. La ausencia es el requisito: lo que no viaja por aqui no puede reaparecer en
// los KPIs, en el mapa ni en el corte del dia.
export type ListarMisAsignacionesServiceResult =
  | {
      status: "ok";
      /**
       * R29: "Por recoger" CONSERVA su orden actual (`createdAt desc`). Esta feature NO lo
       * toca: esas ordenes aun no son paradas de ninguna ruta.
       */
      porRecoger: MiAsignacionDTO[];
      /**
       * R28: sale YA ORDENADO del service — primero las que tienen posicion, por
       * `secuencia` asc; despues las que no la tienen, conservando su `createdAt desc`.
       */
      porGestionar: MiAsignacionDTO[];
      ordenEnGestionId: string | null;
      kpis: MisAsignacionesKpis;
      /** Feature 92 (R27/R28/R30): estado de la ruta que produjo ese orden. */
      ruta: RutaResumenDTO;
    }
  | { status: "forbidden" };

/**
 * Feature 92 (R22/R23): ubicacion capturada por la geolocalizacion del navegador. SIEMPRE
 * OPCIONAL — R25 es explicito: la denegacion del permiso NUNCA bloquea la accion, solo
 * hace que el origen de la ruta caiga al siguiente escalon (R24).
 */
export interface UbicacionInput {
  lat: number;
  lng: number;
}

// R16: recoger recibe un conjunto de ids (soporta "recoger todas" y de a una).
export interface RecogerInput {
  ordenIds: string[];
  /** Feature 92/R22: opcional; ausente = el navegador no la dio o la denegaron. */
  ubicacion?: UbicacionInput;
}

// R17/R29: motivo por orden cuando una no puede recogerse (borrada, origen
// invalido). El service ABORTA sin efectos.
export interface DetalleConflicto {
  ordenId: string;
  motivo: string;
}

export type RecogerServiceResult =
  | { status: "ok"; recogidas: string[] }
  | { status: "forbidden" } // R12 (rol) / R17 (orden ajena o inexistente)
  | { status: "conflict"; detalle: DetalleConflicto[] }; // R17 (origen invalido)

export type EscogerServiceResult =
  | { status: "ok"; ordenId: string }
  | { status: "forbidden" } // R12 / orden ajena
  | { status: "conflict"; motivo: string }; // R21: ya hay otra orden activa / origen invalido

// Evidencia ya leida del borde (binario + metadatos), lista para subir a Storage.
export interface EvidenciaArchivo {
  contentType: string;
  bytes: Uint8Array;
}

// Entrada discriminada por `resultado` (R22/R25/R27/R29). La validacion de
// obligatoriedad/MIME/tamano/fecha ya paso en el borde (zod); el service revalida
// propiedad/origen/bloqueo y la regla (h) monto == montoCobrar.
// Feature 92 (R22): `ubicacion` opcional en las CUATRO ramas. Va como interseccion para no
// repetirla en cada variante ni tocar el discriminante.
// Feature 119 (R5): la evidencia UNICA (`evidencia`) pasa a una LISTA `evidencias`
// (1..N, tope R7) en las 3 ramas con foto. `reprogramada` sigue sin evidencia.
// Feature 193 (R14): `ubicacionAusencia` viaja por la MISMA interseccion, por el mismo motivo.
// Sigue siendo opcional AQUI —el tipo no puede expresar «una u otra»— porque esa regla ya la
// impuso el borde (`gestionarSchema`, R8-R12) y duplicarla en el tipo no la haria mas cierta:
// al service solo le llegan entradas que ya pasaron por zod.
export type GestionarInput = {
  ubicacion?: UbicacionInput;
  ubicacionAusencia?: GestionUbicacionAusenciaValue;
} & (
  | {
      ordenId: string;
      resultado: "entregada";
      montoRecibido: number;
      metodoPago: MetodoPago;
      evidencias: EvidenciaArchivo[];
    }
  | { ordenId: string; resultado: "reprogramada"; fechaReprogramacion: string; motivo: string }
  // Feature 73/R10: la causa tipificada es un campo de la rama `devuelta` y SOLO de ella.
  // Feature 75: la evidencia pasa a ser obligatoria tambien en `devuelta` (espejo de rechazada).
  | {
      ordenId: string;
      resultado: "devuelta";
      causaDevolucion: CausaDevolucion;
      motivo: string;
      evidencias: EvidenciaArchivo[];
    }
  | { ordenId: string; resultado: "rechazada"; motivo: string; evidencias: EvidenciaArchivo[] }
  // Feature 158 (R9/R10/R11): el INCIDENTE. Causa tipificada + motivo libre + 1..N fotos
  // OBLIGATORIAS en las TRES causas (Q-B). Sin `montoRecibido`/`metodoPago`: no hay recaudo.
  | {
      ordenId: string;
      resultado: "incidente";
      causaIncidente: CausaIncidente;
      motivo: string;
      evidencias: EvidenciaArchivo[];
    }
);

export type GestionarServiceResult =
  // Feature 119 (R13): URLs firmadas de las N evidencias (TTL acotado), NUNCA el path crudo.
  | { status: "ok"; ordenId: string; estado: string; evidenciaUrls?: string[] }
  | { status: "forbidden" } // R12 / orden ajena
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R22/R24 (monto != montoCobrar, etc.)
  | { status: "conflict"; motivo: string }; // R18/R21 origen invalido / otra orden activa

// R35: liberar el puntero de bloqueo. Idempotente: `ok` aunque no hubiera nada
// que limpiar; `forbidden` si el actor no es mensajero.
export type LiberarServiceResult = { status: "ok" } | { status: "forbidden" };

export interface IMisAsignacionesService {
  /** R9-R13: dos grupos + puntero de bloqueo; solo `mensajero` (sobre sus ordenes). */
  listarMisAsignaciones(actor: Actor): Promise<ListarMisAsignacionesServiceResult>;
  /** R14-R17: transiciona por_recoger -> en_reparto (lote o de a una). */
  recogerAsignaciones(input: RecogerInput, actor: Actor): Promise<RecogerServiceResult>;
  /** R19-R21: fija la orden activa 1-a-1; conflict si ya hay otra activa. */
  escogerParaGestion(ordenId: string, actor: Actor): Promise<EscogerServiceResult>;
  /** R18/R22-R32: registra la gestion (4 resultados) con atomicidad storage<->DB. */
  gestionar(input: GestionarInput, actor: Actor): Promise<GestionarServiceResult>;
  /** R35: libera el puntero de bloqueo del propio actor si apunta a esa orden. */
  liberarGestion(ordenId: string, actor: Actor): Promise<LiberarServiceResult>;
}
