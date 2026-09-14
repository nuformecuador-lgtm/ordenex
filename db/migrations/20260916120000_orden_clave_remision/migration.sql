-- FICHA 423 (design §2.1 y §2.3) — ORDENAR `/ordenes` POR NUMERO DE REMISION, DE FORMA NATURAL.
--
-- `orden.num_remision` es TEXT y lo provee la tienda (R9/R14): sobre las 2.136 ordenes vivas de
-- produccion (medido el 2026-09-14) conviven CUATRO series con relleno inconsistente —437
-- puramente numericas (`72912`…`73636`), 1.664 `NA-001`…`NA-1863`, 29 `SC-`, 9 `BS-`—. Ordenar
-- por el TEXTO deja 1.582 de las 1.664 `NA-` fuera de sitio: `ORDER BY num_remision` produce
-- `NA-1067, NA-1068, NA-1069, NA-107, NA-1070`.
--
-- La reparacion es UNA columna GENERADA que deriva de `num_remision` una clave (serie, numero)
-- comparable byte a byte, MAS un indice que la sirve. Mismo patron exacto que
-- `orden.busqueda_texto` (`20260731160000_orden_busqueda_texto`).
--
-- ⚠️ AL APLICAR EN PRODUCCION: `ADD COLUMN ... GENERATED ... STORED` REESCRIBE LA TABLA ENTERA
-- y toma un ACCESS EXCLUSIVE mientras dura (ni lecturas ni escrituras sobre `orden`);
-- `CREATE INDEX` toma ademas un SHARE (bloquea escrituras). Con 2.136 filas vivas es
-- instantaneo; por encima de 200.000 haria falta ventana de mantenimiento con la ingesta de
-- ordenes parada. NO se usa `CREATE INDEX CONCURRENTLY`: Prisma corre cada migracion dentro de
-- una transaccion y CONCURRENTLY no puede.
--
-- ORDEN DE DESPLIEGUE: MIGRACION PRIMERO, CODIGO DESPUES. El codigo viejo funciona contra la
-- columna nueva (no la mira). Al reves —codigo primero— el `orderBy` de `OrdenRepository.list`
-- apuntaria a una columna inexistente y el listado ENTERO respondería error. La reversion va al
-- reves: codigo primero, `down.sql` despues.
--
-- Sin tablas nuevas => SIN RLS NUEVA: la columna hereda exactamente los permisos y las politicas
-- de `orden`. Sin `INSERT`/`UPDATE`/`DELETE`: no se reescribe ni una remision (R19).

-- 1) LA COLUMNA GENERADA. Cada pieza esta elegida, ninguna es adorno:
--
--    · STORED -> es lo unico que Postgres implementa, y un indice necesita el valor
--      materializado.
--
--    · DOS `regexp_replace` PARA EL PREFIJO. El primero quita el bloque FINAL de digitos
--      (`NA-1863` -> `NA-`); el segundo borra todo lo que no sea letra o digito ASCII
--      (`NA-` -> `NA`). El prefijo queda SIN PUNTUACION, que es lo que hace que ninguna
--      collation linguistica tenga un «peso variable» que interpretar.
--
--    · `upper()` DESPUES DE LA LIMPIEZA, NUNCA ANTES. Tras el filtro solo quedan ASCII, y sobre
--      ASCII `upper()` da el mismo resultado en cualquier locale. Es el mismo razonamiento de
--      orden de operaciones que la migracion de `busqueda_texto` (`translate` antes de `lower`).
--      Agrupa `na-001` con `NA-001`, y eso NO FUSIONA NINGUNA SERIE EXISTENTE: medido contra
--      produccion el 2026-09-14 sobre 2.287 ordenes (incluidas las borradas) hay 0 remisiones
--      con alguna letra en minuscula, 0 con caracteres fuera de `[A-Za-z0-9-]` y 0 sin ningun
--      digito. `upper()` y el filtro existen para que la columna NO PUEDA LANZAR ante lo que
--      entre mañana, no para arreglar lo de hoy.
--
--    · CLASES DE CARACTERES ENUMERADAS, NO RANGOS (`[0123456789]`, no `[0-9]`). La documentacion
--      de Postgres advierte de que un rango dentro de una expresion regular es sensible a la
--      collation. Es exactamente la desviacion que `20260731160000` ya escribio a mano para
--      `[ \t\n\r\f\v]` en vez de `\s`, y por el mismo motivo: si la clase se interpretase
--      distinto en el build msvc local y en el glibc de Supabase, la columna se calcularia
--      distinto en cada base y R6 seria indemostrable.
--
--    · `lpad(..., 18, '0')` Y NINGUN CAST A NUMERO (R5). El «valor numerico» se consigue con
--      relleno de TEXTO, no convirtiendo a `bigint`. Las cinco funciones que intervienen
--      —`coalesce`, `regexp_replace`, `substring(text from text)`, `lpad`, `upper`— son TOTALES
--      sobre cualquier `text` y ninguna tiene modo de error. Esto no es elegancia: una columna
--      generada SE EVALUA EN EL `INSERT`, asi que una expresion que lance BLOQUEARIA LA CREACION
--      DE ORDENES, incluida la carga masiva por lotes (`'NA-'::bigint` lanza
--      «invalid input syntax for type bigint»). Ademas `to_char(int, text)` es STABLE —depende
--      de `lc_numeric`— y Postgres lo RECHAZA en una columna generada, asi que la via del cast
--      no solo es peligrosa: no es aplicable.
--      18 digitos es el techo de un `bigint`, el mayor numero que un sistema de tienda puede
--      razonablemente emitir; lo medido hoy son 5 digitos.
--
--    · `COLLATE "C"` — el segundo candado de R6. La comparacion es byte a byte, identica en
--      cualquier build y cualquier locale, y el btree que se crea encima HEREDA esa collation,
--      asi que el indice y el `ORDER BY` no pueden discrepar. Con ella:
--        `0…` (0x30) < `B` (0x42) < `N` (0x4E) < `S` (0x53)
--      o sea numericas puras, luego `BS-`, luego `NA-`, luego `SC-` (R4); y dentro de `NA`,
--      `NA000000000000000107` < `NA000000000000001069`, o sea `NA-107` antes que `NA-1069` (R3).
--
--    · NULLABLE a proposito aunque la expresion nunca produzca NULL (todo va con `coalesce`):
--      Prisma la declara `String?`, y declararla NOT NULL en SQL seria drift (identico a
--      `busqueda_texto`).
--
--    QUE PRODUCE, con los valores reales de produccion:
--      `72912`    -> `000000000000072912`
--      `BS-00001` -> `BS000000000000000001`
--      `NA-107`   -> `NA000000000000000107`
--      `NA-1069`  -> `NA000000000000001069`
--      `SC-050`   -> `SC000000000000000050`
--
--    Y ANTE LO QUE NO ENCAJA EN EL PATRON (degrada, NO falla — R5):
--      `SIN NUMERO` -> `SINNUMERO000000000000000000`   (ordena en su propia «serie», al final)
--      `---`        -> `000000000000000000`            (cae con las numericas, al principio)
--      `NA-`        -> `NA000000000000000000`          (encabeza la serie `NA`)
--      `📦-5`       -> `000000000000000005`            (el emoji se cae del prefijo)
--      25 digitos   -> clave truncada a 18             (desordenada respecto a otra de 25, sin error)
--
--    Las dos ultimas son COLISIONES CONOCIDAS Y ACEPTADAS: dos remisiones distintas pueden
--    compartir clave (tambien `NA-1` y `N-A1`). No es un fallo — la clave NO ES UNA IDENTIDAD,
--    es una clave de ORDEN, y el desempate por `id` que añade `ordenTotal` (ficha 352) mantiene
--    el orden total y la paginacion estable (R8).
ALTER TABLE "orden"
  ADD COLUMN "clave_remision" text COLLATE "C"
  GENERATED ALWAYS AS (
    upper(regexp_replace(
      regexp_replace(coalesce("num_remision", ''), '[0123456789]+$', ''),
      '[^ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789]', '', 'g'))
    || lpad(
         coalesce(substring(coalesce("num_remision", '') from '[0123456789]+$'), ''),
         18, '0')
  ) STORED;

