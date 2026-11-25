# Guía paso a paso

Esta guía es para dejar tu página funcionando. No hace falta saber programar: solo copiar y pegar. Andá despacio, un paso por vez. Si algo no coincide con lo que ves en pantalla, avisame y lo vemos juntos.

## Los archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La página |
| `style.css` | El aspecto (colores, tamaños) |
| `app.js` | El funcionamiento |
| `config.js` | Dos datos tuyos que vas a completar |
| `setup.sql` | Prepara tu "nube" (se usa una sola vez) |

---

## PARTE 1 — Crear tu nube (Supabase)

Supabase es el servicio gratuito donde se van a guardar tus carpetas, links y archivos, para que los veas igual desde el celu y la compu.

**1.** Entrá a **supabase.com** y tocá **Start your project**. Creá una cuenta (podés usar tu cuenta de GitHub o un correo).

**2.** Tocá **New project**.
- Nombre: el que quieras (por ejemplo `notas`).
- **Database password**: inventá una clave y guardala en un lugar seguro.
- **Region**: elegí **South America (São Paulo)**, que es la más cercana.
- Tocá **Create new project** y esperá un par de minutos.

**3.** Preparar la base de datos:
- En el menú de la izquierda buscá **SQL Editor**.
- Tocá **New query**.
- Abrí el archivo `setup.sql` (con el Bloc de notas), copiá **todo** su contenido y pegalo ahí.
- Tocá **Run**. Tiene que decir que salió bien ("Success").

**4.** Crear tu usuario (con esto vas a entrar a la página):
- Menú izquierdo → **Authentication** → **Users**.
- Tocá **Add user** → **Create new user**.
- Poné tu correo y una clave. Tildá **Auto Confirm User** si aparece.
- Tocá **Create user**.

**5.** Impedir que se registre otra persona (importante):
- **Authentication** → **Sign In / Providers** (o "Providers").
- Buscá **Allow new users to sign up** y **desactivalo**.
- Guardá.

**6.** Conseguir los dos datos:
- Menú izquierdo → **Project Settings** (la ruedita) → **API** (o "API Keys").
- Copiá la **Project URL** (empieza con `https://`).
- Copiá la clave pública: se llama **anon public** o **publishable**. **No** uses la que dice *service_role* ni *secret*.

**7.** Abrí `config.js` con el Bloc de notas y reemplazá:
- `PEGA_AQUI_TU_URL` por tu Project URL.
- `PEGA_AQUI_TU_CLAVE_PUBLICA` por tu clave pública.

Dejá las comillas `' '` y guardá el archivo.

---

## PARTE 2 — Subirla a GitHub

**1.** En github.com tocá **New repository**.
- Nombre: algo neutro, por ejemplo `notas`.
- Tiene que ser **Public** (en el plan gratis, GitHub Pages lo exige).
- Tocá **Create repository**.

**2.** Tocá **uploading an existing file** y arrastrá estos 5 archivos: `index.html`, `style.css`, `app.js`, `config.js`, `setup.sql`. Después **Commit changes**.

**3.** Activar la página:
- **Settings** → **Pages**.
- En **Branch** elegí `main` y la carpeta `/ (root)`. Tocá **Save**.
- Esperá 1 o 2 minutos. Arriba te va a aparecer la dirección, parecida a `https://tuusuario.github.io/notas/`.

> **Qué es público y qué no:** el código de la página queda visible en GitHub, pero **no tiene ninguno de tus datos**. Tus links, carpetas y archivos están en Supabase, y solo se ven entrando con tu correo y tu clave.

---

## PARTE 3 — Usarla

- Abrí la dirección en una **ventana de incógnito** (en el celu: Chrome → ⋮ → *Nueva pestaña de incógnito*).
- Entrá con el correo y la clave que creaste en Supabase.
- Cuando cerrás la ventana incógnito, se cierra tu sesión y no queda nada guardado en el dispositivo.

### Qué hace cada cosa

- **Biblioteca**: guardás links de X y PH, o subís tus propios videos e imágenes. Los ordenás en carpetas, con etiquetas, favoritos y "ver después". Cuando abrís uno, se marca como visto.
- **Botón ＋ de cada tarjeta**: lo manda a la pantalla sin salir de la biblioteca, para ir juntando varios.
- **Pantalla**: podés tener todos los paneles que quieras a la vez (videos de X, de PH, tuyos, imágenes).
  - **Cuadrícula**: se reparten solos el espacio. Con ◀ ▶ cambiás el orden.
  - **Libre**: movés cada panel agarrando la barra de arriba y cambiás el tamaño con la esquina de abajo a la derecha.
  - **Fondo**: elegís una imagen tuya de fondo (se ve mejor en modo libre).
  - **Guardar escena / Escenas**: guardás tu combinación de paneles para abrirla de nuevo con un toque.
  - **Pausar todo**: frena los videos de todos los paneles.
- **Ritmo**: sonido de pulsos con varios modos (fijo, sube y baja, olas, escalones, al azar). Se maneja desde el botón *Ritmo* de arriba y funciona mientras mirás cualquier cosa.
- **Bloqueo**: el botón rojo **✕** (o apretar **Esc dos veces**) borra todo de la pantalla y cierra la sesión al instante. También se bloquea sola tras 30 minutos sin tocar nada (se cambia en `config.js`).

### Cosas a saber

- Los videos de X y PH se **muestran desde su sitio**, no se guardan en tu nube. Algunos videos no permiten mostrarse en otras páginas; en ese caso el panel te ofrece **Abrir en el sitio**.
- Los videos de X y PH no arrancan solos: los iniciás con su botón de play.
- Los archivos propios tienen un límite de tamaño por archivo en el plan gratis (alrededor de 50 MB).
- El plan gratis de Supabase tiene un total de espacio limitado (1 GB aproximadamente). Si se llena, se puede ampliar o cambiar a otro almacenamiento.
- Muchos videos a la vez pesan: en el celu conviene 2 o 3 paneles.

---

## Si algo no anda

- **"Falta completar config.js"**: no pegaste bien la URL o la clave (Parte 1, paso 7).
- **"Datos incorrectos"**: revisá el correo y la clave del usuario que creaste en el paso 4.
- **La página no carga después de subirla**: esperá unos minutos; GitHub Pages tarda en activarse.
- **No puedo subir archivos**: puede ser que pase del límite de tamaño, o que `setup.sql` no se haya ejecutado completo.

Si te trabás en cualquier paso, mandame lo que ves en pantalla (una captura sirve) y seguimos.
