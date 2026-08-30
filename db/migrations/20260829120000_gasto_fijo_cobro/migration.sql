-- Ficha 333 (A1, design 1.1/1.2/1.3) -- EL COBRO AUTORIZADO DEL GASTO FIJO.
--
-- QUE CAMBIA. Hasta hoy el cron de gastos fijos escribe el egreso DIRECTO en `wallet_movimiento`
-- y nadie lo autoriza. A partir de aqui cada plantilla lleva un INTERRUPTOR
-- (`requiere_aprobacion`): las que "cobran solas" siguen escribiendo en el libro exactamente
-- igual que antes (R5), y las que "requieren aprobacion" generan una fila de `gasto_fijo_cobro`
-- en estado `pendiente` que NO toca el libro hasta que el maestro la apruebe (R6).
--
-- POR QUE AHORA, Y POR QUE NO HAY BACKFILL. Medido contra produccion el 2026-08-29: CERO
-- movimientos `egreso_gasto_fijo` emitidos jamas y las DOS plantillas existentes estan
-- INACTIVAS. No hay una sola fila que migrar, ni ventana en la que convivan dos formatos de
-- clave. Dentro de tres meses, con cobros ya contabilizados, el mismo cambio exigiria una
-- migracion de datos sobre dinero.
--
-- ADITIVA (R53): no altera ninguna tabla, columna, indice ni enum preexistente SALVO la columna
-- nueva del interruptor al final. NI UN `UPDATE`, NI UN `DELETE`, NI UN `INSERT` sobre nada que
-- ya existiera. `wallet_movimiento` no cambia de forma: sigue sin `updated_at`, sin `deleted_at`
-- y sin `update`/`delete` expuestos (R1/R3 de la 42); la FK nueva vive en la tabla nueva.
--
-- =============================================================================================
-- LA CLAVE `origen_id`, QUE ES DONDE SE DUPLICA PLATA -- leer antes de tocar nada de aqui.
-- =============================================================================================
-- `gasto_fijo_cobro.origen_id` vale EXACTAMENTE `"<plantillaId>:<periodo>"`, con el `periodo`
-- que produce `lib/utils/periodicidad.ts#periodoDe` (`YYYY-MM` para `meses`, `YYYY-MM-DD` para
-- `dias`/`semanas`). Es LA MISMA cadena que acabara en `wallet_movimiento.origen_id` cuando el
-- cobro se apruebe, y alli cae bajo `wallet_movimiento_origen_categoria_uq`
-- (`20260712160000_wallet_movimiento/migration.sql:71`), que es lo unico que hoy impide el doble
-- cobro. ESTA MIGRACION NO CAMBIA ESE FORMATO (R11): si a las mensuales se les cambiara el
-- `YYYY-MM`, en el mes del deploy la clave vieja y la nueva NO colisionarian y se cobraria dos
-- veces.
--
-- Con esta ficha la clave protege en DOS momentos distintos:
--   cron (00:00 CR)                          aprobacion (cuando el maestro decida)
--   gasto_fijo_cobro.origen_id      ------>  wallet_movimiento.origen_id
--   UNIQUE(origen_id)                        UNIQUE(origen_tipo, origen_id, categoria)
--   gasto_fijo_cobro_origen_uq               wallet_movimiento_origen_categoria_uq
--
-- =============================================================================================
-- CUENTA DE RESTRICCIONES -- para que nadie crea que falta una.
-- =============================================================================================
-- `tasks.md > A1` pide "los cinco CHECK". Las CINCO restricciones nombradas por design 1.3 son
-- CUATRO `CHECK` mas UN `UNIQUE` (`gasto_fijo_cobro_origen_uq`, que la misma tarea vuelve a
-- nombrar aparte). Aqui estan las cinco, con su motivo escrito una por una. NO se inventa una
-- sexta para cuadrar un numero: una restriccion que el diseno no pidio es una regla que nadie
-- decidio.
-- Ademas va un SEXTO objeto, `gasto_fijo_cobro_movimiento_uq`, explicado en su sitio.

-- ---------------------------------------------------------------------------------------------
-- 1) El enum del estado. Se CREA entero (`CREATE TYPE`), no se amplia, asi que NO aplica el
--    `55P04` ("no se puede usar un valor de enum recien anadido en la transaccion que lo anadio")
--    y puede usarse como tipo de columna en esta misma migracion. Los valores que amplian enums
--    YA EXISTENTES van en la migracion siguiente, con timestamp propio.
-- ---------------------------------------------------------------------------------------------
CREATE TYPE "gasto_fijo_cobro_estado" AS ENUM (
  'pendiente',
  'aprobado',
  'rechazado',
  'cancelado'
);

