-- Feature 73 (R1/R11/R15/R16, F1.4-a + F1.4-b + F1.4-d + F1.4-g): causa TIPIFICADA de la
-- devolucion — un enum nativo nuevo y UNA columna nullable en `gestion_orden`, para que el
-- POR QUE de un intento fallido sea un dato consultable/agrupable y no texto libre.
--
-- Migracion ADITIVA (R15): NO altera ni borra columnas, datos, indices, defaults ni policies
-- preexistentes de `gestion_orden` (en particular NO toca `motivo`). NO hay tabla nueva -> NO
-- hay superficie RLS nueva: `gestion_orden` ya tiene RLS habilitada sin policies (solo
-- service role) desde 20260711150000 y sigue igual. Precedente identico y verificado:
-- 20260714160000_gestion_orden_anulacion.
--
-- SIN CHECK constraint (F1.4-b): la obligatoriedad de la causa vive SOLO en el borde (zod,
-- R6), igual que las obligatoriedades por rama de monto_recibido/metodo_pago/evidencia de la
-- feature 36 (ninguna tiene CHECK). Anadir uno solo para la causa seria una asimetria y
-- bloquearia a las filas historicas.

-- 1) Enum de la causa. Lista CERRADA de 3 valores, sin "Otro" y sin reservar futuros
-- (F1.4-d): anadir una 4.ª causa el dia que se pida es un `ALTER TYPE ... ADD VALUE`,
-- aditivo y barato (precedentes: 20260714160000, 20260712150000). Valores en INGLES por
-- decision consciente del humano (F1.4-g), aunque el enum hermano `gestion_resultado` los
-- tenga en espanol; el front traduce a espanol (R3).
CREATE TYPE "gestion_causa_devolucion" AS ENUM ('not_found', 'wrong_number', 'wrong_address');

-- 2) Columna de la causa: NULLABLE y SIN default (F1.4-a, R16). NULL = gestion no-`devuelta`,
-- o `devuelta` ANTERIOR a esta feature. Las gestiones `devuelta` ya existentes sobreviven con
-- NULL: su causa NO es derivable del texto libre y NO se backfillea ni se adivina (R16).
-- Sin indice: no hay consulta declarada sobre esta columna en este ciclo (design §1.1).
ALTER TABLE "gestion_orden" ADD COLUMN "causa_devolucion" "gestion_causa_devolucion";
