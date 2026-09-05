# Ficha 374 — Administrar el catálogo geográfico desde la app · tasks

> **Orden de ejecución:** los bloques **0–G** y el **I** los hace `backend_dev`; el bloque **H**,
> después y sobre lo ya mergeado en la rama, `frontend_dev`. El bloque **J** cierra.
> `[P]` = puede correr en paralelo con las tareas de su mismo bloque marcadas igual.
> Cada tarea nombra los `R<n>` que cubre; el mapa completo `R → test` está en
> `requirements.md §3` y el implementer lo confirma en `progress/impl_374.md`.
> **Un commit por tarea lógica completada** (`docs/conventions.md`), no un mega-commit final.

---

## Bloque 0 · Preparación

- [ ] **T0.1 — Rama y base local al día.**
      Ramificar de `origin/dev` a `feat/374-catalogo-geografico-admin` (ya creada);
      `pnpm exec prisma migrate deploy` contra la base local **antes** de tocar nada.
      *Hecho cuando:* `pnpm exec prisma migrate status` dice «up to date» y nombra el host
      esperado (no se lee el `.env`).
      *Depende de:* —

- [ ] **T0.2 — Confirmar que los símbolos no existen ya.**
      Verificar **en el archivo real**, no solo en el grafo, que no hay `activo` en
      `Provincia`/`Canton`/`Distrito`, ni `GeografiaService`, ni `geografia-activa.ts`, ni
      `crearNodoGeografico`, ni ruta `app/(app)/configuracion/geografia/`.
      *Hecho cuando:* queda escrito en `progress/impl_374.md` que los cinco no existen, con el
      archivo consultado en cada caso.
      *Depende de:* T0.1

- [ ] **T0.3 — Medir duplicados en la base donde se va a aplicar.**
      Correr, en solo lectura, los tres `GROUP BY … HAVING count(*) > 1` (por `nombre` en
      provincia; por `(provincia_id, nombre)` en cantón; por `(canton_id, nombre)` en distrito) en
      **local** y **preview**. Producción ya está medida: 0 el 2026-09-05.
      *Hecho cuando:* los tres números por base quedan anotados en `progress/impl_374.md`. Si
      alguno no es 0, **la migración no se aplica** y se abre la decisión antes de seguir.
      *Depende de:* T0.1

---

## Bloque A · Base de datos (backend)

- [ ] **A1 — Migración.**
      `db/migrations/<ts>_geografia_activo_y_unicidad/migration.sql` con las tres `ADD COLUMN
      "activo" BOOLEAN NOT NULL DEFAULT true` y los tres `CREATE UNIQUE INDEX`, con el comentario
      de cabecera de `design.md §2.1` (el contraste con `zona_especial`, el porqué de sin índice y
      el porqué de la unicidad **por padre**). Ajustar el timestamp si otra migración ocupa ese
      minuto en `origin/dev`.
      *Hecho cuando:* aplica en local y `\d provincia|canton|distrito` muestra la columna y el
      índice único con el nombre esperado.
      *Cubre:* R1, R3, R4
      *Depende de:* T0.3

- [ ] **A2 — `down.sql`.**
      Suelta los tres índices y las tres columnas, con `IF EXISTS` (idempotente) y la pérdida de
      dato declarada. **Ningún `down.sql` anterior se toca.**
      *Hecho cuando:* `pnpm run db:rollback` revierte y deja las tres tablas con el mismo número
      de filas que antes del `up`.
      *Cubre:* R2
      *Depende de:* A1

- [ ] **A3 — `db/schema.prisma`.**
      `activo Boolean @default(true)` en los tres modelos, con el comentario `///` del contraste
      con `zonaEspecial` y con la nota de que el nombre es `activo` también en `provincia` (no
      `activa`) a propósito. Los tres `@@unique`.
      *Hecho cuando:* `pnpm exec prisma generate` pasa, `prisma migrate status` sigue en «up to
      date» (sin drift) y el cliente expone los tres campos.
      *Cubre:* R1, R3
      *Depende de:* A1

- [ ] **A4 [P] — Test de la migración.**
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

- [ ] **A5 [P] — Test de unicidad.**
      `tests/integration/db/geografia-unicidad.test.ts`: los tres duplicados fallan con violación
      de unicidad; el mismo nombre bajo **otro** padre entra (dos cantones homónimos en provincias
      distintas, y «Buenos Aires» como cantón de Puntarenas **y** distrito de Palmares).
      *Hecho cuando:* pasa, y la mitad «entra» va **antes** de la mitad «falla» para que un
      corpus que no llegara a la base no deje el test en verde por ausencia.
      *Cubre:* R3, R19
      *Depende de:* A3

