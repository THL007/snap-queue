// Renders the app icons (pear card stock, "SQ" in Chillax ink) with headless Chrome.
const puppeteer = require("/home/projects/hallmark-tools/node_modules/puppeteer-core");
const CHROME = "/home/projects/hallmark-tools/browsers/chrome-headless-shell/linux-157.0.8103.78/chrome-headless-shell-linux64/chrome-headless-shell";
const out = (f) => require("path").join(__dirname, "..", f);
const html = (s, round) => `<html><head><style>${require("fs").readFileSync(require("path").join(__dirname,"..","src/styles/fonts.css"),"utf8")}</style><style>
html,body{margin:0;width:${s}px;height:${s}px;background:${round ? "transparent" : "oklch(87% 0.175 96)"}}
div{width:${s}px;height:${s}px;display:grid;place-items:center;background:oklch(87% 0.175 96);border-radius:${round ? s * 0.22 : 0}px;
font:600 ${s * 0.4}px/1 Chillax,sans-serif;letter-spacing:-0.04em;color:oklch(20% 0.014 255);box-shadow:inset 0 -${s * 0.05}px 0 oklch(72% 0.16 92)}
</style></head><body><div>SQ</div></body></html>`;
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
  const p = await b.newPage();
  for (const [file, s, round] of [["assets/icon.png", 1024, false], ["assets/favicon.png", 48, true], ["public/icon-192.png", 192, false], ["public/icon-512.png", 512, false], ["public/apple-touch-icon.png", 180, false]]) {
    await p.setViewport({ width: s, height: s });
    await p.setContent(html(s, round), { waitUntil: "load" });
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: out(file), omitBackground: round });
  }
  await b.close();
  console.log("icons ok");
})();
