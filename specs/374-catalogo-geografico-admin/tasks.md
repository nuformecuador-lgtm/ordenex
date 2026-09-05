# Ficha 374 — Administrar el catálogo geográfico desde la app · tasks

> **Orden de ejecución: BACKEND PRIMERO, FRONTEND DESPUÉS, sin solaparse.** Los bloques **0–G** y el
> **I** los hace `backend_dev`; el bloque **H**, después y sobre lo ya mergeado en la rama,
> `frontend_dev`. El bloque **J** cierra.
> No es preferencia de estilo: el frontend consume DTOs, acciones y textos que el backend estrena en
> esta misma ficha, y un gate leído sobre un árbol que otro agente está mutando no vale.
> `[P]` = puede correr en paralelo con las tareas de su mismo bloque marcadas igual.
> Cada tarea nombra los `R<n>` que cubre; el mapa completo `R → test` está en
> `requirements.md §3` y el implementer lo confirma en `progress/impl_374.md`.
> **Un commit por tarea lógica completada** (`docs/conventions.md`), no un mega-commit final.

---

## Bloque 0 · Preparación

- [x] **T0.1 — Rama y base local al día.**
      Ramificar de `origin/dev` a `feat/374-catalogo-geografico-admin` (ya creada);
      `pnpm exec prisma migrate deploy` contra la base local **antes** de tocar nada.
      *Hecho cuando:* `pnpm exec prisma migrate status` dice «up to date» y nombra el host
      esperado (no se lee el `.env`).
      *Depende de:* —

- [x] **T0.2 — Confirmar que los símbolos no existen ya.**
      Verificar **en el archivo real**, no solo en el grafo, que no hay `activo` en
      `Provincia`/`Canton`/`Distrito`, ni `GeografiaService`, ni `geografia-activa.ts`, ni
      `crearNodoGeografico`, ni ruta `app/(app)/configuracion/geografia/`.
      *Hecho cuando:* queda escrito en `progress/impl_374.md` que los cinco no existen, con el
      archivo consultado en cada caso.
      *Depende de:* T0.1

- [~] **T0.3 — Medir duplicados en la base donde se va a aplicar.** — HECHO en local (0/0/0 sobre
      7 provincias, 84 cantones y 494 distritos) y en produccion (0, medido el 2026-09-05).
      **PENDIENTE en PREVIEW**: no hay credencial alcanzable desde aqui. Correr alli los tres
      `GROUP BY ... HAVING count(*) > 1` ANTES de aplicar la migracion, o el `CREATE UNIQUE INDEX`
      fallara.
      Correr, en solo lectura, los tres `GROUP BY … HAVING count(*) > 1` (por `nombre` en
      provincia; por `(provincia_id, nombre)` en cantón; por `(canton_id, nombre)` en distrito) en
      **local** y **preview**. Producción ya está medida: 0 el 2026-09-05.
      *Hecho cuando:* los tres números por base quedan anotados en `progress/impl_374.md`. Si
      alguno no es 0, **la migración no se aplica** y se abre la decisión antes de seguir.
      *Depende de:* T0.1

---

## Bloque A · Base de datos (backend)

- [x] **A1 — Migración.**
      `db/migrations/<ts>_geografia_activo_y_unicidad/migration.sql` con las tres `ADD COLUMN
      "activo" BOOLEAN NOT NULL DEFAULT true` y los tres `CREATE UNIQUE INDEX`, con el comentario
      de cabecera de `design.md §2.1` (el contraste con `zona_especial`, el porqué de sin índice y
      el porqué de la unicidad **por padre**). Ajustar el timestamp si otra migración ocupa ese
      minuto en `origin/dev`.
      *Hecho cuando:* aplica en local y `\d provincia|canton|distrito` muestra la columna y el
      índice único con el nombre esperado.
      *Cubre:* R1, R3, R4
      *Depende de:* T0.3

- [x] **A2 — `down.sql`.**
      Suelta los tres índices y las tres columnas, con `IF EXISTS` (idempotente) y la pérdida de
      dato declarada. **Ningún `down.sql` anterior se toca.**
      *Hecho cuando:* `pnpm run db:rollback` revierte y deja las tres tablas con el mismo número
      de filas que antes del `up`.
      *Cubre:* R2
      *Depende de:* A1

- [x] **A3 — `db/schema.prisma`.**
      `activo Boolean @default(true)` en los tres modelos, con el comentario `///` del contraste
      con `zonaEspecial` y con la nota de que el nombre es `activo` también en `provincia` (no
      `activa`) a propósito. Los tres `@@unique`.
      *Hecho cuando:* `pnpm exec prisma generate` pasa, `prisma migrate status` sigue en «up to
      date» (sin drift) y el cliente expone los tres campos.
      *Cubre:* R1, R3
      *Depende de:* A1

