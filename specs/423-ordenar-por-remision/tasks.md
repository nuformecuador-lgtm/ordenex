# 423 — Ordenar las tablas de órdenes por número de remisión · Tareas

> **Secuencia obligada:** backend (T1 → T2) antes que frontend (T3). La migración se aplica
> **antes** que el código (design §2.4).
>
> **El gate rápido NO vale para esta feature.** El diff toca `db/migrations/**` y
> `db/schema.prisma`, así que `./init.sh --rapido` **se niega solo** y manda al completo
> (`docs/verification.md`). Cuéntalo desde el principio: son ~4 minutos, no una sorpresa del
> final.
>
> **Necesitas `DATABASE_URL` resoluble.** Buena parte de lo que aquí se verifica vive en
> `tests/integration/db/**`, y sin base esos archivos se **saltan** y el gate sale verde sin
> haber tocado la capa de datos. Mira los `skipped`, no solo el `INIT_EXIT`.

---

## Tanda 1 — La base

### T1.1 · Migración: columna generada + índice
**Depende de:** nada.
**Archivos:** `db/migrations/20260916120000_orden_clave_remision/migration.sql` (nuevo).
**Antes de nada, el nombre:** `20260916120000`, **no** la fecha de hoy. La numeración de este repo
va adelantada — `20260914120000` ya está tomado (`…_notificacion_evento_reparto_manana`, aplicada
y desplegada) y la última del árbol es `20260915120000_usuario_preferencia`. Verificado el
2026-09-14: ninguna de las 196 empieza por `20260916`. **Compruébalo otra vez antes de crear la
carpeta**: si otra sesión ha empujado migraciones, elige el siguiente hueco por detrás de la
última, no por el calendario.
**Qué:** el SQL de design §2.1 y §2.3, con su cabecera de comentarios explicando el bloqueo
(`ACCESS EXCLUSIVE`, reescritura de tabla), el orden de despliegue y por qué las clases van
enumeradas. Generar el directorio con `pnpm run db:migrate:create` y escribir el SQL a mano.
**Hecho cuando:** `pnpm run db:migrate` aplica sin error contra la base local, y
`SELECT num_remision, clave_remision FROM orden LIMIT 20` devuelve claves con el formato de la
tabla de design §2.1. **Cero `INSERT`/`UPDATE`/`DELETE` en el archivo.**

### T1.2 · `down.sql`
**Depende de:** T1.1.
**Archivos:** `db/migrations/20260916120000_orden_clave_remision/down.sql` (nuevo).
**Qué:** `DROP INDEX IF EXISTS` **antes** que `ALTER TABLE … DROP COLUMN IF EXISTS` (al revés, el
drop de columna arrastraría el índice por dependencia y la primera sentencia mentiría). Sin
`INSERT`/`UPDATE`/`DELETE`: revertir no reescribe ni una remisión (R19).
**Hecho cuando:** `pnpm run db:rollback` deja la base sin la columna ni el índice, y
`SELECT count(*) FROM orden` da el mismo número que antes de aplicar; después `db:migrate`
vuelve a aplicarla limpia.

### T1.3 · `schema.prisma`
**Depende de:** T1.1.
**Archivos:** `db/schema.prisma` (`model Orden`).
**Qué:** el campo `claveRemision String? @default(dbgenerated()) @map("clave_remision")` y el
`@@index([...], map: "orden_prioridad_clave_remision_idx")` de design §2.5, con el comentario que
explica **qué no puede expresar Prisma aquí** (el predicado parcial y la `COLLATE "C"`) y dónde
vive de verdad — si no, el siguiente agente lo «restaura» sin el predicado.
**Hecho cuando:** `pnpm exec prisma migrate diff --from-config-datasource --to-schema-datamodel db/schema.prisma`
sale **vacío** (sin drift), y `pnpm exec prisma generate` produce un cliente con `claveRemision`
en `OrdenOrderByWithRelationInput`.

---

## Tanda 2 — El servidor

