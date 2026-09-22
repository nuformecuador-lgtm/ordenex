-- FICHA 453 (design 3.1/3.2/3.3, T1.3) -- EL LUGAR DE UNA VISTA: `vista_filtro`.
--
-- QUE CAMBIA. Hoy no existe ningun preset de filtros en todo el repo (censo del diseño previo:
-- «cero vistas guardadas»). Quien filtra por «San José arriba» -zona + cuatro distritos + un
-- termino- rearma esa combinacion CADA MAÑANA, y no hay atajo automatico que la derive: no es una
-- division administrativa, es geografia operativa y LA GUARDA UNA PERSONA. Esta tabla es ese sitio.
--
-- GRANO: una fila por VISTA (dueño x superficie x nombre). No es 1:1 con la persona, y por eso NO
-- cabe en `usuario_preferencia`, que es 1:1 y de columnas tipadas por decision explicita (422).
--
-- ADITIVA. No altera ninguna tabla, columna, indice ni enum preexistente. No hay backfill: no hay
-- nada que migrar. No hay ni un `INSERT`, ni un `UPDATE`, ni un `DELETE`, ni un `DROP`.
--
-- NO CREA NINGUN TIPO. Aqui no hay `CREATE TYPE` ni `ALTER TYPE`, asi que la leccion de los enums
-- recreados con lista NO aplica a esta carpeta, y NO SE TOCA NINGUN `down.sql` ANTERIOR (cada uno
-- es una foto de su rama y todos siguen siendo ciertos).
--
-- =============================================================================================
-- 1) LA TABLA -- SUPERFICIE + NOMBRE + DUEÑO + FILTRO, Y NADA MAS (R1)
-- =============================================================================================
-- POR QUE `superficie` ES TEXT Y NO UN ENUM DE POSTGRES. La decision 3 del humano exige que sumar
-- una pantalla sea ENCENDERLA, no rehacer nada (R32): con un enum, cada superficie nueva costaria
-- una migracion -y arrastraria la trampa del `down.sql` que recrea el tipo con lista, que en este
-- repo ya borro valores en silencio-. La lista cerrada vive en `lib/types/vista-filtro.ts` y la
-- valida el borde con `z.enum`: una superficie desconocida da `validation_error` RUIDOSO, nunca
-- una lista vacia (R33). Y «superficie» es el JUEGO DE FILTROS de una pantalla, no su ruta:
-- `/cierres-admin` monta la misma barra con tres juegos distintos y seran tres, no una.
--
-- POR QUE `filtro` ES JSONB Y NO UNA COLUMNA POR FILTRO. Lo segundo mataria la genericidad: solo
-- `/ordenes` declara 12 controles, y encender otra pantalla pediria una migracion por clave. Y NO
-- reabre el debate anti-EAV de `usuario_preferencia`: alli el argumento era que una clave mal
-- escrita NO FALLA y devuelve «no hay preferencia» -silencio-. Aqui no hay silencio posible: el
-- documento se valida con zod AL ESCRIBIR Y AL LEER, uno que no parsea se reporta ILEGIBLE (R8) y
-- no se aplica ni a medias.
--
-- POR QUE `version` ES UNA COLUMNA ADEMAS DE IR DENTRO DEL JSON (R7). Para poder contar y filtrar
-- por version -«cuantas filas quedan en v1»- sin abrir el documento el dia que exista una v2. Lo
-- que pasa al leer una version desconocida esta escrito en `leerPayloadGuardado`: no se adivina.
CREATE TABLE "vista_filtro" (
  "id"         TEXT NOT NULL,
  "usuario_id" TEXT NOT NULL,
  "superficie" TEXT NOT NULL,
  -- R9/R10: nombre obligatorio y acotado. El tope tambien vive en `NOMBRE_VISTA_MAX`, y esta
  -- columna es el cinturon: nada puede meter uno mas largo, venga por donde venga.
  "nombre"     VARCHAR(60) NOT NULL,
  "filtro"     JSONB NOT NULL,
  "version"    INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "vista_filtro_pkey" PRIMARY KEY ("id"),

  -- R4: CASCADE, y no RESTRICT. Una vista NO es evidencia -es un atajo de trabajo de una persona-
  -- asi que se va con ella. Mismo criterio que `usuario_preferencia` y `push_suscripcion`, no el
  -- de `historial_accion`.
  CONSTRAINT "vista_filtro_usuario_id_fkey" FOREIGN KEY ("usuario_id")
    REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- =============================================================================================
-- 2) EL UNICO INDICE, Y HACE DOS TRABAJOS (R11, R35 y la consulta caliente)
-- =============================================================================================
-- R11: el nombre es unico DENTRO del dueño y la superficie, no globalmente. R35: por eso dos
-- personas distintas pueden tener «San José arriba» a la vez -que es la propiedad que mantiene
-- posible publicar una vista algun dia (design 11) sin cambiar el grano ni las claves-.
--
-- Y ES ADEMAS EL INDICE DE LA UNICA CONSULTA CALIENTE: `WHERE usuario_id = ? AND superficie = ?
-- ORDER BY nombre` es prefijo exacto de este indice y el orden sale gratis. Un indice mas por
-- `created_at` seria peso muerto: el listado se ordena por nombre y el conjunto esta acotado por
-- el tope de 20 por superficie.
--
-- LIMITE ASUMIDO Y DOCUMENTADO (requirements.md > P3): la comparacion es EXACTA, asi que «San José
-- arriba» y «san josé arriba» conviven como dos vistas. Hacerlo insensible a mayusculas exigiria un
-- indice funcional que Prisma no expresa en el datamodel y que dejaria deriva permanente.
--
-- El nombre lo escribe a mano esta migracion y coincide con el `map` del `@@unique` del datamodel,
-- para que base y schema no difieran nunca.
CREATE UNIQUE INDEX "vista_filtro_dueno_superficie_nombre_key" ON "vista_filtro"("usuario_id", "superficie", "nombre");

-- =============================================================================================
-- 3) RLS -- HABILITADA SIN POLICIES, patron `usuario_preferencia` / `push_suscripcion` / `jobs`.
-- =============================================================================================
-- Este repo NO usa Supabase Auth (sesion propia, sin `auth.uid()`), asi que una policy no tendria a
-- quien preguntar. Lo que la RLS garantiza es que a estas filas no se llega si no es por el
-- servidor de la aplicacion; la autorizacion de negocio -que una vista es de SU dueño, R2- vive en
-- el `WHERE` de cada escritura del repositorio, y se prueba contra Postgres real.
ALTER TABLE "vista_filtro" ENABLE ROW LEVEL SECURITY;