- [x] **A4 [P] — Test de la migración.**
      `tests/integration/db/geografia-activo-migration.test.ts`, molde de
      `tests/integration/db/geografia-dta-2026-migration.test.ts` (esquema desechable + el SQL
      **real** leído de disco, cualificado al esquema): (a) tras el `up`, las filas previas quedan
      en `true` y la columna es `NOT NULL`; (b) `pg_indexes` no lista ningún índice cuya definición
      sea solo `(activo)`; (c) el `down` deja las tablas sin la columna y con el mismo conteo de
      filas.
      *Hecho cuando:* los tres casos pasan contra Postgres y ninguno reporta `passed` por un
      `return` temprano sin datos.
      *Cubre:* R1, R2, R4
      *Depende de:* A2, A3

- [x] **A5 [P] — Test de unicidad.**
      `tests/integration/db/geografia-unicidad.test.ts`: los tres duplicados fallan con violación
      de unicidad; el mismo nombre bajo **otro** padre entra (dos cantones homónimos en provincias
      distintas, y «Buenos Aires» como cantón de Puntarenas **y** distrito de Palmares).
      *Hecho cuando:* pasa, y la mitad «entra» va **antes** de la mitad «falla» para que un
      corpus que no llegara a la base no deje el test en verde por ausencia.
      *Cubre:* R3, R19
      *Depende de:* A3

- [x] **A6 — Migración de los cinco valores de enum del registro.**
      `db/migrations/<ts+1>_historial_accion_nodo_geografico/migration.sql`, **aparte** de A1
      (55P04): dos `ADD VALUE` en `historial_accion_tipo` y tres en `historial_accion_entidad`, con
      el comentario de `design.md §2.2.b`.
      *Hecho cuando:* aplica en local y `\dT+` lista **47** tipos y **20** entidades.
      *Cubre:* R51, R52, R56
      *Depende de:* A1

- [x] **A7 — `down.sql` de esa migración.**
      Recrea **los dos** tipos con su lista previa y recastea las **dos** columnas de
      `historial_accion`. Las listas: los 44 del `down.sql` de
      `20260904120000_historial_accion_api_key_eliminada` **más** `'api_key_eliminada'` (=45), y los
      17 del `CREATE TYPE` de `20260902120000_historial_accion` **tal cual** (nunca se amplió).
      Con la nota de precondición ruidosa. **Ningún `down.sql` anterior se toca.**
      *Hecho cuando:* `pnpm run db:rollback` revierte en una base sin filas de esas acciones y
      **aborta ruidosamente** si se inserta una antes.
      *Cubre:* R57
      *Depende de:* A6

- [x] **A8 — `db/schema.prisma`: los cinco valores en los dos enums de Prisma.**
      *Hecho cuando:* `prisma generate` pasa y el cliente los conoce.
      *Cubre:* R56
      *Depende de:* A6

- [x] **A9 — Catálogo cerrado y etiquetas.**
      `lib/types/historial-accion.ts`: los dos tipos al final del bloque **A.2 · hace desaparecer
      algo**, las tres entidades, `CATEGORIA_POR_ACCION` (`hace_desaparecer` para los dos, con el
      precedente `orden_eliminada`/`orden_recuperada` escrito al lado) y `ACCION_LABELS`. Cabecera
      de 45 a 47 tipos y de 17 a 20 entidades. `historial-accion-etiquetas.ts`: las tres fuentes y
      sus tres constructores con `unir`.
      *Hecho cuando:* `tsc` pasa (los dos cierres `satisfies`/`_AsegurarExhaustivo` no se quejan) y
      `tests/unit/historial-accion/catalogo-y-choke-point.test.ts` verde tras subir sus conteos.
      *Cubre:* R54, R56
      *Depende de:* A8

- [x] **A10 [P] — Test de la migración del registro.**
      `tests/integration/db/geografia-registro-migration.test.ts`: (a) los dos enums de la base
      coinciden exactamente con el catálogo; (b) el `down.sql` recrea 45 y 17 y **no** incluye los
      valores nuevos; (c) con una fila que use un valor nuevo, el rollback **falla**.
      *Hecho cuando:* los tres casos pasan contra Postgres real.
      *Cubre:* R57
      *Depende de:* A7, A9

---

## Bloque B · Contratos y tipos (backend)

