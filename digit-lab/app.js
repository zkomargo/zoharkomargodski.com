const ACCESS_DIGEST = "49d180ecf56132819571bf39d9b7b342522a2ac6d23c1418d3338251bfe469c8";
const ACCESS_SESSION_KEY = "digit-lab-classroom-access-v1";
const LOGICAL_CANVAS_SIZE = 480;
const BRUSH_WIDTH = 32;
const drawingCanvas = document.querySelector("#drawing-canvas");
const drawingContext = drawingCanvas.getContext("2d", { willReadFrequently: true });
const guessButton = document.querySelector("#guess-button");
const clearButton = document.querySelector("#clear-button");
const modelStatus = document.querySelector("#model-status");
const modelStatusText = document.querySelector("#model-status-text");
const announcement = document.querySelector("#result-announcement");
const comparison = document.querySelector("#comparison");

let models = null;
let lastPoint = null;
let activePointer = null;
let hasInk = false;

function sessionHasAccess() {
  try {
    return window.sessionStorage.getItem(ACCESS_SESSION_KEY) === ACCESS_DIGEST;
  } catch {
    return false;
  }
}

function rememberAccess() {
  try {
    window.sessionStorage.setItem(ACCESS_SESSION_KEY, ACCESS_DIGEST);
  } catch {
    // Some strict privacy modes disable storage. The page still unlocks for
    // this visit; it will simply ask again after a refresh.
  }
}

async function passwordDigest(password) {
  if (!globalThis.crypto?.subtle || !globalThis.TextEncoder) {
    throw new Error("This browser cannot check the classroom password.");
  }
  const bytes = new TextEncoder().encode(password);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function unlockPage() {
  document.body.classList.remove("is-locked");
  document.querySelector("#access-gate").hidden = true;
  document.querySelector("#lab-title").focus({ preventScroll: true });
}

function requestClassroomAccess() {
  if (sessionHasAccess()) {
    unlockPage();
    return Promise.resolve();
  }

  const form = document.querySelector("#access-form");
  const password = document.querySelector("#access-password");
  const errorMessage = document.querySelector("#access-error");
  password.focus({ preventScroll: true });

  return new Promise((resolve) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      password.removeAttribute("aria-invalid");
      errorMessage.textContent = "Checking…";
      try {
        const submittedDigest = await passwordDigest(password.value.trim());
        if (submittedDigest !== ACCESS_DIGEST) {
          errorMessage.textContent = "That password is not correct. Please try again.";
          password.setAttribute("aria-invalid", "true");
          password.value = "";
          password.focus();
          return;
        }
        rememberAccess();
        unlockPage();
        resolve();
      } catch (error) {
        console.error(error);
        errorMessage.textContent = "This browser could not check the password. Please try a newer browser.";
      }
    });
  });
}

function setDrawingStyle() {
  drawingContext.strokeStyle = "#ffffff";
  drawingContext.fillStyle = "#ffffff";
  drawingContext.lineWidth = BRUSH_WIDTH;
  drawingContext.lineCap = "round";
  drawingContext.lineJoin = "round";
}

function initializeDrawingCanvas() {
  // Limit the pixel ratio to two: drawings remain crisp without making the
  // crop scan unnecessarily expensive on very high-density phone screens.
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  drawingCanvas.width = Math.round(LOGICAL_CANVAS_SIZE * pixelRatio);
  drawingCanvas.height = Math.round(LOGICAL_CANVAS_SIZE * pixelRatio);
  drawingContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawingContext.fillStyle = "#000000";
  drawingContext.fillRect(0, 0, LOGICAL_CANVAS_SIZE, LOGICAL_CANVAS_SIZE);
  setDrawingStyle();
}

function clearDrawing() {
  drawingContext.save();
  drawingContext.fillStyle = "#000000";
  drawingContext.fillRect(0, 0, LOGICAL_CANVAS_SIZE, LOGICAL_CANVAS_SIZE);
  drawingContext.restore();
  hasInk = false;
  lastPoint = null;
  resetResults();
  drawingCanvas.focus({ preventScroll: true });
}

function canvasPoint(event) {
  const bounds = drawingCanvas.getBoundingClientRect();
  return {
    x: ((event.clientX - bounds.left) / bounds.width) * LOGICAL_CANVAS_SIZE,
    y: ((event.clientY - bounds.top) / bounds.height) * LOGICAL_CANVAS_SIZE,
  };
}