---

## Bloque B · Contratos y tipos (backend)

- [ ] **B1 — El predicado compartido.**
      `lib/repositories/_shared/geografia-activa.ts` con `estaDisponible`, los tres
      `WHERE_*_DISPONIBLE` y `SELECT_CADENA_DISTRITO` (`design.md §3`). **Sin importar
      `@prisma/client`**: lo tiene que poder importar `geo-resolucion.ts`, que es lógica pura.
      *Hecho cuando:* `tests/unit/repositories/geografia-activa.test.ts` cubre las 8 combinaciones
      de los tres flags y `tsc` pasa con los fragmentos usados como `where` de Prisma.
      *Cubre:* R7
      *Depende de:* T0.2

- [ ] **B2 — Vocabulario, schemas y DTOs.**
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

- [ ] **B3 [P] — Interfaces.**
      `IGeoRepository` gana `listArbol`, `findHermanos`, `crear` y `cambiarActivacion` con sus
      contratos documentados, y sus tres `list*Lite` cambian de tipo de retorno.
      `lib/interfaces/services/IGeografiaService.ts` nuevo. **Ninguna declara `delete` ni
      `deleteMany`**, y se dice por qué en el comentario.
      *Hecho cuando:* `tsc` pasa; las implementaciones aún no existen y los tipos ya obligan.
      *Cubre:* R5, R12, R20
      *Depende de:* B2

---

## Bloque C · Repositorio (backend)

- [ ] **C1 — `GeoRepository`: las lecturas que ya existían.**
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

- [ ] **C2 — `GeoRepository`: las escrituras.**
      `findHermanos` (devuelve `null` si el padre no existe; trae **activos e inactivos**), `crear`
      (deja escapar la violación de UNIQUE) y `cambiarActivacion` (`updateMany`, `false` = no
      alcanzada). Ampliar el `Pick` del cliente Prisma solo con lo necesario.
      *Hecho cuando:* `tests/unit/repositories/geo-repository.escrituras.test.ts` verifica con un
      doble que `cambiarActivacion` toca **una** tabla y **una** fila, y que ninguno de los tres
      métodos llama a `delete`/`deleteMany`.
      *Cubre:* R8, R12, R20, R22
      *Depende de:* C1

- [ ] **C3 — Test de la cascada reversible.**
      `tests/integration/db/geografia-cascada-reversible.test.ts`: con un cantón de 3 distritos,
      uno de ellos ya inactivo por su cuenta → desactivar el cantón **no** cambia ningún `activo`
      de los hijos (se leen antes y después, fila a fila) → reactivar el cantón deja **exactamente**
      los flags previos → y `zona_distrito` tiene las mismas filas al principio y al final.
      *Hecho cuando:* pasa, y una mutación que añada un `updateMany` a los hijos lo pone rojo.
      *Cubre:* R8, R9, R20, R50
      *Depende de:* C2

---

## Bloque D · Servicio (backend)

- [ ] **D1 — `GeografiaService`.**
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

- [ ] **D2 — Test de integración del alta.**
      `tests/integration/db/geografia-alta.test.ts`: alta en los tres niveles bajo su padre; el
      nodo nace `activo`; alta bajo un cantón **inactivo** → `ok`, flag propio activo y
      disponibilidad efectiva falsa; el nombre se persiste recortado y con acentos; y —llamando al
      **repositorio** dos veces, saltándose la comprobación del service— el UNIQUE de la base
      convierte el segundo en `conflict` y no en error crudo.
      *Hecho cuando:* los cinco casos pasan y ninguno se salta por falta de datos.
      *Cubre:* R12, R13, R15, R16, R18
      *Depende de:* D1

---

## Bloque E · Borde (backend)

- [ ] **E1 — Las dos Server Actions.**
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

---

## Bloque F · Los sitios que leen el catálogo (backend)

- [ ] **F1 — `OrdenRepository`: proyectar, no recortar.**
      `findAllProvincias`, `findCantonesByProvinciaIds`, `findDistritosByCantonIds` y
      `findDistritoParaCorreccion` proyectan la cadena con `SELECT_CADENA_DISTRITO`; sus `…Row`
      ganan el flag. **Ni un `WHERE` nuevo.**
      *Hecho cuando:* el caso correspondiente de `geografia-catalogo-activo.test.ts` afirma que el
      distrito retirado **sigue saliendo** con su disponibilidad, y una mutación que meta el filtro
      en el `WHERE` lo pone rojo.
      *Cubre:* R31
      *Depende de:* C1

