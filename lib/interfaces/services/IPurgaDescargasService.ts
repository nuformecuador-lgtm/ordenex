// Ficha 470 (design §3.6, R17/R20) — contrato del servicio del cron de purga de los objetos temporales
// de las descargas grandes. Logica pura: el route handler `/api/cron/purga-descargas` lo invoca con el
// reloj inyectado y devuelve este resumen tal cual como cuerpo del `200`.

/** Resumen de una corrida (R20): SOLO conteos; nunca rutas de objetos. */
export interface PurgaDescargasResultado {
  objetosBorrados: number;
  /** Quedaban objetos viejos mas alla del tope de la corrida; los retoma la siguiente. */
  quedaPendiente: boolean;
}

export interface IPurgaDescargasService {
  /** R17: borra los objetos temporales creados antes de `now − RETENCION_MINUTOS`. */
  ejecutar(now: Date): Promise<PurgaDescargasResultado>;
}
