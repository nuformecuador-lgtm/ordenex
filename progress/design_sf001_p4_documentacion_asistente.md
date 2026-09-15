# SF-001 · Punto 4 — Módulo de documentación + asistente con IA

**Estado: diseño en curso, acordado con el humano el 2026-09-15. No implementado, sin ficha.**
Estimado del documento: 12 a 19 días hábiles **para el software**. El contenido va aparte.

---

## CONDICIÓN QUE APLICA A LAS CUATRO FUNCIONALIDADES

**Instrucción del humano (2026-09-15):** *«ninguna de estas features va a salir a producción hasta
estar seguros de que está ok y no hace daño a lo que ya está funcionando».*

No es una frase de cortesía: las cuatro tocan cosas que hoy funcionan —el control del efectivo, el
número al que los clientes transfieren dinero, la regla que impide entregar antes de tiempo—. Vale
para todas, no solo para el punto 4.

---

## Lo que se verificó

| Afirmación del documento | Veredicto |
| --- | --- |
| Precios de la API de Claude (Opus 5 $5/$25, Sonnet 5 $2/$10, Haiku 4.5 $1/$5 por MTok) | **Exactos** |
| «36 usuarios activos» | **37** personas activas (+4 cuentas `apiKey`, que no son gente) |
| «19 módulos» | **16 dentro de la app** + 4 superficies públicas ≈ 20 |

**Dato que manda sobre el diseño: 18 de los 37 usuarios son mensajeros.** Casi la mitad. Son los que
están en la calle con el teléfono — los que justifican los audios y los que más van a usar el asistente.

## El tamaño real del contenido

29 pantallas dentro de la app + 4 públicas = **33 documentos**, muy desiguales:

| Tamaño | Módulos | Pantallas |
| --- | --- | --- |
| Grandes (40+ archivos) | órdenes (68), mis-asignaciones (62), configuración (53), wallet (44), analítica (42) | 14 |
| Medianos | cierres-admin (34), novedades (20), recepción-satélite (19), histórico (16), monitoreo (16) | 8 |
| Pequeños | mi-wallet, ranking, recolección, incidentes, cierre-día, inicio | 7 |
| Públicas | login, rastreo público, postulación, recuperar contraseña | 4 |

**El documento excluye este trabajo de su estimado, y lo dice**: «Aparte está escribir el contenido
inicial de los 19 módulos, que es el grueso real del esfuerzo».

---

## Decisiones del humano (2026-09-15)

### 1. La documentación la escribe Claude, no el cliente

**Redactar es lo barato; verificar es lo caro.** Documentación inventada es PEOR que ninguna: el
asistente la repetiría con total seguridad y el usuario no tendría cómo detectarlo. Precedente de esta
misma sesión: dos premisas del documento firmado resultaron falsas al comprobarlas contra el código
(«la aprobación de la central no dispara nada» y «hoy son la misma puerta»).

**Estimado: 5–8 días de Claude** verificando contra el código, **+ 2–3 días de revisión del humano**
repartidos — no escribiendo, solo confirmando lo que es cierto del negocio.

**Disciplina obligatoria: cada `.md` cita de dónde sale lo que afirma** (archivo y símbolo), en el
propio documento y no a la vista del usuario. Hace la revisión verificable en vez de un acto de fe, y
permite detectar después si el texto quedó obsoleto.

### 2. Primero la documentación, después la funcionalidad

**Orden de trabajo fijado por el humano.** Cuando se llegue a este punto, lo primero son los
documentos. El asistente sin contenido solo sabe decir «no lo sé» — correcto, pero inútil.

### 3. Una sola fuente, tres consumidores

```
docs/ayuda/*.md   ← archivos .md versionados en git
      ├──→ módulo de documentación dentro de la app   (lo que cualquiera lee)
      └──→ asistente                                   (lo que el asistente cita)
```

En el repositorio, **no en la base de datos**. Es lo que hace cumplible la promesa del documento
—«corregir un párrafo son minutos dentro del mismo cambio»—: solo es verdad si el texto viaja en el
mismo cambio que el código. Se puede reforzar con una guardia que falle si se toca una pantalla y no
su documentación. Coste aceptado: corregir una errata exige un despliegue.

Si documentación y asistente vivieran separados, el asistente acabaría contestando una cosa y la
pantalla mostrando otra. Fallo mudo.

### 4. Empezar por el mundo del mensajero

18 de 37 usuarios, y solo cuatro superficies: reparto, por recoger, recolección y mi-wallet.
**3–4 días** y cubre a la mitad de la gente. No se documentan las 33 de golpe: primero las que generan
preguntas de verdad.

---

## Hallazgo técnico: puede que RAG sobre

El documento argumenta que mandar toda la documentación cuesta 5–10 veces más que buscar fragmentos, y
por eso propone búsqueda de fragmentos. **Eso era cierto sin caché de prompt.** La documentación es
idéntica en todas las consultas —el caso de libro para cachear— y una lectura cacheada cuesta ~10% de
la entrada normal.

Con 37 usuarios y ~20 módulos es posible que **la documentación entera quepa en contexto, cacheada**, y
salga más simple: sin trocear, sin incrustaciones, y sin el fallo más peligroso de RAG —que el buscador
traiga el fragmento equivocado y el asistente responda mal con toda seguridad—.

**No está afirmado: depende de cuánto ocupe la documentación, y eso solo se sabe cuando exista.**
Medirlo antes de construir la pieza más compleja. Es otra razón para escribir primero.

---

## Pendiente del humano: las tres autorizaciones que el documento pide por escrito

1. **Imágenes y audios con datos de clientes** (nombres, teléfonos, direcciones, montos) procesados por
   un proveedor externo de IA.
2. **Costos de operación sin tope fijado**, que crecen con el uso.
3. **Qué modelo.** El documento recomienda Sonnet 5.

Y sigue sin leerse el PDF firmado: no se sabe cuáles de las cuatro se aprobaron ni en qué orden.
