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
