# Feature 400 — bitácora FRONTEND (fase 3)

> Rama `feat/400-fallo-config-no-bloquea-asignacion`, sobre `b31ff729` (backend) y `fd13f76c`
> (spec + fotografía de producción). Alcance: **solo la capa de presentación**.
> Tareas: **T13, T13b, T14, T15, T16, T16b, T17** → requisitos **R19-R25, R34, R36** y la mitad
> de DOM de **R31-R33/R35**. No se tocó backend, base de datos ni rutas de API.

---

## Lo primero: el aviso del backend, comprobado y cerrado

El backend dejó escrito: *«`geocodificacion-motivo-messages.ts` sigue con `Map<string, string>` y
compila igual con el estado nuevo en la unión. El árbol verde NO significa que T13 esté hecho.»*

Confirmado y **medido**, no razonado. El mapa está ahora tipado como
`Record<EstadoBloqueante, string>`, y la exhaustividad se comprobó con dos mutaciones
(M2 y M3, abajo): con el tipo puesto, borrar una entrada o añadir un estado a la unión es
`error TS2741`; con `Record<string, string>`, lo mismo pasa **en verde**.

Y ahí apareció un hallazgo que no estaba en el spec: **la mutación M3b sobrevivió**. Quitar la
anotación de tipo no rompe nada observable en runtime, porque una anotación no se puede observar
en runtime. R25 quedaba colgando de que nadie la borrara. Se cerró con un guardia que **lee el
árbol real** (patrón del guard de la 368), y con él M3b muere. Detalle en «Mutaciones».

### Verificación en el árbol real (regla 7 de `CLAUDE.md`)
El MCP `codebase-memory` **sí** estaba disponible y se usó para localizar consumidores; pero todo
lo que se afirma aquí se confirmó **abriendo el archivo**:

| Punto | Estado real |
| --- | --- |
| `MOTIVO_A_MENSAJE` era `new Map<string, string>` con dos arrays de literales | ✅ tal cual lo describía el spec (`:33-40`) |
| `EstadoBloqueante` exportado y listo en `IAsignabilidadCoordenadasService.ts:56` | ✅ existe, derivado por `Exclude` |
| `sinUbicacion?: number` en los cuatro tipos | ✅ los cuatro (`IGuiaAsignacionService`, `IAsignacionSateliteService`, `lib/types/orden-guia.ts`, `lib/types/recepcion-satelite.ts`) |
| Los dos modales construyen a mano el `mensaje` del toast Y del `<ManifiestoResultado>` | ✅ la MISMA cadena sirve para los dos |
| Guard de la 368 con su lista de cinco literales | ✅ existía, se extendió |

**Ninguna corrección del spec fue necesaria.**

---

## El texto, exacto

| Constante / función | Texto | Requisito |
| --- | --- | --- |
| `MSG_DIRECCION_NO_ENCONTRADA` | «Dirección no encontrada» | **sin cambios** (R20) |
| `MSG_UBICACION_NO_VERIFICADA` | «No se pudo verificar la ubicación por un fallo del servicio de mapas. La dirección no es el problema; vuelve a intentarlo más tarde.» | **NUEVO** (R19) |
| `MSG_DIRECCION_EN_VALIDACION` | «La dirección aún se está validando. Vuelve a intentarlo en unos minutos.» | **sin cambios** (R21) |
| `mensajeAsignadasSinUbicacion(1)` | «1 orden se asignó sin ubicación en el mapa por un problema del sistema, no de la dirección. Se ubicará más tarde.» | **NUEVO** (R31/R36) |
| `mensajeAsignadasSinUbicacion(n>1)` | «{n} órdenes se asignaron sin ubicación en el mapa por un problema del sistema, no de la dirección. Se ubicarán más tarde.» | **NUEVO** (R31/R36) |
| `mensajeAsignadasSinUbicacion(n<=0)` | `""` — sin aviso | R33 |

Los dos textos nuevos son los de `design.md` §6.2 y §6.5-b, **sin cambiarles una coma**. Ninguno
contiene «geocodificación», «config_invalida», «API» ni «REQUEST_DENIED» (comprobado
case-insensitive, R36); los del mapa no llevan dígitos ni `@` (R24); el aviso solo recibe un
`number`, así que por ese canal no puede viajar ninguna guía, id ni dirección (R32).

