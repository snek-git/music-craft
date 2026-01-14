import { getSimilarArtists, type SimilarArtist } from "./lastfm";

interface SearchNode {
  name: string;
  depth: number;
  similarity: number; // cumulative similarity from origin
  path: string[];
}

interface IntersectionResult {
  artist: string;
  scoreFromA: number;
  scoreFromB: number;
  combinedScore: number;
  depthA: number;
  depthB: number;
  pathA: string[];
  pathB: string[];
}

// In-memory cache for similar artists (survives across requests)
const similarCache = new Map<string, SimilarArtist[]>();

async function getCachedSimilar(artist: string): Promise<SimilarArtist[]> {
  const cached = similarCache.get(artist.toLowerCase());
  if (cached) return cached;

  const similar = await getSimilarArtists(artist, 20);
  similarCache.set(artist.toLowerCase(), similar);
  return similar;
}

export async function findArtistIntersection(
  artistA: string,
  artistB: string,
  maxDepth = 2,
  excludeArtists: string[] = []
): Promise<IntersectionResult | null> {
  const excludeSet = new Set(excludeArtists.map((a) => a.toLowerCase()));
  excludeSet.add(artistA.toLowerCase());
  excludeSet.add(artistB.toLowerCase());

  // Track visited and distances from each side
  const visitedA = new Map<string, SearchNode>();
  const visitedB = new Map<string, SearchNode>();

  // Initialize with starting artists
  visitedA.set(artistA.toLowerCase(), {
    name: artistA,
    depth: 0,
    similarity: 1,
    path: [artistA],
  });
  visitedB.set(artistB.toLowerCase(), {
    name: artistB,
    depth: 0,
    similarity: 1,
    path: [artistB],
  });

  // Queues for BFS
  let frontierA: SearchNode[] = [visitedA.get(artistA.toLowerCase())!];
  let frontierB: SearchNode[] = [visitedB.get(artistB.toLowerCase())!];

  const intersections: IntersectionResult[] = [];

  for (let depth = 1; depth <= maxDepth; depth++) {
    // Fetch all similar artists in parallel for both frontiers
    const [similarA, similarB] = await Promise.all([
      Promise.all(frontierA.map((node) => getCachedSimilar(node.name).then((s) => ({ node, similar: s })))),
      Promise.all(frontierB.map((node) => getCachedSimilar(node.name).then((s) => ({ node, similar: s })))),
    ]);

    // Expand frontier A
    const nextFrontierA: SearchNode[] = [];
    for (const { node, similar } of similarA) {
      for (const sim of similar) {
        const key = sim.name.toLowerCase();
        if (excludeSet.has(key)) continue;
        if (visitedA.has(key)) continue;

        const newNode: SearchNode = {
          name: sim.name,
          depth,
          similarity: node.similarity * sim.match,
          path: [...node.path, sim.name],
        };
        visitedA.set(key, newNode);
        nextFrontierA.push(newNode);

        // Check for intersection with B
        const fromB = visitedB.get(key);
        if (fromB) {
          intersections.push({
            artist: sim.name,
            scoreFromA: newNode.similarity,
            scoreFromB: fromB.similarity,
            combinedScore: newNode.similarity * fromB.similarity,
            depthA: newNode.depth,
            depthB: fromB.depth,
            pathA: newNode.path,
            pathB: fromB.path,
          });
        }
      }
    }
    frontierA = nextFrontierA;

    // Expand frontier B
    const nextFrontierB: SearchNode[] = [];
    for (const { node, similar } of similarB) {
      for (const sim of similar) {
        const key = sim.name.toLowerCase();
        if (excludeSet.has(key)) continue;
        if (visitedB.has(key)) continue;

        const newNode: SearchNode = {
          name: sim.name,
          depth,
          similarity: node.similarity * sim.match,
          path: [...node.path, sim.name],
        };
        visitedB.set(key, newNode);
        nextFrontierB.push(newNode);

        // Check for intersection with A
        const fromA = visitedA.get(key);
        if (fromA) {
          intersections.push({
            artist: sim.name,
            scoreFromA: fromA.similarity,
            scoreFromB: newNode.similarity,
            combinedScore: fromA.similarity * newNode.similarity,
            depthA: fromA.depth,
            depthB: newNode.depth,
            pathA: fromA.path,
            pathB: newNode.path,
          });
        }
      }
    }
    frontierB = nextFrontierB;

    // If we found intersections at this depth, we can stop
    if (intersections.length > 0) {
      break;
    }
  }

  if (intersections.length === 0) {
    return null;
  }

  // Sort by combined score (higher = better match to both)
  intersections.sort((a, b) => b.combinedScore - a.combinedScore);

  return intersections[0];
}

// For genre + artist: find artists that match the genre
export async function findArtistForGenre(
  genre: string,
  artist: string,
  excludeArtists: string[] = []
): Promise<IntersectionResult | null> {
  const excludeSet = new Set(excludeArtists.map((a) => a.toLowerCase()));
  excludeSet.add(artist.toLowerCase());

  // Get similar artists and filter by those tagged with the genre
  const similar = await getCachedSimilar(artist);

  // For now, just return the most similar artist that isn't excluded
  // A better approach would check Last.fm tags, but that's more API calls
  for (const sim of similar) {
    if (!excludeSet.has(sim.name.toLowerCase())) {
      return {
        artist: sim.name,
        scoreFromA: sim.match,
        scoreFromB: 1,
        combinedScore: sim.match,
        depthA: 1,
        depthB: 0,
        pathA: [artist, sim.name],
        pathB: [genre],
      };
    }
  }

  return null;
}
