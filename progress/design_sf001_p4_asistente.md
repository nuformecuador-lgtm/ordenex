# SF-001 · Punto 4, SEGUNDA MITAD — el asistente

**Estado: diseño, 2026-09-16. Sin ficha todavía. Bloqueado por una credencial que sólo el humano puede crear.**

La primera mitad (el módulo de documentación) es la ficha **433**, ya implementada y en revisión.
Este documento es lo que viene después, y **reemplaza la parte de "asistente" del diseño del
2026-09-15** (`design_sf001_p4_documentacion_asistente.md`), que se escribió cuando la documentación
todavía no existía y varias cosas se daban por desconocidas. Ya no lo son.

---

## Lo que cambió desde el diseño del 15

| Lo que aquel documento dejaba abierto | Lo que hoy está medido |
| --- | --- |
| «Puede que RAG sobre. No está afirmado: depende de cuánto ocupe la documentación» | **Sobra.** 32 documentos (**hoy 33**, tras la ficha 434), 11.733 palabras, 75.875 caracteres ≈ **21.000 tokens**. Cabe entero y cacheado |
| «Sigue sin leerse el PDF firmado» | Leído. Las cuatro aprobadas, ninguna prioritaria sobre otra |
| «Pendiente: autorización de datos de clientes a un proveedor externo» | **Concedida** por el humano: *«si no hay problema se asume lo de los datos del punto 4»* |
| «La documentación no existe» | Existe, verificada contra el código, y ya se puso a prueba dos veces (fichas 430 y 431) |

### Lo que cuesta, con los números de verdad

| Vía | Por consulta | Qué puede salir mal |
| --- | --- | --- |
| **Documentación entera, cacheada** ← elegida | **≈ $0,004** | nada: el asistente ve todo lo que hay |
| Búsqueda de fragmentos (RAG), lo que proponía el documento firmado | ≈ $0,012 | **el buscador trae el fragmento equivocado** y el asistente responde mal, con total seguridad |
| Documentación entera sin cachear | ≈ $0,043 | nada, pero diez veces más caro |

El documento firmado estimaba que mandarlo todo costaría «entre cinco y diez veces más». **Era cierto
sin caché.** Con caché se invierte, y de paso desaparece la pieza más compleja del proyecto.

Con 37 usuarios, aunque cada uno preguntara diez veces al día todos los días: **≈ $11 al mes.**

**Lo que ese $0,004 asume, dicho antes de que alguien lo cite como si fuera fijo:** que la caché está
caliente. Dura cinco minutos, y con 37 usuarios repartidos en el día **muchas consultas la van a
encontrar fría** y costarán la entrada entera. No cambia nada, y por dos razones: el contexto acotado
por rol (abajo) hace que lo que se manda en frío sea mucho menor que 21.000 tokens —el del mensajero
son ~5.000—, y aun pagando entrada completa en TODAS las consultas el mes se va a ≈ $47. El orden de
magnitud es el mismo: esto no es una decisión de coste, es una decisión de simplicidad.

---

## La decisión que abarata y protege a la vez: el contexto se acota por rol

El asistente NO recibe los 33 documentos. Recibe **los que esa persona puede leer**, reutilizando
`documentosVisiblesPara()` de la ficha 433 — la misma función que ya decide el índice y el `notFound()`.

Dos cosas salen de ahí, y ninguna es un extra:

1. **Un mensajero no puede sonsacarle al asistente cómo funciona la caja de la empresa.** Sin esto, el
   acotamiento por rol de la 433 sería decorativo: la puerta cerrada en `/ayuda` y la ventana abierta
   en el chat. Es exactamente el fallo que la ficha 433 se tomó el trabajo de evitar con un
   `notFound()` en el servidor.
2. **Sale más barato**: el contexto del mensajero son 8 documentos, no 32.

Coste: **cinco prefijos de caché en vez de uno** (uno por rol). Da igual — la caché se cobra por lo que
se lee, no por cuántos prefijos distintos haya, y cada prefijo se refresca solo con el uso.

---

## Los límites, que son parte del producto y no una disculpa

- **No consulta datos.** No ve órdenes, cierres ni dinero. Sólo explica cómo funciona la aplicación.
- **No ejecuta nada.** No asigna, no gestiona, no marca. Sin herramientas: la petición no lleva `tools`.
- **No inventa.** Si la respuesta no está en la documentación, dice «no lo sé» y señala dónde mirar.
- **Cada respuesta cita sus documentos**, enlazados a `/ayuda/<slug>`. Sin eso, quien lee no tiene
  forma de comprobar nada — y es además la vía por la que un usuario detecta que el asistente se
  equivocó.

Es deliberado: un asistente que se equivoque explicando un cierre tiene consecuencias, y uno que
además pudiera actuar las tendría mayores.

---

## Forma técnica