### T2.1 · `SORT_COLUMN` apunta a la clave natural
**Depende de:** T1.3.
**Archivos:** `lib/repositories/OrdenRepository.ts` (~línea 870).
**Qué:** `num_remision: "claveRemision"` y el tipo del `Record` ampliado, con el comentario de
design §3 (por qué la clave pública no cambia). **No se toca** el `orderBy` de la línea 1906.
**Hecho cuando:** `pnpm run typecheck` verde y ordenar por `num_remision` en la base local
devuelve `NA-107` antes que `NA-1069`.

### T2.2 · `SORT_FIELDS` y `listarOrdenesSchema` **sin tocar**
**Depende de:** nada. **[P]**
**Archivos:** ninguno — es una task de **no hacer**, y existe para que se verifique.
**Hecho cuando:** `git diff origin/dev -- lib/types/orden.ts` está **vacío** (R18).

### T2.3 · Las dos notas del listado
**Depende de:** T3.1 (viven en el módulo de la pantalla).
**Archivos:** `app/(app)/ordenes/_components/OrdenesModule.tsx` (~539-542).
**Qué:** `notaPrioridad(orden.sortBy)` en lugar de la constante `NOTA_PRIORIDAD` (R14), **y** la
nota de agrupación por serie calculada sobre `items` (R20, design §4.4/§4.6). Las dos se derivan
de las filas que la página está enseñando, no del conjunto.
**Hecho cuando:** no queda ningún importador de `NOTA_PRIORIDAD` (`grep` a cero); con el orden por
remisión puesto la nota de prioridad dice «…el resto sigue el orden por número de remisión»; y la
de series aparece solo cuando en pantalla hay ≥ 2 series distintas. **El `numRemision` sale del
DTO que ya viaja: si en este cambio aparece `claveRemision` en cualquier sitio del cliente, está
mal** (R16).

### T2.4 · `PRISMA_OMIT` — **medir antes de decidir**
**Depende de:** T2.1.
**Archivos:** `lib/db/prisma-client.ts` (~línea 45).
**Qué:** añadir `claveRemision: true` al `omit` de `orden`, y **comprobar contra Postgres real**
que el `orderBy` por esa columna sigue funcionando con el `omit` puesto. El comentario del archivo
afirma hoy que el `omit` «no afecta al `where`»; sobre el `orderBy` **no dice nada y no se supone**.
**Hecho cuando:** existe evidencia ejecutada (salida pegada en `progress/impl_423.md`) de que un
`repo.list({sortBy:"num_remision"})` devuelve filas ordenadas **y** sin `claveRemision` en el
payload. Si el `omit` rompiera el `orderBy`: revertir el `omit`, escribir el porqué medido en
`design.md` §2.6 y cubrir R16 con la aserción sobre DTO + columnas de descarga (plan B ya escrito).

---

## Tanda 3 — La pantalla

### T3.1 · Renombrar y ampliar el módulo de declaraciones
**Depende de:** T2.1.
**Archivos:** `app/(app)/ordenes/_components/ordenamiento-ordenes.ts` (nuevo, desde
`ordenamiento-creacion.ts`), y **borrado** de `ordenamiento-creacion.ts`.
**Qué:** las declaraciones de design §4.1 a §4.4 —incluidas `serieDeRemision` y
`notaAgrupacionPorSerie`, que son **funciones puras** sobre el `num_remision` del DTO—. Actualizar
los **tres** importadores
(`OrdenesListado.tsx`, `OrdenesModule.tsx`, `tests/unit/components/ordenamiento-creacion.test.ts`).
**OJO** (memoria del repo: «el test que vive dentro de lo que borras»): el test de la 356 se
**renombra y se amplía**, no se borra — sus cinco casos siguen valiendo palabra por palabra.
**Hecho cuando:** `grep -r "ordenamiento-creacion" --include=*.ts --include=*.tsx` da cero, y el
test renombrado pasa sin haber perdido ningún caso.

### T3.2 · Montar el segundo conmutador
**Depende de:** T3.1.
**Archivos:** `app/(app)/ordenes/_components/OrdenesListado.tsx` (~795 y ~1175).
**Qué:** el estado `sortBy` y el `SegmentedToggle` de campo **delante** del de dirección, ambos en
el extremo izquierdo de la barra. Cambiar de campo **no** toca `sortDir` (R10).
`limpiarFiltros()` sigue sin tocar el orden.
**Hecho cuando:** entrando a `/ordenes` se ven los dos grupos con su nombre accesible y la pantalla
abre exactamente como antes: «Fecha de creación» + «Más recientes».