- [x] **B1 — El predicado compartido.**
      `lib/repositories/_shared/geografia-activa.ts` con `estaDisponible`, los tres
      `WHERE_*_DISPONIBLE` y `SELECT_CADENA_DISTRITO` (`design.md §3`). **Sin importar
      `@prisma/client`**: lo tiene que poder importar `geo-resolucion.ts`, que es lógica pura.
      *Hecho cuando:* `tests/unit/repositories/geografia-activa.test.ts` cubre las 8 combinaciones
      de los tres flags y `tsc` pasa con los fragmentos usados como `where` de Prisma.
      *Cubre:* R7
      *Depende de:* T0.2

- [x] **B2 — Vocabulario, schemas y DTOs.**
      `NIVELES_GEOGRAFICOS` / `NivelGeografico`, `nombreGeoSchema` (trim + colapso, **sin** bajar a
      minúsculas), `crearNodoGeograficoSchema` (discriminada, `.strict()`),
      `cambiarActivacionGeograficaSchema`, y los resultados de `design.md §5.1`.
      `OpcionGeografica` / `OpcionGeograficaConPadre` en `lib/types/filtros-ordenes.ts`, y
      `activo` en los tres DTO del árbol.
      *Hecho cuando:* `tests/unit/types/geografia-nodo.test.ts` afirma la normalización del nombre
      (`"  San   José  "` → `"San José"`, con acento y mayúsculas) y el rechazo de claves
      desconocidas; `tsc` pasa en **todo** el árbol sin tocar a los consumidores actuales del
      catálogo.
      *Cubre:* R16, R25
      *Depende de:* B1

- [x] **B3 [P] — Interfaces.**
      `IGeoRepository` gana `listArbol`, `findHermanos`, `crear` y `cambiarActivacion` con sus
      contratos documentados, y sus tres `list*Lite` cambian de tipo de retorno.
      `lib/interfaces/services/IGeografiaService.ts` nuevo. **Ninguna declara `delete` ni
      `deleteMany`**, y se dice por qué en el comentario.
      *Hecho cuando:* `tsc` pasa; las implementaciones aún no existen y los tipos ya obligan.
      *Cubre:* R5, R12, R20
      *Depende de:* B2

---

## Bloque C · Repositorio (backend)

- [x] **C1 — `GeoRepository`: las lecturas que ya existían.**
      Los tres `list*Lite` proyectan la cadena y devuelven `disponible` (efectiva). `listArbol` se
      **muda** desde `lib/actions/geografia.ts:58-104` sin cambiar la consulta salvo: `activo` en
      los tres niveles y las zonas **sin `take: 1`**, colapsadas con `zonaUnicaDeDistrito`
      (`design.md §4.2`). Actualizar la cabecera de la clase: deja de ser «solo lectura».
      *Hecho cuando:* `tests/integration/db/geografia-catalogo-activo.test.ts` (Postgres real)
      cubre: nodo retirado presente con `disponible:false` en los tres `list*Lite`; distrito activo
      bajo cantón inactivo → presente y no disponible; distrito con 0, 1 y 2 zonas → sin zona / con
      zona / sin zona. Y **una mutación** que meta `activo: true` en el `WHERE` de un `list*Lite`
      pone el test rojo.
      *Cubre:* R6, R10, R26, R27, R28
      *Depende de:* B3, A3

- [x] **C2 — `GeoRepository`: las escrituras.**
      `findHermanos` (devuelve `null` si el padre no existe; trae **activos e inactivos**), `crear`
      (deja escapar la violación de UNIQUE) y `cambiarActivacion` con sus **tres** desenlaces
      (`no_existe` / `sin_cambio` / `cambiado`) y los cinco pasos de `design.md §5.5` dentro de UNA
      `$transaction`: leer (estado previo + piezas de la etiqueta) → cortar si no cambia → `update`
      → `resolverActorCongelado` → `appendAccion` **dentro** del callback. Ampliar el `Pick` con
      `$transaction`, `historialAccion` y `usuario`.
      *Hecho cuando:* `tests/unit/repositories/geo-repository.escrituras.test.ts` verifica con un
      doble el **orden** de llamadas (el corte por `sin_cambio` ocurre antes de cualquier escritura),
      que `cambiarActivacion` toca **una** tabla y **una** fila, y que ninguno de los tres métodos
      llama a `delete`/`deleteMany`.
      *Cubre:* R8, R12, R20, R22, R51, R52
      *Depende de:* C1, A9

