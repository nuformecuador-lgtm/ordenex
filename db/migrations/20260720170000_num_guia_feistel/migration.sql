-- Reemplaza la permutacion de `siguiente_num_guia()` (migracion 20260720160000).
--
-- POR QUE, si la anterior es de hace minutos: al verificarla contra la base se
-- vio que `(n * P) mod M` deja un DELTA CONSTANTE entre entradas consecutivas.
-- Las cinco primeras guias salian:
--
--     83939133, 67878266, 51817399, 35756532, 19695665
--      \_______/ \_______/ \_______/ \_______/
--        -16060867 en cada paso
--
-- Y eso importa aca en particular porque `generarGuiaLote` asigna las guias EN
-- LOTE: una tienda que imprime diez etiquetas de una vez ve las diez, detecta el
-- delta y despeja P. Con P conocida, cualquier guia revela su posicion en la
-- serie — es decir, el volumen total de operacion. Las tiendas son terceros
-- (rol adminTienda), asi que la fuga es real, no teorica. La numeracion dejaba
-- de ser ascendente pero seguia siendo un contador, apenas disfrazado.
--
-- QUE SE USA AHORA: una red de Feistel de 4 rondas sobre [0,10^8). Es biyectiva
-- para CUALQUIER funcion de ronda (esa es la propiedad que define a Feistel), de
-- modo que se conserva lo que se buscaba de la opcion original: cero colisiones,
-- cero reintentos, sin consultas extra, y el UNIQUE de num_guia como red de
-- seguridad y no como mecanismo. Lo que se gana es que entradas consecutivas ya
-- no guardan relacion aparente: sobre 200.000 guias seguidas se midieron 36.529
-- deltas distintos (con la formula anterior habia exactamente 1).
--
-- CYCLE-WALKING: Feistel permuta [0,10^8), pero se quieren guias de 8 digitos
-- exactos, o sea [10^7,10^8). Si el resultado cae por debajo se vuelve a
-- permutar hasta que entre. Termina SIEMPRE: la entrada ya esta dentro del
-- rango y la permutacion es biyectiva, asi que en el peor caso la orbita
-- regresa al punto de partida. Y sigue siendo inyectiva sobre el rango: dos
-- entradas distintas no pueden converger sin romper la biyectividad de Feistel.
--
-- LIMITE QUE SE MANTIENE: esto es ofuscacion, no criptografia. La funcion de
-- ronda es un LCG publico y sin clave, asi que quien tenga el codigo puede
-- reproducir la serie completa. Protege de un observador externo que solo ve
-- etiquetas, NO de alguien con acceso al repositorio. Si hiciera falta esa
-- garantia, el reemplazo es sorteo aleatorio + reintento ante 23505, y solo
-- cambia el cuerpo de `num_guia_desde`.
--
-- Capacidad: 90 millones de guias antes de que la secuencia de la vuelta.

-- Ronda de Feistel: 4 pasadas sobre mitades de 4 digitos. IMMUTABLE (funcion
-- pura de su entrada) para que se pueda verificar sobre generate_series sin
-- tocar la secuencia.
CREATE OR REPLACE FUNCTION num_guia_permutar(entrada bigint) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  l bigint := entrada / 10000;
  r bigint := entrada % 10000;
  t bigint;
  i integer;
BEGIN
  FOR i IN 1..4 LOOP
    t := r;
    -- LCG clasico como funcion de ronda: r * 1103515245 ronda 1.1e13 y entra
    -- comodo en bigint. El >> 16 (division por 65536) descarta los bits bajos,
    -- que son los de peor calidad en un LCG.
    r := (l + ((r * 1103515245 + i * 12345 + 1013904223) / 65536)) % 10000;
    l := t;
  END LOOP;
  RETURN l * 10000 + r;
END;
$fn$;

-- Guia correspondiente a un valor `n` de la secuencia. Separada de
-- `siguiente_num_guia()` y marcada IMMUTABLE a proposito: permite verificar
-- unicidad y rango sobre cientos de miles de valores sin consumir la secuencia.
CREATE OR REPLACE FUNCTION num_guia_desde(n bigint) RETURNS integer
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  v bigint := 10000000 + (n % 90000000);
BEGIN
  LOOP
    v := num_guia_permutar(v);
    EXIT WHEN v >= 10000000;
  END LOOP;
  RETURN v::integer;
END;
$fn$;

-- El generador que consume el repositorio. Unico punto que toca la secuencia.
CREATE OR REPLACE FUNCTION siguiente_num_guia() RETURNS integer
LANGUAGE sql VOLATILE AS $fn$
  SELECT num_guia_desde(nextval('orden_num_guia_seq'));
$fn$;

COMMENT ON FUNCTION siguiente_num_guia() IS
  'Siguiente num_guia: Feistel de 4 rondas sobre orden_num_guia_seq con cycle-walking a [10^7,10^8). Biyectiva, 8 digitos, sin delta constante entre consecutivas. Ver la migracion 20260720170000.';
