# Feature 418 — diseño

> ## La ficha entera, en una línea
>
> **Hoy nada se pone rojo si alguien mete a los otros tres roles en el ámbito global, porque nada lo
> afirma.**
>
> No es una figura retórica: está comprobado caso por caso, **abriendo los cuerpos** de los tests
> vigentes y no sus títulos (§6-c). Los únicos actores que se usan con `devoluciones_represadas` en
> la suite del seam son `SATELITE`, `MAESTRO` y `ADMIN` — los tres **dentro** de la lista blanca. El
> comportamiento que esta ficha cambia **no está afirmado en ningún sitio**, y por eso el entregable
> no es el arreglo: **es el rojo**.

> Ficha **pequeña y defensiva**, continuación directa de la 417. El diseño lo es también: **un
> método, una condición dada la vuelta, unos cuantos casos de test y seis mutaciones.** Sin
> migración, sin tabla, sin endpoint, sin UI, sin dependencia nueva.

---

## §1 — El hallazgo, en el archivo real

`lib/services/VigenciaAvisoAgregadoService.ts`, método `cifra`, rama `devoluciones_represadas`
(líneas 68-89 del archivo de hoy, tras la 417):

```ts
if (evento === "devoluciones_represadas") {
  if (actor.rol !== "adminSatelite") {
    return this.repo.contarRepresadas(this.ancladaAntesDe(), null);   // <- línea 72-74
  }
  if (!idUtil(actor.zonaId)) { throw new Error(/* ...417/R1-R2... */); }
  return this.repo.contarRepresadas(this.ancladaAntesDe(), actor.zonaId);
}
```

`null` **es el total del sistema**, confirmado en la implementación
(`AvisoAgregadoRepository.contarRepresadas`, líneas 167-171):
`return zonaId === null ? filas.length : filas.filter((f) => f.zonaId === zonaId).length;`

El enum tiene **seis** roles (`db/schema.prisma:35-44`). La condición enumera **uno**. Los otros
cinco caen en la primera rama, y de ellos sólo dos (`maestro`, `admin`) deben estar ahí: **tres roles
—`mensajero`, `adminTienda`, `apiKey`— obtienen hoy el total del sistema por omisión**, y el séptimo
valor que alguien añada al enum entrará con ellos **sin que nada se ponga rojo**.

### La asimetría está a diez líneas, en la misma función

La rama hermana ya decide por **inclusión** desde la 417 (líneas 61-65):

```ts
if (actor.rol !== "adminTienda") { throw new Error(/* ...no es una tienda... */); }
```

Eso es una lista blanca de un miembro: **enumera quién sí**, y todo lo demás falla. La de represadas
enumera **quién no**, y todo lo demás pasa. **Mismo método, dos políticas opuestas**, y la diferencia
no está escrita en ningún sitio como decisión. Esta ficha las iguala.

---

## §2 — Por qué hoy no pasa, y por qué eso es justamente el problema

Dos capas lo impiden, **y ninguna de las dos es este seam**:

| Capa | Archivo | Qué impide |
| --- | --- | --- |
| Quién recibe el aviso | `lib/notificaciones/emitir.ts:1116-1139` | las filas se escriben **siempre** con `destinatario.tipo === "rol"` y rol ∈ {`maestro`, `admin`} (ámbito global, vía `ROLES_ADMINISTRACION`, líneas 112-115) o `adminSatelite` acotado a una zona. **Un solo productor**: `notificadores.ts:392` |
| Predicado de visibilidad (**146**) | `lib/repositories/NotificacionRepository.ts:39-50` | el segundo término cuelga de `destinatarioRol: actor.rol`; y el primero (`destinatarioUsuarioId = actor.usuarioId`) no puede casar porque `columnasDestinatario` (líneas 72-78) escribe `destinatarioUsuarioId: null` para todo destinatario de tipo rol |

Y `NotificacionService.listar` (líneas 93-102) alimenta `cifrasVivas` con `filas.map(f => f.evento)`
—**sólo los eventos de las filas que el actor ya puede ver**—, así que un `mensajero` no llega a
`cifra` con este evento.