- [x] **C3 — Test de la cascada reversible.**
      `tests/integration/db/geografia-cascada-reversible.test.ts`: con un cantón de 3 distritos,
      uno de ellos ya inactivo por su cuenta → desactivar el cantón **no** cambia ningún `activo`
      de los hijos (se leen antes y después, fila a fila) → reactivar el cantón deja **exactamente**
      los flags previos → y `zona_distrito` tiene las mismas filas al principio y al final.
      *Hecho cuando:* pasa, y una mutación que añada un `updateMany` a los hijos lo pone rojo.
      *Cubre:* R8, R9, R20, R50
      *Depende de:* C2

- [x] **C4 — Test de integración del registro de acciones.**
      `tests/integration/db/geografia-registro-accion.test.ts`: desactivar un distrito escribe
      **exactamente una** fila con `nodo_geografico_desactivado`, entidad `distrito`, etiqueta
      `Cabagra · Buenos Aires · Puntarenas`, actor congelado y `valor_anterior`/`valor_nuevo` en
      NULL; reactivar escribe `nodo_geografico_activado`; **un alta no escribe ninguna fila**;
      pedir desactivar lo ya inactivo **no escribe ni el `update` ni la fila**; y un fallo forzado
      de `appendAccion` deja el flag **como estaba**.
      *Hecho cuando:* los cinco casos pasan y ninguno se salta por falta de datos.
      *Cubre:* R51, R52, R53, R54, R55
      *Depende de:* C2

---

## Bloque D · Servicio (backend)

- [x] **D1 — `GeografiaService`.**
      `listarArbol`, `crear` y `cambiarActivacion` con `READ_ROLES`/`WRITE_ROLES` (`maestro`)
      **antes** de tocar la base. `crear` en los cuatro pasos de `design.md §5.2`: rol → hermanos
      (una consulta que resuelve padre inexistente **y** duplicado) → comparación por
      `normalizeName` → alta.
      *Hecho cuando:* `tests/unit/services/geografia-service.test.ts` cubre: rol ≠ `maestro` →
      `forbidden` **sin llamar al repositorio** (una por operación); padre inexistente →
      `not_found`; `San José` ya existente y `san jose` / `SAN JOSE` / `San  José` → `conflict`,
      incluido el caso del hermano **inactivo**; id inexistente → `not_found`; idempotencia de la
      activación.
      *Cubre:* R14, R17, R21, R22, R24
      *Depende de:* C2

- [x] **D2 — Test de integración del alta.**
      `tests/integration/db/geografia-alta.test.ts`: alta en los tres niveles bajo su padre; el
      nodo nace `activo`; alta bajo un cantón **inactivo** → `ok`, flag propio activo y
      disponibilidad efectiva falsa; el nombre se persiste recortado y con acentos; y —llamando al
      **repositorio** dos veces, saltándose la comprobación del service— el UNIQUE de la base
      convierte el segundo en `conflict` y no en error crudo.
      *Hecho cuando:* los cinco casos pasan y ninguno se salta por falta de datos.
      *Cubre:* R12, R13, R15, R16, R18
      *Depende de:* D1

- [x] **D3 — El conteo en el service, y que alguien lo INYECTE.**
      `GeografiaService` gana el segundo parámetro (`GeografiaOrdenesRepo`, un `Pick` de
      `IOrdenRepository`) y el método `contarOrdenesSinEntregar`, con la misma puerta de rol.
      *Hecho cuando:* el test cubre rol ≠ `maestro` → `forbidden` sin consultar; **y** un caso
      afirma que el composition root (`buildGeografiaService`) construye el service **pasándole** un
      `OrdenRepository` real — no que lo importe. Un servicio que recibe `undefined` compila igual y
      muere en producción.
      *Cubre:* R24, R60
      *Depende de:* D1, **F6** — ⚠️ F6 vive en un bloque posterior pero su única dependencia es B3,
      así que se adelanta hasta aquí. El orden de los bloques es de lectura, no una cadena.

---

## Bloque E · Borde (backend)

- [x] **E1 — Las dos Server Actions.**
      `crearNodoGeografico` y `cambiarActivacionGeografica` en `lib/actions/geografia.ts`, calcadas
      de `crearVehiculo` (`lib/actions/vehiculos.ts:64-82`), con `GeografiaActionDeps` y el
      `try/catch` que traduce la violación de UNIQUE a `conflict`. `listarArbolGeografico`
      **conserva su firma** y pasa a delegar en el service. `actualizarDistritosEspeciales`
      **no se toca** (y se dice en un comentario por qué).
      *Hecho cuando:* `tests/unit/actions/geografia-action.test.ts` cubre: sin sesión →
      `unauthenticated` **sin instanciar el service** (las tres acciones); nivel desconocido, padre
      ausente, nombre corto y clave desconocida → `validation_error` **sin llamar al service**;
      delegación correcta en el caso feliz.
      *Cubre:* R18, R23, R25
      *Depende de:* D1