### T3.3 · Verificar en el navegador
**Depende de:** T3.2.
**Archivos:** ninguno (evidencia en `progress/impl_423.md`).
**Qué:** levantar el dev server (si otro agente ya tiene uno, **no levantes otro**: comparten
`.next`), entrar a `/ordenes`, ordenar por remisión ascendente y **leer las primeras filas**.
**Hecho cuando:** hay una captura o una transcripción de las primeras 10 remisiones mostradas, y
el orden es el de R3/R4. Los tests dicen que la consulta ordena; esto dice que el usuario lo ve.

---

## Tanda 4 — Tests (los que prueban el comportamiento)

### T4.1 · [P] El orden natural, contra Postgres real
**Depende de:** T2.1.
**Archivos:** `tests/integration/db/orden-orden-remision-natural.test.ts` (nuevo).
**Molde:** `tests/integration/db/orden-listado-orden-total.test.ts` — transacción revertida,
`serializarEscriturasReales`, corpus acotado a una ventana temporal sin datos reales, y un primer
caso que **comprueba el aislamiento** del corpus. **Nada de `if (!datos) return;`**.
**Corpus:** las cuatro series reales, con los valores que rompen el orden lexicográfico —al menos
`NA-107`, `NA-1067`, `NA-1069`, `NA-1070`, `NA-1863`, `72912`, `73636`, `BS-00001`, `SC-050`— y
un empate de clave suficientemente grande para cruzar dos cortes de página.
**Cubre:** R2, R3, R4, R7, R8, R9, R13.
**Hecho cuando:** pasa, **y** una mutación deliberada de `SORT_COLUMN` (volver a `numRemision`) lo
pone rojo. Deja la salida de las dos corridas en `progress/impl_423.md`: sin esa contraprueba, un
test de orden que mira su propia fuente queda verde para siempre.

### T4.2 · [P] La remisión rara no bloquea la creación
**Depende de:** T1.1.
**Archivos:** `tests/integration/db/orden-clave-remision-no-lanza.test.ts` (nuevo).
**Qué:** insertar órdenes con `SIN NUMERO`, `---`, `NA-`, `📦-5`, `'0'`, una cadena de 25 dígitos
y una con espacios al borde; **un `createMany` de lote** con una fila rara en medio, para probar
que no se lleva por delante a las demás. Asertar la clave resultante de cada una (tabla de
design §2.2) y que las dos colisiones conocidas **conviven** sin error.
**Cubre:** R5.
**Hecho cuando:** pasa, y ninguna de las inserciones lanza.

### T4.3 · [P] El control cableado en la pantalla
**Depende de:** T3.2.
**Archivos:** `tests/unit/components/ordenes-listado-orden.test.tsx` (ampliado).
**Qué:** que el grupo «Ordenar por» esté a la vista nada más entrar; que pulsar «Número de
remisión» llegue a `listarOrdenes` con `sortBy: "num_remision"`; que **la dirección se conserve**
al cambiar de campo (R10); que «Limpiar todo» no mueva el orden.
**Cubre:** R1, R2 (lado cliente), R10.
**Hecho cuando:** pasa y localiza el control por su **nombre accesible**, no por un `data-testid`.

### T4.4 · [P] Caché y paginación al cambiar de campo
**Depende de:** T3.2.
**Archivos:** `tests/unit/components/ordenes-module-orden.test.tsx` (ampliado).
**Qué:** que cambiar de campo **dispare una petición nueva** (la clave SWR cambia) y que la página
vuelva a 1. Estando en la página 3 por fecha, elegir remisión tiene que pedir `page: 1`.
**Cubre:** R11, R12.
**Hecho cuando:** pasa, **y** se verifica que sale rojo si se sustituye `claveDeOrden(orden)` por
`orden.sortDir` — o sea que el test mide la separación de caché de verdad.

