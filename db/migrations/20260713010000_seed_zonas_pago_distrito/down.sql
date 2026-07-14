-- Revierte 20260713010000_seed_zonas_pago_distrito: elimina las 7 zonas de pago
-- sembradas; el ON DELETE CASCADE de zona_distrito.zona_id arrastra sus asignaciones.
-- OJO: si una de estas zonas tenia asignaciones/tarifas creadas por otra via, tambien
-- se borran (comparten nombre).
DELETE FROM "zona" WHERE "nombre" IN ('GAM', 'GUANACASTE', 'LIMÓN ABAJO', 'PUNTARENAS', 'QUEPOS', 'SAN RAMÓN', 'ZONA SUR');
