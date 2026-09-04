import type { PrismaClient } from "@prisma/client";

import type {
  CorreccionFechaAplicada,
  CorregirFechaReprogramacionRepoInput,
  ICorreccionFechaReprogramacionRepository,
  OrdenParaCorreccionRow,
} from "@/lib/interfaces/repositories/ICorreccionFechaReprogramacionRepository";
import { appendAccion, resolverActorCongelado } from "@/lib/repositories/registrar-accion";
import { etiquetaDeEntidad } from "@/lib/types/historial-accion-etiquetas";
// LA CORRELACION DE LA GESTION VIGENTE SE IMPORTA. Es la MISMA que usa el cron para decidir que
// fecha mira (`LiberacionReprogramadaRepository`): si aqui se escribiera otra equivalente, el dia
// que una orden tuviera dos gestiones `reprogramada` vivas se corregiria una fecha que el cron no
// mira, y la pantalla diria que quedo arreglada.
import { findGestionReprogramadaVigente } from "@/lib/repositories/gestion-reprogramada-vigente";
import { registrarCambioFechaReprogramacion } from "@/lib/repositories/registrar-cambio-fecha-reprogramacion";

// FICHA 371 — capa de DATOS de «corregir la fecha de una reprogramacion ya registrada».
//
// SOLO queries: quien puede corregir, que fecha es aceptable y que se le contesta al operador lo
// decide `CorreccionFechaReprogramacionService`. Aqui viven las tres cosas que solo se pueden
// garantizar donde corre el SQL: el bloqueo de la fila, la guarda de estado en el `WHERE` y la
// atomicidad de los dos rastros.

/**
 * La convencion de `@db.Date` en este repo: la fecha calendario se guarda como la MEDIANOCHE UTC de
 * ese dia (feature 36, `new Date(...T00:00:00.000Z)`), asi que volver al texto es el corte de los
 * diez primeros caracteres del ISO. Es el mismo par de conversiones que ya hacen
 * `GestionOrdenRepository` (al escribir) y `CierresAdminRepository` (al leer) sobre ESTA columna.
 *
 * NO se usa `toLocaleDateString` ni la hora de CR: el valor no es un instante, es un dia, y ya
 * llego resuelto por el borde.
 */