**Precedencia (R22)**, tabla ordenada y no escalera de `if`:
`direccion_no_geocodificable` **>** `geocodificacion_agotada` **>** los tres transitorios.

---

## Archivos

### Modificados (código)
- `app/(app)/_components/geocodificacion-motivo-messages.ts` — mapa `Record<EstadoBloqueante,
  string>`, `MOTIVOS_BLOQUEANTES`, `MSG_UBICACION_NO_VERIFICADA`, precedencia de tres clases,
  `mensajeAsignadasSinUbicacion`, cabecera reescrita (T13, T13b, T14, T23)
- `app/(app)/ordenes/_components/AsignarBodegaModal.tsx` — el `mensaje` de `handleConfirm`
  concatena el aviso cuando `result.sinUbicacion` está presente (T16b)
- `app/(app)/recepcion-satelite/_components/AsignarSateliteModal.tsx` — espejo exacto (T16b)

**Cero bloques de UI nuevos.** Ni un segundo `role="status"`, ni un `role="alert"` extra, ni
navegación: el aviso viaja dentro del `mensaje` que el modal ya muestra en el toast y en el
`<ManifiestoResultado>` — que es literalmente «el mismo lugar donde hoy ve la confirmación» (R34).
Y como la lista de `bloqueadas` sigue siendo su propio `<ul role="alert">`, R35 se cumple por
construcción: nunca comparten contenedor.

### Modificados (tests)
- `tests/unit/components/geocodificacion-motivo-messages.test.ts` (T15, T13b) — reescrito
- `tests/unit/components/guia-decision-error-messages.test.ts` (T16b) — los DOS mappers
- `tests/unit/utils/guia-decision-error-message.test.ts` (T16b)
- `tests/unit/guards/geocodificacion-motivo-por-orden-mismo-modulo.guardia.test.ts` (T16a) —
  la lista prohibida pasa de 5 motivos a los 7 de la unión, y **guardia nuevo** del tipado
- `tests/components/AsignarBodegaModal.test.tsx` (T16b) — bloque `400/R31-R36` + caso R19
- `tests/components/AsignarSateliteModal.test.tsx` (T16b) — espejo
- `tests/components/RutearSateliteModal.test.tsx` (T16) — hereda el mensaje nuevo

### T16 — los SEIS consumidores, revisados uno a uno
| Consumidor | Recibe el cambio por | ¿Tocó código? |
| --- | --- | --- |
| `GenerarGuiaModal` | `guiaDecisionErrorMessage` | no — hereda |
| `AsignarRecoleccionModal` | `guiaDecisionErrorMessage` | no — hereda |
| `RutearSateliteModal` | `guiaDecisionErrorMessage` | no — hereda (su test sí se actualizó) |
| `QuitarRecoleccionModal` | `guiaDecisionErrorMessage` | no — hereda |
| `AsignarBodegaModal` | `guiaDecisionErrorMessage` + `mensajeDireccionPorMotivo` | sí, **solo** por T16b (el aviso) |
| `AsignarSateliteModal` | `asignacionSateliteErrorMessage` + `mensajeDireccionPorMotivo` | sí, **solo** por T16b (el aviso) |

Ninguno declara su propio mapa `motivo → mensaje` ni cita un literal de motivo (R23): lo verifica
el guardia leyendo el árbol real, ahora sobre la unión completa.

### Aserciones de literales viejos, decididas una a una (criterio de T4, aplicado aquí)
| Aserción | Decisión |
| --- | --- |
| `MOTIVOS_DIRECCION_NO_ENCONTRADA` / `MOTIVOS_DIRECCION_EN_VALIDACION` (dos arrays exportados) | **Se retiran.** Eran la implementación de la clasificación, no el contrato; el contrato pasa a ser `MOTIVOS_BLOQUEANTES` (una lista) más el tipo. El test que los usaba (`guia-decision-error-messages`) se reescribió con los literales a mano. |
| «los 5 motivos se reparten en exactamente **2** mensajes» | **Se actualiza a 3**, a mano y a propósito: ESA aserción afirmaba justamente lo que la ficha viene a deshacer. |
| `geocodificacion_agotada → "Dirección no encontrada"` en `AsignarSateliteModal.test` y `RutearSateliteModal.test` | **Se actualiza al literal nuevo**, escrito a mano. Era el contrato de la 93 y cambia por decisión de la 400. |
| `direccion_no_geocodificable → "Dirección no encontrada"` (en los cuatro sitios) | **Se conserva intacta**: R20 dice que no cambia. |