-- ---------------------------------------------------------------------------------------------
-- 2) La tabla.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "gasto_fijo_cobro" (
  "id"            TEXT NOT NULL,
  -- NULLABLE, y es deliberado: pasa a NULL cuando la plantilla se borra (ficha 332). Por eso la
  -- unicidad del cobro NO puede ser `(plantilla_id, periodo)` -- una unicidad con NULL deja de
  -- proteger sin que nadie lo note-- y es `origen_id`, que es NOT NULL y se congela al generar.
  "plantilla_id"  TEXT,
  -- LA CLAVE DEL LIBRO. Ver el bloque de arriba. NOT NULL siempre.
  "origen_id"     TEXT NOT NULL,
  -- Redundante con `origen_id` (el uuid no contiene ':', asi que el periodo es derivable) A
  -- PROPOSITO: `periodo` es el dato que se ENSENA y por el que se ordena; `origen_id` es la
  -- CLAVE. Una clave no se destripa para pintar una celda.
  "periodo"       TEXT NOT NULL,
  -- COPIAS de la plantilla tomadas en el instante de generar el cobro (R7). No es
  -- desnormalizacion perezosa: es la correccion de R16 -- lo que el maestro aprueba es lo que
  -- vio, y si el monto se leyera de la plantilla al aprobar, una edicion intermedia cobraria un
  -- importe que nadie autorizo. Es tambien lo que hace que R47 siga siendo cierto cuando la
  -- plantilla ya no exista.
  "concepto"      TEXT NOT NULL,
  "monto"         DECIMAL(12,2) NOT NULL,
  "estado"        "gasto_fijo_cobro_estado" NOT NULL DEFAULT 'pendiente',
  -- `DATE` y no `timestamp`: es el DIA CALENDARIO CR de la corrida que lo creo, misma convencion
  -- que `gasto_fijo_plantilla.fecha_cobro` y `orden.fecha_reparto`. Un `timestamp` reabriria la
  -- trampa de las seis horas que cerro la 166.
  "generado_el"   DATE NOT NULL,
  -- Quien decidio y cuando (R15/R21). NULL mientras el cobro siga `pendiente`; lo ata el CHECK
  -- `gasto_fijo_cobro_decision_registrada`.
  "decidido_por"  TEXT,
  "decidido_at"   TIMESTAMP(3),
  -- El movimiento del libro que salda este cobro. NULL salvo en `aprobado`; lo ata el CHECK
  -- `gasto_fijo_cobro_movimiento_solo_aprobado`.
  "movimiento_id" TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gasto_fijo_cobro_pkey" PRIMARY KEY ("id"),

  -- CHECK 1/4 -- LA CASCADA DEL BORRADO, GARANTIZADA EN LA BASE (R46, design 9).
  -- Con `plantilla_id ON DELETE SET NULL`, borrar una plantilla que todavia tenga cobros
  -- `pendiente` intenta ponerles el `plantilla_id` a NULL, viola este CHECK y el `DELETE`
  -- ABORTA RUIDOSAMENTE. Es lo que hace que el orden de llegada de la 332 y la 333 no importe:
  -- si el borrado existe sin la cancelacion previa, falla con un error claro en vez de dejar
  -- cobros huerfanos y aprobables sin plantilla.
  CONSTRAINT "gasto_fijo_cobro_pendiente_con_plantilla"
    CHECK ("estado" <> 'pendiente' OR "plantilla_id" IS NOT NULL),

  -- CHECK 2/4 -- una decision SIN cuando no es escribible ni por error (R15, R21). El servicio
  -- ya escribe `decidido_at` en la misma sentencia que cambia el estado; esto es la red.
  CONSTRAINT "gasto_fijo_cobro_decision_registrada"
    CHECK (
      ("estado" = 'pendiente' AND "decidido_at" IS NULL)
      OR ("estado" <> 'pendiente' AND "decidido_at" IS NOT NULL)
    ),

  -- CHECK 3/4 -- solo un cobro APROBADO puede apuntar al libro. Rechazar y cancelar NO emiten
  -- movimiento (R21, R49), y un enlace en un cobro rechazado seria dinero atribuido a una
  -- decision que dijo que no.
  CONSTRAINT "gasto_fijo_cobro_movimiento_solo_aprobado"
    CHECK ("movimiento_id" IS NULL OR "estado" = 'aprobado'),

  -- CHECK 4/4 -- espejo del invariante del libro (R52): el monto es SIEMPRE positivo; el signo
  -- lo da el tipo del movimiento, no el importe.
  CONSTRAINT "gasto_fijo_cobro_monto_positivo"
    CHECK ("monto" > 0),

  -- FK 1/3 -- SET NULL, y ni CASCADE ni RESTRICT. `CASCADE` se llevaria por delante el rastro
  -- de aprobaciones y rechazos, que es justo lo que esta ficha existe para crear (R47);
  -- `RESTRICT` bloquearia para siempre el borrado real que trae la 332.
  CONSTRAINT "gasto_fijo_cobro_plantilla_id_fkey" FOREIGN KEY ("plantilla_id")
    REFERENCES "gasto_fijo_plantilla"("id") ON DELETE SET NULL ON UPDATE CASCADE,

  -- FK 2/3 -- RESTRICT: quien autorizo dinero es EVIDENCIA y no se pierde al dar de baja a un
  -- usuario. Mismo criterio que `orden_dia_reparto_cambio.actor_usuario_id` y `orden_nota.autor_id`.
  CONSTRAINT "gasto_fijo_cobro_decidido_por_fkey" FOREIGN KEY ("decidido_por")
    REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE,

  -- FK 3/3 -- RESTRICT contra el libro. Es una FK que no se ejerce nunca: `wallet_movimiento` es
  -- append-only y no se borra (R3 de la 42).
  CONSTRAINT "gasto_fijo_cobro_movimiento_id_fkey" FOREIGN KEY ("movimiento_id")
    REFERENCES "wallet_movimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- ---------------------------------------------------------------------------------------------
-- 3) Indices.
-- ---------------------------------------------------------------------------------------------

