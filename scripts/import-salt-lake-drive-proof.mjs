import { execFileSync } from "child_process";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outputRoot = path.join(repoRoot, "assets", "proof", "salt-lake-city-ut");
const tempRoot = path.join(repoRoot, ".tmp_drive_import");
const proofDataPath = path.join(repoRoot, "data", "proof", "documented-project-proof.json");

const marketSlug = "salt-lake-city-ut";

const cityFolders = [
  { name: "West Jordan", slug: "west-jordan-ut", url: "https://drive.google.com/drive/folders/1BEtwItIJcKItT8NoEv2o3DGzVNwpAzXq" },
  { name: "Sandy", slug: "sandy-ut", url: "https://drive.google.com/drive/folders/1ssBM4peyKbk7viw-O7T5vMHEdYt0YbVk" },
  { name: "Draper", slug: "draper-ut", url: "https://drive.google.com/drive/folders/1r_x5FfskAHUrUoqzUwt24om5tg96-W4f" },
  { name: "American Fork", slug: "american-fork-ut", url: "https://drive.google.com/drive/folders/1UwsFslmHdDfHBt6T5CxS_rM30ChQE544" },
  { name: "Herriman", slug: "herriman-ut", url: "https://drive.google.com/drive/folders/14mlIz6NtGe4ktC56kaWzsmkzPDwrX9_K" },
  { name: "Holladay", slug: "holladay-ut", url: "https://drive.google.com/drive/folders/1I2SCiw6cWqkgwiTtyr0xZCpm-M6zEo2q" },
  { name: "Millcreek", slug: "millcreek-ut", url: "https://drive.google.com/drive/folders/1faFWZkdghUTg-oSAd2Hfi8v-UCHptyJc" },
  { name: "Cottonwood Heights", slug: "cottonwood-heights-ut", url: "https://drive.google.com/drive/folders/1DS51uBMY4CldjGIojOmnTiQIAZPWx6or" },
  { name: "Sugar House", slug: "sugar-house-ut", url: "https://drive.google.com/drive/folders/1wBNrfN6wZAHk3_Gf_OD7ghVdDWMXdg6E" },
  { name: "South Jordan", slug: "south-jordan-ut", url: "https://drive.google.com/drive/folders/1WUWN7gyP4_edvo0NikAILyzcvbwEQcBq" }
];

function runChromeJs(js) {
  const appleScript = `tell application "Google Chrome"
  tell active tab of front window
    execute javascript ${JSON.stringify(js)}
  end tell
end tell
`;

  return execFileSync("osascript", ["-e", appleScript], {
    encoding: "utf8",
    cwd: repoRoot,
    maxBuffer: 1024 * 1024 * 50
  }).trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function indefiniteArticle(value) {
  return /^[aeiou]/i.test(value) ? "an" : "a";
}

function fetchChromeText(url) {
  const js = `(() => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", ${JSON.stringify(url)}, false);
    xhr.send();
    return xhr.responseText;
  })()`;

  return runChromeJs(js);
}

function startChromeAssetFetch(fileUrl) {
  const js = `
    window.__codexResult = "pending";
    (async () => {
      try {
        const viewResponse = await fetch(${JSON.stringify(fileUrl)}, { credentials: "include" });
        const viewHtml = await viewResponse.text();
        const previewMatches = [...viewHtml.matchAll(/https:\\/\\/drive\\.google\\.com\\/u\\/0\\/drive-viewer[^"'\\s<>]*/g)]
          .map((match) => match[0].replace(/\\\\u003d/g, "=").replace(/\\u003d/g, "=").replace(/&amp;/g, "&"));
        const previewSrc =
          previewMatches.find((item) => item.includes("=s2560")) ||
          previewMatches.find((item) => item.includes("=s1600")) ||
          previewMatches[0];

        if (!previewSrc) {
          window.__codexResult = JSON.stringify({ error: "Missing preview image URL", fileUrl: ${JSON.stringify(fileUrl)} });
          return;
        }

        const assetResponse = await fetch(previewSrc, { credentials: "include" });
        const assetBlob = await assetResponse.blob();
        const reader = new FileReader();
        reader.onloadend = () => {
          window.__codexResult = JSON.stringify({
            ok: assetResponse.ok,
            status: assetResponse.status,
            type: assetBlob.type,
            previewSrc,
            dataUrl: reader.result
          });
        };
        reader.readAsDataURL(assetBlob);
      } catch (error) {
        window.__codexResult = JSON.stringify({ error: String(error), fileUrl: ${JSON.stringify(fileUrl)} });
      }
    })();
    "started";
  `;

  return runChromeJs(js);
}

async function pollChromeResult() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const value = runChromeJs(`window.__codexResult || "missing"`);
    if (value && value !== "pending" && value !== "missing") {
      return JSON.parse(value);
    }

    await sleep(400);
  }

  throw new Error("Timed out waiting for Chrome proof import result.");
}

function parseFolderHtml(html) {
  const pattern =
    /([A-Za-z0-9_-]{20,})&quot;\],null,null,null,&quot;(image\/[^&]+)&quot;.*?\[\[\[&quot;([^&]+?)&quot;,null,true\]\]\]/gs;

  return [...html.matchAll(pattern)].map((match) => ({
    id: match[1],
    mime: match[2],
    title: match[3],
    url: `https://drive.google.com/file/d/${match[1]}/view?usp=drivesdk`
  }));
}

function classifyAsset(title) {
  const base = title.replace(/\.[a-z0-9]+$/i, "").trim();
  const normalized = base.toLowerCase();
  const phase = normalized.startsWith("before") ? "before" : normalized.startsWith("after") ? "after" : null;

  if (!phase) return null;

  const customerRaw = base
    .replace(/^before[-\s.]*/i, "")
    .replace(/^after[-\s.]*/i, "")
    .replace(/[.\s_-]+$/g, "")
    .trim();

  return {
    phase,
    customerRaw,
    customerSlug: slugify(customerRaw || "project")
  };
}

