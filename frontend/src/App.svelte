<script lang="ts">
  import { onMount } from "svelte";

  interface Element {
    id: string;
    name: string;
    type: "genre" | "artist";
  }

  interface CanvasElement extends Element {
    x: number;
    y: number;
    instanceId: string;
  }

  let allElements: Element[] = $state([]);
  let canvas: CanvasElement[] = $state([]);
  let loading: { x: number; y: number } | null = $state(null);
  let result: any = $state(null);

  let dragging: { el: CanvasElement | Element; isNew: boolean; offsetX: number; offsetY: number } | null = $state(null);
  let dragPos = $state({ x: 0, y: 0 });
  let nearTarget: CanvasElement | null = $state(null);
  let canvasEl: HTMLElement;
  let sidebarEl: HTMLElement;

  let genres = $derived(allElements.filter(e => e.type === "genre").sort((a, b) => a.name.localeCompare(b.name)));
  let artists = $derived(allElements.filter(e => e.type === "artist").sort((a, b) => a.name.localeCompare(b.name)));

  let newArtist = $state("");
  let addingArtist = $state(false);
  let pendingArtist: { input: string; validated: string } | null = $state(null);

  interface ArtistInfo {
    name: string;
    listeners: number;
    playcount?: number;
    bio?: string;
    tags?: string[];
    url?: string;
  }
  let selectedInfo: ArtistInfo | null = $state(null);
  let loadingInfo = $state(false);
  let dragMoved = $state(false);

  async function lookupArtist() {
    if (!newArtist.trim() || addingArtist) return;
    addingArtist = true;
    try {
      const res = await fetch(`/api/elements/lookup?name=${encodeURIComponent(newArtist.trim())}`);
      const data = await res.json();
      if (data.name) {
        pendingArtist = { input: newArtist.trim(), validated: data.name };
      } else {
        pendingArtist = { input: newArtist.trim(), validated: newArtist.trim() };
      }
    } finally {
      addingArtist = false;
    }
  }

  async function confirmArtist() {
    if (!pendingArtist) return;
    addingArtist = true;
    try {
      const res = await fetch("/api/elements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: pendingArtist.validated, type: "artist" }),
      });
      const data = await res.json();
      if (data.id) {
        allElements = [...allElements, data];
      }
    } finally {
      addingArtist = false;
      pendingArtist = null;
      newArtist = "";
    }
  }

  function cancelArtist() {
    pendingArtist = null;
  }

  onMount(async () => {
    const res = await fetch("/api/elements");
    allElements = await res.json();

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  });

  function onSidebarMouseDown(e: MouseEvent, el: Element) {
    e.preventDefault();
    dragging = { el, isNew: true, offsetX: 50, offsetY: 15 };
    dragPos = { x: e.clientX, y: e.clientY };
    dragMoved = false;
  }

  function onCanvasMouseDown(e: MouseEvent, el: CanvasElement) {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    dragging = { el, isNew: false, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top };
    dragPos = { x: e.clientX, y: e.clientY };
    dragMoved = false;
  }

  function onMouseMove(e: MouseEvent) {
    if (!dragging) return;
    const dx = e.clientX - dragPos.x;
    const dy = e.clientY - dragPos.y;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      dragMoved = true;
    }
    dragPos = { x: e.clientX, y: e.clientY };

    // Check proximity to other elements
    if (canvasEl) {
      const rect = canvasEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      nearTarget = findNearElement(x, y, dragging.el);
    }
  }

  function onMouseUp(e: MouseEvent) {
    if (!dragging || !canvasEl) {
      dragging = null;
      nearTarget = null;
      return;
    }

    // If no drag movement, treat as a click to show info
    if (!dragMoved) {
      showElementInfo(dragging.el);
      dragging = null;
      nearTarget = null;
      return;
    }

    const canvasRect = canvasEl.getBoundingClientRect();
    const sidebarRect = sidebarEl?.getBoundingClientRect();
    const x = e.clientX - canvasRect.left - dragging.offsetX;
    const y = e.clientY - canvasRect.top - dragging.offsetY;

    // Check if dropped on sidebar (put back)
    if (sidebarRect && !dragging.isNew && e.clientX >= sidebarRect.left && e.clientX <= sidebarRect.right) {
      const el = dragging.el as CanvasElement;
      canvas = canvas.filter(c => c.instanceId !== el.instanceId);
    }
    // Check if dropped in canvas area
    else if (e.clientX >= canvasRect.left && e.clientX <= canvasRect.right && e.clientY >= canvasRect.top && e.clientY <= canvasRect.bottom) {
      if (nearTarget) {
        // Combine! Remove both elements
        const targetId = nearTarget.instanceId;
        combineElements(dragging.el, nearTarget, nearTarget.x, nearTarget.y);
        canvas = canvas.filter(c => c.instanceId !== targetId);
        if (!dragging.isNew && 'instanceId' in dragging.el) {
          canvas = canvas.filter(c => c.instanceId !== (dragging!.el as CanvasElement).instanceId);
        }
      } else if (dragging.isNew) {
        // Spawn new
        spawnElement(dragging.el, x, y);
      } else {
        // Move existing
        const el = dragging.el as CanvasElement;
        canvas = canvas.map(c => c.instanceId === el.instanceId ? { ...c, x, y } : c);
      }
    }

    dragging = null;
    nearTarget = null;
  }

  function findNearElement(x: number, y: number, exclude: Element): CanvasElement | null {
    const threshold = 60;
    for (const el of canvas) {
      if ('instanceId' in exclude && el.instanceId === (exclude as CanvasElement).instanceId) continue;
      const cx = el.x + 50;
      const cy = el.y + 15;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist < threshold) return el;
    }
    return null;
  }

  function spawnElement(el: Element, x: number, y: number) {
    canvas = [...canvas, { ...el, x, y, instanceId: crypto.randomUUID() }];
  }

  async function combineElements(a: Element, b: Element, x: number, y: number) {
    loading = { x, y };
    nearTarget = null;
    try {
      const res = await fetch("/api/combine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ elementA: a.id, elementB: b.id }),
      });
      const data = await res.json();
      result = data;

      if (data.result) {
        if (!allElements.find(e => e.name === data.result.name)) {
          allElements = [...allElements, data.result];
        }
        spawnElement(data.result, x, y);
      } else if (data.noMatch) {
        result = { noMatch: true, message: "No match found" };
      }
    } finally {
      loading = null;
    }
  }

  function clearCanvas() {
    canvas = [];
    result = null;
  }

  async function showElementInfo(el: Element) {
    if (el.type !== "artist") return;
    loadingInfo = true;
    try {
      const res = await fetch(`/api/artist/${encodeURIComponent(el.name)}`);
      const data = await res.json();
      if (data.name) {
        selectedInfo = data;
      }
    } finally {
      loadingInfo = false;
    }
  }

  function closeInfo() {
    selectedInfo = null;
  }
