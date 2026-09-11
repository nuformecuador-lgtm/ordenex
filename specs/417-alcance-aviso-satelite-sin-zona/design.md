# Feature 417 — diseño

> Ficha **pequeña y defensiva**. El diseño lo es también: **un servicio, una guarda, tres casos de
> test y una mutación**. Sin migración, sin tabla, sin endpoint, sin UI.

---

## §1 — El hallazgo, en el archivo real

`lib/services/VigenciaAvisoAgregadoService.ts`, método `cifra`, rama de `devoluciones_represadas`
(líneas 35-41 del archivo de hoy):

```ts
const zonaId = actor.rol === "adminSatelite" ? (actor.zonaId ?? null) : null;
return this.repo.contarRepresadas(this.ancladaAntesDe(), zonaId);
```

`Actor.zonaId` es **opcional** (`lib/interfaces/services/IOrdenService.ts:21`), así que
`{ rol: "adminSatelite", zonaId: null }` es un valor legal del tipo. Con él, `zonaId` queda `null`
y `AvisoAgregadoRepository.contarRepresadas` (líneas 168-171) devuelve `filas.length`: **el total
del sistema**.

### El propio archivo ya nombró el riesgo

Las tres líneas de comentario que hay **justo encima** (36-38) dicen:

> «⚠️ LA ZONA SALE DEL ACTOR, y solo para el `adminSatelite`. **Ignorarla le enseñaría al satélite el
> total del sistema —el número de OTRA bodega—** y es una de las mutaciones que el test de este
> servicio mata.»

Quien escribió eso **vio el peligro y lo protegió a medias**: cubrió *ignorar* la zona —con su
mutación y su test— y no cubrió *que la zona falte*, que desemboca exactamente en el mismo sitio.
Eso hace esta ficha fácil de justificar: **no descubre un riesgo nuevo, cierra uno que el código ya
tenía escrito en su propio margen.**

Y **seis líneas más arriba**, en la rama hermana del mismo método, vive el mismo defecto con el modo
de fallo invertido: §7.

### Nota de encargo

La ficha llegó señalando `lib/services/AvisosDiariosService.ts`. **Ahí no está el defecto**: ese
archivo es el proceso diario de emisión; itera zonas que le da el repositorio y no resuelve ámbito
a partir de un actor (lo comprobé leyendo el archivo entero). El seam por actor es
`VigenciaAvisoAgregadoService`. Se implementa donde está el defecto.

---

## §2 — Por qué hoy no pasa, y por qué eso es justamente el problema

Dos capas lo impiden, **y ninguna de las dos es este seam**:

| Capa | Archivo | Qué impide |
| --- | --- | --- |
| Destinatarios de la emisión | `lib/notificaciones/emitir.ts:1121-1124` | el aviso **global** se emite a `maestro` y `admin`; el de zona, a `{ rol: "adminSatelite", zonaId }`. Un satélite nunca es destinatario del global |
| Predicado de visibilidad (**146**) | `lib/repositories/NotificacionRepository.ts:39-50` | la rama por rol exige `zona_id IS NULL OR zona_id = actor.zonaId`, y `NotificacionService` normaliza `actor.zonaId ?? null` (línea 71). Un satélite **sin** zona no recibe ninguna fila acotada por zona, así que `cifra` **ni se llama** |

Consecuencia medida, no supuesta: **si alguien toca el predicado de la 146, ningún test de la 409 se
pone rojo por esto.** La protección es real y es correcta; lo que no existe es **una alarma propia
de este seam**. Esta ficha añade la alarma. **No sustituye al predicado: lo duplica a propósito**
(defensa en profundidad, en la capa que compone el número).

---

## §3 — El caso mal nombrado: existe, y lo confirmé

`tests/unit/services/vigencia-aviso-agregado.test.ts`, líneas 83-92:

```
it("un adminSatelite SIN zona no ve el total: pide `null`, y el predicado de la 146 ya lo tapa", ...)
  expect(repo.contarRepresadas.mock.calls[0][1]).toBeNull();
```

**El titular miente y el cuerpo dice la verdad.** «No ve el total» promete una protección; lo que el
aserto comprueba es que **se pide `null`**, que **es** el total. El resto del nombre («y el predicado
de la 146 ya lo tapa») es honesto, pero quien lea la lista de casos sin abrir el cuerpo —que es como
se leen las listas de casos— concluirá que esto ya está cubierto.

