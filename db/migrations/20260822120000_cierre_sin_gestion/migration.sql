-- Feature 264 (R1/R2/R4/R5/R7/R9/R10/R11/R23/R24/R25/R26/R27/R29/R33): tabla NUEVA
-- `cierre_sin_gestion` — el VINCULO PERSISTIDO entre un cierre del dia y cada orden que el corte
-- diario barrio a `sin_gestionar` al crearlo. Mas la MARCA por cierre `sin_gestion_registrado`.
--
-- EL PORQUE. El detalle de un cierre se construye ENTERO sobre las gestiones
-- (`gestion_orden.cierre_id` cruzado con `cierre_detail`), y una orden que el corte barrio a
-- `sin_gestionar` NO TIENE GESTION: `CierreDiaRepository.crearCierre` solo le cambia el
-- `estatus_id` y no la vincula al cierre por ningun lado. La unica relacion era un predicado VIVO
-- —«las ordenes en `sin_gestionar` del mensajero de ese cierre»— y la APROBACION lo DESTRUYE:
-- libera la orden a bodega y le borra `mensajero_asignado_id`. Resultado: el cierre `vencido` se
-- crea PRECISAMENTE por esas ordenes y la pantalla escondia justo eso; y el cierre aprobado —el
-- que se audita, porque es el que ya movio dinero— mostraba CERO, indistinguible de un cierre que
-- de verdad no barrio ninguna.
--
-- NI UNA COLUMNA DE DINERO (R10). No es una promesa de la capa de arriba: es que no hay nada que
-- sumar. Estas ordenes no tienen gestion, luego no tienen `pago_mensajero`, ni recaudo, ni tarifa.
-- Ni `DECIMAL`, ni `monto`, ni `pago`, ni `ingreso`, ni `comision`. Que la lista no pueda mover un
-- total es ESTRUCTURAL, no disciplina.
--
-- Migracion ADITIVA sobre `cierre_dia` (solo AÑADE una columna con DEFAULT) y creadora de la
-- tabla. Molde: `20260715140000_cierre_detail` (tabla + dos indices + FKs como ALTER TABLE aparte
-- + RLS habilitada sin policies + backfill idempotente).

-- 1) tabla `cierre_sin_gestion` (fila INMUTABLE: sin updated_at/deleted_at, como cierre_detail).
CREATE TABLE "cierre_sin_gestion" (
  "id" TEXT NOT NULL,
  "cierre_id" TEXT NOT NULL,
  "orden_id" TEXT NOT NULL,

  -- Descriptivos CONGELADOS al barrer (R11). Precedente exacto de la feature 69/T18: el detalle
  -- de un cierre YA creado se leia navegando `gestion_orden.orden.*` y el admin veia los valores
  -- de HOY, no los del cierre que revisa. `num_guia` SIN UNIQUE: aqui es COPIA, no identidad.
  "num_guia" INTEGER,
  "num_remision" TEXT NOT NULL,
  "destinatario" TEXT NOT NULL,
  "producto" TEXT NOT NULL,
  "tienda_nombre" TEXT NOT NULL,
  -- Contexto operativo del barrido. Se congela aunque hoy no se pinte: esta en el DTO para no
  -- tener que migrar otra vez si se pide.
  "zona_nombre" TEXT NOT NULL,

  -- R4: el estatus REAL del que salio la orden (`en_reparto` | `ayuda_tienda`), tomado de la
  -- vuelta del bucle que la barrio y NUNCA supuesto. NULL = no consta (R32/R33).
  "estatus_origen_id" TEXT,

  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cierre_sin_gestion_pkey" PRIMARY KEY ("id")
);

-- 2) El GRANO (cierre, orden). Es tambien el indice de la ruta caliente: el detalle filtra por
-- `cierre_id`. Y es la red del `skipDuplicates` de la escritura: una segunda corrida del corte
-- sobre el mismo cierre no duplica el vinculo.
CREATE UNIQUE INDEX "cierre_sin_gestion_cierre_id_orden_id_key" ON "cierre_sin_gestion"("cierre_id", "orden_id");

-- Trazar en que cierres se barrio una orden.
CREATE INDEX "cierre_sin_gestion_orden_id_idx" ON "cierre_sin_gestion"("orden_id");

-- 3) Las 3 FKs, mismo molde que las cinco de `cierre_detail`. Todas RESTRICT es seguro: ninguna de
-- esas tablas borra fisicamente (`orden` usa `deleted_at`), asi que el vinculo nunca queda
-- huerfano. En `estatus_origen_id` el RESTRICT es EXPLICITO y no el `SET NULL` que Prisma daria
-- por defecto a una relacion opcional: la fila es inmutable y un SET NULL silencioso convertiria
-- un origen REAL en un «no consta» sin dejar rastro.
ALTER TABLE "cierre_sin_gestion" ADD CONSTRAINT "cierre_sin_gestion_cierre_id_fkey"
  FOREIGN KEY ("cierre_id") REFERENCES "cierre_dia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cierre_sin_gestion" ADD CONSTRAINT "cierre_sin_gestion_orden_id_fkey"
  FOREIGN KEY ("orden_id") REFERENCES "orden"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cierre_sin_gestion" ADD CONSTRAINT "cierre_sin_gestion_estatus_origen_id_fkey"
  FOREIGN KEY ("estatus_origen_id") REFERENCES "order_status"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) R23: RLS habilitada SIN policies, identico a `cierre_detail`. El acceso es por service role