Ninguna aserción se sustituyó por «comparar contra la constante que la genera». Todos los
literales de los tests están escritos a mano; donde además se afirma la constante, es **después**
de haber afirmado el literal.

---

## Mapa R → test (los que cubre el frontend)

| R | Test |
| --- | --- |
| R19 | `tests/unit/components/geocodificacion-motivo-messages.test.ts::400/R19 — geocodificacion_agotada YA NO dice «Dirección no encontrada»` y `::400/R19 — el mensaje nuevo NO pide corregir la dirección`; + `guia-decision-error-messages.test.ts::400/R19/R23 (por los DOS mappers)`; + `guia-decision-error-message.test.ts::400/R19`; + `AsignarBodegaModal.test.tsx::400/R19: conflict 'geocodificacion_agotada' YA NO culpa a la dirección`; + `AsignarSateliteModal.test.tsx` y `RutearSateliteModal.test.tsx::92/R9 + 400/R19` |
| R20 | `geocodificacion-motivo-messages.test.ts::400/R20` (literal a mano) + `guia-decision-error-messages.test.ts::400/R20 (por los DOS mappers)` + `guia-decision-error-message.test.ts::400/R20` |
| R21 | `geocodificacion-motivo-messages.test.ts::400/R21` (los tres transitorios, parametrizado) + los casos vigentes de los dos mappers, que siguen verdes sin tocarse |
| R22 | `geocodificacion-motivo-messages.test.ts`, describe `400/R22 — precedencia de las TRES clases`: los tres solos, los tres pares (con el orden de llegada invertido en el par crítico) y las tres juntas |
| R23 | `tests/unit/guards/geocodificacion-motivo-por-orden-mismo-modulo.guardia.test.ts` — lista prohibida ampliada a los 7 estados de la unión, con **contraprueba nueva** que caza un modal tratando `asignable_sin_ubicacion` a mano; + los dos mappers en `guia-decision-error-messages.test.ts` |
| R24 | `geocodificacion-motivo-messages.test.ts`, describe `400/R24`: cada uno de los cinco mensajes, sin dígitos, sin `@`, sin la dirección ni el id de prueba |
| R25 | `geocodificacion-motivo-messages.test.ts::400/R25` (las cinco claves **escritas a mano**; cada motivo tiene mensaje; se reparten en tres) + el guardia `400/T13 — el mapa se tipa por EstadoBloqueante` (lee el árbol) + la mutación M2/M3 (`error TS2741`) |
| R10 (mitad UI) | `geocodificacion-motivo-messages.test.ts::400/R10 — asignable_sin_ubicacion no tiene mensaje` (y no está en `MOTIVOS_BLOQUEANTES`) |
| R31 | `AsignarBodegaModal.test.tsx::R31/R34` y `::R31 singular`, + los espejos en `AsignarSateliteModal.test.tsx`; + `geocodificacion-motivo-messages.test.ts::400/R31` (singular, plural, la cifra dentro) |
| R32 | `AsignarBodegaModal.test.tsx::R32: el aviso NO identifica cuál orden…` y su espejo satélite (el bloque de confirmación no contiene ninguna de las 2 guías ni de los 2 ids) + `geocodificacion-motivo-messages.test.ts::R32` |
| R33 | `AsignarBodegaModal.test.tsx::R33` (parametrizado: campo ausente y campo en cero) y su espejo + `geocodificacion-motivo-messages.test.ts::R33` (0, -1, -42 → cadena vacía) |
| R34 | `AsignarBodegaModal.test.tsx::R31/R34` (el aviso está DENTRO del mismo `role="status"` que ya dice «Mensajero asignado a …») y `::R34: no abre ni pantalla ni diálogo nuevo` (sigue habiendo **un** `role="dialog"`), + espejos satélite |
| R35 | `AsignarBodegaModal.test.tsx::R35` y su espejo: la `<ul role="alert">` de bloqueadas contiene la guía y su motivo y **no** el aviso; los dos contenedores son distintos y ninguno contiene al otro (`.contains()` en las dos direcciones); los números no se mezclan |
| R36 | `geocodificacion-motivo-messages.test.ts::R36` (×3 cifras, sin «geocodificación»/«config_invalida»/«API»/«REQUEST_DENIED») + `::R36: y dice que la causa es del SISTEMA, no de la dirección` + `::R36: el mensaje de geocodificacion_agotada tampoco usa jerga interna` |
| R28 | **NO-hacer.** `git diff` del frontend no toca cron, notificador ni reencolado: `git diff -U0 \| grep -iE '^\+.*(cron\|notificad\|reencol)'` → sin líneas |
| R29 | **NO-hacer.** `git diff -U0 \| grep -i 'geocode_precision\|geocodePrecision'` → sin líneas |