**Qué se hace con él: se deroga y se reescribe**, no se borra en silencio ni se apoya la ficha en él.
Su aserto (`toBeNull()`) pasa a ser **falso** con el comportamiento nuevo, así que el cambio es
forzoso; lo que la ficha exige es que se sustituya por los casos de R1/R2 **con el motivo escrito en
el archivo** (derogación declarada, como hizo la 409 con sus nueve literales), y **sin tocar ningún
otro caso** del archivo.

---

## §4 — La decisión: qué debe pasar con un `adminSatelite` sin zona

Las tres salidas posibles, con su coste:

| Opción | Qué vería el actor | Coste real |
| --- | --- | --- |
| **A — no recibe aviso** (`return 0`) | nada: la 409/R55 apaga la fila **sin que nadie la lea ni la descarte** | **Silencio.** Repite exactamente el modo de fallo que originó este hallazgo, y además **oculta un aviso vivo**. El propio código ya rechazó este patrón **dos veces**: el default `vigenciaNoResuelta` y la rama del evento no agregado **lanzan** «en vez de devolver un `0` de cortesía» |
| **B — lo recibe vacío** (sin número) | el aviso, sin cifra | Es **exactamente** lo que la 409/R58 ya hace cuando `cifra` falla. No necesita mecanismo nuevo: **es la opción C vista desde la pantalla** |
| **C — estado imposible, falla ruidosamente** ✅ | el aviso **sin número**, y un error **con nombre** en el log | Un error registrado por sondeo mientras dure la mala configuración, **sólo para ese actor** y **sólo si además tiene un aviso agregado vivo**. Hoy: cero |

**Se elige C**, y B es su aterrizaje. La regla queda dicha en una línea, y vale para **las dos
ramas** del método: **si el ámbito del actor no existe, se falla; no se inventa uno.**

Tres razones, todas apoyadas en código que ya existe:

1. **No hay que inventar el aterrizaje.** `NotificacionService.cifrasVivas` (líneas 153-174) captura
   cualquier fallo del resolutor, lo registra con su `cause` y guarda `null`, que la 409/R58 traduce
   en **mostrar el aviso sin número**. Lanzar aquí **no rompe ninguna pantalla y no vacía ninguna
   campana**: el coste de «fallar ruidosamente» ya está pagado por la 409.
2. **Es el precedente del repo para este mismísimo estado.** `lib/analytics/alcance.ts:325-332`
   resuelve el alcance de un `adminSatelite` así: `if (!idUtil(actor.zonaId)) return denegado("sin_zona_asignada")`,
   con el comentario «NO se degrada a global, ni a "todas las zonas", ni a `ok` con cero filas. El
   borde lo traduce a 403 para que **un fallo de configuración se vea como fallo y no como tablero
   vacío**». Esta ficha aplica ese mismo criterio en el seam que le falta.
3. **Un estado imposible tratado en silencio es cómo nació este hallazgo.** Elegir A sería cerrar la
   ficha con la misma forma del defecto que vino a cerrar.

### Qué dice el error, y qué NO dice

- **Contiene** la causa en palabras (`sin zona asignada`) y el evento. La prueba compara contra un
  literal **escrito a mano**, nunca contra la constante de producción que lo genera: la lección
  «aserción contra su propia fuente» de este repo.
- **No contiene identificadores de usuario.** No hay ni un precedente en `lib/` de meter
  `usuarioId` en el mensaje de un `Error`, y el reviewer vigila PII en logs. Saber **quién** es una
  consulta de una línea contra `usuario`; saber **que existe uno** es lo que el log tiene que gritar.
- No se añade categoría de log nueva: el error viaja como `cause` del que ya emite `cifrasVivas`.

---

## §5 — El cambio, en contrato

**Un único método cambia en producción:** `VigenciaAvisoAgregadoService.cifra`. **Dos guardas, una
por rama**, ninguna otra línea.

- **Entrada:** `(evento: NotificacionEvento, actor: Actor)` — sin cambios de firma.
- **Salida:** `Promise<number>` — sin cambios de tipo.
- **Rama `devoluciones_represadas` (R1/R2):** si `actor.rol === "adminSatelite"` y su zona no es un
  id útil (ausente, `null` o `""`), **no se llama al repositorio** y se lanza el error nombrado.