- [x] **E2 — La cuarta Server Action: `contarOrdenesSinEntregarDeNodo`.**
      Solo lectura, mismo `deps`, `nodoGeograficoSchema.strict()`.
      *Hecho cuando:* el test de acciones cubre sin sesión → `unauthenticated` sin instanciar el
      service, y entrada inválida → `validation_error` sin llamarlo. Con esto son **cuatro** los
      casos de R23 y R25.
      *Cubre:* R23, R25, R60
      *Depende de:* D3

---

## Bloque F · Los sitios que leen el catálogo (backend)

- [x] **F1 — `OrdenRepository`: proyectar, no recortar.**
      `findAllProvincias`, `findCantonesByProvinciaIds`, `findDistritosByCantonIds` y
      `findDistritoParaCorreccion` proyectan la cadena con `SELECT_CADENA_DISTRITO`; sus `…Row`
      ganan el flag. **Ni un `WHERE` nuevo.**
      *Hecho cuando:* el caso correspondiente de `geografia-catalogo-activo.test.ts` afirma que el
      distrito retirado **sigue saliendo** con su disponibilidad, y una mutación que meta el filtro
      en el `WHERE` lo pone rojo.
      *Cubre:* R31
      *Depende de:* C1

- [x] **F2 — El rechazo en `resolveGeo`.**
      Tres comprobaciones, cada una detrás de su `lookup` y **antes** del chequeo de zona en el
      caso del distrito (`design.md §6`). Mensajes en el módulo puro, junto a los tres que ya
      existen.
      *Hecho cuando:* `tests/unit/services/geo-resolucion-retirados.test.ts` cubre un caso por
      nivel; los tres a la vez → gana la provincia (precedencia de R33); el mensaje **no** es «no
      encontrado» ni «ambiguo»; y las suites existentes de la carga y la cotización siguen verdes
      **sin editar ni una línea** (todo activo = comportamiento idéntico, R6).
      *Cubre:* R6, R32, R33
      *Depende de:* F1

- [x] **F3 [P] — El rechazo en la corrección de ubicación.**
      Un `rechazoDeUbicacion` más en `CorregirDatosClienteService` (`:260-269`), hermano de «El
      distrito indicado no existe» y con texto propio.
      *Hecho cuando:* `tests/unit/services/corregir-datos-cliente-geo-retirada.test.ts` afirma el
      rechazo con su motivo, que es **distinto** del de inexistente, y que no se escribe nada.
      *Cubre:* R30
      *Depende de:* F1

- [x] **F4 [P] — Los conteos públicos.**
      `ConteosPublicosRepository.contar` (`:33-35`) suma `WHERE_DISTRITO_DISPONIBLE` a su `where`.
      *Hecho cuando:* el caso de `geografia-catalogo-activo.test.ts` mide el conteo **antes** de
      retirar el distrito (contraprueba) y después.
      *Cubre:* R34
      *Depende de:* B1

- [x] **F5 [P] — El histórico no se toca.**
      `tests/integration/db/geografia-historico-intacto.test.ts`: una orden de un distrito retirado
      sigue en `OrdenRepository.list` y sigue saliendo al filtrar por su `distritoId`. Molde y
      argumento: la mitad T4/T5 de `filtros-catalogo-sin-inactivos.test.ts`.
      *Hecho cuando:* pasa y el archivo deja escrito por qué esta mitad se afirma explícitamente y
      no por ausencia.
      *Cubre:* R35
      *Depende de:* C1

- [x] **F6 — `OrdenRepository.contarSinEntregarPorNodoGeografico`.**
      Un `count` por la columna **congelada** del nivel (`provinciaId`/`cantonId`/`distritoId`, cada
      una con su índice), `deletedAt: null` y `estatus.value NOT IN ESTADOS_TERMINALES`, con la
      lista **importada** de `lib/types/order-status-transiciones.ts` y los otros dos candidatos
      descartados por escrito en el comentario (`design.md §5.6`).
      *Hecho cuando:* `tests/integration/db/geografia-ordenes-sin-entregar.test.ts` (Postgres real)
      cubre: una `en_reparto` cuenta; una `entregada`, una `devuelta_a_tienda`, una `incidente` y
      una **borrada** no; y una orden **sin `distrito_id`** cuenta para su cantón y no para ningún
      distrito. Y una mutación que quite `deletedAt: null` lo pone rojo.
      *Cubre:* R61
      *Depende de:* B3