Los requisitos **R1-R18, R26, R27, R30** son backend y están en `progress/impl_400_backend.md`.

---

## Verificación

### Gate — `./init.sh` COMPLETO (obligatorio: la rama toca `lib/types/`)
No se intentó el rápido: el diff acumulado de la rama ya obligó al completo en el backend.

```
 Test Files  1832 passed (1832)
      Tests  26460 passed | 26 skipped (26486)
   Duration  661.73s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1832 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

- `typecheck` limpio; `lint` sin hallazgos.
- El aviso de `down.sql` es **preexistente** (tres migraciones de la 265, agosto). Esta fase no
  añade ninguna migración.

### Los `skipped`, mirados de verdad
**26 saltados, exactamente los mismos 26 del backend, y ninguno es mío:**
`tests/components/AnaliticaPage.test.tsx` (17) y `tests/components/AnaliticaShell.test.tsx` (9),
preexistentes y ajenos. **`tests/integration/db/` corrió entera: 224 archivos**, incluido
`backfill-marcador-config-geocode.test.ts (6 tests)`. El `.env` del worktree sigue en su sitio.
Mis siete archivos aparecen todos en verde en el log (12 + 42 + 7 + 21 + 13 + 28 + 33 tests).

### Mutaciones — 8 aplicadas, 7 muertas a la primera, 1 superviviente que obligó a añadir un guardia
Procedimiento: copia de seguridad del archivo → mutación → corrida → restauración **desde la
copia** (nunca `git checkout`, para no arrastrar nada de otra sesión).

| # | Mutación | Resultado |
| --- | --- | --- |
| M1 | El modal de **bodega** deja de concatenar el aviso | **MUERTA** — 5 rojos en `AsignarBodegaModal.test.tsx`; el satélite **queda verde**: la asimetría se distingue, que es lo que pedía `design.md` §9 |
| M1b | Lo mismo en el modal **satélite** | **MUERTA** — 5 rojos, y esta vez el verde es el de bodega |
| M2 | Se borra la entrada `geocodificacion_en_curso` del `Record` | **MUERTA en typecheck** — `error TS2741: Property 'geocodificacion_en_curso' is missing … but required in type 'Record<EstadoBloqueante, string>'` |
| M3 | Se añade un estado nuevo a `EstadoAsignabilidad` sin darle mensaje | **MUERTA en typecheck** — `error TS2741: Property 'estado_inventado_por_la_mutacion' is missing …`. Es la prueba directa de lo que avisó el backend |
| M3b | El mismo estado nuevo, pero con el mapa como `Record<string, string>` | **SUPERVIVIENTE**: typecheck verde y 42/42 tests verdes. La exhaustividad la sostiene una anotación de tipo, y ninguna anotación se observa en runtime. **Cerrada** con el guardia `400/T13` que lee el árbol real; repetida la mutación, ahora da **2 rojos** |
| M4 | `geocodificacion_agotada` vuelve a mapear a «Dirección no encontrada» (el bug original) | **MUERTA** — 11 rojos repartidos en 6 archivos: el módulo, los dos mappers y los tres modales |
| M5 | Se invierte la precedencia (el fallo del servicio gana a la dirección irresoluble) | **MUERTA** — 2 rojos en el bloque `400/R22` |
| M6 | `mensajeAsignadasSinUbicacion` deja de callar con `n <= 0` | **MUERTA** — 3 rojos (R33) |
| M7 | El modal DELATA qué guías quedaron sin ubicación (viola R32) | **MUERTA** — 1 rojo, el test de R32 |

Ninguna sobrevive hoy. La única que sobrevivió, M3b, dejó una lección que vale más que la
mutación: **un requisito que solo vive en el sistema de tipos no tiene testigo en la suite**, y en
este repo eso es exactamente la familia de los fallos mudos.

### T17 — lo que ve el operador, textual

**No se pudo levantar la app ni conducir un navegador**: en esta sesión no hay ni MCP de Playwright
ni de Supabase, y provocar los casos exige además datos y sesión. Se dice en vez de disimularlo.

Lo que **sí** se hizo, y es más que recitar constantes: renderizar el modal REAL con Testing
Library y volcar el texto exacto de cada `role="status"` / `role="alert"` del diálogo y del toast.
Copiado tal cual salió:

```
##### PARCIAL: 3 asignadas (2 sin ubicación) + 1 bloqueada por dirección irresoluble
TOAST:    Mensajero asignado a 3 de 4 orden(es). 1 bloqueada(s). 2 órdenes se asignaron sin
          ubicación en el mapa por un problema del sistema, no de la dirección. Se ubicarán más tarde.
