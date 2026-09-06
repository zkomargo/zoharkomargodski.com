import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DigitModels } from "../digit-lab/model-runtime.js";

const siteFolder = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(resolve(siteFolder, "digit-lab/model-manifest.json"), "utf8"),
);

function exactArrayBuffer(nodeBuffer) {
  return nodeBuffer.buffer.slice(
    nodeBuffer.byteOffset,
    nodeBuffer.byteOffset + nodeBuffer.byteLength,
  );
}

const knnFile = await readFile(resolve(siteFolder, "digit-lab", manifest.knn.file));
const cnnFile = await readFile(resolve(siteFolder, "digit-lab", manifest.cnn.file));
const models = new DigitModels(
  manifest,
  exactArrayBuffer(knnFile),
  exactArrayBuffer(cnnFile),
);

function cnnPattern(name) {
  const pixels = new Float32Array(28 * 28);
  if (name === "vertical") {
    for (let y = 4; y < 24; y += 1) {
      pixels[y * 28 + 13] = 1;
      pixels[y * 28 + 14] = 1;
    }
  } else if (name === "gradient") {
    for (let position = 0; position < pixels.length; position += 1) {
      pixels[position] = ((position * 37 + 11) % 256) / 255;
    }
  }
  return pixels;
}

test("exported KNN data has the documented dimensions", () => {
  assert.equal(models.knnVectors.length, 1347 * 64);
  assert.equal(models.knnLabels.length, 1347);
  assert.equal(Math.max(...models.knnVectors), 16);
  assert.equal(Math.min(...models.knnLabels), 0);
  assert.equal(Math.max(...models.knnLabels), 9);
});

for (const [name, fixture] of Object.entries(manifest.testFixtures.knn)) {
  test(`KNN agrees with Python for ${name}`, () => {
    const query = name === "exactFirst"
      ? Float32Array.from(models.getKNNVector(0))
      : new Float32Array(64).fill(7.25);
    const result = models.predictKNN(query);
    assert.equal(result.prediction, fixture.prediction);
    assert.deepEqual(result.neighbors.map((neighbor) => neighbor.index), fixture.indices);
    assert.deepEqual(result.neighbors.map((neighbor) => neighbor.label), fixture.labels);
    result.neighbors.forEach((neighbor, rank) => {
      assert.ok(Math.abs(neighbor.distance - fixture.distances[rank]) < 1e-9);
      assert.ok(Math.abs(neighbor.influence - fixture.influences[rank]) < 1e-12);
    });
    result.votes.forEach((vote, position) => {
      assert.ok(Math.abs(vote - fixture.votes[position]) < 1e-12);
    });
  });
}

for (const [name, expectedLogits] of Object.entries(manifest.testFixtures.cnn)) {
  test(`CNN agrees with PyTorch for ${name}`, () => {
    const result = models.predictCNN(cnnPattern(name));
    let maximumDifference = 0;
    result.logits.forEach((logit, position) => {
      maximumDifference = Math.max(
        maximumDifference,
        Math.abs(logit - expectedLogits[position]),
      );
    });
    assert.ok(
      maximumDifference < 2e-4,
      `maximum logit difference was ${maximumDifference}`,
    );
    const expectedPrediction = expectedLogits.indexOf(Math.max(...expectedLogits));
    assert.equal(result.prediction, expectedPrediction);
    const scoreTotal = Array.from(result.scores).reduce((sum, score) => sum + score, 0);
    assert.ok(Math.abs(scoreTotal - 1) < 1e-12);
  });
}