---

## Bloque G · Guardias (backend)

- [x] **G1 — Sin borrado físico, estructural.**
      `tests/unit/guards/geografia-sin-borrado-fisico.guardia.test.ts`: recorre `lib/` y falla si
      aparece `delete`/`deleteMany` sobre `provincia`, `canton` o `distrito`. Con **contraprueba**
      sobre un cuerpo mutado en memoria que sí lo tiene.
      *Hecho cuando:* pasa con el árbol real y la contraprueba demuestra que detecta el hueco.
      *Cubre:* R5
      *Depende de:* C2

- [x] **G2 [P] — El predicado no se reimplementa.**
      `tests/unit/guards/geografia-predicado-unico.guardia.test.ts`: toda referencia a `activo`
      sobre esas tres tablas dentro de `lib/` pasa por un símbolo de
      `_shared/geografia-activa.ts`. Contraprueba con un `where: { activo: true }` a mano.
      *Hecho cuando:* pasa y la contraprueba lo pone rojo.
      *Cubre:* R11
      *Depende de:* F4

- [x] **G3 [P] — Sin renombrado.**
      `tests/unit/guards/geografia-sin-renombrado.guardia.test.ts`: no existe acción, método de
      service ni método de repositorio que escriba `nombre` en las tres tablas. Deja escrito en el
      encabezado **por qué** está fuera de alcance (el duplicado que crearía `seed-zonas.ts`).
      *Hecho cuando:* pasa con contraprueba.
      *Cubre:* R49
      *Depende de:* C2

- [x] **G4 — Las dos guardias del registro.**
      (a) `historial-accion-escrituras-cubiertas.guardia.test.ts`: entrada de censo para los dos
      tipos nuevos (`lib/repositories/GeoRepository.ts`, método `cambiarActivacion`, forma
      `abre_tx`, con la regex de la mutación) y su `toHaveLength(45)` a **47**. **Obligatoria**: sin
      ella el enum nuevo la pone roja.
      (b) `historial-accion-sin-datos-cliente.guardia.test.ts`: añadir `GeoRepository.ts` a
      `PUNTOS_DE_ESCRITURA`. **No** es obligatoria (nadie comprueba que esa lista esté completa) y
      por eso se hace a propósito: un punto de escritura fuera de la lista es un punto sin vigilar.
      *Hecho cuando:* (a) pasa **y** falla si se quita el `appendAccion` del método; (b) pasa con el
      archivo nuevo dentro.
      *Cubre:* R51, R54
      *Depende de:* C2, A9

- [x] **G5 [P] — Una sola fuente de «terminal».**
      `tests/unit/guards/geografia-terminales-una-sola-fuente.guardia.test.ts`: el conteo de F6
      **importa** `ESTADOS_TERMINALES` y no declara ninguna lista de estados propia. Contraprueba
      con un literal inyectado en memoria.
      *Hecho cuando:* pasa y la contraprueba lo pone rojo.
      *Cubre:* R61
      *Depende de:* F6

---

## Bloque H · Pantalla (`frontend_dev`, después del backend)

- [x] **H1 — Módulos puros primero.**
      `geografia-estado-label.ts` (los tres textos: activo / inactivo propio / inactivo por su
      `<nivel>`), `filtrar-arbol-geografico.ts` (extraído de `GeografiaSelector.tsx:144-168`, con
      `normalizeName` en lugar de su `norm()` de `:18-23` **y** con el argumento `estado`
      —`todos`/`activos`/`retirados`, evaluado con `estaDisponible`, no con el flag propio—) y
      `zonasQueQuedarianSinDistritos`. Ninguno importa React.
      *Hecho cuando:* `tests/unit/utils/filtrar-arbol-geografico.test.ts` afirma que `perez
      zeledon` encuentra `Pérez Zeledón`, que `san  jose` encuentra `San José`, que `retirados`
      incluye al distrito caído **por su cantón**, y que texto + estado se componen con AND;
      `tests/unit/utils/zonas-sin-distritos.test.ts` cubre distrito / cantón / provincia y el caso
      «no deja ninguna zona vacía».
      *Cubre:* R39, R44 (parte), R58, R59
      *Depende de:* E1

- [x] **H2 — `GeografiaSelector` usa el filtro extraído.**
      Sustituir su `norm()` y su `useMemo` de filtrado por el módulo de H1. **Sin cambios de
      comportamiento salvo** que ahora recorta y colapsa espacios.
      *Hecho cuando:* los tests existentes de Tarifas siguen verdes y el caso nuevo de « san  jose »
      pasa.
      *Cubre:* R39
      *Depende de:* H1

