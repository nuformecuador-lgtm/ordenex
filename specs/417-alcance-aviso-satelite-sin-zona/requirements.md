# Feature 417 — un admin de bodega satélite sin zona vería la cifra global de un aviso

Requisitos en notación EARS. Cada `R<n>` termina mapeado a un test concreto en la tabla de
trazabilidad de `tasks.md` (`docs/specs.md` §Trazabilidad). Sin detalles de implementación: el
CÓMO vive en `design.md`.

**Preguntas abiertas: NINGUNA.** La única que abrió el borrador —si el **caso espejo** del evento
`novedades_sin_gestionar` entraba en esta ficha— se cerró el 2026-09-10 **a favor de incluirlo**, y
vive como decisión firmada en `design.md` §7. El porqué, en una línea: es **el mismo defecto, en la
misma función, a seis líneas de distancia**, y su modo de fallo —apagar un aviso en silencio— es
**peor de encontrar** que el del satélite, no menor: un número de más se nota al mirarlo; un aviso
que no sale no se nota nunca.

---

## De dónde sale esta ficha

La destapó el **reviewer de la 409** el 2026-09-10 (`progress/review_409.md` §4.m6 y R2.§9) y se
declaró **fuera del alcance de aquella ficha a propósito**, no por olvido.

**Esto NO es un agujero de seguridad, y escribirlo así sería mentir.** Es una **protección frágil**,
que es otra cosa:

1. **Hoy no es alcanzable.** El resolutor ni siquiera se llama para ese actor.
2. **El peor caso sería un conteo fuera de ámbito, no una fuga de datos.** Lo que se vería es un
   **número** en el título de un aviso cuyo texto la 409/R54 ya deja **sin guía, sin remisión, sin
   dirección, sin teléfono, sin destinatario, sin tienda y sin zona**. No se filtraría ningún dato
   de nadie.

**Y aun así merece ficha, y éste es el punto entero:** lo que hoy lo impide es un predicado **de
otra ficha** (la 146). O sea, una protección que funciona **por herencia y no por diseño propio de
este seam**. **Ningún test de la 409 se pone rojo si alguien toca aquel predicado**: se abriría en
silencio, que es exactamente la familia de fallos que este repo lleva cazando.

> **El objetivo de esta ficha no es arreglar un bug visible: es convertir una protección accidental
> en una afirmada.** El entregable es **el rojo**: retirar la protección propia tiene que poner algo
> en rojo **aunque el predicado de la 146 siga intacto en su sitio**.

---

## Verificado contra el código el 2026-09-10 (leído en el archivo real, no en el grafo)

- **El seam es `lib/services/VigenciaAvisoAgregadoService.ts`**, método `cifra`, **línea 39**:
  `const zonaId = actor.rol === "adminSatelite" ? (actor.zonaId ?? null) : null;`
  Un `adminSatelite` sin zona cae en `null`, y `null` **es el total del sistema**.
  *(La ficha llegó apuntando a `lib/services/AvisosDiariosService.ts`: ese archivo es el cron de
  emisión, no resuelve ámbito por actor y **no tiene el defecto**. El seam correcto es éste.)*
- **El propio código ya nombró el riesgo, y lo protegió a medias.** El comentario de las líneas
  36-38, justo encima: «*Ignorarla le enseñaría al satélite el total del sistema —el número de OTRA
  bodega—*». Quien lo escribió vio el peligro y cubrió **ignorar la zona**; lo que no cubrió es
  **que esa zona falte**. Esta ficha **no descubre un riesgo nuevo: cierra uno que el archivo ya
  tenía escrito**.
- **El caso espejo, en la misma función (líneas 29-34):** `novedades_sin_gestionar` resuelve el
  ámbito con `this.repo.contarNovedadesDeTienda(actor.usuarioId)` **sin comprobar el rol**. Y ese
  conteo acota por `tiendaId` (`OrdenRepository.novedadWhere`, línea 4949: `{ tiendaId, deletedAt:
  null, estatus }`), así que para un actor que **no** sea `adminTienda` el `usuarioId` no es una
  tienda, el conteo da `0` y la 409/R55 **apaga el aviso sin que nadie se entere**.