- [ ] **F2 — El rechazo en `resolveGeo`.**
      Tres comprobaciones, cada una detrás de su `lookup` y **antes** del chequeo de zona en el
      caso del distrito (`design.md §6`). Mensajes en el módulo puro, junto a los tres que ya
      existen.
      *Hecho cuando:* `tests/unit/services/geo-resolucion-retirados.test.ts` cubre un caso por
      nivel; los tres a la vez → gana la provincia (precedencia de R33); el mensaje **no** es «no
      encontrado» ni «ambiguo»; y las suites existentes de la carga y la cotización siguen verdes
      **sin editar ni una línea** (todo activo = comportamiento idéntico, R6).
      *Cubre:* R6, R32, R33
      *Depende de:* F1

- [ ] **F3 [P] — El rechazo en la corrección de ubicación.**
      Un `rechazoDeUbicacion` más en `CorregirDatosClienteService` (`:260-269`), hermano de «El
      distrito indicado no existe» y con texto propio.
      *Hecho cuando:* `tests/unit/services/corregir-datos-cliente-geo-retirada.test.ts` afirma el
      rechazo con su motivo, que es **distinto** del de inexistente, y que no se escribe nada.
      *Cubre:* R30
      *Depende de:* F1

- [ ] **F4 [P] — Los conteos públicos.**
      `ConteosPublicosRepository.contar` (`:33-35`) suma `WHERE_DISTRITO_DISPONIBLE` a su `where`.
      *Hecho cuando:* el caso de `geografia-catalogo-activo.test.ts` mide el conteo **antes** de
      retirar el distrito (contraprueba) y después.
      *Cubre:* R34
      *Depende de:* B1

- [ ] **F5 [P] — El histórico no se toca.**
      `tests/integration/db/geografia-historico-intacto.test.ts`: una orden de un distrito retirado
      sigue en `OrdenRepository.list` y sigue saliendo al filtrar por su `distritoId`. Molde y
      argumento: la mitad T4/T5 de `filtros-catalogo-sin-inactivos.test.ts`.
      *Hecho cuando:* pasa y el archivo deja escrito por qué esta mitad se afirma explícitamente y
      no por ausencia.
      *Cubre:* R35
      *Depende de:* C1

---

## Bloque G · Guardias (backend)

- [ ] **G1 — Sin borrado físico, estructural.**
      `tests/unit/guards/geografia-sin-borrado-fisico.guardia.test.ts`: recorre `lib/` y falla si
      aparece `delete`/`deleteMany` sobre `provincia`, `canton` o `distrito`. Con **contraprueba**
      sobre un cuerpo mutado en memoria que sí lo tiene.
      *Hecho cuando:* pasa con el árbol real y la contraprueba demuestra que detecta el hueco.
      *Cubre:* R5
      *Depende de:* C2

- [ ] **G2 [P] — El predicado no se reimplementa.**
      `tests/unit/guards/geografia-predicado-unico.guardia.test.ts`: toda referencia a `activo`
      sobre esas tres tablas dentro de `lib/` pasa por un símbolo de
      `_shared/geografia-activa.ts`. Contraprueba con un `where: { activo: true }` a mano.
      *Hecho cuando:* pasa y la contraprueba lo pone rojo.
      *Cubre:* R11
      *Depende de:* F4

- [ ] **G3 [P] — Sin renombrado.**
      `tests/unit/guards/geografia-sin-renombrado.guardia.test.ts`: no existe acción, método de
      service ni método de repositorio que escriba `nombre` en las tres tablas. Deja escrito en el
      encabezado **por qué** está fuera de alcance (el duplicado que crearía `seed-zonas.ts`).
      *Hecho cuando:* pasa con contraprueba.
      *Cubre:* R49
      *Depende de:* C2

---

## Bloque H · Pantalla (`frontend_dev`, después del backend)

