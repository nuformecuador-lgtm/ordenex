-- 💰 FICHA 337 (segunda mitad, 2026-08-31) -- EL COBRO AUTORIZADO DEL RECHAZO DESDE NOVEDADES.
--
-- QUE CAMBIA, Y POR QUE EXISTE ESTA TABLA. Hasta la primera mitad de esta misma ficha
-- (commit `eea84035`) el cobro del flete de devolucion de un rechazo hecho por la TIENDA desde
-- novedades (`rechazo_tienda` -> gestion `rechazada`) se materializaba de PRESTADO: la gestion
-- sintetica nacia con `cierre_id NULL`, el siguiente cierre del MENSAJERO se la llevaba y el
-- dinero salia al aprobar ESE cierre. Eso era el defecto que la ficha vino a cerrar --el
-- mensajero firmaba un documento con trabajo que no hizo-- y al cerrarlo el cobro quedo EN
-- PAUSA. Esta migracion le da su via propia.
--
-- LA FORMA ES LA DE LA FICHA 333 (`gasto_fijo_cobro`), COPIADA A PROPOSITO Y NO GENERALIZADA.
-- Aquella salio a produccion el 2026-08-29, o sea hace horas: generalizar su codigo con la
-- operacion en marcha es el riesgo que no toca correr. Duplicar la FORMA --tabla propia con
-- estado, clave unica de idempotencia, decision atomica-- es mas aburrido y mucho mas seguro.
-- Lo que NO se copia es lo que aqui no aplica: no hay `cancelado` (no hay plantilla que borrar
-- en cascada) y el enum tiene TRES valores, no cuatro.
--
-- ⚠️ EL CALCULO NO SE REESCRIBE, Y AQUI NO HAY NI UNA OPERACION DE DINERO NUEVA. Los dos
-- importes de esta tabla son la salida LITERAL de `derivarIngresoOrden`
-- (`lib/utils/ingreso-ordenex.ts`) para `resultado = 'rechazada'`: `ingreso_flete_devolucion` y
-- su `ingreso_iva_flete_devolucion`, derivados de la tarifa que resolvia para el par (tienda,
-- zona) EN EL INSTANTE DEL RECHAZO. Se guardan COPIADOS por el mismo motivo que la 333 copia
-- `concepto` y `monto` de la plantilla (su R16): lo que el administrador aprueba tiene que ser
-- lo que vio. Si el importe se recalculara al aprobar, una edicion de la tarifa entre medias
-- cobraria a la tienda algo que nadie autorizo.
--
-- ADITIVA: no altera ninguna tabla, columna, indice ni enum preexistente. NI UN `UPDATE`, NI UN
-- `DELETE`, NI UN `INSERT` sobre nada que ya existiera.
--
-- =============================================================================================
-- ⚠️ LOS 22 RECHAZOS QUE YA EXISTEN EN PRODUCCION -- Y POR QUE ESTA MIGRACION NO LOS TOCA.
-- =============================================================================================
-- Medido contra produccion el 2026-08-31 (ficha 337, primera mitad): hay 22 gestiones
-- `rechazo_tienda` cuyo cobro quedo en pausa al sacarlas del cierre del mensajero. Esta
-- migracion NO les crea su pendiente.
--
-- No es un olvido: un backfill que EMITE DINERO no se cuela dentro de un `migration.sql`.
-- Correrlo aqui significaria que el deploy --que nadie mira, y que en preview corre contra otra
-- base-- da de alta 22 cobros contra tiendas reales, con importes derivados de la tarifa que
-- resuelva EN EL MOMENTO DEL DEPLOY y no en el del rechazo (que es justo lo que el resto de esta
-- tabla existe para evitar). El alta de esos 22 la decide un humano, aparte, con el numero
-- medido delante. Queda escrito en `progress/impl_337.md`.
--
-- =============================================================================================
-- LA IDEMPOTENCIA, EN TRES CAPAS Y CON EL NOMBRE DE CADA UNA DELANTE.
-- =============================================================================================
--   1. `rechazo_tienda_cobro_gestion_uq`  UNIQUE(gestion_id)
--      Una gestion tiene como mucho UN cobro, EN CUALQUIER ESTADO. TOTAL y no parcial, por la
--      misma razon que la 333 rechazo el indice parcial (su A9): un cobro RECHAZADO conserva su
--      `gestion_id`, asi que nadie puede volver a darlo de alta y el "no" del administrador vale.
--
--   2. `wallet_movimiento_origen_categoria_uq` (`20260712160000_wallet_movimiento`, l. 71)
--      UNIQUE (origen_tipo, origen_id, categoria) WHERE origen_id IS NOT NULL.
--      Al aprobar, los dos ingresos se escriben con `origen_tipo = 'gestion_orden'` y
--      `origen_id = <gestion_id>`, asi que caen bajo ese indice YA EXISTENTE. `gestion_orden`
--      es un valor del enum `wallet_origen_tipo` que hasta hoy NADIE escribia (verificado por
--      grep sobre `lib/` y `app/`): esta via lo estrena, y por eso no puede colisionar con la
--      clave de ningun otro escritor.
--      Su hermano del ledger por tienda es
--      `wallet_tienda_movimiento_origen_tienda_categoria_uq` (`20260712170000`, l. 70).
--
--   3. `UPDATE ... WHERE id = $1 AND estado = 'pendiente'`
--      La tercera red, y la unica que serializa a DOS HUMANOS. Bajo `READ COMMITTED` --el nivel
--      por defecto de Postgres y de Prisma-- la segunda transaccion espera el bloqueo de fila,
--      re-evalua el `WHERE` tras el commit de la primera, afecta CERO filas y sale sin escribir.
--      Cero filas es "alguien decidio antes", no un error.
--
-- ---------------------------------------------------------------------------------------------
-- 1) El enum del estado. Se CREA entero (`CREATE TYPE`), no se amplia, asi que NO aplica el
--    `55P04` ("no se puede usar un valor de enum recien anadido en la transaccion que lo anadio")
--    y puede usarse como tipo de columna en esta misma migracion.
--
--    TRES valores y no los cuatro de la 333: alli `cancelado` existe porque borrar una plantilla
--    cancela en cascada sus pendientes. Aqui no hay plantilla ni cascada -- el origen es una
--    gestion, que no se borra--, asi que un cuarto valor seria un estado sin productor. Postgres
--    no permite `DROP VALUE`: un enum de dinero solo se amplia cuando alguien lo escribe.
-- ---------------------------------------------------------------------------------------------
CREATE TYPE "rechazo_tienda_cobro_estado" AS ENUM (
  'pendiente',
  'aprobado',
  'rechazado'
);