Consecuencia medida, no supuesta: **la protección entera vive fuera de este archivo**. Y esta vez hay
una tercera capa, más frágil que las otras dos, porque no es un archivo sino **una forma**: la lista
negra **da por bueno todo lo que no enumera**. No hace falta que alguien toque el predicado de la 146
para abrir el agujero; basta con **añadir un valor al enum de roles**, que es un cambio que nadie
relacionaría con este archivo.

---

## §3 — La lista blanca exacta, y de dónde sale

**No la invento yo: está escrita, y en dos sitios independientes que coinciden.**

| Rol | Ámbito | Fuente |
| --- | --- | --- |
| `maestro` | **global** (`null`) | `catalogo-avisos.ts:260` (`destinatarios`) + `emitir.ts:1121-1124` vía `ROLES_ADMINISTRACION` (`emitir.ts:112-115`) |
| `admin` | **global** (`null`) | idéntico al anterior |
| `adminSatelite` | **su zona**, y si no tiene zona útil **falla** (417/R1-R2) | `catalogo-avisos.ts:260` + `emitir.ts:1124` (`{ tipo: "rol", rol: "adminSatelite", zonaId }`) |
| `mensajero`, `adminTienda`, `apiKey` | **ninguno** → falla | **no aparecen** en `destinatarios` ni en el emisor |

El catálogo dice **quién recibe**; el emisor dice **con qué acotación**. La tabla de arriba es la
unión de las dos, y es exactamente lo que el resolutor tiene que saber: `destinatarios` por sí solo
**no basta**, porque no codifica el ámbito (§7-B).

---

## §4 — Qué pasa con un rol que no está en la lista: **lo mismo que en la 417, y se reusa**

La 417 ya fijó la regla, la justificó y midió su aterrizaje:

> **Si el ámbito del actor no existe, se falla; no se inventa uno.**
> (`specs/417-alcance-aviso-satelite-sin-zona/design.md` §4, opción C)

**Se reusa tal cual. No se inventa un mecanismo nuevo para el mismo problema**, y por las mismas tres
razones, todas verificadas hoy en el archivo:

1. **El aterrizaje ya existe.** `NotificacionService.cifrasVivas` (líneas 153-174) captura cualquier
   fallo del resolutor, lo registra con su `cause` y guarda `null`, que la 409/R58 traduce en
   **mostrar el aviso sin número**. **Lanzar aquí no rompe ninguna pantalla ni vacía ninguna
   campana**; el coste ya lo pagó la 409.
2. **Es el precedente del repo para este estado.** `lib/analytics/alcance.ts` resuelve el alcance de
   un actor sin ámbito con `denegado("sin_zona_asignada")` y lo dice con todas las letras: «para que
   **un fallo de configuración se vea como fallo y no como tablero vacío**».
3. **Un estado imposible tratado en silencio es cómo nació este hallazgo** — dos veces seguidas, en
   la 417 y en ésta.

Las otras dos salidas quedan descartadas en §7 (A y C) por el mismo motivo que en la 417: `0` apaga
el aviso **sin que nadie lo lea, lo marque ni lo descarte**, y el total del sistema es el defecto.

### Qué dice el error, y qué NO dice

- **Contiene** el evento, la causa en palabras y **el rol** (el rol no es PII; el mensaje hermano ya
  lo lleva: `el rol "${actor.rol}" no es una tienda`).
- **NO contiene `usuarioId`** ni ningún dato personal (R6). Hay un aserto que lo fija, como en la 417.
- **NO puede coincidir** con los mensajes de los otros dos fallos de ámbito del método (R6): si
  coincidiera, un `rejects.toThrow(/.../)` podría pasar **por el error equivocado**. La mutación
  **M5** existe exactamente para eso.
- **Propuesta de literal** (el implementer puede afinar la redacción respetando R6):
  `vigencia: el evento "devoluciones_represadas" no define ambito para el rol "mensajero"`.
  En los tests, el literal va **escrito a mano**, nunca importado de producción.
- No se añade categoría de log nueva: el error viaja como `cause` del que ya emite `cifrasVivas`.

---

## §5 — El cambio, en contrato

**Un único método cambia en producción:** `VigenciaAvisoAgregadoService.cifra`, **una sola rama**.

