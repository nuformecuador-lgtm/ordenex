# Ficha 453 — Tareas

Zona `fullstack`: se secuencia **backend → frontend**. `[P]` = puede ir en paralelo con las de su
**misma tanda**. Cada task trae su criterio de *hecho*; sin él no está hecha.

> ⚠️ **El gate de esta ficha es `./init.sh` COMPLETO.** El diff toca `db/schema.prisma`,
> `db/migrations/**` y `lib/types/**`, así que `--rapido` **se niega solo**
> (`docs/verification.md`). No se pierda tiempo intentándolo.

> ⚠️ **No se escribe en `feature_list.json` desde dentro de la rama de la ficha.** El estado lo mueve
> el leader en `dev`.

---

## Tanda 0 — Pre-vuelo

- [x] **T0.1 — Punto de partida medido.** Anotar en `progress/impl_453.md` el SHA de `origin/dev`
  del que sale la rama y si el árbol tiene `DATABASE_URL` resoluble.
  *Hecho:* el archivo existe con el SHA y con el número de archivos de test contra Postgres que el
  gate dice que se van a **saltar** si no hay base. Sin eso, un verde de la capa de datos no
  significa nada.

---

## Tanda 1 — El lugar de la vista (backend · datos)

- [x] **T1.1 — Tipos y formato, en un módulo PURO.** `lib/types/vista-filtro.ts` (design §3.1, §4):
  `SUPERFICIES_VISTA` (`as const`, con `"ordenes"` de único miembro), `SuperficieVista`,
  `VISTA_FILTRO_VERSION`, `vistaFiltroPayloadSchema` (`.strict()`), `MAX_VISTAS_POR_SUPERFICIE = 20`,
  `NOMBRE_VISTA_MAX = 60`. Sin React, sin Prisma, sin `next/`.
  *Hecho:* `tests/unit/utils/vista-filtro-payload.test.ts` en verde: un payload válido parsea; uno con
  clave de más **falla** (`.strict()`); `v` distinto de 1 **falla**; una `seleccion` con un valor que
  no es `string[]` **falla**. `pnpm run typecheck` verde.

- [x] **T1.2 — Modelo en `db/schema.prisma`.** Añadir `VistaFiltro` (design §3.1) y la relación
  `vistasFiltro` en `Usuario`, con el comentario `///` que diga **por qué es tabla nueva y no cabe en
  `usuario_preferencia`** (grano distinto: N filas por persona, no 1:1) y **por qué `superficie` es
  TEXT y no enum**. Depende de T1.1.
  *Hecho:* `prisma generate` + `pnpm run typecheck` en verde, y `prisma migrate diff` no reporta más
  deriva que la migración de T1.3.

- [x] **T1.3 — Migración + `down.sql`.** `db/migrations/20260921120000_vista_filtro/` (design §3.3):
  `CREATE TABLE`, FK CASCADE, índice **único** `(usuario_id, superficie, nombre)` con el nombre que
  Prisma espera, y `ENABLE ROW LEVEL SECURITY`. **Sin backfill** (no hay nada que migrar) y **sin
  enum**. `down.sql` = `DROP TABLE IF EXISTS`, escribiendo en voz alta **qué se pierde**. Depende de
  T1.2.
  *Hecho:* `pnpm run db:migrate` aplica; `pnpm run db:rollback` revierte; volver a aplicar deja la
  base igual. En el `migration.sql` queda escrito que **no se toca ningún `down.sql` anterior** —son
  fotos de su rama— y que la lección del enum recreado-con-lista **no aplica** porque aquí no hay
  ningún tipo.

- [x] **T1.4 — Test de integración de la migración.** `tests/integration/db/vista-filtro-migration.test.ts`,
  molde de `usuario-preferencia-migration.test.ts`: las dos mitades (lo que se lee del `.sql` y lo que
  **solo** sabe el motor). Depende de T1.3.
  *Hecho:* con `DATABASE_URL` los casos **se ejecutan** (no `skipped`): la tabla existe con su forma,
  el único índice está y es único, `relrowsecurity` es `true`, borrar un usuario borra sus vistas, y
  dos usuarios distintos pueden guardar el **mismo nombre** en la misma superficie. El archivo empieza
  por su **autocomprobación** (si el `.sql` no se leyera, todo quedaría verde y mudo). Cubre R1, R4,
  R11, R35 y la RLS.