- **Rama `novedades_sin_gestionar` (R3/R4):** si `actor.rol !== "adminTienda"`, **no se llama al
  repositorio** y se lanza el error nombrado. El ámbito de ese aviso **es una tienda**, y en este
  esquema la tienda **es** el `adminTienda` (`orden.tienda_id` es FK a `usuario`); para cualquier
  otro rol, ese `usuarioId` no identifica ninguna tienda y el conteo sólo puede dar `0`.
- **Todo lo demás, idéntico**: `maestro`/`admin` siguen en global, el satélite con zona sigue en su
  zona, el `adminTienda` sigue contando lo suyo, y el evento no agregado sigue lanzando.
- **Documentación del contrato:** `lib/interfaces/services/IVigenciaAvisoAgregado.ts` ya declara que
  el método lanza para un evento no agregado; se le añaden estos dos casos de lanzamiento, para que
  el contrato no diga menos de lo que la implementación hace.

**Cero cambios** en: repositorios, emisores, catálogo, DTO, rutas, Server Actions, componentes,
`db/schema.prisma`, migraciones, RLS, `vercel.json`, configuración.

Por qué la guarda va en el **service** y no en el repositorio: el repositorio recibe
`zonaId: string | null` y `null` es un valor **legítimo** allí (es el ámbito de `maestro`/`admin`,
409/R49). Prohibírselo al repositorio rompería **R6**. **Quien sabe si el `null` es un ámbito o una
ausencia es quien lo deriva del actor**, y ése es el service. Lo mismo vale para la rama de tienda:
`contarNovedadesDeTienda` recibe un `string` y no tiene forma de saber si ese id es una tienda.

---

## §6 — Alternativas descartadas

- **A — Devolver `0` («no recibe aviso»).** Descartada: apaga la fila **en silencio** (409/R55), que
  es el modo de fallo que esta ficha existe para no repetir, y oculta un aviso vivo. Detalle en §4.
- **B — Consultar con una zona imposible** (`contarRepresadas(cota, "__sin_zona__")`). Descartada:
  da siempre `0`, o sea equivale a A, y encima paga una consulta inútil y mete una cadena mágica en
  un argumento que hoy es un id o `null`.
- **C — Arreglarlo «arriba»: que el borde o el predicado de la 146 nieguen el listado a un satélite
  sin zona.** Descartada **porque es justo lo que ya pasa**: ahí está hoy la protección, y esta
  ficha nace de que **está sólo ahí**. Mover la corrección a esa capa dejaría el seam igual de mudo
  y cambiaría el comportamiento de todas las notificaciones de ese actor —incluidas las que sí debe
  ver— por un hallazgo que no evidencia nada de eso. Además chocaría con **R8**.
- **D — Rediseñar el ámbito como un tipo discriminado transversal.** Hacer irrepresentable el
  «satélite sin zona» con una unión (`{tipo:"zona", zonaId} | {tipo:"global"}`) al estilo de
  `AmbitoRepresadas` (`lib/notificaciones/emitir.ts:1069-1071`) es lo correcto **a lo grande**, y
  sería el arreglo definitivo. Descartada aquí: obliga a tocar `Actor`, que usan todos los servicios
  y **cientos de literales en tests**; es **rediseño**, no el arreglo mínimo de lo evidenciado, y en
  este repo eso ya costó dos specs descartados. **Queda anotado como la dirección correcta el día
  que `Actor` se toque por otro motivo.**
- **E — Añadir un test de integración contra Postgres para este caso.** Descartada por innecesaria:
  lo que la ficha decide **no es SQL** (ver §9), y un test contra Postgres que no ejercita SQL nuevo
  es coste de gate sin evidencia añadida.
- **F — Dejar el caso espejo (`novedades_sin_gestionar`) para una ficha aparte.** Era la propuesta
  del borrador y **se descartó el 2026-09-10**. Es el mismo defecto, en la misma función, a seis
  líneas: partirlo obligaría a volver al mismo archivo con el diagnóstico ya escrito para cambiar
  una condición hermana —**media reparación**—, y su modo de fallo es **peor de encontrar**, no
  menor (§7). El coste de incluirlo es una condición, dos casos y una mutación.

---

## §7 — ¿Hay otros actores en la misma situación? El censo que hice

Busqué **todo** rol con un ámbito que pueda faltar, leyendo los archivos reales:

