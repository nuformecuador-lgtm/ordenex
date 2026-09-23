-- DOWN de M2 (ficha 454): revierte EXACTAMENTE `migration.sql` -- la tabla (con sus indices, CHECK,
-- FK y RLS, que caen con ella) y el tipo.
--
-- PERDIDA DECLARADA (design §1.6): los eventos de gestion anulada/corregida y las ayudas ya
-- rescatadas desaparecen con la tabla. La anulacion sigue en `gestion_orden.anulada_at`, la
-- correccion en la bitacora `cierre_dia_gestion_corregida` y en la propia gestion.
--
-- ⚠️ ORDEN DE ROLLBACK: si M3 (retiro de `ayuda_tienda`/`devolucion_por_confirmar`) esta aplicada,
-- SU down va PRIMERO: es el que devuelve al modelo viejo las gestiones pendientes y las ayudas
-- abiertas LEYENDO esta tabla. Borrarla antes las dejaria `en_reparto` sin rastro y el corte del
-- codigo viejo las barreria (R41). `scripts/db-rollback.ts` revierte de la ultima hacia atras, que es
-- ese orden.
DROP TABLE IF EXISTS "orden_evento";
DROP TYPE IF EXISTS "orden_evento_tipo";