- **La simetría es real, verificada, no asumida.** Busqué una razón por la que esa rama debiera
  **no** comprobar el rol y **no existe**: el evento tiene **un solo productor**
  (`lib/notificaciones/notificadores.ts:371` → `emitir.ts:1041-1062`), que emite **siempre** a
  `{ tipo: "rol", rol: "adminTienda", tiendaId }` y **nunca** dirigido a un usuario; y el catálogo
  lo declara con `destinatarios: ["adminTienda"]` (`catalogo-avisos.ts:239`). Ningún otro rol puede
  tener hoy una fila de este evento.
- **`null` significa «todo»**, confirmado en la implementación:
  `AvisoAgregadoRepository.contarRepresadas` (líneas 168-171) hace
  `zonaId === null ? filas.length : filas.filter(...)`.
- **`Actor.zonaId` es opcional** (`lib/interfaces/services/IOrdenService.ts:21`,
  `zonaId?: string | null`): un satélite sin zona es **representable** en el tipo.
- **Hoy es inalcanzable, y por dos capas, las dos ajenas a este seam:**
  - `lib/notificaciones/emitir.ts:1121-1124` — el aviso global va a `maestro` y `admin`; el de zona
    va a `{ rol: "adminSatelite", zonaId }`. Un satélite nunca es destinatario del global.
  - `lib/repositories/NotificacionRepository.ts:39-50` (predicado de la 146) — la rama por rol exige
    `zona_id IS NULL OR zona_id = actor.zonaId`, y `NotificacionService` normaliza con `?? null`
    (línea 71), así que un satélite sin zona **no recibe ninguna fila acotada por zona**.
- **El fallo, si `cifra` lanza, ya tiene aterrizaje definido:** `NotificacionService.cifrasVivas`
  (líneas 153-174) lo captura, lo registra con su causa y guarda `null` → la 409/R58 muestra el
  aviso **sin número**. Lanzar aquí **no rompe ninguna pantalla**.
- **El caso mal nombrado EXISTE.** `tests/unit/services/vigencia-aviso-agregado.test.ts:83-92` se
  llama «un adminSatelite SIN zona **no ve el total**» y lo que su cuerpo afirma es
  `expect(repo.contarRepresadas.mock.calls[0][1]).toBeNull()` — o sea, **que se pide `null`, que es
  el total**. Ese caso queda derogado por esta ficha (ver `design.md` §3).

---

## Alcance

**Dentro:** la resolución del **ámbito** de la cifra viva en `VigenciaAvisoAgregadoService.cifra`
—**sus dos ramas**, `devoluciones_represadas` y `novedades_sin_gestionar`— y las pruebas que la
afirman en este seam. Las dos ramas van juntas **a propósito**: son el mismo defecto en la misma
función, y partirlas obligaría a volver al mismo archivo con el mismo diagnóstico ya escrito para
cambiar una condición hermana. Eso no es alcance mínimo: es media reparación.

**Fuera, declarado:**

- El predicado de visibilidad de la 146 (**no se toca**, R8).
- El emisor diario, el repositorio, el catálogo de avisos, el panel y la campana.
- Cualquier cambio de datos: **no hay migración, ni tabla, ni columna, ni RLS nueva**.
- Rediseñar el sistema de alcances del repo (un tipo `Ámbito` discriminado transversal): descartado
  en `design.md` §6-D.
- Cambiar **quién recibe** cada aviso (el catálogo y los destinatarios de la emisión no se tocan).

---

## Requisitos

### §1 — El actor sin zona (el hallazgo del reviewer)

- **R1** — SI el resolutor de la cifra viva de un aviso agregado acotado por zona recibe un actor de
  rol `adminSatelite` **sin zona asignada** (ausente, nula o cadena vacía), ENTONCES el sistema **NO
  DEBE** consultar la cifra del ámbito global ni la de ninguna otra zona.
