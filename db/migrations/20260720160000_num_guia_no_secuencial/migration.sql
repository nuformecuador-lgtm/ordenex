-- `num_guia` deja de ser un contador visible.
--
-- Motivo: hasta ahora la guia era `nextval('orden_num_guia_seq')` tal cual, o
-- sea 1, 2, 3... Ese numero se imprime en la etiqueta y viaja en el QR, asi que
-- cualquiera que reciba dos guias con dias de diferencia puede restar y deducir
-- cuantas ordenes se movieron en el medio: filtra volumen de operacion.
--
-- Solucion: se conserva la secuencia como fuente de unicidad, pero su valor se
-- pasa por una PERMUTACION MULTIPLICATIVA antes de guardarse:
--
--     guia = 10000000 + ((n * P) mod M)
--
-- con M = 90000000 (rango 10000000..99999999, siempre 8 digitos) y
-- P = 73939133, primo y coprimo con M (M = 2^7 * 3^2 * 5^7; P no es divisible
-- por 2, 3 ni 5). Al ser coprimos, n -> (n*P) mod M es una BIYECCION sobre
-- [0, M): dos `n` distintos NUNCA colisionan. No hay sorteo, no hay reintento,
-- y el indice UNIQUE de num_guia queda como red de seguridad, no como mecanismo.
--
-- Capacidad: 90 millones de guias antes de que la secuencia de la vuelta. A
-- partir de ahi los valores se repetirian y el UNIQUE empezaria a rechazar
-- inserciones — falla RUIDOSA, no corrupcion silenciosa.
--
-- ALCANCE Y LIMITE HONESTO: esto es ofuscacion, no criptografia. Quien consiga
-- dos guias CONSECUTIVAS puede restar, obtener P mod M y reconstruir toda la
-- serie. Oculta el volumen de un observador casual (un destinatario que compara
-- dos etiquetas), NO de alguien que pueda emitir ordenes a voluntad. Si en algun
-- momento hace falta esa garantia, el reemplazo es sorteo aleatorio + reintento
-- ante 23505, y solo cambia el cuerpo de esta funcion.
--
-- La logica vive en una FUNCION y no repetida en el repositorio: hay tres call
-- sites hoy y cualquiera nuevo debe heredar el esquema sin tener que acordarse
-- de copiar la formula.

CREATE OR REPLACE FUNCTION siguiente_num_guia() RETURNS integer
LANGUAGE sql VOLATILE AS $$
  -- ::bigint antes de multiplicar: n llega hasta 9e7 y P es ~7.4e7, el producto
  -- ronda 6.6e15. Entra comodo en bigint (max ~9.2e18) pero desbordaria integer.
  SELECT (10000000 + ((nextval('orden_num_guia_seq')::bigint * 73939133) % 90000000))::integer;
$$;

COMMENT ON FUNCTION siguiente_num_guia() IS
  'Siguiente num_guia: permutacion multiplicativa de orden_num_guia_seq. Biyectiva (P coprimo con M), 8 digitos, no secuencial. Ver la migracion 20260720160000 para el detalle y sus limites.';
