-- 🧾 FICHA 362 (2026-09-02) -- EL REGISTRO DE ACCIONES: quien hizo que, sobre que y cuando.
--
-- QUE PROBLEMA CIERRA, con el caso literal delante. El 2026-09-02 se borraron 79 ordenes y no
-- quedo ni una linea de rastro: `EliminarOrdenService` lo dice por escrito («borrar no es
-- transicionar») y no escribe nada. Lo mismo con aprobar o rechazar un cierre, registrar un pago,
-- mover plata en la caja, cambiar una tarifa --que ademas borra en FISICO, asi que la fila
-- desaparece y con ella el precio que estuvo vigente-- y activar, desactivar o cambiar el rol de
-- un usuario.
--
-- NO VA POR LOGS, y la decision esta cerrada: los del servidor rotan, no se filtran desde la app
-- y meter datos ahi los saca de sus reglas de retencion. Un modulo que se consulta necesita tabla.
--
-- LA FORMA ES LA DE `orden_historial_estado` (feature 49), extendida a acciones que no son
-- transiciones de una orden: filas INMUTABLES --sin `updated_at` ni `deleted_at`-- con actor,
-- clasificacion e instante, y RLS habilitada sin policies.
--
-- ADITIVA: no altera ninguna tabla, columna, indice ni enum preexistente. NI UN `UPDATE`, NI UN
-- `DELETE`, NI UN `INSERT` sobre nada que ya existiera.
--
-- =============================================================================================
-- ⚠️ NO HAY BACKFILL, Y ESO HAY QUE DECIRLO EN VOZ ALTA.
-- =============================================================================================
-- Las 79 ordenes borradas el 2026-09-02 NO se pueden reconstruir: no quedo rastro de quien las
-- borro ni de cuando. El registro empieza VACIO el dia que esta migracion se aplica, y la pantalla
-- lo dice para que un cero no se lea como «no ha pasado nada» (design §5.4). Inventar filas de
-- backfill seria peor que el agujero: firmarian una autoria que nadie conoce.
--
-- =============================================================================================
-- LAS CINCO DECISIONES DE COLUMNA, cada una con su porque.
-- =============================================================================================
--   (a) `entidad_id` es OPACO y NO LLEVA FK. Dos de las entidades registradas se borran en
--       FISICO: `tarifas` y `zona` (`ZonaRepository` hace `tx.zona.delete`). Una FK dejaria dos
--       unicas salidas y las dos son peores: `RESTRICT` haria INBORRABLE lo que la accion
--       registrada acaba de borrar, y `SET NULL` vaciaria el rastro EN SILENCIO --exactamente lo
--       que `orden_historial_estado.gestion_orden_id` documenta como corrupcion muda--. Sin FK,
--       la fila sobrevive a su sujeto, que es el requisito (R4).
--
--   (b) `entidad_etiqueta` se CONGELA. Es la leccion literal de `cierre_detail` (feature 69):
--       «`es_central` y los 5 nombres son COLUMNAS aunque exista el FK porque son MUTABLES».
--       Aqui es peor: en `tarifa_borrada` y `zona_borrada` NO HAY A QUIEN PREGUNTAR. Congelar
--       ademas elimina el N+1 del listado y evita meter uuid en la descarga (R38).
--
--   (c) `actor_nombre` y `actor_rol` se CONGELAN. El motivo no es de rendimiento: UNO DE LOS
--       EVENTOS QUE ESTA TABLA REGISTRA ES EL CAMBIO DE ROL. Leer el rol vivo al pintar
--       re-etiquetaria la historia --«el maestro Fulano aprobo» sobre una fila de cuando Fulano
--       era `admin`-- y ese error es indetectable. `actor_usuario_id` se conserva ADEMAS, con FK
--       RESTRICT, porque es lo estable para filtrar.
--
--   (d) `monto` SI; `motivo` NO EXISTE. El importe es un numero, no es dato personal, y sin el
--       una fila de «mueve dinero» no se entiende. El motivo es texto libre tecleado por una
--       persona --«rechazado porque el cliente Juan Perez no estaba»--, es el unico vector real
--       de datos de cliente en esta tabla y YA VIVE EN SU FILA (`cierre_dia.motivo_rechazo`,
--       `liquidacion_anulacion.motivo`). Copiarlo aqui crearia una segunda copia con otras reglas
--       de retencion (R5).
--
--   (e) `valor_anterior`/`valor_nuevo` solo admiten VOCABULARIO CERRADO: valores de un enum del
--       dominio, en exactamente cuatro tipos de accion. `VARCHAR(60)` y una guardia sobre los
--       puntos de escritura los mantienen asi. NO se usan para tarifas (Q3: no se abre el
--       versionado de tarifas; se vive con «quien y cuando» y el valor anterior se pierde).
--
-- Y LO QUE LA TABLA NO TIENE:
--   - SIN `categoria` (R17): se DERIVA con `CATEGORIA_POR_ACCION` (`lib/types/historial-accion.ts`),
--     un mapa exhaustivo sobre el enum. Guardarla seria una segunda fuente de verdad capaz de
--     divergir.
--   - SIN indice unico de idempotencia (a diferencia de `wallet_movimiento`): un reintento del
--     usuario ES otra accion y debe verse. Un unico aqui esconderia el doble clic que precisamente
--     se quiere auditar.
--   - SIN `canal`: distinguir app de API la da `actor_rol` congelado (la cuenta dedicada de una
--     key tiene rol `apiKey`).
--   - SIN purga, caducidad ni archivado (R39). 11k-38k filas/año y sin datos de clientes. Un
--     registro de auditoria que se borra solo es la peor clase de borrado.

