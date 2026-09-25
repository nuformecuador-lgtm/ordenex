// FICHA 409 (T4.2, design §4.4) — contrato del proceso diario que emite los DOS avisos agregados.
// El route handler solo conoce esto: HTTP + secreto, nada de negocio.

/**
 * R61 — lo que la corrida devuelve. SOLO CONTEOS AGREGADOS Y LA FECHA. Ni un identificador de
 * orden, de tienda, de zona ni de persona: la respuesta de un cron acaba en los logs de la
 * plataforma, y esos logs no son el sitio de la PII.
 */
export interface AvisosDiariosResumen {
  /** `YYYY-MM-DD`: el dia calendario de COSTA RICA de la corrida. Es tambien la mitad de la entidad. */
  fecha: string;
  /** Tiendas con al menos una novedad sin gestionar en el instante de la corrida. */
  tiendasConNovedades: number;
  /** Avisos de novedades efectivamente emitidos (la dedupe del dia puede reducirlo a cero). */
  avisosNovedadesEmitidos: number;
  /** Ordenes represadas en TODO el sistema (ambito global). */
  ordenesRepresadas: number;
  /** Zonas con al menos una orden represada. */
  zonasConRepresadas: number;
  /** Avisos de represadas efectivamente emitidos (global + una por zona). */
  avisosRepresadasEmitidos: number;
  /**
   * FICHA 462 (R9/R52) — el TERCER agregado de la corrida: reprogramadas DE HOY que siguen
   * retenidas por un cierre sin aprobar, en TODO el sistema (las dos formas, todos los ambitos).
   */
  reprogramadasRetenidas: number;
  /** Ambitos (el central y cada zona) con al menos una retenida en el instante de la corrida. */
  ambitosConRetenidas: number;
  /** Avisos de retenidas efectivamente emitidos (la dedupe del dia puede reducirlo a cero). */
  avisosRetenidasEmitidos: number;
  /**
   * R60 — cuantas emisiones fallaron y se ABSORBIERON. La corrida termina igual; el fallo queda
   * REGISTRADO con su operacion y su causa (nunca un `catch` vacio). Un numero, no una lista: la
   * lista llevaria identificadores.
   */
  fallos: number;
}

export interface IAvisosDiariosService {
  /** Corre la emision diaria completa. `now` entra por parametro: el dia CR sale de el. */
  ejecutar(now: Date): Promise<AvisosDiariosResumen>;
}