-- LA QUINTA RESTRICCION de design 1.3: la IDEMPOTENCIA del cron. Una (plantilla, periodo) tiene
-- como mucho UN cobro, EN CUALQUIER ESTADO. `createMany({ skipDuplicates: true })` compila a
-- `ON CONFLICT DO NOTHING` contra este indice, asi que la segunda corrida del mismo dia inserta
-- 0 filas sin TOCTOU (R9, R51).
--
-- TOTAL Y NO PARCIAL, y es una decision con consecuencia buscada (R22, design 11-A9): un cobro
-- RECHAZADO conserva su `origen_id`, asi que la corrida siguiente del mismo periodo choca aqui y
-- el pendiente NO reaparece. Con `WHERE estado = 'pendiente'` lo rechazado volveria al dia
-- siguiente y el "no" del maestro no significaria nada.
CREATE UNIQUE INDEX "gasto_fijo_cobro_origen_uq" ON "gasto_fijo_cobro"("origen_id");

-- SEXTO OBJETO, y hay que explicarlo porque design 1.3 dice de `movimiento_id` "sin indice a
-- proposito". Aquella nota hablaba del BTREE SIMPLE de la FK `RESTRICT` -- que efectivamente NO
-- existe: nadie consulta por esta columna y el libro no se borra jamas, asi que el RESTRICT no
-- se ejerce--. Este es OTRA cosa: la MISMA seccion declara obligatoria la back-relation
-- `WalletMovimiento.cobroGastoFijo` como UNO A UNO, y Prisma exige `@unique` en el lado que
-- sostiene la FK de una 1-1 (`P1012`, medido al validar el esquema). El indice resultante ademas
-- ENUNCIA un invariante que era cierto pero no estaba escrito: una fila del libro salda como
-- mucho UN cobro.
CREATE UNIQUE INDEX "gasto_fijo_cobro_movimiento_uq" ON "gasto_fijo_cobro"("movimiento_id");

-- LA COLA de pendientes, del mas antiguo al mas reciente (R39): `WHERE estado = 'pendiente'
-- ORDER BY generado_el`. El conteo de pendientes del cron (R29/R30) sale del mismo indice.
CREATE INDEX "gasto_fijo_cobro_estado_generado_el_idx"
  ON "gasto_fijo_cobro"("estado", "generado_el");

-- La cancelacion en cascada del borrado de plantilla (R45) y el conteo de la confirmacion (R55)
-- filtran por `plantilla_id`; ademas cubre la FK, cuyo `SET NULL` SI se ejerce.
CREATE INDEX "gasto_fijo_cobro_plantilla_id_idx" ON "gasto_fijo_cobro"("plantilla_id");

-- Segunda FK indexada (patron `orden_dia_reparto_cambio` / `orden_nota`): sin el, el RESTRICT
-- obliga a recorrer la tabla entera cada vez que se intenta borrar un usuario.
CREATE INDEX "gasto_fijo_cobro_decidido_por_idx" ON "gasto_fijo_cobro"("decidido_por");

-- ---------------------------------------------------------------------------------------------
-- 4) RLS (R50). Habilitada SIN policies, patron `wallet_movimiento` / `gasto_fijo_plantilla` /
--    `notificacion`. Este repo NO usa Supabase Auth (sesion propia, sin `auth.uid()`), asi que
--    una policy no tendria a quien preguntar y la autorizacion de negocio vive en el servicio.
--    Lo que la RLS garantiza es exactamente lo que R50 pide: a estas filas no se llega si no es
--    por el servidor de la aplicacion.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "gasto_fijo_cobro" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------------------------
-- 5) EL INTERRUPTOR (R1/R2). Lo unico que esta migracion toca de una tabla preexistente.
--    `NOT NULL DEFAULT true` no reescribe la tabla (Postgres >= 11 guarda el default en el
--    catalogo) y deja las DOS filas existentes -- las dos INACTIVAS, medido contra produccion el
--    2026-08-29 -- en "requiere aprobacion", que es el valor por defecto que pide R2 y que hoy
--    no cambia el comportamiento de nada (R12: una plantilla inactiva no genera ni egreso ni
--    cobro). SIN BACKFILL y sin `UPDATE`: el DEFAULT es todo lo que hace falta.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "gasto_fijo_plantilla"
  ADD COLUMN "requiere_aprobacion" BOOLEAN NOT NULL DEFAULT true;
