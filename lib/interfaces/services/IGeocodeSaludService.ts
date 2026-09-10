// FICHA 401 (design §5.2) — contrato del servicio de salud de la geocodificacion: reconocer la
// caida por configuracion propia (y avisar) y recuperar los jobs que murieron por ella.
//
// DOS metodos y nada mas. `GeocodificacionService` lo recibe por constructor con el NO-OP de
// abajo como default, de modo que ninguna suite existente —ni ninguna que se escriba manana— toque
// la base por el hecho de construir el service. El composition root es el unico que inyecta el
// real (`lib/services/jobs/geocodificacion-handler.ts`).

export interface IGeocodeSaludService {
  /**
   * R2/R3/R7 — un intento de geocodificacion acaba de morir por configuracion NUESTRA: evalua la
   * condicion de caida y, si se cruza el umbral dentro de la ventana, emite el aviso.
   *
   * `jobId` es el job EN CURSO, que se EXCLUYE de la cuenta y se suma como uno (el off-by-one de
   * design §5.3: su fallo todavia no esta persistido).
   *
   * NUNCA lanza (R11): el desenlace del job en curso no puede depender de que el aviso salga.
   */
  registrarFalloConfig(jobId: string, ahora: Date): Promise<void>;

  /**
   * R13 — el proveedor respondio bien DE VERDAD: devuelve a la cola hasta N jobs muertos por
   * configuracion, los mas antiguos primero y escalonados. Devuelve cuantos revivio.
   *
   * ⚠️ Un acierto de la CACHE no llega aqui nunca (R14): la cache sigue funcionando durante un
   * corte de credencial, asi que no prueba absolutamente nada sobre el proveedor.
   */
  registrarExitoProveedor(ahora: Date): Promise<number>;
}

/**
 * DEFAULT de `GeocodificacionService`: no hace nada y NO TOCA LA BASE.
 *
 * Es lo mismo que hace `notificadorNoOp` con los avisos, y por el mismo motivo: en este repo la
 * base local es COMPARTIDA entre worktrees, asi que un service construido en una suite sin cablear
 * su colaborador no puede permitirse consultar ni escribir nada. No husmea el entorno —apagar el
 * comportamiento segun `NODE_ENV` seria una falla silenciosa en cuanto una variable se filtrara a
 * un preview— y no importa nada de `lib/repositories/` ni de Prisma.
 */
export const geocodeSaludNoOp: IGeocodeSaludService = {
  async registrarFalloConfig(): Promise<void> {},
  async registrarExitoProveedor(): Promise<number> {
    return 0;
  },
};
