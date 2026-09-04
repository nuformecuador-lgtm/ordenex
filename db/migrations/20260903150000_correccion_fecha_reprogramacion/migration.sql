-- FICHA 371 — CORREGIR LA FECHA DE UNA REPROGRAMACION YA REGISTRADA.
--
-- QUE ARREGLA. Un mensajero reprograma y elige mal el dia: la orden queda esperando a la fecha
-- equivocada y HOY no hay ninguna pantalla para corregirla. Caso real que la origina: guia
-- 49906911, gestion `reprogramada` con `fecha_reprogramacion = 2026-09-04` cuando el motivo escrito
-- decia «se cambio la ruta para mañana» y se registro el 2 de septiembre.
--
-- LA MIGRACION HACE DOS COSAS, y van juntas porque son la misma ficha (una migracion por ficha se
-- lee mejor y su `down.sql` es uno solo):
--   1. LA TABLA `gestion_fecha_reprogramacion_cambio` — el rastro DETALLADO con su motivo. Molde
--      literal de `orden_dia_reparto_cambio` (feature 262, `20260822130000_orden_dia_reparto_cambio`):
--      misma operacion —corregir una fecha ya escrita que decide cuando la orden vuelve a
--      circular— sobre otra columna.
--   2. EL VALOR DE ENUM `gestion_fecha_reprogramacion_corregida` — la fila transversal de
--      `historial_accion` (ficha 362), que responde otra pregunta: «quien hizo que» en toda la
--      aplicacion. Los dos rastros NO se pisan: la tabla propia guarda el detalle con el motivo
--      (texto libre, que R5 de la 362 deja fuera de `historial_accion` a proposito) y la fila del
--      historial guarda quien, cuando y las dos fechas en `valor_anterior`/`valor_nuevo`.
--
-- POR QUE UNA TABLA PROPIA Y NO METER EL MOTIVO EN `historial_accion` (R5 de la 362): esa tabla se
-- DESCARGA a un archivo y no se purga nunca, y el texto libre tecleado por una persona es el vector
-- canonico de datos del destinatario («se cambio la ruta de Juan Perez»). Sus dos unicas columnas
-- de valor son `VarChar(60)` de vocabulario cerrado; una fecha cabe ahi, un motivo no —ni debe—.
--
-- ⚠️ EL `ADD VALUE` Y EL `CREATE TABLE` CONVIVEN EN LA MISMA TRANSACCION, Y ES SEGURO. Lo que
-- Postgres prohibe (55P04, «unsafe use of new value of enum type») es USAR el valor nuevo en la
-- transaccion que lo añadio, no añadirlo junto a DDL que no lo nombra. Esta migracion no escribe ni
-- una fila con el valor nuevo: su primer uso ocurre en runtime, en transacciones posteriores.
--
-- ADITIVA: no altera ninguna tabla, columna ni indice preexistente. `gestion_orden` NO cambia de
-- forma: `fecha_reprogramacion` sigue siendo `DATE` nullable. SIN MIGRACION DE DATOS: no hay
-- backfill. Las 31 ordenes que hoy esperan con una fecha se corrigen una a una, a mano y por una
-- persona — que es exactamente el punto de esta ficha.

-- ── 1. El valor nuevo del catalogo de acciones (ficha 362) ──────────────────────────────────────
ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS 'gestion_fecha_reprogramacion_corregida';