[status]  El lote quedó para el reparto de hoy, 9 de septiembre.
[status]  Mensajero asignado a 3 de 4 orden(es). 1 bloqueada(s). 2 órdenes se asignaron sin
          ubicación en el mapa por un problema del sistema, no de la dirección. Se ubicarán más tarde.
[alert]   NA-1104 — Dirección no encontrada

##### OK LIMPIO: nada que avisar
TOAST:    Mensajero asignado a 1 orden(es).
[status]  El lote quedó para el reparto de hoy, 9 de septiembre.
[status]  Mensajero asignado a 1 orden(es).

##### OK con UNA sin ubicación (singular)
TOAST:    Mensajero asignado a 1 orden(es). 1 orden se asignó sin ubicación en el mapa por un
          problema del sistema, no de la dirección. Se ubicará más tarde.
[status]  El lote quedó para el reparto de hoy, 9 de septiembre.
[status]  Mensajero asignado a 1 orden(es). 1 orden se asignó sin ubicación en el mapa por un
          problema del sistema, no de la dirección. Se ubicará más tarde.

##### PARCIAL con una bloqueada por geocodificacion_agotada (el mensaje que mentía)
TOAST:    Mensajero asignado a 1 de 2 orden(es). 1 bloqueada(s).
[status]  El lote quedó para el reparto de hoy, 9 de septiembre.
[status]  Mensajero asignado a 1 de 2 orden(es). 1 bloqueada(s).
[alert]   NA-1102 — No se pudo verificar la ubicación por un fallo del servicio de mapas.
          La dirección no es el problema; vuelve a intentarlo más tarde.
```

Lo que se lee en ese volcado, y que no se ve en ningún test aislado:
1. La orden bloqueada por **dirección irresoluble** sigue diciendo «Dirección no encontrada» —el
   caso legítimo, que la ficha deja intacto (R20/R26).
2. La orden bloqueada por **fallo del servicio** ya no manda al operador a corregir nada (R19).
3. El aviso de las sin-ubicación va **pegado a la confirmación**, en el mismo párrafo, y **no**
   dentro del recuadro rojo de las bloqueadas (R34/R35).
4. Con nada que avisar, no aparece nada de más (R33).
5. El aviso dice «2 órdenes», nunca «NA-1101 y NA-1102» (R32).

El script que produjo el volcado era temporal y **se borró**; no queda en el árbol.

---

## Notas y deuda

1. **T17 queda a medias, y a propósito declarado.** El volcado de arriba cubre el texto y la
   estructura del DOM, pero nadie ha visto la pantalla real con datos reales. Si alguien con
   navegador retoma la ficha, lo que falta comprobar es el caso 1 y 2 con órdenes de verdad.
2. **La lección de M3b vale para toda la 92/93/368.** Cualquier otro requisito del repo que se
   apoye solo en una anotación de tipo está en la misma situación: verde y desprotegido. Aquí se
   cerró con un guardia; en otros sitios nadie lo ha mirado.
3. **T20 sigue abierta** (backend): el `--dry-run` del backfill contra producción tras el
   despliegue. Resultado esperado, 0 candidatas.
4. **No se tocó** ni backend, ni base de datos, ni ninguna ruta de API: las dos Server Actions
   siguen siendo passthrough y no cambian de código.
