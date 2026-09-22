# Ficha 453 — Bitácora de implementación (BACKEND)

> Alcance de este informe: **las tandas de backend** de `specs/453-vistas-de-filtros-guardadas/tasks.md`
> (T0.1, T1.1–T1.5, T2.1, T2.2) más **T4.1** (el módulo puro de aplicabilidad, sin React) y **T6.2**
> (guardia de formato propio). Las tandas 3, 4.2, 4.3, 5 y la guardia T6.1 son de frontend y **no** se
> tocan aquí: quedan listadas abajo, en «Lo que le queda al frontend».

## T0.1 — Pre-vuelo medido (2026-09-21)

| Qué | Valor |
| --- | --- |
| Rama | `feat/453-vistas-de-filtros-guardadas` |
| SHA de `origin/dev` del que sale la rama | `09bb639bd1e3d1e20b1bc4cac4b8a80edeeb6759` (= `git merge-base HEAD origin/dev`) |
| HEAD al empezar | `ab8485ff6a6939217785a141c569a957dc78adfe` (el spec) |
| `DATABASE_URL` resoluble | **Sí** — `prisma migrate status`: `PostgreSQL database "ordenex" ... at "localhost:5432"`, 205 migraciones, «Database schema is up to date!» |
| Archivos de test contra Postgres | **199**, y el gate confirma que **SÍ se ejecutan**: `✓ DATABASE_URL resuelta: los 199 archivos de tests contra Postgres SI se ejecutan` |

Sin `DATABASE_URL` esos 199 se dan por **saltados, no fallan**, y un verde de la capa de datos no
significaría nada. Aquí hay base, así que los dos archivos de integración de esta ficha se ejecutan
(se ve en la salida real de más abajo, y en los `skipped` del gate: 26, todos de `AnaliticaPage` y
`AnaliticaShell`, ninguno de `integration/db`).

### Un hallazgo del pre-vuelo que hay que saber antes de tocar migraciones

`pnpm run db:migrate:create` (`prisma migrate dev --create-only`) **no funciona en este repo**:
Prisma levanta una *shadow database* vacía y ahí `20260918120200_zona_sinpe_no_nulo` aborta a
propósito (`P0001`: «FICHA 429: hay bodegas sin SINPE…»), así que el comando muere con `P3006` sin
escribir nada. La vía que sí funciona, y la que se usó:

1. `prisma migrate diff --from-config-datasource --to-schema db/schema.prisma --script` → el DDL
   canónico que Prisma espera (no usa shadow db);
2. escribir `migration.sql` y `down.sql` a mano sobre ese DDL;
3. `prisma migrate deploy` → `pnpm run db:rollback` → `prisma migrate deploy` otra vez;
4. `migrate diff` de nuevo: `-- This is an empty migration.` (cero deriva).

---

## Archivos creados y modificados

### Creados

| Archivo | Qué es |
| --- | --- |
| `lib/types/vista-filtro.ts` | Módulo PURO: superficies declaradas, formato persistido versionado, topes, schemas del borde, mensajes con su número. |
| `lib/interfaces/repositories/IVistaFiltroRepository.ts` | Contrato del repositorio. `usuarioId` en TODAS las firmas. |
| `lib/repositories/VistaFiltroRepository.ts` | Solo Prisma. El dueño va en el `WHERE` de cada escritura. |
| `lib/interfaces/services/IVistaFiltroService.ts` | Contrato del servicio. **No hay método «aplicar»**, y es el diseño. |
| `lib/services/VistaFiltroService.ts` | Las reglas: propiedad, tope, nombre, «nada que guardar», lectura defensiva. |
| `lib/actions/vistas-filtro.ts` | Las cinco Server Actions (patrón `push.ts`). |
| `lib/utils/vista-filtro-aplicabilidad.ts` | Módulo PURO: qué partes de una vista se pueden reponer. **La frontera con el frontend.** |
| `db/migrations/20260921120000_vista_filtro/migration.sql` · `down.sql` | La tabla, su único, su FK CASCADE y la RLS. |
| `tests/unit/utils/vista-filtro-payload.test.ts` | 14 casos. |
| `tests/unit/utils/vista-filtro-aplicabilidad.test.ts` | 18 casos. |
| `tests/unit/services/vista-filtro-service.test.ts` | 17 casos. |
| `tests/unit/actions/vistas-filtro-action.test.ts` | 11 casos. |
| `tests/unit/guards/vista-filtro-formato-propio.guardia.test.ts` | 4 casos (R6). |
| `tests/integration/db/vista-filtro-migration.test.ts` | 20 casos contra Postgres real. |
| `tests/integration/db/vista-filtro.test.ts` | 8 casos contra Postgres real (el `WHERE`). |

