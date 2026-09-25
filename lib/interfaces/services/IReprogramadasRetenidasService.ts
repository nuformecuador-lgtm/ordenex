import type { CierreEstado } from "@/lib/types/cierre";

// FICHA 462 (T1.4, design §2.1) — EL CONTRATO DEL CONTEO UNICO DE LAS REPROGRAMADAS RETENIDAS.
//
// «Retenida» = una reprogramada de hoy (fecha de reprogramacion vigente <= hoy CR) que sigue sin
// volver a bodega porque el cierre de su gestion no esta APROBADO. Tiene exactamente DOS formas:
//   · Forma A — la orden esta en `reprogramado` y `!puedeLiberarse` (276): visita real + cierre no
//     aprobado. Es la poblacion que el reloj cuenta como `esperandoCierre`. Legada tras la 454.
//   · Forma B — la orden esta en `en_reparto` (454) y su gestion PENDIENTE mas reciente es un
//     `reprogramado` con fecha vencida.
//
// UNA sola definicion para las CUATRO superficies (campana, push, marca en `/cierres-admin`,
// franja de `/ordenes`): las cuatro leen este servicio (R7). Y SOLO LECTURA (R8).

/** A quien le toca aprobar: la administracion central (maestro/admin) o la zona de un satelite. */
export type AmbitoRetenidas = { tipo: "central" } | { tipo: "zona"; zonaId: string };

/** Un cierre que retiene reprogramadas de hoy. Nunca `aprobado` (ambas formas lo excluyen). */
export interface CierreQueRetiene {
  cierreId: string;
  mensajeroId: string;
  mensajeroNombre: string;
  /** `solicitado`, `vencido` o `rechazado`. Nunca `aprobado`. */
  estado: CierreEstado;
  /** Jornada CR del cierre (`derivarJornada`, 271/R61). `null` = «cierre del dia», sin fecha. */
  jornadaCR: string | null;
  /** Por el destino PERSISTIDO del cierre: `bodega_central` -> central; `bodega_satelite` -> su zona. */
  ambito: AmbitoRetenidas;
  cuantas: number;
}

/** Retenidas cuya gestion NO tiene cierre, agrupadas por el mensajero asignado a la orden (R5). */
export interface MensajeroSinCierre {
  /** `null` si la orden no tiene mensajero (dato imposible para una retenida; se declara igual). */
  mensajeroId: string | null;
  mensajeroNombre: string | null;
  /** Por la zona de la ORDEN (`resolverDestinoCierre`): la bodega a la que volvera (decision 8). */
  ambito: AmbitoRetenidas;
  cuantas: number;
}

/** Una retenida, normalizada desde cualquiera de las dos formas. Insumo interno de la agrupacion. */
export interface RetenidaRow {
  ordenId: string;
  zonaId: string;
  mensajeroAsignadoId: string | null;
  /** `null` en la Forma A: la fila del reloj no trae el id de la gestion, y no hace falta. */
  gestionId: string | null;
  cierreId: string | null;
  forma: "reprogramado" | "en_reparto";
}

export interface ResumenRetenidas {
  /** `YYYY-MM-DD`, la fecha calendario CR del `hoyCR` con el que se calculo. */
  diaCR: string;
  /** Todas las retenidas del sistema (las dos formas, todos los ambitos). */
  total: number;
  /** Cuantas de cada forma. Es lo que R3 compara con el `esperandoCierre` del reloj. */
  porForma: { reprogramado: number; enReparto: number };
  /** Orden: mas retenidas primero, luego jornada ascendente (las sin jornada al final), luego mensajero. */
  cierres: CierreQueRetiene[];
  sinCierre: MensajeroSinCierre[];
}

export interface IReprogramadasRetenidasService {
  /** El conjunto ENTERO, agrupado. Base de las otras dos. Solo lectura. */
  resumen(hoyCR: Date): Promise<ResumenRetenidas>;
  /** Cifra viva acotada a un ambito (campana, R14). Deriva de `resumen` en memoria. */
  contar(hoyCR: Date, ambito: AmbitoRetenidas): Promise<number>;
  /**
   * Marca por cierre (S3): `Map<cierreId, cuantas>` SOLO para los ids pedidos; los que no retienen
   * no aparecen. UNA lectura por pagina, nunca una por fila (R26/R51).
   */
  contarPorCierre(hoyCR: Date, cierreIds: readonly string[]): Promise<Map<string, number>>;
}

/** `true` si los dos ambitos son el mismo. */
export function mismoAmbito(a: AmbitoRetenidas, b: AmbitoRetenidas): boolean {
  if (a.tipo === "central") return b.tipo === "central";
  return b.tipo === "zona" && b.zonaId === a.zonaId;
}

/**
 * Helper PURO: recorta un resumen a un ambito. Lo usan la franja de `/ordenes` (solo el central),
 * `contar` y los tests. El `total` del recorte es la suma de lo que queda: nunca el total global,
 * que es el numero de OTRA bodega (R6/R44).
 */
export function recortarPorAmbito(r: ResumenRetenidas, ambito: AmbitoRetenidas): ResumenRetenidas {
  const cierres = r.cierres.filter((c) => mismoAmbito(c.ambito, ambito));
  const sinCierre = r.sinCierre.filter((m) => mismoAmbito(m.ambito, ambito));
  const total =
    cierres.reduce((acc, c) => acc + c.cuantas, 0) +
    sinCierre.reduce((acc, m) => acc + m.cuantas, 0);
  return { diaCR: r.diaCR, total, porForma: r.porForma, cierres, sinCierre };
}
