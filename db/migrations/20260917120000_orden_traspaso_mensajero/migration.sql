-- FICHA 427 (T2, design §4.1/§4.2) -- EL RASTRO de los TRASPASOS de una orden entre mensajeros.
--
-- QUE ARREGLA. El 2026-09-14 un mensajero se enfermo a media jornada y sus 31 ordenes `en_reparto`
-- las tuvo que hacer otro. La aplicacion NO SABE HACERLO: hoy los unicos escritores de
-- `orden.mensajero_asignado_id` son las dos asignaciones (central y satelite), la de recoleccion y
-- la limpieza del deshacer, y NINGUNO parte de `en_reparto`. Se resolvio escribiendo a mano contra
-- produccion -31 ordenes y 31 conversaciones de chat- y ese `UPDATE` no dejo rastro: nadie sabe
-- hoy, DESDE DENTRO DE LA APLICACION, quien movio esos paquetes ni por que. Esta tabla es ese
-- rastro.
--
-- POR QUE UNA TABLA PROPIA Y NO UNA FILA DE `orden_historial_estado` (design §A2). Un traspaso NO
-- CAMBIA EL ESTADO de la orden. Escribirlo como `en_reparto -> en_reparto` es imposible de dos
-- formas a la vez:
--   1. NO SE PODRIA ESCRIBIR: `appendCambioEstado` valida cada entrada contra `TRANSICIONES`
--      (feature 140) y lanza `TransicionIlegalError` si el par no esta declarado. Un bucle sobre si
--      mismo no esta -ni debe estar: seria una mentira sobre la maquina de estados-.
--   2. LE MENTIRIA A LOS INTEGRADORES: ese mismo choke point emite el webhook de estado (99/R10),
--      asi que cada traspaso enviaria un `en_reparto` REPETIDO sobre una orden que no se movio.
-- Y una razon de forma encima: una fila del historial no tiene DONDE guardar «de que mensajero a
-- que mensajero». Habria que meterlo dentro de `motivo` como texto, que es como se construye un
-- rastro que nadie puede consultar.
--
-- POR QUE TAMPOCO SOLO `historial_accion` (362, design §A3): el motivo es texto libre tecleado por
-- una persona y R5 de la 362 lo deja FUERA de esa tabla a proposito (se descarga a un archivo y no
-- se purga nunca); y `valor_anterior`/`valor_nuevo` son `VarChar(60)` de vocabulario CERRADO -- un
-- nombre de persona no lo es. Precedente exacto: la 262 y la 371 crearon tabla propia por esto
-- mismo. DECIDIDO el 2026-09-14 (D6): una sola fuente de rastro, esta.
--
-- ADITIVA: no altera ninguna tabla, columna, indice ni enum preexistente. `orden` NO cambia de
-- forma: no gana ninguna columna. NO CREA NINGUN TIPO, asi que no hay `DROP TYPE` que hacer en el
-- down ni lista de enum que recrear, y NO SE TOCA NINGUN `down.sql` ANTERIOR (son fotos de su
-- momento). Los DOS valores de enum que esta ficha necesita para sus avisos viven en OTRA
-- migracion, posterior y separada (`20260917120100_notificacion_evento_traspaso`), porque Postgres
-- no deja USAR un valor de enum en la misma transaccion que lo anadio (`55P04`).
--
-- SIN MIGRACION DE DATOS: no hay backfill. Los 31 traspasos que se hicieron a mano el 2026-09-14 NO
-- se reconstruyen -- nadie tiene el motivo escrito de aquello, e inventarlo seria escribir un dato
-- falso con formato de dato.
--
-- EL TIMESTAMP (20260917120000) SE ESCRIBE A MANO y es POSTERIOR a toda migracion ya aplicada; la
-- ultima del arbol al escribir esto es `20260916120000_orden_clave_remision`.
-- JAMAS RENUMERAR UNA CARPETA YA APLICADA: deja una fila fantasma que `migrate status` no ve.

