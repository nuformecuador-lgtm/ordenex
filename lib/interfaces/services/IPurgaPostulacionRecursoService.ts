// Feature 253 (P2, FIRMADA EN CONTRA de la recomendacion del spec) — contrato del cron de purga de
// postulaciones de recurso ATENDIDAS.
//
// ⚠️ Esto BORRA, y lo ejecuta un job desatendido: no hay nadie mirando cuando corre y no hay
// vuelta atras. Por eso el contrato dice, aqui y en la implementacion, cual es el predicado:
// `atendida_at` y NUNCA `created_at`. Una postulacion sin atender no se borra jamas.

/** Resumen SOLO numerico de una corrida: sin ids, sin nombres, sin correos (R19). */
export interface PurgaPostulacionRecursoResultado {
  /** Filas efectivamente borradas en esta corrida. */
  borradas: number;
  /** Corte usado, en ISO. Va en la respuesta para que una corrida sea auditable sin leer la base. */
  corte: string;
  /** `true` si el tope por corrida se agoto y queda historico por barrer manana. */
  quedaPendiente: boolean;
}

export interface IPurgaPostulacionRecursoService {
  /** Ejecuta UNA corrida. `now` entra por parametro (reloj inyectable) para poder probar el corte. */
  ejecutar(now: Date): Promise<PurgaPostulacionRecursoResultado>;
}
