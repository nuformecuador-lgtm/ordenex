-- DOWN (ficha 403, T1) -- retira las DOS columnas que anadio el up, en ORDEN INVERSO al que las
-- declaro, dejando `webhook_suscripcion` exactamente como estaba: `id`, `owner_usuario_id`,
-- `url`, `secret`, `activa`, `created_at`, `updated_at`.
--
-- QUE **NO** TOCA, y es lo que hay que mirar en un down de este repo:
--   - `activa`: la pausa nunca la escribio (R5), asi que revertir no tiene nada que restaurar ahi;
--   - la PK, el indice unico `webhook_suscripcion_owner_usuario_id_key`, la FK al usuario y la
--     RLS: ninguno menciona las columnas nuevas, asi que un `DROP COLUMN` no los reconstruye ni
--     los pierde;
--   - ninguna otra tabla: estas dos columnas no tienen FK entrantes ni salientes.
--
-- PERDIDA DE DATOS, DECLARADA: al soltar las columnas se pierde el contador de fallos y el ancla
-- de la racha. Es informacion OPERATIVA y RECONSTRUIBLE sola -- la siguiente entrega aceptada
-- volveria a fijar el ancla --, no un dato de negocio ni de dinero, asi que aqui el `DROP COLUMN`
-- es la reversion correcta y NO hace falta la precondicion ruidosa que si exige el down de los
-- enums de esta misma ficha (donde lo que se perderia son AVISOS que alguien puede no haber
-- leido).
--
-- `IF EXISTS` lo hace re-ejecutable sin ruido.
ALTER TABLE "webhook_suscripcion"
  DROP COLUMN IF EXISTS "sin_exito_desde",
  DROP COLUMN IF EXISTS "fallos_consecutivos";