- [x] **H3 — El blindaje de Tarifas.**
      El selector pinta los nodos retirados con su distintivo, marcados si venían en
      `initialSelected`, y con la casilla **operable**. No se toca `onSelectedChange` ni la cascada.
      *Hecho cuando:* `tests/unit/components/geografia-selector-inactivos.test.tsx` afirma las tres
      cosas (se pinta, va marcado, la casilla responde al clic).
      *Cubre:* R47
      *Depende de:* H2

- [x] **H4 — Test de integración del guardado de zona.**
      `tests/integration/db/zona-guardado-conserva-inactivos.test.ts`: guardar una zona sin tocar
      el selector deja `zona_distrito` con **exactamente** las mismas filas, incluida la del
      distrito retirado.
      *Hecho cuando:* pasa, y una mutación que quite el retirado de `initialSelected` lo pone rojo
      (es el fallo mudo de `design.md §8`).
      *Cubre:* R48
      *Depende de:* H3

- [x] **H5 — La página.**
      `app/(app)/configuracion/geografia/page.tsx` calcada de la de vehículos (39 líneas): Server
      Component, `maestro` server-side, precarga del árbol y `<p role="alert">` cuando la lectura
      falla.
      *Hecho cuando:* `tests/unit/components/geografia-admin-page.test.tsx` afirma que un rol
      distinto no ve el árbol.
      *Cubre:* R38
      *Depende de:* H1

- [x] **H6 — El árbol de administración.**
      `_components/GeografiaAdminModule.tsx`: tres niveles anidados, buscador, distintivo de estado
      en dos sabores, *Activar* deshabilitado **con el motivo** en el heredado, marca «sin zona» en
      el distrito.
      *Hecho cuando:* `tests/unit/components/geografia-admin.ui.test.tsx` cubre: propio vs heredado
      (R40); botón deshabilitado y nombre accesible con el motivo (R41); distrito con y sin zona
      utilizable (R42); búsqueda (R39).
      *Cubre:* R39, R40, R41, R42
      *Depende de:* H5

- [x] **H7 — Alta, confirmación y desenlaces.**
      Formulario de alta oculto por nivel (patrón `VehiculosModule.tsx:41-109`); `Modal` con
      `closeOnConfirm={false}` para desactivar, que nombra el nodo, las zonas que quedarían sin
      distritos disponibles y —pidiéndolo al abrirse con `contarOrdenesSinEntregarDeNodo`— el número
      de órdenes sin entregar. **Tres líneas y ni una más.** Relectura del árbol y un mensaje por
      desenlace.
      *Hecho cuando:* el test cubre: el alta de cantón exige provincia y la de distrito exige
      cantón (R43); abrir la confirmación no llama a la acción de desactivar y Cancelar tampoco; la
      confirmación nombra las zonas y el botón sigue habilitado (R44); muestra el conteo (R60); si
      el conteo falla, lo dice y **no** bloquea (R62); el cuerpo no lleva ninguna otra línea de
      aviso (R63); y los seis mensajes de desenlace con la relectura (R45).
      *Cubre:* R43, R44, R45, R60, R62, R63
      *Depende de:* H6, E2

- [x] **H8 — El menú.**
      `{ label: "Geografía", href: "/configuracion/geografia" }` **al final** del array de
      `children` de Configuración (`lib/auth/menu-visibility.ts:497-507`) y actualización **a
      mano** del `toEqual` de `tests/unit/auth/menu-visibility.test.ts:305-317`.
      *Hecho cuando:* ese `toEqual` lista los seis `href` con el nuevo el último, y
      `tests/unit/auth/destino-post-login.test.ts` sigue verde sin editarse.
      *Cubre:* R46
      *Depende de:* H5

- [x] **H9 [P] — Los desplegables de la corrección.**
      `CorregirDatosClienteModal` filtra por `disponible` en los tres niveles (`hijosDe`, `:256-261`).
      *Hecho cuando:* `tests/unit/components/corregir-ubicacion-inactivos.test.tsx` afirma que el
      nodo retirado no se ofrece y que los demás sí (contraprueba primero).
      *Cubre:* R29
      *Depende de:* H5

- [x] **H10 — El filtro de estado en la pantalla.**
      `SegmentedToggle` de tres opciones (Todos / Activos / Retirados) junto al buscador, cableado
      al módulo puro de H1. **Sin ninguna llamada al servidor.**
      *Hecho cuando:* el test cubre los tres estados sobre el mismo árbol y afirma que cambiar el
      toggle **no** dispara ninguna Server Action (espía sobre las acciones inyectadas).
      *Cubre:* R58, R59
      *Depende de:* H6