- [ ] **H1 — Módulos puros primero.**
      `geografia-estado-label.ts` (los tres textos: activo / inactivo propio / inactivo por su
      `<nivel>`), `filtrar-arbol-geografico.ts` (extraído de `GeografiaSelector.tsx:144-168` y con
      `normalizeName` en lugar de su `norm()` de `:18-23`) y `zonasQueQuedarianSinDistritos`.
      Ninguno importa React.
      *Hecho cuando:* `tests/unit/utils/filtrar-arbol-geografico.test.ts` afirma que `perez
      zeledon` encuentra `Pérez Zeledón` y `san  jose` encuentra `San José`;
      `tests/unit/utils/zonas-sin-distritos.test.ts` cubre distrito / cantón / provincia y el caso
      «no deja ninguna zona vacía».
      *Cubre:* R39, R44 (parte)
      *Depende de:* E1

- [ ] **H2 — `GeografiaSelector` usa el filtro extraído.**
      Sustituir su `norm()` y su `useMemo` de filtrado por el módulo de H1. **Sin cambios de
      comportamiento salvo** que ahora recorta y colapsa espacios.
      *Hecho cuando:* los tests existentes de Tarifas siguen verdes y el caso nuevo de « san  jose »
      pasa.
      *Cubre:* R39
      *Depende de:* H1

- [ ] **H3 — El blindaje de Tarifas.**
      El selector pinta los nodos retirados con su distintivo, marcados si venían en
      `initialSelected`, y con la casilla **operable**. No se toca `onSelectedChange` ni la cascada.
      *Hecho cuando:* `tests/unit/components/geografia-selector-inactivos.test.tsx` afirma las tres
      cosas (se pinta, va marcado, la casilla responde al clic).
      *Cubre:* R47
      *Depende de:* H2

- [ ] **H4 — Test de integración del guardado de zona.**
      `tests/integration/db/zona-guardado-conserva-inactivos.test.ts`: guardar una zona sin tocar
      el selector deja `zona_distrito` con **exactamente** las mismas filas, incluida la del
      distrito retirado.
      *Hecho cuando:* pasa, y una mutación que quite el retirado de `initialSelected` lo pone rojo
      (es el fallo mudo de `design.md §8`).
      *Cubre:* R48
      *Depende de:* H3

- [ ] **H5 — La página.**
      `app/(app)/configuracion/geografia/page.tsx` calcada de la de vehículos (39 líneas): Server
      Component, `maestro` server-side, precarga del árbol y `<p role="alert">` cuando la lectura
      falla.
      *Hecho cuando:* `tests/unit/components/geografia-admin-page.test.tsx` afirma que un rol
      distinto no ve el árbol.
      *Cubre:* R38
      *Depende de:* H1

- [ ] **H6 — El árbol de administración.**
      `_components/GeografiaAdminModule.tsx`: tres niveles anidados, buscador, distintivo de estado
      en dos sabores, *Activar* deshabilitado **con el motivo** en el heredado, marca «sin zona» en
      el distrito.
      *Hecho cuando:* `tests/unit/components/geografia-admin.ui.test.tsx` cubre: propio vs heredado
      (R40); botón deshabilitado y nombre accesible con el motivo (R41); distrito con y sin zona
      utilizable (R42); búsqueda (R39).
      *Cubre:* R39, R40, R41, R42
      *Depende de:* H5

- [ ] **H7 — Alta, confirmación y desenlaces.**
      Formulario de alta oculto por nivel (patrón `VehiculosModule.tsx:41-109`); `Modal` con
      `closeOnConfirm={false}` para desactivar, que nombra el nodo y las zonas que quedarían sin
      distritos disponibles **sin bloquear**; relectura del árbol y un mensaje por desenlace.
      *Hecho cuando:* el test cubre: el alta de cantón exige provincia y la de distrito exige
      cantón (R43); abrir la confirmación no llama a la acción y Cancelar tampoco; la confirmación
      nombra las zonas y el botón sigue habilitado (R44); los seis mensajes de desenlace y la
      relectura (R45).
      *Cubre:* R43, R44, R45
      *Depende de:* H6

- [ ] **H8 — El menú.**
      `{ label: "Geografía", href: "/configuracion/geografia" }` **al final** del array de
      `children` de Configuración (`lib/auth/menu-visibility.ts:497-507`) y actualización **a
      mano** del `toEqual` de `tests/unit/auth/menu-visibility.test.ts:305-317`.
      *Hecho cuando:* ese `toEqual` lista los seis `href` con el nuevo el último, y
      `tests/unit/auth/destino-post-login.test.ts` sigue verde sin editarse.
      *Cubre:* R46
      *Depende de:* H5