### Modificados

| Archivo | Por qué |
| --- | --- |
| `db/schema.prisma` | Modelo `VistaFiltro` + relación `vistasFiltro` en `Usuario`. |
| `tests/fixtures/api-key-dependencias-usuario.ts` | Censo de FKs hacia `usuario`: clasificada `VistaFiltro.usuario` con su motivo. |
| `tests/integration/db/schema-drift-saneamiento.test.ts` | Censo de tablas con DEFAULT en `updated_at`: entra `vista_filtro` (ONCE → DOCE). |
| `tests/integration/db/orden-traspaso-migration.test.ts` | Censo de migraciones POSTERIORES: entra `20260921120000_vista_filtro` con su motivo. |

Los tres últimos son **censos con lista literal escrita a mano**, y eso es exactamente su gracia: una
tabla nueva no entra sin que alguien lo decida. Los sacó el gate completo (ver abajo).

---

## Las decisiones que este backend toma, y por qué

**1. El formato persistido es propio, versionado y CERRADO.** `lib/types/vista-filtro.ts` guarda las
tres piezas de la barra (`termino`, `activos`, `seleccion`) con `v: z.literal(1)` y `.strict()`.
Nada de `serializarFiltro` (la clave de caché), y una guardia lo vigila en los dos sentidos.

**Qué pasa al leer una versión que no se conoce, dicho en código** (`leerPayloadGuardado`): **no se
adivina**. Un documento cuya `v` no está en `VERSIONES_LEGIBLES` devuelve `null` → el servicio lo
saca con `filtro: null` → la vista sale **ilegible**: no se aplica ni entera ni en parte, y se sigue
pudiendo renombrar y borrar (R8). Y `versionDeclarada()` deja distinguir «guardada con un formato
más nuevo» de «documento roto», que no significan lo mismo aunque las dos se nieguen a aplicarse. El
día que haya una v2, los dos únicos sitios que se tocan están escritos en el propio archivo.

**2. «Catálogo caído» ≠ «valor desaparecido», con DOS cierres.** Vive en
`lib/utils/vista-filtro-aplicabilidad.ts`:

- el catálogo entra como **unión explícita** (`{estado:"cargado"|"no_disponible"}`): quien llama
  tiene que DECIR si sus opciones están resueltas. No se puede pasar «una lista de filtros» a secas,
  que es justo la firma con la que el error se cuela sin que nadie lo note;
- y **aunque quien llame diga «cargado»**, el módulo se niega a clasificar si el filtro que la vista
  usa está `disabled` o se ofrece **sin ninguna opción** — que es el estado real de `/ordenes` cuando
  `page.tsx` devuelve `null` y el fetcher de estados devuelve `[]`. Devuelve
  `{estado:"no_comprobable"}`, que **no trae `aplicable`**: no hay filtro que poner ni vista que
  marcar.

El sesgo es deliberado: ante la duda, no se clasifica y no se aplica. Una vista buena marcada
incompleta empuja a rehacerla —y a perderla—; una que hoy no se puede comprobar cuesta un reintento.

**3. El tope es del servicio, no de la base** (design §3.4), con su coste dicho: `count`+`insert` no
es atómico y dos pestañas pueden dejar 21. Aceptado: el daño es una fila de más en una lista y la
siguiente escritura ya se rechaza.

**4. Una desviación del diseño, declarada:** design §5 nombra el error del tope `limit_reached`; aquí
se llama **`limite_excedido`**, que es el término que ya usan diez módulos de `lib/types/`. Lleva
`maximo` y `actuales` porque R13 exige decir los dos números y `ActionError` no admite carga.