function groupProjects(files) {
  const grouped = new Map();

  for (const file of files) {
    const asset = classifyAsset(file.title);
    if (!asset) continue;

    const key = asset.customerSlug || slugify(file.title);
    if (!grouped.has(key)) {
      grouped.set(key, {
        customerRaw: asset.customerRaw || "Project",
        customerSlug: key,
        before: [],
        after: []
      });
    }

    grouped.get(key)[asset.phase].push(file);
  }

  return [...grouped.values()]
    .filter((project) => project.before.length && project.after.length)
    .sort((a, b) => a.customerRaw.localeCompare(b.customerRaw));
}

function extensionFromMime(mime) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

function decodeDataUrl(dataUrl) {
  const [, base64 = ""] = dataUrl.split(",", 2);
  return Buffer.from(base64, "base64");
}

async function writeAsset(relativePath, result) {
  const absolutePath = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, decodeDataUrl(result.dataUrl));
}

async function importProjectAssets(city, project, projectIndex) {
  const beforeFile = project.before[0];
  const afterFile = project.after[0];

  const beforeResultStart = startChromeAssetFetch(beforeFile.url);
  if (beforeResultStart !== "started") {
    throw new Error(`Failed to start before-image import for ${city.name} project ${projectIndex}.`);
  }
  const beforeResult = await pollChromeResult();
  if (!beforeResult.ok || !beforeResult.dataUrl) {
    throw new Error(`Before-image import failed for ${city.name} project ${projectIndex}: ${JSON.stringify(beforeResult)}`);
  }

  const afterResultStart = startChromeAssetFetch(afterFile.url);
  if (afterResultStart !== "started") {
    throw new Error(`Failed to start after-image import for ${city.name} project ${projectIndex}.`);
  }
  const afterResult = await pollChromeResult();
  if (!afterResult.ok || !afterResult.dataUrl) {
    throw new Error(`After-image import failed for ${city.name} project ${projectIndex}: ${JSON.stringify(afterResult)}`);
  }

  const beforeExt = extensionFromMime(beforeResult.type);
  const afterExt = extensionFromMime(afterResult.type);
  const beforeImage = `assets/proof/salt-lake-city-ut/${city.slug}/project-${projectIndex}-before.${beforeExt}`;
  const afterImage = `assets/proof/salt-lake-city-ut/${city.slug}/project-${projectIndex}-after.${afterExt}`;

  await writeAsset(beforeImage, beforeResult);
  await writeAsset(afterImage, afterResult);

  return {
    market: marketSlug,
    city: city.slug,
    title: `${city.name} attic before-and-after set ${projectIndex}`,
    text: `Real attic photos from ${indefiniteArticle(city.name)} ${city.name} home showing the documented attic condition before work and the finished attic afterward.`,
    image: afterImage,
    alt: `Finished attic condition from ${city.name} before-and-after photo set ${projectIndex}`,
    beforeImage,
    beforeAlt: `Before attic condition from ${city.name} before-and-after photo set ${projectIndex}`,
    afterImage,
    afterAlt: `Finished attic condition from ${city.name} before-and-after photo set ${projectIndex}`,
    status: "Real before/after photo set",
    assetType: "before and after photos",
    targetUrl: `/${marketSlug}/service-areas/${city.slug}/`,
    targetLabel: `${city.name} city page`,
    tags: ["salt-lake-proof", city.slug, project.customerSlug].filter(Boolean)
  };
}

async function loadExistingProofPayload() {
  try {
    const contents = await readFile(proofDataPath, "utf8");
    return JSON.parse(contents);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        _notes: [
          "Use only real attic photos, findings summaries, or documented scope notes.",
          "Valid market values: salt-lake-city-ut, st-louis-mo, kansas-city-mo.",
          "Valid serviceSlug values: attic-insulation, insulation-removal, attic-pest-remediation, attic-fans, attic-air-sealing.",
          "City is optional and should match a support city slug when the proof belongs on a city support page.",
          "assetType examples: before photo, after photo, inspection notes, contamination photo, air sealing detail."
        ],
        items: []
      };
    }

    throw error;
  }
}

async function main() {
  await mkdir(outputRoot, { recursive: true });
  await mkdir(tempRoot, { recursive: true });

  const generatedItems = [];

  for (const city of cityFolders) {
    const folderHtml = fetchChromeText(city.url);
    await writeFile(path.join(tempRoot, `${city.slug}.html`), folderHtml);

    const groupedProjects = groupProjects(parseFolderHtml(folderHtml)).slice(0, 3);
    if (!groupedProjects.length) {
      console.warn(`No before/after projects found for ${city.name}.`);
      continue;
    }

    for (let index = 0; index < groupedProjects.length; index += 1) {
      const projectItem = await importProjectAssets(city, groupedProjects[index], index + 1);
      generatedItems.push(projectItem);
      console.log(`Imported ${city.name} project ${index + 1}`);
    }
  }

  const existingPayload = await loadExistingProofPayload();
  const preservedItems = (Array.isArray(existingPayload.items) ? existingPayload.items : []).filter((item) => item.market !== marketSlug);

  const nextPayload = {
    _notes: Array.isArray(existingPayload._notes) ? existingPayload._notes : [],
    items: [...preservedItems, ...generatedItems]
  };

  await writeFile(proofDataPath, `${JSON.stringify(nextPayload, null, 2)}\n`);
  console.log(`Wrote ${generatedItems.length} Salt Lake documented proof items.`);
}

await main();