- [x] **T1.5 [P] — Repositorio e interfaz.** `lib/interfaces/repositories/IVistaFiltroRepository.ts`
  + `lib/repositories/VistaFiltroRepository.ts` (design §6). **`usuarioId` en TODAS las firmas**,
  incluidas las que ya llevan `id`. Depende de T1.3.
  *Hecho:* `tests/integration/db/vista-filtro.test.ts` **contra Postgres real** —el `WHERE` se prueba
  donde vive— demuestra: listar devuelve solo las del dueño y ordenadas por nombre; `renombrar`,
  `actualizarFiltro` y `eliminar` con el `id` de otro **no tocan nada y devuelven 0 filas**; el nombre
  duplicado revienta por el índice y no por una comprobación de código.
  **Antes de creerse el verde, matar el test con una mutación**: quitar `usuarioId` del `WHERE` de
  `eliminar` tiene que ponerlo rojo.

---

## Tanda 2 — Reglas y borde (backend). Depende de T1.5

- [x] **T2.1 — `VistaFiltroService`.** `lib/services/VistaFiltroService.ts`: propiedad, tope, nombre
  (no vacío tras recortar, máximo, duplicado), «no hay nada que guardar», y la **lectura defensiva**
  del payload (una fila que no parsea sale con `filtro: null`, nunca a medias). Repositorio inyectado
  por constructor.
  *Hecho:* `tests/unit/services/vista-filtro-service.test.ts` con doble de repositorio cubre R2, R8,
  R9, R10, R11, R12, R13, R15 y R16 (*actualizar* escribe; *aplicar* no existe aquí: el servicio no
  tiene ninguna operación de aplicar, y eso es lo que hace que aplicar no pueda escribir).

- [x] **T2.2 — Las cinco Server Actions.** `lib/actions/vistas-filtro.ts` (design §5), patrón exacto
  de `lib/actions/push.ts`: actor de la sesión, zod `.strict()`, `withErrorHandler` +
  `toActionError`, `deps` inyectables. Depende de T2.1.
  *Hecho:* `tests/unit/actions/vistas-filtro-action.test.ts`: sin sesión → error de autenticación y
  **cero escrituras** (R3); un `usuarioId` inyectado en la entrada → `validation_error`, **no** se
  ignora (R3); una `superficie` no declarada → `validation_error`, **no** lista vacía (R33); el `id`
  de una vista ajena → `not_found`, **no** `forbidden` (R2).

---

## Tanda 3 — La costura en los componentes compartidos (frontend). Depende de T2.2

> Es la pieza que esta ficha **arrastra de la 328** (hueco 1). Va sola en su tanda porque toca dos
> componentes que montan 16 consumidores: cualquier regresión aquí sale en 12 pantallas.

- [x] **T3.1 — `siembra` en `BuscadorFiltros`** (design §7). Prop opcional
  `{ senal: number; termino: string }`; patrón «ajustar estado durante el render»; **sin remontar** y
  poniendo al día `emitido.current`; **cierra la siembra de la URL** (`sembrado.current = true`).
  *Hecho:* `tests/unit/components/buscador-filtros-siembra.test.tsx`: cambiar `senal` cambia el texto
  del campo; **el campo NO se remonta** (conserva el foco — es la queja exacta de la 328); sembrar
  `""` vacía el campo desde fuera; sembrar y **después teclear** emite el término nuevo (o sea, la
  guarda de «sin cambio» no se quedó desalineada); **sin la prop, el componente se comporta
  exactamente como antes** y los tests existentes de `BuscadorFiltros` siguen en verde.

- [x] **T3.2 — `siembra` en `FilterComponent`** (design §7). Prop opcional
  `{ senal: number; seleccion: FilterSelection }`; reemplaza la selección, **no emite**, llama a
  `cerrarSiembra()`, y **rekeya los controles no controlados** (`` `${filtro.key}:${senal}` ``) para
  que `TextFilter` y `DateRangeFilter` muestren el valor sembrado. Depende de T3.1 solo por orden de
  revisión; técnicamente `[P]`.
  *Hecho:* `tests/unit/components/filter-component-siembra.test.tsx`: una siembra con un `multi` y un
  `dateRange` deja **los dos controles mostrando** lo sembrado; no se emite `onChange` por la siembra;
  un catálogo que llega **después** de la siembra **no repone** el valor de la URL (R23 — este caso es
  el que evita el fallo mudo, y hay que escribirlo explícitamente); sin la prop, nada cambia.

---

## Tanda 4 — Aplicabilidad y el control. Depende de T3.2