| Sitio | Qué hace con «sin zona» | Veredicto |
| --- | --- | --- |
| `lib/analytics/alcance.ts:325-332` | `denegado("sin_zona_asignada")`, traducido a 403 por el borde | **Explícito y ruidoso.** Es el precedente que copia esta ficha |
| `lib/services/FiltrosOrdenesService.ts:112-131` | catálogo **vacío**, con el porqué escrito arriba | **Explícito y declarado.** Silencioso, pero deliberado y documentado |
| `lib/actions/liberacion-reprogramada.ts:112-113` | `if (zonaId === null) return { status: "ok", liberadas: [] }` | **Explícito** |
| `lib/interfaces/services/ICierreBodegaService.ts:261-273` | «sin zona → página vacía (no hay alcance que consultar)» | **Explícito y escrito en el contrato** |
| **`lib/services/VigenciaAvisoAgregadoService.ts:39`** | **degrada a `null` = global** | **El único que degrada hacia MÁS alcance**, y el único sin decisión escrita |

**El patrón no se repite: el repo trata este estado de forma explícita en todas partes menos aquí.**
Lo confirmé además por forma: `rol === "adminSatelite" ?` aparece **una sola vez** en todo el
árbol `.ts`, y es esta línea.

### El caso espejo: en la misma función, y ENTRA en esta ficha (R3, R4, R7 — decisión del 2026-09-10)

La rama `novedades_sin_gestionar` (líneas 29-34) llama a `contarNovedadesDeTienda(actor.usuarioId)`
**sin comprobar el rol**. Para un actor que no sea `adminTienda`, ese id no identifica ninguna
tienda —el conteo acota por `tiendaId` (`OrdenRepository.novedadWhere:4949`)—, así que da `0`, y la
409/R55 **apaga el aviso sin que nadie lo lea, lo marque ni lo descarte**.

**Por qué entra y no se va a una ficha aparte:**

1. **Es el mismo defecto, en la misma función, a seis líneas.** El diagnóstico ya está escrito;
   volver después al mismo archivo a cambiar una condición hermana es media reparación.
2. **Su modo de fallo no es el menor de los dos: es el peor de encontrar.** Un número de más se nota
   al mirarlo; **un aviso que no sale no se nota nunca**. Es la familia de fallos mudos que este
   repo lleva cazando.
3. **Está protegido por la misma herencia**, así que hereda también la misma fragilidad: un solo
   productor (`notificadores.ts:371` → `emitir.ts:1041-1062`) que emite siempre a
   `{ rol: "adminTienda", tiendaId }`, más `destinatarios: ["adminTienda"]` en el catálogo, más el
   predicado de la 146. **Ningún test se pone rojo si eso cambia.**

**Comprobé si la simetría era falsa antes de aceptarla** (el encargo pedía parar si lo era). Busqué
una razón real por la que esa rama debiera **no** comprobar el rol: no existe. El único argumento
candidato —«es redundante, porque en este esquema el `adminTienda` **es** la tienda»— es **el mismo**
que tendría la rama del satélite, y esa rama **sí** comprueba el rol desde la 409.

**El único matiz honesto, y va escrito porque cambia el futuro, no el presente:** si algún día se
decide que `maestro`/`admin` también reciban `novedades_sin_gestionar`, con la guarda ese aviso les
saldría **sin número y con un error en el log**, en vez de **no salirles en absoluto**, que es lo que
pasa hoy. O sea: la guarda **no rompe** esa extensión —hoy ya está rota, en silencio—; la vuelve
**ruidosa y localizable**, y el sitio donde se haría ese cambio (`CATALOGO_AVISOS.destinatarios`)
está a un `grep` del error. **Es estrictamente mejor que lo de hoy**, y por eso no se trata como una
objeción sino como una nota.

---

## §8 — Modelo de datos, rutas, integraciones

**Ninguno cambia, y es una decisión, no un olvido:**

- **Datos:** no hay tabla, columna, índice, enum ni migración. `db/schema.prisma` no se toca. No hay
  RLS nueva que verificar; la de `notificacion` es la de la 146 y sigue igual.
- **Rutas/endpoints:** ninguno nuevo ni modificado. El único consumidor de `cifra` es
  `NotificacionService.listar` (verificado: `\.cifra\(` sólo aparece ahí y en tests), servido por la
  Server Action de `lib/actions/notificaciones.ts`. **No hay cron que llame a este resolutor.**