---

## Bloque I · El contrato público (backend, puede ir en paralelo a H)

- [x] **I1 — Los dos artefactos del canal.**
      `lib/api/openapi-spec.ts` y su espejo `docs/api/api-key-openapi.yaml`: el motivo de fila
      nuevo, y la descripción del campo `distrito` (`yaml:1327-1329`) pasa de enumerar cuatro
      motivos a cinco.
      *Hecho cuando:* `tests/unit/api/openapi-374-nodo-retirado.test.ts` afirma que **los dos**
      artefactos lo dicen y dicen lo mismo (molde `openapi-cotizacion-errores-aparte.test.ts`).
      *Cubre:* R37 (parte)
      *Depende de:* F2

- [x] **I2 — La entrada del changelog.**
      Entrada fechada en `docs/api/CHANGELOG.md`, redactada **como el aviso que se copia y se
      manda**: qué cambia (un motivo de error de fila nuevo), qué **no** cambia (sigue siendo 200
      con éxito parcial; ningún path, código ni schema se toca) y qué hacer si tu código enumera
      los motivos.
      *Hecho cuando:* la entrada existe y el test de I1 la encuentra por su fecha y su título.
      *Cubre:* R37
      *Depende de:* I1

- [x] **I3 [P] — El caso de extremo a extremo del canal.**
      `tests/integration/cotizacion-api-key.test.ts` gana el caso: lote de 2 filas, una con
      distrito retirado → **200**, una cotizada y una en `errores` con el mensaje nuevo.
      *Hecho cuando:* pasa y no reporta `passed` sin datos.
      *Cubre:* R36
      *Depende de:* F2

---

## Bloque J · Cierre

- [x] **J1 — Mapa `R → test` en `progress/impl_374.md`.**
      Las **63** filas con el nombre real del test y del archivo. Un `R` sin test es un fallo de la
      feature.
      *Hecho cuando:* el archivo existe, está **commiteado** (no solo escrito) y las 63 filas
      apuntan a tests que existen.
      *Depende de:* H10, I3, G5

- [x] **J2 — Matar las mutaciones que el spec exige.**
      Las siete declaradas: el `WHERE` de un `list*Lite`, el `WHERE` de
      `findDistritosByCantonIds`, un `updateMany` a los hijos al desactivar, el filtro de
      `initialSelected` en el selector de Tarifas, el `WHERE` de los conteos públicos, el
      `deletedAt: null` del conteo de órdenes sin entregar, y sacar el `appendAccion` fuera de la
      `$transaction`.
      *Hecho cuando:* cada mutación deja **rojo** el test que la vigila, y queda anotado en
      `progress/impl_374.md` **qué test** cayó en cada caso (no «pasó la mutación»).
      *Depende de:* J1

- [x] **J3 — Gate.**
      `./init.sh` **completo**: el diff toca `db/schema.prisma` y una migración, así que el modo
      rápido se negará. Con `.env` presente —si `tests/integration/db/**` sale `skipped`, el
      veredicto no vale—. Escribir `INIT_EXIT=$?` **dentro** del log.
      *Hecho cuando:* el log dice `INIT_EXIT=0` y el número de `skipped` está anotado y explicado.
      *Depende de:* J2

- [x] **J4 — Verificación en la pantalla real.**
      Con la app levantada y sesión `maestro`: (a) dar de alta un distrito de prueba y verlo en el
      árbol; (b) intentar darlo de alta otra vez con acentos y mayúsculas distintas → conflicto;
      (c) desactivar su cantón → el distrito sale como *inactivo por su cantón* y *Activar*
      deshabilitado con el motivo; (d) reactivar el cantón → el distrito vuelve como estaba; (e) en
      Tarifas, el distrito retirado sigue ahí, marcado, con su casilla operable, y guardar la zona
      sin tocar nada no cambia sus distritos; (f) en la corrección de ubicación de una orden, el
      distrito retirado **no** se ofrece; (g) la confirmación de desactivar muestra el número de
      órdenes sin entregar y el toggle **Retirados** encuentra el distrito de un vistazo; (h) en
      `/historico/acciones` aparece «Retiró un nodo del catálogo geográfico» con la etiqueta
      completa y el actor congelado.
      *Hecho cuando:* los ocho puntos quedan anotados en `progress/impl_374.md` con **lo que se
      vio**, no con lo que se esperaba.
      *Depende de:* J3