-- ---------------------------------------------------------------------------------------------
-- 2) La tabla.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "rechazo_tienda_cobro" (
  "id"           TEXT NOT NULL,

  -- LA CLAVE DE IDEMPOTENCIA. La gestion sintetica `rechazada` que nacio del rechazo de la
  -- tienda. NOT NULL siempre y con su UNIQUE mas abajo.
  "gestion_id"   TEXT NOT NULL,

  -- La orden del paquete. Redundante con `gestion_id` (la gestion tiene su `orden_id`) A
  -- PROPOSITO, por el mismo criterio con el que la 333 guarda `periodo` al lado de `origen_id`:
  -- es el dato por el que se PINTA la cola (guia y remision salen de aqui por relacion) y por el
  -- que un auditor busca. La clave no se destripa para pintar una celda.
  "orden_id"     TEXT NOT NULL,

  -- ⚠️ A QUIEN SE LE COBRA, CONGELADO. Sale de `orden.tienda_id` en el instante del rechazo y NO
  -- se vuelve a leer al aprobar. Es literalmente la leccion de la feature 69 (su R13): el feed
  -- del cierre leia `orden.tienda_id` VIVO, y re-apuntar la orden a otra tienda entre solicitar
  -- y aprobar movia el dinero de ledger. Aqui esa ventana puede durar dias.
  "tienda_id"    TEXT NOT NULL,

  -- Los DOS importes, COPIADOS de la salida de `derivarIngresoOrden` en el instante del rechazo.
  -- Van SEPARADOS y no como un total porque al aprobar nacen DOS apuntes distintos en cada libro
  -- (`ingreso_flete_devolucion` e `ingreso_iva_flete_devolucion`), que son exactamente los que
  -- hoy emite la aprobacion del cierre para una `rechazada`. Un total unico obligaria a
  -- RE-DIVIDIRLO al aprobar, o sea a escribir aritmetica de dinero nueva.
  "monto_flete"  DECIMAL(12,2) NOT NULL,
  "monto_iva"    DECIMAL(12,2) NOT NULL,

  -- QUE FILA de `tarifas` produjo esos dos importes. NULLABLE porque la tarifa puede borrarse y
  -- porque la fila puede haberse resuelto por cualquiera de los tres niveles de la cascada
  -- (feature 274). Contrapartida auditable, mismo papel que `cierre_detail.tarifa_id`.
  "tarifa_id"    TEXT,

  "estado"       "rechazo_tienda_cobro_estado" NOT NULL DEFAULT 'pendiente',

  -- `DATE` y no `timestamp`: es el DIA CALENDARIO DE COSTA RICA del rechazo, misma convencion
  -- que `gasto_fijo_cobro.generado_el` y `orden.fecha_reparto`. Un `timestamp` reabriria la
  -- trampa de las seis horas que cerro la feature 166.
  "generado_el"  DATE NOT NULL,

  -- Quien decidio y cuando. NULL mientras el cobro siga `pendiente`; lo ata el CHECK
  -- `rechazo_tienda_cobro_decision_registrada`.
  "decidido_por" TEXT,
  "decidido_at"  TIMESTAMP(3),

  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rechazo_tienda_cobro_pkey" PRIMARY KEY ("id"),

  -- CHECK 1/2 -- una decision SIN cuando no es escribible ni por error. El servicio ya escribe
  -- `decidido_at` en la MISMA sentencia que cambia el estado; esto es la red de abajo.
  CONSTRAINT "rechazo_tienda_cobro_decision_registrada"
    CHECK (
      ("estado" = 'pendiente' AND "decidido_at" IS NULL)
      OR ("estado" <> 'pendiente' AND "decidido_at" IS NOT NULL)
    ),

  -- CHECK 2/2 -- espejo del invariante del libro: el signo lo da el TIPO del movimiento, no el
  -- importe. El flete es ESTRICTAMENTE positivo (un cobro de 0,00 no es un cobro: no se da de
  -- alta, exactamente como `agregarIngresosPorConcepto` OMITE los conceptos en 0.00, R10 de la
  -- 42). El IVA admite el CERO, que es un valor real y distinto: una tarifa con `iva_flete = 0`
  -- cobra flete sin impuesto, y ese apunte simplemente no se emite al aprobar.
  CONSTRAINT "rechazo_tienda_cobro_montos_validos"
    CHECK ("monto_flete" > 0 AND "monto_iva" >= 0),

  -- FK 1/5 -- la gestion. RESTRICT: la gestion es el HECHO que justifica el cobro y no se
  -- borra en este repo (deshacer una gestion es `anulada_at`, feature 67, no un DELETE). Si
  -- algun dia alguien intentara borrarla teniendo un cobro, tiene que fallar en voz alta.
  CONSTRAINT "rechazo_tienda_cobro_gestion_id_fkey" FOREIGN KEY ("gestion_id")
    REFERENCES "gestion_orden"("id") ON DELETE RESTRICT ON UPDATE CASCADE,

  -- FK 2/5 -- la orden, RESTRICT por el mismo motivo (y `orden` se borra en blando,
  -- `deleted_at`, asi que este RESTRICT no se ejerce en la practica).
  CONSTRAINT "rechazo_tienda_cobro_orden_id_fkey" FOREIGN KEY ("orden_id")
    REFERENCES "orden"("id") ON DELETE RESTRICT ON UPDATE CASCADE,

  -- FK 3/5 -- la tienda a la que se le cobra. RESTRICT: es el sujeto del cobro; sin ella la
  -- fila no significa nada. Mismo criterio que `cierre_detail.tienda_id`.
  CONSTRAINT "rechazo_tienda_cobro_tienda_id_fkey" FOREIGN KEY ("tienda_id")
    REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE,

  -- FK 4/5 -- quien autorizo el cobro. RESTRICT: es EVIDENCIA y no se pierde al dar de baja a
  -- un usuario. Mismo criterio que `gasto_fijo_cobro.decidido_por` (333) y
  -- `orden_dia_reparto_cambio.actor_usuario_id`.
  CONSTRAINT "rechazo_tienda_cobro_decidido_por_fkey" FOREIGN KEY ("decidido_por")
    REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE,

  -- FK 5/5 -- la tarifa que produjo los importes. SET NULL: la traza de auditoria es
  -- deseable, pero no puede impedir para siempre que se borre una fila de tarifas. Los dos
  -- importes ya estan COPIADOS en esta fila, asi que perder el puntero no pierde el dinero.
  CONSTRAINT "rechazo_tienda_cobro_tarifa_id_fkey" FOREIGN KEY ("tarifa_id")
    REFERENCES "tarifas"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- ---------------------------------------------------------------------------------------------
-- 3) Indices.
-- ---------------------------------------------------------------------------------------------

