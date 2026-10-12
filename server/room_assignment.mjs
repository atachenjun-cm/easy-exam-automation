export function calculateRoomSizes(totalEntries, targetSize = 30) {
  if (!Number.isInteger(totalEntries) || totalEntries <= 0) {
    return [];
  }
  if (!Number.isInteger(targetSize) || targetSize <= 0) {
    return [];
  }

  const lowerRoomCount = Math.max(1, Math.floor(totalEntries / targetSize));
  const upperRoomCount = lowerRoomCount + 1;
  const maxDeviation = (roomCount) => {
    const smallestRoom = Math.floor(totalEntries / roomCount);
    const largestRoom = Math.ceil(totalEntries / roomCount);
    return Math.max(
      Math.abs(smallestRoom - targetSize),
      Math.abs(largestRoom - targetSize),
    );
  };
  const roomCount = maxDeviation(upperRoomCount) < maxDeviation(lowerRoomCount)
    ? upperRoomCount
    : lowerRoomCount;
  const baseSize = Math.floor(totalEntries / roomCount);
  const largerRoomCount = totalEntries % roomCount;
  return Array.from(
    { length: roomCount },
    (_, index) => baseSize + (index < largerRoomCount ? 1 : 0),
  );
}

export function calculateProportionalRoomSizes(totalEntries, referenceSizes = []) {
  if (!Number.isInteger(totalEntries) || totalEntries <= 0) return [];
  const sizes = (Array.isArray(referenceSizes) ? referenceSizes : [])
    .map(Number)
    .filter((size) => Number.isInteger(size) && size > 0);
  const referenceTotal = sizes.reduce((sum, size) => sum + size, 0);
  if (!referenceTotal) return [];
  if (referenceTotal === totalEntries) return [...sizes];

  const scaled = sizes.map((size, index) => {
    const exact = totalEntries * size / referenceTotal;
    return { index, size: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  const remaining = totalEntries - scaled.reduce((sum, item) => sum + item.size, 0);
  const remainderOrder = [...scaled]
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (let index = 0; index < remaining; index += 1) {
    remainderOrder[index % remainderOrder.length].size += 1;
  }
  return scaled.map((item) => item.size).filter((size) => size > 0);
}
