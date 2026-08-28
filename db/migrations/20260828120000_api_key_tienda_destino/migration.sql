-- Feature 302 — UNA API KEY PUEDE CARGAR A NOMBRE DE UNA TIENDA QUE YA EXISTE.
--
-- EL PROBLEMA, MEDIDO: `ApiKeyService.generar` crea SIEMPRE un usuario nuevo con email y cedula
-- sinteticos (`apikey+<slug>@apikey.invalid`). Ese email no colisiona con el real de una tienda
-- ya registrada, asi que generar una key para Nuform NO daba error: creaba una SEGUNDA Nuform en
-- silencio, con wallet y saldo aparte, dos filas en listados y analitica, y CERO tarifas (la
-- Nuform real tiene exactamente una tarifa propia; la nueva naceria sin ninguna).
--
-- LA COLUMNA QUE ARREGLA ESO: `tienda_destino_id`. Separa QUIEN ENTRA de QUIEN ES EL DUENO. La
-- key conserva su cuenta dedicada (`usuario_id`, 1:1, rol `apiKey`, sin sesion web) como
-- portadora de la credencial; las ordenes que cree se registran a nombre de la tienda REAL
-- apuntada aqui. NO se relaja la comprobacion de rol de `ApiKeyAuthService`: una key filtrada
-- seguiria sin poder entrar por la web.
--
-- NULLABLE A PROPOSITO: NULL = el camino existente intacto (la cuenta dedicada es la duena de
-- las ordenes que cree, feature 88/[D4]). La columna solo cambia el comportamiento de las keys
-- que la llenen.
--
-- SIN MIGRACION DE DATOS: hay CERO filas en `api_key` en produccion (verificado antes de
-- escribir la ficha), asi que no hay ninguna key que reapuntar ni backfill que medir. La columna
-- nace NULL para toda fila existente, que es exactamente el comportamiento de hoy.
--
-- FK RESTRICT, igual que sus dos hermanas (`usuario_id`, `created_by_id`): borrar la tienda
-- destino exige borrar antes la key. NO se usa `ON DELETE SET NULL` —el default de Prisma para
-- una relacion opcional, y por eso el modelo lo declara explicito—: dejar la columna en NULL
-- devolveria la propiedad de las ordenes futuras a la cuenta dedicada SIN QUE NADIE LO PIDA, que
-- es justo la clase de fallo mudo que esta ficha viene a cerrar.
--
-- RLS: no hay tabla nueva. `api_key` ya tiene RLS habilitada SIN policies desde
-- `20260716150000_api_key` (solo service role), y esta migracion no la toca. Tampoco toca
-- ninguna otra tabla ni mueve una sola fila: cero INSERT/UPDATE/DELETE.

ALTER TABLE "api_key" ADD COLUMN "tienda_destino_id" TEXT;

ALTER TABLE "api_key"
  ADD CONSTRAINT "api_key_tienda_destino_id_fkey" FOREIGN KEY ("tienda_destino_id")
  REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Soporta el lookup inverso ("que keys cargan a nombre de esta tienda"), que usa el guard de
-- webhooks para decidir si una cuenta de tienda admite suscripcion por el canal integrador.
CREATE INDEX "api_key_tienda_destino_id_idx" ON "api_key"("tienda_destino_id");
