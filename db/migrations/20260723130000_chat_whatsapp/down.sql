-- DOWN (R15): revierte EXACTAMENTE migration.sql. Orden inverso por las FKs: primero
-- `chat_mensaje` (depende de chat_conversacion y de plantilla_mensaje), luego
-- `chat_conversacion`. `DROP TABLE` arrastra la PK, los indices (unico parcial de
-- wa_message_id, el de historial, los de scope/resolucion), las FKs y la RLS.
DROP TABLE IF EXISTS "chat_mensaje";
DROP TABLE IF EXISTS "chat_conversacion";

-- Los enums se retiran despues de las tablas (ninguna columna los referencia ya).
DROP TYPE IF EXISTS "chat_mensaje_estado";
DROP TYPE IF EXISTS "chat_mensaje_tipo";
DROP TYPE IF EXISTS "chat_mensaje_direccion";