- **Entrada:** `(evento: NotificacionEvento, actor: Actor)` — **sin cambios de firma**.
- **Salida:** `Promise<number>` — **sin cambios de tipo**.
- **Rama `devoluciones_represadas`:**
  - `maestro` / `admin` → `contarRepresadas(cota, null)` (**igual que hoy**);
  - `adminSatelite` → la guarda de zona de la 417 y luego `contarRepresadas(cota, actor.zonaId)`
    (**igual que hoy**);
  - **cualquier otro rol** → **no se llama al repositorio** y se lanza el error nombrado (**nuevo**).
- **Todo lo demás, idéntico**: la rama de tienda, el evento no agregado, el umbral inyectado.
- **Documentación del contrato:** `lib/interfaces/services/IVigenciaAvisoAgregado.ts` (líneas 26-36)
  ya declara los dos casos de lanzamiento de la 417; se le añade **el tercero**, para que el contrato
  no diga menos de lo que la implementación hace. **Sin cambio de firma.**

### La forma de la lista blanca

Una **enumeración explícita escrita a mano, local a este servicio**, legible como la decisión que es.
El repo ya lo hace así en los dos artefactos hermanos: `emitir.ts:112-115` (`ROLES_ADMINISTRACION`) y
`catalogo-avisos.ts:116` (`ADMINISTRACION_CENTRAL`), **cada uno con su propia lista** en vez de
reusar `esAccesoTotal`. Por qué **no** se deriva de otra fuente, en §7-A y §7-B.

**Por qué la guarda va en el service y no en el repositorio:** `contarRepresadas` recibe
`zonaId: string | null` y `null` es allí un valor **legítimo** (es el ámbito de `maestro`/`admin`,
409/R49). Prohibírselo al repositorio rompería R1. **Quien sabe si ese `null` es un ámbito o una
ausencia es quien lo deriva del actor**, y ése es el service. Mismo argumento que la 417.

**Cero cambios** en: repositorios, emisores, catálogo, cron, DTO, rutas, Server Actions, componentes,
`db/schema.prisma`, migraciones, RLS, configuración.

---

## §6 — ¿Altera el cambio algún camino vigente? La comprobación, con el archivo delante

**Tres comprobaciones independientes, y las tres dicen que NO.**

**(a) Por quién escribe las filas.** `emitirDevolucionesRepresadas` (`emitir.ts:1116-1139`) es el
**único** productor —`emitirDevolucionesRepresadas` sólo se invoca en `notificadores.ts:392`; el
resto de apariciones en el árbol `.ts` son tests— y siempre emite a `maestro`+`admin` (global) o a
`adminSatelite` acotado por zona. **Ningún rol fuera de la lista blanca recibe una fila de este
evento.**

**(b) Por el predicado de visibilidad (146), siguiendo el mismo método que usó el reviewer de la
417.** `predicadoVisibilidad` (`NotificacionRepository.ts:39-50`) tiene dos términos:

- `destinatarioUsuarioId = actor.usuarioId` → **no puede casar**: `columnasDestinatario`
  (líneas 72-78) escribe `destinatarioUsuarioId: null` para todo destinatario de tipo rol, y todas
  las filas de este evento lo son;
- `destinatarioRol = actor.rol` → un `mensajero`, un `adminTienda` o un `apiKey` **no casa** con
  ninguna de las tres filas posibles.

Y `NotificacionService.listar` (líneas 93-102) pide las cifras vivas **sólo de los eventos de las
filas ya filtradas** (`filas.map(f => f.evento)`), así que **un rol que no puede ver esa fila nunca
llega a pedir su cifra**. Es literalmente la misma comprobación que la 417 hizo para su caso espejo,
y da el mismo resultado.

**(c) Por los tests vigentes, abriendo los cuerpos y no los títulos.** En
`tests/unit/services/vigencia-aviso-agregado.test.ts`, los únicos actores usados con
`devoluciones_represadas` son `SATELITE` (líneas 55-73), `MAESTRO` (75-81 y 184) y `ADMIN` (78):
**los tres están en la lista blanca**. `TIENDA` sólo aparece con `novedades_sin_gestionar` (48) y con
el default (209). **Conclusión doble:** el cambio no rompe ningún caso existente **y** —lo que
importa más— **hoy no hay un solo aserto que se ponga rojo si alguien mete a los otros tres roles en
el ámbito global**. Eso es el hueco que la ficha viene a llenar.