- [ ] **H9 [P] — Los desplegables de la corrección.**
      `CorregirDatosClienteModal` filtra por `disponible` en los tres niveles (`hijosDe`, `:256-261`).
      *Hecho cuando:* `tests/unit/components/corregir-ubicacion-inactivos.test.tsx` afirma que el
      nodo retirado no se ofrece y que los demás sí (contraprueba primero).
      *Cubre:* R29
      *Depende de:* H5

---

## Bloque I · El contrato público (backend, puede ir en paralelo a H)

- [ ] **I1 — Los dos artefactos del canal.**
      `lib/api/openapi-spec.ts` y su espejo `docs/api/api-key-openapi.yaml`: el motivo de fila
      nuevo, y la descripción del campo `distrito` (`yaml:1327-1329`) pasa de enumerar cuatro
      motivos a cinco.
      *Hecho cuando:* `tests/unit/api/openapi-374-nodo-retirado.test.ts` afirma que **los dos**
      artefactos lo dicen y dicen lo mismo (molde `openapi-cotizacion-errores-aparte.test.ts`).
      *Cubre:* R37 (parte)
      *Depende de:* F2

- [ ] **I2 — La entrada del changelog.**
      Entrada fechada en `docs/api/CHANGELOG.md`, redactada **como el aviso que se copia y se
      manda**: qué cambia (un motivo de error de fila nuevo), qué **no** cambia (sigue siendo 200
      con éxito parcial; ningún path, código ni schema se toca) y qué hacer si tu código enumera
      los motivos.
      *Hecho cuando:* la entrada existe y el test de I1 la encuentra por su fecha y su título.
      *Cubre:* R37
      *Depende de:* I1

- [ ] **I3 [P] — El caso de extremo a extremo del canal.**
      `tests/integration/cotizacion-api-key.test.ts` gana el caso: lote de 2 filas, una con
      distrito retirado → **200**, una cotizada y una en `errores` con el mensaje nuevo.
      *Hecho cuando:* pasa y no reporta `passed` sin datos.
      *Cubre:* R36
      *Depende de:* F2

---

## Bloque J · Cierre

- [ ] **J1 — Mapa `R → test` en `progress/impl_374.md`.**
      Las 50 filas con el nombre real del test y del archivo. Un `R` sin test es un fallo de la
      feature.
      *Hecho cuando:* el archivo existe, está **commiteado** (no solo escrito) y las 50 filas
      apuntan a tests que existen.
      *Depende de:* H9, I3, G3

- [ ] **J2 — Matar las mutaciones que el spec exige.**
      Las cinco declaradas: el `WHERE` de un `list*Lite`, el `WHERE` de `findDistritosByCantonIds`,
      un `updateMany` a los hijos al desactivar, el filtro de `initialSelected` en el selector de
      Tarifas, y el `WHERE` de los conteos públicos.
      *Hecho cuando:* cada mutación deja **rojo** el test que la vigila, y queda anotado en
      `progress/impl_374.md` **qué test** cayó en cada caso (no «pasó la mutación»).
      *Depende de:* J1

- [ ] **J3 — Gate.**
      `./init.sh` **completo**: el diff toca `db/schema.prisma` y una migración, así que el modo
      rápido se negará. Con `.env` presente —si `tests/integration/db/**` sale `skipped`, el
      veredicto no vale—. Escribir `INIT_EXIT=$?` **dentro** del log.
      *Hecho cuando:* el log dice `INIT_EXIT=0` y el número de `skipped` está anotado y explicado.
      *Depende de:* J2

- [ ] **J4 — Verificación en la pantalla real.**
      Con la app levantada y sesión `maestro`: (a) dar de alta un distrito de prueba y verlo en el
      árbol; (b) intentar darlo de alta otra vez con acentos y mayúsculas distintas → conflicto;
      (c) desactivar su cantón → el distrito sale como *inactivo por su cantón* y *Activar*
      deshabilitado con el motivo; (d) reactivar el cantón → el distrito vuelve como estaba; (e) en
      Tarifas, el distrito retirado sigue ahí, marcado, con su casilla operable, y guardar la zona
      sin tocar nada no cambia sus distritos; (f) en la corrección de ubicación de una orden, el
      distrito retirado **no** se ofrece.
      *Hecho cuando:* los seis puntos quedan anotados en `progress/impl_374.md` con **lo que se
      vio**, no con lo que se esperaba.
      *Depende de:* J3