-- ⚠️ LA IDEMPOTENCIA (capa 1 del bloque de arriba). Un rechazo, un cobro. TOTAL y no parcial:
-- un cobro RECHAZADO conserva su `gestion_id`, asi que la fila no puede volver a darse de alta y
-- el "no" del administrador es durable.
--
-- Quitar este indice es una de las mutaciones que la ficha obliga a matar con un test contra
-- Postgres: sin el, dos altas concurrentes del mismo rechazo crean DOS pendientes y aprobar los
-- dos cobraria dos veces.
CREATE UNIQUE INDEX "rechazo_tienda_cobro_gestion_uq" ON "rechazo_tienda_cobro"("gestion_id");

-- LA COLA de pendientes, del mas antiguo al mas reciente: `WHERE estado = 'pendiente'
-- ORDER BY generado_el`. El conteo del total sale del mismo indice.
CREATE INDEX "rechazo_tienda_cobro_estado_generado_el_idx"
  ON "rechazo_tienda_cobro"("estado", "generado_el");

-- "Que le he cobrado a esta tienda": la consulta natural del libro por tienda, y ademas cubre
-- el RESTRICT de la FK, que si se ejerce al intentar borrar un usuario.
CREATE INDEX "rechazo_tienda_cobro_tienda_id_idx" ON "rechazo_tienda_cobro"("tienda_id");

