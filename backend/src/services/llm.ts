interface CombineCandidate {
  name: string;
  reasoning: string;
  summary: string;
  confidence: number;
}

interface CombineResult {
  candidates: CombineCandidate[];
  type: "genre" | "artist";
}

interface ElementInput {
  name: string;
  type: string;
  bio?: string;
  tags?: string[];
}

export async function combineElements(
  elementA: ElementInput,
  elementB: ElementInput,
  failedNames: string[] = []
): Promise<CombineResult | null> {
  // genre + genre = genre, otherwise artist
  const outputType = (elementA.type === "genre" && elementB.type === "genre") ? "genre" : "artist";

  const failedNote = failedNames.length > 0
    ? `\n\nDO NOT suggest these (they don't exist or weren't found): ${failedNames.join(", ")}`
    : "";

  const prompt = outputType === "genre"
    ? `You are a music expert. Given two music genres, suggest ONE real subgenre or fusion genre that combines them.

Genre A: ${elementA.name}
Genre B: ${elementB.name}

Requirements:
- Must be real, recognized genres or subgenres
- Should genuinely combine qualities of both inputs
- Examples: "Rock + Electronic = Synthwave", "Jazz + Hip-Hop = Jazz Rap"
- If no good matches exist, respond with {"candidates": []}${failedNote}

Respond with ONLY valid JSON (array of up to 5 options, sorted by confidence):
{
  "candidates": [
    {"name": "Genre Name", "reasoning": "Why they fit", "summary": "~10 words", "confidence": 0.9},
    ...
  ]
}`
    : `You are a music discovery expert. Find an artist at the TRUE intersection of these two elements.

Element A: ${elementA.name} (${elementA.type})${elementA.tags?.length ? `\nTags: ${elementA.tags.slice(0, 5).join(", ")}` : ""}${elementA.bio ? `\nBio: ${elementA.bio.replace(/<[^>]*>/g, "").slice(0, 300)}` : ""}

Element B: ${elementB.name} (${elementB.type})${elementB.tags?.length ? `\nTags: ${elementB.tags.slice(0, 5).join(", ")}` : ""}${elementB.bio ? `\nBio: ${elementB.bio.replace(/<[^>]*>/g, "").slice(0, 300)}` : ""}

Think step by step:

STEP 1 - Analyze the elements:
- What is the core sonic/stylistic quality of Element A?
- What is the core sonic/stylistic quality of Element B?
- What would an artist who EQUALLY embodies BOTH qualities sound like?

STEP 2 - Brainstorm 5 candidates with confidence scores (0.0-1.0):
Consider: How well do they sit at the MIDDLE POINT (not just related to both)?
- Candidate 1: [name] (confidence: X.X) - why
- Candidate 2: [name] (confidence: X.X) - why
- Candidate 3: [name] (confidence: X.X) - why
- Candidate 4: [name] (confidence: X.X) - why
- Candidate 5: [name] (confidence: X.X) - why

STEP 3 - Reconsider each:
- Is candidate 1 truly the middle ground or just adjacent to one side?
- Is candidate 2 too obvious/mainstream?
- etc.

STEP 4 - Finalize your top 5 with summaries.

Requirements:
- Must be real artists with released music
- NOT just "related to both" - must be the MIDDLE GROUND
- Avoid obvious/mainstream choices
- If no good matches exist, respond with {"candidates": []}${failedNote}

After your reasoning, respond with ONLY this JSON (array of your best 5, sorted by confidence):
{
  "candidates": [
    {"name": "Artist 1", "reasoning": "How they blend both", "summary": "~10 words", "confidence": 0.9},
    {"name": "Artist 2", "reasoning": "How they blend both", "summary": "~10 words", "confidence": 0.8},
    ...
  ]
}`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: "anthropic/claude-haiku-4.5",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message: string };
  };

  if (data.error) {
    console.error("OpenRouter error:", data.error.message);
    return null;
  }

  const text = data.choices?.[0]?.message?.content ?? "";

  try {
    // Anchor on "candidates" key to skip any { in chain-of-thought reasoning
    const jsonMatch = text.match(/\{\s*"candidates"\s*:[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    const parsed = JSON.parse(jsonMatch[0]) as { candidates: CombineCandidate[] };
    if (!parsed.candidates || parsed.candidates.length === 0) {
      return null;
    }
    // Ensure all candidates have summary field
    const candidates = parsed.candidates.map(c => ({
      ...c,
      summary: c.summary || "",
    }));
    return { candidates, type: outputType };
  } catch {
    console.error("Failed to parse LLM response:", text);
    return null;
  }
}