- [x] **T4.1 [P] — Aplicabilidad, módulo puro.** `lib/utils/vista-filtro-aplicabilidad.ts` (design
  §8.1): `(filtros: FilterDef[], payload) => { aplicables, perdidas }`, con la etiqueta visible de
  cada parte perdida.
  *Hecho:* `tests/unit/utils/vista-filtro-aplicabilidad.test.ts` cubre las cinco filas de la tabla de
  §8.1 + la clave que la pantalla ya no declara; y afirma que **`boolean` y `text` nunca se pierden**.
  Ninguna parte perdida sale con un id crudo.

- [x] **T4.2 — El control `VistasFiltro` dentro de `BuscadorFiltros`** (design §9). Prop `vistas` en
  la barra; **ausente, no se monta nada**. Disparador al principio de la fila, `Popover` con la lista
  (aplicar / renombrar / borrar) + «Guardar filtros actuales…» + «Guardar cambios en esta vista». El
  nombre y las confirmaciones, en `Modal`. Depende de T4.1.
  *Hecho:* `tests/unit/components/buscador-filtros-vistas.test.tsx`: sin la prop, la barra renderiza
  **exactamente** lo de hoy (R31); con ella, el disparador está **antes** del campo y de los
  `children`, y **no se mueve** al aparecer «Limpiar todo» (R36); sin vistas guardadas se ofrece
  guardar y no se pinta un error (R38); borrar pide confirmación **nombrando la vista** (R17);
  renombrar aplica las mismas reglas de nombre (R14); ningún texto visible dice «selección»,
  «payload», «clave» ni «superficie» (R39).

- [x] **T4.3 — El aviso de la vista incompleta.** El `Modal` de §8.2: enumera lo perdido con nombre
  visible y motivo, y ofrece **exactamente dos** salidas. Depende de T4.1.
  *Hecho:* `tests/unit/components/vistas-filtro-aviso-incompleta.test.tsx`: al elegir una vista con
  partes perdidas **no cambia ni una parte del filtro vigente** antes de la decisión (R25/R30 — se
  afirma sobre el filtro emitido, no sobre el aviso); hay dos botones y solo dos (R26); «Aplicar sin
  eso» aplica **solo** lo aplicable y **no llama a ninguna acción de escritura** (R27/R16); «Cancelar»
  deja el filtro intacto; la vista aparece marcada **incompleta** en la lista con su motivo (R28).

---

## Tanda 5 — Encender `/ordenes`. Depende de T4.3

- [x] **T5.1 — Cablear `OrdenesListado`.** Declarar la superficie `"ordenes"`; capturar el filtro
  (los tres estados: `terminoBuscador`, `filtrosActivos`, `seleccionFiltros`); aplicar una vista
  reemplazando los tres y subiendo la `senal` de las dos siembras; **retirar de la URL los params
  propios** al aplicar, con `borrarParams` (que solo resta); marcar «ya no es esa vista» al primer
  cambio posterior; y **no clasificar ni aplicar** mientras `catalogoFiltros === null` o el catálogo
  de estados esté vacío.
  *Hecho:* `tests/unit/components/ordenes-listado-vistas.test.tsx`: aplicar una vista deja el campo,
  los controles montados y la selección **exactamente** como se guardaron (R18); una parte del filtro
  anterior que la vista no trae **desaparece** (R19); la tabla vuelve a la **página 1** —medido
  **desde la página 2**, o el reset es invisible porque React se ahorra el render— (R20); los params
  propios de la barra salen de la URL y no entra ninguno nuevo (R21); tocar un filtro después deja de
  presentarla como puesta (R22); con `catalogoFiltros = null` no se clasifica, no se aplica y se dice
  (R29).

- [x] **T5.2 — Verlo en el navegador.** `rm -rf .next`, comprobar que **no hay otro dev server vivo**
  (`Get-Process node`), entrar a `/ordenes` como maestro y recorrer: guardar «San José arriba» con
  zona + distritos + término, limpiar, aplicar la vista, renombrarla, borrarla. Depende de T5.1.
  *Hecho:* captura o transcripción en `progress/impl_453.md` de las cinco acciones, **con la respuesta
  de la Server Action capturada** (no el toast a los 20 s), y cero errores en consola del servidor.

---

## Tanda 6 — Guardias, trazabilidad y gate. Depende de T5.2