-- via Prisma; sin policies, cualquier rol anon/authenticated que llegue por PostgREST ve cero
-- filas. Que la tabla no tenga dinero no la hace publica: lleva destinatario y guia (PII).
ALTER TABLE "cierre_sin_gestion" ENABLE ROW LEVEL SECURITY;

-- 5) R27/R29 — LA MARCA POR CIERRE. «Ninguna» y «no lo sabemos» son cosas distintas.
-- `DEFAULT true` deja marcados como REGISTRADOS a los cierres nuevos sin escribir una linea en el
-- camino caliente del corte (lo pone Postgres) y tambien a los existentes; el paso 7 baja a
-- `false` exactamente los que NO se pueden reconstruir.
ALTER TABLE "cierre_dia"
  ADD COLUMN "sin_gestion_registrado" BOOLEAN NOT NULL DEFAULT true;

-- 6) R25/R33 — BACKFILL de los cierres ABIERTOS, un solo INSERT ... SELECT.
--
-- Es EXACTO, y no por casualidad: `CorteDiarioRepository` excluye del corte a todo mensajero con
-- un cierre abierto, y `solicitarCierre` TRANSICIONA el vencido/rechazado en vez de crear otro.
-- Por tanto un mensajero tiene A LO SUMO UN cierre abierto, y todas sus ordenes que hoy estan en
-- `sin_gestionar` son de ese cierre.
--
-- El `LEFT JOIN LATERAL` recupera el estatus de ORIGEN del historial de ESA orden (R33). No es una
-- heuristica de tiempo: la orden SIGUE en `sin_gestionar`, asi que su ultima transicion hacia ese
-- estado con `origen_tipo = 'corte_sin_gestionar'` es, por construccion, la del corte que la
-- barrio. `LEFT` y no `JOIN`: si el historial no tuviera la fila, la orden entra igual con
-- `estatus_origen_id NULL` (R33 dice «vacio unicamente cuando no conste»). Un `JOIN` la perderia
-- en SILENCIO, que es peor que un dato ausente.
INSERT INTO "cierre_sin_gestion" (id, cierre_id, orden_id, num_guia, num_remision,
                                  destinatario, producto, tienda_nombre, zona_nombre,
                                  estatus_origen_id, created_at)
SELECT gen_random_uuid(), c.id, o.id, o.num_guia, o.num_remision, o.destinatario,
       o.producto, t.nombre, z.nombre, h.estatus_origen_id, CURRENT_TIMESTAMP
  FROM "cierre_dia" c
  JOIN "orden" o  ON o.mensajero_asignado_id = c.mensajero_id AND o.deleted_at IS NULL
  JOIN "order_status" s ON s.id = o.estatus_id AND s.value = 'sin_gestionar'
  JOIN "usuario" t ON t.id = o.tienda_id
  JOIN "zona"    z ON z.id = o.zona_id
  LEFT JOIN LATERAL (
      SELECT he.estatus_origen_id
        FROM "orden_historial_estado" he
       WHERE he.orden_id = o.id
         AND he.estatus_destino_id = o.estatus_id      -- sin_gestionar
         AND he.origen_tipo = 'corte_sin_gestionar'
       ORDER BY he.created_at DESC
       LIMIT 1
  ) h ON TRUE
 WHERE c.estado IN ('solicitado','vencido','rechazado')
-- Idempotente: la migracion se re-corre tras un rollback sin duplicar el vinculo.
ON CONFLICT ("cierre_id", "orden_id") DO NOTHING;

-- 7) R26/R29 — los que NO se pueden reconstruir quedan MARCADOS, no inventados.
-- Para un cierre ya resuelto la liberacion (`CierresAdminRepository`, feature 109) ya borro
-- `mensajero_asignado_id` y cambio el estatus: no queda dato del que derivar la lista. Deducirla
-- por una ventana temporal sobre el historial seria un vinculo de auditoria INVENTADO (CLAUDE.md
-- regla 6). Se prefiere no tener el dato a tenerlo falso, y por eso este UPDATE existe: la
-- pantalla dira «no se conserva la lista» en vez de «no hubo ninguna».
UPDATE "cierre_dia" SET "sin_gestion_registrado" = false
 WHERE "estado" NOT IN ('solicitado','vencido','rechazado');