-- Segunda FK indexada (patron `gasto_fijo_cobro` / `orden_nota`): sin el, el RESTRICT obliga a
-- recorrer la tabla entera cada vez que se intenta borrar un usuario.
CREATE INDEX "rechazo_tienda_cobro_decidido_por_idx" ON "rechazo_tienda_cobro"("decidido_por");

-- `orden_id` y `tarifa_id` NO se indexan a proposito: nadie consulta por ellas (la cola ordena
-- por `generado_el` y el libro por tienda) y sus FK son RESTRICT sobre una tabla de borrado
-- blando y SET NULL sobre una tabla que casi no se borra. Un indice sin consulta es coste de
-- escritura sin beneficio -- mismo criterio, escrito, que `gasto_fijo_cobro.movimiento_id`.

-- ---------------------------------------------------------------------------------------------
-- 4) RLS. Habilitada SIN policies, patron `gasto_fijo_cobro` / `wallet_movimiento` /
--    `gestion_orden`. Este repo NO usa Supabase Auth (sesion propia, sin `auth.uid()`), asi que
--    una policy no tendria a quien preguntar y la autorizacion de negocio vive en el servicio.
--    Lo que la RLS garantiza es que a estas filas no se llega si no es por el servidor de la
--    aplicacion.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "rechazo_tienda_cobro" ENABLE ROW LEVEL SECURITY;