-- 2) EL INDICE. El `ORDER BY` que arma `OrdenRepository.list` es
--    `prioridad DESC, <campo> <dir>, id ASC` (feature 101/R6 + ficha 352), asi que la forma del
--    indice copia ese prefijo.
--
--    ⚠️ SIRVE PARA UN SOLO SENTIDO, Y ESTA DECIDIDO. Con `prioridad` FIJA en DESC, los dos
--    sentidos del campo no son el mismo recorrido: el inverso de este indice daria
--    `prioridad ASC, clave DESC, id DESC`, que no es lo pedido. O sea que `num_remision desc`
--    ORDENA (nodo de sort), y `num_remision asc` no. Justificacion con el volumen real: 2.136
--    ordenes vivas × ~30 bytes de clave son decenas de KB, muy por debajo del `work_mem` por
--    defecto (4 MB) — un quicksort en memoria, sin volcado a disco, de microsegundos, irrelevante
--    frente al `findMany` con `include` que lo alimenta. Añadir hoy el gemelo DESC seria pagar un
--    segundo indice en el camino de ESCRITURA de `orden` —una tabla que se escribe por lotes en
--    la carga masiva y que ya arrastra doce indices— para ahorrar un sort que no se nota.
--    UMBRAL PARA REVISARLO, escrito para que no haya que adivinarlo: si `orden` supera las
--    ~200.000 filas vivas, o si el sort del sentido descendente aparece en los planes lentos, la
--    reparacion es una migracion de una linea:
--      CREATE INDEX "orden_prioridad_clave_remision_desc_idx"
--        ON "orden" ("prioridad" DESC, "clave_remision" DESC, "id" ASC)
--        WHERE "deleted_at" IS NULL;
--
--    ⚠️ ES PARCIAL (`WHERE deleted_at IS NULL`), igual que `orden_tienda_id_num_remision_key`
--    (feature 294) y `zona_es_gam_unico`. Consecuencia DECLARADA, no sorpresa: con el filtro
--    «Eliminadas» puesto el listado ordena por remision exactamente igual —R3/R4 no dependen del
--    borrado— pero SIN indice, porque el predicado no lo cubre. Con 2.136 filas vivas el sort es
--    el mismo de microsegundos del parrafo anterior.
--
--    NO se declara aqui la collation del indice: la HEREDA de la columna (`COLLATE "C"` arriba),
--    que es justo lo que garantiza que el indice y el `ORDER BY` no puedan discrepar.
CREATE INDEX "orden_prioridad_clave_remision_idx"
  ON "orden" ("prioridad" DESC, "clave_remision" ASC, "id" ASC)
  WHERE "deleted_at" IS NULL;