**Lo que esta comprobación NO es: una medida.** Es razonamiento sobre el código, y en este repo *una
imposibilidad razonada no es medida*.

### Y hoy no se puede medir, por un motivo que hace la afirmación MÁS fuerte

Medido por el orquestador el 2026-09-10: **el valor `devoluciones_represadas` no existe en el enum de
producción**, porque la migración de la 409 está en `dev` **sin desplegar**.

O sea: **no es que el caso no haya ocurrido — es que el evento entero todavía no puede existir allí.**
Eso sostiene «hoy no es alcanzable» por una vía más fuerte que la de §2, y a la vez **impide
confirmarlo midiendo** hasta que esto se despliegue.

Por eso la comprobación **deja de ser puerta de esta ficha** y pasa a ser una **comprobación
post-despliegue**. La consulta, en **solo lectura**, ya está escrita y lista para ese día:

```sql
SELECT destinatario_rol, destinatario_usuario_id IS NOT NULL AS dirigida_a_usuario, count(*)
FROM notificacion
WHERE evento = 'devoluciones_represadas'
GROUP BY 1, 2;
```

Debe devolver **sólo** `maestro`, `admin` y `adminSatelite`, y `dirigida_a_usuario = false` en todas.
**Si aparece cualquier otra cosa, el camino SÍ es alcanzable: para y dilo** — el diseño no cambia,
pero sí cambia la frase «nadie verá un cambio de comportamiento al desplegar esto».

**Cómo leer el resultado, dicho por adelantado para quien lo ejecute:**

| Lo que devuelve | Qué significa |
| --- | --- |
| **error: el valor no existe en el enum** | es **lo de hoy**. No estás midiendo cero: estás midiendo **la nada**. El aviso aún no puede existir en esa base |
| **cero filas** | «aún no ha pasado», **no** «está bien». Producción se vació a propósito el 2026-08-25, y el cron de avisos necesita órdenes represadas para emitir |
| **sólo los tres roles de la lista blanca** | lo esperado: el camino sigue sin ser alcanzable **y ahora está medido** |
| **cualquier otro rol, o `dirigida_a_usuario = true`** | **para y dilo**: el camino es alcanzable |

Va como tarea **no bloqueante y post-despliegue** en `tasks.md` (T8).

---

## §7 — Alternativas descartadas

- **A — Reusar `esAccesoTotal(actor.rol)`** (`lib/auth/acceso-total.ts:5-9`, que es exactamente
  `[maestro, admin]`) para la rama global. **La más tentadora, y descartada por el motivo de la
  ficha:** ese predicado significa «acceso total **de gestión**», una capacidad ajena a quién recibe
  este aviso. Si mañana entrara un rol nuevo en `ROLES_ACCESO_TOTAL` —una decisión que se tomaría
  mirando módulos, no notificaciones—, **ese rol heredaría en silencio el ámbito global de este
  aviso**: volveríamos a tener una protección que depende de un archivo ajeno, que es el defecto que
  esta ficha cierra. El repo ya rechazó ese acoplamiento dos veces, y de forma visible: `emitir.ts`
  y `catalogo-avisos.ts` mantienen **cada uno su propia lista** de administración central en vez de
  reusar `esAccesoTotal`.
- **B — Que el service lea `CATALOGO_AVISOS[...].destinatarios` en tiempo de ejecución.** Descartada
  por tres motivos: (1) `destinatarios` dice **quién recibe**, no **con qué ámbito** —el service
  seguiría necesitando el mapa rol→ámbito, así que no ahorra la decisión, sólo la parte; (2) ese
  campo se declaró para que **una guardia lo recorra** (`catalogo-avisos.ts:93-100`), y colgar de él
  una decisión de alcance cambia su significado en silencio; (3) haría **vacua** la comprobación de
  R7: comparar la lista contra la fuente de la que se deriva está siempre verde —la lección «aserción
  contra su propia fuente» de este repo—.
- **C — Devolver `0` para el rol sin ámbito.** Descartada: apaga la fila **en silencio** (409/R55),
  que es el modo de fallo que la 417 vino a no repetir. Mutación **M2** lo demuestra midiendo, no
  argumentando.