---

## Mapa `R<n> → test` (lo que cubre este backend)

| R | Qué afirma | Archivo · caso |
| --- | --- | --- |
| R1 | la vista se compone de superficie+nombre+dueño+filtro | `integration/db/vista-filtro-migration.test.ts` · «la tabla existe, con su forma EXACTA» |
| R2 | nadie toca las vistas de otro (**en el `WHERE`**) | `integration/db/vista-filtro.test.ts` · los tres casos «con el id de OTRA persona» · `unit/services/…` · `unit/actions/…` |
| R3 | el dueño sale de la sesión; inyectarlo es `validation_error` | `unit/actions/vistas-filtro-action.test.ts` · los cuatro casos del bloque R3 |
| R4 | borrar la persona borra sus vistas (CASCADE) | `integration/db/vista-filtro-migration.test.ts` · «borrar a la persona se lleva TODAS sus vistas, y solo las suyas» |
| R5 | se guardan las **tres** piezas de la barra | `unit/utils/vista-filtro-payload.test.ts` · bloque R5 (5 casos) |
| R6 | formato propio, separado de la clave de caché | `unit/guards/vista-filtro-formato-propio.guardia.test.ts` |
| R7 | versión del formato, y que sirva para algo | `unit/utils/vista-filtro-payload.test.ts` · bloque R7 |
| R8 | ilegible: no se aplica, sí se renombra/borra | `unit/utils/vista-filtro-payload.test.ts` · bloque R8 · `unit/services/…` · `unit/utils/vista-filtro-aplicabilidad.test.ts` |
| R9 | nombre obligatorio (recortado) | `unit/services/vista-filtro-service.test.ts` · bloque R9 |
| R10 | máximo de longitud, **dicho** | `unit/services/…` · «60 entra; 61 se rechaza y el aviso lleva el numero» |
| R11 | duplicado rechazado, no sobrescribe | `unit/services/…` · bloque R11 · `integration/db/vista-filtro.test.ts` · «lo revienta EL INDICE» · `…-migration.test.ts` |
| R12 | no se guarda una vista vacía | `unit/services/…` · bloque R12 (guardar y actualizar) |
| R13 | tope por superficie, con su número | `unit/services/…` · bloque R13 (3 casos) · `unit/actions/…` · «el `limite_excedido` llega entero» |
| R14 | renombrar con las reglas de nombre | `unit/services/…` · «renombrar aplica la misma regla» · `integration/db/vista-filtro.test.ts` *(la mitad de pantalla la cubre el frontend)* |
| R15 | actualizar reemplaza el filtro y conserva el nombre | `unit/services/…` · bloque R15 · `integration/db/vista-filtro.test.ts` |
| R16 | aplicar no escribe nada | `unit/services/…` · «el servicio NO expone ninguna operacion de aplicar» + «leer no dispara NI UNA escritura» *(la mitad de pantalla, frontend)* |
| R24 | definición de «aplicable entera» | `unit/utils/vista-filtro-aplicabilidad.test.ts` · las cinco filas de §8.1 + la clave retirada |
| R25 | lo perdido se enumera con nombre visible, nunca un id crudo | `unit/utils/vista-filtro-aplicabilidad.test.ts` · bloque R25 *(el aviso, frontend)* |
| R27 | «aplicar sin eso» aplica solo lo aplicable | `unit/utils/vista-filtro-aplicabilidad.test.ts` · bloque R27 *(el botón, frontend)* |
| R29 | catálogo no disponible: ni clasificar ni aplicar | `unit/utils/vista-filtro-aplicabilidad.test.ts` · bloque R29 (6 casos, incluido el CONTRASTE) *(el cableado, frontend)* |
| R33 | superficie no declarada → error, no lista vacía | `unit/actions/vistas-filtro-action.test.ts` · bloque R33 (3 casos) |
| R35 | dos personas, el mismo nombre | `integration/db/vista-filtro-migration.test.ts` · «DOS personas SI pueden tener el mismo nombre» |