| Pieza | Decisión | Por qué |
| --- | --- | --- |
| Modelo | **Sonnet 5** (`claude-sonnet-5`) | lo recomienda el documento firmado y el trabajo es explicar texto que ya está escrito, no razonar de cero. Opus 5 cuesta 2,5× más para esto |
| Transporte | **Route Handler con streaming** (`app/api/asistente/route.ts`) | una respuesta larga sin streaming se come el tiempo de espera y el usuario ve una pantalla quieta. El runtime por defecto (Node) sirve: streaming NO exige `edge` |
| Caché | `cache_control: {type: "ephemeral"}` al final del bloque de documentación | es idéntico en todas las consultas de ese rol: el caso de libro |
| Pensamiento extendido | **no** | explicar documentación no lo necesita y dobla la latencia |
| Persistencia | **ninguna en la v1** | la conversación vive en el cliente. Guardarla es una tabla, una pantalla y una decisión de retención de datos que nadie ha pedido |
| Tope de gasto | por usuario y día, en el servidor | «costos sin tope fijado» es lo que el documento firmado pedía autorizar. Un tope lo vuelve innecesario |
| Audios | **fuera de la v1** | el modelo que responde no transcribe voz: es otro proveedor, otro contrato y otro coste. Se dice, no se promete |
| Imágenes | dentro, con el aviso visible en la propia pantalla | autorizado por el humano. El aviso no es burocracia: quien manda una captura tiene que saber que sale de casa |

### La trampa heredada de la 433 — y me equivoqué al describirla

Escribí arriba que «hay que añadir `app/api/asistente/route.ts` a `outputFileTracingIncludes`».
**Es falso, y comprobado contra el archivo:** `next.config.ts:59-61` declara la clave **`/**`** —todas
las páginas y rutas, no una lista— y `ayuda-md-viajan-a-produccion.guardia.test.ts` **exige** que siga
siendo `/**`, porque el trazado es por página y un layout no hereda el de sus hijos. Acotarla para
nombrar la ruta nueva pondría roja esa guardia. **No hay nada que añadir.**

Lo que sí falta es lo contrario, y es más sutil: **hoy nada mide que la ruta del asistente lea ese
catálogo**. Si alguien le pusiera otra fuente, la guardia seguiría verde y el asistente diría «no lo
sé» a todo en producción — verde en local, mudo en producción, que es la familia de fallo entera de
este repo. Por eso el spec lo convierte en requisito propio y en puerta de despliegue.

### Dónde vive

Un panel lateral que se abre **desde el mismo «?» del encabezado** que ya monta la ficha 433, con la
ayuda de esa pantalla ya cargada como contexto de la conversación. No es una ruta nueva ni un ítem más
del menú: quien está atascado no va a ir a buscarlo.

---

### Cómo encaja con lo que el repo ya hace

El repo ya tiene forma para esto y no hay que inventarla: un **puerto neutral** en
`lib/interfaces/external/` (sin Next, sin Prisma, sin `process.env`), un **adaptador de producción**
en `lib/clients/` y un **doble** para los tests. Es lo que hacen Google Routes, el geocodificador y
WhatsApp.

Para el asistente: `lib/interfaces/external/IAsistenteProvider.ts` +
`lib/clients/anthropic-asistente.ts` + un doble. **De ahí sale que se pueda construir entero antes de
que llegue la credencial**, y que la suite no dependa nunca de la red ni gaste un céntimo.

---

## LO ÚNICO QUE BLOQUEA: la credencial

Hace falta una **clave de API de Anthropic** (`ANTHROPIC_API_KEY`). No la puedo crear yo: nace de una
cuenta con forma de pago asociada.

**Lo que tiene que hacer el humano, una vez:**

1. Entrar a `console.anthropic.com` con la cuenta de la empresa.
2. *Billing* → cargar saldo. Con **$20 sobra para meses** (el uso estimado es ≈ $11/mes con los 37
   usuarios preguntando diez veces al día cada uno, que es mucho más de lo que va a pasar).
3. *API keys* → *Create key*. Nombre sugerido: `ordenex-asistente`.
4. Pasármela **una sola vez**. Va a `.env` (que está fuera de git) y a las variables de Vercel de
   `preview` y `production` por separado — nunca a una sola marcada en los dos entornos, que es el
   error que ya se cometió en este repo con la base de datos.

**Ojo con el paso 4:** una variable de Vercel de tipo `Secret` no se puede volver a leer ni por CLI ni
por el panel. Si se pierde, se rota; no se recupera. Igual que pasó con la contraseña de la base de
preview esta misma semana.

---

## Orden de trabajo

1. Cerrar la ficha 433 (revisión → merge → gate). **En curso.**
2. Registrar la ficha del asistente con `sdd: true` — aquí sí: hay dinero, hay datos de clientes
   saliendo de casa y hay un proveedor externo. Los tres motivos por los que existe el proceso.
3. Construir contra un doble del proveedor, que es lo que permite avanzar **sin la credencial**: toda
   la pieza —acotamiento por rol, citas, tope de gasto, streaming, la pantalla— se prueba sin gastar
   un céntimo ni depender de la red.
4. Enchufar la credencial cuando llegue y medir una consulta real de cada rol.
