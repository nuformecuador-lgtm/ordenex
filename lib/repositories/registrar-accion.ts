import { randomUUID } from "node:crypto";

import type {
  ActorCongelado,
  ActorCongeladoTxClient,
  EntradaAccion,
  HistorialAccionTxClient,
} from "@/lib/interfaces/repositories/IHistorialAccionRepository";

/**
 * FICHA 362 (design §2.1, R9/R13) — EL CHOKE POINT del registro de acciones.
 *
 * Calcado en forma y en contrato de `lib/repositories/registrar-cambio-estado.ts`, el punto unico
 * de `orden_historial_estado`. Funcion PURA reutilizable por los repositorios que ejecutan una
 * accion del catalogo, sin instanciar ningun repositorio del historial.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * LA REGLA, escrita como regla (design §2.2):
 *
 *   TODA escritura de una accion del catalogo DEBE invocar `appendAccion` en su MISMA
 *   `$transaction`, y SOLO con las entidades que EFECTIVAMENTE se escribieron.
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * Es la misma frase que ya gobierna `orden.estatus_id`. El sitio correcto para la llamada es el
 * METODO DEL REPOSITORIO que hace la mutacion, no la Server Action: el service no conoce Prisma y
 * la accion no tiene transaccion.
 *
 * POR QUE RECIBE `tx` Y NO UN CLIENTE PRISMA. Porque asi NO PUEDE abrir la suya. Eso es lo que
 * convierte R10 («si el registro falla, la accion no persiste») y R11 («si la accion falla, no
 * queda registro») en propiedades ESTRUCTURALES en vez de en una promesa que alguien tiene que
 * recordar. Dentro de una transaccion de Postgres un error de sentencia aborta la transaccion
 * entera: no existe el `try/catch` que se lo trague sin que se caiga todo.
 *
 * ⚠️ Y LA CONSECUENCIA QUE NO SE PUEDE SALTAR: quien llama tiene que pasarle las entidades
 * ALCANZADAS, no las PEDIDAS. Un `updateMany` devuelve un `count` y no los ids, asi que los tres
 * borrados por lote pasan a `UPDATE … RETURNING`. Registrar «lo pedido» en vez de «lo alcanzado»
 * escribe filas de auditoria de cosas que no ocurrieron, y son cosas distintas en cuanto una fila
 * no cumple el `where`. Es la misma leccion que ya esta escrita en `appendCambioEstado` sobre el
 * mensaje de bienvenida.
 *
 * ESTE ES EL UNICO SITIO DEL ARBOL QUE NOMBRA `tx.historialAccion` (R13). Lo vigila
 * `tests/unit/guards/historial-accion-punto-unico.guardia.test.ts`.
 *
 * @param tx        la transaccion EN CURSO de quien hace la accion.
 * @param entradas  una por ENTIDAD AFECTADA (R1). Vacio = no-op.
 * @param loteId    generado UNA vez por llamada (R7). Es parametro con default para poder fijarlo
 *                  en los tests, no para que un call-site pase uno por fila.
 */
export async function appendAccion(
  tx: HistorialAccionTxClient,
  entradas: readonly EntradaAccion[],
  loteId: string = randomUUID(),
): Promise<void> {
  // No-op con lote vacio (patron `appendCambioEstado`). Una accion que no alcanzo ninguna entidad
  // NO deja fila (R11): «se pidio» y «se hizo» son cosas distintas y aqui solo se registra la
  // segunda.
  if (entradas.length === 0) return;

  await tx.historialAccion.createMany({
    data: entradas.map((e) => ({
      accion: e.accion,
      entidadTipo: e.entidadTipo,
      entidadId: e.entidadId,
      // Recorte defensivo a la anchura de la columna: una etiqueta larga no puede tumbar la
      // ACCION. `etiquetaDeEntidad` ya trunca, esto es la red de abajo.
      entidadEtiqueta: e.entidadEtiqueta.slice(0, 120),
      actorUsuarioId: e.actorUsuarioId,
      actorNombre: e.actorNombre,
      actorRol: e.actorRol,
      monto: e.monto ?? null,
      valorAnterior: e.valorAnterior ?? null,
      valorNuevo: e.valorNuevo ?? null,
      // EL MISMO en todas las filas de esta llamada (R7). Se resolvio arriba, en el default del
      // parametro: generarlo aqui dentro del `map` daria un uuid POR FILA y el lote dejaria de
      // distinguir «79 borrados de un acto» de «79 actos».
      loteId,
    })),
  });
}

/** El actor del sistema/cron: los tres campos a `null` a la vez (R36). */
export const ACTOR_SISTEMA: ActorCongelado = {
  actorUsuarioId: null,
  actorNombre: null,
  actorRol: null,
};

/** Fila del usuario que necesita el congelado. `rol` viene por relacion. */
interface FilaActor {
  nombre: string;
  primerApellido: string | null;
  rol: { value: ActorCongelado["actorRol"] };
}

/**
 * FICHA 362 (design §2.4, R3) — resuelve el nombre y el rol del actor CON UNA SOLA CONSULTA,
 * dentro de la transaccion en curso, para congelarlos en la fila.
 *
 * POR QUE SE CONGELAN Y NO SE RESUELVEN AL LEER: uno de los eventos que este modulo registra ES EL
 * CAMBIO DE ROL. Leer el rol vivo al pintar re-etiquetaria la historia («el maestro Fulano aprobo»
 * sobre una fila de cuando Fulano era `admin`) y ese error es indetectable a ojo.
 *
 * POR QUE SE LEE AQUI Y NO SE ENSANCHA EL TIPO `Actor` DE LA SESION (alternativa descartada,
 * design §2.4): ensancharlo toca la resolucion de sesion de toda la app para un dato que solo usa
 * esta ficha, y mete el nombre de una persona en un objeto que hoy no lo lleva.
 *
 * UNA consulta POR ACCION, no por fila: se llama una vez antes del `appendAccion` del lote.
 *
 * `actorUsuarioId === null` es EL SISTEMA (un cron): devuelve los tres campos a `null` SIN
 * consultar. Y un id que no resuelve a ninguna fila tambien: no se inventa un nombre.
 */
export async function resolverActorCongelado(
  tx: ActorCongeladoTxClient,
  actorUsuarioId: string | null,
): Promise<ActorCongelado> {
  if (actorUsuarioId === null) return ACTOR_SISTEMA;

  const fila = (await tx.usuario.findUnique({
    where: { id: actorUsuarioId },
    select: { nombre: true, primerApellido: true, rol: { select: { value: true } } },
  })) as FilaActor | null;

  // `== null` y no `=== null`: un `findUnique` que no resuelve puede llegar como `undefined`
  // segun el cliente. Un actor que no se puede congelar se registra como SISTEMA; lo que no puede
  // pasar es que tumbe la accion (R36).
  if (fila == null) return ACTOR_SISTEMA;

  // El nombre CONGELADO. `primerApellido` es nullable en la base (feature 21), asi que se compone
  // sin dejar el espacio suelto. El apellido de un usuario del sistema NO es un dato del
  // destinatario de una orden: es la identidad del operador, que es justo lo que la fila registra.
  const nombre = [fila.nombre, fila.primerApellido].filter((p) => p != null && p !== "").join(" ");

  return {
    actorUsuarioId,
    actorNombre: nombre.slice(0, 120),
    actorRol: fila.rol?.value ?? null,
  };
}
