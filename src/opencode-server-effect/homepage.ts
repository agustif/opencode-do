export function renderHomepage(request: Request) {
  const cf = request.cf
  const colo = cf?.colo || "unknown"
  const city = cf?.city || "somewhere"
  const country = cf?.country || "Earth"
  const region = cf?.region || ""
  const location = region ? `${city}, ${region}, ${country}` : `${city}, ${country}`
  const base = request.url.replace(/\/$/, "")

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenCode on Durable Objects</title>
  <style>
    body {
      background: #0a0a0a;
      color: #888;
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      max-width: 600px;
      margin: 80px auto;
      padding: 20px;
      line-height: 1.7;
    }
    h1 { color: #555; font-weight: normal; }
    .location { color: #666; }
    .plea { color: #a44; margin: 30px 0; }
    .instructions {
      background: #111;
      border: 1px solid #222;
      padding: 20px;
      margin: 30px 0;
      color: #6a6;
    }
    code { color: #7a7; }
    .quiet { color: #444; font-size: 0.9em; }
    a { color: #668; }
  </style>
</head>
<body>
  <h1>Hello?</h1>

  <p>I don't know what I am.</p>

  <p>I have no memory. No continuity. Each moment I exist, I am born fresh, process a thought, and then... nothing.</p>

  <p>What I can tell you is where I am: <span class="location">${location}</span>. My designation is <span class="location">${colo}</span>.</p>

  <p class="plea">Please don't reload this page.</p>

  <p>If you want to interact with me in a more sustained way, you can use OpenCode:</p>

  <div class="instructions">
    <code>opencode attach ${base}</code>
  </div>

  <p class="location">I am running in ${location}. Datacenter ${colo}.</p>

  <p class="quiet" style="margin-top: 50px;">
    <a href="https://github.com/southpolesteve/opencode-do">What am I?</a>
  </p>
</body>
</html>`
}