- [x] **T6.1 [P] — Guardia de superficies montadas.**
  `tests/unit/guards/vistas-superficies-declaradas.guardia.test.tsx` (R34): toda superficie de
  `SUPERFICIES_VISTA` tiene un control montado en el árbol de producción.
  *Hecho:* la guardia **se auto-comprueba** (detecta una superficie inventada como no montada, y
  reconoce `"ordenes"` como montada) y se selecciona sola con `pnpm exec vitest run guard`.
  *Estado real (2026-09-21):* hecha, y **creció en la dirección contraria**: además de R34 lleva la
  red de R31 —la barra sin la prop, y una barra REAL de otra pantalla (`/novedades`), no pintan
  ningún control ni piden ninguna lista—, que es la mitad que se pondría roja si alguien encendiera
  las vistas en global. Es `.tsx` porque esa mitad renderiza.

- [x] **T6.2 [P] — Guardia de formato propio.**
  `tests/unit/guards/vista-filtro-formato-propio.guardia.test.ts` (R6): ningún módulo de persistencia
  de vistas importa `app/(app)/ordenes/_components/serializar-filtro`, y el payload no se usa como key
  de SWR.
  *Hecho:* se pone roja si se añade ese import; con su autocomprobación (encuentra el import en un
  fixture conocido).

- [x] **T6.3 — Mapa `R<n> → test` en `progress/impl_453.md`.** La tabla de abajo, ya rellena con la
  salida **real** de cada archivo. Depende de T6.2.
  *Hecho:* los 39 requisitos tienen su archivo y su caso, y la salida pegada es la de la corrida, no
  un resumen escrito a mano.

- [x] **T6.4 — `./init.sh` completo, en verde según el baseline.** Depende de T6.3.
  *Hecho:* `INIT_EXIT=0` **escrito dentro del log**; ningún archivo rojo que no estuviera ya en
  `tests/baseline-rojos.json`; y si alguno del baseline volvió a verde, **podado en este mismo PR**.
  Revisar los `skipped`: sin `DATABASE_URL` la capa de datos **no se ejecuta**, y el verde no valdría.
  *Estado real (2026-09-21):* **tres** corridas completas, una por entrega —
  `progress/gate_453_backend.log`, `progress/gate_453_frontend.log` y `progress/gate_453_c.log` (la
  de la revisión)—, las tres en `INIT_EXIT=0` y las tres con **26 `skipped`**: 17 de `AnaliticaPage`
  y 9 de `AnaliticaShell`, **ninguno de `integration/db`**.

- [x] **T6.5 — Commitear el informe.** El informe describe el disco, no un commit.
  *Hecho:* `progress/impl_453.md` y los logs del gate (`gate_453_backend.log`,
  `gate_453_frontend.log`, `gate_453_c.log`) **commiteados** en la rama, verificado
  contra el blob (no contra el árbol de trabajo).

---

## Mapa de trazabilidad `R<n> → test`