- **Contratos I/O:** la firma de `IVigenciaAvisoAgregado.cifra` no cambia; sólo su **documentación**
  se amplía con el segundo caso de lanzamiento. El DTO de notificaciones no cambia.
- **Integraciones externas:** ninguna.

Por eso el gate que corresponde es **`./init.sh --rapido`**: el diff no toca migraciones,
`db/schema.prisma`, `lib/types/**`, configuración de build ni archivos con nombre de dinero, así que
el modo rápido **no se niega** (`docs/verification.md` §«Cuándo `--rapido` se niega»). La corrida
completa la manda el arnés **después del merge a `dev`**, no antes.

---

## §9 — Verificación: las trampas que esta ficha tiene delante

1. **«Los dobles no ven el SQL.»** Miré si aplica antes de decidir el instrumento: **no aplica, y
   por qué**. Lo que la ficha decide es **qué argumento se le pasa** a `contarRepresadas`, y el
   filtro por zona de ese método **se aplica en memoria** sobre las filas ya traídas
   (`AvisoAgregadoRepository.ts:168-171`), no en un `where`. El SQL de la población (predicado de
   represamiento, ancla y umbral) **ya está cubierto contra Postgres real** en
   `tests/integration/db/aviso-agregado-repository.test.ts`, y esta ficha **no lo toca**. Por tanto
   el espía del repositorio es el instrumento correcto, y **no se añade test de integración**. Está
   escrito aquí para que no se lea como pereza.
2. **«Test verde sin datos», que aquí es facilísimo.** Un `expect(repo.contarRepresadas).not.toHaveBeenCalled()`
   **también pasa** si el servicio se rompió por cualquier otro motivo (un evento mal escrito, un
   constructor que lanza). Dos defensas, las dos obligatorias y **en las dos ramas**:
   - R2 y R4 exigen que el error sea **el nombrado** (`rejects.toThrow(/sin zona/i)` y su hermano de
     rol), no un error cualquiera;
   - el **control positivo** vive en el mismo `describe`: con zona, el repositorio **sí** se llama
     con esa zona (R5); con `adminTienda`, **sí** se cuenta su tienda (R7). Las mutaciones **M3** y
     **M5** lo demuestran poniéndolos rojos.
3. **«Aserción contra su propia fuente.»** El literal del mensaje va **escrito a mano** en el test.
   Nada de importar la constante que lo genera.
4. **«Literal: contrato o polizón.»** El `toBeNull()` del caso mal nombrado **no es contrato**: es
   precisamente el comportamiento que la ficha deroga. Se sustituye con el motivo escrito.
5. **«El test que vive dentro de lo que borras.»** No se borra ningún archivo ni componente. Del
   archivo de test sólo **se deroga un caso** (más los añadidos); los otros seis quedan intactos, y
   R5, R6 y R7 se apoyan en tres de ellos **sin editarlos**.
6. **«Una imposibilidad razonada no es medida.»** Esta ficha **no afirma** que el estado sea
   imposible: afirma que **hoy no es alcanzable por dos capas ajenas** y construye la prueba
   **saltándoselas a propósito** (test unitario del servicio, sin repositorio de notificaciones de
   por medio). Eso es legítimo y es el punto: se está probando una **defensa en profundidad**, no un
   camino alcanzable.

---

## §10 — Riesgos y límites, dichos con nombre

- **El log puede volverse repetitivo** si alguna vez existe un `adminSatelite` sin zona **y** llega a
  ver una fila acotada por zona: un error por sondeo (60 s) para ese actor. Es el ruido que se está
  comprando a cambio de que una mala configuración no se vea como un número correcto. Se acepta.
- **No se mide producción como puerta.** Un `SELECT` de satélites sin zona sería informativo, pero
  **no cambia ni una línea** del diseño: la guarda es la misma exista o no ese usuario, y mientras el
  predicado de la 146 esté en su sitio ese actor no llega a `cifra`. Queda como tarea **opcional y
  no bloqueante** en `tasks.md`.
- **Esta ficha no vigila que el predicado de la 146 siga existiendo.** No es su encargo: lo que
  entrega es que, **si desaparece**, este seam siga negándose y lo diga. Ésa es toda la diferencia
  entre una protección heredada y una afirmada.