</script>

<div class="app">
  <aside class="sidebar" bind:this={sidebarEl}>
    <h1>Music Craft</h1>
    <p class="hint">Drag to canvas, bring close to combine</p>

    {#if result?.result}
      <div class="discovery">
        <span class="label">Discovered</span>
        <strong>{result.result.name}</strong>
        <span class="type-badge" class:genre={result.result.type === "genre"} class:artist={result.result.type === "artist"}>
          {result.result.type}
        </span>
        <p class="reasoning">{result.combination?.reasoning}</p>
      </div>
    {:else if result?.noMatch}
      <div class="discovery no-match">
        <span class="label">No match</span>
        <p class="reasoning">Couldn't find a good combination</p>
      </div>
    {/if}

    <div class="category">
      <h2>Genres <span class="count">{genres.length}</span></h2>
      <div class="elements">
        {#each genres as el (el.id)}
          <div
            class="element genre"
            onmousedown={(e) => onSidebarMouseDown(e, el)}
          >
            {el.name}
          </div>
        {/each}
      </div>
    </div>

    <div class="category">
      <h2>Artists <span class="count">{artists.length}</span></h2>
      {#if pendingArtist}
        <div class="confirm-artist">
          <span class="confirm-label">Add "{pendingArtist.validated}"?</span>
          <div class="confirm-buttons">
            <button class="confirm-yes" onclick={confirmArtist} disabled={addingArtist}>Yes</button>
            <button class="confirm-no" onclick={cancelArtist}>No</button>
          </div>
        </div>
      {:else}
        <form class="add-artist" onsubmit={(e) => { e.preventDefault(); lookupArtist(); }}>
          <input
            type="text"
            placeholder="Add artist..."
            bind:value={newArtist}
            disabled={addingArtist}
          />
          <button type="submit" disabled={!newArtist.trim() || addingArtist}>+</button>
        </form>
      {/if}
      <div class="elements">
        {#each artists as el (el.id)}
          <div
            class="element artist"
            onmousedown={(e) => onSidebarMouseDown(e, el)}
          >
            {el.name}
          </div>
        {/each}
      </div>
    </div>

    <button class="clear" onclick={clearCanvas}>Clear Canvas</button>
  </aside>

  <main class="canvas" bind:this={canvasEl}>
    {#if loading}
      <div class="canvas-loader" style="left: {loading.x}px; top: {loading.y}px;">
        <div class="spinner"></div>
      </div>
    {/if}

    {#each canvas as el (el.instanceId)}
      <div
        class="canvas-element"
        class:genre={el.type === "genre"}
        class:artist={el.type === "artist"}
        class:highlight={nearTarget?.instanceId === el.instanceId}
        style="left: {el.x}px; top: {el.y}px;"
        onmousedown={(e) => onCanvasMouseDown(e, el)}
      >
        {el.name}
      </div>
    {/each}

    {#if canvas.length === 0 && !dragging}
      <div class="empty">Drag elements here</div>
    {/if}
  </main>

  {#if dragging && dragMoved}
    <div
      class="drag-ghost"
      class:genre={dragging.el.type === "genre"}
      class:artist={dragging.el.type === "artist"}
      style="left: {dragPos.x - dragging.offsetX}px; top: {dragPos.y - dragging.offsetY}px;"
    >
      {dragging.el.name}
    </div>
  {/if}

  {#if selectedInfo}
    <div class="info-overlay" onclick={closeInfo}>
      <div class="info-modal" onclick={(e) => e.stopPropagation()}>
        <button class="info-close" onclick={closeInfo}>&times;</button>
        <h2>{selectedInfo.name}</h2>
        <div class="info-stats">
          <span>{selectedInfo.listeners?.toLocaleString()} listeners</span>
        </div>
        {#if selectedInfo.tags?.length}
          <div class="info-tags">
            {#each selectedInfo.tags.slice(0, 5) as tag}
              <span class="info-tag">{tag}</span>
            {/each}
          </div>
        {/if}
        {#if selectedInfo.bio}
          <p class="info-bio">{@html selectedInfo.bio}</p>
        {/if}
        {#if selectedInfo.url}
          <a class="info-link" href={selectedInfo.url} target="_blank">View on Last.fm</a>
        {/if}
      </div>
    </div>
  {/if}

  {#if loadingInfo}
    <div class="info-overlay">
      <div class="info-loading">Loading...</div>
    </div>
  {/if}
</div>

<style>
  .app {
    display: flex;
    height: 100vh;
    overflow: hidden;
  }

  .sidebar {
    width: 300px;
    background: linear-gradient(180deg, #0f0f12 0%, #0a0a0d 100%);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    border-right: 1px solid #1a1a20;
    overflow-y: auto;
    gap: 1rem;
  }

  h1 {
    font-size: 1.25rem;
    font-weight: 600;
    color: #fff;
  }

  .hint {
    color: #555;
    font-size: 0.75rem;
  }

  .discovery {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid #27272a;
    border-radius: 12px;
    padding: 0.875rem;
  }

  .discovery .label {
    color: #888;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .discovery strong {
    display: block;
    margin: 0.25rem 0;
    font-size: 1rem;
  }

  .discovery .type-badge {
    display: inline-block;
    font-size: 0.6rem;
    padding: 0.15rem 0.4rem;
    border-radius: 4px;
    text-transform: uppercase;
  }

  .discovery .type-badge.genre {
    background: rgba(251, 191, 36, 0.2);
    color: #fbbf24;
  }

  .discovery .type-badge.artist {
    background: rgba(244, 114, 182, 0.2);
    color: #f472b6;
  }

  .discovery .reasoning {
    color: #666;
    font-size: 0.75rem;
    margin: 0.5rem 0 0;
    line-height: 1.4;
  }

  .discovery.no-match {
    border-color: #ef4444;
    background: rgba(239, 68, 68, 0.05);
  }

  .discovery.no-match .label {
    color: #ef4444;
  }

  .category h2 {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #444;
    margin-bottom: 0.5rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .category h2 .count {
    background: #1a1a20;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    font-size: 0.65rem;
  }

  .confirm-artist {
    background: rgba(244, 114, 182, 0.1);
    border: 1px solid rgba(244, 114, 182, 0.3);
    border-radius: 8px;
    padding: 0.6rem;
    margin-bottom: 0.5rem;
  }

  .confirm-label {
    display: block;
    font-size: 0.8rem;
    margin-bottom: 0.4rem;
    color: #fff;
  }

  .confirm-buttons {
    display: flex;
    gap: 0.35rem;
  }

  .confirm-yes, .confirm-no {
    flex: 1;
    padding: 0.35rem;
    border-radius: 6px;
    font-size: 0.75rem;
    cursor: pointer;
    border: none;
  }

  .confirm-yes {
    background: rgba(74, 222, 128, 0.2);
    color: #4ade80;
  }

  .confirm-yes:hover:not(:disabled) {
    background: rgba(74, 222, 128, 0.3);
  }

  .confirm-no {
    background: #27272a;
    color: #888;
  }

  .confirm-no:hover {
    background: #333;
    color: #fff;
  }

  .add-artist {
    display: flex;
    gap: 0.35rem;
    margin-bottom: 0.5rem;
  }

  .add-artist input {
    flex: 1;
    background: #18181b;
    border: 1px solid #27272a;
    border-radius: 6px;
    padding: 0.4rem 0.6rem;
    color: #fff;
    font-size: 0.75rem;
  }

  .add-artist input::placeholder {
    color: #444;
  }

  .add-artist input:focus {
    outline: none;
    border-color: rgba(244, 114, 182, 0.5);
  }

  .add-artist button {
    background: rgba(244, 114, 182, 0.2);
    border: 1px solid rgba(244, 114, 182, 0.4);
    border-radius: 6px;
    color: #f472b6;
    padding: 0 0.6rem;
    cursor: pointer;
    font-size: 0.9rem;
  }

  .add-artist button:hover:not(:disabled) {
    background: rgba(244, 114, 182, 0.3);
  }

  .add-artist button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .elements {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .element, .canvas-element, .drag-ghost {
    background: #18181b;
    border: 1px solid #27272a;
    border-radius: 8px;
    padding: 0.4rem 0.7rem;
    font-size: 0.8rem;
    cursor: grab;
    user-select: none;
    white-space: nowrap;
    transition: transform 0.1s ease, box-shadow 0.1s ease, border-color 0.1s ease;
  }

  .element:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .element.genre, .canvas-element.genre, .drag-ghost.genre {
    border-color: rgba(251, 191, 36, 0.4);
    background: linear-gradient(135deg, rgba(251, 191, 36, 0.08), #18181b);
  }

  .element.artist, .canvas-element.artist, .drag-ghost.artist {
    border-color: rgba(244, 114, 182, 0.4);
    background: linear-gradient(135deg, rgba(244, 114, 182, 0.08), #18181b);
  }

  .canvas-element {
    position: absolute;
    z-index: 1;
  }

  .canvas-element.highlight {
    transform: scale(1.1);
    box-shadow: 0 0 20px rgba(255, 255, 255, 0.2);
    z-index: 2;
  }

  .canvas-element.highlight.genre {
    box-shadow: 0 0 20px rgba(251, 191, 36, 0.4);
  }

  .canvas-element.highlight.artist {
    box-shadow: 0 0 20px rgba(244, 114, 182, 0.4);
  }

  .drag-ghost {
    position: fixed;
    z-index: 1000;
    pointer-events: none;
    opacity: 0.9;
    transform: scale(1.05);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }

  .clear {
    margin-top: auto;
    background: #18181b;
    color: #666;
    border: 1px solid #27272a;
    border-radius: 8px;
    padding: 0.6rem;
    cursor: pointer;
    font-size: 0.8rem;
    transition: all 0.15s ease;
  }

  .clear:hover {
    background: #27272a;
    color: #fff;
  }

  .canvas {
    flex: 1;
    background-color: #050507;
    background-image: radial-gradient(circle, #1a1a20 1px, transparent 1px);
    background-size: 24px 24px;
    position: relative;
    overflow: hidden;
  }

  .canvas-loader {
    position: absolute;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100px;
    height: 30px;
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid #27272a;
    border-top-color: #f472b6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .empty {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: #27272a;
    font-size: 1.25rem;
  }

  .info-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .info-modal {
    background: #18181b;
    border: 1px solid #27272a;
    border-radius: 16px;
    padding: 1.5rem;
    max-width: 500px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    position: relative;
  }

  .info-close {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    background: none;
    border: none;
    color: #666;
    font-size: 1.5rem;
    cursor: pointer;
    line-height: 1;
  }

  .info-close:hover {
    color: #fff;
  }

  .info-modal h2 {
    margin: 0 0 0.5rem;
    font-size: 1.25rem;
    color: #f472b6;
  }

  .info-stats {
    color: #666;
    font-size: 0.8rem;
    margin-bottom: 0.75rem;
  }

  .info-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-bottom: 1rem;
  }

  .info-tag {
    background: rgba(244, 114, 182, 0.15);
    border: 1px solid rgba(244, 114, 182, 0.3);
    border-radius: 6px;
    padding: 0.2rem 0.5rem;
    font-size: 0.7rem;
    color: #f472b6;
  }

  .info-bio {
    color: #999;
    font-size: 0.85rem;
    line-height: 1.5;
    margin: 0 0 1rem;
  }

  .info-bio a {
    color: #60a5fa;
  }

  .info-link {
    display: inline-block;
    background: rgba(96, 165, 250, 0.15);
    border: 1px solid rgba(96, 165, 250, 0.3);
    border-radius: 8px;
    padding: 0.5rem 1rem;
    font-size: 0.8rem;
    color: #60a5fa;
    text-decoration: none;
  }

  .info-link:hover {
    background: rgba(96, 165, 250, 0.25);
  }

  .info-loading {
    background: #18181b;
    border: 1px solid #27272a;
    border-radius: 12px;
    padding: 1rem 2rem;
    color: #fff;
  }
</style>