function beginStroke(event) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  event.preventDefault();
  // A changed drawing needs a fresh answer. Remove the old neighbors and
  // scores as soon as the visitor starts the next stroke.
  if (comparison.classList.contains("has-result")) resetResults();
  activePointer = event.pointerId;
  drawingCanvas.setPointerCapture(event.pointerId);
  lastPoint = canvasPoint(event);
  drawingContext.beginPath();
  drawingContext.arc(lastPoint.x, lastPoint.y, BRUSH_WIDTH / 2, 0, Math.PI * 2);
  drawingContext.fill();
  hasInk = true;
}

function continueStroke(event) {
  if (event.pointerId !== activePointer || lastPoint === null) return;
  event.preventDefault();
  const nextPoint = canvasPoint(event);
  drawingContext.beginPath();
  drawingContext.moveTo(lastPoint.x, lastPoint.y);
  drawingContext.lineTo(nextPoint.x, nextPoint.y);
  drawingContext.stroke();
  lastPoint = nextPoint;
  hasInk = true;
}

function finishStroke(event) {
  if (event.pointerId !== activePointer) return;
  lastPoint = null;
  activePointer = null;
  if (drawingCanvas.hasPointerCapture(event.pointerId)) {
    drawingCanvas.releasePointerCapture(event.pointerId);
  }
}

function pythonRound(value) {
  // Python rounds exact halves to the nearest even integer; JavaScript always
  // rounds them upward. Matching Python keeps the fitted digit size identical.
  const lower = Math.floor(value);
  const fraction = value - lower;
  if (Math.abs(fraction - 0.5) < Number.EPSILON * 8) {
    return lower % 2 === 0 ? lower : lower + 1;
  }
  return Math.round(value);
}

function findInkBounds() {
  const width = drawingCanvas.width;
  const height = drawingCanvas.height;
  const pixels = drawingContext.getImageData(0, 0, width, height).data;
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (pixels[rowStart + x * 4] === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (right < left || bottom < top) return null;
  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

function fitDrawing(bounds, outputSize, digitBox) {
  const scale = Math.min(digitBox / bounds.width, digitBox / bounds.height);
  const resizedWidth = Math.max(1, pythonRound(bounds.width * scale));
  const resizedHeight = Math.max(1, pythonRound(bounds.height * scale));
  const output = document.createElement("canvas");
  output.width = outputSize;
  output.height = outputSize;
  const context = output.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#000000";
  context.fillRect(0, 0, outputSize, outputSize);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    drawingCanvas,
    bounds.left,
    bounds.top,
    bounds.width,
    bounds.height,
    Math.floor((outputSize - resizedWidth) / 2),
    Math.floor((outputSize - resizedHeight) / 2),
    resizedWidth,
    resizedHeight,
  );

  const imageData = context.getImageData(0, 0, outputSize, outputSize).data;
  const brightness = new Float32Array(outputSize * outputSize);
  for (let position = 0; position < brightness.length; position += 1) {
    brightness[position] = imageData[position * 4] / 255;
  }
  return brightness;
}

function shiftCenterOfMass(pixels, size) {
  let total = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = pixels[y * size + x];
      total += value;
      weightedX += value * x;
      weightedY += value * y;
    }
  }
  if (total === 0) return pixels;

  const shiftX = 13.5 - weightedX / total;
  const shiftY = 13.5 - weightedY / total;
  const shifted = new Float32Array(pixels.length);

  // For each destination pixel, sample the old image at the inverse-shifted
  // coordinate with bilinear interpolation, using black beyond the boundary.
  for (let y = 0; y < size; y += 1) {
    const sourceY = y - shiftY;
    const y0 = Math.floor(sourceY);
    const yFraction = sourceY - y0;
    for (let x = 0; x < size; x += 1) {
      const sourceX = x - shiftX;
      const x0 = Math.floor(sourceX);
      const xFraction = sourceX - x0;
      let value = 0;

      for (let yStep = 0; yStep <= 1; yStep += 1) {
        const sampleY = y0 + yStep;
        if (sampleY < 0 || sampleY >= size) continue;
        const yWeight = yStep === 0 ? 1 - yFraction : yFraction;
        for (let xStep = 0; xStep <= 1; xStep += 1) {
          const sampleX = x0 + xStep;
          if (sampleX < 0 || sampleX >= size) continue;
          const xWeight = xStep === 0 ? 1 - xFraction : xFraction;
          value += pixels[sampleY * size + sampleX] * xWeight * yWeight;
        }
      }
      shifted[y * size + x] = Math.min(1, Math.max(0, value));
    }
  }

  return shifted;
}