-- ---------------------------------------------------------------------------------------------
-- 1) Los DOS enums. Se CREAN enteros (`CREATE TYPE`), no se amplia ninguno preexistente, asi que
--    NO aplica el `55P04` («no se puede usar un valor de enum recien anadido en la transaccion
--    que lo anadio») y pueden usarse como tipo de columna en esta misma migracion.
--
--    Enums NATIVOS y no tablas de catalogo (patron `orden_historial_origen_tipo`): el conjunto es
--    cerrado, lo fija el codigo, y añadir un valor debe ser una migracion con nombre y fecha
--    (R14/R15). Postgres no permite `DROP VALUE`: un enum de auditoria solo se amplia cuando
--    alguien lo escribe.
--
--    CUARENTA Y DOS valores y no los 40 del Anexo A: el humano cerro Q1 y Q2 el 2026-09-02.
--    `orden_ubicacion_corregida` (Q1) y `usuario_fulfillment_cambiado` (Q2) entran en «mueve
--    dinero» -- la primera porque el distrito re-deriva la zona y la zona decide la tarifa
--    facturada; la segunda porque activa un cobro periodico de bodega.
-- ---------------------------------------------------------------------------------------------
CREATE TYPE "historial_accion_tipo" AS ENUM (
  -- mueve dinero (25)
  'cierre_dia_aprobado',
  'cierre_dia_rechazado',
  'cierre_dia_pagos_editados',
  'cierre_bodega_aprobado',
  'cierre_bodega_rechazado',
  'pago_mensajero_registrado',
  'pago_tienda_registrado',
  'pago_anulado',
  'reparto_mensajero_registrado',
  'reparto_anulado',
  'wallet_movimiento_manual_registrado',
  'egreso_administrativo_registrado',
  'egreso_administrativo_reversado',
  'tarifa_creada',
  'tarifa_actualizada',
  'incidente_aprobado',
  'incidente_rechazado',
  'cobro_gasto_fijo_aprobado',
  'cobro_gasto_fijo_rechazado',
  'cobro_rechazo_tienda_aprobado',
  'cobro_rechazo_tienda_rechazado',
  'premio_ranking_registrado',
  'premio_ranking_anulado',
  'orden_ubicacion_corregida',
  'usuario_fulfillment_cambiado',
  -- hace desaparecer algo (6)
  'orden_eliminada',
  'orden_recuperada',
  'tarifa_borrada',
  'zona_borrada',
  'vehiculo_borrado',
  'plantilla_eliminada',
  -- cambia quien puede hacer que (11)
  'usuario_creado',
  'usuario_rol_cambiado',
  'usuario_zona_cambiada',
  'usuario_estado_cambiado',
  'usuario_contrasena_restablecida',
  'postulacion_aprobada',
  'postulacion_rechazada',
  'api_key_generada',
  'api_key_rotada',
  'api_key_activada',
  'api_key_desactivada'
);

CREATE TYPE "historial_accion_entidad" AS ENUM (
  'orden',
  'usuario',
  'tarifa',
  'zona',
  'vehiculo',
  'plantilla_mensaje',
  'cierre_dia',
  'cierre_bodega',
  'gestion_orden',
  'liquidacion_pago',
  'liquidacion_reparto',
  'wallet_movimiento',
  'orden_incidente',
  'gasto_fijo_cobro',
  'rechazo_tienda_cobro',
  'ranking_snapshot_fila',
  'api_key'
);