-- ── 2. El rastro detallado, con su motivo ───────────────────────────────────────────────────────
CREATE TABLE "gestion_fecha_reprogramacion_cambio" (
  "id"               TEXT NOT NULL,
  -- LA GESTION corregida: es la fila que de verdad se toca, y la que el cron de liberacion mira
  -- (`LiberacionReprogramadaRepository`, gestion `reprogramada` vigente de la orden).
  "gestion_id"       TEXT NOT NULL,
  -- Y la ORDEN, desnormalizada a proposito: la unica lectura prevista es «el rastro de esta orden»
  -- y llegar a ella por la gestion obligaria a un join en la ruta mas comun. `gestion_orden.orden_id`
  -- es inmutable, asi que no hay dos verdades que puedan divergir.
  "orden_id"         TEXT NOT NULL,
  -- NOT NULL las dos: la operacion EXIGE fecha previa (una gestion `reprogramada` sin fecha no se
  -- corrige, se rechaza), asi que una fila que dijera «no tenia fecha» no la puede escribir ningun
  -- productor. `DATE` y no `timestamp`: son FECHAS calendario, misma convencion que
  -- `gestion_orden.fecha_reprogramacion` (36/46). Un `timestamp` reabriria la trampa de las seis
  -- horas que cerro la 166.
  "fecha_anterior"   DATE NOT NULL,
  "fecha_nueva"      DATE NOT NULL,
  -- NOT NULL, al reves que `orden_historial_estado.actor_usuario_id` (donde NULL significa «lo
  -- escribio un cron»): aqui SIEMPRE hay una persona —solo `maestro` y `admin`—, y quien corrigio
  -- es LA evidencia.
  "actor_usuario_id" TEXT NOT NULL,
  -- OBLIGATORIO. Decision del humano del 2026-09-03: «el motivo si tiene que ir, basicamente es la
  -- misma gestion que reprogramar». Se valida con `motivoSchema` (`lib/types/gestion-orden.ts`), EL
  -- MISMO que valida el motivo al reprogramar — no una regla nueva.
  "motivo"           TEXT NOT NULL,
  -- Append-only. Sin `updated_at` y sin `deleted_at` a proposito: nada de esta fila se edita nunca;
  -- una correccion posterior ANADE otra fila.
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gestion_fecha_reprogramacion_cambio_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gestion_fecha_reprogramacion_cambio_gestion_id_fkey" FOREIGN KEY ("gestion_id")
    REFERENCES "gestion_orden"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "gestion_fecha_reprogramacion_cambio_orden_id_fkey" FOREIGN KEY ("orden_id")
    REFERENCES "orden"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- RESTRICT y no CASCADE ni SET NULL: quien corrigio es EVIDENCIA de la operacion y no se pierde
  -- al dar de baja a un usuario. Mismo criterio que `orden_dia_reparto_cambio.actor_usuario_id`,
  -- `orden_nota.autor_id` y `postulacion_recurso.atendida_por_id`.
  CONSTRAINT "gestion_fecha_reprogramacion_cambio_actor_usuario_id_fkey" FOREIGN KEY ("actor_usuario_id")
    REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- LA REGLA PUESTA EN LA BASE: una «correccion» que no corrige nada no es un hecho que registrar,
  -- y que lo impida la base es mas barato que recordarlo. El servicio y el `WHERE` de la escritura
  -- ya lo impiden dos veces; esto es la tercera y la ultima. Prisma no expresa CHECK (precedente
  -- `notificacion_destinatario_xor` y el propio `orden_dia_reparto_cambio_dia_distinto`), asi que
  -- va a mano aqui.
  CONSTRAINT "gestion_fecha_reprogramacion_cambio_fecha_distinta"
    CHECK ("fecha_nueva" <> "fecha_anterior")
);

-- LA CONSULTA PREVISTA: «el rastro de esta orden», en orden cronologico. Un btree compuesto la
-- sirve entera y cubre ademas la FK a `orden` por prefijo.
CREATE INDEX "gestion_fecha_reprogramacion_cambio_orden_id_created_at_idx"
  ON "gestion_fecha_reprogramacion_cambio"("orden_id", "created_at");

-- La FK a la gestion, indexada: sin el, el RESTRICT recorre la tabla cada vez que se intenta borrar
-- una gestion. Compuesto con `created_at` por el mismo motivo que el de arriba: «el rastro de esta
-- gestion» es la otra lectura natural.
CREATE INDEX "gestion_fecha_reprogramacion_cambio_gestion_id_created_at_idx"
  ON "gestion_fecha_reprogramacion_cambio"("gestion_id", "created_at");

-- Tercera FK indexada (patron `orden_dia_reparto_cambio` / `orden_nota`): sin el, el RESTRICT
-- obliga a recorrer la tabla cada vez que se intenta borrar un usuario.
CREATE INDEX "gestion_fecha_reprogramacion_cambio_actor_usuario_id_idx"
  ON "gestion_fecha_reprogramacion_cambio"("actor_usuario_id");

-- SIN indice por `fecha_nueva` ni por `created_at` suelto: no hay consumidor. Un indice sin consulta
-- que lo use es coste de escritura sin beneficio (mismo criterio que `orden_dia_reparto_cambio`).

-- RLS habilitada SIN policies (solo service role), patron `orden_dia_reparto_cambio` /
-- `gestion_orden` / `orden_historial_estado`. Este repo NO usa Supabase Auth (sesion propia, sin
-- `auth.uid()`), asi que una policy no tendria a quien preguntar y la autorizacion de negocio vive
-- en el servicio. Lo que la RLS garantiza es que a estas filas no se llega si no es por el servidor
-- de la aplicacion.
ALTER TABLE "gestion_fecha_reprogramacion_cambio" ENABLE ROW LEVEL SECURITY;