**Sin cubrir aquí, y es del frontend:** R17, R18, R19, R20, R21, R22, R23, R26, R28, R30, R31, R32,
R34, R36, R37, R38, R39, más las mitades de pantalla de R14, R16, R25, R27 y R29.

---

## Las mutaciones que se corrieron antes de creerse el verde

| Mutación | Resultado |
| --- | --- |
| `CREATE UNIQUE INDEX` → `CREATE INDEX` en `migration.sql` | **2 rojos** (la lista de sentencias y «R11: la MISMA persona no puede repetir nombre») |
| FK `ON DELETE CASCADE` → `RESTRICT` | **2 rojos** (el `.sql` y el CASCADE contra el motor) |
| `where: { id, usuarioId }` → `where: { id }` en el repositorio (las 4) | **3 rojos**, los tres casos «con el id de OTRA persona» |
| quitar `.strict()` de los schemas | **4 rojos** (dos del borde, dos del formato) |
| quitar el freno interno de catálogo (`disabled`/sin opciones) | **3 rojos**, entre ellos el par de CONTRASTE |
| tratar `no_disponible` como catálogo vacío (clasificable) | **2 rojos** |
| importar `serializar-filtro` desde `VistaFiltroService` | **1 rojo** (la guardia de formato propio) |

Todas revertidas y con la suite en verde después de cada reversión.

---

## Salida real

### `pnpm run typecheck`

```
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit
```
(sin salida: cero errores)

### `pnpm run lint`

```
✖ 202 problems (0 errors, 202 warnings)
```
Cero errores. Los 202 avisos son `no-unused-vars` preexistentes en tests ajenos; ninguno en archivos
de esta ficha.

### Los siete archivos de la ficha

```
 Test Files  7 passed (7)
      Tests  92 passed (92)
```

| Archivo | Casos |
| --- | --- |
| `tests/unit/utils/vista-filtro-payload.test.ts` | 14 |
| `tests/unit/utils/vista-filtro-aplicabilidad.test.ts` | 18 |
| `tests/unit/services/vista-filtro-service.test.ts` | 17 |
| `tests/unit/actions/vistas-filtro-action.test.ts` | 11 |
| `tests/unit/guards/vista-filtro-formato-propio.guardia.test.ts` | 4 |
| `tests/integration/db/vista-filtro-migration.test.ts` | 20 |
| `tests/integration/db/vista-filtro.test.ts` | 8 |

### `./init.sh` COMPLETO (`progress/gate_453_backend.log`)

Primera corrida — **`INIT_EXIT=1`**, `9 failed | 30073 passed | 26 skipped`, 4 archivos rojos nuevos.
Los cuatro eran **míos** (los tres censos + la guardia de superficie de uso), ninguno flake.

Segunda corrida, ya con los censos actualizados:

```
 Test Files  2064 passed (2064)
      Tests  30082 passed | 26 skipped (30108)
   Duration  653.12s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 2064 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

- **26 `skipped`**, exactamente la referencia: 17 de `tests/components/AnaliticaPage.test.tsx` y 9 de
  `tests/components/AnaliticaShell.test.tsx`. **Ninguno de `integration/db`**, así que la capa de
  datos se ejecutó de verdad.
- El aviso de «migraciones sin down.sql» es de **tres migraciones de agosto ajenas a esta ficha**; la
  de la 453 tiene el suyo.
- Ninguna entrada del baseline volvió a verde, así que no hay nada que podar.

---

## Lo que le queda al frontend (y la frontera exacta)

Tandas **3** (T3.1, T3.2 — la costura `siembra` en `BuscadorFiltros` y `FilterComponent`), **4.2**
(el control `VistasFiltro` en la barra), **4.3** (el aviso de la vista incompleta), **5** (encender
`/ordenes` + verlo en el navegador) y **T6.1** (la guardia de superficies montadas). T4.1 ya está
hecha y es el módulo del que tira todo eso.

**Las cinco Server Actions** (`lib/actions/vistas-filtro.ts`), todas `(input: unknown, deps?)`:

| Acción | Entrada | Salida `ok` |
| --- | --- | --- |
| `listarVistasFiltro` | `{ superficie }` | `{ status:"ok", vistas: VistaFiltroDTO[] }` (por nombre asc) |
| `guardarVistaFiltro` | `{ superficie, nombre, filtro }` | `{ status:"ok", vista }` |
| `renombrarVistaFiltro` | `{ id, nombre }` | `{ status:"ok", vista }` |
| `actualizarVistaFiltro` | `{ id, filtro }` | `{ status:"ok", vista }` |
| `eliminarVistaFiltro` | `{ id }` | `{ status:"ok" }` |

Errores: `validation_error` (con `fieldErrors.nombre` / `.filtro` ya redactados y CON el número),
`conflict` (nombre duplicado — el nombre lo pone la pantalla, hay `MSG_VISTA.nombreEnUso(nombre)`
listo), `limite_excedido` (`{ maximo, actuales }`), `not_found`, `unauthenticated`.

**El módulo de aplicabilidad**, que es lo que la pantalla tiene que usar para decidir:

```ts
evaluarVista(catalogo, vista.filtro) ->
  | { estado: "no_comprobable"; motivo }          // R29: ni clasificar, ni aplicar. NO trae `aplicable`.
  | { estado: "ilegible" }                        // R8
  | { estado: "aplicable_entera"; aplicable }     // R18: aplicar sin preguntar
  | { estado: "incompleta"; aplicable; perdidas } // R25/R26: NO aplicar nada hasta que alguien decida