-- ---------------------------------------------------------------------------------------------
-- 2) La tabla. SIN `updated_at` y SIN `deleted_at`, y esa ausencia ES el requisito (R2): la fila
--    es INMUTABLE. Una correccion se representa con una accion NUEVA, jamas alterando una previa.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "historial_accion" (
  "id"               TEXT NOT NULL,

  "accion"           "historial_accion_tipo" NOT NULL,
  "entidad_tipo"     "historial_accion_entidad" NOT NULL,

  -- OPACO y sin FK: ver la decision (a) de la cabecera.
  "entidad_id"       TEXT NOT NULL,

  -- CONGELADA: ver la decision (b). 120 caracteres es holgado para «guia + nombre corto» y ademas
  -- acota lo que puede acabar en una celda de la descarga.
  "entidad_etiqueta" VARCHAR(120) NOT NULL,

  -- NULL = el sistema/un cron (R36). Los TRES campos del actor son NULL a la vez en ese caso.
  "actor_usuario_id" TEXT,
  "actor_nombre"     VARCHAR(120),
  "actor_rol"        "rol_value",

  -- DECIMAL(12,2) como todo el dinero del repo. NUNCA `double precision`: money-safe (R6).
  "monto"            DECIMAL(12,2),

  -- Vocabulario CERRADO: ver la decision (e).
  "valor_anterior"   VARCHAR(60),
  "valor_nuevo"      VARCHAR(60),

  -- uuid POR ACCION, no por fila (R7). Es lo que distingue «se borraron 79 ordenes de una vez» de
  -- «hubo 79 borrados», que es la diferencia entre un modulo legible y una pared de ruido.
  "lote_id"          TEXT NOT NULL,

  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "historial_accion_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------------------------
-- 3) La FK del actor. RESTRICT EXPLICITO y no el `SET NULL` por defecto de una relacion opcional:
--    la autoria es EVIDENCIA y no se pierde al dar de baja a un usuario. Mismo criterio, escrito,
--    que `orden_nota.autor_id`, `orden_dia_reparto_cambio.actor_usuario_id` y
--    `gasto_fijo_cobro.decidido_por`.
--
--    Es la UNICA FK de la tabla, y esa asimetria con `entidad_id` es deliberada (decision (a)):
--    el actor NO se borra en fisico en este repo; las tarifas y las zonas SI.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "historial_accion"
  ADD CONSTRAINT "historial_accion_actor_usuario_id_fkey"
  FOREIGN KEY ("actor_usuario_id") REFERENCES "usuario"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- 4) Los TRES indices, uno por consulta del modulo (R40), y cada ausencia tambien justificada.
-- ---------------------------------------------------------------------------------------------

-- (1/3) EL LISTADO POR DEFECTO -- la primera pagina, que es el 90 % de las visitas. `id` va DENTRO
-- del indice porque el `orderBy` real es `created_at <dir>, id ASC` (R23) y sin la segunda columna
-- el motor tendria que ordenar el desempate aparte.
--
-- ⚠️ EL DESEMPATE NO ES UNA PRECAUCION TEORICA AQUI: TODAS las filas de un lote nacen del MISMO
-- `CURRENT_TIMESTAMP` de la transaccion, asi que un borrado de 79 ordenes produce 79 filas con el
-- mismo instante al milisegundo y, con paginas de 25, eso cruza TRES cortes de pagina. Ordenar
-- solo por `created_at` deja el orden de las empatadas a merced del plan: la pagina 2 duplica una
-- fila y pierde otra que no aparece en ninguna. Es el defecto MEDIDO de la ficha 352 (200 filas
-- distintas de 241 al recorrer 10 paginas), amplificado porque aqui el empate es la NORMA.
CREATE INDEX "historial_accion_created_at_id_idx"
  ON "historial_accion"("created_at" DESC, "id");

-- (2/3) «QUE HIZO FULANO» -- el filtro mas probable del modulo. Igualdad -> rango, el unico orden
-- que un btree recorre sin filtro residual. Cubre ademas el RESTRICT de la FK, que SI se ejerce al
-- intentar borrar un usuario: sin este indice, esa comprobacion recorreria la tabla entera.
CREATE INDEX "historial_accion_actor_usuario_id_created_at_idx"
  ON "historial_accion"("actor_usuario_id", "created_at" DESC);

-- (3/3) «QUE LE PASO A ESTA ENTIDAD» -- la pregunta que abre la ficha: «¿quien borro ESTA orden?».
CREATE INDEX "historial_accion_entidad_tipo_entidad_id_idx"
  ON "historial_accion"("entidad_tipo", "entidad_id");

-- LOS DOS QUE NO ESTAN, y por que:
--   - NO hay indice por `accion`: cardinalidad de 42 valores sobre decenas de miles de filas, y
--     casi siempre viene acompanado de fecha; el indice por fecha ya acota.
--   - NO hay indice por `lote_id`: es una consulta puntual y rara sobre una tabla que cabe en
--     memoria.
--
-- NOMBRES: los tres son los que Prisma genera por defecto y el mas largo
-- (`historial_accion_actor_usuario_id_created_at_idx`) mide 48 caracteres, por debajo del limite
-- de 63 de Postgres. Se comprueba a proposito porque `orden_historial_estado` ya se comio ese
-- truncamiento silencioso y tuvo que llevar un `map:` explicito.

-- ---------------------------------------------------------------------------------------------
-- 5) RLS. Habilitada SIN policies, patron `orden_historial_estado` / `cierre_dia` /
--    `wallet_movimiento` (R8). Este repo NO usa Supabase Auth (sesion propia, sin `auth.uid()`),
--    asi que una policy no tendria a quien preguntar y la autorizacion de negocio vive en el
--    servicio. Lo que la RLS garantiza es que a estas filas no se llega si no es por el servidor
--    de la aplicacion -- y en una tabla que registra quien mueve el dinero, eso es el minimo.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "historial_accion" ENABLE ROW LEVEL SECURITY;
