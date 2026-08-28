-- PLANTILLA DE TIENDA: marca las plantillas de `plantilla_mensaje` cuyo texto NO se manda a
-- Meta. Se envian por el camino wa.me (el mensajero abre WhatsApp con el texto ya escrito),
-- que no necesita Message Template ni aprobacion de nadie.
--
-- POR QUE UNA COLUMNA Y NO UN VALOR MAS DEL ENUM `plantilla_estado`. El enum responde "¿en
-- que punto de la revision de Meta esta esta plantilla?" (`saved_not_aprobation` -> `pending`
-- -> `activo`/`refused`), mas el `inactivo` que decide el negocio. Una plantilla de tienda no
-- esta en ningun punto de esa revision Y ADEMAS necesita poder estar activa o inactiva como
-- cualquier otra. Metida en el enum, marcar una como "de tienda" le costaria su estado.
--
-- POR QUE `NOT NULL DEFAULT false` Y NO NULLABLE (mismo criterio que `welcome_message`): la
-- pregunta es cerrada y toda fila existente la contesta hoy —ninguna lo es—, asi que un NULL
-- solo anadiria un "no se sabe" que ningun lector sabria tratar. El backfill es el DEFAULT.
ALTER TABLE "plantilla_mensaje"
  ADD COLUMN "plantilla_tienda" BOOLEAN NOT NULL DEFAULT false;