CREATE TABLE "orden_traspaso_mensajero" (
  "id"                    TEXT NOT NULL,
  "orden_id"              TEXT NOT NULL,
  -- Los DOS extremos, NOT NULL las dos: una orden sin mensajero no se traspasa, se ASIGNA. El
  -- traspaso parte siempre de alguien que ya la lleva encima.
  "mensajero_anterior_id" TEXT NOT NULL,
  "mensajero_nuevo_id"    TEXT NOT NULL,
  -- NOT NULL, al reves que `orden_historial_estado.actor_usuario_id` (donde NULL significa «lo
  -- escribio un cron»): aqui SIEMPRE hay una persona, y quien traspaso es LA evidencia.
  "actor_usuario_id"      TEXT NOT NULL,
  -- R26: el rol del actor CONGELADO en el instante del traspaso, no resuelto por join al leer. El
  -- rol de una persona cambia -la 362 registra ese mismo evento- y leer el rol vivo al pintar
  -- RE-ETIQUETARIA la historia. Precedente: `orden_nota.rol_autor`, `historial_accion.actor_rol`.
  "actor_rol"             "rol_value" NOT NULL,
  -- R28: motivo obligatorio, ya recortado en el borde (`trim().min(10).max(300)`).
  "motivo"                TEXT NOT NULL,
  -- R27: uuid POR ACTO, no por fila. Todas las filas de un mismo traspaso lo comparten: es lo que
  -- distingue «se traspasaron 31 ordenes de una vez» de «hubo 31 traspasos». Es ademas LA ENTIDAD
  -- de los dos avisos (design §6.5): con el mensajero como entidad, el segundo traspaso del dia a
  -- la misma persona no avisaria NUNCA.
  "lote_id"               TEXT NOT NULL,
  -- R30: append-only. Sin `updated_at` y sin `deleted_at` A PROPOSITO -- nada de esta fila se edita
  -- nunca; un traspaso posterior ANADE otra fila.
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "orden_traspaso_mensajero_pkey" PRIMARY KEY ("id"),
  -- LAS CUATRO FK SON `RESTRICT` / `CASCADE`: quien llevaba un paquete es evidencia y no se pierde
  -- al dar de baja a un usuario ni al intentar borrar la orden. Mismo criterio que
  -- `orden_dia_reparto_cambio.actor_usuario_id` y `orden_nota.autor_id`.
  CONSTRAINT "orden_traspaso_mensajero_orden_id_fkey" FOREIGN KEY ("orden_id")
    REFERENCES "orden"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "orden_traspaso_mensajero_mensajero_anterior_id_fkey" FOREIGN KEY ("mensajero_anterior_id")
    REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "orden_traspaso_mensajero_mensajero_nuevo_id_fkey" FOREIGN KEY ("mensajero_nuevo_id")
    REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "orden_traspaso_mensajero_actor_usuario_id_fkey" FOREIGN KEY ("actor_usuario_id")
    REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- R7 PUESTO EN LA BASE: un «traspaso» a la misma persona no es escribible ni por error. El servicio
-- ya lo rechaza y el `WHERE` de la escritura no lo tocaria; esto es la tercera y ultima red. Prisma
-- no expresa CHECK (precedente `orden_dia_reparto_cambio_dia_distinto`), asi que va a mano aqui.
ALTER TABLE "orden_traspaso_mensajero"
  ADD CONSTRAINT "orden_traspaso_mensajero_distinto_check"
  CHECK ("mensajero_nuevo_id" <> "mensajero_anterior_id");

-- LA LECTURA PREVISTA: «el rastro de esta orden», en orden cronologico (la linea de tiempo). Un
-- btree compuesto la sirve entera y cubre ademas la FK a `orden` por prefijo.
CREATE INDEX "orden_traspaso_mensajero_orden_id_created_at_idx"
  ON "orden_traspaso_mensajero"("orden_id", "created_at");

-- «Que se le quito a este mensajero» y «que recibio este mensajero». Indexan ademas sus dos FK
-- RESTRICT por prefijo: sin ellos, borrar un usuario recorre la tabla entera.
CREATE INDEX "orden_traspaso_mensajero_mensajero_anterior_id_created_at_idx"
  ON "orden_traspaso_mensajero"("mensajero_anterior_id", "created_at");
CREATE INDEX "orden_traspaso_mensajero_mensajero_nuevo_id_created_at_idx"
  ON "orden_traspaso_mensajero"("mensajero_nuevo_id", "created_at");

-- La tercera FK RESTRICT, indexada (patron `orden_dia_reparto_cambio_actor_usuario_id_idx`).
CREATE INDEX "orden_traspaso_mensajero_actor_usuario_id_idx"
  ON "orden_traspaso_mensajero"("actor_usuario_id");

-- R27: reconstruir un ACTO completo («las 31 filas de aquel traspaso»).
CREATE INDEX "orden_traspaso_mensajero_lote_id_idx"
  ON "orden_traspaso_mensajero"("lote_id");

-- RLS habilitada SIN policies (solo service role), patron `orden_dia_reparto_cambio` /
-- `gestion_fecha_reprogramacion_cambio` / `jobs` / `notificacion`. Este repo NO usa Supabase Auth
-- (sesion propia, sin `auth.uid()`), asi que una policy no tendria a quien preguntar y la
-- autorizacion de negocio vive en el servicio. Lo que la RLS garantiza es exactamente lo que hace
-- falta: a estas filas no se llega si no es por el servidor de la aplicacion.
ALTER TABLE "orden_traspaso_mensajero" ENABLE ROW LEVEL SECURITY;