- **D — Dejar la lista negra pero enumerar los tres roles de hoy** (`mensajero`, `adminTienda`,
  `apiKey` → lanzan). Es el **diff más pequeño posible** y por eso hay que decir por qué no: **sigue
  siendo una lista negra**. El séptimo valor del enum volvería a caer en el ámbito global, que es
  exactamente el fallo mudo que la ficha existe para cerrar. R5 la prohíbe explícitamente.
- **E — Rediseñar el ámbito como un tipo discriminado transversal** (`{tipo:"zona", zonaId} |
  {tipo:"global"}` en `Actor`, al estilo de `AmbitoRepresadas`, `emitir.ts:1069-1071`). Es lo correcto
  **a lo grande** y sería el arreglo definitivo. Descartada aquí, igual que en la 417 §6-D: obliga a
  tocar `Actor`, que usan todos los servicios y cientos de literales de test; es **rediseño**, no el
  arreglo mínimo de lo evidenciado, y en este repo eso ya costó dos specs descartados. **Queda
  anotada como la dirección correcta el día que `Actor` se toque por otro motivo.**
- **F — Arreglarlo «arriba»: que el borde o el predicado de la 146 nieguen el listado.** Descartada
  **porque es justo lo que ya pasa**: ahí está hoy la protección, y la ficha nace de que está **sólo
  ahí**. Además chocaría con R9.
- **G — Añadir un test de integración contra Postgres.** Descartada por innecesaria: lo que esta
  ficha decide **no es SQL** (§9.1), y un test contra Postgres que no ejercita SQL nuevo es coste de
  gate sin evidencia añadida.
- **H — Meter también la rama `novedades_sin_gestionar` «ya que estamos».** Descartada: **ya decide
  por inclusión** desde la 417 (líneas 61-65). Tocarla sería cambiar código correcto.

---

## §8 — Modelo de datos, rutas, integraciones

**Ninguno cambia, y es una decisión, no un olvido:**

- **Datos:** no hay tabla, columna, índice, enum ni migración. `db/schema.prisma` **no se toca**. No
  hay RLS nueva que verificar; la de `notificacion` es la de la 146 y sigue igual.
- **Rutas/endpoints:** ninguno nuevo ni modificado. El único consumidor de `cifra` es
  `NotificacionService.ts:161` (verificado: `\.cifra\(` sólo aparece ahí y en tests), servido por la
  Server Action de `lib/actions/notificaciones.ts`, que es también quien **construye** el servicio
  (composition root: alguien lo **pasa**, no sólo lo importa). **No hay cron que llame a este
  resolutor.**
- **Contratos I/O:** la firma de `IVigenciaAvisoAgregado.cifra` no cambia; sólo su **documentación**
  gana el tercer caso de lanzamiento. El DTO de notificaciones no cambia.
- **Integraciones externas:** ninguna.

Por eso el gate que corresponde es **`./init.sh --rapido`**: el diff no toca migraciones,
`db/schema.prisma`, `lib/types/**`, configuración de build ni archivos con nombre de dinero, así que
el modo rápido **no debe negarse** (`docs/verification.md` §«Cuándo `--rapido` se niega»). **Si se
niega, es que se tocó algo de más: léelo antes de correr el completo.** La corrida completa la manda
el arnés **después del merge a `dev`**, no antes.

---

## §9 — Verificación: las trampas que esta ficha tiene delante

1. **«Los dobles no ven el SQL.»** Miré si aplica **antes** de elegir el instrumento: **no aplica**.
   Lo que esta ficha decide es **qué argumento recibe** `contarRepresadas`, y el filtro por zona de
   ese método se aplica **en memoria** sobre las filas ya traídas (`AvisoAgregadoRepository.ts:167-171`),
   no en un `where`. El SQL de la población ya está cubierto contra Postgres real en
   `tests/integration/db/aviso-agregado-repository.test.ts`, y **esta ficha no lo toca**. El espía
   del repositorio es el instrumento correcto. Escrito aquí para que no se lea como pereza.
