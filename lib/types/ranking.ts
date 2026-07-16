// Feature 76 (design §9) — DTOs del ranking diario. Money-safe (R12): todo monto y el
// porcentaje ya redondeado cruzan servidor->cliente como STRING (nunca Prisma.Decimal ni
// ratio crudo). Serializacion en el service/repo, no en la UI.

/** Conteo agregado por mensajero (numerador o denominador del ranking). */
export interface ConteoPorMensajero {
  mensajeroId: string;
  total: number;
}

/** Premio de una posicion del podio. `monto` STRING|null (null = sin premio, R9);
 * `descripcion` rotulo libre opcional, INDEPENDIENTE del monto (null = sin descripcion). */
export interface PremioRankingDTO {
  posicion: 1 | 2 | 3;
  monto: string | null;
  descripcion: string | null;
}

/** Fila del ranking expuesta al cliente (R6/R12). */
export interface RankingRowDTO {
  /** 1..3 si ocupa el podio elegible; null fuera del podio. */
  posicion: number | null;
  mensajeroId: string;
  nombre: string;
  entregadasHoy: number; // R6: conteo crudo (numerador)
  asignadasHoy: number; // R6: conteo crudo (denominador)
  pct: string | null; // "96.0" | null si asignadasHoy=0 (R3/R12)
  premio: string | null; // monto asociado si podio+premio (R14), STRING
}

/** Payload del ranking para el cliente. */
export interface RankingData {
  ranking: RankingRowDTO[];
  premios: PremioRankingDTO[];
  esEditable: boolean; // true solo para maestro (R16/R17)
}

/** Entrada de edicion de premio (ya validada por zod en el borde). */
export interface EditarPremioInput {
  posicion: 1 | 2 | 3;
  monto: string | null; // string vacio -> null en el borde
  descripcion: string | null; // string vacio -> null en el borde; rotulo libre opcional
}
