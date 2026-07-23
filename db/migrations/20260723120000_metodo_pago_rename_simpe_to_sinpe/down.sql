-- Feature 118 (R3): inverso EXACTO del UP. Devuelve el enum al estado historico
-- renombrando el valor de 'SINPE' de vuelta a 'SIMPE'. Simetrico y total: restituye
-- 'SIMPE' sobre las mismas filas (mismo OID) sin efectos colaterales.
-- (Este archivo contiene el literal 'SIMPE' por diseno: es la reversion del rename.)
ALTER TYPE "metodo_pago_value" RENAME VALUE 'SINPE' TO 'SIMPE';
