-- ⭑ FICHA 429 (T4, paso 3 de 3) — EL `NOT NULL` Y LOS DOS `CHECK`, UNA VEZ LLENO.
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ ESTA MIGRACION EXIGE QUE LA SIEMBRA YA HAYA CORRIDO. Y SI NO, FALLA. A PROPOSITO.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- El orden de despliegue de esta ficha es:
--   1. `20260918120100_zona_sinpe`            — crea las columnas NULLABLES;
--   2. `pnpm exec tsx scripts/seed-sinpe-inicial.ts` — las rellena desde el ENTORNO, porque el
--      numero y el titular reales NO pueden escribirse en un repositorio PUBLICO;
--   3. ESTA migracion.
--
-- Si alguien aplica la 1 y la 3 de un tiron —que es lo que hace `prisma migrate deploy` si las dos
-- estan pendientes a la vez— el `DO` de abajo aborta con un mensaje que dice QUE hacer. Ese fallo
-- es el CORRECTO: la alternativa es un `SET NOT NULL` que muere con «column "sinpe_numero" of
-- relation "zona" contains null values», que es cierto pero no dice como salir. Y la otra
-- alternativa —poner un `DEFAULT` para que no falle nunca— es exactamente lo que R6 y R11
-- prohiben: dejaria viva para siempre la posibilidad de crear una bodega sin SINPE.
--
-- QUE HACE IMPOSIBLE, a partir de aqui:
--   · una bodega SIN numero o SIN titular (`NOT NULL`, y sin `DEFAULT`);
--   · un numero que no sea un movil de Costa Rica, VENGA DE DONDE VENGA (`CHECK`, no solo zod):
--     los seeds, los `scripts/` y cualquier `UPDATE` corrido a mano contra produccion —via el MCP
--     de Supabase, que es como se escribe en prod en este repo— entran por debajo del borde de la
--     aplicacion. El `CHECK` los cubre a todos;
--   · un titular vacio o compuesto SOLO DE ESPACIOS EN BLANCO de cualquier clase.
--
-- ⚠️ LA MISMA REGLA VIVE EN `lib/utils/sinpe-cr.ts` (`SINPE_NUMERO_REGEX`). Son dos fuentes del
-- mismo formato y pueden divergir: lo cierra `tests/fixtures/sinpe-casos.ts`, la MISMA tabla de
-- casos corrida contra este `CHECK` y contra el validador. Si alguien relaja uno de los dos, el
-- test lo dice.
--
-- SIN `NOT VALID`: los `CHECK` validan las filas YA sembradas al aplicarse. Un `NOT VALID` dejaria
-- pasar cualquier fila anterior mal escrita, que es justo la que hay que cazar.
--
-- `sinpe_revisado_at` SE QUEDA NULLABLE y no se toca: NULL significa «nadie lo ha mirado dentro de
-- la aplicacion» (R5) y es lo que dispara la revision obligatoria del primer login (R26).
--
-- No crea tablas ni indices, no escribe ni borra datos, y no toca la RLS de `zona`.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "zona" WHERE "sinpe_numero" IS NULL OR "sinpe_nombre" IS NULL) THEN
    RAISE EXCEPTION
      'FICHA 429: hay bodegas sin SINPE. Corre primero la siembra (`pnpm exec tsx scripts/seed-sinpe-inicial.ts`) con NEXT_PUBLIC_SINPE_NUMERO y NEXT_PUBLIC_SINPE_NOMBRE en el entorno, y vuelve a aplicar esta migracion.';
  END IF;
END
$$;

ALTER TABLE "zona" ALTER COLUMN "sinpe_numero" SET NOT NULL;
ALTER TABLE "zona" ALTER COLUMN "sinpe_nombre" SET NOT NULL;

ALTER TABLE "zona" ADD CONSTRAINT "zona_sinpe_numero_check"
  CHECK ("sinpe_numero" ~ '^[678][0-9]{7}$');
-- ⚠️ `~ '[^[:space:]]'` Y NO `btrim(...) <> ''`, Y ESTA MEDIDO. El `design.md` proponia `btrim`, y
-- `btrim` SIN SEGUNDO ARGUMENTO recorta SOLO EL ESPACIO (0x20): un titular de un unico TABULADOR
-- pasaba el `CHECK` mientras `sinpeNombreSchema` —que usa el `.trim()` de JavaScript, que recorta
-- todo el espacio en blanco— lo rechazaba. Esa es exactamente la divergencia entre las dos fuentes
-- del formato que el precio declarado de esta ficha admitia, y la cazo
-- `tests/integration/db/zona-sinpe-migration.test.ts` corriendo los mismos casos contra las dos.
-- La clase POSIX `[:space:]` cubre espacio, tabulador, salto de linea, retorno y avance de pagina,
-- asi que «tiene al menos un caracter que no es espacio en blanco» dice lo mismo que el borde.
ALTER TABLE "zona" ADD CONSTRAINT "zona_sinpe_nombre_check"
  CHECK ("sinpe_nombre" ~ '[^[:space:]]');