function prepareForModels() {
  const bounds = findInkBounds();
  if (bounds === null) return null;
  const knnBrightness = fitDrawing(bounds, 8, 6);
  const knnVector = Float32Array.from(knnBrightness, (value) => value * 16);
  const cnnUncentered = fitDrawing(bounds, 28, 20);
  const cnnPixels = shiftCenterOfMass(cnnUncentered, 28);
  return { knnVector, cnnPixels };
}

function paintPixelPreview(canvas, values, maximum) {
  const size = Math.round(Math.sqrt(values.length));
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const image = context.createImageData(size, size);
  for (let position = 0; position < values.length; position += 1) {
    const brightness = Math.round(Math.min(1, Math.max(0, values[position] / maximum)) * 255);
    image.data[position * 4] = brightness;
    image.data[position * 4 + 1] = brightness;
    image.data[position * 4 + 2] = brightness;
    image.data[position * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

function percentage(value, decimalPlaces = 0) {
  return `${(value * 100).toFixed(decimalPlaces)}%`;
}

function renderKNN(result, vector) {
  document.querySelector("#knn-prediction").textContent = result.prediction;
  const activeVotes = result.rankedClasses
    .filter((position) => result.votes[position] > 0)
    .slice(0, 3)
    .map((position) => `${models.knnClasses[position]}: ${percentage(result.votes[position])}`)
    .join(" · ");
  document.querySelector("#knn-vote").textContent = `Neighbor vote — ${activeVotes}`;
  paintPixelPreview(document.querySelector("#knn-preview"), vector, 16);

  const cards = document.querySelectorAll("[data-neighbor-card]");
  result.neighbors.forEach((neighbor, rank) => {
    const card = cards[rank];
    card.querySelector("[data-neighbor-rank]").textContent = `#${rank + 1}`;
    card.querySelector("[data-neighbor-label]").textContent = neighbor.label;
    card.querySelector("[data-neighbor-distance]").textContent = neighbor.distance.toFixed(1);
    card.querySelector("[data-neighbor-influence]").textContent = percentage(neighbor.influence);
    paintPixelPreview(
      card.querySelector("[data-neighbor-image]"),
      models.getKNNVector(neighbor.index),
      16,
    );
  });
}

function renderCNN(result, pixels) {
  document.querySelector("#cnn-prediction").textContent = result.prediction;
  document.querySelector("#cnn-score").textContent =
    `Top model score — ${percentage(result.scores[result.prediction], 1)}`;
  paintPixelPreview(document.querySelector("#cnn-preview"), pixels, 1);

  const rows = document.querySelectorAll("[data-score-row]");
  result.topThree.forEach((digit, rank) => {
    const score = result.scores[digit];
    const row = rows[rank];
    row.querySelector("[data-score-digit]").textContent = digit;
    row.querySelector("[data-score-value]").textContent = percentage(score, 1);
    row.querySelector("[data-score-fill]").style.width = `${Math.max(1.5, score * 100)}%`;
  });
}

function resetResults() {
  document.querySelector("#knn-prediction").textContent = "—";
  document.querySelector("#knn-vote").textContent = "Waiting for your drawing";
  document.querySelector("#cnn-prediction").textContent = "—";
  document.querySelector("#cnn-score").textContent = "Waiting for your drawing";
  paintPixelPreview(document.querySelector("#knn-preview"), new Float32Array(64), 16);
  paintPixelPreview(document.querySelector("#cnn-preview"), new Float32Array(784), 1);
  document.querySelectorAll("[data-neighbor-card]").forEach((card, rank) => {
    card.querySelector("[data-neighbor-rank]").textContent = `#${rank + 1}`;
    card.querySelector("[data-neighbor-label]").textContent = "—";
    card.querySelector("[data-neighbor-distance]").textContent = "—";
    card.querySelector("[data-neighbor-influence]").textContent = "—";
    paintPixelPreview(card.querySelector("[data-neighbor-image]"), new Float32Array(64), 16);
  });
  document.querySelectorAll("[data-score-row]").forEach((row) => {
    row.querySelector("[data-score-digit]").textContent = "—";
    row.querySelector("[data-score-value]").textContent = "—";
    row.querySelector("[data-score-fill]").style.width = "0";
  });
  comparison.classList.remove("has-result");
  announcement.textContent = "";
}

async function askBothModels() {
  if (!models) return;
  if (!hasInk) {
    announcement.textContent = "Draw a digit first, then ask the models.";
    drawingCanvas.focus();
    return;
  }
  const prepared = prepareForModels();
  if (prepared === null) return;

  guessButton.disabled = true;
  guessButton.textContent = "The models are thinking…";
  comparison.setAttribute("aria-busy", "true");
  // Let the loading label paint before the deliberately synchronous CNN work.
  await new Promise((resolve) => requestAnimationFrame(resolve));

  try {
    const knnResult = models.predictKNN(prepared.knnVector);
    const cnnResult = models.predictCNN(prepared.cnnPixels);
    renderKNN(knnResult, prepared.knnVector);
    renderCNN(cnnResult, prepared.cnnPixels);
    comparison.classList.add("has-result");
    announcement.textContent =
      `KNN guesses ${knnResult.prediction}. CNN guesses ${cnnResult.prediction}.`;
  } catch (error) {
    console.error(error);
    announcement.textContent = "The models could not read that drawing. Please try again.";
  } finally {
    comparison.removeAttribute("aria-busy");
    guessButton.disabled = false;
    guessButton.textContent = "Ask both models";
  }
}

function drawExample(digit) {
  clearDrawing();
  setDrawingStyle();
  drawingContext.beginPath();

  if (digit === "2") {
    drawingContext.moveTo(126, 155);
    drawingContext.bezierCurveTo(155, 70, 344, 72, 354, 166);
    drawingContext.bezierCurveTo(360, 226, 264, 270, 130, 382);
    drawingContext.lineTo(365, 382);
  } else if (digit === "5") {
    drawingContext.moveTo(350, 92);
    drawingContext.lineTo(150, 92);
    drawingContext.lineTo(135, 230);
    drawingContext.bezierCurveTo(205, 190, 354, 205, 358, 310);
    drawingContext.bezierCurveTo(360, 405, 205, 425, 124, 357);
  } else {
    drawingContext.moveTo(244, 236);
    drawingContext.bezierCurveTo(122, 226, 129, 75, 242, 76);
    drawingContext.bezierCurveTo(356, 78, 362, 225, 244, 236);
    drawingContext.bezierCurveTo(103, 249, 118, 417, 242, 418);
    drawingContext.bezierCurveTo(368, 416, 382, 249, 244, 236);
  }
  drawingContext.stroke();
  hasInk = true;
  announcement.textContent = `Example ${digit} is on the drawing pad. Select Ask both models.`;
}

drawingCanvas.addEventListener("pointerdown", beginStroke);
drawingCanvas.addEventListener("pointermove", continueStroke);
drawingCanvas.addEventListener("pointerup", finishStroke);
drawingCanvas.addEventListener("pointercancel", finishStroke);
guessButton.addEventListener("click", askBothModels);
clearButton.addEventListener("click", clearDrawing);
document.querySelectorAll("[data-example]").forEach((button) => {
  button.addEventListener("click", () => drawExample(button.dataset.example));
});

// Nothing below this point—including the two model downloads—runs until the
// classroom password has been accepted in this browser tab.
await requestClassroomAccess();
const { loadDigitModels } = await import("./model-runtime.js");
initializeDrawingCanvas();
resetResults();

try {
  models = await loadDigitModels();
  modelStatusText.textContent = "Both models are ready";
  modelStatus.classList.add("is-ready");
  guessButton.disabled = false;
  guessButton.textContent = "Ask both models";
} catch (error) {
  console.error(error);
  modelStatusText.textContent = "The models did not load — refresh to try again";
  modelStatus.classList.add("has-error");
  guessButton.textContent = "Models unavailable";
  announcement.textContent = "The digit models did not load. Please refresh the page.";
}
