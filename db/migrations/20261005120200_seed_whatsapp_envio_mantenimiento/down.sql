-- DOWN de la ficha 474 (T1.3): borra las filas del job recurrente de mantenimiento (la sembrada y
-- las que el drenador haya re-encolado). Sin ellas el mantenimiento deja de correr, que es lo que
-- significa revertir esta siembra.
DELETE FROM "jobs" WHERE "tipo" = 'whatsapp_envio_mantenimiento';
