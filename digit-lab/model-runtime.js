/* Browser inference for the two classroom models.

   The site deliberately uses no server and no third-party machine-learning
   library. KNN compares 64 brightness values with its saved examples. The CNN
   performs the same two convolutions and two dense layers as the Python model.
   Everything below runs on the visitor's device; drawings are never uploaded.
*/

function assertLength(name, values, expected) {
  if (values.length !== expected) {
    throw new Error(`${name} has ${values.length} values; expected ${expected}.`);
  }
}

function convolution3x3Relu(
  input,
  inputChannels,
  height,
  width,
  weights,
  bias,
  outputChannels,
) {
  const planeSize = height * width;
  const output = new Float32Array(outputChannels * planeSize);

  for (let outputChannel = 0; outputChannel < outputChannels; outputChannel += 1) {
    const outputBase = outputChannel * planeSize;
    const outputWeightBase = outputChannel * inputChannels * 9;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = bias[outputChannel];

        for (let inputChannel = 0; inputChannel < inputChannels; inputChannel += 1) {
          const inputBase = inputChannel * planeSize;
          const weightBase = outputWeightBase + inputChannel * 9;

          for (let kernelY = 0; kernelY < 3; kernelY += 1) {
            const sourceY = y + kernelY - 1;
            if (sourceY < 0 || sourceY >= height) continue;

            for (let kernelX = 0; kernelX < 3; kernelX += 1) {
              const sourceX = x + kernelX - 1;
              if (sourceX < 0 || sourceX >= width) continue;
              sum +=
                input[inputBase + sourceY * width + sourceX] *
                weights[weightBase + kernelY * 3 + kernelX];
            }
          }
        }

        output[outputBase + y * width + x] = sum > 0 ? sum : 0;
      }
    }
  }

  return output;
}

function maxPool2x2(input, channels, height, width) {
  const outputHeight = Math.floor(height / 2);
  const outputWidth = Math.floor(width / 2);
  const inputPlane = height * width;
  const outputPlane = outputHeight * outputWidth;
  const output = new Float32Array(channels * outputPlane);

  for (let channel = 0; channel < channels; channel += 1) {
    const inputBase = channel * inputPlane;
    const outputBase = channel * outputPlane;
    for (let y = 0; y < outputHeight; y += 1) {
      for (let x = 0; x < outputWidth; x += 1) {
        const topLeft = inputBase + y * 2 * width + x * 2;
        output[outputBase + y * outputWidth + x] = Math.max(
          input[topLeft],
          input[topLeft + 1],
          input[topLeft + width],
          input[topLeft + width + 1],
        );
      }
    }
  }

  return output;
}

function dense(input, weights, bias, outputSize, applyRelu) {
  const inputSize = input.length;
  const output = new Float32Array(outputSize);

  for (let outputPosition = 0; outputPosition < outputSize; outputPosition += 1) {
    let sum = bias[outputPosition];
    const weightBase = outputPosition * inputSize;
    for (let inputPosition = 0; inputPosition < inputSize; inputPosition += 1) {
      sum += input[inputPosition] * weights[weightBase + inputPosition];
    }
    output[outputPosition] = applyRelu && sum < 0 ? 0 : sum;
  }

  return output;
}

function softmax(logits) {
  const maximum = Math.max(...logits);
  const scores = new Float64Array(logits.length);
  let total = 0;
  for (let position = 0; position < logits.length; position += 1) {
    scores[position] = Math.exp(logits[position] - maximum);
    total += scores[position];
  }
  for (let position = 0; position < scores.length; position += 1) {
    scores[position] /= total;
  }
  return scores;
}

function topPositions(values, count) {
  return Array.from(values.keys())
    .sort((left, right) => values[right] - values[left] || left - right)
    .slice(0, count);
}

export class DigitModels {
  constructor(manifest, knnBuffer, cnnBuffer) {
    if (manifest.formatVersion !== 1) {
      throw new Error("This model format is not supported by the page.");
    }
    if (knnBuffer.byteLength !== manifest.knn.byteLength) {
      throw new Error("The KNN model file is incomplete.");
    }
    if (cnnBuffer.byteLength !== manifest.cnn.byteLength) {
      throw new Error("The CNN model file is incomplete.");
    }
    if (
      manifest.knn.neighbors !== 3 ||
      manifest.knn.weighting !== "distance" ||
      manifest.knn.metric !== "euclidean" ||
      manifest.knn.metricPower !== 2
    ) {
      throw new Error("The KNN settings do not match this page's explanation.");
    }

    this.manifest = manifest;
    this.knnExampleCount = manifest.knn.examples;
    this.knnFeatureCount = manifest.knn.features;
    this.knnClasses = manifest.knn.classes;
    this.knnVectors = new Uint8Array(
      knnBuffer,
      0,
      manifest.knn.vectorByteLength,
    );
    this.knnLabels = new Uint8Array(
      knnBuffer,
      manifest.knn.vectorByteLength,
      manifest.knn.examples,
    );

    this.cnnTensors = {};
    for (const [name, specification] of Object.entries(manifest.cnn.tensors)) {
      this.cnnTensors[name] = new Float32Array(
        cnnBuffer,
        specification.floatOffset * Float32Array.BYTES_PER_ELEMENT,
        specification.length,
      );
    }
  }

  getKNNVector(index) {
    const start = index * this.knnFeatureCount;
    return this.knnVectors.subarray(start, start + this.knnFeatureCount);
  }