function fechaCalendarioComoTexto(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

function textoComoFechaCalendario(texto: string): Date {
  return new Date(`${texto}T00:00:00.000Z`);
}

export class CorreccionFechaReprogramacionRepository
  implements ICorreccionFechaReprogramacionRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * PRE-CHEQUEO. Trae la orden con su estado y la gestion `reprogramada` vigente con su fecha, para
   * que el servicio pueda rechazar NOMBRANDO el motivo (no existe / borrada / no esta en
   * `reprogramada` / sin gestion / sin fecha / ya es esa fecha).
   *
   * La eleccion de la gestion sale de la correlacion COMPARTIDA, igual que en la escritura: si el
   * pre-chequeo mirara una gestion y la escritura otra, el mensaje de rechazo podria hablar de una
   * fila distinta de la que se toca.
   */
  async findOrdenParaCorreccion(ordenId: string): Promise<OrdenParaCorreccionRow | null> {
    const orden = await this.prisma.orden.findUnique({
      where: { id: ordenId },
      select: { id: true, deletedAt: true, estatus: { select: { value: true } } },
    });
    if (orden === null) return null;

    const gestion = await findGestionReprogramadaVigente(this.prisma, ordenId);
    return {
      ordenId: orden.id,
      estatusValue: orden.estatus.value,
      deletedAt: orden.deletedAt,
      gestionVigenteId: gestion?.id ?? null,
      fechaReprogramacion: gestion?.fechaReprogramacion ?? null,
    };
  }

  /**
   * LA ESCRITURA, todo-o-nada.
   *
   * ⚠️ EL `FOR UPDATE` ES EL CORAZON DE ESTE METODO, y no es defensivo: es lo unico que impide que
   * la foto de la fecha anterior quede RANCIA entre el `SELECT` y el `UPDATE`. Sin el —o
   * fotografiando DESPUES de escribir— el rastro podria decir que se corrigio de X a X, o de un
   * valor que ya no era el de la fila, y un rastro que miente es peor que no tenerlo. Es la misma
   * leccion, escrita con las mismas palabras, que `OrdenRepository.corregirDiaRepartoLote` (262).
   *
   * DOS SENTENCIAS Y NO UNA (patron 262): un `UPDATE … FROM (SELECT … FOR UPDATE)` seria mas corto
   * pero dejaria de tener un `SET` plano, y la huella de columnas de esta escritura —EXACTAMENTE
   * `{fecha_reprogramacion}`— es lo que hace verificable que corregir una fecha no toca el
   * resultado, ni el cierre, ni la anulacion, ni el mensajero de la gestion. `gestion_orden` no
   * tiene `updated_at` (ver `db/schema.prisma`), asi que no hay nada mas que escribir.
   *
   * `null` = no se escribio NADA.
   */
  async corregirFecha(
    input: CorregirFechaReprogramacionRepoInput,
  ): Promise<CorreccionFechaAplicada | null> {
    const fechaNueva = textoComoFechaCalendario(input.fecha);

    return this.prisma.$transaction(async (tx) => {
      // 1. LA GESTION QUE MANDA, elegida DENTRO de la transaccion y con la correlacion compartida
      //    con el cron. Elegirla fuera dejaria una ventana en la que el mensajero registra una
      //    gestion nueva y la correccion escribe sobre la vieja.
      const vigente = await findGestionReprogramadaVigente(tx, input.ordenId);
      if (vigente === null) return null;

      // 2. FOTO + BLOQUEO de la fecha anterior. El `SELECT` va antes del `UPDATE` y con `FOR
      //    UPDATE`: a partir de aqui nadie mas puede tocar esa fila hasta que esta transaccion
      //    termine, asi que lo que se lee es lo que se va a pisar.
      const previas = await tx.$queryRaw<{ fecha_reprogramacion: Date | null }[]>`
        SELECT "fecha_reprogramacion"
        FROM "gestion_orden"
        WHERE "id" = ${vigente.id}
        FOR UPDATE`;
      const fechaAnterior = previas[0]?.fecha_reprogramacion ?? null;
      // Sin fecha previa no hay correccion (la operacion EXIGE una fecha que corregir) y tampoco
      // habria como escribir la fila del rastro, que la tiene NOT NULL. Fallo CERRADO.
      if (fechaAnterior === null) return null;

      // 3. LA CORRECCION, GUARDADA POR ESTADO. Las cinco guardas del `WHERE` son la razon por la
      //    que este metodo no necesita confiar en el pre-chequeo:
      //      · la gestion sigue siendo `reprogramada` y no esta anulada;
      //      · sigue teniendo fecha, y esa fecha es OTRA (el CHECK de la tabla del rastro exige lo
      //        mismo: una correccion que no corrige nada no es un hecho que registrar);
      //      · y la ORDEN sigue en `reprogramada` y no esta borrada. Esta ultima es la que impide
      //        corregir la fecha de una orden que ya volvio a circular: ahi la fecha no decide
      //        nada y escribirla seria mover un dato muerto.
      const movidas = await tx.$queryRaw<{ id: string }[]>`
        UPDATE "gestion_orden"
        SET "fecha_reprogramacion" = ${input.fecha}::date
        WHERE "id" = ${vigente.id}
          AND "resultado" = 'reprogramada'
          AND "anulada_at" IS NULL
          AND "fecha_reprogramacion" IS NOT NULL
          AND "fecha_reprogramacion" <> ${input.fecha}::date
          AND EXISTS (
            SELECT 1 FROM "orden" o
            WHERE o."id" = ${input.ordenId}
              AND o."estatus_id" = ${input.estatusReprogramadaId}
              AND o."deleted_at" IS NULL
          )
        RETURNING "id"`;
      // Carrera perdida: alguien movio la orden o la gestion entre el pre-chequeo y esto. El
      // `return` va ANTES de los dos rastros, asi que una correccion que no ocurrio no deja NI UNA
      // fila en ninguna de las dos tablas.
      if (movidas.length !== 1) return null;

      // 4. EL RASTRO DETALLADO, con su motivo, por el choke point y en la MISMA tx.
      const [registrada] = await registrarCambioFechaReprogramacion(tx, [
        {
          gestionId: vigente.id,
          ordenId: input.ordenId,
          fechaAnterior,
          fechaNueva,
          actorUsuarioId: input.actorUsuarioId,
          motivo: input.motivo,
        },
      ]);

      // 5. LA FILA TRANSVERSAL (ficha 362), tambien en la MISMA tx. La entidad es LA GESTION, no la
      //    orden: lo que se corrigio es la fecha de ESA gestion, y es la pregunta que este registro
      //    tiene que contestar. Las dos fechas van en `valorAnterior`/`valorNuevo` —caben de sobra
      //    en `VarChar(60)` y una fecha no es un dato del destinatario—.
      const laOrden = await tx.orden.findUnique({
        where: { id: input.ordenId },
        select: { numGuia: true, numRemision: true },
      });
      const actor = await resolverActorCongelado(tx, input.actorUsuarioId);
      await appendAccion(tx, [
        {
          accion: "gestion_fecha_reprogramacion_corregida",
          entidadTipo: "gestion_orden",
          entidadId: vigente.id,
          entidadEtiqueta: etiquetaDeEntidad("gestion_orden", {
            numGuia: laOrden?.numGuia ?? null,
            numRemision: laOrden?.numRemision ?? null,
          }),
          valorAnterior: fechaCalendarioComoTexto(fechaAnterior),
          valorNuevo: input.fecha,
          ...actor,
        },
      ]);

      return {
        gestionId: vigente.id,
        cambioId: registrada.cambioId,
        fechaAnterior,
        fechaNueva,
      };
    });
  }
}
