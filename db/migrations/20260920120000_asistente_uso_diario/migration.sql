-- FICHA 436 (design 4.1, T8) -- EL TOPE DE GASTO DEL ASISTENTE: `asistente_uso_diario`.
--
-- QUE ES. Una fila por PERSONA y por DIA CALENDARIO DE COSTA RICA, con cuantas consultas hizo ese
-- dia (R14-R17) y cuantas veces el asistente le dijo «no lo se» (Q5). Es un CONTADOR: **lo unico
-- que esta ficha persiste**. Ni la pregunta, ni la respuesta, ni la imagen, ni el documento
-- consultado (R30).
--
-- ADITIVA PURA. No altera ninguna tabla, columna, indice ni enum preexistente. No hay backfill: el
-- contador empieza en cero porque antes de hoy no habia a quien contar. La unica referencia hacia
-- fuera es la clave ajena a `usuario`, que NO modifica esa tabla.
--
-- NO CREA NINGUN TIPO. Aqui no hay `CREATE TYPE` ni `ALTER TYPE`, asi que la leccion de los enums
-- recreados con lista NO aplica a esta carpeta, y NO SE TOCA NINGUN `down.sql` ANTERIOR (cada uno
-- es una foto de su rama y sigue siendo cierto).
--
-- POR QUE POSTGRES Y NO MEMORIA DEL PROCESO (alternativa descartada, design 8.2). En Vercel cada
-- funcion tiene su proceso y los arranques en frio son la norma: un contador en memoria cuenta «las
-- consultas de esta instancia desde que arranco», que no es un tope. Y no seria verificable: un test
-- sobre un `Map` afirma sobre el `Map`, no sobre el sistema. El precio de esta via se dice entero:
-- una migracion, y con ella el gate rapido negado.

-- =============================================================================================
-- 1) LA TABLA
-- =============================================================================================
CREATE TABLE "asistente_uso_diario" (
  "id"         TEXT NOT NULL,
  "usuario_id" TEXT NOT NULL,

  -- ⚠️ EL DIA DE COSTA RICA, NO EL DE UTC. Se escribe SIEMPRE con un `::date` explicito sobre la
  -- cadena `YYYY-MM-DD` que produce `fechaCalendarioCR` (`lib/utils/fecha-cr.ts`), nunca dejando
  -- que un `Date` de JavaScript se convierta por el camino: despues de las 18:00 hora de Costa Rica
  -- un `Date` serializado en otro huso cae en el dia SIGUIENTE, y entonces el tope se reiniciaria
  -- seis horas antes de tiempo, todos los dias, para todo el mundo.
  "fecha"      DATE NOT NULL,

  -- R14/R16 -- consultas de esa persona ese dia. Se incrementa ANTES de llamar al proveedor: al
  -- reves, una rafaga simultanea se cuela entera antes de que nadie haya contado nada.
  "consultas"  INTEGER NOT NULL DEFAULT 0,

  -- Q5 -- cuantas veces el asistente dijo «no lo se». EL NUMERO, NUNCA EL TEXTO. Es el unico bucle
  -- de realimentacion de toda la pieza: sin el, nadie sabria que documento falta escribir.
  "no_lo_se"   INTEGER NOT NULL DEFAULT 0,

  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "asistente_uso_diario_pkey" PRIMARY KEY ("id"),

  -- Un contador NO es evidencia (criterio de `push_envio_dia` y `usuario_preferencia`, no el de
  -- `historial_accion`): cuantas preguntas hizo alguien que ya no existe no significa nada, y
  -- dejar la fila huerfana solo sirve para que un recuento futuro sume filas de nadie.
  CONSTRAINT "asistente_uso_diario_usuario_id_fkey" FOREIGN KEY ("usuario_id")
    REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE,

  -- Un contador no puede ir hacia atras. Si algun dia una resta se cuela en el codigo, que falle
  -- aqui y no que deje un tope negativo que nunca se alcanza.
  CONSTRAINT "asistente_uso_diario_consultas_check" CHECK ("consultas" >= 0),
  CONSTRAINT "asistente_uso_diario_no_lo_se_check" CHECK ("no_lo_se" >= 0)
);

-- =============================================================================================
-- 2) EL INDICE UNICO -- **ES** LA ATOMICIDAD DE R17, NO UNA OPTIMIZACION DE LECTURA
-- =============================================================================================
-- El incremento es UNA sentencia: `INSERT ... ON CONFLICT ("usuario_id","fecha") DO UPDATE SET
-- consultas = consultas + 1 RETURNING consultas`. Dos peticiones simultaneas de la misma persona
-- chocan contra LA BASE —la segunda espera el lock de fila y suma sobre el valor ya escrito— y no
-- contra un `if` del codigo.
--
-- Con un `SELECT` previo (leer-y-luego-escribir) las dos leerian el mismo valor y las dos
-- escribirian el mismo +1: el tope se saltaria y NINGUN test de servicio lo notaria, porque los
-- dobles no tienen indice. Por eso R17 se mide contra Postgres real.
--
-- El nombre lo fija Prisma por convencion (`<tabla>_<columnas>_key`) y se escribe a mano aqui para
-- que el datamodel y la base no difieran.
CREATE UNIQUE INDEX "asistente_uso_diario_usuario_id_fecha_key"
  ON "asistente_uso_diario"("usuario_id", "fecha");

-- =============================================================================================
-- 3) LA SEMANTICA QUE LOS TIPOS NO DICEN (patron `analytics_daily` / `ranking_snapshot`)
-- =============================================================================================
COMMENT ON TABLE "asistente_uso_diario" IS
  'Ficha 436: contador del asistente de ayuda, una fila por usuario y dia calendario de Costa Rica. NO guarda la conversacion (ni preguntas, ni respuestas, ni imagenes): solo cuantas consultas hubo y cuantas veces el asistente respondio que no lo sabia.';

COMMENT ON COLUMN "asistente_uso_diario"."fecha" IS
  'Dia CALENDARIO de Costa Rica (fechaCalendarioCR, YYYY-MM-DD), no el dia UTC. Se escribe con ::date explicito sobre la cadena para que ninguna conversion de huso lo mueva.';

COMMENT ON COLUMN "asistente_uso_diario"."consultas" IS
  'Consultas de esa persona ese dia. Se incrementa ANTES de llamar al proveedor, asi que una consulta que el proveedor no llegue a atender (caida o timeout) TAMBIEN gasta cupo: es el precio de que una rafaga simultanea no se cuele entera.';

COMMENT ON COLUMN "asistente_uso_diario"."no_lo_se" IS
  'Cuantas veces el asistente respondio que no lo sabe. EL NUMERO, NUNCA EL TEXTO: es la senal de que falta documentacion, no un registro de lo que la gente pregunta.';

-- =============================================================================================
-- 4) RLS -- HABILITADA SIN POLICIES, patron `push_envio_dia` / `usuario_preferencia` / `jobs`
-- =============================================================================================
-- Este repo NO usa Supabase Auth (sesion propia, sin `auth.uid()`), asi que una policy no tendria a
-- quien preguntar y la autorizacion vive en el servidor. Lo que la RLS garantiza es que a estas
-- filas no se llega si no es por el servidor de la aplicacion. A esta tabla no se accede NUNCA
-- desde el cliente: el contador se cuenta en el servidor y el cliente no lo ve ni lo manda (R18).
ALTER TABLE "asistente_uso_diario" ENABLE ROW LEVEL SECURITY;
