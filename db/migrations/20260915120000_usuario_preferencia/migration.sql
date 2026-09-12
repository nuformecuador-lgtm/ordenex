-- FICHA 422 (design 2.1/2.2, T1.2) -- EL LUGAR DE LA PREFERENCIA: `usuario_preferencia`.
--
-- QUE CAMBIA. Hoy la decision «quiero que me avisen» vive UNICAMENTE en el dispositivo: es la fila
-- de `push_suscripcion`. Al cerrar sesion esa fila se borra (410/R19, correcto y se conserva) y con
-- ella se va la unica huella de que la persona dijo que si. Esta tabla guarda esa decision APARTE
-- del dispositivo, para poder volver a suscribir ese mismo navegador -en silencio y sin pedir
-- nada- cuando la persona vuelve a entrar.
--
-- ADITIVA. No altera ninguna tabla, columna, indice ni enum preexistente. El unico `INSERT` es el
-- backfill de mas abajo, y escribe SOLO en la tabla que esta misma migracion acaba de crear.
--
-- NO CREA NINGUN TIPO. Aqui no hay `CREATE TYPE` ni `ALTER TYPE`, asi que la leccion de los enums
-- recreados con lista NO aplica a esta carpeta, y NO SE TOCA NINGUN `down.sql` ANTERIOR (cada uno
-- es una foto de su rama y sigue siendo cierto).
--
-- =============================================================================================
-- 1) LA TABLA -- 1:1 CON `usuario`, Y SU AUSENCIA SIGNIFICA «NO» (R1, R2)
-- =============================================================================================
-- Una fila por persona que ha decidido algo alguna vez. No hay estado «desconocido»: si no hay
-- fila, la preferencia esta NO PUESTA y se trata como «no» sin preguntarle a nadie (R2).
--
-- POR QUE UNA TABLA PROPIA Y NO UNA COLUMNA EN `usuario`: `usuario` se lee en cada resolucion de
-- sesion y ya carga 20 columnas y ~50 relaciones de dominio. Una preferencia no es identidad ni
-- estado operativo. Metida ahi viaja en cada lectura (incluidas las cuentas sinteticas de las API
-- keys, que nunca tendran preferencias) y convierte la tabla mas caliente del esquema en el cajon
-- de sastre donde acaba cada ajuste de interfaz.
--
-- POR QUE COLUMNAS TIPADAS Y NO CLAVE/VALOR: en un EAV una clave mal escrita NO FALLA, devuelve
-- «no hay preferencia» -- la familia de fallo mudo que este arbol persigue. Con una columna, una
-- preferencia mal nombrada no compila.
CREATE TABLE "usuario_preferencia" (
  "id"         TEXT NOT NULL,
  "usuario_id" TEXT NOT NULL,
  -- R1/R7/R8 -- «quiero que me avisen». NO dice en que dispositivo: eso lo dice `push_suscripcion`,
  -- y el permiso del navegador lo dice el navegador. R6: esta columna NO participa en la eleccion
  -- de destinatarios de un push, y una guardia del arbol lo vigila.
  "avisos_push" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "usuario_preferencia_pkey" PRIMARY KEY ("id"),

  -- R4: CASCADE, y no RESTRICT. Una preferencia NO es evidencia -- es lo que alguien quiere que la
  -- aplicacion haga con el -- asi que se va con la persona. Mismo criterio que `push_suscripcion`,
  -- no el de `historial_accion`.
  CONSTRAINT "usuario_preferencia_usuario_id_fkey" FOREIGN KEY ("usuario_id")
    REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- EL 1:1, Y ADEMAS LO QUE HACE ATOMICO EL UPSERT POR `usuario_id`. No es decoracion: el
-- repositorio escribe con `ON CONFLICT (usuario_id)` y SIN un `SELECT` previo. Con un indice normal
-- en vez de unico, dos pestanas que activen a la vez dejarian DOS filas y la lectura pasaria a
-- depender de cual salga primero. La exclusion la da la base, no una comprobacion de codigo.
-- El nombre lo fija Prisma por convencion (`<tabla>_<columna>_key`) y se escribe a mano aqui para
-- que el datamodel y la base no difieran.
CREATE UNIQUE INDEX "usuario_preferencia_usuario_id_key" ON "usuario_preferencia"("usuario_id");

-- =============================================================================================
-- 2) BACKFILL (R5) -- LA PREFERENCIA PUESTA EXACTAMENTE A QUIEN YA TENIA SUSCRIPCION
-- =============================================================================================
-- POR QUE `TRUE` Y NO «QUE LO VUELVAN A ACTIVAR». Una fila en `push_suscripcion` SOLO PUEDE EXISTIR
-- porque alguien toco el interruptor y concedio el permiso del navegador: no hay ningun otro camino
-- en el arbol que la cree. Esas personas ya hicieron el gesto que esta ficha llama «preferencia»;
-- lo unico que faltaba era el sitio donde anotarlo. Dejarlas en `FALSE` seria estrenar la funcion
-- olvidando la unica decision explicita que hay registrada, y el primer cierre de sesion las
-- apagaria -- que es el fallo que esta ficha viene a arreglar.
--
-- NO CREA FILA PARA NADIE MAS (R5). El `SELECT DISTINCT` acota el conjunto a quien tiene
-- suscripcion; el resto de la plantilla se queda SIN FILA, que es «no puesta» (R2).
--
-- SE MIDE ANTES Y DESPUES (design 2.4), y el numero va escrito en el informe ANTES de aplicar:
--     ANTES:   SELECT COUNT(*) AS suscripciones, COUNT(DISTINCT usuario_id) AS personas
--                FROM push_suscripcion;
--     DESPUES: SELECT COUNT(*) AS filas,
--                     COUNT(*) FILTER (WHERE avisos_push) AS puestas,
--                     COUNT(*) FILTER (WHERE updated_at = created_at) AS intactas
--                FROM usuario_preferencia;
--   `filas = puestas = intactas = personas` demuestra que el backfill hizo exactamente lo que dijo
--   y que NADA MAS toco esas filas. Un backfill sin su numero medido no se despliega.
--
-- El `ON CONFLICT DO NOTHING` es cinturon: la tabla acaba de crearse vacia, asi que hoy no puede
-- chocar. Queda para que reaplicar esto sobre una base que ya tuviera filas no reviente ni pise una
-- decision posterior de la persona.
INSERT INTO "usuario_preferencia" ("id", "usuario_id", "avisos_push", "created_at", "updated_at")
SELECT gen_random_uuid()::text, s."usuario_id", TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "usuario_id" FROM "push_suscripcion") AS s
ON CONFLICT ("usuario_id") DO NOTHING;

-- =============================================================================================
-- 3) RLS -- HABILITADA SIN POLICIES, patron `push_suscripcion` / `jobs` / `notificacion`.
-- =============================================================================================
-- Este repo NO usa Supabase Auth (sesion propia, sin `auth.uid()`), asi que una policy no tendria a
-- quien preguntar y la autorizacion de negocio vive en la Server Action. Lo que la RLS garantiza es
-- que a estas filas no se llega si no es por el servidor de la aplicacion.
ALTER TABLE "usuario_preferencia" ENABLE ROW LEVEL SECURITY;