```

Y el catálogo se construye con `catalogoCargado(filtrosBarra)` **solo** cuando las opciones están
resueltas; en `/ordenes` eso es `catalogoFiltros !== null` **y** el catálogo de estados no vacío. En
cualquier otro caso, `catalogoNoDisponible()`. (Si se equivoca y dice «cargado» con el catálogo
caído, el módulo lo frena igual — pero la pantalla tiene que decirlo bien, porque ese freno solo mira
los filtros que la vista usa.)

**Lo que el frontend tiene que retirar cuando monte el control:** las cinco anotaciones
`@sin-superficie` de `lib/actions/vistas-filtro.ts`. La guardia `superficie-de-uso` exige quitarlas
en cuanto las acciones sean alcanzables —una excepción que sobrevive a su motivo es basura— y hoy
están ahí, con su motivo, justo porque la barra todavía no las llama.

**Cuidado con esto al escribir T6.1:** la guardia de superficies montadas se pondrá **roja mientras
`"ordenes"` no tenga control montado**, así que se escribe en el mismo commit que lo monta, no antes.

---

## Veredicto

Backend de la 453 completo y verificado contra Postgres real: tabla con su migración reversible, RLS
y el dueño en el `WHERE`; formato propio versionado que dice qué hace ante una versión desconocida; y
la distinción «catálogo caído ≠ valor desaparecido» sostenida por dos cierres y por seis casos que
mueren si alguien los colapsa. `./init.sh` completo en **`INIT_EXIT=0`**.
---

# Ficha 453 — Bitácora de implementación (FRONTEND)

> Alcance: **T3.1, T3.2, T4.2, T4.3, T5.1, T5.2 y T6.1**. El backend (T0.1, T1.x, T2.x, T4.1, T6.2)
> está arriba y no se tocó. Rama `feat/453-vistas-de-filtros-guardadas`, desde `9f7036f9`.

## Archivos creados y modificados

### Creados

| Archivo | Qué es |
| --- | --- |
| `components/shared/VistasFiltro.tsx` | El control: disparador + panel (aplicar / renombrar / borrar), «Guardar filtros actuales…» y «Guardar cambios en esta vista». Consume las cinco acciones y el módulo de aplicabilidad. |
| `components/shared/VistaIncompletaAviso.tsx` | El `Modal` de §8.2: enumera lo perdido y ofrece exactamente dos salidas. |
| `tests/unit/components/buscador-filtros-siembra.test.tsx` | 11 casos (T3.1). |
| `tests/unit/components/filter-component-siembra.test.tsx` | 9 casos (T3.2). |
| `tests/unit/components/buscador-filtros-vistas.test.tsx` | 17 casos (T4.2). |
| `tests/unit/components/vistas-filtro-aviso-incompleta.test.tsx` | 7 casos (T4.3). |
| `tests/unit/components/ordenes-listado-vistas.test.tsx` | 10 casos (T5.1). |
| `tests/unit/guards/vistas-superficies-declaradas.guardia.test.tsx` | 8 casos (T6.1 + la red anti-global). |

### Modificados

| Archivo | Por qué |
| --- | --- |
| `components/shared/BuscadorFiltros.tsx` | Props `siembra` y `vistas`, las dos opcionales; el control al principio de la fila; y la retirada de los params propios al aplicar (R21). |
| `components/shared/FilterComponent.tsx` | Prop `siembra`, el rekey de los controles no controlados, y el montaje ya sembrado. |
| `app/(app)/ordenes/_components/OrdenesListado.tsx` | Declara la superficie `"ordenes"` y cablea las dos props. |
| `lib/actions/vistas-filtro.ts` | **Retiradas las cinco anotaciones `@sin-superficie`**: las acciones ya son alcanzables. |

## Las decisiones de esta mitad, y por qué

**1. Las dos props nuevas son opt-in y están apagadas.** La barra la montan **16 consumidores en 12
pantallas**; hoy solo `/ordenes` pasa `vistas`. Sin la prop no hay control, ni petición, ni emisión
(R31).

**2. La lista se pide AL ABRIR el panel, no al montar.** Con la clave de SWR a `null` hasta la
primera apertura, entrar a `/ordenes` no cuesta ninguna consulta nueva. Efecto lateral medido: los
cuatro archivos de test que ya renderizaban `OrdenesListado` siguen verdes **sin mockear** las
acciones nuevas, porque nadie las llama.

**3. R21 lo cumple la barra, no la pantalla.** La lista de «params propios» (el del término más las
claves ofrecidas) es de la barra y ya existía para «Limpiar todo»: se escribió **una vez** y la usan
los dos caminos. Que la pantalla armara su propia lista era la forma de que las dos divergieran.

**4. `FilterComponent` tenía que saber montarse YA sembrado, y no es un borde.** En `/ordenes` el
orquestador solo se monta cuando hay algún filtro pedido, así que aplicar una vista con controles
desde una barra vacía lo monta **por primera vez**. Sin eso arrancaba leyendo la URL: los controles
vacíos con el filtro ya aplicado, o sea la pantalla mintiendo. Esa selección **no se emite** y nace
con la siembra de la URL cerrada.

**5. La vista recién guardada queda marcada como puesta** (`onGuardada`). Lo que se acaba de guardar
ES lo que está en pantalla; sin esto habría que aplicarla para poder ofrecer «Guardar cambios».

**6. Lo que NO se hizo, a propósito:** no se migró ninguna de las cinco pantallas que hoy remontan
con `key` (eso es la 328), no se tocó `vista-filtro-aplicabilidad.ts` (se consume), y el **orden del
listado no entra en la vista** (P1): aplicar no reordena la tabla, y hay un caso que lo afirma.

## Mapa `R<n> → test` (la mitad de pantalla)

| R | Qué afirma | Archivo · caso |
| --- | --- | --- |
| R14 | renombrar con las reglas de nombre (y el duplicado lo nombra la pantalla) | `buscador-filtros-vistas` · bloque «renombrar» (3 casos) |
| R16 | aplicar no escribe NADA | `vistas-filtro-aviso-incompleta` · «Aplicar sin eso…» · `buscador-filtros-vistas` · «…y no llama a ninguna escritura» |
| R17 | borrar pide confirmación NOMBRANDO la vista | `buscador-filtros-vistas` · bloque «borrar» (2 casos) |
| R18 | aplicar repone las tres piezas | `ordenes-listado-vistas` · «deja el campo, el control montado y su valor» |
| R19 | reemplaza, no acumula | `ordenes-listado-vistas` · «una parte del filtro anterior… DESAPARECE» · `filter-component-siembra` · «REEMPLAZA la selección vigente» |
| R20 | vuelve a la página 1, medido desde la 2 | `ordenes-listado-vistas` · «medido desde la página 2» |
| R21 | retira los params propios y no añade ninguno | `ordenes-listado-vistas` · «saca los suyos, no añade ninguno y respeta los ajenos» |
| R22 | tocar el filtro deja de presentarla como puesta | `ordenes-listado-vistas` · «la marca vive mientras… y se apaga al primer cambio» |
| R23 | aplicar cierra la siembra de la URL | `filter-component-siembra` · «un catálogo que llega DESPUÉS no repone» + su CONTRASTE |
| R25 | no se aplica nada y lo perdido se enumera sin ids | `vistas-filtro-aviso-incompleta` · 2 casos |
| R26 | exactamente dos salidas | `vistas-filtro-aviso-incompleta` · «ofrece EXACTAMENTE dos salidas» |
| R27 | «Aplicar sin eso» aplica solo lo aplicable | `vistas-filtro-aviso-incompleta` · «aplica SOLO lo aplicable» |
| R28 | la vista queda marcada incompleta, con su motivo | `vistas-filtro-aviso-incompleta` · 2 casos (la marca y su ausencia) |
| R29 | catálogo no disponible: ni clasificar ni aplicar, y se dice | `ordenes-listado-vistas` · 2 casos (geográfico caído / estados vacío) · `buscador-filtros-vistas` · R29 |
| R30 | nunca aplicar parte sin nombrarlo antes | `vistas-filtro-aviso-incompleta` · «NO cambia ni una parte del filtro vigente» |
| R31 | sin la prop, la barra no cambia en nada | `buscador-filtros-vistas` · R31 · `buscador-filtros-siembra` · R31 · `filter-component-siembra` · R31 · la guardia (comportamiento) |
| R32 | encender una superficie no pide migración | `vistas-superficies-declaradas.guardia` (la lista es un `as const`) |
| R34 | superficie declarada = superficie montada | `vistas-superficies-declaradas.guardia` · dirección A |
| R36 | sitio fijo en la barra | `buscador-filtros-vistas` · 2 casos (antes del campo; no se mueve con «Limpiar todo») |
| R37 | todo se alcanza sin salir del listado | `ordenes-listado-vistas` · 2 casos |
| R38 | sin vistas se ofrece guardar y no es un error | `buscador-filtros-vistas` · R38 |
| R39 | sin jerga en los textos visibles | `buscador-filtros-vistas` · R39 |
| P1 | el orden no entra en la vista | `ordenes-listado-vistas` · «aplicar una vista no reordena la tabla» |

## Las mutaciones que se corrieron antes de creerse el verde

| Mutación | Resultado |
| --- | --- |
| **el control montado SIEMPRE** (default encendido en la barra) | **3 rojos** en 2 archivos: los dos de la guardia (la barra pelada y la barra REAL de `/novedades`) y el R31 del control |
| **otra pantalla enciende la prop** (`vistas={{…}}` en `NovedadesFiltrosBarra`) | **2 rojos**: el censo literal de archivos y la barra real de `/novedades` |
| **superficie declarada y no montada** (`"cierres-bodega"` en `SUPERFICIES_VISTA`) | **1 rojo**: dirección A de la guardia (R34) |
| `emitido.current` no se pone al día en la siembra | **1 rojo**: «vaciar el campo después de sembrar SÍ avisa» |
| no cerrar la siembra de la URL (`siembraCerradaRef`) | **1 rojo**: R23, el catálogo tardío repone |
| quitar el rekey de los controles no controlados | **2 rojos**: el `dateRange` y el `text` dejan de mostrar lo sembrado |
| una siembra que SÍ emite (montaje sembrado) | **1 rojo** en T3.2 y **1 rojo** en R22 — este último solo después de endurecer el caso |
| aplicar acumula en vez de reemplazar | **1 rojo**: R19 |
| no retirar los params al aplicar | **1 rojo**: R21 |
| clasificar con el catálogo caído | **1 rojo**: R29 con el catálogo de ESTADOS vacío |

Dos hallazgos de la batería, y los dos cambiaron algo:

1. **El caso de R22 estaba flojo y se arregló.** `findByText` resuelve en cuanto encuentra, así que
   una emisión tardía —la que produciría una siembra que sí emitiera— apagaba la marca medio segundo
   después y el caso seguía verde. Ahora se espera 700 ms (más que el debounce de 500) antes de
   mirar.
2. **El par de R29 no es redundante.** Con el catálogo geográfico en `null`, clasificar a la fuerza
   NO pone rojo nada: el módulo de aplicabilidad lo frena igual por su segundo cierre (filtros
   `disabled`). El caso que sí muere es el del **catálogo de estados vacío**, que solo protege la
   pantalla. Sin él, esa mitad de R29 no la afirmaría nadie.

## T5.2 — visto en el navegador (2026-09-21)

`rm -rf .next`, cero procesos `node` vivos antes de arrancar, un solo `pnpm dev` con la salida a
`progress/dev_453_frontend.log`, y sesión como `admin.qa@ordenex.test` (rol `admin`, acceso total).
Se rotó `QA_PASSWORD` en la base **local** para poder entrar.

> ⚠️ El aviso «Confirmá el SINPE de GAM» (ficha 429) sale en TODAS las pantallas de este rol y su
> fondo tapa la barra entera: hay que despacharlo con «Ahora no» antes de poder tocar nada. No es de
> esta ficha, pero cuesta una vuelta a quien venga detrás.

Las cinco acciones, con **la respuesta de la Server Action capturada** (no el toast a los 20 s):

| Acción | Lo que se vio |
| --- | --- |
| El control | `PRIMER CONTROL DE LA FILA: Vistas` — el disparador abre la fila, antes de los conmutadores de orden, de los filtros y del campo. |
| Panel vacío | «Todavía no has guardado ninguna vista en esta pantalla.» + «Guardar filtros actuales…», sin error. |
| **Guardar** «San José arriba» (término `guia` + 13 zonas + 494 distritos) | `{"status":"ok","vista":{"id":"00993572-…","nombre":"San José arriba","superficie":"ordenes","filtro":{"v":1,"termino":"guia",…` · toast «Vista «San José arriba» guardada.» |
| **Limpiar** | el campo queda en `""` y la barra sin controles. |
| **Aplicar** | campo `guia`; fila: `Vistas | Zona: 13 seleccionados | Distrito: 494 seleccionados | Filtros (2) | Limpiar todo`; URL `…/ordenes` (sin un solo param); el panel dice «Puesta ahora». |
| **Renombrar** a «San José abajo» | `{"status":"ok","vista":{…,"nombre":"San José abajo",…}}` |
| **Borrar** | la confirmación dice «Se va a borrar «San José abajo». No hay forma de recuperarla.» → `{"status":"ok"}` y el panel vuelve a estar vacío. |

En el log del servidor, las llamadas salen nombradas
(`ƒ guardarVistaFiltro(...)`, `ƒ eliminarVistaFiltro(...)`, todas `200`). Los dos `Error: aborted`
(`ECONNRESET`) del log ocurren en la navegación `/dashboard → /ordenes` y aparecen igual en la sonda
de diagnóstico previa: **no son de esta ficha**.

## `./init.sh` COMPLETO (`progress/gate_453_frontend.log`)

```
 Test Files  2070 passed (2070)
      Tests  30144 passed | 26 skipped (30170)
   Duration  655.37s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 2070 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

- **26 `skipped`**, la referencia exacta: 17 de `tests/components/AnaliticaPage.test.tsx` y 9 de
  `tests/components/AnaliticaShell.test.tsx`. **Ninguno de `integration/db`**, y el propio gate lo
  dice antes de arrancar: «✓ DATABASE_URL resuelta: los 199 archivos de tests contra Postgres SI se
  ejecutan». Sin eso, el verde de la capa de datos no valdría nada.
- Seis archivos y 62 casos más que la corrida del backend (2064 → 2070, 30082 → 30144).
- El aviso de «migraciones sin down.sql» es de tres migraciones de agosto ajenas a esta ficha.

## Veredicto

Frontend de la 453 completo: la costura que faltaba desde la 328, el control en la barra
compartida, el aviso que convierte la pérdida en reconocida en vez de anunciada, `/ordenes`
encendida y recorrida en el navegador, y una red en las dos direcciones para que encender esto en
las otras once pantallas no pueda pasar en silencio. `./init.sh` completo en **`INIT_EXIT=0`**.