### T4.5 · [P] Declaraciones de la pantalla contra el contrato del servidor
**Depende de:** T3.1.
**Archivos:** `tests/unit/components/ordenamiento-ordenes.test.ts` (renombrado y ampliado desde
`ordenamiento-creacion.test.ts`).
**Qué:** los cinco casos vigentes de la 356 **intactos**, más: que los dos campos ofrecidos estén
en `SORT_FIELDS`; que `ordenamientoDe(campo, dir)` pase `listarOrdenesSchema.parse` en las cuatro
combinaciones; que las etiquetas de dirección de la remisión **no usen vocabulario temporal**
(nada de «reciente»/«antigua»); que `notaPrioridad` nombre el campo vigente y no un literal fijo.
**Cubre:** R1, R9 (lado cliente), R14, R18.
**Hecho cuando:** pasa sin haber derivado ningún literal del schema (si se derivan, el archivo se
compara consigo mismo y no puede ponerse rojo nunca).

### T4.6 · [P] El aviso de agrupación por serie
**Depende de:** T2.3, T3.1.
**Archivos:** `tests/unit/components/ordenes-agrupacion-serie.test.ts` (nuevo, sobre las funciones
puras) **y** los casos de pantalla que correspondan en
`tests/unit/components/ordenes-module-orden.test.tsx`.
**Qué:** las **tres** situaciones de R20, y no menos:

1. orden por remisión + página con `["NA-107", "72912", "BS-00001"]` → **aparece**;
2. orden por remisión + página con `["NA-107", "NA-1069", "NA-1863"]` (una sola serie) → **no
   aparece**;
3. orden por **fecha de creación** + página con varias series → **no aparece**.

Más: `serieDeRemision` sobre los valores reales (`NA-107` → `"NA-"`, `72912` → `""`,
`BS-00001` → `"BS-"`) y sobre los raros de T4.2, sin lanzar. Y que la nota **no enumera** las
series concretas (design §4.4): un `expect` de que su texto no contiene `NA-` ni `SC-`.
**Cubre:** R20.
**Hecho cuando:** pasan los tres casos **y** el caso 2 se pone rojo si se quita la condición de
«más de una serie» — es la mitad del requisito, y un aviso permanente lo pasaría sin ella.

---

## Tanda 5 — Guardias (lo que ningún test funcional ve)

### T5.1 · [P] La migración y el modelo no se degradan
**Depende de:** T1.3.
**Archivos:** `tests/unit/db/orden-clave-remision.guardia.test.ts` (nuevo).
**Molde:** `tests/unit/db/orden-num-remision-parcial.test.ts` (lectura estática de la migración +
del `model Orden`).
**Qué comprueba:**
- `migration.sql` declara la columna `GENERATED ALWAYS … STORED` **y** `COLLATE "C"`;
- el índice se crea con `WHERE "deleted_at" IS NULL`;
- la expresión **no contiene** ningún cast a número (`::int`, `::bigint`, `::numeric`, `to_number`,
  `to_char`) ni ningún rango/clase dependiente de collation (`[0-9]`, `[a-z]`, `\d`, `[[:alnum:]]`);
- `migration.sql` y `down.sql` no tienen `INSERT`/`UPDATE`/`DELETE`;
- `down.sql` suelta el índice **antes** que la columna;
- el `model Orden` explica dónde vive el predicado y la collation, y nombra la migración;
- **censo:** ninguna migración posterior recrea `orden_prioridad_clave_remision_idx` sin su
  `WHERE` ni sin la collation.
**Cubre:** R6, R19, y el flanco estático de R5.
**Hecho cuando:** pasa, y una edición de prueba que quite el `COLLATE "C"` lo pone rojo.

### T5.2 · [P] La clave es de solo lectura y no se filtra
**Depende de:** T2.4.
**Archivos:** `tests/unit/guards/clave-remision-solo-lectura.guardia.test.ts` (nuevo).
**Molde:** `tests/unit/guards/busqueda-texto-solo-lectura.test.ts` y
`tests/unit/db/prisma-omit-busqueda-texto.test.ts`.
**Qué comprueba:** que ningún archivo de `lib/` escriba `claveRemision`/`clave_remision` en un
`data:`, un `SET` o un `RETURNING`; que no aparezca en ninguna lista de columnas de descarga ni en
`lib/manifiesto/`; que **no aparezca en ningún archivo de `app/`** —el aviso de series (R20) se
deriva del `numRemision` del DTO y sacarla al cliente sería la forma obvia de romper R16—; y que
`PRISMA_OMIT` la incluya (o, si T2.4 midió que no puede, la aserción equivalente del plan B).
**Cubre:** R16, R17.
**Hecho cuando:** pasa, y añadir `claveRemision` a un `data:` de prueba lo pone rojo.

