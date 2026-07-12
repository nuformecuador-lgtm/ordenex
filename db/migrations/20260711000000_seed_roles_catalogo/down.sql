-- DOWN: elimina los roles sembrados por esta migracion, EXCEPTO 'maestro'
-- (lo siembra 20260709120000_seed_maestro_user y lo usa el usuario maestro via
-- la FK usuario_rol_id_fkey; borrarlo abortaria el rollback).
--
-- Precondicion: ninguna fila de "usuario" referencia estos roles. Si la hubiera,
-- el DELETE falla por la FK usuario_rol_id_fkey y el rollback aborta.

DELETE FROM "rol"
WHERE "value" IN (
    'admin'::rol_value,
    'mensajero'::rol_value,
    'Admin Tienda'::rol_value,
    'adminSatelite'::rol_value
);
