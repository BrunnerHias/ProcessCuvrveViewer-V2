// ============================================================
// Largest-Triangle-Three-Buckets (LTTB) Downsampling
// For performance with very large datasets
// ============================================================

/**
 * Downsamples data using the LTTB algorithm.
 * Returns indices into the original arrays.
 */
export function lttbDownsample(
  x: Float64Array | number[],
  y: Float64Array | number[],
  threshold: number
): number[] {
  const dataLength = x.length;
  if (threshold >= dataLength || threshold <= 2) {
    return Array.from({ length: dataLength }, (_, i) => i);
  }

  const sampled: number[] = [0]; // Always include first point

  const bucketSize = (dataLength - 2) / (threshold - 2);

  let prevIndex = 0;

  for (let i = 0; i < threshold - 2; i++) {
    // Calculate bucket range
    const rangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, dataLength);

    // Calculate average point for next bucket
    const nextBucketStart = Math.floor((i + 2) * bucketSize) + 1;
    const nextBucketEnd = Math.min(
      Math.floor((i + 3) * bucketSize) + 1,
      dataLength
    );
    let avgX = 0;
    let avgY = 0;
    const nextBucketLen = Math.min(nextBucketEnd, dataLength) - nextBucketStart;
    if (nextBucketLen > 0) {
      for (let j = nextBucketStart; j < Math.min(nextBucketEnd, dataLength); j++) {
        avgX += x[j];
        avgY += y[j];
      }
      avgX /= nextBucketLen;
      avgY /= nextBucketLen;
    }

    // Find point in current bucket with largest triangle area
    let maxArea = -1;
    let bestIndex = rangeStart;
    const prevX = x[prevIndex];
    const prevY = y[prevIndex];

    for (let j = rangeStart; j < rangeEnd; j++) {
      const area = Math.abs(
        (prevX - avgX) * (y[j] - prevY) -
        (prevX - x[j]) * (avgY - prevY)
      );
      if (area > maxArea) {
        maxArea = area;
        bestIndex = j;
      }
    }

    sampled.push(bestIndex);
    prevIndex = bestIndex;
  }

  sampled.push(dataLength - 1); // Always include last point
  return sampled;
}
