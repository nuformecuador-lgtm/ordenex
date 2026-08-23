-- Feature 262 (B1, design §5.1/§5.2) — EL RASTRO de las correcciones del dia de reparto.
--
-- QUE ARREGLA. Hasta hoy el dia de reparto SOLO se puede fijar asignando y SOLO se puede borrar
-- desasignando (design §2, tercera medicion independiente). Corregirlo sin hacer ninguna de las
-- dos cosas no tiene ningun camino dentro del producto, asi que el 2026-08-21 se arreglo con un
-- `UPDATE` a mano contra produccion (guia 17496963, con autorizacion humana explicita). Ese
-- `UPDATE` no dejo rastro: nadie sabe hoy, DESDE DENTRO DE LA APLICACION, que esa fila se toco.
-- Esta tabla es ese rastro.
--
-- POR QUE UNA TABLA PROPIA Y NO UNA FILA DE `orden_historial_estado` (design §4.5, A1). Escribir
-- la correccion como `por_recoger -> por_recoger` con una familia nueva parece lo barato. No lo es,
-- y las tres consecuencias estan MEDIDAS:
--   1. ROMPERIA «Deshacer asignacion», Y FALLA CERRADO. `findOrigenesReversion` elige con
--      `DISTINCT ON` la fila mas reciente cuyo `estatus_destino_id` es el estado ACTUAL de la orden
--      y devuelve su origen. Con una fila falsa encima, ese origen seria `por_recoger`, que NO esta
--      en `NORMALIZACION_DESTINO` -> `conflict` con «sin historial». Traduccion: corregir el dia de
--      un lote lo dejaria sin poder deshacerse NUNCA MAS, y con un mensaje que ademas es falso.
--   2. NI SIQUIERA SE PODRIA ESCRIBIR: `appendCambioEstado` valida cada entrada contra
--      `TRANSICIONES` y lanza `TransicionIlegalError` si el par no esta declarado. Un bucle sobre
--      si mismo no esta —ni debe estar: seria una mentira sobre la maquina de estados—.
--   3. LE MENTIRIA A LOS INTEGRADORES: ese mismo choke point emite el webhook de estado (99/R10-
--      R11), asi que cada correccion enviaria un `por_recoger` REPETIDO sobre una orden que no se
--      movio.
-- Y una razon de forma encima de las tres: una fila del historial no tiene DONDE guardar «de que
-- dia a que dia». Habria que meterlo dentro de `motivo` como texto — un dato estructurado escondido
-- en una cadena, que es como se construye un rastro que nadie puede consultar.
--
-- ADITIVA: no altera ninguna tabla, columna, indice ni enum preexistente. `orden` NO cambia de
-- forma: `fecha_reparto` sigue siendo `DATE` nullable, sin default y sin backfill. No hay enum
-- nuevo, asi que no aplica la leccion de «un enum nuevo y los down.sql previos».
-- SIN MIGRACION DE DATOS (R33): no hay backfill ni reparacion automatica de nada. Las ordenes que
-- hoy esten reservadas para el dia equivocado se corrigen una a una, a mano y por una persona —que
-- es exactamente el punto de esta ficha.

CREATE TABLE "orden_dia_reparto_cambio" (
  "id"               TEXT NOT NULL,
  "orden_id"         TEXT NOT NULL,
  -- NOT NULL las dos: la operacion EXIGE dia previo (R5), asi que una fila que dijera «no tenia
  -- dia» no la puede escribir ningun productor. `DATE` y no `timestamp`: son FECHAS calendario,
  -- misma convencion que `orden.fecha_reparto` (46/246). Un `timestamp` reabriria la trampa de las
  -- seis horas que cerro la 166.
  "fecha_anterior"   DATE NOT NULL,
  "fecha_nueva"      DATE NOT NULL,
  -- NOT NULL, al reves que `orden_historial_estado.actor_usuario_id` (donde NULL significa «lo
  -- escribio un cron»): aqui SIEMPRE hay una persona, y quien corrigio es LA evidencia.
  "actor_usuario_id" TEXT NOT NULL,
  -- R21: motivo obligatorio, ya recortado en el borde (`trim().min(10).max(300)`).
  "motivo"           TEXT NOT NULL,
  -- R23: append-only. Sin `updated_at` y sin `deleted_at` a proposito — nada de esta fila se edita
  -- nunca; una correccion posterior ANADE otra fila.
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "orden_dia_reparto_cambio_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "orden_dia_reparto_cambio_orden_id_fkey" FOREIGN KEY ("orden_id")
    REFERENCES "orden"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- RESTRICT y no CASCADE ni SET NULL: quien corrigio es EVIDENCIA de la operacion y no se pierde
  -- al dar de baja a un usuario. Mismo criterio que `orden_nota.autor_id` y que
  -- `postulacion_recurso.atendida_por_id`.
  CONSTRAINT "orden_dia_reparto_cambio_actor_usuario_id_fkey" FOREIGN KEY ("actor_usuario_id")
    REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- R7 PUESTO EN LA BASE: una «correccion» que no corrige nada no es escribible ni por error.
  -- El servicio y el `WHERE` de la escritura ya lo impiden dos veces; esto es la tercera y la
  -- ultima. Prisma no expresa CHECK (precedente `notificacion_destinatario_xor`), asi que va a
  -- mano aqui.
  CONSTRAINT "orden_dia_reparto_cambio_dia_distinto"
    CHECK ("fecha_nueva" <> "fecha_anterior")
);

-- LA UNICA CONSULTA PREVISTA: «el rastro de esta orden», en orden cronologico. Un btree compuesto
-- la sirve entera y cubre ademas la FK a `orden` por prefijo, asi que no hace falta un indice
-- suelto por `orden_id`.
CREATE INDEX "orden_dia_reparto_cambio_orden_id_created_at_idx"
  ON "orden_dia_reparto_cambio"("orden_id", "created_at");

-- Segunda FK indexada (patron `orden_nota` / `postulacion_recurso`): sin el, el RESTRICT obliga a
-- recorrer la tabla cada vez que se intenta borrar un usuario.
CREATE INDEX "orden_dia_reparto_cambio_actor_usuario_id_idx"
  ON "orden_dia_reparto_cambio"("actor_usuario_id");

-- SIN indice por `fecha_nueva` ni por la fecha de la correccion: no hay consumidor. Un indice sin
-- consulta que lo use es coste de escritura sin beneficio (mismo criterio que
-- `postulacion_recurso`).

-- R26: RLS habilitada SIN policies (solo service role), patron `orden_nota` / `plantilla_mensaje` /
-- `notificacion` / `orden_historial_estado`. Este repo NO usa Supabase Auth (sesion propia, sin
-- `auth.uid()`), asi que una policy no tendria a quien preguntar y la autorizacion de negocio vive
-- en el servicio. Lo que la RLS garantiza es exactamente lo que R26 pide: a estas filas no se llega
-- si no es por el servidor de la aplicacion.
ALTER TABLE "orden_dia_reparto_cambio" ENABLE ROW LEVEL SECURITY;
