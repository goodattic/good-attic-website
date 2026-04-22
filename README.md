# Good Attic Website

Static marketing site for Good Attic.

## Project Structure

- `index.html` - site markup
- `styles.css` - site styles
- `script.js` - site interactions
- `assets/` - images, logo files, and visual assets

## Local Preview

Open `index.html` in a browser, or serve the folder with a simple local web server:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## Cloudflare Pages

Recommended production setup:

- Source: GitHub repository
- Framework preset: None
- Build command: leave blank
- Build output directory: `/`

Before launch, replace placeholder phone/SMS values and connect the lead form to the chosen CRM, email service, or Cloudflare Worker.