- **R2** — SI el resolutor de la cifra viva recibe un actor de rol `adminSatelite` **sin zona
  asignada**, ENTONCES el sistema **DEBE fallar con un error que nombre la causa** y **NO DEBE**
  devolver una cifra.

### §2 — El mismo defecto en la rama hermana: el actor cuyo ámbito no aplica

- **R3** — SI el resolutor de la cifra viva de un aviso agregado acotado por tienda recibe un actor
  cuyo rol **no** es `adminTienda`, ENTONCES el sistema **NO DEBE** consultar ninguna cifra
  **usando el identificador de ese actor como si fuera una tienda**.
- **R4** — SI el resolutor de la cifra viva recibe, para un aviso acotado por tienda, un actor cuyo
  rol **no** es `adminTienda`, ENTONCES el sistema **DEBE fallar con un error que nombre la causa**
  y **NO DEBE** devolver una cifra —en particular, **NO DEBE devolver `0`**, que apagaría el aviso
  en silencio (409/R55).

### §3 — Lo que no puede cambiar (no regresión)

- **R5** — MIENTRAS un actor de rol `adminSatelite` **tenga** zona asignada, el sistema **DEBE**
  seguir pidiendo la cifra acotada a **esa** zona (409/R57).
- **R6** — MIENTRAS el actor sea de rol `maestro` o `admin`, el sistema **DEBE** seguir pidiendo la
  cifra del ámbito **global** (409/R49, 409/R57): la protección nueva no puede cerrar un ámbito
  global legítimo.
- **R7** — MIENTRAS el actor sea de rol `adminTienda`, el sistema **DEBE** seguir pidiendo el conteo
  de **su** tienda (409/R57): la protección nueva no puede cerrar el único ámbito legítimo de ese
  aviso.
- **R8** — El sistema **NO DEBE** modificar el predicado de visibilidad de notificaciones de la
  feature 146 ni la autorización de ninguna de sus operaciones.

### §4 — Dónde aterriza el fallo

- **R9** — CUANDO la resolución de la cifra viva falle porque el actor no tiene ámbito para ese
  aviso, el sistema **DEBE** seguir mostrando ese aviso **sin número** en el listado y **DEBE
  registrar el fallo con su causa** (409/R58 afirmado de extremo a extremo, no heredado de palabra).

### §5 — El entregable: una protección afirmada, no heredada

- **R10** — El sistema **DEBE** decidir el ámbito de la cifra viva **únicamente a partir del actor
  que recibe**, de forma que **retirar cualquiera de las dos decisiones ponga en rojo al menos un
  test sin modificar el predicado de visibilidad de notificaciones**.

---

## Las mutaciones obligatorias (el entregable de la ficha)

Un requisito sin un rojo que lo respalde no está cumplido. Estas tres se ejecutan y su salida se
pega en `progress/impl_417_backend.md`:

| # | Mutación | Qué tiene que ponerse ROJO |
| --- | --- | --- |
| **M1** | Retirar la guarda de la zona y dejar `actor.zonaId ?? null` (el código de hoy) | **R1, R2 y R9**, con el predicado de la 146 **intacto**. Es la mutación que da sentido a la ficha, y media de R10 |
| **M2** | Sustituir ese fallo por `return 0` | **R2** (y R9: el aviso **desaparecería** en vez de mostrarse sin número). Prueba que la ficha exige **ruido**, no silencio |
| **M3** | Hacer que la guarda de la zona dispare **siempre** para `adminSatelite` | **R5**. Control positivo: demuestra que los casos de R1/R2 no están verdes por vacío |
| **M4** | Retirar la guarda de rol de la rama de tienda (el código de hoy) | **R3 y R4**, también con el predicado de la 146 intacto. Es la otra mitad de R10, y su ausencia sería la media reparación |
| **M5** | Hacer que la guarda de rol dispare **siempre** | **R7**. Control positivo del espejo |

---

## Preguntas abiertas

**NINGUNA.** La única del borrador se cerró el 2026-09-10 incluyendo el caso espejo (R3, R4, R7 y las
mutaciones M4/M5). La simetría se verificó en el código **antes** de aceptarla, no después: está
escrita arriba, en §Verificado.