  predictKNN(drawingVector) {
    assertLength("KNN input", drawingVector, this.knnFeatureCount);
    const neighborCount = this.manifest.knn.neighbors;
    const bestSquaredDistances = new Float64Array(neighborCount).fill(Infinity);
    const bestIndices = new Int32Array(neighborCount).fill(-1);

    // Keep a sorted list of the three shortest distances while visiting all
    // 1,347 stored examples. Only 86,208 subtract-and-square operations are
    // needed, so this is comfortably fast even on a phone.
    for (let example = 0; example < this.knnExampleCount; example += 1) {
      const vectorStart = example * this.knnFeatureCount;
      let squaredDistance = 0;
      for (let feature = 0; feature < this.knnFeatureCount; feature += 1) {
        const difference = this.knnVectors[vectorStart + feature] - drawingVector[feature];
        squaredDistance += difference * difference;
      }

      if (squaredDistance >= bestSquaredDistances[neighborCount - 1]) continue;
      let insertion = neighborCount - 1;
      while (insertion > 0 && squaredDistance < bestSquaredDistances[insertion - 1]) {
        bestSquaredDistances[insertion] = bestSquaredDistances[insertion - 1];
        bestIndices[insertion] = bestIndices[insertion - 1];
        insertion -= 1;
      }
      bestSquaredDistances[insertion] = squaredDistance;
      bestIndices[insertion] = example;
    }

    const distances = Array.from(bestSquaredDistances, Math.sqrt);
    const exactMatch = distances.some((distance) => distance === 0);
    const rawInfluences = distances.map((distance) => {
      if (exactMatch) return distance === 0 ? 1 : 0;
      return 1 / distance;
    });
    const influenceTotal = rawInfluences.reduce((sum, value) => sum + value, 0);
    const influences = rawInfluences.map((value) => value / influenceTotal);

    const votes = new Float64Array(this.knnClasses.length);
    const neighbors = Array.from(bestIndices, (index, rank) => {
      const label = this.knnLabels[index];
      const classPosition = this.knnClasses.indexOf(label);
      votes[classPosition] += influences[rank];
      return {
        index,
        label,
        distance: distances[rank],
        influence: influences[rank],
      };
    });
    const rankedClasses = topPositions(votes, votes.length);

    return {
      prediction: this.knnClasses[rankedClasses[0]],
      votes,
      neighbors,
      rankedClasses,
    };
  }

  predictCNN(pixels) {
    assertLength("CNN input", pixels, 28 * 28);
    const normalized = new Float32Array(pixels.length);
    const mean = this.manifest.cnn.mean;
    const standardDeviation = this.manifest.cnn.standardDeviation;
    for (let position = 0; position < pixels.length; position += 1) {
      normalized[position] = (pixels[position] - mean) / standardDeviation;
    }

    const tensors = this.cnnTensors;
    const firstConvolution = convolution3x3Relu(
      normalized,
      1,
      28,
      28,
      tensors.conv1Weight,
      tensors.conv1Bias,
      32,
    );
    const firstPool = maxPool2x2(firstConvolution, 32, 28, 28);
    const secondConvolution = convolution3x3Relu(
      firstPool,
      32,
      14,
      14,
      tensors.conv2Weight,
      tensors.conv2Bias,
      64,
    );
    const secondPool = maxPool2x2(secondConvolution, 64, 14, 14);
    const hidden = dense(
      secondPool,
      tensors.dense1Weight,
      tensors.dense1Bias,
      128,
      true,
    );
    const logits = dense(
      hidden,
      tensors.dense2Weight,
      tensors.dense2Bias,
      10,
      false,
    );
    const scores = softmax(logits);
    const topThree = topPositions(scores, 3);

    return { prediction: topThree[0], logits, scores, topThree };
  }
}

async function checkedFetch(url, description) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${description} (${response.status}).`);
  }
  return response;
}

async function verifySHA256(buffer, expectedDigest, description) {
  // Production is HTTPS, where Web Crypto is available. The graceful fallback
  // keeps very old/local browsers usable while byte-length checks still run.
  if (!globalThis.crypto?.subtle) return;
  const hash = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  const actualDigest = Array.from(new Uint8Array(hash), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  if (actualDigest !== expectedDigest) {
    throw new Error(`${description} did not pass its integrity check.`);
  }
}

export async function loadDigitModels() {
  const manifestURL = new URL("./model-manifest.json", import.meta.url);
  const manifestResponse = await checkedFetch(manifestURL, "the model description");
  const manifest = await manifestResponse.json();
  const knnURL = new URL(manifest.knn.file, manifestURL);
  const cnnURL = new URL(manifest.cnn.file, manifestURL);
  const [knnResponse, cnnResponse] = await Promise.all([
    checkedFetch(knnURL, "the KNN examples"),
    checkedFetch(cnnURL, "the CNN weights"),
  ]);
  const [knnBuffer, cnnBuffer] = await Promise.all([
    knnResponse.arrayBuffer(),
    cnnResponse.arrayBuffer(),
  ]);
  await Promise.all([
    verifySHA256(knnBuffer, manifest.knn.sha256, "The KNN model"),
    verifySHA256(cnnBuffer, manifest.cnn.sha256, "The CNN model"),
  ]);
  return new DigitModels(manifest, knnBuffer, cnnBuffer);
}
