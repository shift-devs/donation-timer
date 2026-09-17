Prize art for the mystery box goes in here.

Drop PNG/JPG/GIF/WEBP/AVIF/SVG files into this folder and they show up in the Mystery Box tab's
image picker. The list is read at build time (vite.config.ts), so adding a file needs a dev-server
restart in development, or a rebuild in production — same as public/media and public/banners.

Square art works best: the reel draws every prize in the same box and letterboxes anything that
isn't. A prize with no image still works, it just shows its name on the reel instead.
