import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const siteFolder = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const htmlPages = ["index.html", "research.html", "students.html", "digit-lab/index.html"];

function localReferences(html) {
  const references = [];
  const pattern = /\b(?:href|src)="([^"]+)"/g;
  for (const match of html.matchAll(pattern)) {
    const reference = match[1];
    if (
      reference.startsWith("#") ||
      reference.startsWith("mailto:") ||
      reference.startsWith("tel:") ||
      /^[a-z]+:/i.test(reference)
    ) {
      continue;
    }
    references.push(reference.split("#")[0].split("?")[0]);
  }
  return references.filter(Boolean);
}

for (const page of htmlPages) {
  test(`${page} has unique IDs and existing local links`, async () => {
    const pagePath = resolve(siteFolder, page);
    const html = await readFile(pagePath, "utf8");
    assert.match(html, /<meta name="viewport"/);
    assert.match(html, /<title>[^<]+<\/title>/);

    const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, `duplicate ID in ${page}`);

    for (const reference of localReferences(html)) {
      let target = resolve(dirname(pagePath), reference);
      if (reference.endsWith("/")) target = resolve(target, "index.html");
      await access(target);
    }
  });
}

test("digit lab manifest points to compact model assets", async () => {
  const manifest = JSON.parse(
    await readFile(resolve(siteFolder, "digit-lab/model-manifest.json"), "utf8"),
  );
  for (const model of [manifest.knn, manifest.cnn]) {
    const modelPath = resolve(siteFolder, "digit-lab", model.file);
    const information = await stat(modelPath);
    assert.equal(information.size, model.byteLength);
    assert.equal(extname(modelPath), ".bin");
    const payload = await readFile(modelPath);
    assert.equal(createHash("sha256").update(payload).digest("hex"), model.sha256);
  }
  assert.ok(manifest.knn.byteLength < 100_000);
  assert.ok(manifest.cnn.byteLength < 2_000_000);
});

test("homepage and sitemap expose the permanent lab address", async () => {
  const homepage = await readFile(resolve(siteFolder, "index.html"), "utf8");
  const sitemap = await readFile(resolve(siteFolder, "sitemap.xml"), "utf8");
  assert.match(homepage, /href="digit-lab\/"/);
  assert.match(sitemap, /https:\/\/zoharkomargodski\.com\/digit-lab\//);
});