### T5.3 · [P] El alcance no se desborda
**Depende de:** T2.1.
**Archivos:** `tests/unit/guards/orden-remision-alcance.guardia.test.ts` (nuevo).
**Qué comprueba:** que `claveRemision` aparezca en **un solo** `orderBy` de todo `lib/` (el de
`OrdenRepository.list`), y que los `orderBy` de `findRecepcionSateliteByZona`, del histórico y de
los listados por rol sigan siendo literalmente los de `origin/dev`.
**Cubre:** R15.
**Hecho cuando:** pasa, y añadir la clave al `orderBy` del listado satélite lo pone rojo.

---

## Tanda 6 — Cierre

### T6.1 · Gate completo
**Depende de:** todas.
**Qué:** `./init.sh` (**no** `--rapido`: se negaría solo por la migración y el `schema.prisma`).
Escribe `INIT_EXIT=$?` **dentro** del log, no en un `echo` aparte —un gate rojo ya llegó una vez
como «exit code 0»—, y no canalices el log por `tail`.
**Hecho cuando:** `INIT_EXIT=0` con el baseline como veredicto, y la cuenta de `skipped` revisada:
si los archivos de `integration/db` salen saltados, **T4.1 y T4.2 no se han ejecutado** y la
feature no está verificada.

### T6.2 · Informe con el mapa `R → test`
**Depende de:** T6.1.
**Archivos:** `progress/impl_423.md`.
**Qué:** la tabla de abajo con el resultado real de cada test, la salida del gate, la evidencia de
T2.4 (la medida del `omit`), la de T4.1 (la contraprueba por mutación) y la de T3.3 (lo que se vio
en pantalla). **Commitéalo** — en este repo los informes se quedaron sin commitear tres veces en
un día y un `git checkout` se los llevó.
**Hecho cuando:** los **20** requisitos tienen un test nombrado y ejecutado, ninguno «pendiente».

---

## Mapa de trazabilidad `R<n> → test`

| R | Qué fija | Test |
| --- | --- | --- |
| R1 | El control ofrece los dos campos y ninguno más | T4.5 + T4.3 |
| R2 | Ordena el conjunto, no la página | T4.1 (recorrido de páginas) + T4.3 (llega a la petición) |
| R3 | `NA-107` antes que `NA-1069` | **T4.1** |
| R4 | Series: numéricas, `BS-`, `NA-`, `SC-` | **T4.1** |
| R5 | Remisión fuera de patrón no bloquea la creación | **T4.2** + T5.1 (sin casts) |
| R6 | Mismo orden en cualquier entorno | T5.1 (`COLLATE "C"` + sin rangos) |
| R7 | `prioridad` sigue delante | T4.1 |
| R8 | Paginar no repite ni pierde | T4.1 |
| R9 | Las dos direcciones | T4.1 (servidor) + T4.5 (control) |
| R10 | Cambiar de campo conserva la dirección | T4.3 |
| R11 | Cambiar de campo vuelve a página 1 | T4.4 |
| R12 | La caché no sirve el resultado del otro campo | T4.4 |
| R13 | La descarga en el orden de la pantalla | T4.1 |
| R14 | La nota de prioridad nombra el campo vigente | T4.5 |
| R15 | Las demás superficies no cambian de orden | T5.3 |
| R16 | La clave no viaja a ningún DTO ni descarga | T5.2 (+ evidencia de T2.4) |
| R17 | Ninguna escritura de la app la fija | T5.2 + T4.2 (la base rechaza escribirla) |
| R18 | El contrato público no se amplía | T2.2 (diff vacío) + T4.5 |
| R19 | Reversible sin perder datos | T1.2 (rollback ejecutado) + T5.1 (`down.sql` sin DML) |
| R20 | El aviso de agrupación por serie, solo cuando se observa | **T4.6** (los tres casos) |