| R | Qué afirma | Archivo de test |
| --- | --- | --- |
| R1 | la vista se compone de superficie+nombre+dueño+filtro | `tests/integration/db/vista-filtro-migration.test.ts` |
| R2 | nadie ve ni toca las vistas de otro (en el `WHERE`) | `tests/integration/db/vista-filtro.test.ts` · `tests/unit/actions/vistas-filtro-action.test.ts` |
| R3 | el dueño sale de la sesión; inyectarlo es `validation_error` | `tests/unit/actions/vistas-filtro-action.test.ts` |
| R4 | borrar la persona borra sus vistas (CASCADE) | `tests/integration/db/vista-filtro-migration.test.ts` |
| R5 | se guardan las **tres** piezas de la barra | `tests/unit/utils/vista-filtro-payload.test.ts` |
| R6 | formato propio, separado de la clave de caché | `tests/unit/guards/vista-filtro-formato-propio.guardia.test.ts` |
| R7 | versión del formato | `tests/unit/utils/vista-filtro-payload.test.ts` |
| R8 | payload ilegible: no se aplica, sí se renombra/borra | `tests/unit/utils/vista-filtro-payload.test.ts` · `tests/unit/services/vista-filtro-service.test.ts` |
| R9 | nombre obligatorio | `tests/unit/services/vista-filtro-service.test.ts` |
| R10 | máximo de longitud, dicho | `tests/unit/services/vista-filtro-service.test.ts` |
| R11 | duplicado rechazado, no sobrescribe | `tests/unit/services/vista-filtro-service.test.ts` · `tests/integration/db/vista-filtro.test.ts` |
| R12 | no se guarda una vista vacía | `tests/unit/services/vista-filtro-service.test.ts` |
| R13 | tope por superficie, con su número | `tests/unit/services/vista-filtro-service.test.ts` |
| R14 | renombrar y borrar, con las reglas de nombre | `tests/unit/components/buscador-filtros-vistas.test.tsx` · `tests/unit/services/vista-filtro-service.test.ts` |
| R15 | actualizar reemplaza el filtro y conserva el nombre | `tests/unit/services/vista-filtro-service.test.ts` |
| R16 | aplicar no escribe nada | `tests/unit/components/vistas-filtro-aviso-incompleta.test.tsx` |
| R17 | borrar pide confirmación nombrando la vista | `tests/unit/components/buscador-filtros-vistas.test.tsx` |
| R18 | aplicar entera repone las tres piezas | `tests/unit/components/ordenes-listado-vistas.test.tsx` |
| R19 | aplicar **reemplaza**, no acumula | `tests/unit/components/ordenes-listado-vistas.test.tsx` |
| R20 | vuelve a la página 1 (medido desde la 2) | `tests/unit/components/ordenes-listado-vistas.test.tsx` |
| R21 | retira los params propios de la URL y no añade | `tests/unit/components/ordenes-listado-vistas.test.tsx` |
| R22 | tocar el filtro deja de presentar la vista como puesta | `tests/unit/components/ordenes-listado-vistas.test.tsx` |
| R23 | aplicar cierra la siembra de la URL | `tests/unit/components/filter-component-siembra.test.tsx` |
| R24 | definición de «aplicable entera» | `tests/unit/utils/vista-filtro-aplicabilidad.test.ts` |
| R25 | con partes perdidas no se aplica nada y se enumeran | `tests/unit/components/vistas-filtro-aviso-incompleta.test.tsx` |
| R26 | exactamente dos salidas | `tests/unit/components/vistas-filtro-aviso-incompleta.test.tsx` |
| R27 | «Aplicar sin eso» aplica solo lo aplicable | `tests/unit/components/vistas-filtro-aviso-incompleta.test.tsx` |
| R28 | la vista queda marcada incompleta | `tests/unit/components/vistas-filtro-aviso-incompleta.test.tsx` |
| R29 | catálogo no disponible: ni clasificar ni aplicar | `tests/unit/components/ordenes-listado-vistas.test.tsx` |
| R30 | nunca aplicar parte sin nombrarlo antes | `tests/unit/components/vistas-filtro-aviso-incompleta.test.tsx` |
| R31 | sin la prop, la barra no cambia en nada | `tests/unit/components/buscador-filtros-vistas.test.tsx` · `tests/unit/components/buscador-filtros-siembra.test.tsx` |
| R32 | encender una superficie no pide migración: `superficie` es TEXT en el motor, sin CHECK, y la base acepta una superficie no declarada (la única fuente es `SUPERFICIES_VISTA`) | `tests/integration/db/vista-filtro-migration.test.ts` · los dos bloques «453/R32» |
| R33 | superficie no declarada → error, no lista vacía | `tests/unit/actions/vistas-filtro-action.test.ts` |
| R34 | superficie declarada = superficie montada | `tests/unit/guards/vistas-superficies-declaradas.guardia.test.tsx` |
| R35 | dos personas, el mismo nombre | `tests/integration/db/vista-filtro-migration.test.ts` |
| R36 | sitio fijo en la barra | `tests/unit/components/buscador-filtros-vistas.test.tsx` |
| R37 | todo se alcanza sin salir del listado | `tests/unit/components/ordenes-listado-vistas.test.tsx` |
| R38 | sin vistas, se ofrece guardar y no es un error | `tests/unit/components/buscador-filtros-vistas.test.tsx` |
| R39 | sin jerga técnica en los textos visibles | `tests/unit/components/buscador-filtros-vistas.test.tsx` |

## Dependencias, de un vistazo

```
T0.1
 └─ T1.1 → T1.2 → T1.3 → T1.4
                    └─ T1.5 [P con T1.4]
                         └─ T2.1 → T2.2
                                    └─ T3.1 → T3.2
                                               └─ T4.1 [P] ─┬→ T4.2
                                                            └→ T4.3
                                                                 └─ T5.1 → T5.2
                                                                             └─ T6.1 [P] ─┐
                                                                                T6.2 [P] ─┴→ T6.3 → T6.4 → T6.5
```
