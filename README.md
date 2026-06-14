# WebReady

WebReady converts common image formats into lightweight WebP files. The hosted
version performs all conversion locally in the browser, so images are never
uploaded to a server.

## Hosted version

The static site is in `web/`. It requires no framework, build command, backend,
or environment variables.

Run it locally:

```powershell
npx wrangler dev
```

Deploy it directly to Cloudflare:

```powershell
npx wrangler deploy
```

For Cloudflare Pages with GitHub integration, use:

- Build command: leave empty
- Build output directory: `web`

## Portable Windows version

`image_converter.py` is the source for the portable desktop edition. It uses
Tkinter and Pillow and can be packaged with PyInstaller.
