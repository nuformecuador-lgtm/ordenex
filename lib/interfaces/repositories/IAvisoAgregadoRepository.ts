import type { GestionCausaDevolucion } from "@prisma/client";

// FICHA 409 (T4.1, design §4.4) — contrato del repositorio de los DOS avisos AGREGADOS. SOLO
// queries Prisma: el umbral, la agrupacion, la homogeneidad de plazos y el best-effort viven en
// `AvisosDiariosService`.
//
// ⚠️ ESTAS CONSULTAS SON LO QUE UN DOBLE DE TEST NO PUEDE VER. `porHacer` se deriva en memoria y
// los tests con dobles lo cubren de verdad; el conteo de novedades y el predicado de represadas
// son SQL, y un doble solo demuestra que el doble hace lo que el doble hace. Por eso su evidencia
// vive en `tests/integration/db/aviso-agregado-repository.test.ts`, contra Postgres real. Es la
// leccion «probar el WHERE donde vive», medida cuatro veces seguidas en este repo.

/** Una orden del resumen de novedades: lo justo para decidir la homogeneidad de plazos (R39/R40). */
export interface NovedadDelResumen {
  ordenId: string;
  /** Causa de su gestion `devuelta` VIGENTE. `null` si no la tiene (el servicio lo trata como mezcla). */
  causa: GestionCausaDevolucion | null;
}

/** Lo que una tienda con novedades sin gestionar aporta al aviso diario. */
export interface ResumenNovedadesTienda {
  tiendaId: string;
  /** Cuantas novedades del grupo «en devolucion» tiene esa tienda AHORA. */
  total: number;
  /**
   * El ancla MAS ANTIGUA del lote (R37/R38): la ultima transicion `anclaje_devolucion` de cada
   * orden, con caida a su gestion `devuelta` vigente para la poblacion legada — EL MISMO ANCLA que
   * usa `DevolucionSlaRepository.findDevueltasSla`, que es lo que impide que el aviso diga «lleva
   * 3 dias» sobre una orden a la que el cron le cuenta 5.
   * ⚠️ NUNCA `orden.updated_at`: es una fecha mutable que cualquier escritura mueve.
   */
  masAntiguaAt: Date;
  /** Las ordenes del lote, para decidir si comparten plazo (causa + tope de intentos). */
  ordenes: NovedadDelResumen[];
}

/** Lo que un ambito (una zona, o el total) aporta al aviso de represadas. */
export interface ResumenRepresadas {
  total: number;
  /** Ancla de la mas antigua: la ultima transicion cuyo DESTINO es `por_devolver`. */
  masAntiguaAt: Date | null;
}

export interface ResumenRepresadasZona extends ResumenRepresadas {
  zonaId: string;
  masAntiguaAt: Date;
}

export interface IAvisoAgregadoRepository {
  /**
   * R35/R37/R38 — una fila por TIENDA que tenga al menos una novedad del grupo «en devolucion».
   * Las tiendas sin novedades NO vienen (R43 sale gratis: el servicio no las ve).
   *
   * El predicado es el MISMO que pinta `/novedades` — si el aviso dijera «5» y la pantalla
   * enseñara 4, el aviso quedaria desacreditado el primer dia.
   */
  resumenNovedadesPorTienda(): Promise<ResumenNovedadesTienda[]>;

  /**
   * R57 — la cifra VIVA de novedades de UNA tienda, en el instante de la consulta. La usa el
   * resolutor de vigencia cuando un `adminTienda` abre la campana; NO la usa el cron.
   */
  contarNovedadesDeTienda(tiendaId: string): Promise<number>;

  /**
   * R45/R46/R48 — una fila por ZONA con ordenes represadas. Represada := en `por_devolver`, no
   * borrada, y anclada en ese estado ANTES de `ancladaAntesDe` (es decir, mas vieja que el umbral).
   *
   * ⚠️ `devolviendo_a_tienda` NO ENTRA, y no por omision: R46 lo prohibe. Medido en produccion el
   * 2026-09-10, ese estado tiene 247 ordenes y NINGUNA pasa de dia y medio — fluye. Vigilarlo
   * convertiria el aviso en ruido sobre el cubo mas grande.
   */
  resumenRepresadasPorZona(ancladaAntesDe: Date): Promise<ResumenRepresadasZona[]>;

  /** R49 — el TOTAL del sistema, sin acotar por zona: lo que ven maestro y admin. */
  resumenRepresadasGlobal(ancladaAntesDe: Date): Promise<ResumenRepresadas>;

  /**
   * R57 — la cifra VIVA de represadas acotada al AMBITO DEL ACTOR: su zona si es `adminSatelite`,
   * `null` (todo) si es `maestro`/`admin`. La usa el resolutor de vigencia al abrir la campana.
   */
  contarRepresadas(ancladaAntesDe: Date, zonaId: string | null): Promise<number>;
}
