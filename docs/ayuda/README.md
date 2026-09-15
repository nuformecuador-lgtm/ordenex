---
titulo: Ayuda de Ordenex
modulo: indice
roles: [todos]
actualizado: 2026-09-15
---

# Ayuda de Ordenex

Esta carpeta es **la única fuente de la documentación de uso**. La leen dos consumidores:

- **El módulo de documentación** dentro de la aplicación — lo que cualquiera abre y lee.
- **El asistente** — lo único sobre lo que puede responder. Si algo no está acá, el asistente dice
  «no lo sé» en vez de inventarlo.

Por eso viven en el repositorio y no en la base de datos: **la documentación se actualiza en el mismo
cambio que el código**. Si tocás una pantalla y no tocás su documento, el documento empieza a mentir.

## Cómo está organizada

| Carpeta | Para quién |
| --- | --- |
| `mensajero/` | Los mensajeros — 18 de los 37 usuarios activos |
| `tienda/` | Los administradores de tienda |
| `satelite/` | Los administradores de bodega satélite |
| `oficina/` | Maestro y administradores |
| `compartido/` | Pantallas que varios roles ven, con el alcance distinto |
| `publico/` | Sin necesidad de iniciar sesión |

## El frontmatter, y para qué sirve cada campo

```yaml
titulo: Reparto              # el nombre que ve el usuario
modulo: mis-asignaciones     # el módulo al que pertenece
pantalla: /ruta              # la ruta real
roles: [mensajero]           # quién ve esa pantalla
actualizado: 2026-09-15
fuentes:                     # de dónde sale lo que el documento afirma
  - ruta/al/archivo.tsx
```

**`fuentes` es el campo que sostiene todo lo demás.** No se muestra al usuario: existe para que
cualquier afirmación sea auditable, y para saber qué documentos revisar cuando un archivo cambie.
Documentación inventada es peor que ninguna — el asistente la repetiría con total seguridad y el
usuario no tendría cómo detectarlo.

## Cómo se escribe acá

- **En el idioma de quien lee**, no en el nuestro. Para el mensajero: «la entregaste», no «gestión
  entregada». Nada de siglas ni jerga interna.
- **Cada documento termina en «Lo que esta pantalla NO hace».** De ahí sale la mitad de las preguntas
  reales: «¿por qué no puedo recoger acá?», «¿dónde veo mi plata?».
- **Los avisos de riesgo se destacan.** Si una acción mueve dinero o corta el acceso de alguien, se
  dice antes de explicar cómo se hace.
- **Solo se afirma lo verificado en el código.** El *qué* sale del código; el *por qué* del negocio se
  confirma con el humano antes de escribirlo como cierto.

## Deuda conocida

- **`satelite/en-bodega.md` va a quedar obsoleto a propósito.** Documenta que un cierre de bodega
  pendiente impide asignar trabajo nuevo — exactamente el bloqueo que el punto 1 de SF-001 retira.
  Cuando se implemente, hay que volver a ese documento.
- **`oficina/configuracion-plantillas.md`** dice que el número de SINPE se configura fuera de la
  aplicación. El punto 2 de SF-001 lo cambia.