2. **«Test verde sin datos», que aquí es facilísimo.** Un `expect(repo.contarRepresadas).not.toHaveBeenCalled()`
   **también pasa** si el servicio se rompió por cualquier otro motivo. **Cuatro defensas, las cuatro
   obligatorias:**
   - R4 exige el **error nombrado**, no un error cualquiera;
   - R6 + **M5** exigen que ese nombre **no sea el de otro de los fallos del mismo método**: sin eso,
     el aserto pasaría por el error equivocado;
   - los **controles positivos** (R1 y R2) viven en el mismo archivo y **M3/M4 los ponen rojos** uno
     a uno;
   - R10 afirma **las dos mitades** (el aviso sale **y** el log lo registra), no sólo una.
3. **«Aserción contra su propia fuente.»** El literal del mensaje va **escrito a mano** en el test.
   Nada de importar la constante que lo genera. Y por eso mismo la lista blanca de producción **no**
   se deriva del catálogo (§7-B): si lo hiciera, el aserto de R7 estaría siempre verde.
4. **«Literal: contrato o polizón.»** **Aquí no se deroga ningún caso.** El `toBeNull()` del caso
   «maestro y admin lo piden GLOBAL» (líneas 75-81) **SÍ es contrato** —es R1— y se conserva
   **intacto**; el polizón con ese mismo aserto ya lo derogó la 417. Si el implementer se ve
   tentado de editar un caso existente, **para**: no hay ninguno que esta ficha invalide (§6-c).
5. **«Ojo con los nombres de los casos.»** En la 417 había un caso llamado «no ve el total» cuyo
   cuerpo afirmaba lo contrario. **Todos los casos en los que este spec se apoya se han leído por el
   cuerpo**, y las líneas están citadas en §6-c y en `requirements.md` §Verificado. Los casos nuevos
   deben nombrarse por **lo que afirman**, no por lo que prometen.
6. **«El test que vive dentro de lo que borras.»** No se borra ningún archivo, ningún componente y
   ningún caso.
7. **«Una imposibilidad razonada no es medida.»** Esta ficha **no afirma** que el estado sea
   imposible: afirma que **hoy no es alcanzable por dos capas ajenas** (§2) y construye la prueba
   **saltándoselas a propósito** (test unitario del servicio). Eso es legítimo y es el punto: se está
   probando una **defensa en profundidad**, no un camino alcanzable. La medida que falsaría el
   razonamiento está en §6 y es no bloqueante.
8. **«El gate sin `.env` salta la integración.»** En un worktree no hay `.env`. Este diff no toca la
   capa de datos, pero los `skipped` se miran **uno a uno** igualmente, no sólo el `INIT_EXIT`.

---

## §10 — Riesgos y límites, dichos con nombre

- **El día que alguien amplíe la audiencia del aviso, ese rol lo verá sin número y con un error por
  sondeo** hasta que se le asigne ámbito aquí. Es **estrictamente mejor que hoy** —hoy vería *el
  total del sistema*, que es un número creíble y falso—, y **R7 hace que ese día sea un test rojo en
  el mismo commit** en vez de un hallazgo en el log semanas después. Es justo el motivo por el que R7
  entra (`requirements.md` §D1).
- **Nada de esto se puede confirmar contra producción todavía**, y no por falta de acceso: el evento
  **no existe en el enum de producción** (§6). La comprobación queda **post-despliegue**, y con la
  tabla de lectura escrita para que nadie confunda «cero filas» con «el enum no tiene ese valor».
- **El log puede volverse repetitivo** si alguna vez un rol fuera de la lista blanca llega a ver una
  fila de este aviso: un error por sondeo (60 s) para ese actor. Es el ruido que se compra a cambio
  de que un fallo de configuración no se vea como un número correcto. Se acepta, igual que en la 417.
- **Esta ficha no vigila que el predicado de la 146 siga existiendo, ni que el emisor siga emitiendo
  a quien emite.** No es su encargo. Lo que entrega es que, **si eso cambia**, este seam siga
  negándose y lo diga.
- **No cierra la familia entera.** Quedan en el repo otros sitios que derivan alcance de un rol; esta
  ficha arregla **el evidenciado por el reviewer de la 417** y nada más. Un censo transversal de
  listas negras sería otra ficha, con su propia medida.
